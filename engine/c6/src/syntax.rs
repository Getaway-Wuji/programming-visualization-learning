//! Source-preserving C6 tokenizer and bounded recursive-descent/Pratt parser.
use crate::{
    budget::{BudgetError, Meter},
    source::ByteRange,
    types::{self, Ty, Val},
};
use std::collections::{BTreeMap, BTreeSet};
pub type Id = usize;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fault {
    pub code: &'static str,
    pub byte_range: ByteRange,
}
pub fn fault(code: &'static str, r: ByteRange) -> Fault {
    Fault {
        code,
        byte_range: r,
    }
}
pub fn charge(m: &mut Meter, n: usize, r: ByteRange) -> Result<(), Fault> {
    m.charge(n).map_err(|e| {
        fault(
            match e {
                BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
                BudgetError::Deadline { .. } => "E_DEADLINE",
                BudgetError::Cancelled => "E_CANCELLED",
            },
            r,
        )
    })
}
fn range(start: usize, end: usize) -> ByteRange {
    ByteRange { start, end }
}

#[derive(Clone, Debug)]
enum TokenKind {
    Name,
    Number,
    Char(u8),
    String(Vec<u8>),
    Symbol,
    End,
}
#[derive(Clone, Debug)]
struct Token {
    kind: TokenKind,
    text: String,
    range: ByteRange,
    origin: Option<&'static str>,
}
#[derive(Clone, Debug)]
pub struct Node {
    pub kind: Kind,
    pub range: ByteRange,
    pub depth: usize,
}
#[derive(Clone, Debug)]
pub enum Kind {
    Marker(&'static str),
    Block(Vec<Id>),
    Group(Vec<Id>),
    Declare(Decl),
    Expression(Expr),
    ExprStmt(Id),
    If {
        condition: Id,
        yes: Id,
        no: Option<Id>,
    },
    While {
        condition: Id,
        body: Id,
    },
    DoWhile {
        body: Id,
        condition: Id,
    },
    For {
        init: Option<Id>,
        condition: Option<Id>,
        update: Option<Id>,
        body: Id,
    },
    Switch {
        value: Id,
        arms: Vec<Arm>,
    },
    Return(Option<Id>),
    Break,
    Continue,
    Empty,
}
#[derive(Clone, Debug)]
pub enum Expr {
    Literal(Val, Option<&'static str>),
    String(Vec<u8>),
    Name(String),
    Unary(String, Id),
    Postfix(String, Id),
    Binary(String, Id, Id),
    Assign(String, Id, Id),
    Conditional(Id, Id, Id),
    Call(String, Vec<Id>),
    Index(Id, Id),
    Member(Id, String, bool),
    Cast(Ty, Id),
    SizeType(Ty),
    SizeExpr(Id),
}
#[derive(Clone, Debug)]
pub enum Init {
    None,
    Expr(Id),
    Items(Vec<Init>),
}
#[derive(Clone, Debug)]
pub struct Decl {
    pub name: String,
    pub ty: Ty,
    pub init: Init,
    pub static_storage: bool,
    pub global: bool,
}
#[derive(Clone, Debug)]
pub struct Arm {
    pub node: Id,
    pub label: Option<Val>,
    pub label_expr: Option<Id>,
    pub statements: Vec<Id>,
}
#[derive(Clone, Debug)]
pub struct Param {
    pub name: String,
    pub ty: Ty,
    pub node: Id,
}
#[derive(Clone, Debug)]
pub struct Function {
    pub name: String,
    pub result: Ty,
    pub params: Vec<Param>,
    pub body: Id,
    pub node: Id,
}
#[derive(Clone, Debug)]
pub struct Signature {
    pub result: Ty,
    pub params: Vec<Ty>,
    pub declared_at: usize,
}
#[derive(Clone, Debug)]
pub struct Program {
    pub root: Id,
    pub nodes: Vec<Node>,
    pub globals: Vec<Id>,
    pub functions: Vec<Function>,
    pub signatures: BTreeMap<String, Signature>,
    pub structs: BTreeMap<String, Vec<(String, Ty)>>,
    pub headers: BTreeSet<String>,
    pub aliases: Vec<Ty>,
    pub has_object_macros: bool,
}
impl Kind {
    pub fn children(&self) -> Vec<Id> {
        match self {
            Self::Block(a) | Self::Group(a) => a.clone(),
            Self::Declare(d) => init_ids(&d.init),
            Self::ExprStmt(a) => vec![*a],
            Self::If { condition, yes, no } => [Some(*condition), Some(*yes), *no]
                .into_iter()
                .flatten()
                .collect(),
            Self::While { condition, body } | Self::DoWhile { condition, body } => {
                vec![*condition, *body]
            }
            Self::For {
                init,
                condition,
                update,
                body,
            } => [*init, *condition, *update, Some(*body)]
                .into_iter()
                .flatten()
                .collect(),
            Self::Switch { value, arms } => std::iter::once(*value)
                .chain(arms.iter().flat_map(|a| a.statements.iter().copied()))
                .collect(),
            Self::Return(a) => a.iter().copied().collect(),
            Self::Expression(e) => match e {
                Expr::Unary(_, a) | Expr::Postfix(_, a) | Expr::Cast(_, a) | Expr::SizeExpr(a) => {
                    vec![*a]
                }
                Expr::Binary(_, a, b) | Expr::Assign(_, a, b) | Expr::Index(a, b) => vec![*a, *b],
                Expr::Conditional(a, b, c) => vec![*a, *b, *c],
                Expr::Call(_, a) => a.clone(),
                Expr::Member(a, _, _) => vec![*a],
                _ => vec![],
            },
            _ => vec![],
        }
    }
    pub fn tag(&self) -> &'static str {
        match self {
            Self::Marker(k) => k,
            Self::Block(_) | Self::Group(_) => "block",
            Self::Declare(_) => "declaration",
            Self::ExprStmt(_) => "expression-statement",
            Self::If { .. } => "if",
            Self::While { .. } => "while",
            Self::DoWhile { .. } => "do-while",
            Self::For { .. } => "for",
            Self::Switch { .. } => "switch",
            Self::Return(_) => "return",
            Self::Break => "break",
            Self::Continue => "continue",
            Self::Empty => "empty",
            Self::Expression(Expr::Call(..)) => "call",
            Self::Expression(Expr::Assign(..)) => "assignment",
            Self::Expression(Expr::Cast(..)) => "cast",
            Self::Expression(Expr::SizeType(..) | Expr::SizeExpr(..)) => "sizeof",
            Self::Expression(_) => "expression",
        }
    }
}
fn init_ids(init: &Init) -> Vec<Id> {
    match init {
        Init::None => vec![],
        Init::Expr(a) => vec![*a],
        Init::Items(a) => a.iter().flat_map(init_ids).collect(),
    }
}

fn escaped(bytes: &[u8], at: &mut usize) -> Result<u8, &'static str> {
    let Some(&b) = bytes.get(*at) else {
        return Err("E_LEX_INVALID");
    };
    if b >= 128 {
        *at = (*at
            + if b < 224 {
                2
            } else if b < 240 {
                3
            } else {
                4
            })
        .min(bytes.len());
        return Err("E_CHAR_DOMAIN");
    }
    *at += 1;
    if b != b'\\' {
        return if b < 128 && b != b'\n' && b != b'\r' {
            Ok(b)
        } else {
            Err("E_CHAR_DOMAIN")
        };
    }
    let Some(&b) = bytes.get(*at) else {
        return Err("E_LEX_INVALID");
    };
    *at += 1;
    match b {
        b'n' => Ok(b'\n'),
        b'r' => Ok(b'\r'),
        b't' => Ok(b'\t'),
        b'0' => Ok(0),
        b'\\' | b'\'' | b'"' => Ok(b),
        _ => Err("E_UNSUPPORTED_SYNTAX"),
    }
}
pub fn number(s: &str) -> Result<Val, &'static str> {
    let floating = s.contains('.')
        || (!s.starts_with("0x") && !s.starts_with("0X") && (s.contains('e') || s.contains('E')));
    if floating {
        if let Some(s) = s.strip_suffix(['f', 'F']) {
            let n = s.parse::<f32>().map_err(|_| "E_LEX_INVALID")?;
            return if n.is_finite() {
                Ok(Val::F(n))
            } else {
                Err("E_FLOAT_NONFINITE")
            };
        }
        let n = s.parse::<f64>().map_err(|_| "E_LEX_INVALID")?;
        return if n.is_finite() {
            Ok(Val::D(n))
        } else {
            Err("E_FLOAT_NONFINITE")
        };
    }
    let unsigned = s.ends_with(['u', 'U']);
    let s = if unsigned { &s[..s.len() - 1] } else { s };
    if s.starts_with('-') {
        let n = s.parse::<i32>().map_err(|_| "E_OVERFLOW")?;
        return if unsigned {
            Ok(Val::U(n as u32))
        } else {
            Ok(Val::I(n))
        };
    }
    let (radix, digits) = if s.starts_with("0x") || s.starts_with("0X") {
        (16, &s[2..])
    } else if s.len() > 1 && s.starts_with('0') {
        (8, &s[1..])
    } else {
        (10, s)
    };
    let n = u64::from_str_radix(digits, radix).map_err(|_| "E_LEX_INVALID")?;
    if n > u64::from(u32::MAX) {
        return Err("E_OVERFLOW");
    }
    if unsigned || (radix != 10 && n > i32::MAX as u64) {
        Ok(Val::U(n as u32))
    } else {
        i32::try_from(n).map(Val::I).map_err(|_| "E_OVERFLOW")
    }
}
fn lex(source: &str, meter: &mut Meter) -> Result<(Vec<Token>, BTreeSet<String>, bool), Fault> {
    charge(meter, source.len(), range(0, source.len()))?;
    let bytes = source.as_bytes();
    let mut at = 0;
    let mut out = vec![];
    let mut macros: BTreeMap<String, String> = BTreeMap::new();
    let mut headers = BTreeSet::new();
    let mut user_macros = 0;
    while at < bytes.len() {
        charge(meter, 1, range(at, at + 1))?;
        let b = bytes[at];
        if b.is_ascii_whitespace() {
            at += 1;
            continue;
        }
        if bytes.get(at..at + 2) == Some(b"//") {
            while at < bytes.len() && bytes[at] != b'\n' {
                at += 1
            }
            continue;
        }
        if bytes.get(at..at + 2) == Some(b"/*") {
            let start = at;
            at += 2;
            while at + 1 < bytes.len() && &bytes[at..at + 2] != b"*/" {
                at += 1
            }
            if at + 1 >= bytes.len() {
                return Err(fault("E_LEX_INVALID", range(start, bytes.len())));
            }
            at += 2;
            continue;
        }
        if b == b'#' {
            let start = at;
            let line_start = source[..at].rfind('\n').map_or(0, |x| x + 1);
            if !source[line_start..at].trim().is_empty() {
                return Err(fault("E_MACRO_UNSUPPORTED", range(at, at + 1)));
            }
            while at < bytes.len() && bytes[at] != b'\n' {
                at += 1
            }
            let raw = source[start + 1..at].trim();
            let mut owned = raw.to_string();
            while let Some(begin) = owned.find("/*") {
                let Some(end) = owned[begin + 2..].find("*/") else {
                    return Err(fault("E_LEX_INVALID", range(start, at)));
                };
                owned.replace_range(begin..begin + 2 + end + 2, " ");
            }
            if let Some(comment) = owned.find("//") {
                owned.truncate(comment)
            }
            let line = owned.trim();
            if let Some(rest) = line.strip_prefix("include") {
                let rest = rest.trim();
                let Some(header) = rest.strip_prefix('<').and_then(|x| x.strip_suffix('>')) else {
                    return Err(fault("E_MACRO_UNSUPPORTED", range(start, at)));
                };
                if ![
                    "stdio.h", "string.h", "ctype.h", "math.h", "stddef.h", "limits.h",
                ]
                .contains(&header)
                {
                    return Err(fault("E_UNSUPPORTED_SYNTAX", range(start, at)));
                }
                headers.insert(header.into());
                if header == "limits.h" {
                    for (k, v) in [
                        ("INT_MIN", "-2147483648"),
                        ("INT_MAX", "2147483647"),
                        ("UINT_MAX", "4294967295u"),
                        ("CHAR_MIN", "0"),
                        ("CHAR_MAX", "127"),
                    ] {
                        macros.insert(k.into(), v.into());
                    }
                }
                if header == "stdio.h" {
                    macros.insert("EOF".into(), "-1".into());
                }
                if ["stddef.h", "stdio.h", "string.h"].contains(&header) {
                    macros.insert("NULL".into(), "0".into());
                }
            } else if let Some(rest) = line.strip_prefix("define") {
                let rest = rest.trim_start();
                let end = rest
                    .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                    .unwrap_or(rest.len());
                let name = &rest[..end];
                let value = rest[end..].trim();
                if name.is_empty()
                    || name.as_bytes()[0].is_ascii_digit()
                    || rest[end..].starts_with('(')
                    || macros.contains_key(name)
                    || user_macros >= 32
                {
                    return Err(fault("E_MACRO_UNSUPPORTED", range(start, at)));
                }
                if value.starts_with('\'') {
                    let mut i = 1;
                    escaped(value.as_bytes(), &mut i).map_err(|e| fault(e, range(start, at)))?;
                    if value.as_bytes().get(i) != Some(&b'\'') || i + 1 != value.len() {
                        return Err(fault("E_MACRO_UNSUPPORTED", range(start, at)));
                    }
                } else {
                    let magnitude = value.strip_prefix(['-', '+']).unwrap_or(value);
                    // The signed minimum is represented by unary minus in the parser.
                    if !(value == "-2147483648") {
                        number(magnitude)
                            .map_err(|_| fault("E_MACRO_UNSUPPORTED", range(start, at)))?;
                    }
                }
                macros.insert(name.into(), value.into());
                user_macros += 1;
            } else {
                return Err(fault("E_MACRO_UNSUPPORTED", range(start, at)));
            }
            continue;
        }
        let start = at;
        if b.is_ascii_alphabetic() || b == b'_' {
            at += 1;
            while at < bytes.len() && (bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_') {
                at += 1
            }
            let text = source[start..at].to_string();
            if let Some(raw) = macros.get(&text) {
                let signed = raw.starts_with(['-', '+']);
                if signed {
                    out.push(Token {
                        kind: TokenKind::Symbol,
                        text: raw[..1].into(),
                        range: range(start, at),
                        origin: Some("preprocess.object-constant"),
                    });
                }
                let kind = if raw.starts_with('\'') {
                    let mut i = 1;
                    TokenKind::Char(
                        escaped(raw.as_bytes(), &mut i).map_err(|e| fault(e, range(start, at)))?,
                    )
                } else {
                    TokenKind::Number
                };
                out.push(Token {
                    kind,
                    text: if signed { raw[1..].into() } else { raw.clone() },
                    range: range(start, at),
                    origin: Some("preprocess.object-constant"),
                });
            } else {
                out.push(Token {
                    kind: TokenKind::Name,
                    text,
                    range: range(start, at),
                    origin: None,
                })
            }
            continue;
        }
        if b.is_ascii_digit() || (b == b'.' && bytes.get(at + 1).is_some_and(u8::is_ascii_digit)) {
            at += 1;
            while at < bytes.len() {
                let c = bytes[at];
                if c.is_ascii_alphanumeric()
                    || c == b'.'
                    || matches!(c, b'+' | b'-') && matches!(bytes[at - 1], b'e' | b'E')
                {
                    at += 1
                } else {
                    break;
                }
            }
            out.push(Token {
                kind: TokenKind::Number,
                text: source[start..at].into(),
                range: range(start, at),
                origin: None,
            });
            continue;
        }
        if b == b'\'' || b == b'"' {
            at += 1;
            let mut value = vec![];
            while at < bytes.len() && bytes[at] != b {
                value.push(escaped(bytes, &mut at).map_err(|e| fault(e, range(start, at)))?)
            }
            if bytes.get(at) != Some(&b) {
                return Err(fault("E_LEX_INVALID", range(start, at)));
            }
            at += 1;
            let kind = if b == b'\'' {
                if value.len() != 1 {
                    return Err(fault("E_CHAR_DOMAIN", range(start, at)));
                }
                TokenKind::Char(value[0])
            } else {
                if value.len() > 63 {
                    return Err(fault("E_STRING_BOUNDS", range(start, at)));
                }
                TokenKind::String(value)
            };
            out.push(Token {
                kind,
                text: source[start..at].into(),
                range: range(start, at),
                origin: None,
            });
            continue;
        }
        let mut found = None;
        for symbol in [
            "<<=", ">>=", "++", "--", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "&&",
            "||", "<<", ">>", "&=", "|=", "^=", "->",
        ] {
            if source[start..].starts_with(symbol) {
                found = Some(symbol);
                break;
            }
        }
        if let Some(symbol) = found {
            at += symbol.len();
            out.push(Token {
                kind: TokenKind::Symbol,
                text: symbol.into(),
                range: range(start, at),
                origin: None,
            });
            continue;
        }
        if b"{}()[];,.?:+-*/%~!&|^<>=:".contains(&b) {
            at += 1;
            out.push(Token {
                kind: TokenKind::Symbol,
                text: (b as char).to_string(),
                range: range(start, at),
                origin: None,
            });
            continue;
        }
        return Err(fault(
            "E_LEX_INVALID",
            range(
                start,
                start + source[start..].chars().next().unwrap().len_utf8(),
            ),
        ));
    }
    out.push(Token {
        kind: TokenKind::End,
        text: String::new(),
        range: range(at, at),
        origin: None,
    });
    Ok((out, headers, user_macros > 0))
}

struct Parser<'a> {
    tokens: Vec<Token>,
    at: usize,
    nodes: Vec<Node>,
    globals: Vec<Id>,
    functions: Vec<Function>,
    signatures: BTreeMap<String, Signature>,
    structs: BTreeMap<String, Vec<(String, Ty)>>,
    aliases: Vec<BTreeMap<String, Ty>>,
    all_aliases: Vec<Ty>,
    constants: Vec<BTreeMap<String, Val>>,
    headers: BTreeSet<String>,
    depth: usize,
    meter: &'a mut Meter,
    enum_count: usize,
    typedef_count: usize,
}
impl<'a> Parser<'a> {
    fn token(&self) -> &Token {
        &self.tokens[self.at]
    }
    fn is(&self, s: &str) -> bool {
        self.token().text == s
    }
    fn eat(&mut self, s: &str) -> bool {
        if self.is(s) {
            self.at += 1;
            true
        } else {
            false
        }
    }
    fn take(&mut self, s: &str) -> Result<Token, Fault> {
        if !self.is(s) {
            return Err(self.err("E_PARSE_INVALID"));
        }
        let t = self.token().clone();
        self.at += 1;
        Ok(t)
    }
    fn err(&self, c: &'static str) -> Fault {
        fault(c, self.token().range)
    }
    fn name(&mut self) -> Result<Token, Fault> {
        let t = self.token().clone();
        if !matches!(t.kind, TokenKind::Name) || keyword(&t.text) {
            return Err(self.err("E_NAME_INVALID"));
        }
        self.at += 1;
        Ok(t)
    }
    fn push(&mut self, k: Kind, r: ByteRange) -> Result<Id, Fault> {
        charge(self.meter, 1, r)?;
        let depth = k
            .children()
            .iter()
            .map(|id| self.nodes[*id].depth)
            .max()
            .unwrap_or(0)
            + 1;
        if depth > self.meter.limits().max_ast_depth {
            return Err(fault("E_DEPTH_LIMIT", r));
        }
        let id = self.nodes.len();
        self.nodes.push(Node {
            kind: k,
            range: r,
            depth,
        });
        Ok(id)
    }
    fn expr_node(&mut self, e: Expr, r: ByteRange) -> Result<Id, Fault> {
        self.push(Kind::Expression(e), r)
    }
    fn alias(&self, n: &str) -> Option<Ty> {
        self.aliases.iter().rev().find_map(|a| a.get(n).cloned())
    }
    fn constant(&self, n: &str) -> Option<Val> {
        self.constants.iter().rev().find_map(|a| a.get(n).cloned())
    }
    fn is_type(&self) -> bool {
        [
            "int", "signed", "unsigned", "char", "float", "double", "void", "struct", "enum",
            "const",
        ]
        .contains(&self.token().text.as_str())
            || self.alias(&self.token().text).is_some()
    }
    fn enter(&mut self) -> Result<(), Fault> {
        self.depth += 1;
        if self.depth > self.meter.limits().max_syntax_depth {
            return Err(self.err("E_DEPTH_LIMIT"));
        }
        Ok(())
    }
    fn base(&mut self) -> Result<Ty, Fault> {
        let constant = self.eat("const");
        let t = self.token().clone();
        let mut ty = if self.eat("int") {
            Ty::Int
        } else if self.eat("signed") {
            self.eat("int");
            Ty::Int
        } else if self.eat("unsigned") {
            self.eat("int");
            Ty::UInt
        } else if self.eat("char") {
            Ty::Char
        } else if self.eat("float") {
            Ty::F32
        } else if self.eat("double") {
            Ty::F64
        } else if self.eat("void") {
            Ty::Void
        } else if self.eat("struct") {
            let name =
                if matches!(self.token().kind, TokenKind::Name) && !keyword(&self.token().text) {
                    self.name()?.text
                } else if self.is("{") {
                    format!("anonymous_{}", self.nodes.len() + 1)
                } else {
                    return Err(self.err("E_NAME_INVALID"));
                };
            if self.eat("{") {
                if self.structs.len() >= 8 || self.structs.contains_key(&name) {
                    return Err(self.err("E_STRUCT_LIMIT"));
                }
                self.structs.insert(name.clone(), vec![]);
                let mut fields = vec![];
                while !self.is("}") {
                    let fbase = self.base()?;
                    loop {
                        let (field, ty) = self.declarator(fbase.clone(), false)?;
                        if matches!(ty.bare(), Ty::Struct(_) | Ty::Void)
                            || matches!(ty.bare(),Ty::Array(b,_) if b.bare()!=&Ty::Char)
                        {
                            return Err(fault("E_UNSUPPORTED_SYNTAX", field.range));
                        }
                        if fields.iter().any(|(n, _)| n == &field.text) {
                            return Err(fault("E_DUPLICATE", field.range));
                        }
                        fields.push((field.text, ty));
                        if fields.len() > 8 {
                            return Err(fault("E_FIELD_LIMIT", field.range));
                        }
                        self.push(Kind::Marker("field"), field.range)?;
                        if !self.eat(",") {
                            break;
                        }
                    }
                    self.take(";")?;
                }
                let end = self.take("}")?.range.end;
                if fields.is_empty() {
                    return Err(fault("E_TYPE_INVALID", range(t.range.start, end)));
                }
                self.structs.insert(name.clone(), fields);
                self.push(Kind::Marker("struct"), range(t.range.start, end))?;
            }
            Ty::Struct(name)
        } else if self.eat("enum") {
            let name =
                if matches!(self.token().kind, TokenKind::Name) && !keyword(&self.token().text) {
                    Some(self.name()?.text)
                } else {
                    None
                };
            if self.eat("{") {
                let mut next = Some(0i32);
                loop {
                    let key = self.name()?;
                    let value = if self.eat("=") {
                        let e = self.expression(1)?;
                        self.const_value(e)?
                            .cast(&Ty::Int)
                            .map_err(|c| fault(c, key.range))?
                    } else {
                        Val::I(next.ok_or_else(|| fault("E_OVERFLOW", key.range))?)
                    };
                    if self.enum_count >= 32
                        || self.constants.last().unwrap().contains_key(&key.text)
                    {
                        return Err(fault("E_DUPLICATE", key.range));
                    }
                    next = value.int().map_err(|c| fault(c, key.range))?.checked_add(1);
                    self.constants.last_mut().unwrap().insert(key.text, value);
                    self.enum_count += 1;
                    if !self.eat(",") || self.is("}") {
                        break;
                    }
                }
                let end = self.take("}")?.range.end;
                self.push(Kind::Marker("enum"), range(t.range.start, end))?;
                if let Some(name) = &name {
                    self.aliases
                        .last_mut()
                        .unwrap()
                        .insert(format!("enum {name}"), Ty::Int);
                }
            } else if name
                .as_ref()
                .is_none_or(|n| self.alias(&format!("enum {n}")).is_none())
            {
                return Err(self.err("E_TYPE_INVALID"));
            }
            name.map_or(Ty::Int, |n| {
                Ty::Alias(format!("enum {n}"), Box::new(Ty::Int))
            })
        } else if let Some(alias) = self.alias(&t.text) {
            self.at += 1;
            alias
        } else {
            return Err(self.err("E_UNSUPPORTED_SYNTAX"));
        };
        if self.eat("const") || constant {
            ty = Ty::Const(Box::new(ty))
        }
        Ok(ty)
    }
    fn pointers(&mut self, mut ty: Ty) -> Result<Ty, Fault> {
        if self.eat("*") {
            if ty.bare() == &Ty::Void || matches!(ty.bare(), Ty::Pointer(_) | Ty::Array(..)) {
                return Err(self.err("E_UNSUPPORTED_SYNTAX"));
            }
            ty = Ty::Pointer(Box::new(ty));
            if self.eat("const") {
                ty = Ty::Const(Box::new(ty))
            }
            if self.is("*") {
                return Err(self.err("E_UNSUPPORTED_SYNTAX"));
            }
        }
        Ok(ty)
    }
    fn declarator(&mut self, base: Ty, parameter: bool) -> Result<(Token, Ty), Fault> {
        let mut ty = self.pointers(base)?;
        let name = if parameter && (self.is(",") || self.is(")")) {
            Token {
                kind: TokenKind::Name,
                text: String::new(),
                range: self.token().range,
                origin: None,
            }
        } else {
            self.name()?
        };
        if self.eat("[") {
            if matches!(ty.bare(), Ty::Pointer(_)) {
                return Err(self.err("E_UNSUPPORTED_SYNTAX"));
            }
            let n = if self.is("]") {
                0
            } else {
                let e = self.expression(1)?;
                let v = self.const_value(e)?;
                v.int()
                    .or_else(|_| i32::try_from(v.uint()?).map_err(|_| "E_BOUNDS"))
                    .map_err(|c| fault(c, self.nodes[e].range))? as usize
            };
            self.take("]")?;
            if self.is("[") {
                return Err(self.err("E_UNSUPPORTED_SYNTAX"));
            }
            if parameter {
                ty = Ty::Pointer(Box::new(ty))
            } else {
                ty = Ty::Array(Box::new(ty), n)
            }
        }
        Ok((name, ty))
    }
    fn initializer(&mut self) -> Result<Init, Fault> {
        self.enter()?;
        let r = if self.eat("{") {
            let mut a = vec![];
            while !self.is("}") {
                a.push(self.initializer()?);
                if !self.eat(",") {
                    break;
                }
            }
            self.take("}")?;
            Init::Items(a)
        } else {
            Init::Expr(self.expression(1)?)
        };
        self.depth -= 1;
        Ok(r)
    }
    fn finish_decl(
        &mut self,
        name: Token,
        mut ty: Ty,
        static_storage: bool,
        global: bool,
    ) -> Result<Id, Fault> {
        if ty.bare() == &Ty::Void {
            return Err(fault("E_TYPE_INVALID", name.range));
        }
        let init = if self.eat("=") {
            self.initializer()?
        } else {
            Init::None
        };
        if let Ty::Array(base, 0) = ty.bare() {
            let count = match &init {
                Init::Items(v) => v.len(),
                Init::Expr(id) => match &self.nodes[*id].kind {
                    Kind::Expression(Expr::String(s)) if base.bare() == &Ty::Char => s.len() + 1,
                    _ => return Err(self.err("E_BOUNDS")),
                },
                _ => return Err(self.err("E_BOUNDS")),
            };
            ty = Ty::Array(base.clone(), count);
        }
        if let Ty::Array(base, n) = ty.bare()
            && (*n == 0 || *n > if base.bare() == &Ty::Char { 64 } else { 30 })
        {
            return Err(fault("E_BOUNDS", name.range));
        }
        let end = self.tokens[self.at.saturating_sub(1)].range.end;
        self.push(
            Kind::Declare(Decl {
                name: name.text,
                ty,
                init,
                static_storage,
                global,
            }),
            range(name.range.start, end),
        )
    }
    fn declaration(&mut self, global: bool) -> Result<Id, Fault> {
        let start = self.token().range.start;
        let static_storage = self.eat("static") || global;
        let typedef = self.eat("typedef");
        let base = self.base()?;
        if self.eat(";") {
            return self.push(
                Kind::Empty,
                range(start, self.tokens[self.at - 1].range.end),
            );
        }
        let mut ids = vec![];
        loop {
            let (name, ty) = self.declarator(base.clone(), false)?;
            if typedef {
                if self.typedef_count >= 32 || self.aliases.last().unwrap().contains_key(&name.text)
                {
                    return Err(fault("E_DUPLICATE", name.range));
                }
                let alias = Ty::Alias(name.text.clone(), Box::new(ty));
                self.aliases
                    .last_mut()
                    .unwrap()
                    .insert(name.text, alias.clone());
                self.all_aliases.push(alias);
                self.typedef_count += 1;
                ids.push(self.push(Kind::Marker("typedef"), name.range)?);
            } else {
                ids.push(self.finish_decl(name, ty, static_storage, global)?)
            }
            if !self.eat(",") {
                break;
            }
        }
        let end = self.take(";")?.range.end;
        self.push(Kind::Group(ids), range(start, end))
    }
    fn statement(&mut self) -> Result<Id, Fault> {
        self.enter()?;
        let result = self.statement_inner();
        self.depth -= 1;
        result
    }
    fn controlled_statement(&mut self) -> Result<Id, Fault> {
        if self.is_type() || self.is("static") || self.is("typedef") {
            return Err(self.err("E_PARSE_INVALID"));
        }
        self.statement()
    }
    fn statement_inner(&mut self) -> Result<Id, Fault> {
        let start = self.token().range.start;
        if self.eat("{") {
            self.aliases.push(BTreeMap::new());
            self.constants.push(BTreeMap::new());
            let mut stmts = vec![];
            while !self.is("}") {
                if matches!(self.token().kind, TokenKind::End) {
                    return Err(self.err("E_PARSE_INVALID"));
                }
                stmts.push(self.statement()?)
            }
            let end = self.take("}")?.range.end;
            self.aliases.pop();
            self.constants.pop();
            return self.push(Kind::Block(stmts), range(start, end));
        }
        if self.is_type() || self.is("static") || self.is("typedef") {
            return self.declaration(false);
        }
        if self.eat("if") {
            self.take("(")?;
            let condition = self.expression(1)?;
            self.take(")")?;
            let yes = self.controlled_statement()?;
            let no = if self.eat("else") {
                Some(self.controlled_statement()?)
            } else {
                None
            };
            let end = self.nodes[no.unwrap_or(yes)].range.end;
            return self.push(Kind::If { condition, yes, no }, range(start, end));
        }
        if self.eat("while") {
            self.take("(")?;
            let condition = self.expression(1)?;
            self.take(")")?;
            let body = self.controlled_statement()?;
            let end = self.nodes[body].range.end;
            return self.push(Kind::While { condition, body }, range(start, end));
        }
        if self.eat("do") {
            let body = self.controlled_statement()?;
            self.take("while")?;
            self.take("(")?;
            let condition = self.expression(1)?;
            self.take(")")?;
            let end = self.take(";")?.range.end;
            return self.push(Kind::DoWhile { body, condition }, range(start, end));
        }
        if self.eat("for") {
            self.take("(")?;
            self.aliases.push(BTreeMap::new());
            self.constants.push(BTreeMap::new());
            if self.is("static") {
                return Err(self.err("E_UNSUPPORTED_SYNTAX"));
            }
            let init = if self.eat(";") {
                None
            } else if self.is_type() || self.is("static") {
                Some(self.declaration(false)?)
            } else {
                let e = self.expression(1)?;
                self.take(";")?;
                Some(self.push(Kind::ExprStmt(e), self.nodes[e].range)?)
            };
            let condition = if self.eat(";") {
                None
            } else {
                let e = self.expression(1)?;
                self.take(";")?;
                Some(e)
            };
            let update = if self.is(")") {
                None
            } else {
                Some(self.expression(1)?)
            };
            self.take(")")?;
            let body = self.controlled_statement()?;
            self.aliases.pop();
            self.constants.pop();
            let end = self.nodes[body].range.end;
            return self.push(
                Kind::For {
                    init,
                    condition,
                    update,
                    body,
                },
                range(start, end),
            );
        }
        if self.eat("switch") {
            self.take("(")?;
            let value = self.expression(1)?;
            self.take(")")?;
            self.take("{")?;
            self.aliases.push(BTreeMap::new());
            self.constants.push(BTreeMap::new());
            let mut arms: Vec<Arm> = vec![];
            let mut labels = BTreeSet::new();
            let mut default = false;
            while !self.is("}") {
                if self.is("case") || self.is("default") {
                    let tok = self.token().clone();
                    let mut label_expr = None;
                    let label = if self.eat("case") {
                        let e = self.expression(2)?;
                        label_expr = Some(e);
                        let v = self.const_value(e)?;
                        if !v.ty().integral() {
                            return Err(self.err("E_TYPE_INVALID"));
                        }
                        let key = v.real().map_err(|c| fault(c, tok.range))? as i64;
                        if !labels.insert(key) {
                            return Err(self.err("E_DUPLICATE"));
                        }
                        Some(v)
                    } else {
                        self.at += 1;
                        if default {
                            return Err(self.err("E_DUPLICATE"));
                        }
                        default = true;
                        None
                    };
                    let end = self.take(":")?.range.end;
                    let node = self.push(Kind::Marker("case"), range(tok.range.start, end))?;
                    arms.push(Arm {
                        node,
                        label,
                        label_expr,
                        statements: vec![],
                    });
                } else {
                    if arms.is_empty() {
                        return Err(self.err("E_UNSUPPORTED_SYNTAX"));
                    }
                    let stmt = self.statement()?;
                    arms.last_mut().unwrap().statements.push(stmt);
                }
            }
            let end = self.take("}")?.range.end;
            self.aliases.pop();
            self.constants.pop();
            return self.push(Kind::Switch { value, arms }, range(start, end));
        }
        if self.eat("return") {
            let e = if self.is(";") {
                None
            } else {
                Some(self.expression(1)?)
            };
            let end = self.take(";")?.range.end;
            return self.push(Kind::Return(e), range(start, end));
        }
        for key in ["break", "continue"] {
            if self.eat(key) {
                let end = self.take(";")?.range.end;
                return self.push(
                    if key == "break" {
                        Kind::Break
                    } else {
                        Kind::Continue
                    },
                    range(start, end),
                );
            }
        }
        if self.eat(";") {
            return self.push(
                Kind::Empty,
                range(start, self.tokens[self.at - 1].range.end),
            );
        }
        let e = self.expression(1)?;
        let end = self.take(";")?.range.end;
        self.push(Kind::ExprStmt(e), range(start, end))
    }
    fn expression(&mut self, min: u8) -> Result<Id, Fault> {
        self.enter()?;
        let result = self.expression_inner(min);
        self.depth -= 1;
        result
    }
    fn expression_inner(&mut self, min: u8) -> Result<Id, Fault> {
        let tok = self.token().clone();
        let start = tok.range.start;
        self.at += 1;
        let mut left = match tok.kind {
            TokenKind::Number => self.expr_node(
                Expr::Literal(
                    number(&tok.text).map_err(|c| fault(c, tok.range))?,
                    tok.origin,
                ),
                tok.range,
            )?,
            TokenKind::Char(c) => {
                self.expr_node(Expr::Literal(Val::I(i32::from(c)), tok.origin), tok.range)?
            }
            TokenKind::String(mut text) => {
                while let TokenKind::String(next) = &self.token().kind {
                    text.extend(next);
                    self.at += 1
                }
                if text.len() > 63 {
                    return Err(fault("E_STRING_BOUNDS", tok.range));
                }
                self.expr_node(
                    Expr::String(text),
                    range(start, self.tokens[self.at - 1].range.end),
                )?
            }
            TokenKind::Name if tok.text == "sizeof" => {
                let e = if self.eat("(") {
                    if self.is_type() {
                        let base = self.base()?;
                        let ty = self.pointers(base)?;
                        self.take(")")?;
                        Expr::SizeType(ty)
                    } else {
                        let e = self.expression(1)?;
                        self.take(")")?;
                        Expr::SizeExpr(e)
                    }
                } else {
                    Expr::SizeExpr(self.expression(13)?)
                };
                self.expr_node(e, range(start, self.tokens[self.at - 1].range.end))?
            }
            TokenKind::Name => {
                if keyword(&tok.text) {
                    return Err(fault("E_UNSUPPORTED_SYNTAX", tok.range));
                }
                if let Some(v) = self.constant(&tok.text) {
                    self.expr_node(Expr::Literal(v, Some("type.enum")), tok.range)?
                } else {
                    self.expr_node(Expr::Name(tok.text), tok.range)?
                }
            }
            TokenKind::Symbol if tok.text == "(" => {
                if self.is_type() {
                    let base = self.base()?;
                    let ty = self.pointers(base)?;
                    self.take(")")?;
                    let a = self.expression(13)?;
                    self.expr_node(Expr::Cast(ty, a), range(start, self.nodes[a].range.end))?
                } else {
                    let a = self.expression(1)?;
                    self.take(")")?;
                    a
                }
            }
            TokenKind::Symbol
                if ["+", "-", "!", "~", "*", "&", "++", "--"].contains(&tok.text.as_str()) =>
            {
                if tok.text == "-" && self.token().text == "2147483648" {
                    let end = self.token().range.end;
                    self.at += 1;
                    self.expr_node(Expr::Literal(Val::I(i32::MIN), None), range(start, end))?
                } else {
                    let arg = self.expression(13)?;
                    self.expr_node(
                        Expr::Unary(tok.text, arg),
                        range(start, self.nodes[arg].range.end),
                    )?
                }
            }
            _ => return Err(fault("E_PARSE_INVALID", tok.range)),
        };
        loop {
            let text = self.token().text.clone();
            if min <= 14 && text == "(" {
                self.at += 1;
                let name = if let Kind::Expression(Expr::Name(n)) = &self.nodes[left].kind {
                    n.clone()
                } else {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX"));
                };
                let mut args = vec![];
                if !self.is(")") {
                    loop {
                        args.push(self.expression(1)?);
                        if args.len() > 9 {
                            return Err(self.err("E_PARAMETER_LIMIT"));
                        }
                        if !self.eat(",") {
                            break;
                        }
                    }
                }
                let end = self.take(")")?.range.end;
                left = self.expr_node(Expr::Call(name, args), range(start, end))?;
                continue;
            }
            if min <= 14 && text == "[" {
                self.at += 1;
                let index = self.expression(1)?;
                let end = self.take("]")?.range.end;
                left = self.expr_node(Expr::Index(left, index), range(start, end))?;
                continue;
            }
            if min <= 14 && (text == "." || text == "->") {
                self.at += 1;
                let field = self.name()?;
                let end = field.range.end;
                left = self.expr_node(
                    Expr::Member(left, field.text, text == "->"),
                    range(start, end),
                )?;
                continue;
            }
            if min <= 14 && (text == "++" || text == "--") {
                self.at += 1;
                left = self.expr_node(
                    Expr::Postfix(text, left),
                    range(start, self.tokens[self.at - 1].range.end),
                )?;
                continue;
            }
            if text == "?" && min <= 2 {
                self.at += 1;
                let yes = self.expression(1)?;
                self.take(":")?;
                let no = self.expression(2)?;
                left = self.expr_node(
                    Expr::Conditional(left, yes, no),
                    range(start, self.nodes[no].range.end),
                )?;
                continue;
            }
            let Some((precedence, assign)) = precedence(&text) else {
                break;
            };
            if precedence < min {
                break;
            }
            self.at += 1;
            let right = self.expression(if assign { precedence } else { precedence + 1 })?;
            let end = self.nodes[right].range.end;
            left = self.expr_node(
                if assign {
                    Expr::Assign(text, left, right)
                } else {
                    Expr::Binary(text, left, right)
                },
                range(start, end),
            )?;
        }
        Ok(left)
    }
    fn const_value(&self, id: Id) -> Result<Val, Fault> {
        let r = self.nodes[id].range;
        let v = match &self.nodes[id].kind {
            Kind::Expression(Expr::Literal(v, _)) => Ok(v.clone()),
            Kind::Expression(Expr::Unary(op, a)) => types::unary(op, &self.const_value(*a)?),
            Kind::Expression(Expr::Binary(op, a, b)) => {
                types::binary(op, &self.const_value(*a)?, &self.const_value(*b)?)
            }
            Kind::Expression(Expr::Cast(t, a)) => self.const_value(*a)?.cast(t),
            _ => Err("E_UNSUPPORTED_SYNTAX"),
        };
        v.map_err(|c| fault(c, r))
    }
    fn top(&mut self) -> Result<(), Fault> {
        while !matches!(self.token().kind, TokenKind::End) {
            if self.is("typedef") {
                self.declaration(true)?;
                continue;
            }
            let start = self.token().range.start;
            let static_storage = self.eat("static");
            let base = self.base()?;
            if self.eat(";") {
                continue;
            }
            let (name, ty) = self.declarator(base.clone(), false)?;
            if self.eat("(") {
                let mut params = vec![];
                if !(self.is("void") && self.tokens.get(self.at + 1).is_some_and(|t| t.text == ")"))
                    && !self.is(")")
                {
                    loop {
                        let pbase = self.base()?;
                        let (pname, pty) = self.declarator(pbase, true)?;
                        let pnode = self.push(Kind::Marker("parameter"), pname.range)?;
                        params.push(Param {
                            name: pname.text,
                            ty: pty,
                            node: pnode,
                        });
                        if params.len() > 8 {
                            return Err(self.err("E_PARAMETER_LIMIT"));
                        }
                        if !self.eat(",") {
                            break;
                        }
                    }
                } else {
                    self.eat("void");
                }
                self.take(")")?;
                let sig = Signature {
                    result: ty.clone(),
                    params: params.iter().map(|p| p.ty.clone()).collect(),
                    declared_at: start,
                };
                if let Some(old) = self.signatures.get(&name.text) {
                    if old.result.signature_key() != sig.result.signature_key()
                        || old.params.iter().map(Ty::signature_key).collect::<Vec<_>>()
                            != sig.params.iter().map(Ty::signature_key).collect::<Vec<_>>()
                    {
                        return Err(fault("E_TYPE_INVALID", name.range));
                    }
                } else {
                    if self.signatures.len() >= 32 {
                        return Err(fault("E_FUNCTION_LIMIT", name.range));
                    }
                    self.signatures.insert(name.text.clone(), sig);
                }
                if self.eat(";") {
                    self.push(
                        Kind::Marker("prototype"),
                        range(start, self.tokens[self.at - 1].range.end),
                    )?;
                    continue;
                }
                if !self.is("{") || self.functions.iter().any(|f| f.name == name.text) {
                    return Err(fault("E_DUPLICATE", name.range));
                }
                if params.iter().any(|p| p.name.is_empty()) {
                    return Err(fault("E_NAME_INVALID", name.range));
                }
                let body = self.statement()?;
                let node = self.push(
                    Kind::Marker("function"),
                    range(start, self.nodes[body].range.end),
                )?;
                self.functions.push(Function {
                    name: name.text,
                    result: ty,
                    params,
                    body,
                    node,
                });
            } else {
                let first = self.finish_decl(name, ty, static_storage, true)?;
                self.globals.push(first);
                while self.eat(",") {
                    let (n, t) = self.declarator(base.clone(), false)?;
                    let id = self.finish_decl(n, t, static_storage, true)?;
                    self.globals.push(id)
                }
                self.take(";")?;
            }
        }
        Ok(())
    }
}
fn keyword(s: &str) -> bool {
    [
        "int", "unsigned", "signed", "char", "float", "double", "void", "const", "static",
        "typedef", "struct", "enum", "if", "else", "while", "do", "for", "switch", "case",
        "default", "return", "break", "continue", "sizeof", "long", "short", "_Bool", "union",
        "goto", "extern", "volatile", "restrict", "auto", "register", "_Atomic",
    ]
    .contains(&s)
}
fn precedence(s: &str) -> Option<(u8, bool)> {
    Some(match s {
        "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=" => (1, true),
        "||" => (3, false),
        "&&" => (4, false),
        "|" => (5, false),
        "^" => (6, false),
        "&" => (7, false),
        "==" | "!=" => (8, false),
        "<" | "<=" | ">" | ">=" => (9, false),
        "<<" | ">>" => (10, false),
        "+" | "-" => (11, false),
        "*" | "/" | "%" => (12, false),
        _ => return None,
    })
}
pub fn parse(source: &str, meter: &mut Meter) -> Result<Program, Fault> {
    if source.len() > meter.limits().source_bytes {
        return Err(fault("E_SOURCE_LIMIT", range(0, source.len())));
    }
    let (tokens, headers, has_object_macros) = lex(source, meter)?;
    let mut aliases = BTreeMap::new();
    if headers.contains("stddef.h") {
        aliases.insert(
            "size_t".into(),
            Ty::Alias("size_t".into(), Box::new(Ty::UInt)),
        );
        aliases.insert(
            "ptrdiff_t".into(),
            Ty::Alias("ptrdiff_t".into(), Box::new(Ty::Int)),
        );
    }
    let mut p = Parser {
        tokens,
        at: 0,
        nodes: vec![],
        globals: vec![],
        functions: vec![],
        signatures: BTreeMap::new(),
        structs: BTreeMap::new(),
        aliases: vec![aliases],
        all_aliases: vec![],
        constants: vec![BTreeMap::new()],
        headers,
        depth: 0,
        meter,
        enum_count: 0,
        typedef_count: 0,
    };
    p.top()?;
    let root = p.push(Kind::Marker("translation-unit"), range(0, source.len()))?;
    Ok(Program {
        root,
        nodes: p.nodes,
        globals: p.globals,
        functions: p.functions,
        signatures: p.signatures,
        structs: p.structs,
        headers: p.headers,
        aliases: p.all_aliases,
        has_object_macros,
    })
}
