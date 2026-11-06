use std::collections::BTreeSet;

use c_viz_core::source::ByteRange;
use serde::Serialize;

use crate::lexer::{self, Token, TokenKind};
use crate::{Fault, Meter, PyResult, charge, span};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Node {
    pub node_id: u32,
    pub byte_range: ByteRange,
    pub kind: &'static str,
}

#[derive(Debug)]
pub(crate) struct Expr {
    pub node: Node,
    height: usize,
    pub kind: ExprKind,
}

#[derive(Debug)]
pub(crate) enum ExprKind {
    None,
    Bool(bool),
    Int(String),
    Float(f64),
    Text(String),
    Name(String),
    List(Vec<Expr>),
    Group(Box<Expr>),
    Unary(&'static str, Box<Expr>),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Compare(Box<Expr>, Vec<(&'static str, Expr)>),
    Index(Box<Expr>, Box<Expr>),
    Slice(Box<Expr>, [Option<Box<Expr>>; 3]),
    Call(Box<Expr>, Arguments),
    Method(Box<Expr>, String, Arguments),
}

#[derive(Debug, Default)]
pub(crate) struct Arguments {
    pub positional: Vec<Expr>,
    pub keywords: Vec<(String, Expr)>,
}

impl Arguments {
    fn height(&self) -> usize {
        self.positional
            .iter()
            .map(|expr| expr.height)
            .chain(self.keywords.iter().map(|(_, expr)| expr.height))
            .max()
            .unwrap_or(0)
    }
}

#[derive(Debug)]
pub(crate) struct Stmt {
    pub node: Node,
    pub kind: StmtKind,
}

#[derive(Debug)]
pub(crate) enum StmtKind {
    Assign(Expr, &'static str, Expr),
    Eval(Expr),
    If(Vec<(Expr, Vec<Stmt>)>, Vec<Stmt>),
    While(Expr, Vec<Stmt>),
    For(String, Expr, Vec<Stmt>),
    Def {
        name: String,
        params: Vec<String>,
        body: Vec<Stmt>,
        locals: BTreeSet<String>,
    },
    Return(Option<Expr>),
    Break,
    Continue,
    Pass,
}

pub(crate) struct Program {
    pub statements: Vec<Stmt>,
    pub nodes: Vec<Node>,
    pub has_comments: bool,
}

pub(crate) fn parse(source: &str, meter: &mut Meter) -> PyResult<Program> {
    let lexed = lexer::lex(source, meter)?;
    charge(meter, lexed.tokens.len(), span(0, source.len()), "parser")?;
    let limits = meter.limits();
    let mut parser = Parser {
        tokens: lexed.tokens,
        at: 0,
        nodes: Vec::new(),
        block_depth: 0,
        loop_depth: 0,
        in_function: false,
        defs: 0,
        syntax_depth: limits.max_syntax_depth,
        ast_depth: limits.max_ast_depth,
    };
    let statements = parser.body()?;
    if !parser.is(&TokenKind::End) {
        return Err(parser.fault("E_PY_INDENTATION"));
    }
    Ok(Program {
        statements,
        nodes: parser.nodes,
        has_comments: lexed.comments,
    })
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
    nodes: Vec<Node>,
    block_depth: usize,
    loop_depth: usize,
    in_function: bool,
    defs: usize,
    syntax_depth: usize,
    ast_depth: usize,
}

const RESERVED: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
    "with", "yield",
];
const UNSUPPORTED_WORDS: &[&str] = &[
    "as", "assert", "async", "await", "class", "del", "except", "finally", "from", "global",
    "import", "lambda", "nonlocal", "raise", "try", "with", "yield",
];

impl Parser {
    fn token(&self) -> &Token {
        &self.tokens[self.at]
    }
    fn look(&self, ahead: usize) -> Option<&TokenKind> {
        self.tokens.get(self.at + ahead).map(|t| &t.kind)
    }
    fn is(&self, kind: &TokenKind) -> bool {
        &self.token().kind == kind
    }
    fn word(&self, text: &str) -> bool {
        matches!(&self.token().kind, TokenKind::Name(word) if word == text)
    }
    fn op(&self, value: &str) -> bool {
        matches!(self.token().kind, TokenKind::Op(op) if op == value)
    }
    fn bump(&mut self) -> Token {
        let token = self.token().clone();
        if token.kind != TokenKind::End {
            self.at += 1;
        }
        token
    }
    fn take(&mut self, value: &str) -> bool {
        if self.op(value) {
            self.bump();
            true
        } else {
            false
        }
    }
    fn expect(&mut self, value: &str) -> PyResult<()> {
        if self.take(value) {
            Ok(())
        } else {
            Err(self.fault("E_PY_SYNTAX"))
        }
    }
    fn fault(&self, code: &'static str) -> Fault {
        Fault::new(code, self.token().span, "parser")
    }
    fn end(&self) -> usize {
        self.tokens[self.at.saturating_sub(1)].span.end
    }
    fn name(&mut self) -> PyResult<String> {
        if let TokenKind::Name(name) = &self.token().kind
            && !RESERVED.contains(&name.as_str())
        {
            let name = name.clone();
            self.bump();
            return Ok(name);
        }
        Err(self.fault("E_PY_SYNTAX"))
    }
    fn node(&mut self, kind: &'static str, range: ByteRange) -> Node {
        let node = Node {
            node_id: self.nodes.len() as u32 + 1,
            byte_range: range,
            kind,
        };
        self.nodes.push(node);
        node
    }
    fn expr(
        &mut self,
        kind: ExprKind,
        name: &'static str,
        range: ByteRange,
        child_height: usize,
    ) -> PyResult<Expr> {
        let height = child_height + 1;
        if height + self.block_depth > self.ast_depth {
            return Err(Fault::new("E_DEPTH_LIMIT", range, "parser"));
        }
        Ok(Expr {
            node: self.node(name, range),
            height,
            kind,
        })
    }
    fn body(&mut self) -> PyResult<Vec<Stmt>> {
        let mut body = Vec::new();
        while !matches!(self.token().kind, TokenKind::End | TokenKind::Dedent) {
            body.push(self.statement()?);
        }
        Ok(body)
    }
    fn suite(&mut self) -> PyResult<Vec<Stmt>> {
        self.expect(":")?;
        if !self.is(&TokenKind::Newline) {
            return Err(self.fault("E_PY_UNSUPPORTED"));
        }
        self.bump();
        if !self.is(&TokenKind::Indent) {
            return Err(self.fault("E_PY_INDENTATION"));
        }
        if self.block_depth + 1 >= self.ast_depth {
            return Err(self.fault("E_DEPTH_LIMIT"));
        }
        self.bump();
        self.block_depth += 1;
        let result = self.body()?;
        self.block_depth -= 1;
        if !self.is(&TokenKind::Dedent) {
            return Err(self.fault("E_PY_INDENTATION"));
        }
        self.bump();
        Ok(result)
    }
    fn line(&mut self) -> PyResult<()> {
        if self.is(&TokenKind::Newline) {
            self.bump();
            return Ok(());
        }
        let unsupported = matches!(
            self.token().kind,
            TokenKind::Text(_) | TokenKind::Op("," | "=" | ":")
        ) || self.word("if")
            || self.word("for");
        Err(self.fault(if unsupported {
            "E_PY_UNSUPPORTED"
        } else {
            "E_PY_SYNTAX"
        }))
    }
    fn statement(&mut self) -> PyResult<Stmt> {
        let start = self.token().span.start;
        if self.is(&TokenKind::Indent) {
            return Err(self.fault("E_PY_INDENTATION"));
        }
        let word = match &self.token().kind {
            TokenKind::Name(word) => word.as_str(),
            _ => "",
        };
        if UNSUPPORTED_WORDS.contains(&word)
            || (matches!(word, "match" | "type")
                && matches!(self.look(1), Some(TokenKind::Name(_) | TokenKind::Int(_))))
        {
            return Err(self.fault("E_PY_UNSUPPORTED"));
        }
        let (kind, label) = match word {
            "if" => {
                let mut conditions = Vec::new();
                loop {
                    self.bump();
                    conditions.push((self.expression(0, 0)?, self.suite()?));
                    if !self.word("elif") {
                        break;
                    }
                }
                let other = if self.word("else") {
                    self.bump();
                    self.suite()?
                } else {
                    Vec::new()
                };
                (StmtKind::If(conditions, other), "if")
            }
            "while" => {
                self.bump();
                let cond = self.expression(0, 0)?;
                let body = self.loop_body()?;
                (StmtKind::While(cond, body), "while")
            }
            "for" => {
                self.bump();
                let name = self.name()?;
                if !self.word("in") {
                    return Err(self.fault(if self.op(",") {
                        "E_PY_UNSUPPORTED"
                    } else {
                        "E_PY_SYNTAX"
                    }));
                }
                self.bump();
                let expr = self.expression(0, 0)?;
                if !matches!(&expr.kind, ExprKind::Call(callee, args)
                    if matches!(&callee.kind, ExprKind::Name(name) if name == "range") && args.keywords.is_empty())
                {
                    return Err(Fault::new(
                        "E_PY_UNSUPPORTED",
                        expr.node.byte_range,
                        "parser",
                    ));
                }
                let body = self.loop_body()?;
                (StmtKind::For(name, expr, body), "for")
            }
            "def" => (self.function()?, "def"),
            "return" => {
                if !self.in_function {
                    return Err(self.fault("E_PY_SYNTAX"));
                }
                self.bump();
                let value = if self.is(&TokenKind::Newline) {
                    None
                } else {
                    Some(self.expression(0, 0)?)
                };
                self.line()?;
                (StmtKind::Return(value), "return")
            }
            "break" | "continue" | "pass" => {
                let (kind, label) = match word {
                    "break" => (StmtKind::Break, "break"),
                    "continue" => (StmtKind::Continue, "continue"),
                    _ => (StmtKind::Pass, "pass"),
                };
                if label != "pass" && self.loop_depth == 0 {
                    return Err(self.fault("E_PY_SYNTAX"));
                }
                self.bump();
                self.line()?;
                (kind, label)
            }
            _ => {
                let lhs = self.expression(0, 0)?;
                let assignment = match self.token().kind {
                    TokenKind::Op(op @ ("=" | "+=" | "-=" | "*=" | "/=" | "//=" | "%=")) => {
                        Some(op)
                    }
                    _ => None,
                };
                if let Some(op) = assignment {
                    let index = matches!(&lhs.kind, ExprKind::Index(..));
                    if !matches!(&lhs.kind, ExprKind::Name(_)) && !(op == "=" && index) {
                        return Err(Fault::new(
                            "E_PY_UNSUPPORTED",
                            lhs.node.byte_range,
                            "parser",
                        ));
                    }
                    self.bump();
                    let rhs = self.expression(0, 0)?;
                    self.line()?;
                    (StmtKind::Assign(lhs, op, rhs), "assign")
                } else {
                    self.line()?;
                    (StmtKind::Eval(lhs), "expression")
                }
            }
        };
        Ok(Stmt {
            node: self.node(label, span(start, self.end())),
            kind,
        })
    }
    fn loop_body(&mut self) -> PyResult<Vec<Stmt>> {
        self.loop_depth += 1;
        let body = self.suite()?;
        self.loop_depth -= 1;
        if self.word("else") {
            return Err(self.fault("E_PY_UNSUPPORTED"));
        }
        Ok(body)
    }
    fn function(&mut self) -> PyResult<StmtKind> {
        if self.in_function {
            return Err(self.fault("E_PY_UNSUPPORTED"));
        }
        if self.defs >= 32 {
            return Err(self.fault("E_MEMORY_LIMIT"));
        }
        self.defs += 1;
        self.bump();
        let name = self.name()?;
        self.expect("(")?;
        let mut params = Vec::new();
        let mut locals = BTreeSet::new();
        while !self.op(")") {
            if params.len() >= 8 {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            if self.op("*") || self.op("/") {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            let param = self.name()?;
            if !locals.insert(param.clone()) {
                return Err(self.fault("E_PY_SYNTAX"));
            }
            params.push(param);
            if self.op("=") || self.op(":") {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            if !self.take(",") {
                break;
            }
        }
        self.expect(")")?;
        self.in_function = true;
        let outer_loops = std::mem::replace(&mut self.loop_depth, 0);
        let body = self.suite()?;
        self.loop_depth = outer_loops;
        self.in_function = false;
        collect_locals(&body, &mut locals);
        Ok(StmtKind::Def {
            name,
            params,
            body,
            locals,
        })
    }
    fn expression(&mut self, minimum: u8, depth: usize) -> PyResult<Expr> {
        if depth >= self.syntax_depth {
            return Err(self.fault("E_DEPTH_LIMIT"));
        }
        let mut left = self.prefix(minimum, depth)?;
        loop {
            if minimum <= 13 && (self.op("(") || self.op("[") || self.op(".")) {
                left = self.postfix(left, depth)?;
                continue;
            }
            if minimum <= 5 && self.comparison().is_some() {
                let mut chain = Vec::new();
                let start = left.node.byte_range.start;
                let mut height = left.height;
                while let Some(op) = self.comparison() {
                    self.bump();
                    if op == "is not" {
                        self.bump();
                    }
                    let right = self.expression(6, depth + 1)?;
                    height = height.max(right.height);
                    chain.push((op, right));
                }
                left = self.expr(
                    ExprKind::Compare(Box::new(left), chain),
                    "compare",
                    span(start, self.end()),
                    height,
                )?;
                continue;
            }
            if minimum <= 5 && (self.word("in") || self.word("not")) {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            let binary = match &self.token().kind {
                TokenKind::Name(word) if word == "or" => Some(("or", 1)),
                TokenKind::Name(word) if word == "and" => Some(("and", 3)),
                TokenKind::Op(op @ ("+" | "-")) => Some((*op, 7)),
                TokenKind::Op(op @ ("*" | "/" | "//" | "%")) => Some((*op, 9)),
                _ => None,
            };
            let Some((op, power)) = binary.filter(|(_, power)| *power >= minimum) else {
                break;
            };
            self.bump();
            let right = self.expression(power + 1, depth + 1)?;
            let range = span(left.node.byte_range.start, right.node.byte_range.end);
            let height = left.height.max(right.height);
            left = self.expr(
                ExprKind::Binary(op, Box::new(left), Box::new(right)),
                "binary",
                range,
                height,
            )?;
        }
        Ok(left)
    }
    fn comparison(&self) -> Option<&'static str> {
        match &self.token().kind {
            TokenKind::Op(op @ ("==" | "!=" | "<" | "<=" | ">" | ">=")) => Some(op),
            TokenKind::Name(name) if name == "is" => Some(
                if matches!(self.look(1), Some(TokenKind::Name(name)) if name == "not") {
                    "is not"
                } else {
                    "is"
                },
            ),
            _ => None,
        }
    }
    fn prefix(&mut self, minimum: u8, depth: usize) -> PyResult<Expr> {
        let token = self.bump();
        let start = token.span.start;
        let (kind, label, height) = match token.kind {
            TokenKind::Name(name) if name == "None" => (ExprKind::None, "none", 0),
            TokenKind::Name(name) if name == "True" || name == "False" => {
                (ExprKind::Bool(name == "True"), "bool", 0)
            }
            TokenKind::Name(name) if name == "not" && minimum <= 5 => {
                let value = self.expression(5, depth + 1)?;
                let height = value.height;
                (ExprKind::Unary("not", Box::new(value)), "unary", height)
            }
            TokenKind::Name(name) if !RESERVED.contains(&name.as_str()) => {
                (ExprKind::Name(name), "name", 0)
            }
            TokenKind::Name(name) if UNSUPPORTED_WORDS.contains(&name.as_str()) => {
                return Err(Fault::new("E_PY_UNSUPPORTED", token.span, "parser"));
            }
            TokenKind::Int(value) => (ExprKind::Int(value), "int", 0),
            TokenKind::Float(value) => (ExprKind::Float(value), "float", 0),
            TokenKind::Text(value) => (ExprKind::Text(value), "string", 0),
            TokenKind::Op(op @ ("+" | "-")) => {
                let value = self.expression(11, depth + 1)?;
                let height = value.height;
                (ExprKind::Unary(op, Box::new(value)), "unary", height)
            }
            TokenKind::Op("(") => {
                if self.op(")") {
                    return Err(self.fault("E_PY_UNSUPPORTED"));
                }
                let value = self.expression(0, depth + 1)?;
                if self.op(",") || self.word("for") {
                    return Err(self.fault("E_PY_UNSUPPORTED"));
                }
                self.expect(")")?;
                let height = value.height;
                (ExprKind::Group(Box::new(value)), "group", height)
            }
            TokenKind::Op("[") => {
                let mut items = Vec::new();
                while !self.op("]") {
                    items.push(self.expression(0, depth + 1)?);
                    if self.word("for") {
                        return Err(self.fault("E_PY_UNSUPPORTED"));
                    }
                    if !self.take(",") {
                        break;
                    }
                }
                self.expect("]")?;
                let height = items.iter().map(|expr| expr.height).max().unwrap_or(0);
                (ExprKind::List(items), "list", height)
            }
            _ => return Err(Fault::new("E_PY_SYNTAX", token.span, "parser")),
        };
        self.expr(kind, label, span(start, self.end()), height)
    }
    fn postfix(&mut self, value: Expr, depth: usize) -> PyResult<Expr> {
        let start = value.node.byte_range.start;
        let base_height = value.height;
        let (kind, label, child_height) = if self.take("[") {
            let first = if self.op(":") {
                None
            } else {
                Some(Box::new(self.expression(0, depth + 1)?))
            };
            if self.take(":") {
                let second = if self.op("]") || self.op(":") {
                    None
                } else {
                    Some(Box::new(self.expression(0, depth + 1)?))
                };
                let third = if self.take(":") && !self.op("]") {
                    Some(Box::new(self.expression(0, depth + 1)?))
                } else {
                    None
                };
                self.expect("]")?;
                let parts = [first, second, third];
                let height = parts
                    .iter()
                    .flatten()
                    .map(|expr| expr.height)
                    .max()
                    .unwrap_or(0);
                (ExprKind::Slice(Box::new(value), parts), "slice", height)
            } else {
                if self.op(",") {
                    return Err(self.fault("E_PY_UNSUPPORTED"));
                }
                self.expect("]")?;
                let index = first.expect("nonempty index");
                let height = index.height;
                (ExprKind::Index(Box::new(value), index), "index", height)
            }
        } else if self.take(".") {
            let method = self.name()?;
            if !matches!(method.as_str(), "append" | "pop") || !self.take("(") {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            let arguments = self.arguments(depth, false)?;
            let height = arguments.height();
            (
                ExprKind::Method(Box::new(value), method, arguments),
                "method",
                height,
            )
        } else {
            self.expect("(")?;
            let ExprKind::Name(name) = &value.kind else {
                return Err(Fault::new(
                    "E_PY_UNSUPPORTED",
                    value.node.byte_range,
                    "parser",
                ));
            };
            let arguments = self.arguments(depth, name == "print")?;
            let height = arguments.height();
            (ExprKind::Call(Box::new(value), arguments), "call", height)
        };
        self.expr(
            kind,
            label,
            span(start, self.end()),
            base_height.max(child_height),
        )
    }
    fn arguments(&mut self, depth: usize, print_keywords: bool) -> PyResult<Arguments> {
        let mut result = Arguments::default();
        while !self.op(")") {
            if self.op("*") {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            if matches!(self.token().kind, TokenKind::Name(_))
                && matches!(self.look(1), Some(TokenKind::Op("=")))
            {
                let name = self.name()?;
                if !print_keywords || !matches!(name.as_str(), "sep" | "end") {
                    return Err(self.fault("E_PY_UNSUPPORTED"));
                }
                if result.keywords.iter().any(|(old, _)| *old == name) {
                    return Err(self.fault("E_PY_SYNTAX"));
                }
                self.bump();
                result.keywords.push((name, self.expression(0, depth + 1)?));
            } else {
                if !result.keywords.is_empty() {
                    return Err(self.fault("E_PY_SYNTAX"));
                }
                result.positional.push(self.expression(0, depth + 1)?);
            }
            if self.word("for") {
                return Err(self.fault("E_PY_UNSUPPORTED"));
            }
            if !self.take(",") {
                break;
            }
        }
        self.expect(")")?;
        Ok(result)
    }
}

fn collect_locals(statements: &[Stmt], locals: &mut BTreeSet<String>) {
    for statement in statements {
        match &statement.kind {
            StmtKind::Assign(
                Expr {
                    kind: ExprKind::Name(name),
                    ..
                },
                _,
                _,
            ) => {
                locals.insert(name.clone());
            }
            StmtKind::If(conditions, other) => {
                for (_, body) in conditions {
                    collect_locals(body, locals);
                }
                collect_locals(other, locals);
            }
            StmtKind::While(_, body) => collect_locals(body, locals),
            StmtKind::For(name, _, body) => {
                locals.insert(name.clone());
                collect_locals(body, locals);
            }
            _ => {}
        }
    }
}
