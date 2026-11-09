use crate::{ByteRange, Fault, Meter, charge, model::Column, span};
use serde::Serialize;
use sqlparser::{
    ast::*,
    dialect::MySqlDialect,
    parser::Parser,
    tokenizer::{Token, Tokenizer},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub byte_range: ByteRange,
    pub id: usize,
    pub kind: &'static str,
}
pub struct Program {
    pub nodes: Vec<Node>,
    pub statements: Vec<Stmt>,
}
#[derive(Clone, Debug)]
pub struct Relation {
    pub name: String,
    pub alias: String,
}
#[derive(Clone, Debug)]
pub struct Join {
    pub table: Relation,
    pub kind: &'static str,
    pub on: Option<Expr>,
}
#[derive(Clone, Debug)]
pub enum Projection {
    Expr(Box<Expr>, String),
    Star(Option<String>),
}
#[derive(Clone, Debug)]
pub struct QueryPlan {
    pub tables: Vec<Join>,
    pub projection: Vec<Projection>,
    pub selection: Option<Expr>,
    pub group: Vec<Expr>,
    pub having: Option<Expr>,
    pub distinct: bool,
    pub order: Vec<(Expr, bool)>,
    pub limit: Option<(usize, usize)>,
}
#[derive(Clone, Debug)]
pub enum Stmt {
    Query(Box<QueryPlan>),
    Create(String, bool, Vec<(Column, Option<Expr>)>),
    Drop(String, bool),
    Truncate(String),
    Insert(String, Vec<String>, Vec<Vec<Expr>>),
    Update(Relation, Vec<(String, Expr)>, Option<Expr>),
    Delete(Relation, Option<Expr>),
    Begin,
    Commit,
    Rollback,
}
impl Stmt {
    fn kind(&self) -> &'static str {
        match self {
            Self::Query(_) => "select",
            Self::Create(..) => "create",
            Self::Drop(..) => "drop",
            Self::Truncate(_) => "truncate",
            Self::Insert(..) => "insert",
            Self::Update(..) => "update",
            Self::Delete(..) => "delete",
            Self::Begin => "begin",
            Self::Commit => "commit",
            Self::Rollback => "rollback",
        }
    }
}
pub fn ident(i: &Ident) -> Result<String, &'static str> {
    if crate::model::name(&i.value) && (i.quote_style.is_none() || i.quote_style == Some('`')) {
        Ok(i.value.clone())
    } else {
        Err("E_UNSUPPORTED")
    }
}
pub fn object(n: &ObjectName) -> Result<String, &'static str> {
    match n.0.as_slice() {
        [ObjectNamePart::Identifier(i)] => ident(i),
        _ => Err("E_UNSUPPORTED"),
    }
}
pub fn args(f: &Function) -> Result<Vec<Option<&Expr>>, &'static str> {
    if f.uses_odbc_syntax
        || !matches!(f.parameters, FunctionArguments::None)
        || !f.within_group.is_empty()
        || f.filter.is_some()
        || f.null_treatment.is_some()
        || f.over.is_some()
    {
        return Err("E_UNSUPPORTED");
    }
    let FunctionArguments::List(a) = &f.args else {
        return Err("E_UNSUPPORTED");
    };
    if a.duplicate_treatment.is_some() || !a.clauses.is_empty() {
        return Err("E_UNSUPPORTED");
    }
    a.args
        .iter()
        .map(|a| match a {
            FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) => Ok(Some(e)),
            FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => Ok(None),
            _ => Err("E_UNSUPPORTED"),
        })
        .collect()
}
pub fn aggregate(e: &Expr) -> bool {
    match e {
        Expr::Function(f) => {
            object(&f.name).is_ok_and(|n| {
                matches!(
                    n.to_ascii_uppercase().as_str(),
                    "COUNT" | "SUM" | "AVG" | "MIN" | "MAX"
                )
            }) || args(f).is_ok_and(|a| a.into_iter().flatten().any(aggregate))
        }
        _ => children(e).iter().any(|e| aggregate(e)),
    }
}
fn average(e: &Expr) -> bool {
    match e {
        Expr::Function(f) => {
            object(&f.name).is_ok_and(|n| n.eq_ignore_ascii_case("AVG"))
                || args(f).is_ok_and(|a| a.into_iter().flatten().any(average))
        }
        _ => children(e).iter().any(|e| average(e)),
    }
}
fn direct_average(e: &Expr) -> bool {
    match e {
        Expr::Nested(e) => direct_average(e),
        Expr::Function(f) => object(&f.name).is_ok_and(|n| n.eq_ignore_ascii_case("AVG")),
        _ => false,
    }
}
pub fn children(e: &Expr) -> Vec<&Expr> {
    match e {
        Expr::Nested(e) | Expr::UnaryOp { expr: e, .. } | Expr::IsNull(e) | Expr::IsNotNull(e) => {
            vec![e]
        }
        Expr::BinaryOp { left, right, .. } => vec![left, right],
        Expr::InList { expr, list, .. } => {
            std::iter::once(expr.as_ref()).chain(list.iter()).collect()
        }
        Expr::Between {
            expr, low, high, ..
        } => vec![expr, low, high],
        Expr::Like { expr, pattern, .. } => vec![expr, pattern],
        _ => vec![],
    }
}
fn literal(e: &Expr) -> bool {
    match e {
        Expr::Value(_) => true,
        Expr::UnaryOp {
            op: UnaryOperator::Minus | UnaryOperator::Plus,
            expr,
        } => matches!(expr.as_ref(), Expr::Value(_)),
        Expr::Nested(e) => literal(e),
        _ => false,
    }
}
pub fn check_expr(e: &Expr, depth: usize) -> Result<(), &'static str> {
    if depth > 128 {
        return Err("E_DEPTH_LIMIT");
    }
    match e {
        Expr::Identifier(i) => {
            ident(i)?;
        }
        Expr::CompoundIdentifier(v) if v.len() == 2 => {
            for i in v {
                ident(i)?;
            }
        }
        Expr::Value(v) => match &v.value {
            Value::Number(n, false) if n.bytes().all(|b| b.is_ascii_digit()) => {}
            Value::SingleQuotedString(_) | Value::Boolean(_) | Value::Null => {}
            _ => return Err("E_UNSUPPORTED"),
        },
        Expr::Nested(_) | Expr::IsNull(_) | Expr::IsNotNull(_) => {}
        Expr::UnaryOp {
            op: UnaryOperator::Plus | UnaryOperator::Minus | UnaryOperator::Not,
            ..
        } => {}
        Expr::BinaryOp {
            op:
                BinaryOperator::Plus
                | BinaryOperator::Minus
                | BinaryOperator::Multiply
                | BinaryOperator::Eq
                | BinaryOperator::NotEq
                | BinaryOperator::Lt
                | BinaryOperator::LtEq
                | BinaryOperator::Gt
                | BinaryOperator::GtEq
                | BinaryOperator::And
                | BinaryOperator::Or,
            ..
        } => {}
        Expr::InList { list, .. } if !list.is_empty() && list.iter().all(literal) => {}
        Expr::Between { .. } => {}
        Expr::Like {
            any: false,
            escape_char: None,
            ..
        } => {}
        Expr::Function(f) => {
            let n = object(&f.name)?.to_ascii_uppercase();
            let a = args(f)?;
            let okay = match n.as_str() {
                "COUNT" => a.len() == 1,
                "SUM" | "AVG" | "MIN" | "MAX" | "ABS" | "LENGTH" | "CHAR_LENGTH" => {
                    a.len() == 1 && a[0].is_some()
                }
                "IFNULL" => a.len() == 2 && a.iter().all(Option::is_some),
                "COALESCE" | "CONCAT" => !a.is_empty() && a.iter().all(Option::is_some),
                _ => false,
            };
            if !okay {
                return Err("E_UNSUPPORTED");
            }
            for e in a.into_iter().flatten() {
                check_expr(e, depth + 1)?;
                if matches!(n.as_str(), "COUNT" | "SUM" | "AVG" | "MIN" | "MAX") && aggregate(e) {
                    return Err("E_UNSUPPORTED");
                }
            }
        }
        _ => return Err("E_UNSUPPORTED"),
    }
    for c in children(e) {
        check_expr(c, depth + 1)?;
    }
    Ok(())
}
fn relation(t: &TableFactor) -> Result<Relation, &'static str> {
    let TableFactor::Table {
        name,
        alias,
        args,
        with_hints,
        version,
        with_ordinality,
        partitions,
        json_path,
        sample,
        index_hints,
    } = t
    else {
        return Err("E_UNSUPPORTED");
    };
    if args.is_some()
        || !with_hints.is_empty()
        || version.is_some()
        || *with_ordinality
        || !partitions.is_empty()
        || json_path.is_some()
        || sample.is_some()
        || !index_hints.is_empty()
    {
        return Err("E_UNSUPPORTED");
    }
    let n = object(name)?;
    let a = if let Some(a) = alias {
        if !a.columns.is_empty() {
            return Err("E_UNSUPPORTED");
        }
        ident(&a.name)?
    } else {
        n.clone()
    };
    Ok(Relation { name: n, alias: a })
}
fn one_table(t: &TableWithJoins) -> Result<Relation, &'static str> {
    if !t.joins.is_empty() {
        return Err("E_UNSUPPORTED");
    }
    relation(&t.relation)
}
fn natural(e: &Expr) -> Result<usize, &'static str> {
    if let Expr::Value(v) = e
        && let Value::Number(n, false) = &v.value
        && n.bytes().all(|b| b.is_ascii_digit())
    {
        return n.parse::<usize>().map_err(|_| "E_OVERFLOW");
    }
    Err("E_UNSUPPORTED")
}
fn query(q: &Query) -> Result<QueryPlan, &'static str> {
    if q.with.is_some()
        || q.fetch.is_some()
        || !q.locks.is_empty()
        || q.for_clause.is_some()
        || q.settings.is_some()
        || q.format_clause.is_some()
        || !q.pipe_operators.is_empty()
    {
        return Err("E_UNSUPPORTED");
    }
    let SetExpr::Select(s) = q.body.as_ref() else {
        return Err("E_UNSUPPORTED");
    };
    if !matches!(s.flavor, SelectFlavor::Standard)
        || !s.optimizer_hints.is_empty()
        || s.select_modifiers.is_some()
        || s.top.is_some()
        || s.exclude.is_some()
        || s.into.is_some()
        || !s.lateral_views.is_empty()
        || s.prewhere.is_some()
        || !s.connect_by.is_empty()
        || !s.cluster_by.is_empty()
        || !s.distribute_by.is_empty()
        || !s.sort_by.is_empty()
        || !s.named_window.is_empty()
        || s.qualify.is_some()
        || s.value_table_mode.is_some()
    {
        return Err("E_UNSUPPORTED");
    }
    let distinct = match s.distinct {
        None => false,
        Some(Distinct::Distinct) => true,
        _ => return Err("E_UNSUPPORTED"),
    };
    let mut tables = vec![];
    for t in &s.from {
        tables.push(Join {
            table: relation(&t.relation)?,
            kind: "cross",
            on: None,
        });
        for j in &t.joins {
            let (kind, c) = match &j.join_operator {
                JoinOperator::Inner(c) | JoinOperator::Join(c) => ("inner", c),
                JoinOperator::Left(c) | JoinOperator::LeftOuter(c) => ("left", c),
                JoinOperator::CrossJoin(c) => ("cross", c),
                _ => return Err("E_UNSUPPORTED"),
            };
            let on = match c {
                JoinConstraint::On(e) if kind != "cross" => {
                    check_expr(e, 0)?;
                    if aggregate(e) {
                        return Err("E_UNSUPPORTED");
                    }
                    Some(e.clone())
                }
                JoinConstraint::None if kind == "cross" => None,
                _ => return Err("E_UNSUPPORTED"),
            };
            tables.push(Join {
                table: relation(&j.relation)?,
                kind,
                on,
            });
        }
    }
    if tables.len() > 4 {
        return Err("E_UNSUPPORTED");
    }
    let mut projection = vec![];
    for p in &s.projection {
        projection.push(match p {
            SelectItem::UnnamedExpr(e) => {
                check_expr(e, 0)?;
                Projection::Expr(
                    Box::new(e.clone()),
                    match e {
                        Expr::Identifier(i) => i.value.clone(),
                        Expr::CompoundIdentifier(v) => v.last().unwrap().value.clone(),
                        _ => e.to_string(),
                    },
                )
            }
            SelectItem::ExprWithAlias { expr, alias } => {
                check_expr(expr, 0)?;
                Projection::Expr(Box::new(expr.clone()), ident(alias)?)
            }
            SelectItem::Wildcard(o) if o.to_string().is_empty() => Projection::Star(None),
            SelectItem::QualifiedWildcard(SelectItemQualifiedWildcardKind::ObjectName(n), o)
                if o.to_string().is_empty() =>
            {
                Projection::Star(Some(object(n)?))
            }
            _ => return Err("E_UNSUPPORTED"),
        });
    }
    let group = match &s.group_by {
        GroupByExpr::Expressions(e, m) if m.is_empty() => {
            for e in e {
                check_expr(e, 0)?;
                if aggregate(e) {
                    return Err("E_GROUP");
                }
            }
            e.clone()
        }
        _ => return Err("E_UNSUPPORTED"),
    };
    for e in [&s.selection, &s.having].into_iter().flatten() {
        check_expr(e, 0)?;
    }
    if s.selection.as_ref().is_some_and(aggregate) {
        return Err("E_UNSUPPORTED");
    }
    let mut order = vec![];
    if let Some(o) = &q.order_by {
        if o.interpolate.is_some() {
            return Err("E_UNSUPPORTED");
        }
        let OrderByKind::Expressions(es) = &o.kind else {
            return Err("E_UNSUPPORTED");
        };
        for o in es {
            check_expr(&o.expr, 0)?;
            if o.with_fill.is_some() || o.options.nulls_first.is_some() {
                return Err("E_UNSUPPORTED");
            }
            let asc = match o.options.sort {
                None | Some(OrderBySort::Asc) => true,
                Some(OrderBySort::Desc) => false,
                _ => return Err("E_UNSUPPORTED"),
            };
            order.push((o.expr.clone(), asc));
        }
    }
    let limit = match &q.limit_clause {
        None => None,
        Some(LimitClause::LimitOffset {
            limit: Some(l),
            offset,
            limit_by,
        }) if limit_by.is_empty() => Some((
            offset
                .as_ref()
                .map(|o| natural(&o.value))
                .transpose()?
                .unwrap_or(0),
            natural(l)?,
        )),
        Some(LimitClause::OffsetCommaLimit { offset, limit }) => {
            Some((natural(offset)?, natural(limit)?))
        }
        _ => return Err("E_UNSUPPORTED"),
    };
    if projection
        .iter()
        .any(|p| matches!(p,Projection::Expr(e,_) if average(e)&&(!direct_average(e)||distinct)))
        || s.having.as_ref().is_some_and(average)
        || order.iter().any(|(e, _)| average(e))
    {
        return Err("E_UNSUPPORTED");
    }
    if !projection.iter().any(|p| matches!(p, Projection::Star(_))) {
        for (e, _) in &order {
            if let Expr::Value(v) = e
                && let Value::Number(n, false) = &v.value
                && let Ok(i) = n.parse::<usize>()
                && let Some(Projection::Expr(e, _)) =
                    i.checked_sub(1).and_then(|i| projection.get(i))
                && average(e)
            {
                return Err("E_UNSUPPORTED");
            }
        }
    }
    Ok(QueryPlan {
        tables,
        projection,
        selection: s.selection.clone(),
        group,
        having: s.having.clone(),
        distinct,
        order,
        limit,
    })
}
fn lower(s: Statement) -> Result<Stmt, &'static str> {
    match s {
        Statement::Query(q) => Ok(Stmt::Query(Box::new(query(&q)?))),
        Statement::Insert(i) => {
            let TableObject::TableName(n) = &i.table else {
                return Err("E_UNSUPPORTED");
            };
            let name = object(n)?;
            let q = i.source.as_ref().ok_or("E_UNSUPPORTED")?;
            let SetExpr::Values(v) = q.body.as_ref() else {
                return Err("E_UNSUPPORTED");
            };
            if q.with.is_some()
                || q.order_by.is_some()
                || q.limit_clause.is_some()
                || q.fetch.is_some()
                || !q.locks.is_empty()
                || q.for_clause.is_some()
                || q.settings.is_some()
                || q.format_clause.is_some()
                || !q.pipe_operators.is_empty()
            {
                return Err("E_UNSUPPORTED");
            }
            let cols = i
                .columns
                .iter()
                .map(object)
                .collect::<Result<Vec<_>, _>>()?;
            let basic = format!(
                "INSERT {}{}{} {}",
                if i.into { "INTO " } else { "" },
                i.table,
                if i.columns.is_empty() {
                    String::new()
                } else {
                    format!(
                        " ({})",
                        i.columns
                            .iter()
                            .map(ToString::to_string)
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                },
                q
            );
            if i.to_string() != basic {
                return Err("E_UNSUPPORTED");
            }
            for row in &v.rows {
                for e in row.iter() {
                    check_expr(e, 0)?;
                    if aggregate(e) {
                        return Err("E_UNSUPPORTED");
                    }
                }
            }
            Ok(Stmt::Insert(
                name,
                cols,
                v.rows.iter().map(|r| r.to_vec()).collect(),
            ))
        }
        Statement::Update(u) => {
            let t = one_table(&u.table)?;
            if !u.optimizer_hints.is_empty()
                || u.from.is_some()
                || u.returning.is_some()
                || u.output.is_some()
                || u.or.is_some()
                || !u.order_by.is_empty()
                || u.limit.is_some()
            {
                return Err("E_UNSUPPORTED");
            }
            let mut a = vec![];
            for s in u.assignments {
                let AssignmentTarget::ColumnName(n) = s.target else {
                    return Err("E_UNSUPPORTED");
                };
                let c = object(&n)?;
                check_expr(&s.value, 0)?;
                if aggregate(&s.value) {
                    return Err("E_UNSUPPORTED");
                }
                a.push((c, s.value));
            }
            if let Some(e) = &u.selection {
                check_expr(e, 0)?;
                if aggregate(e) {
                    return Err("E_UNSUPPORTED");
                }
            }
            Ok(Stmt::Update(t, a, u.selection))
        }
        Statement::Delete(d) => {
            let from = match &d.from {
                FromTable::WithFromKeyword(v) => v,
                _ => return Err("E_UNSUPPORTED"),
            };
            if from.len() != 1
                || !d.optimizer_hints.is_empty()
                || !d.tables.is_empty()
                || d.using.is_some()
                || d.returning.is_some()
                || d.output.is_some()
                || !d.order_by.is_empty()
                || d.limit.is_some()
            {
                return Err("E_UNSUPPORTED");
            }
            let t = one_table(&from[0])?;
            if let Some(e) = &d.selection {
                check_expr(e, 0)?;
                if aggregate(e) {
                    return Err("E_UNSUPPORTED");
                }
            }
            Ok(Stmt::Delete(t, d.selection))
        }
        Statement::CreateTable(c) => {
            let n = object(&c.name)?;
            let mut allowed = format!(
                "CREATE TABLE {}{} ({}",
                if c.if_not_exists {
                    "IF NOT EXISTS "
                } else {
                    ""
                },
                c.name,
                c.columns
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            for k in &c.constraints {
                allowed.push_str(&format!(", {k}"));
            }
            allowed.push(')');
            if c.to_string() != allowed {
                return Err("E_UNSUPPORTED");
            }
            if c.columns.is_empty() || c.columns.len() > 16 {
                return Err("E_COLUMN_LIMIT");
            }
            let mut cols = vec![];
            let mut primary_declarations = 0usize;
            for d in &c.columns {
                let name = ident(&d.name)?;
                let (kind, length) = match &d.data_type {
                    DataType::Int(None) => ("int", None),
                    DataType::Varchar(Some(CharacterLength::IntegerLength {
                        length,
                        unit: None,
                    })) if (1..=256).contains(length) => ("varchar", Some(*length as usize)),
                    _ => return Err("E_UNSUPPORTED"),
                };
                let mut col = Column {
                    default_value: None,
                    length,
                    name,
                    nullable: true,
                    primary_key: false,
                    kind: kind.into(),
                    unique: false,
                };
                let mut default = None;
                for o in &d.options {
                    if o.name.is_some() {
                        return Err("E_UNSUPPORTED");
                    }
                    match &o.option {
                        ColumnOption::Null => col.nullable = true,
                        ColumnOption::NotNull => col.nullable = false,
                        ColumnOption::Default(e) if default.is_none() && literal(e) => {
                            check_expr(e, 0)?;
                            default = Some(e.clone());
                        }
                        ColumnOption::PrimaryKey(k)
                            if k.columns.is_empty() && o.option.to_string() == "PRIMARY KEY" =>
                        {
                            primary_declarations += 1;
                            if primary_declarations > 1 {
                                return Err("E_CONSTRAINT");
                            }
                            col.primary_key = true;
                            col.unique = true;
                            col.nullable = false;
                        }
                        ColumnOption::Unique(k)
                            if k.columns.is_empty() && o.option.to_string() == "UNIQUE" =>
                        {
                            col.unique = true
                        }
                        _ => return Err("E_UNSUPPORTED"),
                    }
                }
                if col.primary_key {
                    col.nullable = false;
                }
                cols.push((col, default));
            }
            for k in &c.constraints {
                let (names, pk) = match k {
                    TableConstraint::PrimaryKey(k)
                        if k.columns.len() == 1
                            && k.index_type.is_none()
                            && k.include.is_empty()
                            && k.index_options.is_empty()
                            && k.characteristics.is_none() =>
                    {
                        (
                            k.columns
                                .iter()
                                .map(ToString::to_string)
                                .collect::<Vec<_>>(),
                            true,
                        )
                    }
                    TableConstraint::Unique(k)
                        if k.columns.len() == 1
                            && matches!(k.nulls_distinct, NullsDistinctOption::None)
                            && k.index_type.is_none()
                            && k.include.is_empty()
                            && k.index_options.is_empty()
                            && k.characteristics.is_none() =>
                    {
                        (
                            k.columns
                                .iter()
                                .map(ToString::to_string)
                                .collect::<Vec<_>>(),
                            false,
                        )
                    }
                    _ => return Err("E_UNSUPPORTED"),
                };
                let s = names[0].trim_matches('`');
                if !crate::model::name(s) {
                    return Err("E_UNSUPPORTED");
                }
                let Some((col, _)) = cols
                    .iter_mut()
                    .find(|(c, _)| c.name.eq_ignore_ascii_case(s))
                else {
                    return Err("E_NAME");
                };
                col.unique = true;
                if pk {
                    primary_declarations += 1;
                    if primary_declarations > 1 {
                        return Err("E_CONSTRAINT");
                    }
                    col.primary_key = true;
                    col.nullable = false;
                }
            }
            Ok(Stmt::Create(n, c.if_not_exists, cols))
        }
        Statement::Drop {
            object_type: ObjectType::Table,
            if_exists,
            names,
            cascade: false,
            restrict: false,
            purge: false,
            temporary: false,
            table: None,
        } if names.len() == 1 => Ok(Stmt::Drop(object(&names[0])?, if_exists)),
        Statement::Truncate(t)
            if t.table_names.len() == 1
                && !t.if_exists
                && t.partitions.is_none()
                && t.identity.is_none()
                && t.cascade.is_none()
                && t.on_cluster.is_none() =>
        {
            Ok(Stmt::Truncate(object(&t.table_names[0].name)?))
        }
        Statement::StartTransaction {
            modes,
            modifier: None,
            statements,
            exception: None,
            has_end_keyword: false,
            ..
        } if modes.is_empty() && statements.is_empty() => Ok(Stmt::Begin),
        Statement::Commit {
            chain: false,
            end: false,
            modifier: None,
        } => Ok(Stmt::Commit),
        Statement::Rollback {
            chain: false,
            savepoint: None,
        } => Ok(Stmt::Rollback),
        _ => Err("E_UNSUPPORTED"),
    }
}
pub fn parse(source: &str, meter: &mut Meter) -> Result<Program, Fault> {
    let full = span(0, source.len());
    charge(meter, source.len().div_ceil(16), full)?;
    let dialect = MySqlDialect {};
    let tokens = Tokenizer::new(&dialect, source)
        .tokenize()
        .map_err(|_| Fault::new("E_SYNTAX", full))?;
    if tokens
        .iter()
        .filter(|t| !matches!(t, Token::Whitespace(_) | Token::EOF))
        .count()
        > 8192
    {
        return Err(Fault::new("E_TOKEN_LIMIT", full));
    }
    let mut nesting = 0usize;
    for t in &tokens {
        match t {
            Token::LParen => {
                nesting += 1;
                if nesting > 64 {
                    return Err(Fault::new("E_DEPTH_LIMIT", full));
                }
            }
            Token::RParen => nesting = nesting.saturating_sub(1),
            _ => {}
        }
    }
    // Split byte spans without treating delimiters inside strings/comments as SQL.
    let b = source.as_bytes();
    let mut i = 0;
    let mut start = 0;
    let mut ranges = vec![];
    let mut quote = 0u8;
    while i < b.len() {
        if quote != 0 {
            if b[i] == b'\\' && quote == b'\'' {
                return Err(Fault::new("E_UNSUPPORTED", span(i, i + 1)));
            }
            if b[i] == quote {
                if b.get(i + 1) == Some(&quote) {
                    i += 2;
                    continue;
                }
                quote = 0;
            }
            i += 1;
            continue;
        }
        if matches!(b[i], b'\'' | b'`' | b'"') {
            quote = b[i];
            i += 1;
            continue;
        }
        if b[i] == b'#'
            || (b[i] == b'-'
                && b.get(i + 1) == Some(&b'-')
                && b.get(i + 2).is_none_or(u8::is_ascii_whitespace))
        {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            if matches!(b.get(i + 2), Some(b'!' | b'+')) {
                return Err(Fault::new("E_UNSUPPORTED", span(i, (i + 3).min(b.len()))));
            }
            i += 2;
            while i + 1 < b.len() && &b[i..i + 2] != b"*/" {
                i += 1;
            }
            i = (i + 2).min(b.len());
            continue;
        }
        if b[i] == b';' {
            ranges.push(span(start, i));
            start = i + 1;
        }
        i += 1;
    }
    ranges.push(span(start, b.len()));
    let mut nodes = vec![];
    let mut statements = vec![];
    for r in ranges {
        let part = &source[r.start..r.end];
        let lead = part.len() - part.trim_start().len();
        let tail = part.trim_end().len();
        if tail <= lead {
            continue;
        }
        let r = span(r.start + lead, r.start + tail);
        let parsed = Parser::new(&dialect)
            .with_recursion_limit(64)
            .try_with_sql(&source[r.start..r.end])
            .and_then(|mut p| p.parse_statements())
            .map_err(|e| {
                Fault::new(
                    if e.to_string().to_ascii_lowercase().contains("recursion") {
                        "E_DEPTH_LIMIT"
                    } else {
                        "E_SYNTAX"
                    },
                    r,
                )
            })?;
        for s in parsed {
            if statements.len() >= 32 {
                return Err(Fault::new("E_STATEMENT_LIMIT", r));
            }
            let s = lower(s).map_err(|c| Fault::new(c, r))?;
            nodes.push(Node {
                byte_range: r,
                id: nodes.len() + 1,
                kind: s.kind(),
            });
            statements.push(s);
        }
    }
    if statements.is_empty() {
        return Err(Fault::new("E_SYNTAX", full));
    }
    Ok(Program { nodes, statements })
}
