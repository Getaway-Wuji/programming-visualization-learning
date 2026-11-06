use std::cmp::Ordering;

use crate::parser::Node;
use crate::trace::{Datum, Value};
use crate::{Fault, INT_MAX, MAX_STRING, PyResult};

pub(crate) fn fail(node: Node, code: &'static str) -> Fault {
    Fault::new(code, node.byte_range, "runtime")
}

pub(crate) fn checked_int(value: i128, node: Node) -> PyResult<Value> {
    if !(-i128::from(INT_MAX)..=i128::from(INT_MAX)).contains(&value) {
        return Err(fail(node, "E_PY_INTEGER_LIMIT"));
    }
    Ok(Value::Int {
        value: value as i64,
    })
}

pub(crate) fn decimal(text: &str, node: Node) -> PyResult<Value> {
    let text = text.trim_matches(|ch: char| ch.is_ascii_whitespace());
    let (digits, negative) = if let Some(digits) = text.strip_prefix('-') {
        (digits, true)
    } else {
        (text.strip_prefix('+').unwrap_or(text), false)
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(fail(node, "E_PY_VALUE"));
    }
    let mut value = 0;
    for digit in digits.bytes() {
        value = value * 10 + i128::from(digit - b'0');
        if value > i128::from(INT_MAX) {
            return Err(fail(node, "E_PY_INTEGER_LIMIT"));
        }
    }
    checked_int(if negative { -value } else { value }, node)
}

pub(crate) fn float(value: f64, node: Node) -> PyResult<Value> {
    if !value.is_finite() {
        return Err(fail(node, "E_PY_FLOAT_NONFINITE"));
    }
    Ok(Value::F64 {
        bits: value.to_bits(),
    })
}

pub(crate) fn string(value: String, node: Node) -> PyResult<Value> {
    if value.len() > MAX_STRING {
        return Err(fail(node, "E_MEMORY_LIMIT"));
    }
    Ok(Value::Str { value })
}

pub(crate) fn integer(value: &Value) -> Option<i64> {
    match value {
        Value::Int { value } => Some(*value),
        Value::Bool { value } => Some(i64::from(*value)),
        _ => None,
    }
}

fn number(value: &Value) -> Option<f64> {
    if let Value::F64 { bits } = value {
        Some(f64::from_bits(*bits))
    } else {
        integer(value).map(|value| value as f64)
    }
}

pub(crate) fn zero(value: &Value) -> bool {
    number(value) == Some(0.0)
}

pub(crate) fn unary(op: &str, value: &Value, node: Node) -> PyResult<Value> {
    if let Some(value) = integer(value) {
        return checked_int(
            i128::from(if op == "-" {
                -value
            } else if op == "abs" {
                value.abs()
            } else {
                value
            }),
            node,
        );
    }
    let value = number(value).ok_or_else(|| fail(node, "E_PY_TYPE"))?;
    float(
        match op {
            "-" => -value,
            "abs" => value.abs(),
            _ => value,
        },
        node,
    )
}

pub(crate) fn arithmetic(op: &str, left: &Value, right: &Value, node: Node) -> PyResult<Value> {
    if let (Value::Str { value: left }, Value::Str { value: right }) = (left, right)
        && op == "+"
    {
        if left.len() + right.len() > MAX_STRING {
            return Err(fail(node, "E_MEMORY_LIMIT"));
        }
        return string(left.clone() + right, node);
    }
    if matches!(
        (left, right, op),
        (Value::ListRef { .. }, Value::ListRef { .. }, "+")
            | (Value::ListRef { .. }, _, "*")
            | (_, Value::ListRef { .. }, "*")
            | (Value::Str { .. }, _, "%")
    ) {
        return Err(fail(node, "E_PY_UNSUPPORTED"));
    }
    if op != "/"
        && let (Some(a), Some(b)) = (integer(left), integer(right))
    {
        let (a, b) = (i128::from(a), i128::from(b));
        let result = match op {
            "+" => a + b,
            "-" => a - b,
            "*" => a * b,
            "//" | "%" => {
                if b == 0 {
                    return Err(fail(node, "E_PY_ZERO_DIVISION"));
                }
                let rem = a % b;
                let adjust = rem != 0 && (rem < 0) != (b < 0);
                if op == "//" {
                    a / b - i128::from(adjust)
                } else if adjust {
                    rem + b
                } else {
                    rem
                }
            }
            _ => unreachable!("arithmetic operator"),
        };
        return checked_int(result, node);
    }
    let (Some(a), Some(b)) = (number(left), number(right)) else {
        return Err(fail(node, "E_PY_TYPE"));
    };
    let result = match op {
        "+" => a + b,
        "-" => a - b,
        "*" => a * b,
        "/" => {
            if b == 0.0 {
                return Err(fail(node, "E_PY_ZERO_DIVISION"));
            }
            a / b
        }
        "//" | "%" => return Err(fail(node, "E_PY_UNSUPPORTED")),
        _ => unreachable!("arithmetic operator"),
    };
    float(result, node)
}

pub(crate) fn compare(op: &str, left: &Value, right: &Value, node: Node) -> PyResult<bool> {
    if matches!(op, "is" | "is not") {
        let same = match (left, right) {
            (Value::None, Value::None) => true,
            (Value::ListRef { object_id: a }, Value::ListRef { object_id: b }) => a == b,
            (Value::None | Value::ListRef { .. }, _) | (_, Value::None | Value::ListRef { .. }) => {
                false
            }
            _ => return Err(fail(node, "E_PY_UNSUPPORTED")),
        };
        return Ok(same == (op == "is"));
    }
    if matches!(
        (left, right),
        (Value::ListRef { .. }, Value::ListRef { .. })
    ) {
        return Err(fail(node, "E_PY_UNSUPPORTED"));
    }
    let order = match (left, right) {
        (Value::None, Value::None) if matches!(op, "==" | "!=") => Some(Ordering::Equal),
        (Value::Str { value: a }, Value::Str { value: b }) => Some(a.cmp(b)),
        _ => match (number(left), number(right)) {
            (Some(a), Some(b)) => a.partial_cmp(&b),
            _ => None,
        },
    };
    if op == "==" || op == "!=" {
        return Ok((order == Some(Ordering::Equal)) == (op == "=="));
    }
    let order = order.ok_or_else(|| fail(node, "E_PY_TYPE"))?;
    Ok(match op {
        "<" => order.is_lt(),
        "<=" => order.is_le(),
        ">" => order.is_gt(),
        ">=" => order.is_ge(),
        _ => unreachable!("comparison operator"),
    })
}

pub(crate) fn index(value: &Datum, length: usize, node: Node) -> PyResult<usize> {
    let mut index = integer(&value.value).ok_or_else(|| fail(node, "E_PY_TYPE"))?;
    if index < 0 {
        index += length as i64;
    }
    if !(0..length as i64).contains(&index) {
        return Err(fail(node, "E_PY_INDEX"));
    }
    Ok(index as usize)
}

pub(crate) fn slice(parts: &[Option<Datum>; 3], length: usize, node: Node) -> PyResult<Vec<usize>> {
    let bound = |part: &Option<Datum>| match part {
        Some(value) if value.value != Value::None => integer(&value.value)
            .map(Some)
            .ok_or_else(|| fail(node, "E_PY_TYPE")),
        _ => Ok(None),
    };
    let stride = bound(&parts[2])?.unwrap_or(1);
    if stride == 0 {
        return Err(fail(node, "E_PY_VALUE"));
    }
    let size = length as i64;
    let (low, high, default_start, default_stop) = if stride > 0 {
        (0, size, 0, size)
    } else {
        (-1, size - 1, size - 1, -1)
    };
    let clamp = |value: i64| (if value < 0 { value + size } else { value }).clamp(low, high);
    let mut at = bound(&parts[0])?.map(clamp).unwrap_or(default_start);
    let stop = bound(&parts[1])?.map(clamp).unwrap_or(default_stop);
    let mut positions = Vec::new();
    while (stride > 0 && at < stop) || (stride < 0 && at > stop) {
        positions.push(at as usize);
        at += stride;
    }
    Ok(positions)
}

pub(crate) fn as_int(value: &Value, node: Node) -> PyResult<Value> {
    match value {
        Value::Str { value } => decimal(value, node),
        Value::F64 { bits } => {
            let value = f64::from_bits(*bits).trunc();
            if value.abs() > INT_MAX as f64 {
                return Err(fail(node, "E_PY_INTEGER_LIMIT"));
            }
            checked_int(value as i128, node)
        }
        _ => integer(value)
            .map(|value| Value::Int { value })
            .ok_or_else(|| fail(node, "E_PY_TYPE")),
    }
}

pub(crate) fn as_float(value: &Value, node: Node) -> PyResult<Value> {
    if let Value::Str { value } = value {
        let text = value.trim_matches(|ch: char| ch.is_ascii_whitespace());
        if !text
            .bytes()
            .all(|b| b.is_ascii_digit() || b"+-.eE".contains(&b))
        {
            return Err(fail(node, "E_PY_VALUE"));
        }
        float(text.parse().map_err(|_| fail(node, "E_PY_VALUE"))?, node)
    } else {
        float(number(value).ok_or_else(|| fail(node, "E_PY_TYPE"))?, node)
    }
}

pub(crate) fn format_scalar(value: &Value, node: Node) -> PyResult<String> {
    Ok(match value {
        Value::None => "None".into(),
        Value::Bool { value } => {
            if *value {
                "True".into()
            } else {
                "False".into()
            }
        }
        Value::Int { value } => value.to_string(),
        Value::Str { value } => value.clone(),
        Value::F64 { bits } => {
            let rendered = format!("{:?}", f64::from_bits(*bits));
            if let Some((mantissa, exponent)) = rendered.split_once('e') {
                let exponent: i32 = exponent.parse().expect("finite exponent");
                format!("{mantissa}e{exponent:+03}")
            } else {
                rendered
            }
        }
        _ => return Err(fail(node, "E_PY_UNSUPPORTED")),
    })
}

pub(crate) fn repr_string(value: &str) -> String {
    let quote = if value.contains('\'') && !value.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::from(quote);
    for ch in value.chars() {
        match ch {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if ch == quote || ch == '\\' => {
                out.push('\\');
                out.push(ch);
            }
            ch if !crate::printable::is_printable(ch) => {
                use std::fmt::Write;
                let code = ch as u32;
                if code <= 0xff {
                    write!(out, "\\x{code:02x}").expect("string");
                } else if code <= 0xffff {
                    write!(out, "\\u{code:04x}").expect("string");
                } else {
                    write!(out, "\\U{code:08x}").expect("string");
                }
            }
            ch => out.push(ch),
        }
    }
    out.push(quote);
    out
}
