//! Static names, C6 types, qualifiers, prototypes and complete-tree validation.
use crate::{
    budget::Meter,
    formats,
    syntax::{self, Decl, Expr, Fault, Id, Init, Kind, Program},
    types::{self, Ty, Types, Val},
};
use std::collections::{BTreeMap, BTreeSet};

pub struct Checked {
    pub program: Program,
    pub types: Types,
    pub expr_types: Vec<Option<Ty>>,
    pub name_declarations: Vec<Option<Id>>,
}
pub fn equivalent(a: &Ty, b: &Ty) -> bool {
    match (a, b) {
        (Ty::Alias(_, a), b) => equivalent(a, b),
        (a, Ty::Alias(_, b)) => equivalent(a, b),
        (Ty::Const(a), Ty::Const(b)) => equivalent(a, b),
        (Ty::Pointer(a), Ty::Pointer(b)) => equivalent(a, b),
        (Ty::Array(a, n), Ty::Array(b, m)) => n == m && equivalent(a, b),
        _ => a == b,
    }
}
// Binary pointer comparisons/subtraction permit corresponding compatible
// targets with different top-level qualification. Assignment and prototype
// equivalence deliberately keep their separate, stricter rules.
fn compatible_pointer_operands(a: &Ty, b: &Ty) -> bool {
    match (a.bare(), b.bare()) {
        (Ty::Pointer(a), Ty::Pointer(b)) => compatible_pointer_targets(a, b),
        _ => false,
    }
}
pub(crate) fn compatible_pointer_targets(a: &Ty, b: &Ty) -> bool {
    equivalent(a.bare(), b.bare())
}
pub fn assignable(dest: &Ty, source: &Ty, zero: bool) -> bool {
    if dest.numeric() && source.numeric() {
        return true;
    }
    if let Ty::Pointer(d) = dest.bare() {
        if zero && source.integral() {
            return true;
        }
        if let Ty::Pointer(s) = source.decay().bare() {
            return (d.top_const() || !s.top_const()) && equivalent(d.bare(), s.bare());
        }
    }
    false
}
pub fn builtin(name: &str) -> Option<&'static str> {
    Some(match name {
        "printf" | "scanf" | "getchar" | "putchar" | "puts" | "fgets" => "stdio.h",
        "strlen" | "strcmp" | "strncmp" | "strcpy" | "strncpy" | "strcat" | "strncat"
        | "strchr" => "string.h",
        "isalpha" | "isdigit" | "isspace" | "toupper" | "tolower" => "ctype.h",
        "fabs" | "sqrt" => "math.h",
        _ => return None,
    })
}
struct Binding {
    ty: Ty,
    node: Id,
}
struct Checker<'a, 'm> {
    p: &'a Program,
    types: Types,
    expr_types: Vec<Option<Ty>>,
    name_declarations: Vec<Option<Id>>,
    env: Vec<BTreeMap<String, Binding>>,
    globals: BTreeMap<String, Binding>,
    meter: &'m mut Meter,
    function: Option<usize>,
    loops: usize,
    switches: usize,
    calls: BTreeMap<String, BTreeSet<String>>,
}
impl Checker<'_, '_> {
    fn err(&self, code: &'static str, id: Id) -> Fault {
        syntax::fault(code, self.p.nodes[id].range)
    }
    fn register(&mut self, ty: &Ty, id: Id) -> Result<(), Fault> {
        self.types.describe(ty).map_err(|c| self.err(c, id))?;
        Ok(())
    }
    fn lookup(&mut self, name: &str, id: Id) -> Result<Ty, Fault> {
        if let Some(b) = self.env.iter().rev().find_map(|e| e.get(name)) {
            self.name_declarations[id] = Some(b.node);
            return Ok(b.ty.clone());
        }
        if let Some(b) = self.globals.get(name)
            && self.p.nodes[b.node].range.start <= self.p.nodes[id].range.start
        {
            self.name_declarations[id] = Some(b.node);
            return Ok(b.ty.clone());
        }
        Err(self.err("E_UNDECLARED", id))
    }
    fn zero(&self, id: Id) -> bool {
        matches!(
            &self.p.nodes[id].kind,
            Kind::Expression(Expr::Literal(Val::I(0) | Val::U(0), _))
        )
    }
    fn expr(&mut self, id: Id) -> Result<Ty, Fault> {
        syntax::charge(self.meter, 1, self.p.nodes[id].range)?;
        if let Some(t) = &self.expr_types[id] {
            return Ok(t.clone());
        }
        let Kind::Expression(expr) = self.p.nodes[id].kind.clone() else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        let t = match expr {
            Expr::Literal(v, _) => v.ty(),
            Expr::String(s) => Ty::Array(Box::new(Ty::Char), s.len() + 1),
            Expr::Name(n) => self.lookup(&n, id)?,
            Expr::Unary(op, a) => {
                let t = self.expr(a)?;
                match op.as_str() {
                    "&" => {
                        let t = self.place(a, false)?;
                        if matches!(t.bare(), Ty::Array(..) | Ty::Pointer(_)) {
                            return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                        }
                        Ty::Pointer(Box::new(t))
                    }
                    "*" => {
                        if let Ty::Pointer(p) = t.decay().bare() {
                            p.as_ref().clone()
                        } else {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                    }
                    "++" | "--" => {
                        let t = self.place(a, true)?;
                        if !t.scalar() {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        t
                    }
                    "!" => {
                        if !t.decay().scalar() {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        Ty::Int
                    }
                    "+" | "-" => {
                        if !t.numeric() {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        if t.bare() == &Ty::Char { Ty::Int } else { t }
                    }
                    "~" => {
                        if !t.integral() {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        if t.bare() == &Ty::UInt {
                            Ty::UInt
                        } else {
                            Ty::Int
                        }
                    }
                    _ => return Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
                }
            }
            Expr::Postfix(_, a) => {
                let t = self.place(a, true)?;
                if !t.scalar() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                t
            }
            Expr::Index(a, b) => {
                let a = self.expr(a)?;
                if !self.expr(b)?.integral() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                let decay = a.decay();
                let Ty::Pointer(element) = decay.bare() else {
                    return Err(self.err("E_TYPE_INVALID", id));
                };
                if a.top_const() {
                    Ty::Const(element.clone())
                } else {
                    element.as_ref().clone()
                }
            }
            Expr::Member(a, name, indirect) => {
                let mut t = self.expr(a)?;
                if indirect {
                    let Ty::Pointer(base) = t.bare() else {
                        return Err(self.err("E_TYPE_INVALID", id));
                    };
                    t = base.as_ref().clone()
                }
                self.types
                    .field(&t, &name)
                    .ok_or_else(|| self.err("E_TYPE_INVALID", id))?
                    .0
            }
            Expr::Binary(op, a, b) => {
                let x = self.expr(a)?.decay();
                let y = self.expr(b)?.decay();
                if matches!(op.as_str(), "&&" | "||") {
                    if !x.scalar() || !y.scalar() {
                        return Err(self.err("E_TYPE_INVALID", id));
                    }
                    Ty::Int
                } else if matches!(x.bare(), Ty::Pointer(_)) || matches!(y.bare(), Ty::Pointer(_)) {
                    match op.as_str() {
                        "+" if matches!(x.bare(), Ty::Pointer(_)) && y.integral() => x,
                        "+" if x.integral() && matches!(y.bare(), Ty::Pointer(_)) => y,
                        "-" if matches!(x.bare(), Ty::Pointer(_)) && y.integral() => x,
                        "-" if compatible_pointer_operands(&x, &y) => Ty::Int,
                        "==" | "!="
                            if compatible_pointer_operands(&x, &y)
                                || self.zero(a)
                                || self.zero(b) =>
                        {
                            Ty::Int
                        }
                        "<" | "<=" | ">" | ">=" if compatible_pointer_operands(&x, &y) => Ty::Int,
                        _ => return Err(self.err("E_TYPE_INVALID", id)),
                    }
                } else {
                    if matches!(op.as_str(), "%" | "&" | "|" | "^" | "<<" | ">>")
                        && (!x.integral() || !y.integral())
                    {
                        return Err(self.err("E_TYPE_INVALID", id));
                    }
                    let common = types::usual(&x, &y).map_err(|c| self.err(c, id))?;
                    if matches!(op.as_str(), "==" | "!=" | "<" | "<=" | ">" | ">=") {
                        Ty::Int
                    } else if matches!(op.as_str(), "<<" | ">>") {
                        if x.bare() == &Ty::UInt {
                            Ty::UInt
                        } else {
                            Ty::Int
                        }
                    } else {
                        common
                    }
                }
            }
            Expr::Assign(op, a, b) => {
                let dest = self.place(a, true)?;
                let src = self.expr(b)?.decay();
                if op == "=" {
                    if !assignable(&dest, &src, self.zero(b)) {
                        return Err(self.err("E_TYPE_INVALID", id));
                    }
                } else if let Ty::Pointer(_) = dest.bare() {
                    if !matches!(op.as_str(), "+=" | "-=") || !src.integral() {
                        return Err(self.err("E_TYPE_INVALID", id));
                    }
                } else {
                    if !dest.numeric()
                        || !src.numeric()
                        || matches!(op.as_str(), "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=")
                            && (!dest.integral() || !src.integral())
                    {
                        return Err(self.err("E_TYPE_INVALID", id));
                    }
                }
                dest
            }
            Expr::Conditional(c, a, b) => {
                if !self.expr(c)?.decay().scalar() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                let a_ty = self.expr(a)?.decay();
                let b_ty = self.expr(b)?.decay();
                if a_ty.numeric() && b_ty.numeric() {
                    types::usual(&a_ty, &b_ty).map_err(|c| self.err(c, id))?
                } else if assignable(&a_ty, &b_ty, self.zero(b)) {
                    a_ty
                } else if assignable(&b_ty, &a_ty, self.zero(a)) {
                    b_ty
                } else {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Expr::Cast(dest, a) => {
                let src = self.expr(a)?.decay();
                if !assignable(&dest, &src, self.zero(a)) {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                dest
            }
            Expr::SizeType(t) => {
                if t.bare() == &Ty::Void {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                self.register(&t, id)?;
                Ty::UInt
            }
            Expr::SizeExpr(a) => {
                let t = self.expr(a)?;
                if t.bare() == &Ty::Void {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ty::UInt
            }
            Expr::Call(name, args) => {
                if let Some(header) = builtin(&name) {
                    if !self.p.headers.contains(header) {
                        return Err(self.err("E_UNDECLARED", id));
                    }
                    self.library(&name, &args, id)?
                } else {
                    let sig = self
                        .p
                        .signatures
                        .get(&name)
                        .cloned()
                        .ok_or_else(|| self.err("E_UNDECLARED", id))?;
                    if sig.declared_at > self.p.nodes[id].range.start {
                        return Err(self.err("E_UNDECLARED", id));
                    }
                    if sig.params.len() != args.len() {
                        return Err(self.err("E_ARGUMENTS", id));
                    }
                    if !self.p.functions.iter().any(|f| f.name == name) {
                        return Err(self.err("E_UNDECLARED", id));
                    }
                    for (p, a) in sig.params.iter().zip(args) {
                        let t = self.expr(a)?.decay();
                        if !assignable(p, &t, self.zero(a)) {
                            return Err(self.err("E_TYPE_INVALID", a));
                        }
                    }
                    if let Some(f) = self.function {
                        self.calls
                            .entry(self.p.functions[f].name.clone())
                            .or_default()
                            .insert(name);
                    }
                    sig.result
                }
            }
        };
        self.register(&t, id)?;
        self.expr_types[id] = Some(t.clone());
        Ok(t)
    }
    fn place(&mut self, id: Id, write: bool) -> Result<Ty, Fault> {
        if !matches!(
            &self.p.nodes[id].kind,
            Kind::Expression(Expr::Name(_) | Expr::Index(..) | Expr::Member(..) | Expr::Unary(..))
        ) {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        if let Kind::Expression(Expr::Unary(op, _)) = &self.p.nodes[id].kind
            && op != "*"
        {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        let ty = self.expr(id)?;
        if write
            && (ty.top_const() || matches!(ty.bare(), Ty::Array(..) | Ty::Struct(_) | Ty::Void))
        {
            return Err(self.err(
                if ty.top_const() {
                    "E_CONST_WRITE"
                } else {
                    "E_TYPE_INVALID"
                },
                id,
            ));
        }
        Ok(ty)
    }
    fn format(&self, id: Id) -> Result<Vec<u8>, Fault> {
        if let Kind::Expression(Expr::String(s)) = &self.p.nodes[id].kind {
            Ok(s.clone())
        } else {
            Err(self.err("E_FORMAT_UNSUPPORTED", id))
        }
    }
    fn char_pointer(&mut self, id: Id, writable: bool) -> Result<Ty, Fault> {
        let t = self.expr(id)?.decay();
        let Ty::Pointer(base) = t.bare() else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        if base.bare() != &Ty::Char || writable && base.top_const() {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        Ok(t)
    }
    fn library(&mut self, name: &str, args: &[Id], id: Id) -> Result<Ty, Fault> {
        let count = match name {
            "getchar" => 0,
            "printf" => args.len(),
            "scanf" => 2,
            "fgets" => 3,
            "strcmp" | "strcpy" | "strcat" | "strchr" => 2,
            "strncmp" | "strncpy" | "strncat" => 3,
            _ => 1,
        };
        if args.len() != count || name == "printf" && args.is_empty() {
            return Err(self.err("E_ARGUMENTS", id));
        }
        match name {
            "printf" => {
                let parts = formats::print(&self.format(args[0])?).map_err(|c| self.err(c, id))?;
                self.expr(args[0])?;
                let mut at = 1;
                for part in parts {
                    if let formats::Part::Conversion { code, .. } = part {
                        let Some(&arg) = args.get(at) else {
                            return Err(self.err("E_ARGUMENTS", id));
                        };
                        let t = self.expr(arg)?.decay();
                        at += 1;
                        let valid = match code {
                            b'd' | b'c' => matches!(t.bare(), Ty::Int | Ty::Char),
                            b'u' | b'o' | b'x' | b'X' => t.bare() == &Ty::UInt,
                            b'f' | b'e' | b'g' => matches!(t.bare(), Ty::F32 | Ty::F64),
                            b's' => matches!(t.bare(),Ty::Pointer(p)if p.bare()==&Ty::Char),
                            b'p' => matches!(t.bare(), Ty::Pointer(_)),
                            _ => false,
                        };
                        if !valid {
                            return Err(self.err("E_TYPE_INVALID", arg));
                        }
                    }
                }
                if at != args.len() {
                    return Err(self.err("E_ARGUMENTS", id));
                }
                Ok(Ty::Int)
            }
            "scanf" => {
                let format = formats::scan(&self.format(args[0])?).map_err(|c| self.err(c, id))?;
                self.expr(args[0])?;
                let target = self.expr(args[1])?.decay();
                let Ty::Pointer(base) = target.bare() else {
                    return Err(self.err("E_TYPE_INVALID", args[1]));
                };
                let required = match format.code {
                    "d" => Ty::Int,
                    "u" => Ty::UInt,
                    "f" => Ty::F32,
                    "lf" => Ty::F64,
                    _ => Ty::Char,
                };
                if base.top_const() || base.bare() != &required {
                    return Err(self.err("E_TYPE_INVALID", args[1]));
                }
                Ok(Ty::Int)
            }
            "fgets" => {
                let dest = self.char_pointer(args[0], true)?;
                if !self.expr(args[1])?.integral() {
                    return Err(self.err("E_TYPE_INVALID", args[1]));
                }
                if !matches!(&self.p.nodes[args[2]].kind,Kind::Expression(Expr::Name(n))if n=="stdin")
                {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", args[2]));
                }
                self.expr_types[args[2]] = Some(Ty::Void);
                Ok(dest)
            }
            "puts" => {
                self.char_pointer(args[0], false)?;
                Ok(Ty::Int)
            }
            "getchar" => Ok(Ty::Int),
            "putchar" | "isalpha" | "isdigit" | "isspace" | "toupper" | "tolower" => {
                if !self.expr(args[0])?.integral() {
                    return Err(self.err("E_TYPE_INVALID", args[0]));
                }
                Ok(Ty::Int)
            }
            "fabs" | "sqrt" => {
                if !self.expr(args[0])?.numeric() {
                    return Err(self.err("E_TYPE_INVALID", args[0]));
                }
                Ok(Ty::F64)
            }
            "strlen" => {
                self.char_pointer(args[0], false)?;
                Ok(Ty::UInt)
            }
            "strcmp" | "strncmp" => {
                self.char_pointer(args[0], false)?;
                self.char_pointer(args[1], false)?;
                if name == "strncmp" && !self.expr(args[2])?.integral() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ok(Ty::Int)
            }
            "strcpy" | "strncpy" | "strcat" | "strncat" => {
                let dest = self.char_pointer(args[0], true)?;
                self.char_pointer(args[1], false)?;
                if args.len() == 3 && !self.expr(args[2])?.integral() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ok(dest)
            }
            "strchr" => {
                let source = self.char_pointer(args[0], false)?;
                if !self.expr(args[1])?.integral() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ok(source)
            }
            _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
        }
    }
    fn constant_init(&self, init: &Init) -> bool {
        match init {
            Init::None => true,
            Init::Items(a) => a.iter().all(|x| self.constant_init(x)),
            Init::Expr(id) => self.constant_expr(*id),
        }
    }
    fn constant_expr(&self, id: Id) -> bool {
        match &self.p.nodes[id].kind {
            Kind::Expression(
                Expr::Literal(..) | Expr::String(_) | Expr::SizeType(_) | Expr::SizeExpr(_),
            ) => true,
            Kind::Expression(Expr::Unary(op, a)) if ["+", "-", "!", "~"].contains(&op.as_str()) => {
                self.constant_expr(*a)
            }
            Kind::Expression(Expr::Unary(op, a)) if op == "&" => self.static_place(*a),
            Kind::Expression(Expr::Name(name)) => self
                .static_binding(name, id)
                .is_some_and(|d| matches!(d.ty.bare(), Ty::Array(..))),
            Kind::Expression(Expr::Binary(_, a, b)) => {
                self.constant_expr(*a) && self.constant_expr(*b)
            }
            Kind::Expression(Expr::Cast(_, a)) => self.constant_expr(*a),
            _ => false,
        }
    }
    fn static_binding(&self, name: &str, id: Id) -> Option<&Decl> {
        let binding = self
            .env
            .iter()
            .rev()
            .find_map(|e| e.get(name))
            .or_else(|| self.globals.get(name))?;
        let Kind::Declare(d) = &self.p.nodes[binding.node].kind else {
            return None;
        };
        ((d.global || d.static_storage)
            && self.p.nodes[binding.node].range.start <= self.p.nodes[id].range.start)
            .then_some(d)
    }
    fn static_place(&self, id: Id) -> bool {
        match &self.p.nodes[id].kind {
            Kind::Expression(Expr::Name(name)) => self.static_binding(name, id).is_some(),
            Kind::Expression(Expr::Member(base, _, false)) => self.static_place(*base),
            Kind::Expression(Expr::Index(base, index)) => {
                self.constant_expr(*base) && self.constant_expr(*index)
            }
            _ => false,
        }
    }
    fn initializer(&mut self, ty: &Ty, init: &Init, id: Id) -> Result<(), Fault> {
        match init {
            Init::None => Ok(()),
            Init::Expr(e) => {
                let t = self.expr(*e)?;
                if let Ty::Array(base, count) = ty.bare()
                    && base.bare() == &Ty::Char
                    && matches!(&self.p.nodes[*e].kind,Kind::Expression(Expr::String(s))if s.len()<=*count)
                {
                    return Ok(());
                }
                if !assignable(ty, &t.decay(), self.zero(*e)) {
                    return Err(self.err("E_TYPE_INVALID", *e));
                }
                Ok(())
            }
            Init::Items(items) => {
                if items.is_empty() {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                match ty.bare() {
                    Ty::Array(base, n) => {
                        if items.len() > *n {
                            return Err(self.err("E_BOUNDS", id));
                        }
                        for item in items {
                            self.initializer(base, item, id)?
                        }
                    }
                    Ty::Struct(name) => {
                        let fields = self.p.structs[name].clone();
                        if items.len() > fields.len() {
                            return Err(self.err("E_FIELD_LIMIT", id));
                        }
                        for ((_, ty), item) in fields.iter().zip(items) {
                            self.initializer(ty, item, id)?
                        }
                    }
                    _ => {
                        if items.len() != 1 {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        self.initializer(ty, &items[0], id)?
                    }
                }
                Ok(())
            }
        }
    }
    fn declaration(&mut self, d: Decl, id: Id) -> Result<(), Fault> {
        self.register(&d.ty, id)?;
        if builtin(&d.name).is_some() || self.p.signatures.contains_key(&d.name) {
            return Err(self.err("E_DUPLICATE", id));
        }
        if self.env.last().is_some_and(|e| e.contains_key(&d.name)) {
            return Err(self.err("E_DUPLICATE", id));
        }
        if !d.global {
            self.env.last_mut().unwrap().insert(
                d.name.clone(),
                Binding {
                    ty: d.ty.clone(),
                    node: id,
                },
            );
        }
        if (d.static_storage || d.global || matches!(d.ty.bare(), Ty::Array(..) | Ty::Struct(_)))
            && !self.constant_init(&d.init)
        {
            return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
        }
        self.initializer(&d.ty, &d.init, id)
    }
    fn stmt(&mut self, id: Id, push: bool) -> Result<(), Fault> {
        syntax::charge(self.meter, 1, self.p.nodes[id].range)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Block(a) => {
                if push {
                    self.env.push(BTreeMap::new())
                }
                for s in a {
                    self.stmt(s, true)?
                }
                if push {
                    self.env.pop();
                }
            }
            Kind::Group(a) => {
                for s in a {
                    self.stmt(s, true)?
                }
            }
            Kind::Declare(d) => self.declaration(d, id)?,
            Kind::ExprStmt(e) => {
                self.expr(e)?;
            }
            Kind::If { condition, yes, no } => {
                if !self.expr(condition)?.decay().scalar() {
                    return Err(self.err("E_TYPE_INVALID", condition));
                }
                self.stmt(yes, true)?;
                if let Some(no) = no {
                    self.stmt(no, true)?
                }
            }
            Kind::While { condition, body } | Kind::DoWhile { condition, body } => {
                if !self.expr(condition)?.decay().scalar() {
                    return Err(self.err("E_TYPE_INVALID", condition));
                }
                self.loops += 1;
                self.stmt(body, true)?;
                self.loops -= 1;
            }
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                self.env.push(BTreeMap::new());
                if let Some(i) = init {
                    self.stmt(i, true)?
                }
                if let Some(c) = condition
                    && !self.expr(c)?.decay().scalar()
                {
                    return Err(self.err("E_TYPE_INVALID", c));
                }
                if let Some(u) = update {
                    self.expr(u)?;
                }
                self.loops += 1;
                self.stmt(body, true)?;
                self.loops -= 1;
                self.env.pop();
            }
            Kind::Switch { value, arms } => {
                let ty = self.expr(value)?;
                if !ty.integral() {
                    return Err(self.err("E_TYPE_INVALID", value));
                }
                let ty = if ty.bare() == &Ty::Char { Ty::Int } else { ty };
                let mut labels = BTreeSet::new();
                for arm in &arms {
                    if let Some(v) = &arm.label {
                        let v = v.cast(&ty).map_err(|c| self.err(c, arm.node))?;
                        if !labels.insert(v.wire().to_string()) {
                            return Err(self.err("E_DUPLICATE", arm.node));
                        }
                    }
                }
                self.switches += 1;
                self.env.push(BTreeMap::new());
                for arm in arms {
                    for s in arm.statements {
                        self.stmt(s, true)?
                    }
                }
                self.env.pop();
                self.switches -= 1;
            }
            Kind::Return(e) => {
                let f = self
                    .function
                    .ok_or_else(|| self.err("E_TYPE_INVALID", id))?;
                let dest = self.p.functions[f].result.clone();
                match e {
                    Some(e) => {
                        let src = self.expr(e)?.decay();
                        if !assignable(&dest, &src, self.zero(e)) {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                    }
                    None => {
                        if dest.bare() != &Ty::Void {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                    }
                }
            }
            Kind::Break => {
                if self.loops == 0 && self.switches == 0 {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::Continue => {
                if self.loops == 0 {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::Empty | Kind::Marker(_) => {}
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        }
        Ok(())
    }
}
pub fn check(program: Program, meter: &mut Meter) -> Result<Checked, Fault> {
    let p = &program;
    let at = p.functions.first().map_or(0, |f| f.node);
    if p.nodes.is_empty() {
        return Err(syntax::fault(
            "E_PARSE_INVALID",
            crate::source::ByteRange { start: 0, end: 0 },
        ));
    }
    let mut c = Checker {
        p,
        types: Types {
            structs: p.structs.clone(),
            ..Types::default()
        },
        expr_types: vec![None; p.nodes.len()],
        name_declarations: vec![None; p.nodes.len()],
        env: vec![BTreeMap::new()],
        globals: BTreeMap::new(),
        meter,
        function: None,
        loops: 0,
        switches: 0,
        calls: BTreeMap::new(),
    };
    for t in [Ty::Int, Ty::UInt, Ty::Char, Ty::F32, Ty::F64, Ty::Void] {
        c.register(&t, at)?
    }
    for t in &p.aliases {
        c.register(t, at)?
    }
    for name in p.structs.keys() {
        c.register(&Ty::Struct(name.clone()), at)?
    }
    for id in &p.globals {
        let Kind::Declare(d) = p.nodes[*id].kind.clone() else {
            unreachable!()
        };
        if c.globals
            .insert(
                d.name.clone(),
                Binding {
                    ty: d.ty.clone(),
                    node: *id,
                },
            )
            .is_some()
        {
            return Err(c.err("E_DUPLICATE", *id));
        }
        c.declaration(d, *id)?;
    }
    let mut main = false;
    for (index, f) in p.functions.iter().enumerate() {
        if builtin(&f.name).is_some() || !f.result.scalar() && f.result.bare() != &Ty::Void {
            return Err(c.err("E_TYPE_INVALID", f.node));
        }
        if f.name == "main" {
            if f.result.bare() != &Ty::Int || !f.params.is_empty() {
                return Err(c.err("E_TYPE_INVALID", f.node));
            }
            main = true;
        }
        c.register(&f.result, f.node)?;
        c.function = Some(index);
        c.env = vec![BTreeMap::new()];
        for param in &f.params {
            if !param.ty.scalar() || c.env[0].contains_key(&param.name) {
                return Err(c.err("E_TYPE_INVALID", param.node));
            }
            c.register(&param.ty, param.node)?;
            c.env[0].insert(
                param.name.clone(),
                Binding {
                    ty: param.ty.clone(),
                    node: param.node,
                },
            );
        }
        c.stmt(f.body, false)?;
    }
    if !main {
        return Err(c.err("E_RETURN_MISSING", at));
    }
    fn reaches(
        calls: &BTreeMap<String, BTreeSet<String>>,
        start: &str,
        target: &str,
        seen: &mut BTreeSet<String>,
    ) -> bool {
        if !seen.insert(start.to_string()) {
            return false;
        }
        calls.get(start).is_some_and(|a| {
            a.iter()
                .filter(|n| n.as_str() != start)
                .any(|n| n == target || reaches(calls, n, target, seen))
        })
    }
    for f in &p.functions {
        if reaches(&c.calls, &f.name, &f.name, &mut BTreeSet::new()) {
            return Err(c.err("E_UNSUPPORTED_SYNTAX", f.node));
        }
    }
    let types = c.types;
    let expr_types = c.expr_types;
    let name_declarations = c.name_declarations;
    Ok(Checked {
        program,
        types,
        expr_types,
        name_declarations,
    })
}
