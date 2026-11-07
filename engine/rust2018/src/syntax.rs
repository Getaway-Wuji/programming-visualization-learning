use std::collections::BTreeMap;

use serde::Serialize;

use crate::source::ByteRange;
use crate::{Fault, Meter, charge, span};

type Result<T> = std::result::Result<T, Fault>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Type {
    Unit,
    I32,
    Bool,
    String,
    Array(usize),
    Ref(bool, Box<Type>),
}

impl Type {
    pub(crate) fn wire(&self) -> String {
        match self {
            Self::Unit => "unit".to_owned(),
            Self::I32 => "i32".to_owned(),
            Self::Bool => "bool".to_owned(),
            Self::String => "String".to_owned(),
            Self::Array(length) => format!("[i32;{length}]"),
            Self::Ref(mutable, inner) => {
                format!("&{}{}", if *mutable { "mut " } else { "" }, inner.wire())
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Node {
    #[serde(serialize_with = "crate::serialize_range")]
    pub byte_range: ByteRange,
    pub id: u32,
    pub kind: String,
}

#[derive(Clone, Debug)]
pub(crate) struct Program {
    pub functions: BTreeMap<String, Function>,
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug)]
pub(crate) struct Expr {
    pub id: u32,
    pub range: ByteRange,
    pub kind: ExprKind,
}

#[derive(Clone, Debug)]
pub(crate) enum ExprKind {
    Int(i32),
    Bool(bool),
    Text(String),
    Name(String),
    Unary(String, Box<Expr>),
    Binary(String, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    If(Box<Expr>, Block, Option<Box<Expr>>),
    Block(Block),
    Array(Vec<Expr>),
    Repeat(Box<Expr>, usize),
    Index(Box<Expr>, usize),
    Borrow(bool, String),
    Method(Box<Expr>, String, Vec<Expr>),
    Parse(String),
    StringNew,
    StringFrom(String),
}

#[derive(Clone, Debug)]
pub(crate) struct Stmt {
    pub id: u32,
    pub range: ByteRange,
    pub kind: StmtKind,
}

#[derive(Clone, Debug)]
pub(crate) enum StmtKind {
    Let {
        name: String,
        mutable: bool,
        annotation: Option<Type>,
        value: Expr,
    },
    Assign {
        target: Expr,
        value: Expr,
    },
    Expression(Expr),
    While(Expr, Block),
    Loop(Block),
    For {
        name: String,
        iter: ForIter,
        body: Block,
    },
    Return(Option<Expr>),
    Break,
    Continue,
    Print {
        newline: bool,
        format: String,
        args: Vec<Expr>,
    },
    ReadLine(String),
}

#[derive(Clone, Debug)]
pub(crate) enum ForIter {
    Range {
        start: Expr,
        end: Expr,
        inclusive: bool,
    },
    Array(Expr),
}

#[derive(Clone, Debug)]
pub(crate) struct Block {
    pub id: u32,
    pub range: ByteRange,
    pub statements: Vec<Stmt>,
    pub tail: Option<Box<Expr>>,
}

#[derive(Clone, Debug)]
pub(crate) struct Function {
    pub id: u32,
    pub range: ByteRange,
    pub name: String,
    pub params: Vec<Param>,
    pub result: Type,
    pub body: Block,
}

#[derive(Clone, Debug)]
pub(crate) struct Param {
    pub id: u32,
    pub name: String,
    pub mutable: bool,
    pub ty: Type,
    pub range: ByteRange,
}

#[derive(Clone, Debug)]
enum TokenKind {
    Word(String),
    Number(u64),
    Text(String),
    Symbol(&'static str),
    Eof,
}

#[derive(Clone, Debug)]
struct Token {
    kind: TokenKind,
    range: ByteRange,
}

fn fault(code: &'static str, range: ByteRange) -> Fault {
    Fault::new(code, range)
}

fn lex(source: &str, meter: &mut Meter) -> Result<Vec<Token>> {
    let bytes = source.as_bytes();
    charge(meter, bytes.len(), span(0, bytes.len()))?;
    let mut tokens = Vec::new();
    let mut position = if source.starts_with('\u{feff}') { 3 } else { 0 };
    while let Some(&byte) = bytes.get(position) {
        let start = position;
        let tail = &source[position..];
        if byte.is_ascii_whitespace() {
            position += 1;
            continue;
        }
        if tail.starts_with("//") {
            position += tail.find(['\r', '\n']).unwrap_or(tail.len());
            continue;
        }
        if tail.starts_with("/*") {
            position += 2;
            let mut depth = 1;
            while depth > 0 {
                let rest = &source[position..];
                if rest.starts_with("/*") {
                    depth += 1;
                    if depth > 64 {
                        return Err(fault("E_DEPTH_LIMIT", span(start, position + 2)));
                    }
                    position += 2;
                } else if rest.starts_with("*/") {
                    depth -= 1;
                    position += 2;
                } else if let Some(c) = rest.chars().next() {
                    position += c.len_utf8();
                } else {
                    return Err(fault("E_LEX", span(start, position)));
                }
            }
            continue;
        }
        let kind = if byte.is_ascii_alphabetic() || byte == b'_' {
            position += 1;
            while bytes
                .get(position)
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            {
                position += 1;
            }
            if position - start > 64 {
                return Err(fault("E_UNSUPPORTED", span(start, position)));
            }
            TokenKind::Word(source[start..position].to_owned())
        } else if byte.is_ascii_digit() {
            position += 1;
            while bytes
                .get(position)
                .is_some_and(|b| b.is_ascii_digit() || *b == b'_')
            {
                position += 1;
            }
            if bytes.get(position).is_some_and(|b| b.is_ascii_alphabetic()) {
                return Err(fault("E_UNSUPPORTED", span(start, position + 1)));
            }
            let number = source[start..position]
                .replace('_', "")
                .parse::<u64>()
                .map_err(|_| fault("E_OVERFLOW", span(start, position)))?;
            TokenKind::Number(number)
        } else if byte == b'"' {
            let (text, end) = string_literal(source, start)?;
            position = end;
            TokenKind::Text(text)
        } else {
            let symbol = [
                "..=", "::", "->", "..", "==", "!=", "<=", ">=", "&&", "||", "(", ")", "{", "}",
                "[", "]", ";", ",", ".", ":", "=", "+", "-", "*", "/", "%", "<", ">", "!", "&",
            ]
            .into_iter()
            .find(|symbol| tail.starts_with(symbol))
            .ok_or_else(|| {
                fault(
                    "E_UNSUPPORTED",
                    span(start, start + tail.chars().next().map_or(1, char::len_utf8)),
                )
            })?;
            position += symbol.len();
            TokenKind::Symbol(symbol)
        };
        let range = span(start, position);
        charge(meter, 1, range)?;
        tokens.push(Token { kind, range });
    }
    tokens.push(Token {
        kind: TokenKind::Eof,
        range: span(position, position),
    });
    Ok(tokens)
}

fn string_literal(source: &str, start: usize) -> Result<(String, usize)> {
    let mut value = String::new();
    let mut chars = source[start + 1..].char_indices();
    while let Some((offset, c)) = chars.next() {
        let end = start + 1 + offset + c.len_utf8();
        match c {
            '"' => return Ok((value, end)),
            '\n' | '\r' => return Err(fault("E_LEX", span(start, end))),
            '\\' => {
                let escaped = chars
                    .next()
                    .ok_or_else(|| fault("E_LEX", span(start, source.len())))?
                    .1;
                let decoded = match escaped {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    '0' => '\0',
                    '\\' => '\\',
                    '"' => '"',
                    'x' => {
                        let a = chars.next().and_then(|(_, c)| c.to_digit(16));
                        let b = chars.next().and_then(|(_, c)| c.to_digit(16));
                        let scalar = a
                            .zip(b)
                            .map(|(a, b)| a * 16 + b)
                            .filter(|v| *v <= 127)
                            .ok_or_else(|| fault("E_LEX", span(start, end)))?;
                        char::from_u32(scalar).ok_or_else(|| fault("E_LEX", span(start, end)))?
                    }
                    'u' => {
                        if chars.next().map(|(_, c)| c) != Some('{') {
                            return Err(fault("E_LEX", span(start, end)));
                        }
                        let mut digits = String::new();
                        let mut closed = false;
                        for (_, c) in chars.by_ref() {
                            if c == '}' {
                                closed = true;
                                break;
                            }
                            if c != '_' {
                                digits.push(c);
                            }
                            if digits.len() > 6 {
                                return Err(fault("E_LEX", span(start, end)));
                            }
                        }
                        if !closed {
                            return Err(fault("E_LEX", span(start, end)));
                        }
                        u32::from_str_radix(&digits, 16)
                            .ok()
                            .and_then(char::from_u32)
                            .ok_or_else(|| fault("E_LEX", span(start, end)))?
                    }
                    _ => return Err(fault("E_LEX", span(start, end))),
                };
                value.push(decoded);
            }
            _ => value.push(c),
        }
        if value.len() > 4096 {
            return Err(fault("E_MEMORY_LIMIT", span(start, end)));
        }
    }
    Err(fault("E_LEX", span(start, source.len())))
}

pub(crate) fn parse(source: &str, meter: &mut Meter) -> Result<Program> {
    let tokens = lex(source, meter)?;
    let mut parser = Parser {
        tokens,
        position: 0,
        nodes: Vec::new(),
        roots: Vec::new(),
        depth: 0,
        meter,
    };
    let mut functions = BTreeMap::new();
    while !matches!(parser.token().kind, TokenKind::Eof) {
        if !parser.is("fn") {
            return Err(parser.error("E_UNSUPPORTED"));
        }
        let function = parser.function()?;
        if functions.insert(function.name.clone(), function).is_some() {
            return Err(parser.error("E_NAME"));
        }
        if functions.len() > 32 {
            return Err(parser.error("E_MEMORY_LIMIT"));
        }
    }
    let program = Program {
        functions,
        nodes: parser.nodes,
    };
    Ok(program)
}

struct Parser<'a> {
    tokens: Vec<Token>,
    position: usize,
    nodes: Vec<Node>,
    roots: Vec<(ByteRange, usize)>,
    depth: usize,
    meter: &'a mut Meter,
}

impl Parser<'_> {
    fn token(&self) -> &Token {
        &self.tokens[self.position]
    }
    fn is(&self, expected: &str) -> bool {
        match &self.token().kind {
            TokenKind::Word(word) => word == expected,
            TokenKind::Symbol(symbol) => *symbol == expected,
            _ => false,
        }
    }
    fn take(&mut self, expected: &str) -> bool {
        if self.is(expected) {
            self.position += 1;
            true
        } else {
            false
        }
    }
    fn error(&self, code: &'static str) -> Fault {
        fault(code, self.token().range)
    }
    fn need(&mut self, expected: &str) -> Result<()> {
        if self.take(expected) {
            Ok(())
        } else {
            Err(self.error("E_SYNTAX"))
        }
    }
    fn last_end(&self) -> usize {
        self.tokens[self.position.saturating_sub(1)].range.end
    }
    fn node(&mut self, kind: &str, range: ByteRange) -> Result<u32> {
        if self.nodes.len() >= 32768 {
            return Err(fault("E_MEMORY_LIMIT", range));
        }
        charge(self.meter, 1, range)?;
        // Nodes are emitted in source ordered postorder. Collapsing the roots
        // contained by this range bounds tree depth before allocating a chain.
        let mut depth = 1;
        while let Some(&(child, child_depth)) = self.roots.last() {
            if child.start < range.start || child.end > range.end {
                break;
            }
            self.roots.pop();
            depth = depth.max(child_depth + 1);
        }
        if depth > 64 {
            return Err(fault("E_DEPTH_LIMIT", range));
        }
        self.roots.push((range, depth));
        let id = self.nodes.len() as u32 + 1;
        self.nodes.push(Node {
            id,
            kind: kind.to_owned(),
            byte_range: range,
        });
        Ok(id)
    }
    fn name(&mut self) -> Result<String> {
        let token = self.token().clone();
        let TokenKind::Word(name) = token.kind else {
            return Err(self.error("E_SYNTAX"));
        };
        if matches!(
            name.as_str(),
            "_" | "fn"
                | "let"
                | "mut"
                | "if"
                | "else"
                | "while"
                | "loop"
                | "for"
                | "in"
                | "return"
                | "break"
                | "continue"
                | "true"
                | "false"
                | "struct"
                | "enum"
                | "match"
                | "use"
                | "mod"
                | "pub"
                | "trait"
                | "impl"
                | "const"
                | "static"
                | "unsafe"
                | "async"
                | "await"
                | "move"
                | "where"
                | "as"
                | "type"
                | "ref"
                | "self"
                | "Self"
        ) {
            return Err(fault("E_UNSUPPORTED", token.range));
        }
        self.position += 1;
        Ok(name)
    }
    fn text(&mut self) -> Result<String> {
        let TokenKind::Text(text) = self.token().kind.clone() else {
            return Err(self.error("E_SYNTAX"));
        };
        self.position += 1;
        Ok(text)
    }
    fn natural(&mut self) -> Result<usize> {
        let TokenKind::Number(value) = self.token().kind else {
            return Err(self.error("E_UNSUPPORTED"));
        };
        self.position += 1;
        usize::try_from(value).map_err(|_| self.error("E_UNSUPPORTED"))
    }
    fn ty(&mut self) -> Result<Type> {
        if self.take("&") {
            let mutable = self.take("mut");
            let inner = self.ty()?;
            if !matches!(inner, Type::I32 | Type::String) {
                return Err(self.error("E_UNSUPPORTED"));
            }
            return Ok(Type::Ref(mutable, Box::new(inner)));
        }
        if self.take("(") {
            self.need(")")?;
            return Ok(Type::Unit);
        }
        if self.take("[") {
            self.need("i32")?;
            self.need(";")?;
            let length = self.natural()?;
            self.need("]")?;
            if !(1..=30).contains(&length) {
                return Err(self.error("E_UNSUPPORTED"));
            }
            return Ok(Type::Array(length));
        }
        for (word, ty) in [
            ("i32", Type::I32),
            ("bool", Type::Bool),
            ("String", Type::String),
        ] {
            if self.take(word) {
                return Ok(ty);
            }
        }
        Err(self.error("E_UNSUPPORTED"))
    }
    fn function(&mut self) -> Result<Function> {
        let start = self.token().range.start;
        self.need("fn")?;
        let name = self.name()?;
        self.need("(")?;
        let mut params = Vec::new();
        if !self.take(")") {
            loop {
                let param_start = self.token().range.start;
                let mutable = self.take("mut");
                let name = self.name()?;
                self.need(":")?;
                let ty = self.ty()?;
                let range = span(param_start, self.last_end());
                let id = self.node("param", range)?;
                params.push(Param {
                    id,
                    name,
                    mutable,
                    ty,
                    range,
                });
                if params.len() > 8 {
                    return Err(fault("E_ARITY", range));
                }
                if self.take(")") {
                    break;
                }
                self.need(",")?;
                if self.take(")") {
                    break;
                }
            }
        }
        let result = if self.take("->") {
            self.ty()?
        } else {
            Type::Unit
        };
        let body = self.block()?;
        let range = span(start, body.range.end);
        let id = self.node("function", range)?;
        Ok(Function {
            id,
            range,
            name,
            params,
            result,
            body,
        })
    }
    fn block(&mut self) -> Result<Block> {
        self.depth += 1;
        if self.depth > 64 {
            return Err(self.error("E_DEPTH_LIMIT"));
        }
        let result = self.block_inner();
        self.depth -= 1;
        result
    }
    fn block_inner(&mut self) -> Result<Block> {
        let start = self.token().range.start;
        self.need("{")?;
        let mut statements = Vec::new();
        let mut tail = None;
        while !self.take("}") {
            if matches!(self.token().kind, TokenKind::Eof) {
                return Err(self.error("E_SYNTAX"));
            }
            if self.take(";") {
                continue;
            }
            if let Some(statement) = self.statement()? {
                statements.push(statement);
                continue;
            }
            let parenthesized = self.is("(");
            let value = self.expression(0)?;
            let begin = value.range.start;
            if self.take("=") {
                let assigned = self.expression(0)?;
                self.need(";")?;
                let range = span(begin, self.last_end());
                let id = self.node("assign", range)?;
                statements.push(Stmt {
                    id,
                    range,
                    kind: StmtKind::Assign {
                        target: value,
                        value: assigned,
                    },
                });
            } else if self.take(";") {
                let range = span(begin, self.last_end());
                let id = self.node("expression", range)?;
                statements.push(Stmt {
                    id,
                    range,
                    kind: StmtKind::Expression(value),
                });
            } else if self.is("}") {
                tail = Some(Box::new(value));
                self.need("}")?;
                break;
            } else if !parenthesized && matches!(value.kind, ExprKind::If(..) | ExprKind::Block(..))
            {
                let range = value.range;
                let id = self.node("expression", range)?;
                statements.push(Stmt {
                    id,
                    range,
                    kind: StmtKind::Expression(value),
                });
            } else {
                return Err(self.error("E_SYNTAX"));
            }
        }
        let range = span(start, self.last_end());
        let id = self.node("block", range)?;
        Ok(Block {
            id,
            range,
            statements,
            tail,
        })
    }
    fn statement(&mut self) -> Result<Option<Stmt>> {
        let start = self.token().range.start;
        let (label, kind) = if self.take("let") {
            let mutable = self.take("mut");
            let name = self.name()?;
            let annotation = if self.take(":") {
                Some(self.ty()?)
            } else {
                None
            };
            if !self.take("=") {
                return Err(self.error("E_UNSUPPORTED"));
            }
            let value = self.expression(0)?;
            self.need(";")?;
            (
                "let",
                StmtKind::Let {
                    name,
                    mutable,
                    annotation,
                    value,
                },
            )
        } else if self.take("while") {
            let condition = self.expression(0)?;
            let body = self.block()?;
            ("while", StmtKind::While(condition, body))
        } else if self.take("loop") {
            ("loop", StmtKind::Loop(self.block()?))
        } else if self.take("for") {
            let name = self.name()?;
            self.need("in")?;
            let first = self.expression(0)?;
            let iter = if self.is("..") || self.is("..=") {
                let inclusive = self.take("..=");
                if !inclusive {
                    self.need("..")?;
                }
                ForIter::Range {
                    start: first,
                    end: self.expression(0)?,
                    inclusive,
                }
            } else {
                ForIter::Array(first)
            };
            let body = self.block()?;
            ("for", StmtKind::For { name, iter, body })
        } else if self.take("return") {
            let value = if self.is(";") || self.is("}") {
                None
            } else {
                Some(self.expression(0)?)
            };
            if !self.take(";") && !self.is("}") {
                return Err(self.error("E_SYNTAX"));
            }
            ("return", StmtKind::Return(value))
        } else if self.take("break") {
            if !self.take(";") && !self.is("}") {
                return Err(self.error("E_UNSUPPORTED"));
            }
            ("break", StmtKind::Break)
        } else if self.take("continue") {
            if !self.take(";") && !self.is("}") {
                return Err(self.error("E_UNSUPPORTED"));
            }
            ("continue", StmtKind::Continue)
        } else if self.is("print") || self.is("println") {
            let newline = self.take("println");
            if !newline {
                self.need("print")?;
            }
            self.need("!")?;
            self.need("(")?;
            let format = self.text()?;
            let mut args = Vec::new();
            while self.take(",") {
                if self.is(")") {
                    break;
                }
                args.push(self.expression(0)?);
            }
            self.need(")")?;
            self.need(";")?;
            (
                "print",
                StmtKind::Print {
                    newline,
                    format,
                    args,
                },
            )
        } else if self.take("std") {
            for symbol in [
                "::",
                "io",
                "::",
                "stdin",
                "(",
                ")",
                ".",
                "read_line",
                "(",
                "&",
                "mut",
            ] {
                self.need(symbol)?;
            }
            let name = self.name()?;
            for symbol in [")", ".", "unwrap", "(", ")", ";"] {
                self.need(symbol)?;
            }
            ("read-line", StmtKind::ReadLine(name))
        } else {
            return Ok(None);
        };
        let range = span(start, self.last_end());
        let id = self.node(label, range)?;
        Ok(Some(Stmt { id, range, kind }))
    }
    fn expression(&mut self, minimum: u8) -> Result<Expr> {
        self.depth += 1;
        if self.depth > 64 {
            return Err(self.error("E_DEPTH_LIMIT"));
        }
        let result = self.expression_inner(minimum);
        self.depth -= 1;
        result
    }
    fn expression_inner(&mut self, minimum: u8) -> Result<Expr> {
        let mut left = self.prefix()?;
        loop {
            let op = [
                "||", "&&", "==", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%",
            ]
            .into_iter()
            .find(|op| self.is(op));
            let Some(op) = op else {
                break;
            };
            let precedence = match op {
                "||" => 1,
                "&&" => 2,
                "==" | "!=" => 3,
                "<" | "<=" | ">" | ">=" => 4,
                "+" | "-" => 5,
                _ => 6,
            };
            if precedence < minimum {
                break;
            }
            self.position += 1;
            let right = self.expression(precedence + 1)?;
            let range = span(left.range.start, right.range.end);
            let id = self.node("binary", range)?;
            left = Expr {
                id,
                range,
                kind: ExprKind::Binary(op.to_owned(), Box::new(left), Box::new(right)),
            };
        }
        Ok(left)
    }
    fn prefix(&mut self) -> Result<Expr> {
        let start = self.token().range.start;
        if self.is("-") || self.is("!") || self.is("*") {
            let TokenKind::Symbol(op) = self.token().kind else {
                return Err(self.error("E_SYNTAX"));
            };
            self.position += 1;
            if op == "-" && matches!(self.token().kind, TokenKind::Number(2_147_483_648)) {
                self.position += 1;
                let range = span(start, self.last_end());
                let id = self.node("int", range)?;
                return Ok(Expr {
                    id,
                    range,
                    kind: ExprKind::Int(i32::MIN),
                });
            }
            let right = self.expression(7)?;
            let range = span(start, right.range.end);
            let id = self.node("unary", range)?;
            return Ok(Expr {
                id,
                range,
                kind: ExprKind::Unary(op.to_owned(), Box::new(right)),
            });
        }
        if self.take("&") {
            let mutable = self.take("mut");
            let name = self.name()?;
            let range = span(start, self.last_end());
            let id = self.node("borrow", range)?;
            return Ok(Expr {
                id,
                range,
                kind: ExprKind::Borrow(mutable, name),
            });
        }
        let mut value = self.primary()?;
        loop {
            if self.take("[") {
                let index = self.natural()?;
                self.need("]")?;
                let range = span(value.range.start, self.last_end());
                let id = self.node("index", range)?;
                value = Expr {
                    id,
                    range,
                    kind: ExprKind::Index(Box::new(value), index),
                };
            } else if self.take(".") {
                let method = self.name()?;
                if method == "trim" {
                    self.need("(")?;
                    self.need(")")?;
                    self.need(".")?;
                    self.need("parse")?;
                    let explicit = self.take("::");
                    if explicit {
                        self.need("<")?;
                        self.need("i32")?;
                        self.need(">")?;
                    }
                    for symbol in ["(", ")", ".", "unwrap", "(", ")"] {
                        self.need(symbol)?;
                    }
                    let ExprKind::Name(name) = value.kind else {
                        return Err(fault("E_UNSUPPORTED", value.range));
                    };
                    let range = span(value.range.start, self.last_end());
                    let id = self.node(if explicit { "parse" } else { "parse-inferred" }, range)?;
                    value = Expr {
                        id,
                        range,
                        kind: ExprKind::Parse(name),
                    };
                } else {
                    self.need("(")?;
                    let args = self.arguments()?;
                    let range = span(value.range.start, self.last_end());
                    let id = self.node("method", range)?;
                    value = Expr {
                        id,
                        range,
                        kind: ExprKind::Method(Box::new(value), method, args),
                    };
                }
            } else {
                break;
            }
        }
        Ok(value)
    }
    fn arguments(&mut self) -> Result<Vec<Expr>> {
        let mut args = Vec::new();
        if self.take(")") {
            return Ok(args);
        }
        loop {
            args.push(self.expression(0)?);
            if self.take(")") {
                break;
            }
            self.need(",")?;
            if self.take(")") {
                break;
            }
        }
        Ok(args)
    }
    fn primary(&mut self) -> Result<Expr> {
        let start = self.token().range.start;
        let (label, kind) = if self.take("if") {
            let condition = self.expression(0)?;
            let yes = self.block()?;
            let no = if self.take("else") {
                if self.is("if") {
                    Some(Box::new(self.primary()?))
                } else {
                    let block = self.block()?;
                    Some(Box::new(Expr {
                        id: block.id,
                        range: block.range,
                        kind: ExprKind::Block(block),
                    }))
                }
            } else {
                None
            };
            ("if", ExprKind::If(Box::new(condition), yes, no))
        } else if self.is("{") {
            let block = self.block()?;
            return Ok(Expr {
                id: block.id,
                range: block.range,
                kind: ExprKind::Block(block),
            });
        } else if self.take("(") {
            if self.take(")") {
                let range = span(start, self.last_end());
                let id = self.node("block", range)?;
                return Ok(Expr {
                    id,
                    range,
                    kind: ExprKind::Block(Block {
                        id,
                        range,
                        statements: Vec::new(),
                        tail: None,
                    }),
                });
            }
            let value = self.expression(0)?;
            self.need(")")?;
            return Ok(value);
        } else if self.take("[") {
            if self.is("]") {
                return Err(self.error("E_UNSUPPORTED"));
            }
            let first = self.expression(0)?;
            if self.take(";") {
                let count = self.natural()?;
                self.need("]")?;
                if !(1..=30).contains(&count) {
                    return Err(self.error("E_UNSUPPORTED"));
                }
                ("repeat", ExprKind::Repeat(Box::new(first), count))
            } else {
                let mut values = vec![first];
                while self.take(",") {
                    if self.is("]") {
                        break;
                    }
                    values.push(self.expression(0)?);
                    if values.len() > 30 {
                        return Err(self.error("E_UNSUPPORTED"));
                    }
                }
                self.need("]")?;
                ("array", ExprKind::Array(values))
            }
        } else if self.take("String") {
            self.need("::")?;
            if self.take("new") {
                self.need("(")?;
                self.need(")")?;
                ("string-new", ExprKind::StringNew)
            } else if self.take("from") {
                self.need("(")?;
                let text = self.text()?;
                self.need(")")?;
                ("string-from", ExprKind::StringFrom(text))
            } else {
                return Err(self.error("E_UNSUPPORTED"));
            }
        } else {
            let token = self.token().clone();
            match token.kind {
                TokenKind::Number(number) => {
                    self.position += 1;
                    let number =
                        i32::try_from(number).map_err(|_| fault("E_OVERFLOW", token.range))?;
                    ("int", ExprKind::Int(number))
                }
                TokenKind::Text(text) => {
                    self.position += 1;
                    ("text", ExprKind::Text(text))
                }
                TokenKind::Word(word) if word == "true" || word == "false" => {
                    self.position += 1;
                    ("bool", ExprKind::Bool(word == "true"))
                }
                TokenKind::Word(_) => {
                    let name = self.name()?;
                    if self.is("!") || self.is("::") {
                        return Err(self.error("E_UNSUPPORTED"));
                    }
                    if self.take("(") {
                        ("call", ExprKind::Call(name, self.arguments()?))
                    } else {
                        ("name", ExprKind::Name(name))
                    }
                }
                _ => return Err(self.error("E_SYNTAX")),
            }
        };
        let range = span(start, self.last_end());
        let id = self.node(label, range)?;
        Ok(Expr { id, range, kind })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_fixed(source: &str) -> Result<Program> {
        let mut meter = Meter::new();
        meter.set_clock(1000, Box::new(|| 0));
        parse(source, &mut meter)
    }

    #[test]
    fn long_left_associated_tree_is_rejected_before_it_can_grow() {
        let source = format!(
            "fn main() {{ let total = {}; }}",
            vec!["1"; 12000].join("+")
        );
        assert_eq!(parse_fixed(&source).unwrap_err().code, "E_DEPTH_LIMIT");
        let source = format!("fn main() {{ {} }}", "let n = 1 + 2;".repeat(1000));
        parse_fixed(&source).unwrap();
    }

    #[test]
    fn parenthesized_if_still_requires_a_statement_semicolon() {
        assert_eq!(
            parse_fixed("fn main() { (if true {} else {}) let n = 1; }")
                .unwrap_err()
                .code,
            "E_SYNTAX"
        );
        parse_fixed("fn main() { (if true {} else {}); let n = 1; }").unwrap();
    }

    #[test]
    fn utf8_string_ranges_and_bom_keep_original_byte_coordinates() {
        let source = "\u{feff}fn main() { println!(\"中文\"); }";
        let program = parse_fixed(source).unwrap();
        let main = &program.functions["main"];
        assert_eq!(main.range.start, 3);
        assert_eq!(main.range.end, source.len());
        for node in program.nodes {
            assert!(source.is_char_boundary(node.byte_range.start));
            assert!(source.is_char_boundary(node.byte_range.end));
            assert!(node.byte_range.start < node.byte_range.end);
        }
    }
}
