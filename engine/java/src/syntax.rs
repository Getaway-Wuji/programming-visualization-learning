use std::collections::BTreeMap;

use serde::Serialize;

use crate::lexer::{self, Kind, Token};
use crate::source::ByteRange;
use crate::{Fault, JavaResult, MAX_BINDINGS, MAX_SYNTAX_DEPTH, Meter, charge, span};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Type {
    Int,
    Long,
    Bool,
    String,
    IntArray,
    StringArray,
    Scanner,
    Class(String),
    Null,
    Void,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Node {
    #[serde(serialize_with = "crate::ordered_range")]
    pub byte_range: ByteRange,
    pub kind: &'static str,
    pub node_id: u32,
}

#[derive(Debug)]
pub(crate) struct Located<T> {
    pub node: Node,
    pub item: T,
    depth: usize,
}

pub(crate) type Expr = Located<Expression>;
pub(crate) type Stmt = Located<Statement>;
pub(crate) type Block = Located<Vec<Stmt>>;

#[derive(Debug)]
pub(crate) enum Expression {
    Int(i32),
    Long(i64),
    Bool(bool),
    String(String),
    Null,
    Name(String),
    Group(Box<Expr>),
    Unary(&'static str, Box<Expr>),
    Cast(Type, Box<Expr>),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Index(Box<Expr>, Box<Expr>),
    Field(Box<Expr>, String),
    Call(String, Vec<Expr>),
    ReceiverCall(Box<Expr>, String, Vec<Expr>),
    NewArray(Type, Box<Expr>),
    NewClass(String),
    NewScanner,
}

#[derive(Debug)]
pub(crate) enum Statement {
    Block(Block),
    Let(Type, String, Expr),
    Assign(Expr, Expr),
    Increment(String, bool),
    Call(Expr),
    If(Expr, Block, Option<Box<Stmt>>),
    While(Expr, Block),
    For {
        init: Option<Box<Stmt>>,
        test: Option<Expr>,
        update: Option<Box<Stmt>>,
        body: Block,
    },
    Return(Option<Expr>),
    Break,
    Continue,
}

pub(crate) struct Method {
    pub node: Node,
    pub name: String,
    pub params: Vec<(Type, String)>,
    pub result: Type,
    pub body: Block,
    public: bool,
}

pub(crate) struct Class {
    pub fields: BTreeMap<String, Type>,
    pub node: Node,
}

pub(crate) struct Program {
    pub name: String,
    pub scanner_import: bool,
    pub has_comments: bool,
    pub methods: BTreeMap<String, Method>,
    pub classes: BTreeMap<String, Class>,
    pub nodes: Vec<Node>,
}

struct Parser<'a> {
    tokens: Vec<Token>,
    cursor: usize,
    nodes: Vec<Node>,
    nesting: usize,
    meter: &'a mut Meter,
}

pub(crate) fn parse(source: &str, meter: &mut Meter) -> JavaResult<Program> {
    let lexer::Lexed {
        tokens,
        has_comments,
    } = lexer::lex(source, meter)?;
    let mut parser = Parser {
        tokens,
        cursor: 0,
        nodes: Vec::new(),
        nesting: 0,
        meter,
    };
    parser.program(has_comments)
}

impl Parser<'_> {
    fn token(&self) -> &Token {
        &self.tokens[self.cursor]
    }

    fn is(&self, text: &str) -> bool {
        match &self.token().kind {
            Kind::Word(word) => word == text,
            Kind::Symbol(symbol) => *symbol == text,
            _ => false,
        }
    }

    fn pop(&mut self) -> Token {
        let token = self.token().clone();
        if !matches!(token.kind, Kind::Eof) {
            self.cursor += 1;
        }
        token
    }

    fn take(&mut self, text: &str) -> bool {
        if self.is(text) {
            self.cursor += 1;
            true
        } else {
            false
        }
    }

    fn need(&mut self, text: &str) -> JavaResult<()> {
        if self.take(text) {
            Ok(())
        } else {
            Err(self.syntax())
        }
    }

    fn syntax(&self) -> Fault {
        Fault::new("E_JAVA_SYNTAX", self.token().range, "parse")
    }

    fn unsupported(&self) -> Fault {
        Fault::new("E_JAVA_UNSUPPORTED", self.token().range, "parse")
    }

    fn name(&mut self) -> JavaResult<String> {
        let token = self.pop();
        match token.kind {
            Kind::Word(word) if !keyword(&word) => Ok(word),
            Kind::Word(_) => Err(Fault::new("E_JAVA_UNSUPPORTED", token.range, "parse")),
            _ => Err(Fault::new("E_JAVA_SYNTAX", token.range, "parse")),
        }
    }

    fn node(&mut self, start: usize, kind: &'static str) -> JavaResult<Node> {
        let end = self.tokens[self.cursor.saturating_sub(1)].range.end;
        self.node_at(span(start, end), kind)
    }

    fn node_at(&mut self, range: ByteRange, kind: &'static str) -> JavaResult<Node> {
        charge(self.meter, 1, range, "parse")?;
        let node = Node {
            node_id: self.nodes.len() as u32 + 1,
            byte_range: range,
            kind,
        };
        self.nodes.push(node.clone());
        Ok(node)
    }

    fn located<T>(
        &mut self,
        start: usize,
        kind: &'static str,
        item: T,
        depth: usize,
    ) -> JavaResult<Located<T>> {
        let node = self.node(start, kind)?;
        if depth > MAX_SYNTAX_DEPTH {
            return Err(Fault::new("E_DEPTH_LIMIT", node.byte_range, "parse"));
        }
        Ok(Located { node, item, depth })
    }

    fn nested<T>(&mut self, parse: impl FnOnce(&mut Self) -> JavaResult<T>) -> JavaResult<T> {
        if self.nesting >= MAX_SYNTAX_DEPTH {
            return Err(Fault::new("E_DEPTH_LIMIT", self.token().range, "parse"));
        }
        self.nesting += 1;
        let result = parse(self);
        self.nesting -= 1;
        result
    }

    fn program(&mut self, has_comments: bool) -> JavaResult<Program> {
        let scanner_import = self.take("import");
        if scanner_import {
            for word in ["java", ".", "util", ".", "Scanner", ";"] {
                if !self.take(word) {
                    return Err(self.unsupported());
                }
            }
        }
        if self.is("package") || self.is("import") {
            return Err(self.unsupported());
        }
        self.need("public")?;
        self.need("class")?;
        let name = self.name()?;
        if library_name(&name) || !self.is("{") {
            return Err(self.unsupported());
        }
        self.need("{")?;
        let mut methods = BTreeMap::new();
        while !self.take("}") {
            if matches!(self.token().kind, Kind::Eof) {
                return Err(self.syntax());
            }
            let method = self.method()?;
            if methods.contains_key(&method.name) {
                return Err(Fault::new(
                    "E_JAVA_UNSUPPORTED",
                    method.node.byte_range,
                    "parse",
                ));
            }
            methods.insert(method.name.clone(), method);
        }
        let mut classes = BTreeMap::new();
        while !matches!(self.token().kind, Kind::Eof) {
            let start = self.token().range.start;
            if !self.take("class") {
                return Err(self.unsupported());
            }
            let class = self.name()?;
            if class == name
                || library_name(&class)
                || classes.contains_key(&class)
                || !self.is("{")
            {
                return Err(self.unsupported());
            }
            self.need("{")?;
            let mut fields = BTreeMap::new();
            while !self.take("}") {
                let ty = self.ty()?;
                let field = self.name()?;
                if !self.take(";")
                    || fields.len() >= MAX_BINDINGS
                    || fields.insert(field, ty).is_some()
                {
                    return Err(self.unsupported());
                }
            }
            let node = self.node(start, "class")?;
            classes.insert(class, Class { fields, node });
        }
        let main = methods.get("main").filter(|main| {
            main.public
                && main.result == Type::Void
                && matches!(main.params.as_slice(), [(Type::StringArray, _)])
        });
        if main.is_none() {
            return Err(Fault::new("E_JAVA_MAIN", self.token().range, "type"));
        }
        Ok(Program {
            name,
            scanner_import,
            has_comments,
            methods,
            classes,
            nodes: std::mem::take(&mut self.nodes),
        })
    }

    fn method(&mut self) -> JavaResult<Method> {
        let start = self.token().range.start;
        let public = self.take("public");
        if !self.take("static") {
            return Err(self.unsupported());
        }
        let result = if self.take("void") {
            Type::Void
        } else {
            self.ty()?
        };
        let name = self.name()?;
        if !self.take("(") {
            return Err(self.unsupported());
        }
        let mut params = Vec::new();
        if !self.take(")") {
            loop {
                if params.len() >= MAX_BINDINGS {
                    return Err(self.unsupported());
                }
                params.push((self.ty()?, self.name()?));
                if self.take(")") {
                    break;
                }
                self.need(",")?;
            }
        }
        let body = self.block()?;
        let node = self.node(start, "method")?;
        Ok(Method {
            node,
            name,
            params,
            result,
            body,
            public,
        })
    }

    fn base_type(&mut self) -> JavaResult<Type> {
        if self.take("int") {
            return Ok(Type::Int);
        }
        if self.take("long") {
            return Ok(Type::Long);
        }
        if self.take("boolean") {
            return Ok(Type::Bool);
        }
        if self.take("String") {
            return Ok(Type::String);
        }
        if self.take("Scanner") {
            return Ok(Type::Scanner);
        }
        Ok(Type::Class(self.name()?))
    }

    fn ty(&mut self) -> JavaResult<Type> {
        let base = self.base_type()?;
        if self.take("[") {
            self.need("]")?;
            return self.array_type(base);
        }
        Ok(base)
    }

    fn array_type(&self, base: Type) -> JavaResult<Type> {
        match base {
            Type::Int => Ok(Type::IntArray),
            Type::String => Ok(Type::StringArray),
            _ => Err(self.unsupported()),
        }
    }

    fn block(&mut self) -> JavaResult<Block> {
        let start = self.token().range.start;
        self.need("{")?;
        self.nested(|parser| {
            let mut items = Vec::new();
            let mut depth = 1;
            while !parser.take("}") {
                let stmt = parser.statement()?;
                depth = depth.max(stmt.depth + 1);
                items.push(stmt);
            }
            parser.located(start, "block", items, depth)
        })
    }

    fn statement(&mut self) -> JavaResult<Stmt> {
        let start = self.token().range.start;
        if self.is("{") {
            let block = self.block()?;
            let depth = block.depth + 1;
            return self.located(start, "scope", Statement::Block(block), depth);
        }
        if self.take("if") {
            let condition = self.condition()?;
            let body = self.block()?;
            let alternate = if self.take("else") {
                if !self.is("if") && !self.is("{") {
                    return Err(self.unsupported());
                }
                Some(Box::new(self.nested(Self::statement)?))
            } else {
                None
            };
            let depth = condition
                .depth
                .max(body.depth)
                .max(alternate.as_ref().map_or(0, |stmt| stmt.depth))
                + 1;
            return self.located(
                start,
                "if",
                Statement::If(condition, body, alternate),
                depth,
            );
        }
        if self.take("while") {
            let condition = self.condition()?;
            let body = self.block()?;
            let depth = condition.depth.max(body.depth) + 1;
            return self.located(start, "while", Statement::While(condition, body), depth);
        }
        if self.take("for") {
            self.need("(")?;
            let init = (!self.is(";"))
                .then(|| self.simple(true, false).map(Box::new))
                .transpose()?;
            self.need(";")?;
            let test = (!self.is(";")).then(|| self.expression(0)).transpose()?;
            self.need(";")?;
            let update = (!self.is(")"))
                .then(|| self.simple(false, true).map(Box::new))
                .transpose()?;
            self.need(")")?;
            let body = self.block()?;
            let depth = body
                .depth
                .max(init.as_ref().map_or(0, |stmt| stmt.depth))
                .max(test.as_ref().map_or(0, |expr| expr.depth))
                .max(update.as_ref().map_or(0, |stmt| stmt.depth))
                + 1;
            return self.located(
                start,
                "for",
                Statement::For {
                    init,
                    test,
                    update,
                    body,
                },
                depth,
            );
        }
        if self.take("return") {
            let result = (!self.is(";")).then(|| self.expression(0)).transpose()?;
            self.need(";")?;
            let depth = result.as_ref().map_or(1, |expr| expr.depth + 1);
            return self.located(start, "return", Statement::Return(result), depth);
        }
        for (word, item) in [
            ("break", Statement::Break),
            ("continue", Statement::Continue),
        ] {
            if self.take(word) {
                self.need(";")?;
                return self.located(start, word, item, 1);
            }
        }
        let (kind, item, depth) = self.simple_item(true, true)?;
        self.need(";")?;
        self.located(start, kind, item, depth)
    }

    fn simple(&mut self, allow_declaration: bool, allow_increment: bool) -> JavaResult<Stmt> {
        let start = self.token().range.start;
        let (kind, item, depth) = self.simple_item(allow_declaration, allow_increment)?;
        if matches!(item, Statement::Call(_)) {
            return Err(self.unsupported());
        }
        self.located(start, kind, item, depth)
    }

    fn simple_item(
        &mut self,
        allow_declaration: bool,
        allow_increment: bool,
    ) -> JavaResult<(&'static str, Statement, usize)> {
        let peek = |offset: usize| {
            self.tokens
                .get(self.cursor + offset)
                .map(|token| &token.kind)
        };
        let declaration = matches!(peek(0), Some(Kind::Word(_)))
            && (matches!(peek(1), Some(Kind::Word(_)))
                || matches!(
                    (peek(1), peek(2), peek(3)),
                    (
                        Some(Kind::Symbol("[")),
                        Some(Kind::Symbol("]")),
                        Some(Kind::Word(_))
                    )
                ));
        if allow_declaration && declaration {
            let ty = self.ty()?;
            let name = self.name()?;
            if !self.take("=") {
                return Err(self.unsupported());
            }
            let value = self.expression(0)?;
            let depth = value.depth + 1;
            return Ok(("declare", Statement::Let(ty, name, value), depth));
        }
        let target = self.expression(0)?;
        if self.take("=") {
            let value = self.expression(0)?;
            let depth = target.depth.max(value.depth) + 1;
            return Ok(("assign", Statement::Assign(target, value), depth));
        }
        if allow_increment && (self.is("++") || self.is("--")) {
            let plus = self.take("++");
            if !plus {
                self.need("--")?;
            }
            if let Expression::Name(name) = target.item {
                return Ok(("increment", Statement::Increment(name, plus), 1));
            }
            return Err(self.unsupported());
        }
        if matches!(
            target.item,
            Expression::Call(..) | Expression::ReceiverCall(..)
        ) {
            let depth = target.depth + 1;
            return Ok(("call-statement", Statement::Call(target), depth));
        }
        Err(self.syntax())
    }

    fn condition(&mut self) -> JavaResult<Expr> {
        self.need("(")?;
        let result = self.expression(0)?;
        self.need(")")?;
        Ok(result)
    }

    fn expression(&mut self, minimum: u8) -> JavaResult<Expr> {
        self.nested(|parser| {
            let mut left = parser.prefix()?;
            while let Kind::Symbol(op) = parser.token().kind {
                let rank = match op {
                    "||" => 1,
                    "&&" => 2,
                    "==" | "!=" => 3,
                    "<" | "<=" | ">" | ">=" => 4,
                    "+" | "-" => 5,
                    "*" | "/" | "%" => 6,
                    _ => break,
                };
                if rank < minimum {
                    break;
                }
                parser.pop();
                let right = parser.expression(rank + 1)?;
                let depth = left.depth.max(right.depth) + 1;
                let start = left.node.byte_range.start;
                left = parser.located(
                    start,
                    "binary",
                    Expression::Binary(op, Box::new(left), Box::new(right)),
                    depth,
                )?;
            }
            Ok(left)
        })
    }

    fn prefix(&mut self) -> JavaResult<Expr> {
        let start = self.token().range.start;
        for op in ["+", "-", "!"] {
            if self.take(op) {
                if op == "-"
                    && let Kind::Decimal { magnitude, wide } = self.token().kind
                {
                    let special = if wide && magnitude == (1u64 << 63) {
                        Some(Expression::Long(i64::MIN))
                    } else if !wide && magnitude == (1u64 << 31) {
                        Some(Expression::Int(i32::MIN))
                    } else {
                        None
                    };
                    if let Some(literal) = special {
                        self.pop();
                        return self.located(start, "literal", literal, 1);
                    }
                }
                let argument = self.nested(Self::prefix)?;
                let depth = argument.depth + 1;
                return self.located(
                    start,
                    "unary",
                    Expression::Unary(op, Box::new(argument)),
                    depth,
                );
            }
        }
        if self.is("(")
            && matches!(
                self.tokens.get(self.cursor + 2).map(|t| &t.kind),
                Some(Kind::Symbol(")"))
            )
            && matches!(self.tokens.get(self.cursor + 1).map(|t| &t.kind), Some(Kind::Word(w)) if w == "int" || w == "long")
        {
            self.pop();
            let ty = self.base_type()?;
            self.need(")")?;
            let value = self.nested(Self::prefix)?;
            let depth = value.depth + 1;
            return self.located(start, "cast", Expression::Cast(ty, Box::new(value)), depth);
        }
        let mut expr = self.primary()?;
        loop {
            if self.take("[") {
                let index = self.expression(0)?;
                self.need("]")?;
                let depth = expr.depth.max(index.depth) + 1;
                expr = self.located(
                    start,
                    "index",
                    Expression::Index(Box::new(expr), Box::new(index)),
                    depth,
                )?;
            } else if self.take(".") {
                let field = self.name()?;
                if self.take("(") {
                    let args = self.args()?;
                    let depth = args
                        .iter()
                        .map(|arg| arg.depth)
                        .fold(expr.depth, usize::max)
                        + 1;
                    expr = self.located(
                        start,
                        "receiver-call",
                        Expression::ReceiverCall(Box::new(expr), field, args),
                        depth,
                    )?;
                } else {
                    let depth = expr.depth + 1;
                    expr = self.located(
                        start,
                        "field",
                        Expression::Field(Box::new(expr), field),
                        depth,
                    )?;
                }
            } else {
                break;
            }
        }
        Ok(expr)
    }

    fn primary(&mut self) -> JavaResult<Expr> {
        let token = self.pop();
        let start = token.range.start;
        let (tag, expression, depth) = match token.kind {
            Kind::Decimal { magnitude, wide } => {
                let error = |_| Fault::new("E_JAVA_LITERAL", token.range, "parse");
                let expr = if wide {
                    Expression::Long(i64::try_from(magnitude).map_err(error)?)
                } else {
                    Expression::Int(i32::try_from(magnitude).map_err(error)?)
                };
                ("literal", expr, 1)
            }
            Kind::Text(text) => ("literal", Expression::String(text), 1),
            Kind::Word(word) if word == "true" => ("literal", Expression::Bool(true), 1),
            Kind::Word(word) if word == "false" => ("literal", Expression::Bool(false), 1),
            Kind::Word(word) if word == "null" => ("literal", Expression::Null, 1),
            Kind::Word(word) if word == "new" => return self.new_expression(start),
            Kind::Word(word) if !keyword(&word) => {
                if self.take("(") {
                    let args = self.args()?;
                    let depth = args.iter().map(|arg| arg.depth).max().unwrap_or(0) + 1;
                    ("call", Expression::Call(word, args), depth)
                } else {
                    ("name", Expression::Name(word), 1)
                }
            }
            Kind::Word(_) => return Err(Fault::new("E_JAVA_UNSUPPORTED", token.range, "parse")),
            Kind::Symbol("(") => {
                let expr = self.expression(0)?;
                self.need(")")?;
                let depth = expr.depth + 1;
                ("group", Expression::Group(Box::new(expr)), depth)
            }
            _ => return Err(Fault::new("E_JAVA_SYNTAX", token.range, "parse")),
        };
        self.located(start, tag, expression, depth)
    }

    fn args(&mut self) -> JavaResult<Vec<Expr>> {
        let mut args = Vec::new();
        if !self.take(")") {
            loop {
                if args.len() >= MAX_BINDINGS {
                    return Err(self.unsupported());
                }
                args.push(self.expression(0)?);
                if self.take(")") {
                    break;
                }
                self.need(",")?;
            }
        }
        Ok(args)
    }

    fn new_expression(&mut self, start: usize) -> JavaResult<Expr> {
        let base = self.base_type()?;
        if self.take("[") {
            let ty = self.array_type(base)?;
            let length = self.expression(0)?;
            self.need("]")?;
            if self.is("[") || self.is("{") {
                return Err(self.unsupported());
            }
            let depth = length.depth + 1;
            return self.located(
                start,
                "new-array",
                Expression::NewArray(ty, Box::new(length)),
                depth,
            );
        }
        if !self.take("(") {
            return Err(self.unsupported());
        }
        let item = match base {
            Type::Class(class) => Expression::NewClass(class),
            Type::Scanner => {
                for word in ["System", ".", "in"] {
                    if !self.take(word) {
                        return Err(self.unsupported());
                    }
                }
                Expression::NewScanner
            }
            _ => return Err(self.unsupported()),
        };
        if !self.take(")") {
            return Err(self.unsupported());
        }
        self.located(start, "new-object", item, 1)
    }
}

pub(crate) fn library_name(word: &str) -> bool {
    matches!(
        word,
        "System" | "String" | "Scanner" | "Object" | "Class" | "Math" | "Thread"
    )
}

fn keyword(word: &str) -> bool {
    matches!(
        word,
        "abstract"
            | "assert"
            | "boolean"
            | "break"
            | "byte"
            | "case"
            | "catch"
            | "char"
            | "class"
            | "const"
            | "continue"
            | "default"
            | "do"
            | "double"
            | "else"
            | "enum"
            | "extends"
            | "final"
            | "finally"
            | "float"
            | "for"
            | "goto"
            | "if"
            | "implements"
            | "import"
            | "instanceof"
            | "int"
            | "interface"
            | "long"
            | "native"
            | "new"
            | "package"
            | "private"
            | "protected"
            | "public"
            | "return"
            | "short"
            | "static"
            | "strictfp"
            | "super"
            | "switch"
            | "synchronized"
            | "this"
            | "throw"
            | "throws"
            | "transient"
            | "try"
            | "void"
            | "volatile"
            | "while"
            | "_"
            | "true"
            | "false"
            | "null"
    )
}
