//! Explicit virtual C6 ABI and typed values. Floating wire values preserve raw bits.
use serde::{Serialize, Serializer};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ty {
    Int,
    UInt,
    Char,
    F32,
    F64,
    Void,
    Struct(String),
    Pointer(Box<Ty>),
    Array(Box<Ty>, usize),
    Const(Box<Ty>),
    Alias(String, Box<Ty>),
}
impl Ty {
    pub fn bare(&self) -> &Self {
        match self {
            Self::Const(t) | Self::Alias(_, t) => t.bare(),
            _ => self,
        }
    }
    pub fn top_const(&self) -> bool {
        match self {
            Self::Const(_) => true,
            Self::Alias(_, t) => t.top_const(),
            _ => false,
        }
    }
    pub fn scalar(&self) -> bool {
        matches!(
            self.bare(),
            Self::Int | Self::UInt | Self::Char | Self::F32 | Self::F64 | Self::Pointer(_)
        )
    }
    pub fn numeric(&self) -> bool {
        self.scalar() && !matches!(self.bare(), Self::Pointer(_))
    }
    pub fn integral(&self) -> bool {
        matches!(self.bare(), Self::Int | Self::UInt | Self::Char)
    }
    pub fn decay(&self) -> Self {
        match self.bare() {
            Self::Array(t, _) => Self::Pointer(t.clone()),
            _ => self.clone(),
        }
    }
    pub fn signature_key(&self) -> Self {
        fn normalized(t: &Ty, top: bool) -> Ty {
            match t {
                Ty::Alias(_, base) => normalized(base, top),
                Ty::Const(base) if top => normalized(base, true),
                Ty::Const(base) => Ty::Const(Box::new(normalized(base, false))),
                Ty::Pointer(base) => Ty::Pointer(Box::new(normalized(base, false))),
                Ty::Array(base, n) => Ty::Array(Box::new(normalized(base, false)), *n),
                _ => t.clone(),
            }
        }
        normalized(self, true)
    }
    pub fn name(&self) -> String {
        match self {
            Self::Int => "int".into(),
            Self::UInt => "unsigned int".into(),
            Self::Char => "char".into(),
            Self::F32 => "float".into(),
            Self::F64 => "double".into(),
            Self::Void => "void".into(),
            Self::Struct(s) => format!("struct {s}"),
            Self::Pointer(t) => format!("{}*", t.name()),
            Self::Array(t, n) => format!("{}[{n}]", t.name()),
            Self::Const(t) if matches!(t.bare(), Self::Pointer(_)) => {
                format!("{} const", t.name())
            }
            Self::Const(t) => format!("const {}", t.name()),
            Self::Alias(n, _) => n.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pointer {
    pub object_id: Option<String>,
    pub byte_offset: usize,
    pub lower_bound: usize,
    pub upper_bound: usize,
    pub pointee_type: String,
}
#[derive(Clone, Debug)]
pub enum Val {
    I(i32),
    U(u32),
    C(u8),
    F(f32),
    D(f64),
    P(Pointer),
}
impl PartialEq for Val {
    fn eq(&self, b: &Self) -> bool {
        match (self, b) {
            (Self::I(a), Self::I(b)) => a == b,
            (Self::U(a), Self::U(b)) => a == b,
            (Self::C(a), Self::C(b)) => a == b,
            (Self::F(a), Self::F(b)) => a.to_bits() == b.to_bits(),
            (Self::D(a), Self::D(b)) => a.to_bits() == b.to_bits(),
            (Self::P(a), Self::P(b)) => a == b,
            _ => false,
        }
    }
}
impl Eq for Val {}
impl Serialize for Val {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.wire().serialize(s)
    }
}
impl Val {
    pub fn wire(&self) -> Value {
        match self {
            Self::I(n) => json!(n),
            Self::U(n) => json!(n),
            Self::C(n) => json!(n),
            Self::F(n) => json!({"kind":"f32","bits":format!("{:08x}",n.to_bits())}),
            Self::D(n) => json!({"kind":"f64","bits":format!("{:016x}",n.to_bits())}),
            Self::P(p) => json!(p),
        }
    }
    pub fn ty(&self) -> Ty {
        match self {
            Self::I(_) => Ty::Int,
            Self::U(_) => Ty::UInt,
            Self::C(_) => Ty::Char,
            Self::F(_) => Ty::F32,
            Self::D(_) => Ty::F64,
            Self::P(_) => Ty::Pointer(Box::new(Ty::Int)),
        }
    }
    pub fn null(t: &Ty) -> Self {
        Self::P(Pointer {
            object_id: None,
            byte_offset: 0,
            lower_bound: 0,
            upper_bound: 0,
            pointee_type: t.name(),
        })
    }
    pub fn truth(&self) -> bool {
        match self {
            Self::I(n) => *n != 0,
            Self::U(n) => *n != 0,
            Self::C(n) => *n != 0,
            Self::F(n) => *n != 0.0,
            Self::D(n) => *n != 0.0,
            Self::P(p) => p.object_id.is_some(),
        }
    }
    pub fn real(&self) -> Result<f64, &'static str> {
        match self {
            Self::I(n) => Ok(f64::from(*n)),
            Self::U(n) => Ok(f64::from(*n)),
            Self::C(n) => Ok(f64::from(*n)),
            Self::F(n) => Ok(f64::from(*n)),
            Self::D(n) => Ok(*n),
            _ => Err("E_TYPE_INVALID"),
        }
    }
    pub fn int(&self) -> Result<i32, &'static str> {
        match self {
            Self::I(n) => Ok(*n),
            Self::C(n) => Ok(i32::from(*n)),
            _ => Err("E_TYPE_INVALID"),
        }
    }
    pub fn uint(&self) -> Result<u32, &'static str> {
        match self {
            Self::I(n) => Ok(*n as u32),
            Self::U(n) => Ok(*n),
            Self::C(n) => Ok(u32::from(*n)),
            _ => Err("E_TYPE_INVALID"),
        }
    }
    pub fn cast(&self, dest: &Ty) -> Result<Self, &'static str> {
        let bad = "E_OVERFLOW";
        match dest.bare() {
            Ty::Int => match self {
                Self::I(n) => Ok(Self::I(*n)),
                Self::U(n) => i32::try_from(*n).map(Self::I).map_err(|_| bad),
                Self::C(n) => Ok(Self::I(i32::from(*n))),
                Self::F(_) | Self::D(_) => {
                    let n = self.real()?.trunc();
                    if (-2147483648.0..=2147483647.0).contains(&n) {
                        Ok(Self::I(n as i32))
                    } else {
                        Err(bad)
                    }
                }
                _ => Err("E_TYPE_INVALID"),
            },
            Ty::UInt => match self {
                Self::I(n) => Ok(Self::U(*n as u32)),
                Self::U(n) => Ok(Self::U(*n)),
                Self::C(n) => Ok(Self::U(u32::from(*n))),
                Self::F(_) | Self::D(_) => {
                    let n = self.real()?.trunc();
                    if (0.0..=4294967295.0).contains(&n) {
                        Ok(Self::U(n as u32))
                    } else {
                        Err(bad)
                    }
                }
                _ => Err("E_TYPE_INVALID"),
            },
            Ty::Char => {
                let n = self.real()?.trunc();
                if (0.0..=127.0).contains(&n) {
                    Ok(Self::C(n as u8))
                } else {
                    Err("E_CHAR_DOMAIN")
                }
            }
            Ty::F32 => {
                let n = self.real()? as f32;
                if n.is_finite() {
                    Ok(Self::F(n))
                } else {
                    Err("E_FLOAT_NONFINITE")
                }
            }
            Ty::F64 => {
                let n = self.real()?;
                if n.is_finite() {
                    Ok(Self::D(n))
                } else {
                    Err("E_FLOAT_NONFINITE")
                }
            }
            Ty::Pointer(t) => match self {
                Self::P(p) => {
                    let mut p = p.clone();
                    p.pointee_type = t.name();
                    Ok(Self::P(p))
                }
                Self::I(0) | Self::U(0) => Ok(Self::null(t)),
                _ => Err("E_TYPE_INVALID"),
            },
            _ => Err("E_TYPE_INVALID"),
        }
    }
    pub fn zero(ty: &Ty) -> Result<Self, &'static str> {
        Self::I(0).cast(ty)
    }
    pub fn from_wire(v: &Value, ty: &Ty) -> Result<Self, &'static str> {
        match ty.bare() {
            Ty::Int => v
                .as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .map(Self::I)
                .ok_or("E_TYPE_INVALID"),
            Ty::UInt => v
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .map(Self::U)
                .ok_or("E_TYPE_INVALID"),
            Ty::Char => v
                .as_u64()
                .filter(|n| *n <= 127)
                .map(|n| Self::C(n as u8))
                .ok_or("E_CHAR_DOMAIN"),
            Ty::F32 => {
                if v["kind"] != "f32" {
                    return Err("E_TYPE_INVALID");
                };
                let b = v["bits"]
                    .as_str()
                    .filter(|s| s.len() == 8)
                    .ok_or("E_TYPE_INVALID")?;
                let n = f32::from_bits(u32::from_str_radix(b, 16).map_err(|_| "E_TYPE_INVALID")?);
                if n.is_finite() {
                    Ok(Self::F(n))
                } else {
                    Err("E_FLOAT_NONFINITE")
                }
            }
            Ty::F64 => {
                if v["kind"] != "f64" {
                    return Err("E_TYPE_INVALID");
                };
                let b = v["bits"]
                    .as_str()
                    .filter(|s| s.len() == 16)
                    .ok_or("E_TYPE_INVALID")?;
                let n = f64::from_bits(u64::from_str_radix(b, 16).map_err(|_| "E_TYPE_INVALID")?);
                if n.is_finite() {
                    Ok(Self::D(n))
                } else {
                    Err("E_FLOAT_NONFINITE")
                }
            }
            Ty::Pointer(_) => serde_json::from_value(v.clone())
                .map(Self::P)
                .map_err(|_| "E_TYPE_INVALID"),
            _ => Err("E_TYPE_INVALID"),
        }
    }
}

pub fn usual(a: &Ty, b: &Ty) -> Result<Ty, &'static str> {
    if !a.numeric() || !b.numeric() {
        return Err("E_TYPE_INVALID");
    }
    Ok(if a.bare() == &Ty::F64 || b.bare() == &Ty::F64 {
        Ty::F64
    } else if a.bare() == &Ty::F32 || b.bare() == &Ty::F32 {
        Ty::F32
    } else if a.bare() == &Ty::UInt || b.bare() == &Ty::UInt {
        Ty::UInt
    } else {
        Ty::Int
    })
}
pub fn unary(op: &str, v: &Val) -> Result<Val, &'static str> {
    if op == "!" {
        return Ok(Val::I(i32::from(!v.truth())));
    }
    let t = if v.ty() == Ty::Char { Ty::Int } else { v.ty() };
    let v = v.cast(&t)?;
    match (op, v) {
        ("+", v) => Ok(v),
        ("-", Val::I(n)) => n.checked_neg().map(Val::I).ok_or("E_OVERFLOW"),
        ("-", Val::U(n)) => Ok(Val::U(n.wrapping_neg())),
        ("-", Val::F(n)) => Ok(Val::F(-n)),
        ("-", Val::D(n)) => Ok(Val::D(-n)),
        ("~", Val::I(n)) => Ok(Val::I(!n)),
        ("~", Val::U(n)) => Ok(Val::U(!n)),
        _ => Err("E_TYPE_INVALID"),
    }
}
pub fn binary(op: &str, a: &Val, b: &Val) -> Result<Val, &'static str> {
    let t = usual(&a.ty(), &b.ty())?;
    if matches!(op, "<<" | ">>") {
        let n = b.real()?;
        if !b.ty().integral() || !(0.0..32.0).contains(&n) {
            return Err("E_SHIFT_INVALID");
        }
        let count = n as u32;
        return match a.cast(&if a.ty() == Ty::UInt {
            Ty::UInt
        } else {
            Ty::Int
        })? {
            Val::U(v) => Ok(Val::U(if op == "<<" {
                v.wrapping_shl(count)
            } else {
                v >> count
            })),
            Val::I(v) => {
                if v < 0 {
                    return Err("E_SHIFT_INVALID");
                };
                if op == ">>" {
                    Ok(Val::I(v >> count))
                } else {
                    let value = i64::from(v) << count;
                    i32::try_from(value)
                        .map(Val::I)
                        .map_err(|_| "E_SHIFT_INVALID")
                }
            }
            _ => Err("E_TYPE_INVALID"),
        };
    }
    let a = a.cast(&t)?;
    let b = b.cast(&t)?;
    let comparison = matches!(op, "==" | "!=" | "<" | "<=" | ">" | ">=");
    if comparison {
        let (x, y) = (a.real()?, b.real()?);
        return Ok(Val::I(i32::from(match op {
            "==" => x == y,
            "!=" => x != y,
            "<" => x < y,
            "<=" => x <= y,
            ">" => x > y,
            _ => x >= y,
        })));
    }
    match (a, b) {
        (Val::I(a), Val::I(b)) => {
            if matches!(op, "/" | "%") && b == 0 {
                return Err("E_DIV_ZERO");
            }
            let n = match op {
                "+" => a.checked_add(b),
                "-" => a.checked_sub(b),
                "*" => a.checked_mul(b),
                "/" => a.checked_div(b),
                "%" => a.checked_rem(b),
                "&" => Some(a & b),
                "|" => Some(a | b),
                "^" => Some(a ^ b),
                _ => return Err("E_TYPE_INVALID"),
            };
            n.map(Val::I).ok_or("E_OVERFLOW")
        }
        (Val::U(a), Val::U(b)) => {
            if matches!(op, "/" | "%") && b == 0 {
                return Err("E_DIV_ZERO");
            };
            Ok(Val::U(match op {
                "+" => a.wrapping_add(b),
                "-" => a.wrapping_sub(b),
                "*" => a.wrapping_mul(b),
                "/" => a / b,
                "%" => a % b,
                "&" => a & b,
                "|" => a | b,
                "^" => a ^ b,
                _ => return Err("E_TYPE_INVALID"),
            }))
        }
        (Val::F(a), Val::F(b)) => {
            if op == "/" && b == 0.0 {
                return Err("E_DIV_ZERO");
            };
            let n = match op {
                "+" => a + b,
                "-" => a - b,
                "*" => a * b,
                "/" => a / b,
                _ => return Err("E_TYPE_INVALID"),
            };
            if n.is_finite() {
                Ok(Val::F(n))
            } else {
                Err("E_FLOAT_NONFINITE")
            }
        }
        (Val::D(a), Val::D(b)) => {
            if op == "/" && b == 0.0 {
                return Err("E_DIV_ZERO");
            };
            let n = match op {
                "+" => a + b,
                "-" => a - b,
                "*" => a * b,
                "/" => a / b,
                _ => return Err("E_TYPE_INVALID"),
            };
            if n.is_finite() {
                Ok(Val::D(n))
            } else {
                Err("E_FLOAT_NONFINITE")
            }
        }
        _ => Err("E_TYPE_INVALID"),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldInfo {
    pub name: String,
    pub type_name: String,
    pub byte_offset: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeInfo {
    pub name: String,
    pub kind: &'static str,
    pub byte_size: usize,
    pub alignment: usize,
    pub pointee_type: Option<String>,
    pub element_type: Option<String>,
    pub element_count: usize,
    pub fields: Vec<FieldInfo>,
}
#[derive(Clone, Debug, Default)]
pub struct Types {
    pub structs: BTreeMap<String, Vec<(String, Ty)>>,
    pub table: BTreeMap<String, TypeInfo>,
    pub resolved: BTreeMap<String, Ty>,
}
impl Types {
    pub fn describe(&mut self, t: &Ty) -> Result<TypeInfo, &'static str> {
        let name = t.name();
        if let Some(i) = self.table.get(&name) {
            return Ok(i.clone());
        }
        if self.table.len() >= 128 {
            return Err("E_TYPE_INVALID");
        }
        let mut i = TypeInfo {
            name: name.clone(),
            kind: "void",
            byte_size: 0,
            alignment: 1,
            pointee_type: None,
            element_type: None,
            element_count: 0,
            fields: vec![],
        };
        self.resolved.insert(name.clone(), t.clone());
        match t {
            Ty::Const(base) | Ty::Alias(_, base) => {
                i = self.describe(base)?;
                i.name = name.clone();
            }
            Ty::Int => {
                i.kind = "int";
                i.byte_size = 4;
                i.alignment = 4
            }
            Ty::UInt => {
                i.kind = "uint";
                i.byte_size = 4;
                i.alignment = 4
            }
            Ty::Char => {
                i.kind = "char";
                i.byte_size = 1
            }
            Ty::F32 => {
                i.kind = "f32";
                i.byte_size = 4;
                i.alignment = 4
            }
            Ty::F64 => {
                i.kind = "f64";
                i.byte_size = 8;
                i.alignment = 8
            }
            Ty::Void => {}
            Ty::Pointer(p) => {
                i.kind = "pointer";
                i.byte_size = 4;
                i.alignment = 4;
                i.pointee_type = Some(p.name());
                self.table.insert(name.clone(), i.clone());
                self.describe(p)?;
            }
            Ty::Array(base, n) => {
                let b = self.describe(base)?;
                if *n == 0 || *n > if base.bare() == &Ty::Char { 64 } else { 30 } {
                    return Err("E_BOUNDS");
                };
                i.kind = "array";
                i.byte_size = b.byte_size.checked_mul(*n).ok_or("E_MEMORY_LIMIT")?;
                i.alignment = b.alignment;
                i.element_type = Some(base.name());
                i.element_count = *n;
            }
            Ty::Struct(s) => {
                i.kind = "struct";
                self.table.insert(name.clone(), i.clone());
                let fields = self.structs.get(s).cloned().ok_or("E_TYPE_INVALID")?;
                for (field, ty) in fields {
                    let f = self.describe(&ty)?;
                    i.alignment = i.alignment.max(f.alignment);
                    let at = i.byte_size.div_ceil(f.alignment) * f.alignment;
                    i.fields.push(FieldInfo {
                        name: field,
                        type_name: ty.name(),
                        byte_offset: at,
                    });
                    i.byte_size = at + f.byte_size;
                }
                i.byte_size = i.byte_size.div_ceil(i.alignment) * i.alignment;
            }
        }
        self.table.insert(name, i.clone());
        Ok(i)
    }
    pub fn size(&self, t: &Ty) -> usize {
        self.table.get(&t.name()).map_or(0, |i| i.byte_size)
    }
    pub fn alignment(&self, t: &Ty) -> usize {
        self.table.get(&t.name()).map_or(1, |i| i.alignment)
    }
    pub fn field(&self, t: &Ty, name: &str) -> Option<(Ty, usize)> {
        let Ty::Struct(s) = t.bare() else { return None };
        let fields = self.structs.get(s)?;
        let (_, ty) = fields.iter().find(|(n, _)| n == name)?;
        let info = self
            .table
            .get(&t.name())
            .or_else(|| self.table.get(&Ty::Struct(s.clone()).name()))?;
        Some((
            if t.top_const() {
                Ty::Const(Box::new(ty.clone()))
            } else {
                ty.clone()
            },
            info.fields.iter().find(|f| f.name == name)?.byte_offset,
        ))
    }
    pub fn slots(&self, t: &Ty, offset: usize, out: &mut Vec<(usize, Ty)>) {
        match t.bare() {
            Ty::Array(base, n) => {
                for k in 0..*n {
                    self.slots(base, offset + k * self.size(base), out)
                }
            }
            Ty::Struct(_) => {
                if let Some(i) = self.table.get(&t.name()) {
                    for f in &i.fields {
                        if let Some(ty) = self.resolved.get(&f.type_name) {
                            self.slots(ty, offset + f.byte_offset, out)
                        }
                    }
                }
            }
            Ty::Void => {}
            _ => out.push((offset, t.clone())),
        }
    }
    pub fn slot(&self, t: &Ty, offset: usize) -> Option<Ty> {
        let result = match t.bare() {
            Ty::Array(base, n) => {
                let size = self.size(base);
                if size == 0 || offset >= size * n {
                    return None;
                }
                self.slot(base, offset % size)
            }
            Ty::Struct(_) => {
                let info = self.table.get(&t.name())?;
                let f = info.fields.iter().find(|f| {
                    self.resolved.get(&f.type_name).is_some_and(|ty| {
                        offset >= f.byte_offset && offset < f.byte_offset + self.size(ty)
                    })
                })?;
                self.slot(self.resolved.get(&f.type_name)?, offset - f.byte_offset)
            }
            Ty::Void => None,
            _ => {
                if offset == 0 {
                    Some(t.clone())
                } else {
                    None
                }
            }
        }?;
        Some(if t.top_const() && !result.top_const() {
            Ty::Const(Box::new(result))
        } else {
            result
        })
    }
}
