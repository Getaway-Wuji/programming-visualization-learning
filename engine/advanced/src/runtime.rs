//! Independently versioned C/C++ teaching memory and pointer interpreter.
//! It never translates C++ to C and never invokes a host compiler or process.

use crate::{
    budget::{BudgetError, Meter},
    codec,
    source::ByteRange,
    syntax::{self as syntax, Expr, Fault, Id, Init, Kind, Output, Program},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[cfg(feature = "cpp-course")]
#[path = "course.rs"]
pub mod course;

pub const EXEC_VERSION: &str = "1.4.0";
pub const DSL_VERSION: &str = "1.3.0";
pub const ENGINE_ID: &str = "engine.rust.advanced";
pub const STACK_LIMIT: usize = 32;
/// Simultaneously active interpreter call/block/statement/expression entries.
/// This independent bound closes the product of source nesting and call depth.
pub const EXECUTION_DEPTH_LIMIT: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    object_id: Option<String>,
    byte_offset: usize,
    lower_bound: usize,
    upper_bound: usize,
    pointee_type: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(untagged)]
enum Val {
    Int(i32),
    Text(String),
    Char { ascii: u8 },
    Pointer(Box<Pointer>),
}
impl Val {
    fn null(pointee: &str) -> Self {
        Self::Pointer(Box::new(Pointer {
            object_id: None,
            byte_offset: 0,
            lower_bound: 0,
            upper_bound: 0,
            pointee_type: pointee.into(),
        }))
    }
    fn truth(&self) -> bool {
        match self {
            Self::Int(n) => *n != 0,
            Self::Text(s) => !s.is_empty(),
            Self::Char { ascii } => *ascii != 0,
            Self::Pointer(p) => p.object_id.is_some(),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TypeInfo {
    name: String,
    kind: &'static str,
    byte_size: usize,
    pointee_type: Option<String>,
    fields: Vec<FieldInfo>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FieldInfo {
    name: String,
    type_name: String,
    byte_offset: usize,
}
fn pointer_name(name: &str) -> Option<&str> {
    name.strip_suffix('*')
}
fn type_info<'a>(types: &'a [TypeInfo], name: &str) -> Option<&'a TypeInfo> {
    types.iter().find(|t| t.name == name)
}
fn json_slot_type<'a>(object: &'a Value, offset: usize, types: &'a Value) -> Option<&'a str> {
    let name = object["typeName"].as_str()?;
    let ty = types.as_array()?.iter().find(|t| t["name"] == name)?;
    let relative = offset % ty["byteSize"].as_u64()? as usize;
    if ty["kind"] == "struct" {
        ty["fields"]
            .as_array()?
            .iter()
            .find(|f| f["byteOffset"] == relative)?
            .get("typeName")?
            .as_str()
    } else if relative == 0 {
        Some(name)
    } else {
        None
    }
}
fn default_cell(object: &Value, offset: usize, types: &Value) -> Value {
    if object["zeroInitialized"] != true {
        return Value::Null;
    }
    match json_slot_type(object, offset, types) {
        Some("int") => json!(0),
        Some(name) if pointer_name(name).is_some() => {
            serde_json::to_value(Val::null(pointer_name(name).unwrap())).unwrap()
        }
        _ => Value::Null,
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    #[serde(skip)]
    revision: usize,
    id: String,
    function_node_id: String,
    function_name: String,
    parent_frame_id: Option<String>,
    call_node_id: Option<String>,
    scope_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Scope {
    #[serde(skip)]
    revision: usize,
    id: String,
    frame_id: String,
    node_id: String,
    object_ids: Vec<String>,
    aliases: Vec<Alias>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Alias {
    name: String,
    object_id: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Object {
    #[serde(skip)]
    revision: usize,
    #[serde(skip)]
    last_write: Option<usize>,
    id: String,
    declaration_node_id: String,
    frame_id: Option<String>,
    scope_id: Option<String>,
    name: String,
    length: usize,
    base_address: u64,
    type_name: String,
    byte_length: usize,
    storage: &'static str,
    alive: bool,
    zero_initialized: bool,
    #[serde(skip)]
    is_array: bool,
    cells: Vec<Cell>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cell {
    byte_offset: usize,
    value: Val,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Ty {
    Int,
    Text,
    Char,
    Pointer(String),
    Struct(String),
    Array(String),
    Void,
    Null,
}
fn ty(name: &str, types: &[TypeInfo]) -> Option<Ty> {
    if name == "void" {
        return Some(Ty::Void);
    }
    type_info(types, name).map(|info| match info.kind {
        "int" => Ty::Int,
        "string" => Ty::Text,
        "pointer" => Ty::Pointer(info.pointee_type.clone().unwrap()),
        _ => Ty::Struct(name.into()),
    })
}
fn make_types(p: &Program, meter: &mut Meter) -> Result<Vec<TypeInfo>, Fault> {
    let mut names = BTreeSet::new();
    let mut types = vec![TypeInfo {
        name: "int".into(),
        kind: "int",
        byte_size: 4,
        pointee_type: None,
        fields: vec![],
    }];
    types.push(TypeInfo {
        name: "string".into(),
        kind: "string",
        byte_size: 32,
        pointee_type: None,
        fields: vec![],
    });
    for s in &p.structs {
        if s.name == "int" || s.name == "string" || !names.insert(s.name.clone()) {
            return Err(fault("E_DUPLICATE", p.nodes[s.node].range));
        }
    }
    for s in &p.structs {
        let mut fields = vec![];
        let mut seen = BTreeSet::new();
        let mut offset = 0;
        for f in &s.fields {
            meter
                .charge(1)
                .map_err(|e| budget(e, p.nodes[f.node].range))?;
            if !seen.insert(f.name.clone()) {
                return Err(fault("E_DUPLICATE", p.nodes[f.node].range));
            }
            let size = if f.type_name == "int" {
                4
            } else if let Some(target) = pointer_name(&f.type_name) {
                if target != "int" && !names.contains(target) {
                    return Err(fault("E_TYPE_INVALID", p.nodes[f.node].range));
                }
                8
            } else {
                return Err(fault("E_UNSUPPORTED_SYNTAX", p.nodes[f.node].range));
            };
            fields.push(FieldInfo {
                name: f.name.clone(),
                type_name: f.type_name.clone(),
                byte_offset: offset,
            });
            offset += size;
        }
        types.push(TypeInfo {
            name: s.name.clone(),
            kind: "struct",
            byte_size: offset,
            pointee_type: None,
            fields,
        });
    }
    for name in std::iter::once("int").chain(p.structs.iter().map(|s| s.name.as_str())) {
        types.push(TypeInfo {
            name: format!("{name}*"),
            kind: "pointer",
            byte_size: 8,
            pointee_type: Some(name.into()),
            fields: vec![],
        });
    }
    Ok(types)
}
struct Checker<'a, 'm> {
    p: &'a Program,
    types: &'a [TypeInfo],
    meter: &'m mut Meter,
    env: Vec<BTreeMap<String, Ty>>,
    function: usize,
    loops: usize,
}
impl Checker<'_, '_> {
    fn err(&self, code: &'static str, id: Id) -> Fault {
        fault(code, self.p.nodes[id].range)
    }
    fn tick(&mut self, id: Id) -> Result<(), Fault> {
        self.meter
            .charge(1)
            .map_err(|e| budget(e, self.p.nodes[id].range))
    }
    fn zero(&self, id: Id) -> bool {
        match &self.p.nodes[id].kind {
            Kind::Expr(Expr::Int(0)) => true,
            Kind::Expr(Expr::Unary { op, arg }) if op == "+" || op == "-" => {
                matches!(self.p.nodes[*arg].kind, Kind::Expr(Expr::Int(0)))
            }
            _ => false,
        }
    }
    fn compatible(&self, dest: &Ty, src: &Ty, source: Id) -> bool {
        dest == src
            || matches!((dest, src), (Ty::Int, Ty::Char))
            || matches!((dest, src), (Ty::Pointer(_), Ty::Null))
            || matches!(dest, Ty::Pointer(_)) && self.zero(source)
            || matches!((dest,src),(Ty::Pointer(a),Ty::Array(b)) if a==b && pointer_name(b).is_none())
    }
    fn scalar(&mut self, id: Id) -> Result<Ty, Fault> {
        let t = self.expr(id)?;
        if matches!(t, Ty::Int | Ty::Char | Ty::Pointer(_) | Ty::Null) {
            Ok(t)
        } else {
            Err(self.err("E_TYPE_INVALID", id))
        }
    }
    fn int(&mut self, id: Id) -> Result<(), Fault> {
        if matches!(self.expr(id)?, Ty::Int | Ty::Char) {
            Ok(())
        } else {
            Err(self.err("E_TYPE_INVALID", id))
        }
    }
    fn target(&mut self, id: Id) -> Result<Ty, Fault> {
        let valid = match &self.p.nodes[id].kind {
            Kind::Expr(Expr::Name(_) | Expr::Index { .. } | Expr::Member { .. }) => true,
            Kind::Expr(Expr::Unary { op, .. }) => op == "*",
            _ => false,
        };
        if !valid {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        if let Kind::Expr(Expr::Index { array, .. }) = self.p.nodes[id].kind.clone()
            && self.expr(array)? == Ty::Text
        {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        self.expr(id)
    }
    fn expr(&mut self, id: Id) -> Result<Ty, Fault> {
        self.tick(id)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Expr(Expr::Int(_)) => Ok(Ty::Int),
            Kind::Expr(Expr::Char(_)) => Ok(Ty::Char),
            Kind::Expr(Expr::Size(base)) => {
                if self.expr(base)? != Ty::Text {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ok(Ty::Int)
            }
            Kind::Expr(Expr::NullPointer) => Ok(Ty::Null),
            Kind::Expr(Expr::Name(n)) => self
                .env
                .iter()
                .rev()
                .find_map(|scope| scope.get(&n).cloned())
                .ok_or_else(|| self.err("E_UNDECLARED", id)),
            Kind::Expr(Expr::Index { array, index }) => {
                let t = self.expr(array)?;
                self.int(index)?;
                match t {
                    Ty::Text => Ok(Ty::Char),
                    Ty::Array(n) | Ty::Pointer(n) => {
                        ty(&n, self.types).ok_or_else(|| self.err("E_TYPE_INVALID", id))
                    }
                    _ => Err(self.err("E_TYPE_INVALID", id)),
                }
            }
            Kind::Expr(Expr::Member {
                base,
                field,
                indirect,
            }) => {
                let t = if indirect {
                    match self.expr(base)? {
                        Ty::Pointer(n) => n,
                        _ => return Err(self.err("E_TYPE_INVALID", id)),
                    }
                } else {
                    match self.target(base)? {
                        Ty::Struct(n) => n,
                        _ => return Err(self.err("E_TYPE_INVALID", id)),
                    }
                };
                let f = type_info(self.types, &t)
                    .and_then(|info| info.fields.iter().find(|f| f.name == field))
                    .ok_or_else(|| self.err("E_TYPE_INVALID", id))?;
                ty(&f.type_name, self.types).ok_or_else(|| self.err("E_TYPE_INVALID", id))
            }
            Kind::Expr(Expr::New { type_name, .. }) => match ty(&type_name, self.types) {
                Some(Ty::Int | Ty::Struct(_)) => Ok(Ty::Pointer(type_name)),
                _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
            },
            Kind::Expr(Expr::Unary { op, arg }) => match op.as_str() {
                "&" => {
                    let t = self.target(arg)?;
                    match t {
                        Ty::Int => Ok(Ty::Pointer("int".into())),
                        Ty::Struct(n) => Ok(Ty::Pointer(n)),
                        _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
                    }
                }
                "*" => match self.expr(arg)? {
                    Ty::Pointer(n) => {
                        ty(&n, self.types).ok_or_else(|| self.err("E_TYPE_INVALID", id))
                    }
                    _ => Err(self.err("E_TYPE_INVALID", id)),
                },
                "!" => {
                    self.scalar(arg)?;
                    Ok(Ty::Int)
                }
                "+" | "-" => {
                    self.int(arg)?;
                    Ok(Ty::Int)
                }
                _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
            },
            Kind::Expr(Expr::Binary { op, left, right }) => {
                let a = self.expr(left)?;
                let b = self.expr(right)?;
                let decay = |t: Ty| match t {
                    Ty::Array(n) if pointer_name(&n).is_none() => Ty::Pointer(n),
                    other => other,
                };
                let promote = |t| if t == Ty::Char { Ty::Int } else { t };
                let a = promote(decay(a));
                let b = promote(decay(b));
                if op == "&&" || op == "||" {
                    if matches!(a, Ty::Int | Ty::Pointer(_) | Ty::Null)
                        && matches!(b, Ty::Int | Ty::Pointer(_) | Ty::Null)
                    {
                        return Ok(Ty::Int);
                    }
                } else if op == "==" || op == "!=" {
                    if a == Ty::Int && b == Ty::Int
                        || matches!((&a,&b),(Ty::Pointer(x),Ty::Pointer(y)) if x==y)
                        || matches!(&a, Ty::Pointer(_)) && (b == Ty::Null || self.zero(right))
                        || matches!(&b, Ty::Pointer(_)) && (a == Ty::Null || self.zero(left))
                        || a == Ty::Null && b == Ty::Null
                    {
                        return Ok(Ty::Int);
                    }
                } else if (op == "+" || op == "-") && matches!(a, Ty::Pointer(_)) && b == Ty::Int {
                    return Ok(a);
                } else if op == "+" && a == Ty::Int && matches!(b, Ty::Pointer(_)) {
                    return Ok(b);
                } else if a == Ty::Int && b == Ty::Int {
                    return Ok(Ty::Int);
                }
                Err(self.err("E_TYPE_INVALID", id))
            }
            Kind::Expr(Expr::Call { name, args }) => {
                if self.env.iter().rev().any(|s| s.contains_key(&name)) {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                let target = self
                    .p
                    .functions
                    .iter()
                    .position(|f| f.name == name)
                    .ok_or_else(|| self.err("E_UNDECLARED", id))?;
                if target > self.function || name == "main" {
                    return Err(self.err("E_UNDECLARED", id));
                }
                let f = self.p.functions[target].clone();
                if args.len() != f.params.len() {
                    return Err(self.err("E_ARGUMENTS", id));
                }
                for (arg, param) in args.iter().zip(f.params) {
                    #[cfg(feature = "cpp-course")]
                    if param.by_reference {
                        if !matches!(self.p.nodes[*arg].kind, Kind::Expr(Expr::Name(_)))
                            || self.target(*arg)? != Ty::Int
                        {
                            return Err(self.err("E_TYPE_INVALID", *arg));
                        }
                        continue;
                    }
                    let expected = if param.is_array {
                        Ty::Array(param.type_name.clone())
                    } else {
                        ty(&param.type_name, self.types)
                            .ok_or_else(|| self.err("E_TYPE_INVALID", param.node))?
                    };
                    let actual = self.expr(*arg)?;
                    if !self.compatible(&expected, &actual, *arg) {
                        return Err(self.err("E_TYPE_INVALID", *arg));
                    }
                }
                ty(&f.return_type, self.types).ok_or_else(|| self.err("E_TYPE_INVALID", id))
            }
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn stmt(&mut self, id: Id, root: bool) -> Result<(), Fault> {
        self.tick(id)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Block(ids) => {
                if !root {
                    self.env.push(BTreeMap::new());
                }
                for child in ids {
                    self.stmt(child, false)?;
                }
                if !root {
                    self.env.pop();
                }
            }
            Kind::Declare {
                name,
                type_name,
                length,
                init,
            } => {
                if self.env.last().unwrap().contains_key(&name) {
                    return Err(self.err("E_DUPLICATE", id));
                }
                let base =
                    ty(&type_name, self.types).ok_or_else(|| self.err("E_TYPE_INVALID", id))?;
                if base == Ty::Text && (length.is_some() || !matches!(init, Init::None)) {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                if base == Ty::Void {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                let dest = if length.is_some() {
                    Ty::Array(type_name.clone())
                } else {
                    base.clone()
                };
                self.env.last_mut().unwrap().insert(name, dest);
                match init {
                    Init::None | Init::Zero => {}
                    Init::Scalar(expr) => {
                        let src = self.expr(expr)?;
                        if length.is_some()
                            || matches!(base, Ty::Struct(_))
                            || !self.compatible(&base, &src, expr)
                        {
                            return Err(self.err("E_TYPE_INVALID", expr));
                        }
                    }
                    Init::Array(ids) => {
                        if length.is_none()
                            || ids.len() > length.unwrap()
                            || matches!(base, Ty::Struct(_))
                        {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        for expr in ids {
                            let literal = matches!(
                                self.p.nodes[expr].kind,
                                Kind::Expr(Expr::Int(_) | Expr::NullPointer)
                            ) || matches!(&self.p.nodes[expr].kind,Kind::Expr(Expr::Unary{op,arg}) if (op=="+"||op=="-")&&matches!(self.p.nodes[*arg].kind,Kind::Expr(Expr::Int(_))));
                            if !literal {
                                return Err(self.err("E_UNSUPPORTED_SYNTAX", expr));
                            }
                            let src = self.expr(expr)?;
                            if !self.compatible(&base, &src, expr) {
                                return Err(self.err("E_TYPE_INVALID", expr));
                            }
                        }
                    }
                }
            }
            Kind::Assign { target, value } => {
                let dest = self.target(target)?;
                let src = self.expr(value)?;
                if matches!(dest, Ty::Struct(_) | Ty::Array(_) | Ty::Void)
                    || !self.compatible(&dest, &src, value)
                {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::If { condition, yes, no } => {
                self.scalar(condition)?;
                self.stmt(yes, false)?;
                if let Some(no) = no {
                    self.stmt(no, false)?;
                }
            }
            Kind::While { condition, body } => {
                self.scalar(condition)?;
                self.loops += 1;
                self.stmt(body, false)?;
                self.loops -= 1;
            }
            #[cfg(feature = "cpp-course")]
            Kind::DoWhile { body, condition } => {
                self.loops += 1;
                self.stmt(body, false)?;
                self.loops -= 1;
                self.scalar(condition)?;
            }
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                self.env.push(BTreeMap::new());
                if let Some(init) = init {
                    self.stmt(init, false)?;
                }
                if let Some(c) = condition {
                    self.scalar(c)?;
                }
                if let Some(u) = update {
                    self.stmt(u, false)?;
                }
                self.loops += 1;
                self.stmt(body, false)?;
                self.loops -= 1;
                self.env.pop();
            }
            Kind::Return(value) => {
                let dest = ty(&self.p.functions[self.function].return_type, self.types).unwrap();
                if let Some(value) = value {
                    let src = self.expr(value)?;
                    if dest == Ty::Void || !self.compatible(&dest, &src, value) {
                        return Err(self.err("E_TYPE_INVALID", id));
                    }
                } else if dest != Ty::Void {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::Delete(expr) => {
                let t = self.expr(expr)?;
                if !matches!(t, Ty::Pointer(_)) {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::Break | Kind::Continue => {
                if self.loops == 0 {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::ExprStmt(expr) => {
                if !matches!(
                    self.p.nodes[expr].kind,
                    Kind::Expr(Expr::Call { .. } | Expr::New { .. })
                ) {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                self.expr(expr)?;
            }
            Kind::Print { format, args } => {
                let mut count = 0;
                let mut chars = format.chars();
                while let Some(ch) = chars.next() {
                    if ch == '%' {
                        match chars.next() {
                            Some('d') => count += 1,
                            Some('%') => {}
                            _ => return Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
                        }
                    }
                }
                if count != args.len() {
                    return Err(self.err("E_ARGUMENTS", id));
                }
                for arg in args {
                    self.int(arg)?;
                }
            }
            Kind::Cout(parts) => {
                for part in parts {
                    if let Output::Expr(e) = part
                        && !matches!(self.expr(e)?, Ty::Int | Ty::Char | Ty::Text)
                    {
                        return Err(self.err("E_TYPE_INVALID", e));
                    }
                }
            }
            Kind::Getline(target) => {
                if self.target(target)? != Ty::Text {
                    return Err(self.err("E_TYPE_INVALID", target));
                }
            }
            Kind::Scanf(target) => {
                if self.target(target)? != Ty::Int {
                    return Err(self.err("E_TYPE_INVALID", target));
                }
            }
            Kind::Cin(targets) => {
                for target in targets {
                    if self.target(target)? != Ty::Int {
                        return Err(self.err("E_TYPE_INVALID", target));
                    }
                }
            }
            Kind::Empty => {}
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        }
        Ok(())
    }
}
fn check(p: &Program, types: &[TypeInfo], meter: &mut Meter) -> Result<(), Fault> {
    let mut names = BTreeSet::new();
    for (index, f) in p.functions.iter().enumerate() {
        if !names.insert(&f.name) {
            return Err(fault("E_DUPLICATE", p.nodes[f.node].range));
        }
        let result = ty(&f.return_type, types)
            .ok_or_else(|| fault("E_TYPE_INVALID", p.nodes[f.node].range))?;
        if matches!(result, Ty::Struct(_) | Ty::Array(_))
            || f.name == "main" && (result != Ty::Int || !f.params.is_empty())
        {
            return Err(fault("E_TYPE_INVALID", p.nodes[f.node].range));
        }
        let mut env = BTreeMap::new();
        for param in &f.params {
            let base = ty(&param.type_name, types)
                .ok_or_else(|| fault("E_TYPE_INVALID", p.nodes[param.node].range))?;
            if base == Ty::Void || matches!(base, Ty::Struct(_)) && !param.is_array {
                return Err(fault("E_UNSUPPORTED_SYNTAX", p.nodes[param.node].range));
            }
            let t = if param.is_array {
                Ty::Array(param.type_name.clone())
            } else {
                base
            };
            if env.insert(param.name.clone(), t).is_some() {
                return Err(fault("E_DUPLICATE", p.nodes[param.node].range));
            }
        }
        let mut c = Checker {
            p,
            types,
            meter,
            env: vec![env],
            function: index,
            loops: 0,
        };
        c.stmt(f.body, true)?;
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Control {
    active_frame_id: Option<String>,
    next_node_id: Option<String>,
    return_value: Option<Val>,
    input_cursor: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Allocator {
    next_address: u64,
    live_bytes: usize,
    next_object: usize,
    next_scope: usize,
    next_frame: usize,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Counters {
    comparisons: usize,
    scalar_writes: usize,
    array_writes: usize,
    swaps: usize,
}
#[derive(Clone, Debug, Serialize)]
struct State {
    #[serde(skip)]
    dirty_frames: BTreeSet<usize>,
    #[serde(skip)]
    dirty_scopes: BTreeSet<usize>,
    #[serde(skip)]
    dirty_objects: BTreeSet<usize>,
    frames: Vec<Frame>,
    scopes: Vec<Scope>,
    objects: Vec<Object>,
    control: Control,
    allocator: Allocator,
    output: String,
    counters: Counters,
}
impl State {
    fn new(main: Id) -> Self {
        Self {
            dirty_frames: BTreeSet::new(),
            dirty_scopes: BTreeSet::new(),
            dirty_objects: BTreeSet::new(),
            frames: vec![],
            scopes: vec![],
            objects: vec![],
            control: Control {
                active_frame_id: None,
                next_node_id: Some(nid(main)),
                return_value: None,
                input_cursor: 0,
            },
            allocator: Allocator {
                next_address: 4096,
                live_bytes: 0,
                next_object: 1,
                next_scope: 1,
                next_frame: 1,
            },
            output: String::new(),
            counters: Counters::default(),
        }
    }
}
fn nid(id: Id) -> String {
    format!("n{}", id + 1)
}
fn fault(code: &'static str, byte_range: ByteRange) -> Fault {
    Fault { code, byte_range }
}
fn budget(error: BudgetError, range: ByteRange) -> Fault {
    fault(
        match error {
            BudgetError::Cancelled => "E_CANCELLED",
            BudgetError::Deadline { .. } => "E_DEADLINE",
            _ => "E_FUEL_LIMIT",
        },
        range,
    )
}
fn codec_fault(error: codec::CodecError, range: ByteRange) -> Fault {
    match error {
        codec::CodecError::Budget(e) => budget(e, range),
        codec::CodecError::Limit { .. } => fault("E_RESULT_LIMIT", range),
        _ => fault("E_ENCODING_FAILURE", range),
    }
}

struct Recording {
    initial: Vec<u8>,
    current: Value,
    steps: Vec<Vec<u8>>,
    checkpoints: Vec<Vec<u8>>,
    bytes: usize,
    metadata_bytes: usize,
    types: Value,
    frame_versions: Vec<usize>,
    scope_versions: Vec<usize>,
    object_versions: Vec<usize>,
    #[cfg(feature = "cpp-course")]
    course_limits: Option<course::CaseLimits>,
}
impl Recording {
    fn new(
        state: &State,
        metadata_bytes: usize,
        types: &Value,
        meter: &mut Meter,
        range: ByteRange,
    ) -> Result<Self, Fault> {
        let initial = serde_json::to_value(state).unwrap();
        let point = codec::encode(
            &json!({"cursor":0,"state":initial}),
            meter,
            meter.limits().result_bytes,
        )
        .map_err(|e| codec_fault(e, range))?;
        let initial_bytes = codec::encode(&initial, meter, meter.limits().result_bytes)
            .map_err(|e| codec_fault(e, range))?;
        let bytes = metadata_bytes + initial_bytes.len() + point.len() + 8192;
        if bytes > meter.limits().result_bytes.saturating_sub(65536) {
            return Err(fault("E_RESULT_LIMIT", range));
        }
        meter
            .reserve_result(bytes + metadata_bytes)
            .map_err(|e| budget(e, range))?;
        Ok(Self {
            current: initial.clone(),
            initial: initial_bytes,
            steps: vec![],
            checkpoints: vec![point],
            bytes,
            metadata_bytes,
            types: types.clone(),
            frame_versions: vec![],
            scope_versions: vec![],
            object_versions: vec![],
            #[cfg(feature = "cpp-course")]
            course_limits: None,
        })
    }
    fn emit(
        &mut self,
        state: &State,
        node: Id,
        kind: &str,
        meter: &mut Meter,
        range: ByteRange,
    ) -> Result<(), Fault> {
        let step_limit = meter.limits().steps;
        #[cfg(feature = "cpp-course")]
        let step_limit = self.course_limits.map_or(step_limit, |limits| limits.steps);
        if self.steps.len() >= step_limit {
            return Err(fault("E_STEP_LIMIT", range));
        }
        meter.check_commit().map_err(|e| budget(e, range))?;
        let mut changes = table_changes(
            "objects",
            &state.objects,
            &self.current["objects"],
            &self.object_versions,
            &state.dirty_objects,
            (meter, range),
            &self.types,
        )?;
        changes.extend(table_changes(
            "scopes",
            &state.scopes,
            &self.current["scopes"],
            &self.scope_versions,
            &state.dirty_scopes,
            (meter, range),
            &self.types,
        )?);
        changes.extend(table_changes(
            "frames",
            &state.frames,
            &self.current["frames"],
            &self.frame_versions,
            &state.dirty_frames,
            (meter, range),
            &self.types,
        )?);
        for (op, value) in [
            ("control", serde_json::to_value(&state.control).unwrap()),
            ("allocator", serde_json::to_value(&state.allocator).unwrap()),
            ("counters", serde_json::to_value(&state.counters).unwrap()),
        ] {
            meter.charge(1).map_err(|e| budget(e, range))?;
            if self.current[op] != value {
                changes.push(json!({"op":op,"before":self.current[op],"after":value}));
            }
        }
        let old_output = self.current["output"].as_str().unwrap();
        if old_output.len() != state.output.len() {
            let append = &state.output[old_output.len()..];
            meter
                .charge(append.len().div_ceil(64))
                .map_err(|e| budget(e, range))?;
            changes.push(json!({"op":"output","beforeBytes":old_output.len(),"afterBytes":state.output.len(),"append":append}));
        }
        let step =
            json!({"seq":self.steps.len()+1,"kind":kind,"nodeId":nid(node),"changes":changes});
        let checkpoint = if (self.steps.len() + 1).is_multiple_of(128) {
            let size = state.frames.len()
                + state.scopes.len()
                + state
                    .objects
                    .iter()
                    .map(|o| 1 + o.cells.len())
                    .sum::<usize>();
            meter
                .charge(size + state.output.len().div_ceil(64))
                .map_err(|e| budget(e, range))?;
            let mut after = self.current.clone();
            apply_changes_inner(
                &mut after,
                step["changes"].as_array().unwrap(),
                false,
                &self.types,
            )
            .expect("trusted checkpoint delta");
            Some(json!({"cursor":self.steps.len()+1,"state":after}))
        } else {
            None
        };
        let step_bytes = codec::encode(&step, meter, meter.limits().result_bytes)
            .map_err(|e| codec_fault(e, range))?;
        let point_bytes = checkpoint
            .as_ref()
            .map(|point| {
                codec::encode(point, meter, meter.limits().result_bytes)
                    .map_err(|e| codec_fault(e, range))
            })
            .transpose()?;
        let bytes = step_bytes.len() + 1 + point_bytes.as_ref().map_or(0, |point| point.len() + 1);
        let packet_limit = meter.limits().result_bytes;
        #[cfg(feature = "cpp-course")]
        let packet_limit = self
            .course_limits
            .map_or(packet_limit, |limits| limits.bytes);
        if self.bytes.saturating_add(bytes) > packet_limit.saturating_sub(65536) {
            return Err(fault("E_RESULT_LIMIT", range));
        }
        meter
            .reserve_result(self.bytes + bytes + self.metadata_bytes)
            .map_err(|e| budget(e, range))?;
        meter.check_commit().map_err(|e| budget(e, range))?;
        self.bytes += bytes;
        apply_changes_inner(
            &mut self.current,
            step["changes"].as_array().unwrap(),
            false,
            &self.types,
        )
        .expect("trusted committed delta");
        sync_versions(&state.frames, &mut self.frame_versions, &state.dirty_frames);
        sync_versions(&state.scopes, &mut self.scope_versions, &state.dirty_scopes);
        sync_versions(
            &state.objects,
            &mut self.object_versions,
            &state.dirty_objects,
        );
        self.steps.push(step_bytes);
        if let Some(point) = point_bytes {
            self.checkpoints.push(point);
        }
        Ok(())
    }
    fn write(
        &self,
        complete: bool,
        out: &mut codec::Assembly,
        meter: &mut Meter,
    ) -> Result<(), codec::CodecError> {
        out.append(b"{\"checkpoints\":[", meter)?;
        for (at, point) in self.checkpoints.iter().enumerate() {
            if at > 0 {
                out.append(b",", meter)?;
            }
            out.append(point, meter)?;
        }
        out.append(
            if complete {
                b"],\"completeness\":\"complete\",\"dslVersion\":\"1.3.0\",\"initialState\":"
            } else {
                b"],\"completeness\":\"prefix\",\"dslVersion\":\"1.3.0\",\"initialState\":"
            },
            meter,
        )?;
        out.append(&self.initial, meter)?;
        out.append(b",\"steps\":[", meter)?;
        for (at, step) in self.steps.iter().enumerate() {
            if at > 0 {
                out.append(b",", meter)?;
            }
            out.append(step, meter)?;
        }
        out.append(b"]}", meter)
    }
}
fn effective(object: &Value, index: usize, types: &Value) -> Value {
    let cells = object["cells"].as_array().unwrap();
    cells
        .binary_search_by_key(&index, |c| c["byteOffset"].as_u64().unwrap() as usize)
        .ok()
        .map_or_else(
            || default_cell(object, index, types),
            |at| cells[at]["value"].clone(),
        )
}
trait Versioned: Serialize {
    fn id(&self) -> &str;
    fn revision(&self) -> usize;
    fn weight(&self) -> usize {
        1
    }
    fn cell_update(&self) -> Option<(usize, Option<Value>)> {
        None
    }
}
impl Versioned for Frame {
    fn id(&self) -> &str {
        &self.id
    }
    fn revision(&self) -> usize {
        self.revision
    }
    fn weight(&self) -> usize {
        1 + self.scope_ids.len()
    }
}
impl Versioned for Scope {
    fn id(&self) -> &str {
        &self.id
    }
    fn revision(&self) -> usize {
        self.revision
    }
    fn weight(&self) -> usize {
        1 + self.object_ids.len() + self.aliases.len()
    }
}
impl Versioned for Object {
    fn id(&self) -> &str {
        &self.id
    }
    fn revision(&self) -> usize {
        self.revision
    }
    fn weight(&self) -> usize {
        1 + self.cells.len()
    }
    fn cell_update(&self) -> Option<(usize, Option<Value>)> {
        self.last_write.map(|offset| {
            (
                offset,
                self.cells
                    .binary_search_by_key(&offset, |c| c.byte_offset)
                    .ok()
                    .map(|index| serde_json::to_value(&self.cells[index].value).unwrap()),
            )
        })
    }
}
fn sync_versions<T: Versioned>(rows: &[T], versions: &mut Vec<usize>, dirty: &BTreeSet<usize>) {
    versions.truncate(rows.len());
    let length = versions.len();
    versions.extend(rows.iter().skip(length).map(Versioned::revision));
    for &at in dirty {
        if at < rows.len() {
            versions[at] = rows[at].revision();
        }
    }
}
fn table_changes<T: Versioned>(
    table: &str,
    rows: &[T],
    old: &Value,
    versions: &[usize],
    dirty: &BTreeSet<usize>,
    measurement: (&mut Meter, ByteRange),
    types: &Value,
) -> Result<Vec<Value>, Fault> {
    let (meter, range) = measurement;
    let old = old.as_array().unwrap();
    // Scope/frame storage is a stack. Only explicitly dirtied records and the
    // appended/removed suffix need visiting; stable ancestor data is borrowed.
    let common = old.len().min(rows.len());
    meter
        .charge(dirty.len() + old.len().abs_diff(rows.len()))
        .map_err(|e| budget(e, range))?;
    let mut changes = vec![];
    for at in (common..old.len()).rev() {
        let record = &old[at];
        meter
            .charge(record["cells"].as_array().map_or(1, |c| 1 + c.len()))
            .map_err(|e| budget(e, range))?;
        changes.push(json!({"op":"record","table":table,"id":record["id"],"index":at,"before":record,"after":null}));
    }
    let changed: BTreeSet<usize> = dirty
        .iter()
        .copied()
        .filter(|at| *at < rows.len())
        .chain(common..rows.len())
        .collect();
    for at in changed {
        let row = &rows[at];
        assert!(
            at >= common || old[at]["id"].as_str() == Some(row.id()),
            "stable stack record identity"
        );
        if at < common && versions.get(at) == Some(&row.revision()) {
            continue;
        }
        if at < common
            && versions
                .get(at)
                .is_some_and(|v| v.checked_add(1) == Some(row.revision()))
            && let Some((index, value)) = row.cell_update()
        {
            let cells = old[at]["cells"].as_array().unwrap();
            meter
                .charge(1 + cells.len().checked_ilog2().unwrap_or(0) as usize)
                .map_err(|e| budget(e, range))?;
            let previous = effective(&old[at], index, types);
            let value = value.unwrap_or_else(|| default_cell(&old[at], index, types));
            if previous != value {
                changes.push(json!({"op":"cell","objectId":row.id(),"byteOffset":index,"before":previous,"after":value}));
            }
            continue;
        }
        meter.charge(row.weight()).map_err(|e| budget(e, range))?;
        let new = serde_json::to_value(row).unwrap();
        if at >= common {
            changes.push(json!({"op":"record","table":table,"id":row.id(),"index":at,"before":null,"after":new}));
            continue;
        }
        let previous = &old[at];
        if previous == &new {
            continue;
        }
        if table == "objects"
            && previous["alive"] == new["alive"]
            && previous["zeroInitialized"] == new["zeroInitialized"]
        {
            let old_cells: BTreeMap<usize, &Value> = previous["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| (c["byteOffset"].as_u64().unwrap() as usize, &c["value"]))
                .collect();
            let new_cells: BTreeMap<usize, &Value> = new["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| (c["byteOffset"].as_u64().unwrap() as usize, &c["value"]))
                .collect();
            let work = old_cells.len() + new_cells.len();
            meter
                .charge(work.saturating_mul(1 + work.checked_ilog2().unwrap_or(0) as usize))
                .map_err(|e| budget(e, range))?;
            let indices: BTreeSet<_> = old_cells.keys().chain(new_cells.keys()).copied().collect();
            for index in indices {
                let a = old_cells
                    .get(&index)
                    .copied()
                    .cloned()
                    .unwrap_or_else(|| default_cell(previous, index, types));
                let b = new_cells
                    .get(&index)
                    .copied()
                    .cloned()
                    .unwrap_or_else(|| default_cell(&new, index, types));
                if a != b {
                    changes.push(
                        json!({"op":"cell","objectId":row.id(),"byteOffset":index,"before":a,"after":b}),
                    );
                }
            }
        } else {
            changes.push(json!({"op":"record","table":table,"id":row.id(),"index":at,"before":previous,"after":new}));
        }
    }
    Ok(changes)
}
pub fn apply_changes(
    state: &mut Value,
    changes: &[Value],
    reverse: bool,
    types: &Value,
) -> Result<(), &'static str> {
    let mut next = state.clone();
    apply_changes_inner(&mut next, changes, reverse, types)?;
    *state = next;
    Ok(())
}
/// Test/replay helper. It applies recorded deltas only and never interprets code.
fn apply_changes_inner(
    state: &mut Value,
    changes: &[Value],
    reverse: bool,
    types: &Value,
) -> Result<(), &'static str> {
    let next = state;
    let order: Vec<_> = if reverse {
        changes.iter().rev().collect()
    } else {
        changes.iter().collect()
    };
    for c in order {
        let (a, b) = if reverse {
            (&c["after"], &c["before"])
        } else {
            (&c["before"], &c["after"])
        };
        match c["op"].as_str() {
            Some("record") => {
                let table = c["table"].as_str().ok_or("table")?;
                if !["frames", "scopes", "objects"].contains(&table) {
                    return Err("table");
                };
                let rows = next[table].as_array_mut().ok_or("rows")?;
                let at = c["index"].as_u64().ok_or("index")? as usize;
                if at > rows.len() {
                    return Err("index");
                };
                if a.is_null() {
                    if rows.iter().any(|r| r["id"] == c["id"]) {
                        return Err("duplicate");
                    };
                    rows.insert(at, b.clone());
                } else {
                    if rows.get(at) != Some(a) {
                        return Err("before");
                    };
                    if b.is_null() {
                        rows.remove(at);
                    } else {
                        rows[at] = b.clone();
                    }
                }
            }
            Some("cell") => {
                let object = next["objects"]
                    .as_array_mut()
                    .ok_or("objects")?
                    .iter_mut()
                    .find(|o| o["id"] == c["objectId"])
                    .ok_or("object")?;
                let index = c["byteOffset"].as_u64().ok_or("index")? as usize;
                if index >= object["byteLength"].as_u64().ok_or("length")? as usize
                    || effective(object, index, types) != *a
                {
                    return Err("cell before");
                };
                let default = default_cell(object, index, types);
                let cells = object["cells"].as_array_mut().ok_or("cells")?;
                if let Some(at) = cells.iter().position(|cell| cell["byteOffset"] == index) {
                    cells.remove(at);
                }
                if *b != default {
                    cells.push(json!({"byteOffset":index,"value":b}));
                    cells.sort_by_key(|cell| cell["byteOffset"].as_u64().unwrap());
                }
            }
            Some("control" | "allocator" | "counters") => {
                let op = c["op"].as_str().unwrap();
                if next[op] != *a {
                    return Err("singleton before");
                };
                next[op] = b.clone();
            }
            Some("output") => {
                let text = next["output"].as_str().ok_or("output")?;
                let append = c["append"].as_str().ok_or("append")?;
                let before = c["beforeBytes"].as_u64().ok_or("bytes")? as usize;
                let after = c["afterBytes"].as_u64().ok_or("bytes")? as usize;
                if after.checked_sub(before) != Some(append.len()) {
                    return Err("output bytes");
                };
                next["output"] = if reverse {
                    if text.len() != after || !text.ends_with(append) {
                        return Err("output before");
                    };
                    json!(text.get(..before).ok_or("utf8")?)
                } else {
                    if text.len() != before {
                        return Err("output before");
                    };
                    json!(format!("{text}{append}"))
                };
            }
            _ => return Err("op"),
        }
    }

    Ok(())
}

enum Flow {
    Next,
    Return(Option<Val>, Id),
    Break,
    Continue,
}
enum Argument {
    Value(Val),
    Array(String),
}
#[derive(Clone)]
struct Place {
    object: usize,
    offset: usize,
    type_name: String,
    lower: usize,
    upper: usize,
}
struct Runtime<'a, 'm> {
    p: &'a Program,
    types: &'a [TypeInfo],
    meter: &'m mut Meter,
    input: &'a [i32],
    lines: &'a [String],
    cpp: bool,
    depth: usize,
    active_heap: usize,
    state: State,
    record: Recording,
    bug_observations: Option<crate::bug::Observations>,
}
impl Runtime<'_, '_> {
    fn guarded<T>(
        &mut self,
        id: Id,
        work: impl FnOnce(&mut Self) -> Result<T, Fault>,
    ) -> Result<T, Fault> {
        if self.depth >= EXECUTION_DEPTH_LIMIT {
            return Err(self.err("E_DEPTH_LIMIT", id));
        }
        self.depth += 1;
        let result = work(self);
        self.depth -= 1;
        result
    }
    fn err(&self, code: &'static str, id: Id) -> Fault {
        fault(code, self.p.nodes[id].range)
    }
    fn tick(&mut self, id: Id, units: usize) -> Result<(), Fault> {
        self.meter
            .charge(units)
            .map_err(|e| budget(e, self.p.nodes[id].range))
    }
    fn emit(&mut self, id: Id, kind: &str) -> Result<(), Fault> {
        #[cfg(feature = "cpp-course")]
        let kind = if self.record.course_limits.is_some() {
            match kind {
                "memory.allocate" => "advanced.allocate",
                "memory.release" => "advanced.release",
                _ => kind,
            }
        } else {
            kind
        };
        self.state.control.next_node_id = Some(nid(id));
        let result = self
            .record
            .emit(&self.state, id, kind, self.meter, self.p.nodes[id].range);
        if result.is_ok() {
            self.state.dirty_frames.clear();
            self.state.dirty_scopes.clear();
            self.state.dirty_objects.clear();
        }
        result
    }
    fn size(&self, name: &str) -> usize {
        type_info(self.types, name).expect("checked type").byte_size
    }
    fn object_id(&self, id: &str) -> Option<usize> {
        let n = id
            .strip_prefix('o')?
            .parse::<usize>()
            .ok()?
            .checked_sub(1)?;
        self.state.objects.get(n).filter(|o| o.id == id).map(|_| n)
    }
    fn object_index(&mut self, name: &str, id: Id) -> Result<usize, Fault> {
        let frame = self
            .state
            .frames
            .last()
            .ok_or_else(|| self.err("E_UNDECLARED", id))?;
        for sid in frame.scope_ids.iter().rev() {
            let scope = self.state.scopes.iter().find(|s| s.id == *sid).unwrap();
            if let Some(alias) = scope.aliases.iter().find(|a| a.name == name) {
                return self
                    .object_id(&alias.object_id)
                    .ok_or_else(|| self.err("E_UNDECLARED", id));
            }
            for oid in &scope.object_ids {
                let at = self.object_id(oid).unwrap();
                let o = &self.state.objects[at];
                if o.alive && o.name == name {
                    return Ok(at);
                }
            }
        }
        Err(self.err("E_UNDECLARED", id))
    }
    fn array(&mut self, id: Id) -> Result<usize, Fault> {
        if let Kind::Expr(Expr::Name(name)) = &self.p.nodes[id].kind {
            let at = self.object_index(&name.clone(), id)?;
            if self.state.objects[at].is_array {
                return Ok(at);
            }
        }
        Err(self.err("E_TYPE_INVALID", id))
    }
    fn pointer_for(&self, place: &Place) -> Pointer {
        Pointer {
            object_id: Some(self.state.objects[place.object].id.clone()),
            byte_offset: place.offset,
            lower_bound: place.lower,
            upper_bound: place.upper,
            pointee_type: place.type_name.clone(),
        }
    }
    fn array_pointer(&self, at: usize) -> Pointer {
        let o = &self.state.objects[at];
        Pointer {
            object_id: Some(o.id.clone()),
            byte_offset: 0,
            lower_bound: 0,
            upper_bound: o.byte_length,
            pointee_type: o.type_name.clone(),
        }
    }
    fn pointer(&self, value: Val, id: Id) -> Result<Pointer, Fault> {
        match value {
            Val::Pointer(p) => Ok(*p),
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn int(&self, value: Val, id: Id) -> Result<i32, Fault> {
        match value {
            Val::Int(n) => Ok(n),
            Val::Char { ascii } => Ok(i32::from(ascii)),
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn convert(&self, value: Val, dest: &str, id: Id) -> Result<Val, Fault> {
        if dest == "string" {
            return match value {
                Val::Text(_) => Ok(value),
                _ => Err(self.err("E_TYPE_INVALID", id)),
            };
        }
        if dest == "int" {
            return match value {
                Val::Int(_) => Ok(value),
                Val::Char { ascii } => Ok(Val::Int(i32::from(ascii))),
                _ => Err(self.err("E_TYPE_INVALID", id)),
            };
        }
        if let Some(target) = pointer_name(dest) {
            return match value {
                Val::Int(0) => Ok(Val::null(target)),
                Val::Pointer(p)
                    if p.object_id.is_none()
                        && (p.pointee_type.is_empty() || p.pointee_type == target) =>
                {
                    Ok(Val::null(target))
                }
                Val::Pointer(p) if p.pointee_type == target => Ok(Val::Pointer(p)),
                _ => Err(self.err("E_TYPE_INVALID", id)),
            };
        }
        Err(self.err("E_TYPE_INVALID", id))
    }
    fn slot_type<'a>(&'a self, object: &Object, offset: usize) -> Option<&'a str> {
        let info = type_info(self.types, &object.type_name)?;
        let relative = offset % info.byte_size;
        if info.kind == "struct" {
            info.fields
                .iter()
                .find(|f| f.byte_offset == relative)
                .map(|f| f.type_name.as_str())
        } else if relative == 0 {
            Some(info.name.as_str())
        } else {
            None
        }
    }
    fn resolve(&self, p: Pointer, id: Id, allow_past: bool) -> Result<Place, Fault> {
        let oid = p
            .object_id
            .as_ref()
            .ok_or_else(|| self.err("E_NULL_POINTER", id))?;
        let at = self
            .object_id(oid)
            .ok_or_else(|| self.err("E_DANGLING_POINTER", id))?;
        let object = &self.state.objects[at];
        if !object.alive {
            return Err(self.err("E_DANGLING_POINTER", id));
        }
        let size = self.size(&p.pointee_type);
        if p.lower_bound > p.byte_offset
            || p.byte_offset > p.upper_bound
            || p.upper_bound > object.byte_length
            || p.lower_bound > p.upper_bound
            || (!allow_past || p.byte_offset != p.upper_bound)
                && p.byte_offset
                    .checked_add(size)
                    .is_none_or(|end| end > p.upper_bound)
        {
            return Err(self.err("E_POINTER_BOUNDS", id));
        }
        if p.byte_offset != p.upper_bound {
            let matching = if type_info(self.types, &p.pointee_type).unwrap().kind == "struct" {
                object.type_name == p.pointee_type && p.byte_offset.is_multiple_of(size)
            } else {
                self.slot_type(object, p.byte_offset) == Some(p.pointee_type.as_str())
            };
            if !matching {
                return Err(self.err("E_TYPE_INVALID", id));
            }
        }
        Ok(Place {
            object: at,
            offset: p.byte_offset,
            type_name: p.pointee_type,
            lower: p.lower_bound,
            upper: p.upper_bound,
        })
    }
    fn offset_pointer(&mut self, mut p: Pointer, delta: i32, id: Id) -> Result<Pointer, Fault> {
        self.resolve(p.clone(), id, true)?;
        let size = self.size(&p.pointee_type) as i64;
        let offset = (p.byte_offset as i64)
            .checked_add(i64::from(delta) * size)
            .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?;
        if offset < p.lower_bound as i64 || offset > p.upper_bound as i64 {
            return Err(self.err("E_POINTER_BOUNDS", id));
        }
        p.byte_offset = offset as usize;
        Ok(p)
    }
    fn locate(&mut self, id: Id, allow_past: bool) -> Result<Place, Fault> {
        self.guarded(id, |runtime| runtime.locate_inner(id, allow_past))
    }
    fn locate_inner(&mut self, id: Id, allow_past: bool) -> Result<Place, Fault> {
        self.tick(id, 1)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Expr(Expr::Name(n)) => {
                let at = self.object_index(&n, id)?;
                let o = &self.state.objects[at];
                Ok(Place {
                    object: at,
                    offset: 0,
                    type_name: o.type_name.clone(),
                    lower: 0,
                    upper: o.byte_length,
                })
            }
            Kind::Expr(Expr::Unary { op, arg }) if op == "*" => {
                let value = self.eval(arg)?;
                let p = self.pointer(value, id)?;
                self.resolve(p, id, allow_past)
            }
            Kind::Expr(Expr::Index { array, index }) => {
                let base = if let Kind::Expr(Expr::Name(name)) = &self.p.nodes[array].kind {
                    let at = self.object_index(&name.clone(), array)?;
                    if self.state.objects[at].is_array {
                        self.array_pointer(at)
                    } else {
                        let value = self.eval(array)?;
                        self.pointer(value, array)?
                    }
                } else {
                    let value = self.eval(array)?;
                    self.pointer(value, array)?
                };
                let value = self.eval(index)?;
                let delta = self.int(value, index)?;
                let p = self.offset_pointer(base, delta, id)?;
                self.resolve(p, id, allow_past)
            }
            Kind::Expr(Expr::Member {
                base,
                field,
                indirect,
            }) => {
                let place = if indirect {
                    let v = self.eval(base)?;
                    let p = self.pointer(v, base)?;
                    self.resolve(p, id, false)?
                } else {
                    self.locate(base, false)?
                };
                let info = type_info(self.types, &place.type_name).unwrap();
                let f = info
                    .fields
                    .iter()
                    .find(|f| f.name == field)
                    .ok_or_else(|| self.err("E_TYPE_INVALID", id))?;
                let offset = place.offset + f.byte_offset;
                let size = self.size(&f.type_name);
                Ok(Place {
                    object: place.object,
                    offset,
                    type_name: f.type_name.clone(),
                    lower: offset,
                    upper: offset + size,
                })
            }
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn value(&self, place: &Place, id: Id) -> Result<Val, Fault> {
        let o = &self.state.objects[place.object];
        if !o.alive {
            return Err(self.err("E_DANGLING_POINTER", id));
        }
        if place
            .offset
            .checked_add(self.size(&place.type_name))
            .is_none_or(|n| n > place.upper)
        {
            return Err(self.err("E_POINTER_BOUNDS", id));
        }
        if let Ok(at) = o
            .cells
            .binary_search_by_key(&place.offset, |c| c.byte_offset)
        {
            return Ok(o.cells[at].value.clone());
        }
        if o.zero_initialized {
            if place.type_name == "int" {
                return Ok(Val::Int(0));
            }
            if let Some(target) = pointer_name(&place.type_name) {
                return Ok(Val::null(target));
            }
        }
        Err(self.err("E_UNINITIALIZED", id))
    }
    fn write(&mut self, place: &Place, value: Val, id: Id) -> Result<(), Fault> {
        if !self.state.objects[place.object].alive {
            return Err(self.err("E_DANGLING_POINTER", id));
        }
        if place
            .offset
            .checked_add(self.size(&place.type_name))
            .is_none_or(|n| n > place.upper)
        {
            return Err(self.err("E_POINTER_BOUNDS", id));
        }
        let value = self.convert(value, &place.type_name, id)?;
        self.state.dirty_objects.insert(place.object);
        let o = &mut self.state.objects[place.object];
        o.revision += 1;
        o.last_write = Some(place.offset);
        if o.is_array {
            self.state.counters.array_writes += 1;
        } else {
            self.state.counters.scalar_writes += 1;
        }
        #[cfg(feature = "cpp-course")]
        if self.record.course_limits.is_some()
            && o.zero_initialized
            && course::default_value(&value)
        {
            if let Ok(at) = o
                .cells
                .binary_search_by_key(&place.offset, |c| c.byte_offset)
            {
                o.cells.remove(at);
            }
            return Ok(());
        }
        match o
            .cells
            .binary_search_by_key(&place.offset, |c| c.byte_offset)
        {
            Ok(at) => o.cells[at].value = value,
            Err(at) => o.cells.insert(
                at,
                Cell {
                    byte_offset: place.offset,
                    value,
                },
            ),
        }
        Ok(())
    }
    #[inline(never)]
    fn binary_eval(&mut self, op: String, left: Id, right: Id, id: Id) -> Result<Val, Fault> {
        let a = self.eval(left)?;
        let a = if let Val::Char { ascii } = a {
            Val::Int(i32::from(ascii))
        } else {
            a
        };
        if op == "&&" && !a.truth() {
            return Ok(Val::Int(0));
        }
        if op == "||" && a.truth() {
            return Ok(Val::Int(1));
        }
        let b = self.eval(right)?;
        let b = if let Val::Char { ascii } = b {
            Val::Int(i32::from(ascii))
        } else {
            b
        };
        if op == "&&" || op == "||" {
            return Ok(Val::Int(i32::from(if op == "&&" {
                a.truth() && b.truth()
            } else {
                a.truth() || b.truth()
            })));
        }
        if (op == "+" || op == "-") && matches!(a, Val::Pointer(_)) && matches!(b, Val::Int(_)) {
            let p = self.pointer(a, id)?;
            let mut n = self.int(b, id)?;
            if op == "-" {
                n = n
                    .checked_neg()
                    .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?;
            }
            return self
                .offset_pointer(p, n, id)
                .map(|p| Val::Pointer(Box::new(p)));
        }
        if op == "+" && matches!(a, Val::Int(_)) && matches!(b, Val::Pointer(_)) {
            let n = self.int(a, id)?;
            let p = self.pointer(b, id)?;
            return self
                .offset_pointer(p, n, id)
                .map(|p| Val::Pointer(Box::new(p)));
        }
        if (op == "==" || op == "!=")
            && (matches!(a, Val::Pointer(_)) || matches!(b, Val::Pointer(_)))
        {
            let null = |v: Val| match v {
                Val::Int(0) => Some((None, 0)),
                Val::Pointer(p) => Some((p.object_id, p.byte_offset)),
                _ => None,
            };
            let equal = null(a).ok_or_else(|| self.err("E_TYPE_INVALID", id))?
                == null(b).ok_or_else(|| self.err("E_TYPE_INVALID", id))?;
            self.state.counters.comparisons += 1;
            return Ok(Val::Int(i32::from(if op == "==" { equal } else { !equal })));
        }
        let a = self.int(a, id)?;
        let b = self.int(b, id)?;
        let overflow = || self.err("E_OVERFLOW", id);
        let value = match op.as_str() {
            "+" => a.checked_add(b).ok_or_else(overflow)?,
            "-" => a.checked_sub(b).ok_or_else(overflow)?,
            "*" => a.checked_mul(b).ok_or_else(overflow)?,
            "/" | "%" => {
                if b == 0 {
                    return Err(self.err("E_DIV_ZERO", id));
                }
                if op == "/" {
                    a.checked_div(b)
                } else {
                    a.checked_rem(b)
                }
                .ok_or_else(overflow)?
            }
            "<" | "<=" | ">" | ">=" | "==" | "!=" => {
                self.state.counters.comparisons += 1;
                i32::from(match op.as_str() {
                    "<" => a < b,
                    "<=" => a <= b,
                    ">" => a > b,
                    ">=" => a >= b,
                    "==" => a == b,
                    _ => a != b,
                })
            }
            _ => return Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
        };
        Ok(Val::Int(value))
    }
    fn eval(&mut self, id: Id) -> Result<Val, Fault> {
        self.guarded(id, |runtime| runtime.eval_inner(id))
    }
    fn eval_inner(&mut self, id: Id) -> Result<Val, Fault> {
        self.tick(id, 1)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Expr(Expr::Int(n)) => Ok(Val::Int(n)),
            Kind::Expr(Expr::Char(ascii)) => Ok(Val::Char { ascii }),
            Kind::Expr(Expr::Size(base)) => {
                let Val::Text(s) = self.eval(base)? else {
                    return Err(self.err("E_TYPE_INVALID", id));
                };
                Ok(Val::Int(s.len() as i32))
            }
            Kind::Expr(Expr::Index { array, index }) => {
                if let Kind::Expr(Expr::Name(name)) = &self.p.nodes[array].kind {
                    let at = self.object_index(&name.clone(), id)?;
                    if self.state.objects[at].type_name == "string" {
                        let Val::Text(s) = self.eval(array)? else {
                            return Err(self.err("E_TYPE_INVALID", id));
                        };
                        let v = self.eval(index)?;
                        let i = self.int(v, id)?;
                        let ascii = *s
                            .as_bytes()
                            .get(usize::try_from(i).unwrap_or(usize::MAX))
                            .ok_or_else(|| self.err("E_STRING_BOUNDS", id))?;
                        return Ok(Val::Char { ascii });
                    }
                }
                let place = self.locate(id, false)?;
                self.value(&place, id)
            }
            Kind::Expr(Expr::NullPointer) => Ok(Val::null("")),
            Kind::Expr(Expr::Name(name)) => {
                let at = self.object_index(&name, id)?;
                let o = &self.state.objects[at];
                if o.is_array {
                    if pointer_name(&o.type_name).is_some() {
                        return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                    }
                    return Ok(Val::Pointer(Box::new(self.array_pointer(at))));
                }
                let place = self.locate(id, false)?;
                self.value(&place, id)
            }
            Kind::Expr(Expr::Member { .. }) => {
                let place = self.locate(id, false)?;
                self.value(&place, id)
            }
            Kind::Expr(Expr::New { type_name, zero }) => {
                let at = self.allocate("heap".into(), type_name, None, true, zero, id)?;
                self.emit(id, "memory.allocate")?;
                Ok(Val::Pointer(Box::new(self.array_pointer(at))))
            }
            Kind::Expr(Expr::Unary { op, arg }) => match op.as_str() {
                "&" => {
                    // C/C++ unary '&' and '*' cancel without accessing the
                    // pointed-to object, including null and one-past values.
                    if let Kind::Expr(Expr::Unary { op, arg }) = self.p.nodes[arg].kind.clone()
                        && op == "*"
                    {
                        return self.eval(arg);
                    }
                    let place = self.locate(arg, true)?;
                    Ok(Val::Pointer(Box::new(self.pointer_for(&place))))
                }
                "*" => {
                    let place = self.locate(id, false)?;
                    let value = self.value(&place, id)?;
                    if self.bug_observations.is_some() {
                        self.tick(id, 1)?;
                        self.bug_observations.as_mut().unwrap().indirect_reads += 1;
                    }
                    Ok(value)
                }
                "!" => Ok(Val::Int(i32::from(!self.eval(arg)?.truth()))),
                "+" => {
                    let value = self.eval(arg)?;
                    Ok(Val::Int(self.int(value, id)?))
                }
                "-" => {
                    let value = self.eval(arg)?;
                    let n = self.int(value, id)?;
                    n.checked_neg()
                        .map(Val::Int)
                        .ok_or_else(|| self.err("E_OVERFLOW", id))
                }
                _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
            },
            Kind::Expr(Expr::Binary { op, left, right }) => self.binary_eval(op, left, right, id),
            Kind::Expr(Expr::Call { name, args }) => self
                .call(&name, &args, Some(id))?
                .ok_or_else(|| self.err("E_TYPE_INVALID", id)),
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn scope_enter(&mut self, node: Id) -> Result<(), Fault> {
        self.state.dirty_frames.insert(self.state.frames.len() - 1);
        let frame = self.state.frames.last_mut().unwrap();
        let id = format!("s{}", self.state.allocator.next_scope);
        self.state.allocator.next_scope += 1;
        frame.scope_ids.push(id.clone());
        frame.revision += 1;
        self.state.scopes.push(Scope {
            revision: 0,
            id,
            frame_id: frame.id.clone(),
            node_id: nid(node),
            object_ids: vec![],
            aliases: vec![],
        });
        self.emit(node, "scope.enter")
    }
    fn release(&mut self, at: usize) {
        let o = &mut self.state.objects[at];
        o.alive = false;
        o.cells.clear();
        o.revision += 1;
        o.last_write = None;
        self.state.allocator.live_bytes -= o.byte_length;
        if o.storage == "heap" {
            self.active_heap -= 1;
        }
        self.state.dirty_objects.insert(at);
    }
    fn scope_pop(&mut self, node: Id) -> Result<(), Fault> {
        let ids = self.state.scopes.last().unwrap().object_ids.clone();
        self.tick(node, ids.len() + 1)?;
        for oid in ids {
            let at = self.object_id(&oid).unwrap();
            self.release(at);
        }
        self.state.dirty_frames.insert(self.state.frames.len() - 1);
        let frame = self.state.frames.last_mut().unwrap();
        frame.revision += 1;
        let sid = frame.scope_ids.pop().unwrap();
        assert_eq!(self.state.scopes.last().unwrap().id, sid);
        self.state.scopes.pop();
        Ok(())
    }
    fn scope_exit(&mut self, node: Id) -> Result<(), Fault> {
        self.scope_pop(node)?;
        self.emit(node, "scope.exit")
    }
    fn allocate(
        &mut self,
        name: String,
        type_name: String,
        length: Option<usize>,
        heap: bool,
        zero: bool,
        node: Id,
    ) -> Result<usize, Fault> {
        let object_limit = 4096;
        #[cfg(feature = "cpp-course")]
        let object_limit = self
            .record
            .course_limits
            .map_or(object_limit, |limits| limits.objects);
        if self.state.objects.len() >= object_limit {
            return Err(self.err("E_OBJECT_LIMIT", node));
        }
        if heap && self.active_heap >= 128 {
            return Err(self.err("E_HEAP_LIMIT", node));
        }
        let size = length.unwrap_or(1);
        let bytes = size
            .checked_mul(self.size(&type_name))
            .ok_or_else(|| self.err("E_MEMORY_LIMIT", node))?;
        if self.state.allocator.live_bytes.saturating_add(bytes) > self.meter.limits().live_bytes {
            return Err(self.err("E_MEMORY_LIMIT", node));
        }
        let next = self
            .state
            .allocator
            .next_address
            .checked_add(bytes as u64)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or_else(|| self.err("E_MEMORY_LIMIT", node))?;
        let zero_slots = if zero {
            self.initialization_slots(&type_name, size)
        } else {
            0
        };
        self.tick(node, zero_slots)?;
        let id = format!("o{}", self.state.allocator.next_object);
        let (frame_id, scope_id) = if heap {
            (None, None)
        } else {
            self.state.dirty_scopes.insert(self.state.scopes.len() - 1);
            let scope = self.state.scopes.last_mut().unwrap();
            scope.object_ids.push(id.clone());
            scope.revision += 1;
            (
                Some(self.state.frames.last().unwrap().id.clone()),
                Some(scope.id.clone()),
            )
        };
        self.state.objects.push(Object {
            revision: 0,
            last_write: None,
            id,
            declaration_node_id: nid(node),
            frame_id,
            scope_id,
            name,
            length: size,
            base_address: self.state.allocator.next_address,
            type_name,
            byte_length: bytes,
            storage: if heap { "heap" } else { "automatic" },
            alive: true,
            zero_initialized: zero,
            is_array: length.is_some(),
            cells: vec![],
        });
        self.state.allocator.next_address = next;
        self.state.allocator.next_object += 1;
        self.state.allocator.live_bytes += bytes;
        if length.is_some() {
            self.state.counters.array_writes += zero_slots;
        } else {
            self.state.counters.scalar_writes += zero_slots;
        }
        if heap {
            self.active_heap += 1;
        }
        Ok(self.state.objects.len() - 1)
    }
    fn initialization_slots(&self, type_name: &str, length: usize) -> usize {
        let info = type_info(self.types, type_name).unwrap();
        length
            * if info.kind == "struct" {
                info.fields.len()
            } else {
                1
            }
    }
    fn call(&mut self, name: &str, args: &[Id], call: Option<Id>) -> Result<Option<Val>, Fault> {
        let node = call.unwrap_or_else(|| {
            self.p
                .functions
                .iter()
                .find(|f| f.name == name)
                .unwrap()
                .node
        });
        self.guarded(node, |runtime| runtime.call_inner(name, args, call))
    }
    fn call_inner(
        &mut self,
        name: &str,
        args: &[Id],
        call: Option<Id>,
    ) -> Result<Option<Val>, Fault> {
        let f = self
            .p
            .functions
            .iter()
            .find(|f| f.name == name)
            .unwrap()
            .clone();
        let at = call.unwrap_or(f.node);
        if self.state.frames.len() >= STACK_LIMIT {
            return Err(self.err("E_STACK_LIMIT", at));
        }
        let mut values = vec![];
        for (arg, param) in args.iter().zip(&f.params) {
            #[cfg(feature = "cpp-course")]
            if param.by_reference {
                let place = self.locate(*arg, false)?;
                values.push(Argument::Array(self.state.objects[place.object].id.clone()));
                continue;
            }
            values.push(if param.is_array {
                let at = self.array(*arg)?;
                Argument::Array(self.state.objects[at].id.clone())
            } else {
                let value = self.eval(*arg)?;
                Argument::Value(self.convert(value, &param.type_name, *arg)?)
            });
        }
        let parent = self.state.frames.last().map(|f| f.id.clone());
        let id = format!("f{}", self.state.allocator.next_frame);
        let scope = format!("s{}", self.state.allocator.next_scope);
        self.state.allocator.next_frame += 1;
        self.state.allocator.next_scope += 1;
        self.state.frames.push(Frame {
            revision: 0,
            id: id.clone(),
            function_node_id: nid(f.node),
            function_name: f.name.clone(),
            parent_frame_id: parent,
            call_node_id: call.map(nid),
            scope_ids: vec![scope.clone()],
        });
        self.state.scopes.push(Scope {
            revision: 0,
            id: scope,
            frame_id: id.clone(),
            node_id: nid(f.body),
            object_ids: vec![],
            aliases: vec![],
        });
        self.state.control.active_frame_id = Some(id);
        self.state.control.return_value = None;
        for (param, value) in f.params.iter().zip(values) {
            match value {
                Argument::Value(value) => {
                    let object = self.allocate(
                        param.name.clone(),
                        param.type_name.clone(),
                        None,
                        false,
                        false,
                        param.node,
                    )?;
                    let place = Place {
                        object,
                        offset: 0,
                        type_name: param.type_name.clone(),
                        lower: 0,
                        upper: self.state.objects[object].byte_length,
                    };
                    self.write(&place, value, param.node)?;
                }
                Argument::Array(object_id) => {
                    self.state.dirty_scopes.insert(self.state.scopes.len() - 1);
                    let s = self.state.scopes.last_mut().unwrap();
                    s.revision += 1;
                    s.aliases.push(Alias {
                        name: param.name.clone(),
                        object_id,
                    });
                }
            }
        }
        self.emit(
            f.node,
            if name == "main" {
                "program.enter"
            } else {
                "function.enter"
            },
        )?;
        let flow = self.block(f.body, false)?;
        let (value, node) = match flow {
            Flow::Return(value, node) => (value, node),
            Flow::Next if name == "main" => (Some(Val::Int(0)), f.body),
            Flow::Next if f.return_type == "void" => (None, f.body),
            Flow::Next => return Err(self.err("E_RETURN_MISSING", f.node)),
            _ => return Err(self.err("E_TYPE_INVALID", f.node)),
        };
        while !self.state.frames.last().unwrap().scope_ids.is_empty() {
            self.scope_pop(node)?;
        }
        self.state.frames.pop();
        self.state.control.active_frame_id = self.state.frames.last().map(|f| f.id.clone());
        self.state.control.return_value = value.clone();
        self.emit(
            node,
            if name == "main" {
                "program.return"
            } else {
                "function.return"
            },
        )?;
        Ok(value)
    }
    fn block(&mut self, id: Id, scope: bool) -> Result<Flow, Fault> {
        self.guarded(id, |runtime| runtime.block_inner(id, scope))
    }
    fn block_inner(&mut self, id: Id, scope: bool) -> Result<Flow, Fault> {
        if scope {
            self.scope_enter(id)?;
        }
        let ids = if let Kind::Block(ids) = self.p.nodes[id].kind.clone() {
            ids
        } else {
            return self.stmt(id);
        };
        for child in ids {
            let flow = self.stmt(child)?;
            if !matches!(flow, Flow::Next) {
                if scope {
                    self.scope_exit(id)?;
                }
                return Ok(flow);
            }
        }
        if scope {
            self.scope_exit(id)?;
        }
        Ok(Flow::Next)
    }
    fn output(&mut self, text: String, id: Id) -> Result<(), Fault> {
        self.tick(id, text.len().div_ceil(64))?;
        let output_limit = self.meter.limits().output_bytes;
        #[cfg(feature = "cpp-course")]
        let output_limit = self
            .record
            .course_limits
            .map_or(output_limit, |limits| limits.output);
        if self.state.output.len().saturating_add(text.len()) > output_limit {
            return Err(self.err("E_OUTPUT_LIMIT", id));
        }
        self.state.output.push_str(&text);
        self.emit(id, "output.append")
    }
    fn stmt(&mut self, id: Id) -> Result<Flow, Fault> {
        self.guarded(id, |runtime| runtime.stmt_inner(id))
    }
    #[inline(never)]
    fn simple_stmt(&mut self, id: Id) -> Result<Flow, Fault> {
        match self.p.nodes[id].kind.clone() {
            Kind::Declare {
                name,
                type_name,
                length,
                init,
            } => {
                let object = self.allocate(name, type_name.clone(), length, false, false, id)?;
                self.emit(id, "object.declare")?;
                match init {
                    Init::None => {
                        if type_name == "string" {
                            let place = Place {
                                object,
                                offset: 0,
                                type_name,
                                lower: 0,
                                upper: 32,
                            };
                            self.write(&place, Val::Text(String::new()), id)?;
                            self.emit(id, "value.initialize")?;
                        }
                    }
                    Init::Zero => {
                        let slots = self
                            .initialization_slots(&type_name, self.state.objects[object].length);
                        self.tick(id, slots)?;
                        if length.is_some() {
                            self.state.counters.array_writes += slots;
                        } else {
                            self.state.counters.scalar_writes += slots;
                        }
                        self.state.dirty_objects.insert(object);
                        self.state.objects[object].revision += 1;
                        self.state.objects[object].zero_initialized = true;
                        self.state.objects[object].last_write = None;
                        self.emit(id, "value.initialize")?;
                    }
                    Init::Scalar(expr) => {
                        let v = self.eval(expr)?;
                        let place = Place {
                            object,
                            offset: 0,
                            type_name,
                            lower: 0,
                            upper: self.state.objects[object].byte_length,
                        };
                        self.write(&place, v, id)?;
                        self.emit(id, "value.initialize")?;
                    }
                    Init::Array(exprs) => {
                        let mut values = vec![];
                        for expr in exprs {
                            let value = self.eval(expr)?;
                            values.push(self.convert(value, &type_name, expr)?);
                        }
                        self.tick(id, self.state.objects[object].length + 1)?;
                        self.state.dirty_objects.insert(object);
                        let o = &mut self.state.objects[object];
                        o.revision += 1;
                        o.last_write = None;
                        o.zero_initialized = true;
                        let size = self.size(&type_name);
                        let cells = values.into_iter().enumerate();
                        #[cfg(feature = "cpp-course")]
                        let cells = cells.filter(|(_, value)| {
                            self.record.course_limits.is_none() || !course::default_value(value)
                        });
                        self.state.objects[object].cells = cells
                            .map(|(i, value)| Cell {
                                byte_offset: i * size,
                                value,
                            })
                            .collect();
                        self.state.counters.array_writes += self.state.objects[object].length;
                        self.emit(id, "value.initialize")?;
                    }
                }
            }
            Kind::Assign { target, value } => {
                let (place, value) = if self.cpp {
                    let v = self.eval(value)?;
                    (self.locate(target, false)?, v)
                } else {
                    let p = self.locate(target, false)?;
                    (p, self.eval(value)?)
                };
                let pointer = pointer_name(&place.type_name).is_some();
                self.write(&place, value, id)?;
                self.emit(
                    id,
                    if pointer {
                        "pointer.write"
                    } else {
                        "value.write"
                    },
                )?;
            }
            Kind::Delete(expr) => {
                let value = self.eval(expr)?;
                match value {
                    Val::Int(0) => {}
                    Val::Pointer(p) if p.object_id.is_none() => {}
                    Val::Pointer(p) => {
                        let at = self
                            .object_id(p.object_id.as_ref().unwrap())
                            .ok_or_else(|| self.err("E_INVALID_DELETE", id))?;
                        let o = &self.state.objects[at];
                        if o.storage != "heap"
                            || p.byte_offset != 0
                            || p.lower_bound != 0
                            || p.upper_bound != o.byte_length
                            || p.pointee_type != o.type_name
                        {
                            return Err(self.err("E_INVALID_DELETE", id));
                        }
                        if !o.alive {
                            return Err(self.err("E_DOUBLE_DELETE", id));
                        }
                        self.release(at);
                    }
                    _ => return Err(self.err("E_INVALID_DELETE", id)),
                }
                self.emit(id, "memory.release")?;
            }
            Kind::Break => {
                self.emit(id, "control.jump")?;
                return Ok(Flow::Break);
            }
            Kind::Continue => {
                self.emit(id, "control.jump")?;
                return Ok(Flow::Continue);
            }
            Kind::ExprStmt(expr) => {
                if let Kind::Expr(Expr::Call { name, args }) = self.p.nodes[expr].kind.clone() {
                    self.call(&name, &args, Some(expr))?;
                } else {
                    self.eval(expr)?;
                }
            }
            Kind::Print { format, args } => {
                let mut values = vec![];
                for arg in args {
                    let v = self.eval(arg)?;
                    values.push(self.int(v, arg)?);
                }
                let mut text = String::new();
                let mut chars = format.chars();
                let mut values = values.iter();
                while let Some(c) = chars.next() {
                    if c == '%' {
                        match chars.next() {
                            Some('%') => text.push('%'),
                            Some('d') => text.push_str(&values.next().unwrap().to_string()),
                            _ => unreachable!(),
                        }
                    } else {
                        text.push(c)
                    }
                }
                self.output(text, id)?;
            }
            Kind::Cout(parts) => {
                for part in parts {
                    let text = match part {
                        Output::Text(s) => s,
                        Output::Expr(expr) => {
                            let v = self.eval(expr)?;
                            match v {
                                Val::Text(s) => s,
                                Val::Char { ascii } => char::from(ascii).to_string(),
                                other => self.int(other, expr)?.to_string(),
                            }
                        }
                    };
                    self.output(text, id)?;
                }
            }
            Kind::Getline(target) => {
                let place = self.locate(target, false)?;
                let text = self
                    .lines
                    .get(self.state.control.input_cursor)
                    .cloned()
                    .ok_or_else(|| self.err("E_INPUT_EXHAUSTED", target))?;
                self.tick(id, text.len() + 1)?;
                self.write(&place, Val::Text(text), target)?;
                self.state.control.input_cursor += 1;
                self.emit(id, "input.read")?;
            }
            Kind::Scanf(target) => {
                let place = self.locate(target, false)?;
                let value = self
                    .input
                    .get(self.state.control.input_cursor)
                    .copied()
                    .ok_or_else(|| self.err("E_INPUT_EXHAUSTED", target))?;
                self.write(&place, Val::Int(value), target)?;
                self.state.control.input_cursor += 1;
                self.emit(id, "input.read")?;
            }
            Kind::Cin(targets) => {
                for target in targets {
                    let place = self.locate(target, false)?;
                    let value = self
                        .input
                        .get(self.state.control.input_cursor)
                        .copied()
                        .ok_or_else(|| self.err("E_INPUT_EXHAUSTED", target))?;
                    self.write(&place, Val::Int(value), target)?;
                    self.state.control.input_cursor += 1;
                    self.emit(target, "input.read")?;
                }
            }
            Kind::Empty => self.emit(id, "nop")?,
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        }
        Ok(Flow::Next)
    }
    fn stmt_inner(&mut self, id: Id) -> Result<Flow, Fault> {
        self.tick(id, 1)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Block(_) => return self.block(id, true),
            Kind::If { condition, yes, no } => {
                let value = self.eval(condition)?;
                self.emit(condition, "condition")?;
                if value.truth() {
                    return self.stmt(yes);
                }
                if let Some(no) = no {
                    return self.stmt(no);
                }
            }
            Kind::While { condition, body } => loop {
                let v = self.eval(condition)?;
                self.emit(condition, "condition")?;
                if !v.truth() {
                    break;
                }
                if self.bug_observations.is_some() {
                    self.tick(id, 1)?;
                    self.bug_observations.as_mut().unwrap().loop_iterations += 1;
                }
                match self.stmt(body)? {
                    Flow::Return(v, n) => return Ok(Flow::Return(v, n)),
                    Flow::Break => break,
                    _ => {}
                }
            },
            #[cfg(feature = "cpp-course")]
            Kind::DoWhile { body, condition } => loop {
                match self.stmt(body)? {
                    Flow::Return(v, n) => return Ok(Flow::Return(v, n)),
                    Flow::Break => break,
                    Flow::Continue | Flow::Next => {}
                }
                let value = self.eval(condition)?;
                self.emit(condition, "condition")?;
                if !value.truth() {
                    break;
                }
            },
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                self.scope_enter(id)?;
                if let Some(init) = init {
                    self.stmt(init)?;
                }
                loop {
                    let value = if let Some(c) = condition {
                        self.eval(c)?
                    } else {
                        Val::Int(1)
                    };
                    self.emit(condition.unwrap_or(id), "condition")?;
                    if !value.truth() {
                        break;
                    }
                    if self.bug_observations.is_some() {
                        self.tick(id, 1)?;
                        self.bug_observations.as_mut().unwrap().loop_iterations += 1;
                    }
                    match self.stmt(body)? {
                        Flow::Return(v, n) => {
                            self.scope_exit(id)?;
                            return Ok(Flow::Return(v, n));
                        }
                        Flow::Break => break,
                        _ => {}
                    }
                    if let Some(update) = update {
                        self.stmt(update)?;
                    }
                }
                self.scope_exit(id)?;
            }
            Kind::Return(value) => {
                let value = if let Some(expr) = value {
                    let v = self.eval(expr)?;
                    let name = &self.state.frames.last().unwrap().function_name;
                    let dest = self
                        .p
                        .functions
                        .iter()
                        .find(|f| f.name == *name)
                        .unwrap()
                        .return_type
                        .clone();
                    Some(self.convert(v, &dest, expr)?)
                } else {
                    None
                };
                return Ok(Flow::Return(value, id));
            }
            _ => return self.simple_stmt(id),
        }
        Ok(Flow::Next)
    }
}

fn valid_id(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 96
            && s.bytes()
                .enumerate()
                .all(|(i, c)| c.is_ascii_alphanumeric() || (i > 0 && b"._:-".contains(&c)))
    })
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.len() == keys.len() && keys.iter().all(|k| map.contains_key(*k)))
}
/// Closed canonical EXEC-01 1.3.0 boundary. Protocol errors never execute code.
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    execute_inner(bytes, build_id, meter, false)
}
/// Explicit BUG-MEMORY-01 companion; the old closed entry rejects this request.
pub fn execute_bug(
    bytes: &[u8],
    build_id: &str,
    meter: &mut Meter,
) -> Result<Vec<u8>, &'static str> {
    execute_inner(bytes, build_id, meter, true)
}
fn execute_inner(
    bytes: &[u8],
    build_id: &str,
    meter: &mut Meter,
    bug_mode: bool,
) -> Result<Vec<u8>, &'static str> {
    if build_id.len() != 64
        || !build_id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("E_PROTOCOL_INVALID");
    }
    let request =
        codec::decode(bytes, meter, meter.limits().request_bytes).map_err(|e| match e {
            codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
            codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
            codec::CodecError::Budget(_) => "E_FUEL_LIMIT",
            codec::CodecError::Limit { .. } => "E_REQUEST_LIMIT",
            _ => "E_PROTOCOL_INVALID",
        })?;
    let mut fields = vec![
        "execVersion",
        "dslVersion",
        "diagnosticVersion",
        "integerEncoding",
        "language",
        "engineId",
        "runId",
        "sourceRevision",
        "source",
        "input",
    ];
    if bug_mode {
        fields.push("bug");
    }
    if !exact(&request, &fields) {
        return Err("E_PROTOCOL_INVALID");
    }
    if request["execVersion"] != EXEC_VERSION
        || request["dslVersion"] != DSL_VERSION
        || request["diagnosticVersion"] != "1.3.0"
        || request["integerEncoding"] != "1.0.0"
        || request["engineId"] != ENGINE_ID
    {
        return Err("E_UNSUPPORTED_VERSION");
    }
    if !valid_id(&request["runId"])
        || !valid_id(&request["sourceRevision"])
        || !matches!(request["language"].as_str(), Some("c" | "cpp"))
    {
        return Err("E_PROTOCOL_INVALID");
    }
    let source = request["source"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    let provided = &request["input"];
    if !exact(provided, &["kind", "values"]) {
        return Err("E_INPUT_INVALID");
    }
    let values = provided["values"].as_array().ok_or("E_INPUT_INVALID")?;
    let is_lines = provided["kind"] == "lines";
    let mut input = vec![];
    let mut lines = vec![];
    if is_lines {
        if request["language"] != "cpp" || values.len() > 2 {
            return Err("E_INPUT_INVALID");
        }
        for value in values {
            let text = value
                .as_str()
                .filter(|s| s.len() <= 30 && s.bytes().all(|b| (32..=126).contains(&b)))
                .ok_or("E_INPUT_INVALID")?;
            lines.push(text.to_owned());
        }
    } else {
        if provided["kind"] != "integers" || values.len() > 30 {
            return Err("E_INPUT_INVALID");
        }
        for v in values {
            input.push(
                v.as_i64()
                    .and_then(|i| i32::try_from(i).ok())
                    .filter(|i| (-999..=999).contains(i))
                    .ok_or("E_INPUT_INVALID")?,
            );
        }
    }
    let bug = if bug_mode {
        Some(crate::bug::context(&request, meter)?)
    } else {
        None
    };
    let mut judgement = None;
    let mut node_map = vec![];
    let mut types = vec![];
    let mut trace = None;
    let mut error = None;
    let mut returned = None;
    match syntax::parse(source, request["language"].as_str().unwrap(), meter).and_then(|p| {
        types = make_types(&p, meter)?;
        check(&p, &types, meter)?;
        for node in &p.nodes {
            if (is_lines && matches!(node.kind, Kind::Cin(_) | Kind::Scanf(_)))
                || (!is_lines && matches!(node.kind, Kind::Getline(_)))
            {
                return Err(fault("E_INPUT_KIND", node.range));
            }
        }
        Ok(p)
    }) {
        Err(e) => error = Some(e),
        Ok(p) => {
            for (id, node) in p.nodes.iter().enumerate() {
                node_map
                    .push(json!({"nodeId":nid(id),"kind":node.kind.tag(),"byteRange":node.range}));
            }
            let main = p.functions.iter().find(|f| f.name == "main").unwrap();
            let state = State::new(main.node);
            let metadata = codec::encode(
                &json!({"nodeMap":node_map,"types":types}),
                meter,
                meter.limits().result_bytes,
            )
            .map_err(|e| match e {
                codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
                codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
                _ => "E_RESULT_LIMIT",
            })?
            .len();
            match Recording::new(
                &state,
                metadata,
                &json!(types),
                meter,
                p.nodes[main.node].range,
            ) {
                Err(e) => error = Some(e),
                Ok(record) => {
                    let mut runtime = Runtime {
                        p: &p,
                        types: &types,
                        active_heap: 0,
                        meter,
                        input: &input,
                        lines: &lines,
                        cpp: request["language"] == "cpp",
                        depth: 0,
                        state,
                        record,
                        bug_observations: bug.as_ref().map(|_| crate::bug::Observations::default()),
                    };
                    match runtime.call("main", &[], None) {
                        Ok(value) => returned = value,
                        Err(e) => error = Some(e),
                    }
                    if let Some(context) = &bug {
                        judgement =
                            Some(context.judge(
                                error.is_none(),
                                returned.as_ref().and_then(|v| {
                                    if let Val::Int(n) = v { Some(*n) } else { None }
                                }),
                                &runtime.state.output,
                                runtime.state.control.input_cursor,
                                runtime.bug_observations.as_ref().unwrap(),
                            ));
                    }
                    trace = Some(runtime.record);
                }
            }
        }
    }
    let status = match error.as_ref().map(|e| e.code) {
        None => "completed",
        Some("E_CANCELLED") => "cancelled",
        Some(code) if code.ends_with("_LIMIT") || code == "E_DEADLINE" => "limited",
        _ => "error",
    };
    if matches!(
        error.as_ref().map(|e| e.code),
        Some("E_CANCELLED" | "E_DEADLINE")
    ) {
        trace = None;
    }
    let cursor = trace.as_ref().map_or(0, |t| t.steps.len());
    if let Some(context) = &bug {
        judgement.get_or_insert_with(|| {
            context.judge(false, None, "", 0, &crate::bug::Observations::default())
        });
    }
    // Reserved terminal encoding remains possible after fuel exhaustion. A hard
    // cancellation/deadline is returned out-of-band, with no retained trace.
    if let Err(e) = meter.begin_finalization() {
        return Err(match e {
            BudgetError::Cancelled => "E_CANCELLED",
            BudgetError::Deadline { .. } => "E_DEADLINE",
            _ => "E_FUEL_LIMIT",
        });
    }
    let mut result = json!({"execVersion":EXEC_VERSION,"dslVersion":DSL_VERSION,"diagnosticVersion":"1.3.0","integerEncoding":"1.0.0","language":request["language"],"engine":{"id":ENGINE_ID,"version":"0.1.0","buildId":build_id},"identity":{"runId":request["runId"],"sourceRevision":request["sourceRevision"]},"nodeMap":node_map,"terminal":{"status":status,"code":error.as_ref().map(|e|e.code),"byteRange":error.as_ref().map(|e|e.byte_range),"cursor":cursor,"returnValue":returned},"stats":{"fuelUsed":meter.used()}});
    if let Some(judgement) = judgement {
        result["bugJudgement"] = judgement;
    }
    let assembled = (|| -> Result<Vec<u8>, codec::CodecError> {
        let metadata = codec::encode(&result, meter, meter.limits().result_bytes)?;
        let mut output = codec::Assembly::new(meter.limits().result_bytes);
        output.append(&metadata[..metadata.len() - 1], meter)?;
        output.append(b",\"trace\":", meter)?;
        if let Some(trace) = trace {
            trace.write(error.is_none(), &mut output, meter)?;
        } else {
            output.append(b"null", meter)?;
        }
        output.append(b",\"types\":", meter)?;
        let encoded_types = codec::encode(&json!(types), meter, meter.limits().result_bytes)?;
        output.append(&encoded_types, meter)?;
        output.append(b"}", meter)?;
        meter.check_commit()?;
        Ok(output.finish())
    })();
    assembled.map_err(|e| match e {
        codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
        codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
        codec::CodecError::Limit { .. } => "E_RESULT_LIMIT",
        codec::CodecError::Budget(_) => "E_FUEL_LIMIT",
        _ => "E_ENCODING_FAILURE",
    })
}
