//! Compile P0-C's already-decoded printf format without producing output.
//!
//! Only `%d` consumes an int argument and `%%` contributes literal text. The
//! parser owns source escapes/ranges; these parts contain decoded text only.
//! No host printf, AST evaluation, stdout or persistence is involved. A future
//! evaluator must evaluate all arguments and check output limits before it
//! atomically appends any rendered result. The caller enforces source limits.

use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, Location, Stage};
use crate::source::ByteRange;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatPart {
    Text(String),
    Decimal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledFormat {
    pub parts: Vec<FormatPart>,
    pub argument_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatError {
    InvalidSpecifier,
    ArgumentCount { expected: usize, actual: usize },
    Nul,
}

/// Validate and compile a decoded format with an exact argument count.
///
/// This iterative scan is linear in the format length. Invalid formats return
/// no partial parts. NUL is rejected before format/argument checking; otherwise
/// invalid percent sequences precede an argument-count mismatch.
pub fn compile_format(format: &str, argument_count: usize) -> Result<CompiledFormat, FormatError> {
    compile_inner(format, argument_count, None, ByteRange { start: 0, end: 0 })
        .expect("unmetered format compilation")
}

pub fn compile_format_metered(
    format: &str,
    argument_count: usize,
    meter: &mut Meter,
    range: ByteRange,
) -> Result<Result<CompiledFormat, FormatError>, Diagnostic> {
    compile_inner(format, argument_count, Some(meter), range)
}

fn compile_inner(
    format: &str,
    argument_count: usize,
    mut meter: Option<&mut Meter>,
    range: ByteRange,
) -> Result<Result<CompiledFormat, FormatError>, Diagnostic> {
    for byte in format.bytes() {
        charge(&mut meter, 1, range)?;
        if byte == 0 {
            return Ok(Err(FormatError::Nul));
        }
    }
    let mut characters = format.chars();
    let mut parts = Vec::new();
    let mut text = String::new();
    let mut expected = 0;
    while let Some(character) = characters.next() {
        charge(&mut meter, 1, range)?;
        if character != '%' {
            text.push(character);
            continue;
        }
        charge(&mut meter, 1, range)?;
        match characters.next() {
            Some('%') => text.push('%'),
            Some('d') => {
                if !text.is_empty() {
                    charge(&mut meter, 1, range)?;
                    parts.push(FormatPart::Text(std::mem::take(&mut text)));
                }
                charge(&mut meter, 1, range)?;
                parts.push(FormatPart::Decimal);
                expected += 1;
            }
            _ => return Ok(Err(FormatError::InvalidSpecifier)),
        }
    }
    if expected != argument_count {
        return Ok(Err(FormatError::ArgumentCount {
            expected,
            actual: argument_count,
        }));
    }
    if !text.is_empty() {
        charge(&mut meter, 1, range)?;
        parts.push(FormatPart::Text(text));
    }
    Ok(Ok(CompiledFormat {
        parts,
        argument_count: expected,
    }))
}

fn charge(
    meter: &mut Option<&mut Meter>,
    units: usize,
    range: ByteRange,
) -> Result<(), Diagnostic> {
    if let Some(meter) = meter.as_deref_mut() {
        meter.charge(units).map_err(|error| {
            error.diagnostic(Stage::Semantic, Location::Source { byte_range: range })
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{CompiledFormat, FormatError, FormatPart, compile_format};

    #[test]
    fn plain_decoded_unicode_and_supported_escapes_remain_text() {
        for text in ["", "中文😀", "line one\nline two\\\"", "literal d"] {
            assert_eq!(
                compile_format(text, 0),
                Ok(CompiledFormat {
                    parts: if text.is_empty() {
                        Vec::new()
                    } else {
                        vec![FormatPart::Text(text.into())]
                    },
                    argument_count: 0,
                })
            );
        }
    }

    #[test]
    fn percent_literals_and_decimal_slots_have_exact_order_and_count() {
        assert_eq!(
            compile_format("中文%%😀 %d / %d\n", 2),
            Ok(CompiledFormat {
                parts: vec![
                    FormatPart::Text("中文%😀 ".into()),
                    FormatPart::Decimal,
                    FormatPart::Text(" / ".into()),
                    FormatPart::Decimal,
                    FormatPart::Text("\n".into()),
                ],
                argument_count: 2,
            })
        );
        for (format, arguments, parts) in [
            ("%%", 0, vec![FormatPart::Text("%".into())]),
            ("%%%%", 0, vec![FormatPart::Text("%%".into())]),
            ("%%d", 0, vec![FormatPart::Text("%d".into())]),
            (
                "%%%d",
                1,
                vec![FormatPart::Text("%".into()), FormatPart::Decimal],
            ),
            (
                "%d%%",
                1,
                vec![FormatPart::Decimal, FormatPart::Text("%".into())],
            ),
            ("%d%d", 2, vec![FormatPart::Decimal, FormatPart::Decimal]),
        ] {
            assert_eq!(
                compile_format(format, arguments),
                Ok(CompiledFormat {
                    parts,
                    argument_count: arguments,
                })
            );
        }
    }

    #[test]
    fn missing_and_extra_arguments_are_different_exact_count_errors() {
        for (format, expected, actual) in [
            ("%d", 1, 0),
            ("%d %d", 2, 1),
            ("%d", 1, 2),
            ("literal", 0, 1),
            ("%%", 0, 1),
            ("", 0, usize::MAX),
        ] {
            assert_eq!(
                compile_format(format, actual),
                Err(FormatError::ArgumentCount { expected, actual })
            );
        }
    }

    #[test]
    fn every_unsupported_percent_shape_is_rejected_without_partial_parts() {
        for invalid in [
            "%",
            "%f",
            "%s",
            "%c",
            "%u",
            "%x",
            "%n",
            "%D",
            "%02d",
            "%1d",
            "%-d",
            "%+d",
            "% d",
            "%#d",
            "%.d",
            "%.2d",
            "%*d",
            "%ld",
            "%lld",
            "%hd",
            "%zd",
            "%1$d",
            "%中",
            "%😀",
            "%\n",
            "%%%",
            "%d%f",
            "prefix %d suffix %",
        ] {
            assert_eq!(
                compile_format(invalid, 0),
                Err(FormatError::InvalidSpecifier),
                "{invalid:?}"
            );
        }
        for character in ' '..='~' {
            if matches!(character, '%' | 'd') {
                continue;
            }
            assert_eq!(
                compile_format(&format!("%{character}"), 1),
                Err(FormatError::InvalidSpecifier)
            );
        }
    }

    #[test]
    fn nul_is_rejected_in_plain_text_or_after_percent() {
        for format in ["\0", "before\0after", "%\0", "%d\0", "%f\0", "中😀\0"] {
            assert_eq!(compile_format(format, 1), Err(FormatError::Nul));
        }
    }

    #[test]
    fn source_sized_formats_are_iterative_and_keep_all_text_and_slots() {
        let unicode = "中😀".repeat(4_681);
        assert_eq!(unicode.len(), 32_767);
        let compiled = compile_format(&unicode, 0).unwrap();
        assert_eq!(compiled.parts, vec![FormatPart::Text(unicode)]);
        let dense = "%d".repeat(16_384);
        assert_eq!(dense.len(), 32_768);
        let compiled = compile_format(&dense, 16_384).unwrap();
        assert_eq!(compiled.argument_count, 16_384);
        assert_eq!(compiled.parts.len(), 16_384);
        assert!(
            compiled
                .parts
                .iter()
                .all(|part| *part == FormatPart::Decimal)
        );
        let percent = "%%".repeat(16_384);
        assert_eq!(
            compile_format(&percent, 0).unwrap().parts,
            vec![FormatPart::Text("%".repeat(16_384))]
        );
    }
}
