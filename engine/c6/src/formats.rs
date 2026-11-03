//! Finite, static C6 format grammar. No dynamic formatting language or host libc.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Part {
    Text(String),
    Conversion {
        code: u8,
        width: Option<usize>,
        precision: Option<usize>,
    },
}
pub fn print(format: &[u8]) -> Result<Vec<Part>, &'static str> {
    let format = &format[..format.iter().position(|b| *b == 0).unwrap_or(format.len())];
    let mut at = 0;
    let mut text = String::new();
    let mut parts = vec![];
    let mut count = 0;
    while at < format.len() {
        if format[at] != b'%' {
            text.push(format[at] as char);
            at += 1;
            continue;
        }
        at += 1;
        if format.get(at) == Some(&b'%') {
            text.push('%');
            at += 1;
            continue;
        }
        if !text.is_empty() {
            parts.push(Part::Text(std::mem::take(&mut text)))
        }
        let start = at;
        while format.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1
        }
        let width = if at > start {
            if format[start] == b'0' {
                return Err("E_FORMAT_UNSUPPORTED");
            };
            let n = std::str::from_utf8(&format[start..at])
                .unwrap()
                .parse::<usize>()
                .map_err(|_| "E_FORMAT_UNSUPPORTED")?;
            if !(1..=16).contains(&n) {
                return Err("E_FORMAT_UNSUPPORTED");
            }
            Some(n)
        } else {
            None
        };
        let precision = if format.get(at) == Some(&b'.') {
            at += 1;
            let start = at;
            while format.get(at).is_some_and(u8::is_ascii_digit) {
                at += 1
            }
            if at == start {
                return Err("E_FORMAT_UNSUPPORTED");
            };
            let n = std::str::from_utf8(&format[start..at])
                .unwrap()
                .parse::<usize>()
                .map_err(|_| "E_FORMAT_UNSUPPORTED")?;
            if n > 6 {
                return Err("E_FORMAT_UNSUPPORTED");
            }
            Some(n)
        } else {
            None
        };
        let Some(&code) = format.get(at) else {
            return Err("E_FORMAT_UNSUPPORTED");
        };
        at += 1;
        if !b"ducsfegoxXp".contains(&code) || precision.is_some() && !b"sfeg".contains(&code) {
            return Err("E_FORMAT_UNSUPPORTED");
        }
        count += 1;
        if count > 8 {
            return Err("E_FORMAT_UNSUPPORTED");
        };
        parts.push(Part::Conversion {
            code,
            width,
            precision,
        });
    }
    if !text.is_empty() {
        parts.push(Part::Text(text))
    }
    Ok(parts)
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scan {
    pub code: &'static str,
    pub width: Option<usize>,
    pub leading_space: bool,
}
pub fn scan(format: &[u8]) -> Result<Scan, &'static str> {
    let f = &format[..format.iter().position(|b| *b == 0).unwrap_or(format.len())];
    let mut at = 0;
    let leading_space = f.first() == Some(&b' ');
    if leading_space {
        at += 1
    }
    if f.get(at) != Some(&b'%') {
        return Err("E_FORMAT_UNSUPPORTED");
    }
    at += 1;
    let start = at;
    while f.get(at).is_some_and(u8::is_ascii_digit) {
        at += 1
    }
    let width = if at > start {
        let n = std::str::from_utf8(&f[start..at])
            .unwrap()
            .parse::<usize>()
            .map_err(|_| "E_FORMAT_UNSUPPORTED")?;
        if !(1..=63).contains(&n) {
            return Err("E_FORMAT_UNSUPPORTED");
        }
        Some(n)
    } else {
        None
    };
    let tail = &f[at..];
    let code = match tail {
        b"d" => "d",
        b"u" => "u",
        b"f" => "f",
        b"lf" => "lf",
        b"c" => "c",
        b"s" => "s",
        _ => return Err("E_FORMAT_UNSUPPORTED"),
    };
    if (code == "s") != width.is_some() || leading_space && code != "c" {
        return Err("E_FORMAT_UNSUPPORTED");
    }
    Ok(Scan {
        code,
        width,
        leading_space,
    })
}
