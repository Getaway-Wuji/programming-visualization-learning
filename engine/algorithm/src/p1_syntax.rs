//! Source-preserving, bounded C-function / C++20 algorithm-subset syntax.
//! This is a separate language front end; it never rewrites C++ into C.

use crate::budget::{BudgetError, Meter};
use crate::source::ByteRange;

pub type Id = usize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fault {
    pub code: &'static str,
    pub byte_range: ByteRange,
}

fn fault(code: &'static str, byte_range: ByteRange) -> Fault {
    Fault { code, byte_range }
}

fn charge(meter: &mut Meter, units: usize, range: ByteRange) -> Result<(), Fault> {
    meter.charge(units).map_err(|error| {
        fault(
            match error {
                BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
                BudgetError::Deadline { .. } => "E_DEADLINE",
                BudgetError::Cancelled => "E_CANCELLED",
            },
            range,
        )
    })
}

#[derive(Clone, Debug)]
pub struct Program {
    pub functions: Vec<Function>,
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug)]
pub struct Function {
    pub name: String,
    pub returns_void: bool,
    pub params: Vec<Param>,
    pub body: Id,
    pub node: Id,
}

#[derive(Clone, Debug)]
pub struct Param {
    pub name: String,
    pub is_array: bool,
    pub node: Id,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub kind: Kind,
    pub range: ByteRange,
}

#[derive(Clone, Debug)]
pub enum Kind {
    Function {
        body: Id,
        params: Vec<Id>,
    },
    Param {
        name: String,
        is_array: bool,
    },
    Block(Vec<Id>),
    Declare {
        name: String,
        length: Option<usize>,
        init: Init,
    },
    Assign {
        target: Id,
        value: Id,
    },
    If {
        condition: Id,
        yes: Id,
        no: Option<Id>,
    },
    While {
        condition: Id,
        body: Id,
    },
    For {
        init: Option<Id>,
        condition: Option<Id>,
        update: Option<Id>,
        body: Id,
    },
    Return(Option<Id>),
    Break,
    Continue,
    Empty,
    ExprStmt(Id),
    Print {
        format: String,
        args: Vec<Id>,
    },
    Cout(Vec<Output>),
    Cin(Vec<Id>),
    Expr(Expr),
}

#[derive(Clone, Debug)]
pub enum Init {
    None,
    Scalar(Id),
    Array(Vec<Id>),
}

#[derive(Clone, Debug)]
pub enum Output {
    Text(String),
    Expr(Id),
}

#[derive(Clone, Debug)]
pub enum Expr {
    Int(i32),
    Name(String),
    Index { array: Id, index: Id },
    Unary { op: String, arg: Id },
    Binary { op: String, left: Id, right: Id },
    Call { name: String, args: Vec<Id> },
}

impl Kind {
    pub fn children(&self) -> Vec<Id> {
        match self {
            Self::Function { body, params } => params.iter().copied().chain([*body]).collect(),
            Self::Block(statements) => statements.clone(),
            Self::Declare { init, .. } => match init {
                Init::None => vec![],
                Init::Scalar(id) => vec![*id],
                Init::Array(values) => values.clone(),
            },
            Self::Assign { target, value } => vec![*target, *value],
            Self::If { condition, yes, no } => [Some(*condition), Some(*yes), *no]
                .into_iter()
                .flatten()
                .collect(),
            Self::While { condition, body } => vec![*condition, *body],
            Self::For {
                init,
                condition,
                update,
                body,
            } => [*init, *condition, *update, Some(*body)]
                .into_iter()
                .flatten()
                .collect(),
            Self::Return(value) => value.iter().copied().collect(),
            Self::ExprStmt(value) => vec![*value],
            Self::Print { args, .. } | Self::Cin(args) => args.clone(),
            Self::Cout(outputs) => outputs
                .iter()
                .filter_map(|item| match item {
                    Output::Expr(id) => Some(*id),
                    _ => None,
                })
                .collect(),
            Self::Expr(Expr::Index { array, index }) => vec![*array, *index],
            Self::Expr(Expr::Unary { arg, .. }) => vec![*arg],
            Self::Expr(Expr::Binary { left, right, .. }) => vec![*left, *right],
            Self::Expr(Expr::Call { args, .. }) => args.clone(),
            _ => vec![],
        }
    }

    pub fn tag(&self) -> &'static str {
        match self {
            Self::Function { .. } => "function",
            Self::Param { .. } => "parameter",
            Self::Block(_) => "block",
            Self::Declare { .. } => "declaration",
            Self::Assign { .. } => "assignment",
            Self::If { .. } => "if",
            Self::While { .. } => "while",
            Self::For { .. } => "for",
            Self::Return(_) => "return",
            Self::Break => "break",
            Self::Continue => "continue",
            Self::Empty => "empty",
            Self::ExprStmt(_) => "expression-statement",
            Self::Print { .. } | Self::Cout(_) => "output",
            Self::Cin(_) => "input",
            Self::Expr(Expr::Call { .. }) => "call",
            Self::Expr(_) => "expression",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum TokenKind {
    Word(String),
    Number(i32),
    Text(String),
    Symbol(String),
    Header(String),
    Eof,
}

#[derive(Clone, Debug)]
struct Token {
    kind: TokenKind,
    range: ByteRange,
}

struct Scanner<'a, 'm> {
    text: &'a str,
    at: usize,
    meter: &'m mut Meter,
}

impl Scanner<'_, '_> {
    fn range(&self, start: usize) -> ByteRange {
        ByteRange {
            start,
            end: self.at,
        }
    }
    fn rest(&self) -> &str {
        &self.text[self.at..]
    }
    fn advance(&mut self) -> Result<char, Fault> {
        let ch = self
            .rest()
            .chars()
            .next()
            .ok_or_else(|| fault("E_LEX_INVALID", self.range(self.at)))?;
        charge(
            self.meter,
            ch.len_utf8(),
            ByteRange {
                start: self.at,
                end: self.at + ch.len_utf8(),
            },
        )?;
        self.at += ch.len_utf8();
        Ok(ch)
    }

    fn scan(mut self) -> Result<Vec<Token>, Fault> {
        let mut tokens = Vec::new();
        while self.at < self.text.len() {
            let ch = self.rest().chars().next().unwrap();
            if ch.is_ascii_whitespace() {
                self.advance()?;
                continue;
            }
            let start = self.at;
            if self.rest().starts_with("//") {
                while self.at < self.text.len() && !self.rest().starts_with(['\n', '\r']) {
                    if self.advance()? == '\0' {
                        return Err(fault("E_LEX_INVALID", self.range(start)));
                    }
                }
                continue;
            }
            if self.rest().starts_with("/*") {
                self.advance()?;
                self.advance()?;
                while self.at < self.text.len() && !self.rest().starts_with("*/") {
                    if self.advance()? == '\0' {
                        return Err(fault("E_LEX_INVALID", self.range(start)));
                    }
                }
                if self.at == self.text.len() {
                    return Err(fault("E_LEX_INVALID", self.range(start)));
                }
                self.advance()?;
                self.advance()?;
                continue;
            }
            charge(self.meter, 1, self.range(start))?;
            let kind = if ch.is_ascii_alphabetic() || ch == '_' {
                while self
                    .rest()
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    self.advance()?;
                }
                TokenKind::Word(self.text[start..self.at].into())
            } else if ch.is_ascii_digit() {
                let mut previous = '\0';
                while self.rest().chars().next().is_some_and(|c| {
                    c.is_ascii_alphanumeric()
                        || c == '_'
                        || c == '.'
                        || (matches!(c, '+' | '-') && matches!(previous, 'e' | 'E' | 'p' | 'P'))
                }) {
                    previous = self.advance()?;
                }
                let raw = &self.text[start..self.at];
                if raw.len() > 1 && raw.starts_with('0') || !raw.bytes().all(|b| b.is_ascii_digit())
                {
                    return Err(fault("E_LEX_INVALID", self.range(start)));
                }
                TokenKind::Number(
                    raw.parse()
                        .map_err(|_| fault("E_LEX_INVALID", self.range(start)))?,
                )
            } else if ch == '"' {
                self.advance()?;
                let mut output = String::new();
                let mut closed = false;
                while self.at < self.text.len() {
                    match self.advance()? {
                        '"' => {
                            closed = true;
                            break;
                        }
                        '\\' => {
                            let escaped = match self.advance()? {
                                'n' => '\n',
                                '\\' => '\\',
                                '"' => '"',
                                _ => return Err(fault("E_LEX_INVALID", self.range(start))),
                            };
                            output.push(escaped);
                        }
                        '\0' | '\r' | '\n' => {
                            return Err(fault("E_LEX_INVALID", self.range(start)));
                        }
                        other => output.push(other),
                    }
                }
                if !closed {
                    return Err(fault("E_LEX_INVALID", self.range(start)));
                }
                TokenKind::Text(output)
            } else if ch == '#' {
                // A teaching header is an actual token with original range;
                // it is not removed or fed through the C parser.
                charge(self.meter, start.div_ceil(64) + 1, self.range(start))?;
                let line_start = self.text[..start].rfind(['\r', '\n']).map_or(0, |i| i + 1);
                if !self.text[line_start..start]
                    .chars()
                    .all(|c| c == ' ' || c == '\t')
                {
                    return Err(fault("E_UNSUPPORTED_SYNTAX", self.range(start)));
                }
                while self.at < self.text.len() && !self.rest().starts_with(['\r', '\n']) {
                    self.advance()?;
                }
                let raw = self.text[start + 1..self.at].trim();
                let Some(tail) = raw.strip_prefix("include") else {
                    return Err(fault("E_UNSUPPORTED_SYNTAX", self.range(start)));
                };
                let name = tail.trim();
                if !matches!(name, "<stdio.h>" | "<iostream>") {
                    return Err(fault("E_UNSUPPORTED_SYNTAX", self.range(start)));
                }
                TokenKind::Header(name.into())
            } else {
                let mut selected = None;
                for symbol in [
                    "<<=", ">>=", "...", "++", "--", "+=", "-=", "*=", "/=", "%=", "->", "<=",
                    ">=", "==", "!=", "&&", "||", "<<", ">>", "::",
                ] {
                    if self.rest().starts_with(symbol) {
                        for _ in 0..symbol.len() {
                            self.advance()?;
                        }
                        if matches!(
                            symbol,
                            "<<="
                                | ">>="
                                | "..."
                                | "++"
                                | "--"
                                | "+="
                                | "-="
                                | "*="
                                | "/="
                                | "%="
                                | "->"
                        ) {
                            return Err(fault("E_UNSUPPORTED_SYNTAX", self.range(start)));
                        }
                        selected = Some(symbol.to_string());
                        break;
                    }
                }
                if let Some(symbol) = selected {
                    TokenKind::Symbol(symbol)
                } else {
                    self.advance()?;
                    if !"(){}[];,=+-*/%<>!".contains(ch) {
                        return Err(fault("E_UNSUPPORTED_SYNTAX", self.range(start)));
                    }
                    TokenKind::Symbol(ch.to_string())
                }
            };
            tokens.push(Token {
                kind,
                range: self.range(start),
            });
        }
        charge(self.meter, 1, self.range(self.at))?;
        tokens.push(Token {
            kind: TokenKind::Eof,
            range: self.range(self.at),
        });
        Ok(tokens)
    }
}

struct Parser<'m> {
    tokens: Vec<Token>,
    at: usize,
    nodes: Vec<Node>,
    depths: Vec<usize>,
    cpp: bool,
    iostream: bool,
    stdio: bool,
    meter: &'m mut Meter,
    nesting: usize,
}

impl Parser<'_> {
    fn token(&self) -> &Token {
        &self.tokens[self.at]
    }
    fn error(&self, code: &'static str) -> Fault {
        fault(code, self.token().range)
    }
    fn is(&self, text: &str) -> bool {
        matches!(&self.token().kind, TokenKind::Word(s) | TokenKind::Symbol(s) if s == text)
    }
    fn bump(&mut self) -> Result<Token, Fault> {
        charge(self.meter, 1, self.token().range)?;
        let token = self.token().clone();
        if self.at + 1 < self.tokens.len() {
            self.at += 1;
        }
        Ok(token)
    }
    fn take(&mut self, text: &str) -> Result<bool, Fault> {
        if self.is(text) {
            self.bump()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn expect(&mut self, text: &str) -> Result<(), Fault> {
        if self.take(text)? {
            Ok(())
        } else {
            Err(self.error("E_PARSE_INVALID"))
        }
    }
    fn name(&mut self) -> Result<String, Fault> {
        let token = self.bump()?;
        match token.kind {
            TokenKind::Word(name) if !reserved(&name) => Ok(name),
            _ => Err(fault("E_NAME_INVALID", token.range)),
        }
    }
    fn end(&self) -> usize {
        self.tokens[self.at.saturating_sub(1)].range.end
    }
    fn add(&mut self, kind: Kind, start: usize, end: usize) -> Result<Id, Fault> {
        let range = ByteRange { start, end };
        let children = kind.children();
        charge(self.meter, 1 + children.len(), range)?;
        let depth = children
            .iter()
            .map(|id| self.depths[*id])
            .max()
            .unwrap_or(0)
            + 1;
        if depth > self.meter.limits().max_ast_depth {
            return Err(fault("E_DEPTH_LIMIT", range));
        }
        let id = self.nodes.len();
        self.nodes.push(Node { kind, range });
        self.depths.push(depth);
        Ok(id)
    }
    fn nested<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, Fault>) -> Result<T, Fault> {
        self.nesting += 1;
        if self.nesting > self.meter.limits().max_syntax_depth {
            self.nesting -= 1;
            return Err(self.error("E_DEPTH_LIMIT"));
        }
        let result = f(self);
        self.nesting -= 1;
        result
    }
    fn program(mut self) -> Result<Program, Fault> {
        let mut header = None;
        if let TokenKind::Header(name) = &self.token().kind {
            if (self.cpp && name != "<iostream>") || (!self.cpp && name != "<stdio.h>") {
                return Err(self.error("E_UNSUPPORTED_SYNTAX"));
            }
            let iostream = name == "<iostream>";
            let stdio = name == "<stdio.h>";
            self.iostream = iostream;
            self.stdio = stdio;
            header = Some(self.bump()?);
        }
        let _ = header;
        let mut functions: Vec<Function> = Vec::new();
        while self.token().kind != TokenKind::Eof {
            if functions.len() >= 32 {
                return Err(self.error("E_FUNCTION_LIMIT"));
            }
            let start = self.token().range.start;
            let returns_void = if self.take("void")? {
                true
            } else {
                self.expect("int")?;
                false
            };
            let name = if self.take("main")? {
                "main".into()
            } else {
                self.name()?
            };
            if functions.iter().any(|f| f.name == name) {
                return Err(self.error("E_NAME_INVALID"));
            }
            self.expect("(")?;
            let mut params = Vec::new();
            if self.take("void")? {
                self.expect(")")?;
            } else if !self.take(")")? {
                loop {
                    if params.len() >= 8 {
                        return Err(self.error("E_PARAMETER_LIMIT"));
                    }
                    let param_start = self.token().range.start;
                    self.expect("int")?;
                    let param_name = self.name()?;
                    if params.iter().any(|p: &Param| p.name == param_name) {
                        return Err(self.error("E_NAME_INVALID"));
                    }
                    let is_array = if self.take("[")? {
                        self.expect("]")?;
                        true
                    } else {
                        false
                    };
                    let node = self.add(
                        Kind::Param {
                            name: param_name.clone(),
                            is_array,
                        },
                        param_start,
                        self.end(),
                    )?;
                    params.push(Param {
                        name: param_name,
                        is_array,
                        node,
                    });
                    if self.take(")")? {
                        break;
                    }
                    self.expect(",")?;
                }
            }
            if name == "main" && (returns_void || !params.is_empty()) {
                return Err(self.error("E_TYPE_INVALID"));
            }
            if !self.is("{") {
                return Err(self.error("E_UNSUPPORTED_SYNTAX"));
            }
            let body = self.block()?;
            let node = self.add(
                Kind::Function {
                    body,
                    params: params.iter().map(|p| p.node).collect(),
                },
                start,
                self.end(),
            )?;
            functions.push(Function {
                name,
                returns_void,
                params,
                body,
                node,
            });
        }
        if !functions.iter().any(|f| f.name == "main") {
            return Err(self.error("E_NAME_INVALID"));
        }
        Ok(Program {
            functions,
            nodes: self.nodes,
        })
    }
    fn block(&mut self) -> Result<Id, Fault> {
        self.nested(|p| {
            let start = p.token().range.start;
            p.expect("{")?;
            let mut statements = Vec::new();
            while !p.is("}") {
                if p.token().kind == TokenKind::Eof {
                    return Err(p.error("E_PARSE_INVALID"));
                }
                statements.push(p.statement()?);
            }
            p.expect("}")?;
            p.add(Kind::Block(statements), start, p.end())
        })
    }
    fn statement(&mut self) -> Result<Id, Fault> {
        self.nested(|p| p.statement_inner())
    }
    fn statement_inner(&mut self) -> Result<Id, Fault> {
        let start = self.token().range.start;
        if self.is("{") {
            return self.block();
        }
        if self.take(";")? {
            return self.add(Kind::Empty, start, self.end());
        }
        if self.is("int") {
            return self.declare(true);
        }
        if self.take("if")? {
            self.expect("(")?;
            let condition = self.expression()?;
            self.expect(")")?;
            let yes = self.control_body()?;
            let no = if self.take("else")? {
                Some(self.control_body()?)
            } else {
                None
            };
            return self.add(Kind::If { condition, yes, no }, start, self.end());
        }
        if self.take("while")? {
            self.expect("(")?;
            let condition = self.expression()?;
            self.expect(")")?;
            let body = self.control_body()?;
            return self.add(Kind::While { condition, body }, start, self.end());
        }
        if self.take("for")? {
            self.expect("(")?;
            let init = if self.take(";")? {
                None
            } else if self.is("int") {
                Some(self.declare(true)?)
            } else {
                let id = self.simple(false)?;
                self.expect(";")?;
                Some(id)
            };
            let condition = if self.take(";")? {
                None
            } else {
                let id = self.expression()?;
                self.expect(";")?;
                Some(id)
            };
            let update = if self.take(")")? {
                None
            } else {
                let id = self.simple(false)?;
                self.expect(")")?;
                Some(id)
            };
            let body = self.control_body()?;
            // [stmt.for] disallows redeclaring an init-statement name in the
            // outermost substatement scope in C++, even with explicit braces.
            // C permits that body-block shadow; a deeper C++ block also does.
            if self.cpp
                && let Some(init) = init
                && let Kind::Declare { name, .. } = &self.nodes[init].kind
                && let Kind::Block(statements) = &self.nodes[body].kind
            {
                for child in statements {
                    charge(self.meter, 1, self.nodes[*child].range)?;
                    if matches!(&self.nodes[*child].kind, Kind::Declare { name: other, .. } if name == other)
                    {
                        return Err(fault("E_NAME_INVALID", self.nodes[*child].range));
                    }
                }
            }
            return self.add(
                Kind::For {
                    init,
                    condition,
                    update,
                    body,
                },
                start,
                self.end(),
            );
        }
        if self.take("return")? {
            let value = if self.take(";")? {
                None
            } else {
                let id = self.expression()?;
                self.expect(";")?;
                Some(id)
            };
            return self.add(Kind::Return(value), start, self.end());
        }
        if self.take("break")? {
            self.expect(";")?;
            return self.add(Kind::Break, start, self.end());
        }
        if self.take("continue")? {
            self.expect(";")?;
            return self.add(Kind::Continue, start, self.end());
        }
        if self.is("printf") {
            if self.cpp || !self.stdio {
                return Err(self.error("E_UNSUPPORTED_SYNTAX"));
            }
            self.bump()?;
            self.expect("(")?;
            let token = self.bump()?;
            let TokenKind::Text(format) = token.kind else {
                return Err(fault("E_PARSE_INVALID", token.range));
            };
            let mut args = Vec::new();
            while self.take(",")? {
                args.push(self.expression()?);
            }
            self.expect(")")?;
            self.expect(";")?;
            return self.add(Kind::Print { format, args }, start, self.end());
        }
        if self.is("std") {
            return self.stream();
        }
        self.simple(true)
    }

    fn control_body(&mut self) -> Result<Id, Fault> {
        let id = self.statement()?;
        if matches!(self.nodes[id].kind, Kind::Block(_)) {
            return Ok(id);
        }
        // C++ selection/iteration substatements introduce an implicit scope.
        // C does not admit a naked declaration as its statement grammar.
        if !self.cpp && matches!(self.nodes[id].kind, Kind::Declare { .. }) {
            return Err(fault("E_UNSUPPORTED_SYNTAX", self.nodes[id].range));
        }
        let range = self.nodes[id].range;
        self.add(Kind::Block(vec![id]), range.start, range.end)
    }
    fn declare(&mut self, semicolon: bool) -> Result<Id, Fault> {
        let start = self.token().range.start;
        self.expect("int")?;
        let name = self.name()?;
        let length = if self.take("[")? {
            let token = self.bump()?;
            let TokenKind::Number(length) = token.kind else {
                return Err(fault("E_UNSUPPORTED_SYNTAX", token.range));
            };
            if length <= 0 {
                return Err(fault("E_TYPE_INVALID", token.range));
            }
            self.expect("]")?;
            Some(length as usize)
        } else {
            None
        };
        let init = if self.take("=")? {
            if self.take("{")? {
                let mut values = Vec::new();
                if !self.take("}")? {
                    loop {
                        values.push(self.expression()?);
                        if self.take("}")? {
                            break;
                        }
                        self.expect(",")?;
                        if self.take("}")? {
                            break;
                        }
                    }
                }
                if length.is_none() {
                    return Err(self.error("E_TYPE_INVALID"));
                }
                Init::Array(values)
            } else {
                let value = self.expression()?;
                if length.is_some() {
                    return Err(self.error("E_TYPE_INVALID"));
                }
                Init::Scalar(value)
            }
        } else {
            Init::None
        };
        if let (Some(length), Init::Array(values)) = (length, &init) {
            if values.len() > length {
                return Err(self.error("E_TYPE_INVALID"));
            }
            if !self.cpp && values.is_empty() {
                return Err(self.error("E_UNSUPPORTED_SYNTAX"));
            }
        }
        if semicolon {
            self.expect(";")?;
        }
        self.add(Kind::Declare { name, length, init }, start, self.end())
    }
    fn simple(&mut self, semicolon: bool) -> Result<Id, Fault> {
        let start = self.token().range.start;
        let target = self.expression()?;
        let kind = if self.take("=")? {
            if !matches!(
                &self.nodes[target].kind,
                Kind::Expr(Expr::Name(_) | Expr::Index { .. })
            ) {
                return Err(self.error("E_TYPE_INVALID"));
            }
            Kind::Assign {
                target,
                value: self.expression()?,
            }
        } else {
            Kind::ExprStmt(target)
        };
        if semicolon {
            self.expect(";")?;
        }
        self.add(kind, start, self.end())
    }
    fn stream(&mut self) -> Result<Id, Fault> {
        let start = self.token().range.start;
        if !self.cpp || !self.iostream {
            return Err(self.error("E_UNSUPPORTED_SYNTAX"));
        }
        self.expect("std")?;
        self.expect("::")?;
        if self.take("cout")? {
            let mut values = Vec::new();
            if !self.is("<<") {
                return Err(self.error("E_PARSE_INVALID"));
            }
            while self.take("<<")? {
                if let TokenKind::Text(text) = &self.token().kind {
                    let text = text.clone();
                    self.bump()?;
                    values.push(Output::Text(text));
                } else if self.take("std")? {
                    self.expect("::")?;
                    self.expect("endl")?;
                    values.push(Output::Text("\n".into()));
                } else {
                    values.push(Output::Expr(self.expression()?));
                }
            }
            self.expect(";")?;
            self.add(Kind::Cout(values), start, self.end())
        } else if self.take("cin")? {
            let mut values = Vec::new();
            if !self.is(">>") {
                return Err(self.error("E_PARSE_INVALID"));
            }
            while self.take(">>")? {
                let id = self.expression()?;
                if !matches!(
                    &self.nodes[id].kind,
                    Kind::Expr(Expr::Name(_) | Expr::Index { .. })
                ) {
                    return Err(self.error("E_TYPE_INVALID"));
                }
                values.push(id);
            }
            self.expect(";")?;
            self.add(Kind::Cin(values), start, self.end())
        } else {
            Err(self.error("E_UNSUPPORTED_SYNTAX"))
        }
    }
    fn expression(&mut self) -> Result<Id, Fault> {
        self.binary(1)
    }
    fn binary(&mut self, min: u8) -> Result<Id, Fault> {
        self.nested(|p| {
            let mut left = p.unary()?;
            while let TokenKind::Symbol(op) = &p.token().kind {
                let op = op.clone();
                let precedence = match op.as_str() {
                    "||" => 1,
                    "&&" => 2,
                    "==" | "!=" => 3,
                    "<" | "<=" | ">" | ">=" => 4,
                    "+" | "-" => 5,
                    "*" | "/" | "%" => 6,
                    _ => 0,
                };
                if precedence < min {
                    break;
                }
                p.bump()?;
                let right = p.binary(precedence + 1)?;
                left = p.add(
                    Kind::Expr(Expr::Binary { op, left, right }),
                    p.nodes[left].range.start,
                    p.nodes[right].range.end,
                )?;
            }
            Ok(left)
        })
    }
    fn unary(&mut self) -> Result<Id, Fault> {
        if self.is("+") || self.is("-") || self.is("!") {
            return self.nested(|p| {
                let token = p.bump()?;
                let TokenKind::Symbol(op) = token.kind else {
                    unreachable!()
                };
                let arg = p.unary()?;
                p.add(
                    Kind::Expr(Expr::Unary { op, arg }),
                    token.range.start,
                    p.nodes[arg].range.end,
                )
            });
        }
        self.primary()
    }
    fn primary(&mut self) -> Result<Id, Fault> {
        let token = self.bump()?;
        let start = token.range.start;
        let mut id = match token.kind {
            TokenKind::Number(value) => {
                self.add(Kind::Expr(Expr::Int(value)), start, token.range.end)?
            }
            TokenKind::Word(name) if !reserved(&name) && name != "main" => {
                if self.take("(")? {
                    let mut args = Vec::new();
                    if !self.take(")")? {
                        loop {
                            if args.len() >= 8 {
                                return Err(self.error("E_PARAMETER_LIMIT"));
                            }
                            args.push(self.expression()?);
                            if self.take(")")? {
                                break;
                            }
                            self.expect(",")?;
                        }
                    }
                    self.add(Kind::Expr(Expr::Call { name, args }), start, self.end())?
                } else {
                    self.add(Kind::Expr(Expr::Name(name)), start, token.range.end)?
                }
            }
            TokenKind::Symbol(symbol) if symbol == "(" => {
                let id = self.expression()?;
                self.expect(")")?;
                // Parentheses keep the original expression node's expanded
                // source range. No invented AST evaluation or hidden source.
                self.nodes[id].range = ByteRange {
                    start,
                    end: self.end(),
                };
                id
            }
            TokenKind::Word(_) => return Err(fault("E_UNSUPPORTED_SYNTAX", token.range)),
            _ => return Err(fault("E_PARSE_INVALID", token.range)),
        };
        if self.take("[")? {
            if !matches!(&self.nodes[id].kind, Kind::Expr(Expr::Name(_))) {
                return Err(self.error("E_TYPE_INVALID"));
            }
            let index = self.expression()?;
            self.expect("]")?;
            id = self.add(
                Kind::Expr(Expr::Index { array: id, index }),
                start,
                self.end(),
            )?;
        }
        Ok(id)
    }
}

fn reserved(name: &str) -> bool {
    matches!(
        name,
        "int"
            | "void"
            | "main"
            | "if"
            | "else"
            | "while"
            | "for"
            | "return"
            | "break"
            | "continue"
            | "printf"
            | "std"
            | "cout"
            | "cin"
            | "endl"
            | "auto"
            | "char"
            | "const"
            | "double"
            | "enum"
            | "extern"
            | "float"
            | "goto"
            | "long"
            | "register"
            | "short"
            | "signed"
            | "sizeof"
            | "static"
            | "struct"
            | "switch"
            | "typedef"
            | "union"
            | "unsigned"
            | "volatile"
            | "do"
            | "case"
            | "default"
            | "inline"
            | "restrict"
            | "_Alignas"
            | "_Alignof"
            | "_Atomic"
            | "_Bool"
            | "_Complex"
            | "_Generic"
            | "_Imaginary"
            | "_Noreturn"
            | "_Static_assert"
            | "_Thread_local"
            | "_BitInt"
            | "_Decimal32"
            | "_Decimal64"
            | "_Decimal128"
            | "alignas"
            | "alignof"
            | "asm"
            | "bool"
            | "catch"
            | "class"
            | "concept"
            | "consteval"
            | "constexpr"
            | "constinit"
            | "const_cast"
            | "co_await"
            | "co_return"
            | "co_yield"
            | "decltype"
            | "delete"
            | "dynamic_cast"
            | "explicit"
            | "export"
            | "false"
            | "friend"
            | "import"
            | "module"
            | "mutable"
            | "namespace"
            | "new"
            | "noexcept"
            | "nullptr"
            | "operator"
            | "private"
            | "protected"
            | "public"
            | "reinterpret_cast"
            | "requires"
            | "static_assert"
            | "static_cast"
            | "template"
            | "this"
            | "thread_local"
            | "throw"
            | "true"
            | "try"
            | "typeid"
            | "typename"
            | "using"
            | "virtual"
            | "wchar_t"
            | "char8_t"
            | "char16_t"
            | "char32_t"
            | "and"
            | "and_eq"
            | "bitand"
            | "bitor"
            | "compl"
            | "not"
            | "not_eq"
            | "or"
            | "or_eq"
            | "xor"
            | "xor_eq"
            | "typeof"
            | "typeof_unqual"
    )
}

pub fn parse(source: &str, language: &str, meter: &mut Meter) -> Result<Program, Fault> {
    let range = ByteRange {
        start: 0,
        end: source.len(),
    };
    if source.len() > meter.limits().source_bytes {
        return Err(fault("E_SOURCE_LIMIT", range));
    }
    if !matches!(language, "c" | "cpp") {
        return Err(fault("E_UNSUPPORTED_SYNTAX", range));
    }
    let tokens = Scanner {
        text: source,
        at: 0,
        meter,
    }
    .scan()?;
    Parser {
        tokens,
        at: 0,
        nodes: Vec::new(),
        depths: Vec::new(),
        cpp: language == "cpp",
        iostream: false,
        stdio: false,
        meter,
        nesting: 0,
    }
    .program()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn checked(source: &str, language: &str) -> Result<Program, Fault> {
        let mut meter = Meter::new();
        meter.set_clock(1000, Box::new(|| 0));
        parse(source, language, &mut meter)
    }
    #[test]
    fn c_and_cpp_have_distinct_real_output_nodes() {
        let c = checked("#include <stdio.h>\nint f(int n){if(n<2){return n;}return f(n-1)+f(n-2);} int main(void){printf(\"%d\\n\",f(7));return 0;}", "c").unwrap();
        assert_eq!(c.functions.len(), 2);
        let cpp = checked("#include <iostream>\nint main(){int a[3]={};std::cin >> a[0];std::cout << a[0] << std::endl;return 0;}", "cpp").unwrap();
        assert!(cpp.nodes.iter().any(|n| matches!(n.kind, Kind::Cout(_))));
        assert!(checked("#include <iostream>\nint main(){std::cout << 1;}", "c").is_err());
        assert!(checked("int main(){printf(\"hello\");}", "cpp").is_err());
    }
    #[test]
    fn mappings_refer_to_original_unicode_crlf_source() {
        let source =
            "// 中文 😀\r\n#include <iostream>\r\nint main(){std::cout << \"好\\n\";return 0;}";
        let program = checked(source, "cpp").unwrap();
        for node in &program.nodes {
            assert!(source.is_char_boundary(node.range.start));
            assert!(source.is_char_boundary(node.range.end));
            for child in node.kind.children() {
                assert!(
                    node.range.start <= program.nodes[child].range.start
                        && node.range.end >= program.nodes[child].range.end
                );
            }
        }
    }
    #[test]
    fn unsupported_syntax_is_rejected_without_prefix_execution() {
        for source in [
            "int main(){int x=1;x++;}",
            "int main(){bool b=true;}",
            "int main(){int *p;}",
            "int main(){std::cout << 1;}",
            "#include <vector>\nint main(){}",
            "int main(){int a[3];int b=a[0][0];}",
            "int main(){int x=01;}",
            "int main(){int x=1e-2;}",
        ] {
            assert!(checked(source, "cpp").is_err(), "{source}");
        }
    }
    #[test]
    fn deep_unary_and_flat_expression_depth_are_bounded() {
        for expression in [
            format!("{}1", "!".repeat(70)),
            format!("1{}", "+1".repeat(70)),
            format!("{}1{}", "(".repeat(70), ")".repeat(70)),
        ] {
            let source = format!("int main(){{return {expression};}}");
            assert_eq!(checked(&source, "cpp").unwrap_err().code, "E_DEPTH_LIMIT");
        }
    }

    #[test]
    fn array_parameters_control_bodies_and_precedence_are_structural() {
        let source = "int f(int a[],int n){for(int i=0;i<n;i=i+1){if(a[i]<0)continue;else a[i]=a[i]*2+1;}while(n>0){n=n-1;if(n==1)break;}return a[0];}int main(){int a[2]={1,2};return f(a,2);}";
        let p = checked(source, "cpp").unwrap();
        assert!(p.functions[0].params[0].is_array);
        assert!(!p.functions[0].params[1].is_array);
        for node in &p.nodes {
            match &node.kind {
                Kind::If { yes, no, .. } => {
                    assert!(matches!(p.nodes[*yes].kind, Kind::Block(_)));
                    if let Some(no) = no {
                        assert!(matches!(p.nodes[*no].kind, Kind::Block(_)));
                    }
                }
                Kind::While { body, .. } | Kind::For { body, .. } => {
                    assert!(matches!(p.nodes[*body].kind, Kind::Block(_)));
                }
                _ => {}
            }
        }
        let p = checked("int main(){return 1+2*3;}", "c").unwrap();
        let add = p
            .nodes
            .iter()
            .find_map(|node| match &node.kind {
                Kind::Expr(Expr::Binary { op, right, .. }) if op == "+" => Some(*right),
                _ => None,
            })
            .unwrap();
        assert!(matches!(&p.nodes[add].kind, Kind::Expr(Expr::Binary { op, .. }) if op == "*"));
    }

    #[test]
    fn c_headers_and_cxx_implicit_scope_are_explicit() {
        assert!(checked("int main(){printf(\"%d\",1);}", "c").is_err());
        assert!(checked("int main(){if(1) int x=2;return 0;}", "c").is_err());
        let p = checked("int main(){if(1) int x=2;return 0;}", "cpp").unwrap();
        assert!(
            p.nodes
                .iter()
                .any(|node| matches!(node.kind, Kind::Block(_))
                    && node.range.start == "int main(){if(1) ".len())
        );
        assert!(checked("int main(){int a[2]={};}", "c").is_err());
        assert!(checked("int main(){int a[2]={};}", "cpp").is_ok());
    }

    #[test]
    fn cxx_for_init_name_cannot_be_redeclared_in_outer_body_scope() {
        let source = "int main(){for(int i=0;i<1;i=i+1){int i=7;}return 0;}";
        assert!(checked(source, "c").is_ok());
        assert_eq!(checked(source, "cpp").unwrap_err().code, "E_NAME_INVALID");
        assert!(
            checked(
                "int main(){for(int i=0;i<1;i=i+1){{int i=7;}}return 0;}",
                "cpp"
            )
            .is_ok()
        );
        assert_eq!(
            checked(
                "int main(){for(int i=0;i<1;i=i+1) int i=7;return 0;}",
                "cpp"
            )
            .unwrap_err()
            .code,
            "E_NAME_INVALID"
        );
    }

    #[test]
    fn declaration_limits_accept_the_boundary_and_reject_the_next() {
        let params = (0..8)
            .map(|i| format!("int p{i}"))
            .collect::<Vec<_>>()
            .join(",");
        assert!(
            checked(
                &format!("int f({params}){{return p0;}}int main(){{return 0;}}"),
                "cpp"
            )
            .is_ok()
        );
        let source = format!("int f({params},int p8){{return p0;}}int main(){{return 0;}}");
        assert_eq!(
            checked(&source, "cpp").unwrap_err().code,
            "E_PARAMETER_LIMIT"
        );
        let definitions = (0..31)
            .map(|i| format!("void f{i}(){{}} "))
            .collect::<String>();
        assert!(checked(&format!("{definitions}int main(){{}}"), "cpp").is_ok());
        assert_eq!(
            checked(&format!("{definitions}void f31(){{}}int main(){{}}"), "cpp")
                .unwrap_err()
                .code,
            "E_FUNCTION_LIMIT"
        );
    }

    #[test]
    fn source_and_controls_share_the_supplied_meter() {
        let body = "int main(){return 0;}";
        let source = format!("{}{body}", " ".repeat(32768 - body.len()));
        assert!(checked(&source, "cpp").is_ok());
        assert_eq!(
            checked(&(source + " "), "cpp").unwrap_err().code,
            "E_SOURCE_LIMIT"
        );
        let mut cancelled = Meter::new();
        cancelled.set_cancel(Box::new(|| true));
        assert_eq!(
            parse(body, "cpp", &mut cancelled).unwrap_err().code,
            "E_CANCELLED"
        );
        let mut expired = Meter::new();
        expired.set_clock(0, Box::new(|| 0));
        assert_eq!(
            parse(body, "cpp", &mut expired).unwrap_err().code,
            "E_DEADLINE"
        );
    }
}
