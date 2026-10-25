//! Bounded JSON-INT-01 buffers. This is an integer-only canonical codec, not
//! generic JSON acceptance. All retained buffers are capped before growing.

use serde_json::{Map, Number, Value};

use crate::budget::{BudgetError, JSON_DEPTH, Meter};
use crate::diagnostic::{Diagnostic, DiagnosticCode, DiagnosticDetails, Location, Stage};

const MAX_SAFE: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecError {
    Budget(BudgetError),
    Limit {
        limit: usize,
        used: usize,
        attempted: usize,
    },
    Invalid(&'static str),
    Depth {
        limit: usize,
        attempted: usize,
    },
    Allocation,
}

impl From<BudgetError> for CodecError {
    fn from(error: BudgetError) -> Self {
        Self::Budget(error)
    }
}

impl CodecError {
    pub fn diagnostic(self, stage: Stage, location: Location) -> Diagnostic {
        if let Self::Budget(error) = self {
            return error.diagnostic(stage, location);
        }
        let receiving = matches!(stage, Stage::Preflight | Stage::Receive);
        let request = matches!(stage, Stage::Preflight);
        let (code, details) = match self {
            Self::Limit {
                limit,
                used,
                attempted,
            } => (
                if request {
                    DiagnosticCode::RequestLimit
                } else {
                    DiagnosticCode::ResultLimit
                },
                DiagnosticDetails {
                    dimension: Some(if request {
                        "requestBytes"
                    } else {
                        "resultBytes"
                    }),
                    limit: Some(limit),
                    used: Some(used),
                    attempted: Some(attempted as u64),
                    ..Default::default()
                },
            ),
            Self::Invalid(_) | Self::Depth { .. } => (
                if receiving {
                    DiagnosticCode::ProtocolInvalid
                } else {
                    DiagnosticCode::EncodingFailure
                },
                DiagnosticDetails {
                    expected: Some("JSON-INT-01 canonical bounded integer JSON"),
                    ..Default::default()
                },
            ),
            Self::Allocation => (
                DiagnosticCode::EncodingFailure,
                DiagnosticDetails::default(),
            ),
            Self::Budget(_) => unreachable!(),
        };
        Diagnostic {
            code,
            severity: "error",
            origin: if code == DiagnosticCode::EncodingFailure {
                "adapter"
            } else {
                "rust"
            },
            stage,
            location,
            details: Box::new(details),
        }
    }
}

/// Concatenate already canonical retained fragments and enclosing punctuation.
/// No JSON is encoded twice merely to construct the final result buffer.
#[derive(Debug)]
pub struct Assembly {
    bytes: Vec<u8>,
    max_bytes: usize,
}

impl Assembly {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            bytes: Vec::new(),
            max_bytes: max_bytes.min(16_777_216),
        }
    }

    /// Final size is known from retained fragments. Exact preallocation avoids
    /// a temporary old+grown buffer peak near the WASM linear-memory ceiling.
    pub fn with_capacity(max_bytes: usize, capacity: usize) -> Result<Self, CodecError> {
        let mut assembly = Self::new(max_bytes);
        if capacity > assembly.max_bytes {
            return Err(CodecError::Limit {
                limit: assembly.max_bytes,
                used: 0,
                attempted: capacity,
            });
        }
        assembly
            .bytes
            .try_reserve_exact(capacity)
            .map_err(|_| CodecError::Allocation)?;
        Ok(assembly)
    }
    pub fn len(&self) -> usize {
        self.bytes.len()
    }
    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub fn append(&mut self, part: &[u8], meter: &mut Meter) -> Result<(), CodecError> {
        // Public callers can reconfigure the meter between fragments. Even a
        // zero-block append must retain its original control/failure checks.
        self.append_inner(part, meter, true)
    }

    fn append_inner(
        &mut self,
        part: &[u8],
        meter: &mut Meter,
        check_zero: bool,
    ) -> Result<(), CodecError> {
        let attempted = self
            .bytes
            .len()
            .checked_add(part.len())
            .ok_or(CodecError::Limit {
                limit: self.max_bytes,
                used: self.bytes.len(),
                attempted: usize::MAX,
            })?;
        if attempted > self.max_bytes {
            return Err(CodecError::Limit {
                limit: self.max_bytes,
                used: self.bytes.len(),
                attempted,
            });
        }
        // Charge every new 64-byte block, including the first partial block.
        let blocks = attempted.div_ceil(64) - self.bytes.len().div_ceil(64);
        // Encoder exclusively borrows this meter. After the first successful
        // nonempty append, positive charges have already performed any due
        // 1024-unit checks. A zero delta cannot change fuel/reserve or make a
        // new check due. Keep the first empty call and sticky failures checked,
        // including a failure from string scanning followed by another call.
        if blocks > 0 || check_zero || self.bytes.is_empty() || meter.failure().is_some() {
            meter.charge(blocks)?;
        }
        self.bytes
            .try_reserve(part.len())
            .map_err(|_| CodecError::Allocation)?;
        self.bytes.extend_from_slice(part);
        Ok(())
    }

    pub fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

pub struct Encoder<'a> {
    meter: &'a mut Meter,
    output: Assembly,
    scanned_bytes: usize,
}

impl<'a> Encoder<'a> {
    pub fn new(meter: &'a mut Meter, max_bytes: usize) -> Self {
        Self {
            meter,
            output: Assembly::new(max_bytes),
            scanned_bytes: 0,
        }
    }

    pub fn encode(mut self, value: &Value) -> Result<Vec<u8>, CodecError> {
        self.value(value, 0)?;
        self.finish()
    }

    /// Trusted producer templates supply canonical punctuation and key order.
    /// These crate-private pieces share the same bounded buffer and phase
    /// counters as the public checked Value encoder.
    pub(crate) fn raw(&mut self, bytes: &[u8]) -> Result<(), CodecError> {
        self.append(bytes)
    }

    pub(crate) fn string_value(&mut self, value: &str) -> Result<(), CodecError> {
        self.string(value)
    }

    pub(crate) fn value_ref(&mut self, value: &Value, containers: usize) -> Result<(), CodecError> {
        self.value(value, containers)
    }

    pub(crate) fn array_values(
        &mut self,
        values: &[Value],
        containers: usize,
    ) -> Result<(), CodecError> {
        let depth = containers + 1;
        if depth > JSON_DEPTH {
            return Err(CodecError::Depth {
                limit: JSON_DEPTH,
                attempted: depth,
            });
        }
        self.append(b"[")?;
        for (at, item) in values.iter().enumerate() {
            if at > 0 {
                self.append(b",")?;
            }
            self.value(item, depth)?;
        }
        self.append(b"]")
    }

    pub(crate) fn finish(self) -> Result<Vec<u8>, CodecError> {
        self.meter.check_commit()?;
        Ok(self.output.finish())
    }

    fn append(&mut self, bytes: &[u8]) -> Result<(), CodecError> {
        self.output.append_inner(bytes, self.meter, false)
    }

    fn string(&mut self, value: &str) -> Result<(), CodecError> {
        self.append(b"\"")?;
        let mut raw_start = 0;
        for (at, character) in value.char_indices() {
            let after_scan = self.scanned_bytes.saturating_add(character.len_utf8());
            let blocks = after_scan.div_ceil(64) - self.scanned_bytes.div_ceil(64);
            // The opening quote has already charged the first output block.
            // While Encoder holds this exclusive meter borrow, successful
            // positive charges check controls at every 1024 units; errors
            // return immediately. A zero scan delta cannot add a check here.
            if blocks > 0 {
                self.meter.charge(blocks)?;
            }
            self.scanned_bytes = after_scan;
            let escape: Option<&[u8]> = match character {
                '"' => Some(b"\\\""),
                '\\' => Some(b"\\\\"),
                '\u{8}' => Some(b"\\b"),
                '\t' => Some(b"\\t"),
                '\n' => Some(b"\\n"),
                '\u{c}' => Some(b"\\f"),
                '\r' => Some(b"\\r"),
                '\u{0}'..='\u{1f}' => {
                    self.append(&value.as_bytes()[raw_start..at])?;
                    let code = character as u8;
                    const HEX: &[u8; 16] = b"0123456789abcdef";
                    self.append(&[
                        b'\\',
                        b'u',
                        b'0',
                        b'0',
                        HEX[(code >> 4) as usize],
                        HEX[(code & 15) as usize],
                    ])?;
                    raw_start = at + 1;
                    continue;
                }
                _ => None,
            };
            if let Some(escape) = escape {
                self.append(&value.as_bytes()[raw_start..at])?;
                self.append(escape)?;
                raw_start = at + character.len_utf8();
            }
            // Scanned source blocks above also keep long raw strings from
            // postponing a deadline check until their closing quote.
        }
        self.append(&value.as_bytes()[raw_start..])?;
        self.append(b"\"")
    }

    fn value(&mut self, value: &Value, containers: usize) -> Result<(), CodecError> {
        // Producers charge actual trace/state entries when visiting them.
        // Fixed JSON fields are accounted by the encoding byte blocks here,
        // rather than charging the same producer entry once per JSON field.
        match value {
            Value::Null => self.append(b"null"),
            Value::Bool(value) => self.append(if *value { b"true" } else { b"false" }),
            Value::Number(value) => {
                let integer = value
                    .as_i64()
                    .filter(|integer| (-MAX_SAFE..=MAX_SAFE).contains(integer))
                    .ok_or(CodecError::Invalid("safe integer required"))?;
                self.append(integer.to_string().as_bytes())
            }
            Value::String(value) => self.string(value),
            Value::Array(values) => self.array_values(values, containers),
            Value::Object(values) => {
                let depth = containers + 1;
                if depth > JSON_DEPTH {
                    return Err(CodecError::Depth {
                        limit: JSON_DEPTH,
                        attempted: depth,
                    });
                }
                self.append(b"{")?;
                // serde_json's frozen default Map is a BTreeMap, already in
                // canonical ASCII order. No second temporary sort or its
                // comparisons occur here. Short-key scan blocks aggregate
                // over this encoding phase rather than rounding per key.
                for (at, (key, value)) in values.iter().enumerate() {
                    if !key.is_ascii() {
                        return Err(CodecError::Invalid("ASCII object keys required"));
                    }
                    if at > 0 {
                        self.append(b",")?;
                    }
                    self.string(key)?;
                    self.append(b":")?;
                    self.value(value, depth)?;
                }
                self.append(b"}")
            }
        }
    }
}

pub fn encode(value: &Value, meter: &mut Meter, max_bytes: usize) -> Result<Vec<u8>, CodecError> {
    Encoder::new(meter, max_bytes).encode(value)
}

struct Decoder<'a, 'm> {
    source: &'a str,
    at: usize,
    meter: &'m mut Meter,
}

impl Decoder<'_, '_> {
    fn invalid<T>(&self, message: &'static str) -> Result<T, CodecError> {
        Err(CodecError::Invalid(message))
    }
    fn byte(&self) -> Option<u8> {
        self.source.as_bytes().get(self.at).copied()
    }
    fn consume(&mut self, byte: u8) -> Result<(), CodecError> {
        if self.byte() != Some(byte) {
            return self.invalid("unexpected JSON token");
        }
        self.at += 1;
        Ok(())
    }

    fn value(&mut self, containers: usize) -> Result<Value, CodecError> {
        self.meter.charge(1)?;
        match self.byte() {
            Some(b'n') => {
                self.literal("null")?;
                Ok(Value::Null)
            }
            Some(b't') => {
                self.literal("true")?;
                Ok(Value::Bool(true))
            }
            Some(b'f') => {
                self.literal("false")?;
                Ok(Value::Bool(false))
            }
            Some(b'"') => Ok(Value::String(self.string()?)),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(b'[') => {
                let depth = self.depth(containers)?;
                self.at += 1;
                let mut values = Vec::new();
                if self.byte() != Some(b']') {
                    loop {
                        let value = self.value(depth)?;
                        self.meter.charge(1)?;
                        values.try_reserve(1).map_err(|_| CodecError::Allocation)?;
                        values.push(value);
                        if self.byte() != Some(b',') {
                            break;
                        }
                        self.at += 1;
                    }
                }
                self.consume(b']')?;
                Ok(Value::Array(values))
            }
            Some(b'{') => {
                let depth = self.depth(containers)?;
                self.at += 1;
                let mut values = Map::new();
                if self.byte() != Some(b'}') {
                    loop {
                        let key = self.string()?;
                        if !key.is_ascii() {
                            return self.invalid("ASCII object keys required");
                        }
                        if let Some((previous, _)) = values.iter().next_back() {
                            self.meter
                                .charge(1 + key.len().max(previous.len()).div_ceil(64))?;
                            if previous >= &key {
                                return self.invalid("unordered or duplicate object key");
                            }
                        }
                        self.consume(b':')?;
                        let value = self.value(depth)?;
                        // Conservatively cover every possible existing-key
                        // comparison in the standard BTreeMap insertion. The
                        // implementation's internal comparator is not public.
                        let comparison_cost = 1 + key.len().div_ceil(64);
                        self.meter
                            .charge(1 + values.len().saturating_mul(comparison_cost))?;
                        values.insert(key, value);
                        if self.byte() != Some(b',') {
                            break;
                        }
                        self.at += 1;
                    }
                }
                self.consume(b'}')?;
                Ok(Value::Object(values))
            }
            _ => self.invalid("canonical JSON value required"),
        }
    }

    fn depth(&self, containers: usize) -> Result<usize, CodecError> {
        let depth = containers + 1;
        if depth > JSON_DEPTH {
            return Err(CodecError::Depth {
                limit: JSON_DEPTH,
                attempted: depth,
            });
        }
        Ok(depth)
    }

    fn literal(&mut self, text: &str) -> Result<(), CodecError> {
        if !self.source[self.at..].starts_with(text) {
            return self.invalid("invalid JSON literal");
        }
        self.at += text.len();
        Ok(())
    }

    fn number(&mut self) -> Result<Value, CodecError> {
        let start = self.at;
        let negative = self.byte() == Some(b'-');
        if negative {
            self.at += 1;
        }
        let first = self.byte().ok_or(CodecError::Invalid("missing integer"))?;
        if !first.is_ascii_digit() {
            return self.invalid("integer digit required");
        }
        let mut magnitude = 0_i64;
        let mut digits = 0;
        while let Some(digit @ b'0'..=b'9') = self.byte() {
            self.meter.charge(1)?;
            if digits > 0 && first == b'0' {
                return self.invalid("leading zero");
            }
            magnitude = magnitude
                .checked_mul(10)
                .and_then(|number| number.checked_add(i64::from(digit - b'0')))
                .filter(|number| *number <= MAX_SAFE)
                .ok_or(CodecError::Invalid("unsafe integer"))?;
            self.at += 1;
            digits += 1;
        }
        if negative && magnitude == 0 {
            return self.invalid("negative zero");
        }
        if self.at == start {
            return self.invalid("integer required");
        }
        Ok(Value::Number(Number::from(if negative {
            -magnitude
        } else {
            magnitude
        })))
    }

    fn string(&mut self) -> Result<String, CodecError> {
        self.consume(b'"')?;
        let mut output = String::new();
        let mut block_at = self.at;
        loop {
            if self.at.saturating_sub(block_at) >= 64 {
                self.meter.charge(1)?;
                block_at = self.at;
            }
            let byte = self
                .byte()
                .ok_or(CodecError::Invalid("unterminated string"))?;
            match byte {
                b'"' => {
                    self.at += 1;
                    return Ok(output);
                }
                b'\\' => {
                    self.at += 1;
                    let escaped = self
                        .byte()
                        .ok_or(CodecError::Invalid("unterminated escape"))?;
                    self.at += 1;
                    let character = match escaped {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'b' => '\u{8}',
                        b't' => '\t',
                        b'n' => '\n',
                        b'f' => '\u{c}',
                        b'r' => '\r',
                        b'u' => {
                            let tail = self
                                .source
                                .as_bytes()
                                .get(self.at..self.at + 4)
                                .ok_or(CodecError::Invalid("incomplete unicode escape"))?;
                            if tail[0] != b'0' || tail[1] != b'0' {
                                return self.invalid("noncanonical unicode escape");
                            }
                            let hi = hex(tail[2])
                                .ok_or(CodecError::Invalid("lowercase hex required"))?;
                            let lo = hex(tail[3])
                                .ok_or(CodecError::Invalid("lowercase hex required"))?;
                            let code = hi * 16 + lo;
                            if code > 31 || matches!(code, 8 | 9 | 10 | 12 | 13) {
                                return self.invalid("noncanonical control escape");
                            }
                            self.at += 4;
                            char::from(code)
                        }
                        _ => return self.invalid("noncanonical string escape"),
                    };
                    output
                        .try_reserve(character.len_utf8())
                        .map_err(|_| CodecError::Allocation)?;
                    output.push(character);
                }
                0..=31 => return self.invalid("raw control in string"),
                _ => {
                    let character = self.source[self.at..]
                        .chars()
                        .next()
                        .ok_or(CodecError::Invalid("invalid Unicode"))?;
                    output
                        .try_reserve(character.len_utf8())
                        .map_err(|_| CodecError::Allocation)?;
                    output.push(character);
                    self.at += character.len_utf8();
                }
            }
        }
    }
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

/// Length is checked before UTF-8 decoding or allocating the first JSON value.
/// Parsing rejects duplicate/unsorted keys and noncanonical lexical forms;
/// canonical re-encoding is still compared byte-for-byte as required by EXEC.
pub fn decode(bytes: &[u8], meter: &mut Meter, max_bytes: usize) -> Result<Value, CodecError> {
    let max_bytes = max_bytes.min(16_777_216);
    if bytes.len() > max_bytes {
        return Err(CodecError::Limit {
            limit: max_bytes,
            used: 0,
            attempted: bytes.len(),
        });
    }
    meter.charge(bytes.len().div_ceil(64))?;
    let source = std::str::from_utf8(bytes).map_err(|_| CodecError::Invalid("invalid UTF-8"))?;
    let mut decoder = Decoder {
        source,
        at: 0,
        meter,
    };
    let value = decoder.value(0)?;
    if decoder.at != source.len() {
        return Err(CodecError::Invalid("trailing or noncanonical JSON bytes"));
    }
    let canonical = encode(&value, decoder.meter, max_bytes)?;
    decoder.meter.charge(bytes.len().div_ceil(64))?;
    if canonical != bytes {
        return Err(CodecError::Invalid("noncanonical encoding"));
    }
    decoder.meter.check_commit()?;
    Ok(value)
}

#[cfg(test)]
#[path = "codec_append_tests.rs"]
mod append_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meter() -> Meter {
        let mut meter = Meter::new();
        meter.set_clock(1000, Box::new(|| 0));
        meter
    }

    #[test]
    fn exact_unicode_escape_bytes_and_safe_integer_boundaries() {
        let value = json!({"a": [null, true, false, -9007199254740991_i64, 9007199254740991_i64], "z": "中文/\"\\\n\t\u{0}\u{1f}"});
        let expected = "{\"a\":[null,true,false,-9007199254740991,9007199254740991],\"z\":\"中文/\\\"\\\\\\n\\t\\u0000\\u001f\"}".as_bytes();
        assert_eq!(
            encode(&value, &mut meter(), expected.len()).unwrap(),
            expected
        );
        assert_eq!(
            decode(expected, &mut meter(), expected.len()).unwrap(),
            value
        );
    }

    #[test]
    fn noncanonical_or_ambiguous_input_is_rejected() {
        let bad: &[&[u8]] = &[
            b" {\"a\":1}",
            b"{\"a\":1,\"a\":2}",
            b"{\"b\":1,\"a\":2}",
            b"1.0",
            b"1e0",
            b"-0",
            b"01",
            b"9007199254740992",
            b"\"\\/\"",
            b"\"\\u0061\"",
            b"\"\\u000a\"",
            b"\"\\u001F\"",
            b"\"\\ud800\"",
            b"\xef\xbb\xbfnull",
            b"\"\xff\"",
            b"\"\n\"",
            b"[1,]",
            b"{\"a\":1,}",
            b"null\n",
        ];
        for bytes in bad {
            assert!(decode(bytes, &mut meter(), 1024).is_err(), "{bytes:?}");
        }
        assert!(decode("{\"中\":1}".as_bytes(), &mut meter(), 1024).is_err());
    }

    #[test]
    fn depth_is_container_depth_and_32_is_available() {
        let good = format!("{}null{}", "[".repeat(32), "]".repeat(32));
        let bad = format!("[{}]", good);
        let value = decode(good.as_bytes(), &mut meter(), 1024).unwrap();
        assert_eq!(encode(&value, &mut meter(), 1024).unwrap(), good.as_bytes());
        assert_eq!(
            decode(bad.as_bytes(), &mut meter(), 1024),
            Err(CodecError::Depth {
                limit: 32,
                attempted: 33
            })
        );
        let value = json!([value]);
        assert!(matches!(
            encode(&value, &mut meter(), 1024),
            Err(CodecError::Depth { .. })
        ));
    }

    #[test]
    fn bounded_append_does_not_retain_a_rejected_candidate() {
        let mut meter = meter();
        let mut assembly = Assembly::new(3);
        assembly.append(b"ab", &mut meter).unwrap();
        assert_eq!(
            assembly.append(b"cd", &mut meter),
            Err(CodecError::Limit {
                limit: 3,
                used: 2,
                attempted: 4
            })
        );
        assert_eq!(assembly.finish(), b"ab");
        assert!(encode(&json!("中文"), &mut meter, 7).is_err());
        assert_eq!(encode(&json!("中文"), &mut meter, 8).unwrap().len(), 8);
    }

    #[test]
    fn final_buffer_assembly_is_charged_again_but_not_reencoded() {
        let mut meter = meter();
        let fragment = encode(&json!([1, 2, 3]), &mut meter, 64).unwrap();
        let before = meter.used();
        let mut assembly = Assembly::new(64);
        assembly.append(b"{\"a\":", &mut meter).unwrap();
        assembly.append(&fragment, &mut meter).unwrap();
        assembly.append(b"}", &mut meter).unwrap();
        assert_eq!(assembly.finish(), b"{\"a\":[1,2,3]}");
        assert_eq!(meter.used() - before, 1);
    }

    #[test]
    fn encoding_fixed_fields_and_numbers_uses_phase_byte_blocks() {
        let mut meter = meter();
        let bytes = encode(&json!({"a": true, "b": null, "c": "x"}), &mut meter, 64).unwrap();
        assert_eq!(bytes, b"{\"a\":true,\"b\":null,\"c\":\"x\"}");
        // One combined scan block for all strings, one output block; producer
        // entry traversal is accounted at the actual producer, not per field.
        assert_eq!(meter.used(), 2);
        let before = meter.used();
        assert_eq!(
            encode(&json!(9007199254740991_i64), &mut meter, 64).unwrap(),
            b"9007199254740991"
        );
        // Host integer formatting is part of JSON encoding, not a C arithmetic
        // operation; the one partial encoded-byte block is its complete cost.
        assert_eq!(meter.used() - before, 1);
    }

    #[test]
    fn floats_unsafe_integers_and_non_ascii_keys_are_not_encodable() {
        for value in [json!(1.0), json!(9007199254740992_u64), json!({"中":1})] {
            assert!(encode(&value, &mut meter(), 1024).is_err());
        }
    }

    #[test]
    fn size_limit_precedes_fuel_or_utf8_parsing() {
        let mut meter = Meter::with_limits(crate::budget::Limits {
            fuel: 1,
            ..Default::default()
        });
        assert_eq!(
            decode(&[255; 65], &mut meter, 64),
            Err(CodecError::Limit {
                limit: 64,
                used: 0,
                attempted: 65
            })
        );
        assert_eq!(meter.used(), 0);
    }
}
