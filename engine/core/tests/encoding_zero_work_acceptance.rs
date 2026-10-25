//! Differential guard for the 11.4 encoding hot-path change. The small legacy
//! string routine below is a frozen reference for the removed zero-unit calls,
//! not a second production codec. Public Assembly control semantics stay intact.

use c_viz_core::budget::{BudgetError, Limits, Meter};
use c_viz_core::codec::{self, Assembly, CodecError};
use serde_json::json;
use std::{cell::Cell, rc::Rc};

fn legacy_string(value: &str, meter: &mut Meter, max_bytes: usize) -> Result<Vec<u8>, CodecError> {
    let mut out = Assembly::new(max_bytes);
    out.append(b"\"", meter)?;
    let mut scanned_bytes = 0_usize;
    let mut raw_start = 0;
    for (at, character) in value.char_indices() {
        let after_scan = scanned_bytes.saturating_add(character.len_utf8());
        meter.charge(after_scan.div_ceil(64) - scanned_bytes.div_ceil(64))?;
        scanned_bytes = after_scan;
        let escape: Option<&[u8]> = match character {
            '"' => Some(b"\\\""),
            '\\' => Some(b"\\\\"),
            '\u{8}' => Some(b"\\b"),
            '\t' => Some(b"\\t"),
            '\n' => Some(b"\\n"),
            '\u{c}' => Some(b"\\f"),
            '\r' => Some(b"\\r"),
            '\u{0}'..='\u{1f}' => {
                out.append(&value.as_bytes()[raw_start..at], meter)?;
                let code = character as u8;
                const HEX: &[u8; 16] = b"0123456789abcdef";
                out.append(
                    &[
                        b'\\',
                        b'u',
                        b'0',
                        b'0',
                        HEX[(code >> 4) as usize],
                        HEX[(code & 15) as usize],
                    ],
                    meter,
                )?;
                raw_start = at + 1;
                continue;
            }
            _ => None,
        };
        if let Some(escape) = escape {
            out.append(&value.as_bytes()[raw_start..at], meter)?;
            out.append(escape, meter)?;
            raw_start = at + character.len_utf8();
        }
    }
    out.append(&value.as_bytes()[raw_start..], meter)?;
    out.append(b"\"", meter)?;
    meter.check_commit()?;
    Ok(out.finish())
}

fn meter(limits: Limits) -> Meter {
    let mut meter = Meter::with_limits(limits);
    meter.set_clock(1000, Box::new(|| 0));
    meter
}

fn compare(value: &str, limits: Limits, max_bytes: usize) {
    let mut old = meter(limits);
    let mut current = meter(limits);
    let expected = legacy_string(value, &mut old, max_bytes);
    let actual = codec::encode(&json!(value), &mut current, max_bytes);
    assert_eq!(actual, expected, "source bytes {}", value.len());
    assert_eq!(current.used(), old.used());
    assert_eq!(current.reserved(), old.reserved());
    assert_eq!(current.failure(), old.failure());
    if let Ok(bytes) = actual {
        assert_eq!(bytes, serde_json::to_vec(value).unwrap());
        assert_eq!(
            current.used(),
            value.len().div_ceil(64) + bytes.len().div_ceil(64)
        );
    }
}

#[test]
fn utf8_escapes_and_block_edges_keep_exact_bytes_and_positive_fuel() {
    let controls = (0..=31).map(char::from).collect::<String>();
    for unit in ["a", "中", "😀", "\"\\\n\t", controls.as_str()] {
        for count in [0, 1, 15, 16, 21, 22, 31, 32, 63, 64, 65, 127, 128, 129] {
            compare(&unit.repeat(count), Limits::default(), 16_777_216);
        }
    }
}

#[test]
fn rejected_byte_and_fuel_boundaries_match_the_previous_encoder() {
    for value in ["x".repeat(129), "中\n😀\u{0}".repeat(40)] {
        let encoded_len = serde_json::to_vec(&value).unwrap().len();
        for max_bytes in [0, 1, 2, 63, 64, 65, encoded_len - 1, encoded_len] {
            compare(&value, Limits::default(), max_bytes);
        }
        let cost = value.len().div_ceil(64) + encoded_len.div_ceil(64);
        for fuel in [4095, 4096, 4097, 4096 + cost - 1, 4096 + cost] {
            compare(
                &value,
                Limits {
                    fuel,
                    ..Default::default()
                },
                16_777_216,
            );
        }
    }
}

fn clock_meter(stop_at: usize) -> (Meter, Rc<Cell<usize>>) {
    let calls = Rc::new(Cell::new(0));
    let observed = calls.clone();
    let mut meter = Meter::new();
    meter.set_clock(
        37,
        Box::new(move || {
            observed.set(observed.get() + 1);
            if observed.get() >= stop_at { 37 } else { 0 }
        }),
    );
    (meter, calls)
}

#[test]
fn long_strings_retain_each_1024_unit_deadline_check_and_final_commit_check() {
    let value = "中😀\n".repeat(32_768);
    for stop_at in 2..=12 {
        let (mut old, old_calls) = clock_meter(stop_at);
        let (mut current, current_calls) = clock_meter(stop_at);
        let expected = legacy_string(&value, &mut old, 16_777_216);
        let actual = codec::encode(&json!(value), &mut current, 16_777_216);
        assert_eq!(actual, expected, "deadline check {stop_at}");
        assert_eq!(current.used(), old.used());
        assert_eq!(current.failure(), old.failure());
        assert_eq!(current_calls.get(), old_calls.get());
    }
    // A tiny value never reaches the periodic threshold. Its closing commit
    // still catches expiry after the opening control check.
    let (mut old, _) = clock_meter(3);
    let (mut current, _) = clock_meter(3);
    assert_eq!(
        codec::encode(&json!("x"), &mut current, 64),
        legacy_string("x", &mut old, 64)
    );
    assert!(matches!(
        current.failure(),
        Some(BudgetError::Deadline { .. })
    ));
}

#[test]
fn long_strings_retain_cancellation_at_the_same_charge_boundaries() {
    let value = "a".repeat(65_537);
    for stop_at in [1, 2, 3, 4] {
        let make = || {
            let calls = Rc::new(Cell::new(0));
            let observed = calls.clone();
            let mut meter = meter(Limits::default());
            meter.set_cancel(Box::new(move || {
                observed.set(observed.get() + 1);
                observed.get() >= stop_at
            }));
            (meter, calls)
        };
        let (mut old, old_calls) = make();
        let (mut current, current_calls) = make();
        assert_eq!(
            codec::encode(&json!(value), &mut current, 16_777_216),
            legacy_string(&value, &mut old, 16_777_216)
        );
        assert_eq!(current.used(), old.used());
        assert_eq!(current.failure(), old.failure());
        assert_eq!(current_calls.get(), old_calls.get());
    }
}

#[test]
fn public_zero_block_appends_still_observe_new_controls_and_sticky_failures() {
    let mut assembly = Assembly::new(64);
    let mut meter = meter(Limits::default());
    assembly.append(b"a", &mut meter).unwrap();
    let before = meter.used();
    meter.set_cancel(Box::new(|| true));
    assert_eq!(
        assembly.append(b"b", &mut meter),
        Err(CodecError::Budget(BudgetError::Cancelled))
    );
    assert_eq!(meter.used(), before);
    assert_eq!(
        assembly.append(b"", &mut meter),
        Err(CodecError::Budget(BudgetError::Cancelled))
    );
    assert_eq!(assembly.finish(), b"a");
    assert_eq!(
        codec::encode(&json!("x"), &mut meter, 64),
        Err(CodecError::Budget(BudgetError::Cancelled))
    );
}
