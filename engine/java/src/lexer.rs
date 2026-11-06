use crate::source::ByteRange;
use crate::{Fault, JavaResult, MAX_STRING_BYTES, Meter, charge, span};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Kind {
    Word(String),
    Decimal { magnitude: u64, wide: bool },
    Text(String),
    Symbol(&'static str),
    Eof,
}

#[derive(Debug, Clone)]
pub(crate) struct Token {
    pub kind: Kind,
    pub range: ByteRange,
}

pub(crate) struct Lexed {
    pub tokens: Vec<Token>,
    pub has_comments: bool,
}

pub(crate) fn lex(source: &str, meter: &mut Meter) -> JavaResult<Lexed> {
    let bytes = source.as_bytes();
    charge(meter, bytes.len(), span(0, bytes.len()), "lex")?;
    if let Some(start) = source.find(r"\u") {
        return Err(Fault::new(
            "E_JAVA_UNSUPPORTED",
            span(start, start + 2),
            "lex",
        ));
    }
    let mut pos = if source.starts_with('\u{feff}') { 3 } else { 0 };
    let mut tokens = Vec::new();
    let mut has_comments = false;
    while let Some(&byte) = bytes.get(pos) {
        let start = pos;
        let tail = &source[pos..];
        let error = |code, end| Fault::new(code, span(start, end), "lex");
        if matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | 12) {
            pos += 1;
            continue;
        }
        if let Some(comment) = tail.strip_prefix("//") {
            has_comments = true;
            pos += comment
                .find(['\r', '\n'])
                .map_or(tail.len(), |index| index + 2);
            continue;
        }
        if let Some(comment) = tail.strip_prefix("/*") {
            has_comments = true;
            pos += comment
                .find("*/")
                .ok_or_else(|| error("E_JAVA_SYNTAX", bytes.len()))?
                + 4;
            continue;
        }
        let kind = if byte.is_ascii_alphabetic() || byte == b'_' {
            pos += 1;
            while bytes
                .get(pos)
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            {
                pos += 1;
            }
            if pos - start > 64 {
                return Err(error("E_JAVA_UNSUPPORTED", pos));
            }
            Kind::Word(source[start..pos].to_owned())
        } else if byte.is_ascii_digit() {
            pos += 1;
            while bytes.get(pos).is_some_and(u8::is_ascii_digit) {
                pos += 1;
            }
            let digits = &source[start..pos];
            let wide = matches!(bytes.get(pos), Some(b'L' | b'l'));
            pos += usize::from(wide);
            if (byte == b'0' && digits.len() > 1)
                || bytes
                    .get(pos)
                    .is_some_and(|b| b.is_ascii_alphabetic() || matches!(b, b'.' | b'_'))
            {
                return Err(error("E_JAVA_UNSUPPORTED", pos));
            }
            let magnitude = digits
                .parse::<u64>()
                .map_err(|_| error("E_JAVA_LITERAL", pos))?;
            Kind::Decimal { magnitude, wide }
        } else if byte == b'"' {
            if tail.starts_with("\"\"\"") {
                return Err(error("E_JAVA_UNSUPPORTED", start + 3));
            }
            let (value, end) = string(source, pos)?;
            pos = end;
            Kind::Text(value)
        } else {
            let symbol = [
                "==", "!=", ">=", "<=", "&&", "||", "++", "--", "(", ")", "{", "}", "[", "]", ";",
                ",", ".", "=", "+", "-", "*", "/", "%", ">", "<", "!",
            ]
            .into_iter()
            .find(|symbol| tail.starts_with(symbol))
            .ok_or_else(|| {
                error(
                    "E_JAVA_UNSUPPORTED",
                    pos + tail.chars().next().unwrap().len_utf8(),
                )
            })?;
            pos += symbol.len();
            Kind::Symbol(symbol)
        };
        let range = span(start, pos);
        charge(meter, 1, range, "lex")?;
        tokens.push(Token { kind, range });
    }
    tokens.push(Token {
        kind: Kind::Eof,
        range: span(pos, pos),
    });
    Ok(Lexed {
        tokens,
        has_comments,
    })
}

fn string(source: &str, start: usize) -> JavaResult<(String, usize)> {
    let mut value = String::new();
    let mut chars = source[start + 1..].char_indices();
    while let Some((offset, next)) = chars.next() {
        let pos = start + 1 + offset;
        let range = span(start, pos + next.len_utf8());
        let character = match next {
            '"' => return Ok((value, pos + 1)),
            '\n' | '\r' => return Err(Fault::new("E_JAVA_SYNTAX", range, "lex")),
            '\\' => match chars.next().map(|(_, c)| c) {
                Some('n') => '\n',
                Some('r') => '\r',
                Some('t') => '\t',
                Some('\\') => '\\',
                Some('"') => '"',
                Some('\'') => '\'',
                Some(_) => return Err(Fault::new("E_JAVA_UNSUPPORTED", range, "lex")),
                None => break,
            },
            c => c,
        };
        value.push(character);
        if value.len() > MAX_STRING_BYTES {
            return Err(Fault::new("E_MEMORY_LIMIT", range, "lex"));
        }
    }
    Err(Fault::new(
        "E_JAVA_SYNTAX",
        span(start, source.len()),
        "lex",
    ))
}
