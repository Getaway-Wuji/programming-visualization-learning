use crate::{
    ByteRange, Fault, Meter, charge,
    model::{Cell, SAFE},
    syntax,
};
use sqlparser::ast::{BinaryOperator as B, Expr, UnaryOperator as U, Value};
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Type {
    Null,
    Int,
    Text,
    Decimal,
    Average,
}
#[derive(Clone, Debug)]
pub struct Field {
    pub table: String,
    pub name: String,
    pub kind: Type,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum E {
    Const(Cell),
    Col(usize),
    Unary(U, Box<E>),
    Binary(B, Box<E>, Box<E>),
    IsNull(Box<E>, bool),
    In(Box<E>, Vec<E>, bool),
    Between(Box<E>, Box<E>, Box<E>, bool),
    Like(Box<E>, Box<E>, bool),
    Call(String, Vec<E>, bool),
}
impl E {
    pub fn aggregate(&self) -> bool {
        match self {
            Self::Call(n, a, _) => is_aggregate(n) || a.iter().any(Self::aggregate),
            _ => self.children().iter().any(|e| e.aggregate()),
        }
    }
    pub fn average(&self) -> bool {
        match self {
            Self::Call(n, a, _) => n == "AVG" || a.iter().any(Self::average),
            _ => self.children().iter().any(|e| e.average()),
        }
    }
    pub fn direct_average(&self) -> bool {
        matches!(self,Self::Call(n,_,_) if n=="AVG")
    }
    pub fn children(&self) -> Vec<&Self> {
        match self {
            Self::Const(_) | Self::Col(_) => vec![],
            Self::Unary(_, e) | Self::IsNull(e, _) => vec![e],
            Self::Binary(_, a, b) | Self::Like(a, b, _) => vec![a, b],
            Self::In(e, a, _) => std::iter::once(e.as_ref()).chain(a).collect(),
            Self::Between(a, b, c, _) => vec![a, b, c],
            Self::Call(_, a, _) => a.iter().collect(),
        }
    }
    pub fn grouped(&self, keys: &[E]) -> bool {
        if keys.contains(self) {
            return true;
        }
        match self {
            Self::Const(_) => true,
            Self::Col(_) => false,
            Self::Call(n, _, _) if is_aggregate(n) => true,
            _ => self.children().iter().all(|e| e.grouped(keys)),
        }
    }
}
pub fn is_aggregate(n: &str) -> bool {
    matches!(n, "COUNT" | "SUM" | "AVG" | "MIN" | "MAX")
}
fn compatible(a: Type, b: Type) -> bool {
    a == Type::Null
        || b == Type::Null
        || a == b
        || matches!(
            (a, b),
            (Type::Int, Type::Decimal) | (Type::Decimal, Type::Int)
        )
}
fn numeric(t: Type) -> bool {
    matches!(t, Type::Int | Type::Null)
}
fn boolean(t: Type) -> bool {
    matches!(t, Type::Int | Type::Null)
}
pub fn resolve(parts: &[String], schema: &[Field]) -> Result<usize, &'static str> {
    let m: Vec<_> = schema
        .iter()
        .enumerate()
        .filter(|(_, f)| match parts {
            [n] => f.name.eq_ignore_ascii_case(n),
            [t, n] => f.table.eq_ignore_ascii_case(t) && f.name.eq_ignore_ascii_case(n),
            _ => false,
        })
        .map(|(i, _)| i)
        .collect();
    if m.len() == 1 {
        Ok(m[0])
    } else {
        Err("E_NAME")
    }
}
pub fn bind(
    e: &Expr,
    schema: &[Field],
    aliases: &[(String, E, Type)],
    depth: usize,
) -> Result<(E, Type), &'static str> {
    if depth > 128 {
        return Err("E_DEPTH_LIMIT");
    }
    let b = |e: &Expr| bind(e, schema, aliases, depth + 1);
    Ok(match e {
        Expr::Identifier(i) => {
            let matching = aliases
                .iter()
                .filter(|(n, _, _)| n.eq_ignore_ascii_case(&i.value))
                .collect::<Vec<_>>();
            if let Some((_, e, t)) = matching.first() {
                // MySQL's resolver skips equal repeated result expressions.
                // A duplicate label is ambiguous only when its bindings differ.
                if matching
                    .iter()
                    .skip(1)
                    .any(|(_, candidate, kind)| candidate != e || kind != t)
                {
                    return Err("E_NAME");
                }
                (e.clone(), *t)
            } else {
                let n = resolve(std::slice::from_ref(&i.value), schema)?;
                (E::Col(n), schema[n].kind)
            }
        }
        Expr::CompoundIdentifier(v) => {
            let n = resolve(
                &v.iter().map(|i| i.value.clone()).collect::<Vec<_>>(),
                schema,
            )?;
            (E::Col(n), schema[n].kind)
        }
        Expr::Nested(e) => b(e)?,
        Expr::Value(v) => match &v.value {
            Value::Null => (E::Const(Cell::Null), Type::Null),
            Value::Boolean(v) => (E::Const(Cell::int(i64::from(*v))), Type::Int),
            Value::Number(n, false) => {
                let n = n.parse::<i64>().map_err(|_| "E_OVERFLOW")?;
                if n > SAFE {
                    return Err("E_OVERFLOW");
                }
                (E::Const(Cell::int(n)), Type::Int)
            }
            Value::SingleQuotedString(s) => {
                if s.chars().count() > 256 || s.len() > 1024 {
                    return Err("E_TEXT_LIMIT");
                }
                (E::Const(Cell::text(s)), Type::Text)
            }
            _ => return Err("E_UNSUPPORTED"),
        },
        Expr::UnaryOp { op, expr } => {
            let (e, t) = b(expr)?;
            if !numeric(t) {
                return Err("E_TYPE");
            }
            (E::Unary(*op, Box::new(e)), Type::Int)
        }
        Expr::IsNull(a) | Expr::IsNotNull(a) => {
            let (a, _) = b(a)?;
            (
                E::IsNull(Box::new(a), matches!(e, Expr::IsNotNull(_))),
                Type::Int,
            )
        }
        Expr::BinaryOp { left, op, right } => {
            let (a, ta) = b(left)?;
            let (c, tc) = b(right)?;
            let t = match op {
                B::Plus | B::Minus | B::Multiply if numeric(ta) && numeric(tc) => Type::Int,
                B::And | B::Or if boolean(ta) && boolean(tc) => Type::Int,
                B::Eq | B::NotEq | B::Lt | B::LtEq | B::Gt | B::GtEq
                    if compatible(ta, tc) && ta != Type::Average && tc != Type::Average =>
                {
                    Type::Int
                }
                _ => {
                    return Err(if ta == Type::Average || tc == Type::Average {
                        "E_UNSUPPORTED"
                    } else {
                        "E_TYPE"
                    });
                }
            };
            (E::Binary(op.clone(), Box::new(a), Box::new(c)), t)
        }
        Expr::InList {
            expr,
            list,
            negated,
        } => {
            let (a, ta) = b(expr)?;
            let mut out = vec![];
            for e in list {
                let (x, t) = b(e)?;
                if !compatible(ta, t) || ta == Type::Average || t == Type::Average {
                    return Err("E_TYPE");
                }
                out.push(x);
            }
            (E::In(Box::new(a), out, *negated), Type::Int)
        }
        Expr::Between {
            expr,
            low,
            high,
            negated,
        } => {
            let (a, ta) = b(expr)?;
            let (l, tl) = b(low)?;
            let (h, th) = b(high)?;
            if !compatible(ta, tl) || !compatible(ta, th) || [ta, tl, th].contains(&Type::Average) {
                return Err("E_TYPE");
            }
            (
                E::Between(Box::new(a), Box::new(l), Box::new(h), *negated),
                Type::Int,
            )
        }
        Expr::Like {
            expr,
            pattern,
            negated,
            ..
        } => {
            let (a, ta) = b(expr)?;
            let (p, tp) = b(pattern)?;
            if !matches!(ta, Type::Null | Type::Text) || !matches!(tp, Type::Null | Type::Text) {
                return Err("E_TYPE");
            }
            (E::Like(Box::new(a), Box::new(p), *negated), Type::Int)
        }
        Expr::Function(f) => {
            let n = syntax::object(&f.name)?.to_ascii_uppercase();
            let args = syntax::args(f)?;
            let star = args.iter().any(Option::is_none);
            let mut a = vec![];
            let mut ts = vec![];
            for e in args.into_iter().flatten() {
                let (x, t) = b(e)?;
                a.push(x);
                ts.push(t);
            }
            let t = match n.as_str() {
                "COUNT" => Type::Int,
                "SUM" | "AVG" => {
                    if !numeric(ts[0]) {
                        return Err("E_TYPE");
                    }
                    if n == "SUM" {
                        Type::Decimal
                    } else {
                        Type::Average
                    }
                }
                "MIN" | "MAX" => ts[0],
                "ABS" => {
                    if !numeric(ts[0]) {
                        return Err("E_TYPE");
                    }
                    Type::Int
                }
                "LENGTH" | "CHAR_LENGTH" => {
                    if !matches!(ts[0], Type::Null | Type::Text) {
                        return Err("E_TYPE");
                    }
                    Type::Int
                }
                "CONCAT" => {
                    if ts.iter().any(|t| !matches!(t, Type::Null | Type::Text)) {
                        return Err("E_TYPE");
                    }
                    Type::Text
                }
                "IFNULL" | "COALESCE" => {
                    let t = ts
                        .iter()
                        .copied()
                        .find(|t| *t != Type::Null)
                        .unwrap_or(Type::Null);
                    if ts.iter().any(|x| *x != Type::Null && *x != t) {
                        return Err("E_TYPE");
                    }
                    t
                }
                _ => return Err("E_UNSUPPORTED"),
            };
            (E::Call(n, a, star), t)
        }
        _ => return Err("E_UNSUPPORTED"),
    })
}
pub fn truth(v: &Cell) -> Result<Option<bool>, &'static str> {
    match v {
        Cell::Null => Ok(None),
        Cell::Int { value } => Ok(Some(*value != 0)),
        _ => Err("E_TYPE"),
    }
}
fn boolcell(b: Option<bool>) -> Cell {
    b.map(|v| Cell::int(i64::from(v))).unwrap_or(Cell::Null)
}
pub fn compare(a: &Cell, b: &Cell) -> Result<Ordering, &'static str> {
    match (a, b) {
        (Cell::Null, Cell::Null) => Ok(Ordering::Equal),
        (Cell::Null, _) => Ok(Ordering::Less),
        (_, Cell::Null) => Ok(Ordering::Greater),
        (Cell::Int { value: a }, Cell::Int { value: b }) => Ok(a.cmp(b)),
        (Cell::Text { value: a }, Cell::Text { value: b }) => Ok(a.cmp(b)),
        (Cell::Decimal { value: a }, Cell::Decimal { value: b })
            if !a.contains('.') && !b.contains('.') =>
        {
            Ok(a.parse::<i128>()
                .map_err(|_| "E_OVERFLOW")?
                .cmp(&b.parse::<i128>().map_err(|_| "E_OVERFLOW")?))
        }
        (Cell::Decimal { value: a }, Cell::Int { value: b }) if !a.contains('.') => Ok(a
            .parse::<i128>()
            .map_err(|_| "E_OVERFLOW")?
            .cmp(&i128::from(*b))),
        (Cell::Int { value: a }, Cell::Decimal { value: b }) if !b.contains('.') => {
            Ok(i128::from(*a).cmp(&b.parse::<i128>().map_err(|_| "E_OVERFLOW")?))
        }
        _ => Err("E_TYPE"),
    }
}
fn and(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    if a == Some(false) || b == Some(false) {
        Some(false)
    } else if a.is_none() || b.is_none() {
        None
    } else {
        Some(true)
    }
}
fn or(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    if a == Some(true) || b == Some(true) {
        Some(true)
    } else if a.is_none() || b.is_none() {
        None
    } else {
        Some(false)
    }
}
fn checked(n: i128) -> Result<Cell, &'static str> {
    if n.abs() > i128::from(SAFE) {
        Err("E_OVERFLOW")
    } else {
        Ok(Cell::int(n as i64))
    }
}
fn like(s: &str, p: &str, meter: &mut Meter, r: ByteRange) -> Result<bool, Fault> {
    let s: Vec<_> = s.chars().collect();
    let p: Vec<_> = p.chars().collect();
    let mut a = vec![false; s.len() + 1];
    a[0] = true;
    for c in p {
        let mut b = vec![false; s.len() + 1];
        if c == '%' {
            b[0] = a[0];
        }
        for i in 1..=s.len() {
            charge(meter, 1, r)?;
            b[i] = if c == '%' {
                a[i] || b[i - 1]
            } else {
                a[i - 1] && (c == '_' || c == s[i - 1])
            };
        }
        a = b;
    }
    Ok(a[s.len()])
}
pub fn eval(
    e: &E,
    row: &[&Cell],
    group: Option<&[Vec<&Cell>]>,
    meter: &mut Meter,
    r: ByteRange,
    depth: usize,
) -> Result<Cell, Fault> {
    if depth > 128 {
        return Err(Fault::new("E_DEPTH_LIMIT", r));
    }
    charge(meter, 1, r)?;
    let bad = |c| Fault::new(c, r);
    let mut go = |e: &E| eval(e, row, group, meter, r, depth + 1);
    Ok(match e {
        E::Const(v) => v.clone(),
        E::Col(i) => row.get(*i).map(|v| (*v).clone()).unwrap_or(Cell::Null),
        E::Unary(op, e) => {
            let v = go(e)?;
            if v.null() {
                Cell::Null
            } else {
                let Cell::Int { value: n } = v else {
                    return Err(bad("E_TYPE"));
                };
                match op {
                    U::Not => Cell::int(i64::from(n == 0)),
                    U::Plus => v,
                    U::Minus => checked(-i128::from(n)).map_err(bad)?,
                    _ => return Err(bad("E_UNSUPPORTED")),
                }
            }
        }
        E::IsNull(e, neg) => Cell::int(i64::from(go(e)?.null() != *neg)),
        E::Binary(op, a, b) => {
            let a = go(a)?;
            // Binding has already checked both branches. Runtime follows SQL's
            // lazy boolean evaluation without losing UNKNOWN's three values.
            if *op == B::And && truth(&a).map_err(bad)? == Some(false) {
                return Ok(Cell::int(0));
            }
            if *op == B::Or && truth(&a).map_err(bad)? == Some(true) {
                return Ok(Cell::int(1));
            }
            let b = go(b)?;
            match op {
                B::And => boolcell(and(truth(&a).map_err(bad)?, truth(&b).map_err(bad)?)),
                B::Or => boolcell(or(truth(&a).map_err(bad)?, truth(&b).map_err(bad)?)),
                _ if a.null() || b.null() => Cell::Null,
                B::Plus | B::Minus | B::Multiply => {
                    let (Cell::Int { value: a }, Cell::Int { value: b }) = (a, b) else {
                        return Err(bad("E_TYPE"));
                    };
                    let a = i128::from(a);
                    let b = i128::from(b);
                    checked(match op {
                        B::Plus => a + b,
                        B::Minus => a - b,
                        _ => a * b,
                    })
                    .map_err(bad)?
                }
                _ => {
                    let c = compare(&a, &b).map_err(bad)?;
                    Cell::int(i64::from(match op {
                        B::Eq => c == Ordering::Equal,
                        B::NotEq => c != Ordering::Equal,
                        B::Lt => c == Ordering::Less,
                        B::LtEq => c != Ordering::Greater,
                        B::Gt => c == Ordering::Greater,
                        B::GtEq => c != Ordering::Less,
                        _ => return Err(bad("E_UNSUPPORTED")),
                    }))
                }
            }
        }
        E::In(e, es, neg) => {
            let v = go(e)?;
            let mut found = false;
            let mut null = v.null();
            for e in es {
                let x = go(e)?;
                if x.null() {
                    null = true;
                } else if !v.null() && compare(&v, &x).map_err(bad)? == Ordering::Equal {
                    found = true;
                }
            }
            if found {
                Cell::int(i64::from(!*neg))
            } else if null {
                Cell::Null
            } else {
                Cell::int(i64::from(*neg))
            }
        }
        E::Between(e, l, h, neg) => {
            let v = go(e)?;
            let l = go(l)?;
            let h = go(h)?;
            let low = if v.null() || l.null() {
                None
            } else {
                Some(compare(&v, &l).map_err(bad)? != Ordering::Less)
            };
            let high = if v.null() || h.null() {
                None
            } else {
                Some(compare(&v, &h).map_err(bad)? != Ordering::Greater)
            };
            boolcell(and(low, high).map(|b| b != *neg))
        }
        E::Like(e, p, neg) => {
            let s = go(e)?;
            let p = go(p)?;
            if s.null() || p.null() {
                Cell::Null
            } else {
                let (Cell::Text { value: s }, Cell::Text { value: p }) = (s, p) else {
                    return Err(bad("E_TYPE"));
                };
                Cell::int(i64::from(like(&s, &p, meter, r)? != *neg))
            }
        }
        E::Call(n, a, star) if is_aggregate(n) => {
            let rows = group.ok_or_else(|| bad("E_GROUP"))?;
            if n == "COUNT" && *star {
                Cell::int(rows.len() as i64)
            } else {
                let mut values = vec![];
                for row in rows {
                    let v = eval(&a[0], row, None, meter, r, depth + 1)?;
                    if !v.null() {
                        values.push(v);
                    }
                }
                match n.as_str() {
                    "COUNT" => Cell::int(values.len() as i64),
                    _ if values.is_empty() => Cell::Null,
                    "SUM" | "AVG" => {
                        let mut sum = 0i128;
                        for v in &values {
                            let Cell::Int { value } = v else {
                                return Err(bad("E_TYPE"));
                            };
                            sum += i128::from(*value);
                        }
                        if n == "SUM" {
                            Cell::Decimal {
                                value: sum.to_string(),
                            }
                        } else {
                            let den = values.len() as i128;
                            let units = (sum.abs() * 10000 * 2 + den) / (2 * den);
                            Cell::Decimal {
                                value: format!(
                                    "{}{}.{:04}",
                                    if sum < 0 && units != 0 { "-" } else { "" },
                                    units / 10000,
                                    units % 10000
                                ),
                            }
                        }
                    }
                    "MIN" | "MAX" => {
                        let mut value = values[0].clone();
                        for v in &values[1..] {
                            let cmp = compare(v, &value).map_err(bad)?;
                            if (n == "MIN" && cmp == Ordering::Less)
                                || (n == "MAX" && cmp == Ordering::Greater)
                            {
                                value = v.clone();
                            }
                        }
                        value
                    }
                    _ => return Err(bad("E_UNSUPPORTED")),
                }
            }
        }
        E::Call(n, a, _) if matches!(n.as_str(), "IFNULL" | "COALESCE") => {
            let mut value = Cell::Null;
            for e in a {
                value = go(e)?;
                if !value.null() {
                    break;
                }
            }
            value
        }
        E::Call(n, a, _) => {
            let mut v = vec![];
            for e in a {
                v.push(go(e)?);
            }
            match n.as_str() {
                _ if v.iter().any(Cell::null) => Cell::Null,
                "ABS" => {
                    let Cell::Int { value } = v[0] else {
                        return Err(bad("E_TYPE"));
                    };
                    checked(i128::from(value).abs()).map_err(bad)?
                }
                "CONCAT" => {
                    let mut s = String::new();
                    for v in v {
                        let Cell::Text { value } = v else {
                            return Err(bad("E_TYPE"));
                        };
                        s.push_str(&value);
                    }
                    if s.len() > 1024 || s.chars().count() > 256 {
                        return Err(bad("E_TEXT_LIMIT"));
                    }
                    Cell::text(s)
                }
                "LENGTH" | "CHAR_LENGTH" => {
                    let Cell::Text { value } = &v[0] else {
                        return Err(bad("E_TYPE"));
                    };
                    Cell::int(if n == "LENGTH" {
                        value.len()
                    } else {
                        value.chars().count()
                    } as i64)
                }
                _ => return Err(bad("E_UNSUPPORTED")),
            }
        }
    })
}
