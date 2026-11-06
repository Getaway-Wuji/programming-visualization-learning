use crate::source::ByteRange;

use crate::{Fault, MAX_STRING, Meter, PyResult, charge, span};

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TokenKind {
    Name(String),
    Int(String),
    Float(f64),
    Text(String),
    Op(&'static str),
    Newline,
    Indent,
    Dedent,
    End,
}

#[derive(Debug, Clone)]
pub(crate) struct Token {
    pub kind: TokenKind,
    pub span: ByteRange,
}

pub(crate) struct Lexed {
    pub tokens: Vec<Token>,
    pub comments: bool,
}

const OPS: &[&str] = &[
    "//=", "//", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%",
    "=", "<", ">", "(", ")", "[", "]", ",", ":", ".",
];
const UNAVAILABLE: &[&str] = &[
    "**", "<<", ">>", ":=", "->", "@", "&", "|", "^", "~", "\\", ";", "{", "}",
];

pub(crate) fn lex(source: &str, meter: &mut Meter) -> PyResult<Lexed> {
    let source_span = span(0, source.len());
    if source.len() > meter.limits().source_bytes {
        return Err(Fault::new("E_SOURCE_LIMIT", span(0, 0), "lexer"));
    }
    charge(meter, source.len() + 1, source_span, "lexer")?;
    check_encoding(source)?;
    let mut lexer = Lexer {
        source,
        at: if source.starts_with('\u{feff}') { 3 } else { 0 },
        tokens: Vec::new(),
        indents: vec![0],
        groups: Vec::new(),
        beginning: true,
        has_token: false,
        comments: false,
        max_depth: meter.limits().max_syntax_depth,
    };
    lexer.scan()?;
    Ok(Lexed {
        tokens: lexer.tokens,
        comments: lexer.comments,
    })
}

fn check_encoding(source: &str) -> PyResult<()> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let mut rest = source;
    for index in 0..2 {
        if rest.is_empty() {
            break;
        }
        let end = rest.find(['\r', '\n']).unwrap_or(rest.len());
        let line = &rest[..end];
        let separator = &rest[end..];
        rest = separator
            .strip_prefix("\r\n")
            .or_else(|| separator.strip_prefix(['\r', '\n']))
            .unwrap_or("");
        let line = line.trim_start_matches([' ', '\t', '\x0c']);
        if !line.starts_with('#') {
            if index == 0 && !line.is_empty() {
                break;
            }
            continue;
        }
        let name = line
            .split_once("coding:")
            .or_else(|| line.split_once("coding="))
            .map(|(_, suffix)| {
                suffix
                    .trim_start()
                    .split(|ch: char| !ch.is_ascii_alphanumeric() && !matches!(ch, '-' | '_' | '.'))
                    .next()
                    .unwrap_or_default()
                    .to_ascii_lowercase()
            });
        if name.as_deref().is_some_and(|name| {
            !name.is_empty() && !matches!(name, "utf-8" | "utf8" | "utf_8" | "utf-8-sig")
        }) {
            return Err(Fault::new("E_PY_UNSUPPORTED", span(0, 0), "lexer"));
        }
    }
    Ok(())
}

struct Lexer<'a> {
    source: &'a str,
    at: usize,
    tokens: Vec<Token>,
    indents: Vec<usize>,
    groups: Vec<u8>,
    beginning: bool,
    has_token: bool,
    comments: bool,
    max_depth: usize,
}

impl Lexer<'_> {
    fn byte(&self) -> Option<u8> {
        self.source.as_bytes().get(self.at).copied()
    }

    fn starts(&self, value: &str) -> bool {
        self.source[self.at..].starts_with(value)
    }

    fn put(&mut self, kind: TokenKind, start: usize) {
        self.tokens.push(Token {
            kind,
            span: span(start, self.at),
        });
    }

    fn fault(&self, code: &'static str, start: usize) -> Fault {
        Fault::new(code, span(start, self.at), "lexer")
    }

    fn scan(&mut self) -> PyResult<()> {
        while let Some(byte) = self.byte() {
            if self.beginning {
                self.beginning = false;
                self.indent()?;
                continue;
            }
            let start = self.at;
            match byte {
                b' ' | b'\t' | 12 => self.at += 1,
                b'\r' | b'\n' => {
                    self.at += if self.starts("\r\n") { 2 } else { 1 };
                    if self.groups.is_empty() && self.has_token {
                        self.put(TokenKind::Newline, start);
                        self.has_token = false;
                    }
                    self.beginning = true;
                }
                b'#' => {
                    self.comments = true;
                    self.at += self.source[self.at..]
                        .find(['\r', '\n'])
                        .unwrap_or(self.source.len() - self.at);
                }
                _ => {
                    let kind = match byte {
                        b'a'..=b'z' | b'A'..=b'Z' | b'_' => self.name()?,
                        b'\'' | b'"' => self.string()?,
                        b'0'..=b'9' => self.number()?,
                        b'.' if self
                            .source
                            .as_bytes()
                            .get(self.at + 1)
                            .is_some_and(u8::is_ascii_digit) =>
                        {
                            self.number()?
                        }
                        _ => self.operator()?,
                    };
                    self.put(kind, start);
                    self.has_token = true;
                }
            }
        }
        if !self.groups.is_empty() {
            return Err(self.fault("E_PY_SYNTAX", self.at));
        }
        if self.has_token {
            self.put(TokenKind::Newline, self.at);
        }
        while self.indents.len() > 1 {
            self.indents.pop();
            self.put(TokenKind::Dedent, self.at);
        }
        self.put(TokenKind::End, self.at);
        Ok(())
    }

    fn indent(&mut self) -> PyResult<()> {
        let start = self.at;
        while self.byte() == Some(b' ') {
            self.at += 1;
        }
        let width = self.at - start;
        if !self.groups.is_empty() {
            return Ok(());
        }
        if matches!(self.byte(), Some(b'\t' | 12)) {
            let rest = &self.source[self.at..];
            if !matches!(
                rest.trim_start_matches([' ', '\t', '\x0c']).chars().next(),
                None | Some('#' | '\r' | '\n')
            ) {
                self.at += 1;
                return Err(self.fault("E_PY_UNSUPPORTED", start));
            }
        }
        if matches!(self.byte(), None | Some(b'#' | b'\n' | b'\r' | b'\t' | 12)) {
            return Ok(());
        }
        let current = *self.indents.last().expect("base indentation");
        if width > current {
            if self.indents.len() > self.max_depth {
                return Err(self.fault("E_DEPTH_LIMIT", start));
            }
            self.indents.push(width);
            self.put(TokenKind::Indent, start);
        } else {
            while self.indents.last().is_some_and(|level| *level > width) {
                self.indents.pop();
                self.put(TokenKind::Dedent, start);
            }
            if self.indents.last() != Some(&width) {
                return Err(self.fault("E_PY_INDENTATION", start));
            }
        }
        Ok(())
    }

    fn name(&mut self) -> PyResult<TokenKind> {
        let start = self.at;
        while matches!(
            self.byte(),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
        ) {
            self.at += 1;
        }
        if self.at - start > 64 {
            return Err(self.fault("E_PY_UNSUPPORTED", start));
        }
        let value = &self.source[start..self.at];
        if matches!(self.byte(), Some(b'\'' | b'"'))
            && value.len() <= 2
            && value.bytes().all(|b| b"rRbBuUfF".contains(&b))
        {
            return Err(self.fault("E_PY_UNSUPPORTED", start));
        }
        Ok(TokenKind::Name(value.to_owned()))
    }

    fn number(&mut self) -> PyResult<TokenKind> {
        let start = self.at;
        let mut float = false;
        self.digits();
        if self.byte() == Some(b'.') {
            float = true;
            self.at += 1;
            self.digits();
        }
        if matches!(self.byte(), Some(b'e' | b'E')) {
            float = true;
            self.at += 1;
            if matches!(self.byte(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            if !matches!(self.byte(), Some(b'0'..=b'9')) {
                return Err(self.fault("E_PY_SYNTAX", start));
            }
            self.digits();
        }
        if matches!(self.byte(), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_')) {
            self.at += 1;
            return Err(self.fault("E_PY_UNSUPPORTED", start));
        }
        let raw = &self.source[start..self.at];
        if float {
            let value: f64 = raw.parse().map_err(|_| self.fault("E_PY_SYNTAX", start))?;
            if !value.is_finite() {
                return Err(self.fault("E_PY_FLOAT_NONFINITE", start));
            }
            Ok(TokenKind::Float(value))
        } else {
            if raw.starts_with('0') && raw.bytes().any(|b| b != b'0') {
                return Err(self.fault("E_PY_SYNTAX", start));
            }
            Ok(TokenKind::Int(raw.to_owned()))
        }
    }

    fn digits(&mut self) {
        while matches!(self.byte(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
    }

    fn string(&mut self) -> PyResult<TokenKind> {
        let start = self.at;
        let quote = self.byte().expect("quote");
        self.at += 1;
        if self.byte() == Some(quote) && self.source.as_bytes().get(self.at + 1) == Some(&quote) {
            self.at += 2;
            return Err(self.fault("E_PY_UNSUPPORTED", start));
        }
        let mut result = String::new();
        while let Some(byte) = self.byte() {
            if byte == quote {
                self.at += 1;
                return Ok(TokenKind::Text(result));
            }
            if matches!(byte, b'\r' | b'\n' | 0) {
                break;
            }
            let ch = if byte == b'\\' {
                self.at += 1;
                self.escape()?
            } else {
                let ch = self.source[self.at..]
                    .chars()
                    .next()
                    .expect("UTF-8 boundary");
                self.at += ch.len_utf8();
                ch
            };
            result.push(ch);
            if result.len() > MAX_STRING {
                return Err(self.fault("E_MEMORY_LIMIT", start));
            }
        }
        Err(self.fault("E_PY_SYNTAX", start))
    }

    fn escape(&mut self) -> PyResult<char> {
        let start = self.at - 1;
        let Some(ch) = self.source[self.at..].chars().next() else {
            return Err(self.fault("E_PY_SYNTAX", start));
        };
        if matches!(ch, '\r' | '\n') {
            return Err(self.fault("E_PY_UNSUPPORTED", start));
        }
        self.at += ch.len_utf8();
        Ok(match ch {
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            '\\' | '\'' | '"' => ch,
            'u' | 'U' => {
                let length = if ch == 'u' { 4 } else { 8 };
                let mut scalar = 0;
                for _ in 0..length {
                    let Some(digit) = self.byte().and_then(|b| char::from(b).to_digit(16)) else {
                        return Err(self.fault("E_PY_SYNTAX", start));
                    };
                    self.at += 1;
                    scalar = scalar * 16 + digit;
                }
                char::from_u32(scalar).ok_or_else(|| self.fault("E_PY_UNSUPPORTED", start))?
            }
            _ => return Err(self.fault("E_PY_UNSUPPORTED", start)),
        })
    }

    fn operator(&mut self) -> PyResult<TokenKind> {
        let start = self.at;
        if let Some(op) = UNAVAILABLE.iter().find(|op| self.starts(op)) {
            self.at += op.len();
            return Err(self.fault("E_PY_UNSUPPORTED", start));
        }
        let Some(&op) = OPS.iter().find(|op| self.starts(op)) else {
            let ch = self.source[self.at..].chars().next().expect("character");
            self.at += ch.len_utf8();
            return Err(self.fault(
                if ch.is_ascii() {
                    "E_PY_SYNTAX"
                } else {
                    "E_PY_UNSUPPORTED"
                },
                start,
            ));
        };
        self.at += op.len();
        match op {
            "(" | "[" => {
                if self.groups.len() >= self.max_depth {
                    return Err(self.fault("E_DEPTH_LIMIT", start));
                }
                self.groups.push(op.as_bytes()[0]);
            }
            ")" | "]" => {
                let expected = if op == ")" { b'(' } else { b'[' };
                if self.groups.pop() != Some(expected) {
                    return Err(self.fault("E_PY_SYNTAX", start));
                }
            }
            _ => {}
        }
        Ok(TokenKind::Op(op))
    }
}
