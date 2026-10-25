//! Coordinates over the original, unmodified UTF-8 source text (STEP-01).
//!
//! These are display projections of source boundaries, not another execution
//! of the program. Lines and Unicode scalar columns start at one; a tab uses
//! one column. CRLF is one newline with no valid boundary between its bytes.
//! LF and lone CR are also newlines. UTF-16 offsets count the original text's
//! code units, so both a supplementary scalar and CRLF occupy two units.

use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, Location, Stage};
use serde::Serialize;

/// A zero-based, half-open UTF-8 byte range over the original source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ByteRange {
    pub start: usize,
    pub end: usize,
}

/// A source boundary's one-based scalar coordinates and zero-based UTF-16 offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePosition {
    pub line: usize,
    pub column: usize,
    pub utf16_offset: usize,
}

#[derive(Debug, Clone, Copy)]
struct Boundary {
    byte_offset: usize,
    position: SourcePosition,
}

/// A reusable index of valid boundaries in borrowed, unnormalized source text.
///
/// Construction is iterative and takes O(source bytes) time and space. Each
/// query takes O(log(source bytes)) time and does not scan the source again.
/// Source-size policy belongs to the caller; this index does not accept or
/// reject C syntax. The end of the source is a valid boundary, including the
/// first column of an empty final line after a newline.
#[derive(Debug)]
pub struct SourceMap<'a> {
    source: &'a str,
    boundaries: Vec<Boundary>,
}

impl<'a> SourceMap<'a> {
    /// Index the exact source without newline or Unicode normalization.
    pub fn new(source: &'a str) -> Self {
        Self::new_inner(source, None).expect("unmetered source coordinates")
    }

    pub fn new_metered(source: &'a str, meter: &mut Meter) -> Result<Self, Diagnostic> {
        if source.len() > meter.limits().source_bytes {
            return Err(Diagnostic::source_limit(
                source.len(),
                meter.limits().source_bytes,
            ));
        }
        Self::new_inner(source, Some(meter))
    }

    fn new_inner(source: &'a str, mut meter: Option<&mut Meter>) -> Result<Self, Diagnostic> {
        source_charge(&mut meter, 1)?;
        let mut position = SourcePosition {
            line: 1,
            column: 1,
            utf16_offset: 0,
        };
        let mut boundaries = vec![Boundary {
            byte_offset: 0,
            position,
        }];
        let mut characters = source.char_indices().peekable();

        while let Some((byte_offset, character)) = characters.next() {
            source_charge(&mut meter, 1)?;
            let mut end = byte_offset + character.len_utf8();
            position.utf16_offset += character.len_utf16();

            match character {
                '\r' => {
                    if let Some(&(lf_offset, '\n')) = characters.peek() {
                        source_charge(&mut meter, 1)?;
                        characters.next();
                        end = lf_offset + 1;
                        position.utf16_offset += 1;
                    }
                    position.line += 1;
                    position.column = 1;
                }
                '\n' => {
                    position.line += 1;
                    position.column = 1;
                }
                _ => position.column += 1,
            }

            boundaries.push(Boundary {
                byte_offset: end,
                position,
            });
        }

        Ok(Self { source, boundaries })
    }

    /// Project a valid byte boundary, rejecting UTF-8 and CRLF midpoints.
    pub fn position(&self, byte_offset: usize) -> Option<SourcePosition> {
        if byte_offset > self.source.len() {
            return None;
        }

        self.boundaries
            .binary_search_by_key(&byte_offset, |boundary| boundary.byte_offset)
            .ok()
            .map(|index| self.boundaries[index].position)
    }

    /// Resolve a one-based line and Unicode scalar column to a byte boundary.
    ///
    /// A line's boundary immediately before its newline is valid. Columns
    /// beyond that boundary, zero coordinates, and nonexistent lines are not.
    pub fn byte_offset(&self, line: usize, column: usize) -> Option<usize> {
        self.boundaries
            .binary_search_by_key(&(line, column), |boundary| {
                (boundary.position.line, boundary.position.column)
            })
            .ok()
            .map(|index| self.boundaries[index].byte_offset)
    }

    /// Resolve an original-string UTF-16 offset to a valid byte boundary.
    ///
    /// The middle of a surrogate pair or CRLF is not a valid source endpoint.
    pub fn byte_offset_utf16(&self, utf16_offset: usize) -> Option<usize> {
        self.boundaries
            .binary_search_by_key(&utf16_offset, |boundary| boundary.position.utf16_offset)
            .ok()
            .map(|index| self.boundaries[index].byte_offset)
    }

    /// Fallible coordinate queries charge every binary-search comparison.
    pub fn position_metered(
        &self,
        byte_offset: usize,
        meter: &mut Meter,
    ) -> Result<Option<SourcePosition>, Diagnostic> {
        Ok(self
            .search_metered(meter, |boundary| boundary.byte_offset.cmp(&byte_offset))?
            .map(|index| self.boundaries[index].position))
    }

    pub fn byte_offset_metered(
        &self,
        line: usize,
        column: usize,
        meter: &mut Meter,
    ) -> Result<Option<usize>, Diagnostic> {
        Ok(self
            .search_metered(meter, |boundary| {
                (boundary.position.line, boundary.position.column).cmp(&(line, column))
            })?
            .map(|index| self.boundaries[index].byte_offset))
    }

    pub fn byte_offset_utf16_metered(
        &self,
        utf16_offset: usize,
        meter: &mut Meter,
    ) -> Result<Option<usize>, Diagnostic> {
        Ok(self
            .search_metered(meter, |boundary| {
                boundary.position.utf16_offset.cmp(&utf16_offset)
            })?
            .map(|index| self.boundaries[index].byte_offset))
    }

    pub fn is_valid_range_metered(
        &self,
        range: ByteRange,
        meter: &mut Meter,
    ) -> Result<bool, Diagnostic> {
        if range.start > range.end {
            return Ok(false);
        }
        Ok(self.position_metered(range.start, meter)?.is_some()
            && self.position_metered(range.end, meter)?.is_some())
    }

    fn search_metered(
        &self,
        meter: &mut Meter,
        mut compare: impl FnMut(&Boundary) -> std::cmp::Ordering,
    ) -> Result<Option<usize>, Diagnostic> {
        let mut low = 0;
        let mut high = self.boundaries.len();
        while low < high {
            source_charge(&mut Some(&mut *meter), 1)?;
            let middle = low + (high - low) / 2;
            match compare(&self.boundaries[middle]) {
                std::cmp::Ordering::Less => low = middle + 1,
                std::cmp::Ordering::Greater => high = middle,
                std::cmp::Ordering::Equal => return Ok(Some(middle)),
            }
        }
        Ok(None)
    }

    /// Validate ordered, in-bounds endpoints without cutting a scalar or CRLF.
    pub fn is_valid_range(&self, range: ByteRange) -> bool {
        range.start <= range.end
            && self.position(range.start).is_some()
            && self.position(range.end).is_some()
    }
}

fn source_charge(meter: &mut Option<&mut Meter>, units: usize) -> Result<(), Diagnostic> {
    if let Some(meter) = meter.as_deref_mut() {
        meter.charge(units).map_err(|error| {
            error.diagnostic(
                Stage::Parse,
                Location::Synthetic {
                    reason: "pre-execution",
                },
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ByteRange, SourceMap, SourcePosition};
    use serde_json::{Value, json};

    #[test]
    fn frozen_shared_coordinate_vectors_use_the_original_source() {
        let scenarios: Value = serde_json::from_str(include_str!(
            "../../../项目文档/契约/02.2-异常与恢复场景.json"
        ))
        .unwrap();

        for vector in scenarios["coordinateVectors"].as_array().unwrap() {
            let source = vector["source"].as_str().unwrap();
            let map = SourceMap::new(source);
            for point in vector["points"].as_array().unwrap() {
                let byte_offset = point["byteOffset"].as_u64().unwrap() as usize;
                let expected = SourcePosition {
                    line: point["line"].as_u64().unwrap() as usize,
                    column: point["column"].as_u64().unwrap() as usize,
                    utf16_offset: point["utf16Offset"].as_u64().unwrap() as usize,
                };
                assert_eq!(map.position(byte_offset), Some(expected));
                assert_eq!(
                    map.byte_offset(expected.line, expected.column),
                    Some(byte_offset)
                );
                assert_eq!(
                    map.byte_offset_utf16(expected.utf16_offset),
                    Some(byte_offset)
                );
            }

            for invalid in vector["invalidByteOffsets"].as_array().unwrap() {
                let byte_offset = invalid.as_u64().unwrap() as usize;
                assert_eq!(map.position(byte_offset), None);
                assert!(!map.is_valid_range(ByteRange {
                    start: byte_offset,
                    end: byte_offset,
                }));
            }
        }
    }

    #[test]
    fn empty_source_has_one_eof_boundary() {
        let map = SourceMap::new("");
        assert_eq!(
            map.position(0),
            Some(SourcePosition {
                line: 1,
                column: 1,
                utf16_offset: 0,
            })
        );
        assert_eq!(map.byte_offset(1, 1), Some(0));
        assert_eq!(map.byte_offset_utf16(0), Some(0));
        assert!(map.is_valid_range(ByteRange { start: 0, end: 0 }));
        assert_eq!(map.position(1), None);
        assert_eq!(map.byte_offset_utf16(1), None);
    }

    #[test]
    fn mixed_newlines_tabs_and_supplementary_characters_roundtrip() {
        let map = SourceMap::new("\t中😀\r\nx\ry\n");
        let expected = [
            (0, 1, 1, 0),
            (1, 1, 2, 1),
            (4, 1, 3, 2),
            (8, 1, 4, 4),
            (10, 2, 1, 6),
            (11, 2, 2, 7),
            (12, 3, 1, 8),
            (13, 3, 2, 9),
            (14, 4, 1, 10),
        ];
        for (byte_offset, line, column, utf16_offset) in expected {
            assert_eq!(
                map.position(byte_offset),
                Some(SourcePosition {
                    line,
                    column,
                    utf16_offset,
                })
            );
            assert_eq!(map.byte_offset(line, column), Some(byte_offset));
            assert_eq!(map.byte_offset_utf16(utf16_offset), Some(byte_offset));
        }

        for byte_offset in [2, 3, 5, 6, 7, 9] {
            assert_eq!(map.position(byte_offset), None);
        }
        for utf16_offset in [3, 5, 11] {
            assert_eq!(map.byte_offset_utf16(utf16_offset), None);
        }
        for (line, column) in [(0, 1), (1, 0), (1, 5), (4, 2), (5, 1)] {
            assert_eq!(map.byte_offset(line, column), None);
        }
    }

    #[test]
    fn consecutive_newlines_preserve_empty_lines_and_final_eof() {
        let map = SourceMap::new("\r\n\r\n\n\r");
        for (byte_offset, line) in [(0, 1), (2, 2), (4, 3), (5, 4), (6, 5)] {
            assert_eq!(map.byte_offset(line, 1), Some(byte_offset));
            assert_eq!(map.position(byte_offset).unwrap().line, line);
            assert_eq!(map.position(byte_offset).unwrap().column, 1);
            assert_eq!(map.byte_offset(line, 2), None);
        }
        assert_eq!(map.position(1), None);
        assert_eq!(map.position(3), None);
    }

    #[test]
    fn ranges_reject_reversal_outside_source_and_partial_characters() {
        let map = SourceMap::new("a😀\r\n中");
        for (start, end) in [(0, 10), (1, 5), (5, 7), (10, 10), (0, 0)] {
            assert!(map.is_valid_range(ByteRange { start, end }));
        }
        for (start, end) in [(7, 5), (0, 11), (2, 5), (5, 6), (6, 7)] {
            assert!(!map.is_valid_range(ByteRange { start, end }));
        }
    }

    #[test]
    fn unknown_extreme_coordinates_return_none() {
        let map = SourceMap::new("a");
        assert_eq!(map.position(usize::MAX), None);
        assert_eq!(map.byte_offset(usize::MAX, 1), None);
        assert_eq!(map.byte_offset(1, usize::MAX), None);
        assert_eq!(map.byte_offset_utf16(usize::MAX), None);
        assert!(!map.is_valid_range(ByteRange {
            start: usize::MAX,
            end: usize::MAX,
        }));
    }

    #[test]
    fn coordinates_serialize_with_the_contract_field_names() {
        assert_eq!(
            serde_json::to_value(ByteRange { start: 1, end: 5 }).unwrap(),
            json!({ "start": 1, "end": 5 })
        );
        assert_eq!(
            serde_json::to_value(SourcePosition {
                line: 2,
                column: 3,
                utf16_offset: 7,
            })
            .unwrap(),
            json!({ "line": 2, "column": 3, "utf16Offset": 7 })
        );
    }
}
