//! Iterative, fail-closed P0-C scanner. Tokens retain exact original UTF-8 spans.
//!
//! This API returns no partial token stream on failure. Whitespace and comments
//! are the only omitted text. Header placement, identifier bindings, printf
//! formats, expression structure and depth are checked by later parser/semantic
//! tasks. No C program is executed here, and no EXEC result is manufactured.

use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, DiagnosticCode, Location, Stage};
use crate::source::ByteRange;

pub const MAX_SOURCE_BYTES: usize = 32_768;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Keyword {
    Int,
    Void,
    Main,
    Printf,
    If,
    Else,
    While,
    For,
    Break,
    Continue,
    Return,
    /// Recognized reserved syntax, rejected by the parser (not an expression).
    Sizeof,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Symbol {
    LeftParen,
    RightParen,
    LeftBrace,
    RightBrace,
    LeftBracket,
    RightBracket,
    Semicolon,
    Comma,
    Assign,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Equal,
    NotEqual,
    Not,
    AndAnd,
    OrOr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenKind {
    Keyword(Keyword),
    Identifier(String),
    Integer(i32),
    /// Decoded text; the token span still includes both original quotes.
    StringLiteral(String),
    Symbol(Symbol),
    IncludeStdio,
    Eof,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub byte_range: ByteRange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lexed {
    pub tokens: Vec<Token>,
    /// Lexical work only: each scanned source byte + each token (including EOF).
    /// A later run meter must add this cost to parsing/execution/encoding costs.
    pub fuel_used: usize,
}

/// Reject an oversized source before decoding or constructing any token.
pub fn lex_bytes(source: &[u8]) -> Result<Lexed, Diagnostic> {
    check_size(source.len())?;
    let text = std::str::from_utf8(source).map_err(|_| Diagnostic::invalid_encoding())?;
    lex(text)
}

/// Scan an unchanged UTF-8 string. Negative literals remain separate '-' tokens.
pub fn lex(source: &str) -> Result<Lexed, Diagnostic> {
    check_size(source.len())?;
    Scanner {
        source,
        offset: 0,
        meter: None,
    }
    .scan()
}

/// Scan under the caller's one shared run budget, including failed scans.
pub fn lex_metered(source: &str, meter: &mut Meter) -> Result<Lexed, Diagnostic> {
    check_metered_size(source.len(), meter)?;
    Scanner {
        source,
        offset: 0,
        meter: Some(meter),
    }
    .scan()
}

pub fn lex_bytes_metered(source: &[u8], meter: &mut Meter) -> Result<Lexed, Diagnostic> {
    check_metered_size(source.len(), meter)?;
    meter.charge(source.len().div_ceil(64)).map_err(|error| {
        error.diagnostic(
            Stage::Lex,
            Location::Synthetic {
                reason: "pre-execution",
            },
        )
    })?;
    let text = std::str::from_utf8(source).map_err(|_| Diagnostic::invalid_encoding())?;
    lex_metered(text, meter)
}

fn check_metered_size(bytes: usize, meter: &Meter) -> Result<(), Diagnostic> {
    let limit = meter.limits().source_bytes;
    if bytes > limit {
        Err(Diagnostic::source_limit(bytes, limit))
    } else {
        Ok(())
    }
}

fn check_size(bytes: usize) -> Result<(), Diagnostic> {
    if bytes > MAX_SOURCE_BYTES {
        Err(Diagnostic::source_limit(bytes, MAX_SOURCE_BYTES))
    } else {
        Ok(())
    }
}

struct Scanner<'a, 'm> {
    source: &'a str,
    offset: usize,
    meter: Option<&'m mut Meter>,
}

impl Scanner<'_, '_> {
    fn charge(&mut self, units: usize) -> Result<(), Diagnostic> {
        if let Some(meter) = self.meter.as_deref_mut() {
            meter.charge(units).map_err(|error| {
                error.diagnostic(
                    Stage::Lex,
                    Location::Source {
                        byte_range: ByteRange {
                            start: self.offset,
                            end: self.offset,
                        },
                    },
                )
            })?;
        }
        Ok(())
    }

    fn scan(mut self) -> Result<Lexed, Diagnostic> {
        let mut tokens = Vec::new();
        while let Some(ch) = self.peek() {
            if is_space(ch) {
                self.advance()?;
                continue;
            }
            if self.rest().starts_with("//") {
                self.line_comment()?;
                continue;
            }
            if self.rest().starts_with("/*") {
                self.block_comment()?;
                continue;
            }
            let start = self.offset;
            // A token candidate is paid before it can allocate owned text.
            self.charge(1)?;
            let kind = match ch {
                'a'..='z' | 'A'..='Z' | '_' => self.identifier()?,
                '0'..='9' => self.number()?,
                '"' => self.string()?,
                '#' => self.header()?,
                _ => self.symbol()?,
            };
            tokens.push(Token {
                kind,
                byte_range: ByteRange {
                    start,
                    end: self.offset,
                },
            });
        }
        self.charge(1)?;
        tokens.push(Token {
            kind: TokenKind::Eof,
            byte_range: ByteRange {
                start: self.offset,
                end: self.offset,
            },
        });
        // <= 32768 bytes + 32769 tokens: this phase alone cannot exhaust the
        // fixed 1,000,000 run budget. No recursion or unbounded source exists.
        let fuel_used = self.offset + tokens.len();
        Ok(Lexed { tokens, fuel_used })
    }

    fn rest(&self) -> &str {
        &self.source[self.offset..]
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    fn advance(&mut self) -> Result<(), Diagnostic> {
        if let Some(ch) = self.peek() {
            let crlf = ch == '\r' && self.rest().as_bytes().get(1) == Some(&b'\n');
            self.charge(ch.len_utf8() + usize::from(crlf))?;
            self.offset += ch.len_utf8();
            if ch == '\r' && self.peek() == Some('\n') {
                self.offset += 1;
            }
        }
        Ok(())
    }

    fn error(&self, start: usize, expected: &'static str) -> Diagnostic {
        Diagnostic::lexical(
            DiagnosticCode::LexInvalid,
            ByteRange {
                start,
                end: self.offset,
            },
            expected,
        )
    }

    fn unsupported(&self, start: usize, expected: &'static str) -> Diagnostic {
        Diagnostic::lexical(
            DiagnosticCode::UnsupportedSyntax,
            ByteRange {
                start,
                end: self.offset,
            },
            expected,
        )
    }

    fn line_comment(&mut self) -> Result<(), Diagnostic> {
        while let Some(ch) = self.peek() {
            if matches!(ch, '\r' | '\n') {
                break;
            }
            let start = self.offset;
            self.advance()?;
            if ch == '\0' {
                return Err(self.error(start, "source without NUL"));
            }
        }
        Ok(())
    }

    fn block_comment(&mut self) -> Result<(), Diagnostic> {
        let start = self.offset;
        self.charge(2)?;
        self.offset += 2;
        while let Some(ch) = self.peek() {
            if self.rest().starts_with("*/") {
                self.charge(2)?;
                self.offset += 2;
                return Ok(());
            }
            let char_start = self.offset;
            self.advance()?;
            if ch == '\0' {
                return Err(self.error(char_start, "source without NUL"));
            }
        }
        Err(self.error(start, "closing block comment delimiter"))
    }

    fn identifier(&mut self) -> Result<TokenKind, Diagnostic> {
        let start = self.offset;
        while self.peek().is_some_and(is_identifier_continue) {
            self.advance()?;
        }
        let text = &self.source[start..self.offset];
        let keyword = match text {
            "int" => Keyword::Int,
            "void" => Keyword::Void,
            "main" => Keyword::Main,
            "printf" => Keyword::Printf,
            "if" => Keyword::If,
            "else" => Keyword::Else,
            "while" => Keyword::While,
            "for" => Keyword::For,
            "break" => Keyword::Break,
            "continue" => Keyword::Continue,
            "return" => Keyword::Return,
            "sizeof" => Keyword::Sizeof,
            // Recognize unsupported C words as a whole; they must not become
            // apparently valid identifiers in a later parser.
            "auto" | "char" | "const" | "double" | "enum" | "extern" | "float" | "goto"
            | "long" | "register" | "short" | "signed" | "static" | "struct" | "switch"
            | "typedef" | "union" | "unsigned" | "volatile" | "do" | "case" | "default"
            | "inline" | "restrict" | "_Alignas" | "_Alignof" | "_Atomic" | "_Bool"
            | "_Complex" | "_Generic" | "_Imaginary" | "_Noreturn" | "_Static_assert"
            | "_Thread_local" | "alignas" | "alignof" | "bool" | "constexpr" | "false"
            | "nullptr" | "static_assert" | "thread_local" | "true" | "typeof"
            | "typeof_unqual" | "_BitInt" | "_Decimal32" | "_Decimal64" | "_Decimal128" => {
                return Err(self.unsupported(start, "P0-C keyword or identifier"));
            }
            _ => {
                self.charge((self.offset - start).div_ceil(64))?;
                return Ok(TokenKind::Identifier(
                    self.source[start..self.offset].to_owned(),
                ));
            }
        };
        Ok(TokenKind::Keyword(keyword))
    }

    fn number(&mut self) -> Result<TokenKind, Diagnostic> {
        let start = self.offset;
        // Consume an entire pp-number shaped candidate before rejection. 1e-2,
        // 0x10, 1.2 and 2u must never turn into a successful integer prefix.
        let mut previous = '\0';
        while let Some(ch) = self.peek() {
            if ch.is_ascii_alphanumeric()
                || matches!(ch, '_' | '.')
                || (matches!(ch, '+' | '-') && matches!(previous, 'e' | 'E' | 'p' | 'P'))
            {
                previous = ch;
                self.advance()?;
            } else {
                break;
            }
        }
        self.charge(self.offset - start)?;
        let text = &self.source[start..self.offset];
        if !text.bytes().all(|b| b.is_ascii_digit()) || (text.len() > 1 && text.starts_with('0')) {
            return Err(self.error(start, "decimal 0 or [1-9][0-9]* within int32"));
        }
        self.charge(self.offset - start)?;
        let text = &self.source[start..self.offset];
        let value = text
            .parse::<i32>()
            .map_err(|_| self.error(start, "decimal integer from 0 to 2147483647"))?;
        Ok(TokenKind::Integer(value))
    }

    fn string(&mut self) -> Result<TokenKind, Diagnostic> {
        let start = self.offset;
        self.advance()?;
        let mut decoded = String::new();
        while let Some(ch) = self.peek() {
            let char_start = self.offset;
            self.advance()?;
            match ch {
                '"' => return Ok(TokenKind::StringLiteral(decoded)),
                '\r' | '\n' | '\0' => {
                    return Err(self.error(char_start, "string without raw newline or NUL"));
                }
                '\\' => match self.peek() {
                    Some('n') => {
                        self.advance()?;
                        decoded.push('\n');
                    }
                    Some('\\') => {
                        self.advance()?;
                        decoded.push('\\');
                    }
                    Some('"') => {
                        self.advance()?;
                        decoded.push('"');
                    }
                    Some(_) => {
                        self.advance()?;
                        return Err(self.error(char_start, "escape: newline, backslash or quote"));
                    }
                    None => return Err(self.error(start, "closing string quote")),
                },
                _ => decoded.push(ch),
            }
        }
        Err(self.error(start, "closing string quote"))
    }

    fn header(&mut self) -> Result<TokenKind, Diagnostic> {
        let start = self.offset;
        // Header look-behind/look-ahead are bounded scans, paid before scanning.
        self.charge(self.source.len())?;
        let line_start = self.source[..start]
            .rfind(['\r', '\n'])
            .map_or(0, |n| n + 1);
        let valid_prefix = self.source[line_start..start]
            .chars()
            .all(is_horizontal_space);
        let line_end = self
            .rest()
            .find(['\r', '\n'])
            .map_or(self.source.len(), |n| start + n);
        let line = &self.source[start..line_end];
        let body = line[1..].trim_start_matches(is_horizontal_space);
        let header = body
            .strip_prefix("include")
            .map(|rest| rest.trim_start_matches(is_horizontal_space));
        let valid = valid_prefix
            && header.is_some_and(|h| {
                h.strip_prefix("<stdio.h>")
                    .is_some_and(|tail| tail.chars().all(is_horizontal_space))
            });
        if !valid {
            self.charge(line_end - start)?;
            self.offset = line_end;
            return Err(self.unsupported(start, "standalone #include <stdio.h> teaching line"));
        }
        // Leave trailing whitespace for the common scanner so the token ends
        // precisely at '>'; placement/count are parser responsibilities.
        let token_end = start + line.trim_end_matches(is_horizontal_space).len();
        self.charge(token_end - start)?;
        self.offset = token_end;
        Ok(TokenKind::IncludeStdio)
    }

    fn symbol(&mut self) -> Result<TokenKind, Diagnostic> {
        let start = self.offset;
        // Longest unsupported punctuators are rejected whole, never re-split.
        for op in [
            "%:%:", ">>=", "<<=", "...", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=",
            "^=", "<<", ">>", "->", "##", "<:", ":>", "<%", "%>", "%:",
        ] {
            if self.rest().starts_with(op) {
                self.charge(op.len())?;
                self.offset += op.len();
                return Err(self.unsupported(start, "P0-C operator"));
            }
        }
        for (op, symbol) in [
            ("<=", Symbol::LessEqual),
            (">=", Symbol::GreaterEqual),
            ("==", Symbol::Equal),
            ("!=", Symbol::NotEqual),
            ("&&", Symbol::AndAnd),
            ("||", Symbol::OrOr),
        ] {
            if self.rest().starts_with(op) {
                self.charge(op.len())?;
                self.offset += op.len();
                return Ok(TokenKind::Symbol(symbol));
            }
        }
        let ch = self.peek().expect("scanner calls symbol only before EOF");
        self.advance()?;
        let symbol = match ch {
            '(' => Symbol::LeftParen,
            ')' => Symbol::RightParen,
            '{' => Symbol::LeftBrace,
            '}' => Symbol::RightBrace,
            '[' => Symbol::LeftBracket,
            ']' => Symbol::RightBracket,
            ';' => Symbol::Semicolon,
            ',' => Symbol::Comma,
            '=' => Symbol::Assign,
            '+' => Symbol::Plus,
            '-' => Symbol::Minus,
            '*' => Symbol::Star,
            '/' => Symbol::Slash,
            '%' => Symbol::Percent,
            '<' => Symbol::Less,
            '>' => Symbol::Greater,
            '!' => Symbol::Not,
            '&' | '|' | '^' | '~' | '?' | ':' | '.' | '\'' => {
                return Err(self.unsupported(start, "P0-C operator or literal"));
            }
            _ => return Err(self.error(start, "P0-C character")),
        };
        Ok(TokenKind::Symbol(symbol))
    }
}

fn is_horizontal_space(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\u{000b}' | '\u{000c}')
}

fn is_space(ch: char) -> bool {
    is_horizontal_space(ch) || matches!(ch, '\r' | '\n')
}

fn is_identifier_continue(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}
