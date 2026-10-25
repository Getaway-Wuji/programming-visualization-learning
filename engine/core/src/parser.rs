//! P0-C structure and original-source mapping, without semantic checking.
//!
//! Only a complete translation unit is accepted. A failed parse returns no AST.
//! Expressions use an arena, bounded precedence parsing and checked depths;
//! the final AST is deterministically reordered into STEP-01 preorder.

use crate::ast::{BinaryOp, Expression, Initializer, Node, NodeData, NodeId, Program, UnaryOp};
use crate::budget::{Meter, TimingPhase};
use crate::diagnostic::{Diagnostic, DiagnosticCode, Location, Stage};
use crate::lexer::{self, Keyword, Lexed, Symbol, Token, TokenKind};
use crate::source::ByteRange;

pub const MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub program: Program,
    /// Successful lexical cost plus consumed tokens, built nodes and child
    /// depth visits. This is not complete run fuel or EXEC statistics; final
    /// mapping/encoding and failed-phase metering are integrated in task 06.4.
    pub fuel_used: usize,
    pub max_syntax_depth: usize,
    pub max_ast_depth: usize,
}

pub fn parse(source: &str) -> Result<Parsed, Diagnostic> {
    Parser::new(lexer::lex(source)?, None).program()
}

pub fn parse_bytes(source: &[u8]) -> Result<Parsed, Diagnostic> {
    Parser::new(lexer::lex_bytes(source)?, None).program()
}

pub fn parse_metered(source: &str, meter: &mut Meter) -> Result<Parsed, Diagnostic> {
    meter.measure(TimingPhase::SourceParse, |meter| {
        let lexed = lexer::lex_metered(source, meter)?;
        Parser::new(lexed, Some(meter)).program()
    })
}

pub fn parse_bytes_metered(source: &[u8], meter: &mut Meter) -> Result<Parsed, Diagnostic> {
    meter.measure(TimingPhase::SourceParse, |meter| {
        let lexed = lexer::lex_bytes_metered(source, meter)?;
        Parser::new(lexed, Some(meter)).program()
    })
}

struct Parser<'m> {
    meter: Option<&'m mut Meter>,
    tokens: Vec<Token>,
    cursor: usize,
    nodes: Vec<Node>,
    expression_depths: Vec<usize>,
    work: usize,
    max_syntax_depth: usize,
    max_ast_depth: usize,
    // An active unary invocation corresponds to a grouping/index delimiter or
    // an expression ancestor. A valid source under both 64-depth limits cannot
    // require more than their sum. This guard also bounds malformed inputs
    // before incomplete parent nodes can be constructed and checked.
    active_unary: usize,
}

impl<'m> Parser<'m> {
    fn new(lexed: Lexed, meter: Option<&'m mut Meter>) -> Self {
        Self {
            meter,
            tokens: lexed.tokens,
            cursor: 0,
            nodes: Vec::new(),
            expression_depths: Vec::new(),
            work: lexed.fuel_used,
            max_syntax_depth: 0,
            max_ast_depth: 0,
            active_unary: 0,
        }
    }

    fn charge(&mut self, units: usize, range: ByteRange) -> Result<(), Diagnostic> {
        if let Some(meter) = self.meter.as_deref_mut() {
            meter.charge(units).map_err(|error| {
                error.diagnostic(Stage::Parse, Location::Source { byte_range: range })
            })?;
        }
        Ok(())
    }

    fn program(mut self) -> Result<Parsed, Diagnostic> {
        let header_range = if self.peek().kind == TokenKind::IncludeStdio {
            Some(self.advance()?.byte_range)
        } else {
            None
        };
        if self.peek().kind == TokenKind::IncludeStdio {
            return Err(self.unsupported("at most one teaching header before main"));
        }
        if self.peek().kind == TokenKind::Eof {
            return Err(self.invalid("main function definition"));
        }
        let start = self.peek().byte_range.start;
        if !self.eat_keyword(Keyword::Int)? {
            return Err(self.unsupported("one int main(void) or int main() definition"));
        }
        if !self.eat_keyword(Keyword::Main)? {
            if self.peek().kind == TokenKind::Eof {
                return Err(self.invalid("main function name"));
            }
            return Err(self.unsupported("only the main function; no global declarations"));
        }
        self.expect_symbol(Symbol::LeftParen, "main opening parenthesis")?;
        self.eat_keyword(Keyword::Void)?;
        if !self.at_symbol(Symbol::RightParen) {
            if self.peek().kind == TokenKind::Eof {
                return Err(self.invalid("main closing parenthesis"));
            }
            return Err(self.unsupported("main without parameters"));
        }
        self.advance()?;
        if self.at_symbol(Symbol::Semicolon) {
            return Err(self.unsupported("main definition with a block, not a prototype"));
        }
        let body = self.block(1)?;
        if self.peek().kind != TokenKind::Eof {
            return Err(self.unsupported("end of source after the single main definition"));
        }
        let end = self.nodes[body].byte_range.end;
        let root = self.add(NodeData::Function { body }, ByteRange { start, end })?;
        let program = match self.meter {
            Some(meter) => Program::from_arena_metered(self.nodes, root, header_range, meter)?,
            None => Program::from_arena(self.nodes, root, header_range),
        };
        Ok(Parsed {
            program,
            fuel_used: self.work,
            max_syntax_depth: self.max_syntax_depth,
            max_ast_depth: self.max_ast_depth,
        })
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.cursor]
    }

    fn advance(&mut self) -> Result<Token, Diagnostic> {
        let range = self.peek().byte_range;
        let copied = match &self.peek().kind {
            TokenKind::Identifier(value) | TokenKind::StringLiteral(value) => {
                value.len().div_ceil(64)
            }
            _ => 0,
        };
        self.charge(1 + copied, range)?;
        let token = self.tokens[self.cursor].clone();
        if token.kind != TokenKind::Eof {
            self.cursor += 1;
            self.work += 1;
        }
        Ok(token)
    }

    fn last_end(&self) -> usize {
        self.tokens[self.cursor.saturating_sub(1)].byte_range.end
    }

    fn at_symbol(&self, symbol: Symbol) -> bool {
        self.peek().kind == TokenKind::Symbol(symbol)
    }

    fn eat_symbol(&mut self, symbol: Symbol) -> Result<bool, Diagnostic> {
        if self.at_symbol(symbol) {
            self.advance()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn eat_keyword(&mut self, keyword: Keyword) -> Result<bool, Diagnostic> {
        if self.peek().kind == TokenKind::Keyword(keyword) {
            self.advance()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn invalid(&self, expected: &'static str) -> Diagnostic {
        Diagnostic::parsing(
            DiagnosticCode::ParseInvalid,
            self.peek().byte_range,
            expected,
        )
    }

    fn unsupported(&self, expected: &'static str) -> Diagnostic {
        if self.peek().kind == TokenKind::Eof {
            return self.invalid(expected);
        }
        Diagnostic::parsing(
            DiagnosticCode::UnsupportedSyntax,
            self.peek().byte_range,
            expected,
        )
    }

    fn expect_symbol(
        &mut self,
        symbol: Symbol,
        expected: &'static str,
    ) -> Result<Token, Diagnostic> {
        if self.at_symbol(symbol) {
            self.advance()
        } else {
            Err(self.invalid(expected))
        }
    }

    fn syntax(&mut self, depth: usize) -> Result<(), Diagnostic> {
        let limit = self
            .meter
            .as_deref()
            .map_or(MAX_DEPTH, |meter| meter.limits().max_syntax_depth);
        if depth > limit {
            let mut error = Diagnostic::depth(self.peek().byte_range, "syntaxDepth", depth);
            error.details.limit = Some(limit);
            error.details.used = Some(limit);
            return Err(error);
        }
        self.max_syntax_depth = self.max_syntax_depth.max(depth);
        Ok(())
    }

    fn add(&mut self, data: NodeData, byte_range: ByteRange) -> Result<NodeId, Diagnostic> {
        self.charge(data.entry_weight(), byte_range)?;
        let children = data.children();
        self.work += 1 + children.len();
        let depth = if matches!(data, NodeData::Expr(_)) {
            1 + children
                .iter()
                .map(|&id| self.expression_depths[id])
                .max()
                .unwrap_or(0)
        } else {
            0
        };
        let limit = self
            .meter
            .as_deref()
            .map_or(MAX_DEPTH, |meter| meter.limits().max_ast_depth);
        if depth > limit {
            let mut error = Diagnostic::depth(byte_range, "astDepth", depth);
            error.details.limit = Some(limit);
            error.details.used = Some(limit);
            return Err(error);
        }
        self.max_ast_depth = self.max_ast_depth.max(depth);
        let id = self.nodes.len();
        self.nodes.push(Node { data, byte_range });
        self.expression_depths.push(depth);
        Ok(id)
    }

    fn block(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        self.syntax(depth)?;
        let start = self
            .expect_symbol(Symbol::LeftBrace, "opening block brace")?
            .byte_range
            .start;
        let mut statements = Vec::new();
        while !self.at_symbol(Symbol::RightBrace) {
            if self.peek().kind == TokenKind::Eof {
                return Err(self.invalid("closing block brace"));
            }
            self.charge(1, self.peek().byte_range)?;
            statements.push(self.statement(depth)?);
        }
        let end = self.advance()?.byte_range.end;
        self.add(NodeData::Block { statements }, ByteRange { start, end })
    }

    fn statement(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        let start = self.peek().byte_range.start;
        match self.peek().kind {
            TokenKind::Symbol(Symbol::LeftBrace) => self.block(depth + 1),
            TokenKind::Symbol(Symbol::Semicolon) => {
                let range = self.advance()?.byte_range;
                self.add(NodeData::Empty, range)
            }
            TokenKind::Keyword(Keyword::Int) => {
                let id = self.declaration(depth)?;
                self.finish_statement(id)?;
                Ok(id)
            }
            TokenKind::Keyword(Keyword::If) => self.if_statement(depth + 1),
            TokenKind::Keyword(Keyword::While) => self.while_statement(depth + 1),
            TokenKind::Keyword(Keyword::For) => self.for_statement(depth + 1),
            TokenKind::Keyword(Keyword::Return) => {
                self.advance()?;
                let value = self.expression(depth)?;
                let end = self
                    .expect_symbol(Symbol::Semicolon, "semicolon after return value")?
                    .byte_range
                    .end;
                self.add(NodeData::Return { value }, ByteRange { start, end })
            }
            TokenKind::Keyword(Keyword::Break | Keyword::Continue) => {
                let keyword = self.advance()?.kind;
                let end = self
                    .expect_symbol(Symbol::Semicolon, "semicolon after jump")?
                    .byte_range
                    .end;
                let data = if keyword == TokenKind::Keyword(Keyword::Break) {
                    NodeData::Break
                } else {
                    NodeData::Continue
                };
                self.add(data, ByteRange { start, end })
            }
            TokenKind::Keyword(Keyword::Printf)
                if self.tokens[self.cursor + 1].kind == TokenKind::Symbol(Symbol::LeftParen) =>
            {
                self.output(depth)
            }
            TokenKind::Identifier(_) | TokenKind::Keyword(Keyword::Main | Keyword::Printf) => {
                let id = self.assignment(depth)?;
                self.finish_statement(id)?;
                Ok(id)
            }
            TokenKind::Keyword(Keyword::Sizeof | Keyword::Void) | TokenKind::IncludeStdio => {
                Err(self.unsupported("P0-C statement; no local header, sizeof or void object"))
            }
            _ => Err(self.unsupported("declaration, assignment, output or structured statement")),
        }
    }

    fn finish_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        if self.at_symbol(Symbol::Comma) {
            return Err(self.unsupported("one declaration or assignment per statement"));
        }
        let end = self
            .expect_symbol(Symbol::Semicolon, "statement semicolon")?
            .byte_range
            .end;
        self.nodes[id].byte_range.end = end;
        Ok(())
    }

    fn name(&mut self) -> Result<(String, ByteRange), Diagnostic> {
        let copied = match &self.peek().kind {
            TokenKind::Identifier(value) => value.len().div_ceil(64),
            _ => 1,
        };
        self.charge(copied, self.peek().byte_range)?;
        let token = self.peek();
        let name = match &token.kind {
            TokenKind::Identifier(name) => name.clone(),
            TokenKind::Keyword(Keyword::Main) => "main".to_owned(),
            TokenKind::Keyword(Keyword::Printf) => "printf".to_owned(),
            _ => return Err(self.unsupported("ASCII object identifier")),
        };
        let range = self.advance()?.byte_range;
        Ok((name, range))
    }

    fn declaration(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        let start = self.advance()?.byte_range.start; // caller established int
        let (name, name_range) = self.name()?;
        if self.at_symbol(Symbol::LeftParen) {
            return Err(self.unsupported("no user function or local prototype"));
        }
        let array_length = if self.eat_symbol(Symbol::LeftBracket)? {
            self.syntax(depth + 1)?;
            let TokenKind::Integer(length) = self.peek().kind else {
                return Err(self.unsupported("fixed array length as one decimal integer token"));
            };
            self.advance()?;
            self.expect_symbol(Symbol::RightBracket, "array length closing bracket")?;
            if self.at_symbol(Symbol::LeftBracket) {
                return Err(self.unsupported("one-dimensional array only"));
            }
            Some(length) // positivity and initializer capacity are checked in 05.3
        } else {
            None
        };
        let initializer = if self.eat_symbol(Symbol::Assign)? {
            if array_length.is_some() {
                self.expect_symbol(Symbol::LeftBrace, "array literal initializer opening brace")?;
                if self.at_symbol(Symbol::RightBrace) {
                    return Err(self.unsupported("nonempty array literal initializer"));
                }
                self.charge(1, self.peek().byte_range)?;
                let mut values = vec![self.signed_literal()?];
                while self.eat_symbol(Symbol::Comma)? {
                    if self.at_symbol(Symbol::RightBrace) {
                        return Err(self.unsupported("no trailing initializer comma"));
                    }
                    self.charge(1, self.peek().byte_range)?;
                    values.push(self.signed_literal()?);
                }
                self.expect_symbol(Symbol::RightBrace, "array initializer closing brace")?;
                Initializer::Array(values)
            } else {
                if self.at_symbol(Symbol::LeftBrace) {
                    return Err(self.unsupported("scalar initializer is a pure integer expression"));
                }
                Initializer::Scalar(self.expression(depth)?)
            }
        } else {
            Initializer::None
        };
        let end = self.last_end();
        self.add(
            NodeData::Declaration {
                name,
                name_range,
                array_length,
                initializer,
            },
            ByteRange { start, end },
        )
    }

    fn signed_literal(&mut self) -> Result<NodeId, Diagnostic> {
        let start = self.peek().byte_range.start;
        let op = if self.eat_symbol(Symbol::Plus)? {
            Some(UnaryOp::Plus)
        } else if self.eat_symbol(Symbol::Minus)? {
            Some(UnaryOp::Minus)
        } else {
            None
        };
        let TokenKind::Integer(value) = self.peek().kind else {
            return Err(
                self.unsupported("array initializer: optional single sign and integer literal")
            );
        };
        let range = self.advance()?.byte_range;
        let operand = self.add(NodeData::Expr(Expression::Integer(value)), range)?;
        if let Some(op) = op {
            self.add(
                NodeData::Expr(Expression::Unary { op, operand }),
                ByteRange {
                    start,
                    end: range.end,
                },
            )
        } else {
            Ok(operand)
        }
    }

    fn assignment(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        let target = self.named_expression(depth)?;
        let start = self.nodes[target].byte_range.start;
        if !self.at_symbol(Symbol::Assign) {
            return Err(self.unsupported("assignment statement with one '='"));
        }
        self.advance()?;
        let value = self.expression(depth)?;
        if self.at_symbol(Symbol::Assign) {
            return Err(self.unsupported("no chained assignment or assignment expression"));
        }
        let end = self.nodes[value].byte_range.end;
        self.add(
            NodeData::Assignment { target, value },
            ByteRange { start, end },
        )
    }

    fn condition(&mut self, control_depth: usize) -> Result<NodeId, Diagnostic> {
        let start = self
            .expect_symbol(Symbol::LeftParen, "condition opening parenthesis")?
            .byte_range
            .start;
        let expression = self.expression(control_depth + 1)?;
        let end = self
            .expect_symbol(Symbol::RightParen, "condition closing parenthesis")?
            .byte_range
            .end;
        self.add(NodeData::Condition { expression }, ByteRange { start, end })
    }

    fn if_statement(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        self.syntax(depth)?;
        let start = self.advance()?.byte_range.start;
        let condition = self.condition(depth)?;
        let then_block = self.block(depth + 1)?;
        let else_block = if self.eat_keyword(Keyword::Else)? {
            Some(self.block(depth + 1)?)
        } else {
            None
        };
        let end = self.last_end();
        self.add(
            NodeData::If {
                condition,
                then_block,
                else_block,
            },
            ByteRange { start, end },
        )
    }

    fn while_statement(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        self.syntax(depth)?;
        let start = self.advance()?.byte_range.start;
        let condition = self.condition(depth)?;
        let body = self.block(depth + 1)?;
        let end = self.last_end();
        self.add(
            NodeData::While { condition, body },
            ByteRange { start, end },
        )
    }

    fn for_statement(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        self.syntax(depth)?;
        let start = self.advance()?.byte_range.start;
        self.expect_symbol(Symbol::LeftParen, "for opening parenthesis")?;
        self.syntax(depth + 1)?;
        let init = if self.at_symbol(Symbol::Semicolon) {
            None
        } else if self.peek().kind == TokenKind::Keyword(Keyword::Int) {
            let id = self.declaration(depth + 1)?;
            if matches!(
                self.nodes[id].data,
                NodeData::Declaration {
                    array_length: Some(_),
                    ..
                }
            ) {
                return Err(self.unsupported("for initializer declaration must be scalar"));
            }
            Some(id)
        } else {
            Some(self.assignment(depth + 1)?)
        };
        self.expect_symbol(Symbol::Semicolon, "for initializer semicolon")?;
        if let Some(id) = init {
            self.nodes[id].byte_range.end = self.last_end();
        }
        let condition = if self.at_symbol(Symbol::Semicolon) {
            None
        } else {
            let expression = self.expression(depth + 1)?;
            let range = self.nodes[expression].byte_range;
            Some(self.add(NodeData::Condition { expression }, range)?)
        };
        self.expect_symbol(Symbol::Semicolon, "for condition semicolon")?;
        let update = if self.at_symbol(Symbol::RightParen) {
            None
        } else {
            Some(self.assignment(depth + 1)?)
        };
        self.expect_symbol(Symbol::RightParen, "for closing parenthesis")?;
        let body = self.block(depth + 1)?;
        let end = self.last_end();
        self.add(
            NodeData::For {
                init,
                condition,
                update,
                body,
            },
            ByteRange { start, end },
        )
    }

    fn output(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        let start = self.advance()?.byte_range.start;
        self.expect_symbol(Symbol::LeftParen, "printf opening parenthesis")?;
        self.syntax(depth + 1)?;
        let copied = match &self.peek().kind {
            TokenKind::StringLiteral(value) => value.len().div_ceil(64),
            _ => 0,
        };
        self.charge(copied, self.peek().byte_range)?;
        let TokenKind::StringLiteral(format) = &self.peek().kind else {
            return Err(self.invalid("printf requires a single string literal format"));
        };
        let format = format.clone();
        let format_range = self.advance()?.byte_range;
        let mut arguments = Vec::new();
        while self.eat_symbol(Symbol::Comma)? {
            self.charge(1, self.peek().byte_range)?;
            arguments.push(self.expression(depth + 1)?);
        }
        self.expect_symbol(
            Symbol::RightParen,
            "printf closing parenthesis; no adjacent strings",
        )?;
        let end = self
            .expect_symbol(Symbol::Semicolon, "printf semicolon")?
            .byte_range
            .end;
        self.add(
            NodeData::Output {
                format,
                format_range,
                arguments,
            },
            ByteRange { start, end },
        )
    }

    fn expression(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        self.syntax(depth)?;
        self.binary(1, depth)
    }

    fn binary(&mut self, min_precedence: u8, depth: usize) -> Result<NodeId, Diagnostic> {
        let mut left = self.unary(depth)?;
        while let Some((op, precedence)) = binary_operator(&self.peek().kind) {
            if precedence < min_precedence {
                break;
            }
            self.advance()?;
            let right = self.binary(precedence + 1, depth)?;
            let range = ByteRange {
                start: self.nodes[left].byte_range.start,
                end: self.nodes[right].byte_range.end,
            };
            left = self.add(
                NodeData::Expr(Expression::Binary { op, left, right }),
                range,
            )?;
        }
        Ok(left)
    }

    fn unary(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        if self.active_unary >= 2 * MAX_DEPTH {
            return Err(Diagnostic::depth(
                self.peek().byte_range,
                "astDepth",
                MAX_DEPTH + 1,
            ));
        }
        self.active_unary += 1;
        let result = self.unary_inner(depth);
        self.active_unary -= 1;
        result
    }

    fn unary_inner(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        let start = self.peek().byte_range.start;
        let op = match self.peek().kind {
            TokenKind::Symbol(Symbol::Plus) => Some(UnaryOp::Plus),
            TokenKind::Symbol(Symbol::Minus) => Some(UnaryOp::Minus),
            TokenKind::Symbol(Symbol::Not) => Some(UnaryOp::Not),
            _ => None,
        };
        if let Some(op) = op {
            self.advance()?;
            let operand = self.unary(depth)?;
            let end = self.nodes[operand].byte_range.end;
            return self.add(
                NodeData::Expr(Expression::Unary { op, operand }),
                ByteRange { start, end },
            );
        }
        match self.peek().kind {
            TokenKind::Integer(value) => {
                let range = self.advance()?.byte_range;
                self.add(NodeData::Expr(Expression::Integer(value)), range)
            }
            TokenKind::Identifier(_) | TokenKind::Keyword(Keyword::Main | Keyword::Printf) => {
                self.named_expression(depth)
            }
            TokenKind::Symbol(Symbol::LeftParen) => {
                self.advance()?;
                let expression = self.expression(depth + 1)?;
                let end = self
                    .expect_symbol(Symbol::RightParen, "expression closing parenthesis")?
                    .byte_range
                    .end;
                // Parentheses affect source/syntax depth, not the semantic AST.
                self.nodes[expression].byte_range = ByteRange { start, end };
                Ok(expression)
            }
            TokenKind::Keyword(Keyword::Sizeof | Keyword::Void | Keyword::Int)
            | TokenKind::StringLiteral(_) => {
                Err(self.unsupported("pure int expression; no sizeof, cast, type or string value"))
            }
            _ => {
                Err(self.invalid("integer literal, name, index, unary or parenthesized expression"))
            }
        }
    }

    fn named_expression(&mut self, depth: usize) -> Result<NodeId, Diagnostic> {
        let (name, range) = self.name()?;
        if self.at_symbol(Symbol::LeftParen) {
            return Err(self.unsupported("no function calls in expressions or user functions"));
        }
        let array = self.add(NodeData::Expr(Expression::Name(name)), range)?;
        if self.eat_symbol(Symbol::LeftBracket)? {
            let index = self.expression(depth + 1)?;
            let end = self
                .expect_symbol(Symbol::RightBracket, "index closing bracket")?
                .byte_range
                .end;
            if self.at_symbol(Symbol::LeftBracket) {
                return Err(self.unsupported("one-dimensional indexing only"));
            }
            self.add(
                NodeData::Expr(Expression::Index { array, index }),
                ByteRange {
                    start: range.start,
                    end,
                },
            )
        } else {
            Ok(array)
        }
    }
}

fn binary_operator(token: &TokenKind) -> Option<(BinaryOp, u8)> {
    let TokenKind::Symbol(symbol) = token else {
        return None;
    };
    Some(match symbol {
        Symbol::OrOr => (BinaryOp::Or, 1),
        Symbol::AndAnd => (BinaryOp::And, 2),
        Symbol::Equal => (BinaryOp::Equal, 3),
        Symbol::NotEqual => (BinaryOp::NotEqual, 3),
        Symbol::Less => (BinaryOp::Less, 4),
        Symbol::LessEqual => (BinaryOp::LessEqual, 4),
        Symbol::Greater => (BinaryOp::Greater, 4),
        Symbol::GreaterEqual => (BinaryOp::GreaterEqual, 4),
        Symbol::Plus => (BinaryOp::Add, 5),
        Symbol::Minus => (BinaryOp::Subtract, 5),
        Symbol::Star => (BinaryOp::Multiply, 6),
        Symbol::Slash => (BinaryOp::Divide, 6),
        Symbol::Percent => (BinaryOp::Remainder, 6),
        _ => return None,
    })
}
