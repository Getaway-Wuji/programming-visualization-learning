//! Frozen before-optimization encoder, confined to tests. The only substitution
//! is its Assembly append call into the copied original append below, so public
//! Assembly behavior and optimized Encoder behavior are checked independently.
use super::*;
use crate::budget::Limits;
use serde_json::json;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

fn legacy_append(
    assembly: &mut Assembly,
    part: &[u8],
    meter: &mut Meter,
) -> Result<(), CodecError> {
    let attempted = assembly
        .bytes
        .len()
        .checked_add(part.len())
        .ok_or(CodecError::Limit {
            limit: assembly.max_bytes,
            used: assembly.bytes.len(),
            attempted: usize::MAX,
        })?;
    if attempted > assembly.max_bytes {
        return Err(CodecError::Limit {
            limit: assembly.max_bytes,
            used: assembly.bytes.len(),
            attempted,
        });
    }
    let blocks = attempted.div_ceil(64) - assembly.bytes.len().div_ceil(64);
    meter.charge(blocks)?;
    assembly
        .bytes
        .try_reserve(part.len())
        .map_err(|_| CodecError::Allocation)?;
    assembly.bytes.extend_from_slice(part);
    Ok(())
}

// Frozen codec source SHA-256: ef2a0edea5501d6fa0aa8de413a45d095a517b3514ca53202cda753a5f8d2f10
pub struct ReferenceEncoder<'a> {
    meter: &'a mut Meter,
    output: Assembly,
    scanned_bytes: usize,
}

impl<'a> ReferenceEncoder<'a> {
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
        legacy_append(&mut self.output, bytes, self.meter)
    }

    fn string(&mut self, value: &str) -> Result<(), CodecError> {
        self.append(b"\"")?;
        let mut raw_start = 0;
        for (at, character) in value.char_indices() {
            let after_scan = self.scanned_bytes.saturating_add(character.len_utf8());
            let blocks = after_scan.div_ceil(64) - self.scanned_bytes.div_ceil(64);
            // The opening quote has already charged the first output block.
            // While ReferenceEncoder holds this exclusive meter borrow, successful
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

#[derive(Clone, Copy, Default)]
struct Configuration {
    fuel: Option<usize>,
    reserve_bytes: Option<usize>,
    prime_charge: Option<usize>,
    deadline_read: Option<usize>,
    cancel_read: Option<usize>,
}

type Reads = Rc<RefCell<Vec<(char, u64)>>>;
fn observed_meter(config: Configuration) -> (Meter, Reads) {
    let mut meter = Meter::with_limits(Limits {
        fuel: config.fuel.unwrap_or(1_000_000),
        ..Limits::default()
    });
    let reads = Rc::new(RefCell::new(Vec::new()));
    let clock_log = Rc::clone(&reads);
    let count = Rc::new(Cell::new(0_usize));
    meter.set_clock(
        37,
        Box::new(move || {
            count.set(count.get() + 1);
            let value = if config.deadline_read.is_some_and(|at| count.get() >= at) {
                37
            } else {
                0
            };
            clock_log.borrow_mut().push(('T', value));
            value
        }),
    );
    let cancel_log = Rc::clone(&reads);
    let count = Rc::new(Cell::new(0_usize));
    meter.set_cancel(Box::new(move || {
        count.set(count.get() + 1);
        let value = config.cancel_read.is_some_and(|at| count.get() >= at);
        cancel_log.borrow_mut().push(('C', u64::from(value)));
        value
    }));
    if let Some(bytes) = config.reserve_bytes {
        let _ = meter.reserve_result(bytes);
    }
    if let Some(units) = config.prime_charge {
        let _ = meter.charge(units);
    }
    (meter, reads)
}

enum Operation<'a> {
    Raw(&'a [u8]),
    String(&'a str),
    Value(&'a Value, usize),
}
#[derive(Debug, PartialEq, Eq)]
struct Observation {
    outcome: Result<(), CodecError>,
    retained: Vec<u8>,
    used: usize,
    reserved: usize,
    failure: Option<BudgetError>,
    reads: Vec<(char, u64)>,
}
#[derive(Debug, PartialEq, Eq)]
struct Transcript {
    observations: Vec<Observation>,
    finished: Result<Vec<u8>, CodecError>,
    used: usize,
    reserved: usize,
    failure: Option<BudgetError>,
    reads: Vec<(char, u64)>,
}
macro_rules! sequence {
    ($name:ident, $encoder:ident) => {
        fn $name(
            config: Configuration,
            max_bytes: usize,
            operations: &[Operation<'_>],
        ) -> Transcript {
            let (mut meter, reads) = observed_meter(config);
            let mut encoder = $encoder::new(&mut meter, max_bytes);
            let mut observations = Vec::new();
            for operation in operations {
                let outcome = match operation {
                    Operation::Raw(bytes) => encoder.raw(bytes),
                    Operation::String(value) => encoder.string_value(value),
                    Operation::Value(value, containers) => encoder.value_ref(value, *containers),
                };
                observations.push(Observation {
                    outcome,
                    retained: encoder.output.bytes.clone(),
                    used: encoder.meter.used(),
                    reserved: encoder.meter.reserved(),
                    failure: encoder.meter.failure(),
                    reads: reads.borrow().clone(),
                });
            }
            let finished = encoder.finish();
            let observed_reads = reads.borrow().clone();
            Transcript {
                observations,
                finished,
                used: meter.used(),
                reserved: meter.reserved(),
                failure: meter.failure(),
                reads: observed_reads,
            }
        }
    };
}
sequence!(current_sequence, Encoder);
sequence!(reference_sequence, ReferenceEncoder);
fn compare(config: Configuration, max_bytes: usize, operations: &[Operation<'_>]) -> Transcript {
    let actual = current_sequence(config, max_bytes, operations);
    let expected = reference_sequence(config, max_bytes, operations);
    assert_eq!(actual, expected);
    actual
}

#[test]
fn exact_canonical_values_and_empty_raw_writes_match_frozen_encoder() {
    let controls = (0..=31).map(char::from).collect::<String>();
    let values = [
        json!(null),
        json!(true),
        json!(false),
        json!(9007199254740991_i64),
        json!(-9007199254740991_i64),
        json!(""),
        json!("中文😀/\"\\\n\t"),
        json!(controls),
        json!([0, 1, -1, {}, [], "", true]),
        json!({"a":[true,false,null],"b":"key scans aggregate","z":99}),
    ];
    for value in values {
        let actual = compare(
            Configuration::default(),
            16_777_216,
            &[
                Operation::Raw(b""),
                Operation::Value(&value, 0),
                Operation::Raw(b""),
                Operation::Raw(b""),
            ],
        );
        assert_eq!(
            actual.finished.unwrap(),
            serde_json::to_vec(&value).unwrap()
        );
        let (mut old, old_reads) = observed_meter(Configuration::default());
        let (mut current, current_reads) = observed_meter(Configuration::default());
        assert_eq!(
            Encoder::new(&mut current, 16_777_216).encode(&value),
            ReferenceEncoder::new(&mut old, 16_777_216).encode(&value)
        );
        assert_eq!(current.used(), old.used());
        assert_eq!(*current_reads.borrow(), *old_reads.borrow());
    }
    for count in [
        0, 1, 15, 16, 21, 22, 31, 32, 63, 64, 65, 127, 128, 129, 1023, 1024, 1025,
    ] {
        for unit in ["a", "中", "😀", "\"\\\n\t", controls.as_str()] {
            let value = unit.repeat(count);
            compare(
                Configuration::default(),
                16_777_216,
                &[Operation::String(&value), Operation::Raw(b"")],
            );
        }
    }
}

#[test]
fn byte_capacity_and_fuel_reserve_edges_preserve_each_partial_write_and_error() {
    let value = json!({"a":[0,1,-1,true,false,null],"b":"中😀\u{0}\n".repeat(25)});
    let size = serde_json::to_vec(&value).unwrap().len();
    for max in [
        0,
        1,
        2,
        63,
        64,
        65,
        size - 1,
        size,
        size + 1,
        16_777_216,
        usize::MAX,
    ] {
        for fuel in [0, 4095, 4096, 4097, 4098, 4100, 4110, 4200, 1_000_000] {
            compare(
                Configuration {
                    fuel: Some(fuel),
                    ..Default::default()
                },
                max,
                &[
                    Operation::Raw(b""),
                    Operation::Value(&value, 0),
                    Operation::Raw(b""),
                    Operation::Raw(b"x"),
                ],
            );
        }
    }
    for reserve in [0, 1, 63, 64, 65, 1024, 65536] {
        for fuel in [4095, 4096, 4097, 4098, 5000, 1_000_000] {
            compare(
                Configuration {
                    fuel: Some(fuel),
                    reserve_bytes: Some(reserve),
                    ..Default::default()
                },
                128,
                &[
                    Operation::Raw(b"x"),
                    Operation::Raw(&[b'y'; 63]),
                    Operation::Raw(b"z"),
                    Operation::Raw(b""),
                ],
            );
        }
    }
}

#[test]
fn positive_1024_unit_checks_and_final_commit_keep_exact_clock_cancel_read_order() {
    let value = "中😀\n\u{0}".repeat(16384);
    for prime in [
        None,
        Some(0),
        Some(1022),
        Some(1023),
        Some(1024),
        Some(2047),
    ] {
        for stop in 1..=10 {
            for (deadline, cancel) in [
                (Some(stop), None),
                (None, Some(stop)),
                (Some(stop), Some(stop)),
            ] {
                compare(
                    Configuration {
                        prime_charge: prime,
                        deadline_read: deadline,
                        cancel_read: cancel,
                        ..Default::default()
                    },
                    16_777_216,
                    &[
                        Operation::String(&value),
                        Operation::Raw(b""),
                        Operation::Raw(b"z"),
                    ],
                );
            }
        }
    }
    let tiny = compare(
        Configuration {
            deadline_read: Some(3),
            ..Default::default()
        },
        64,
        &[Operation::String("x")],
    );
    assert!(matches!(
        tiny.finished,
        Err(CodecError::Budget(BudgetError::Deadline { .. }))
    ));
    let both = compare(
        Configuration {
            deadline_read: Some(2),
            cancel_read: Some(1),
            fuel: Some(0),
            ..Default::default()
        },
        64,
        &[Operation::Raw(b"x")],
    );
    assert_eq!(
        both.observations[0].outcome,
        Err(CodecError::Budget(BudgetError::Cancelled))
    );
}

#[test]
fn first_empty_call_preexisting_failure_and_retry_after_string_scan_failure_stay_checked() {
    let initial = compare(
        Configuration {
            fuel: Some(4095),
            ..Default::default()
        },
        64,
        &[
            Operation::Raw(b""),
            Operation::Raw(b""),
            Operation::Raw(b"x"),
        ],
    );
    assert!(matches!(
        initial.observations[0].outcome,
        Err(CodecError::Budget(BudgetError::Fuel {
            attempted: 4096,
            ..
        }))
    ));
    for config in [
        Configuration {
            prime_charge: Some(usize::MAX),
            ..Default::default()
        },
        Configuration {
            prime_charge: Some(0),
            cancel_read: Some(1),
            ..Default::default()
        },
        Configuration {
            prime_charge: Some(0),
            deadline_read: Some(2),
            ..Default::default()
        },
    ] {
        let result = compare(
            config,
            1,
            &[
                Operation::Raw(b"xx"),
                Operation::Raw(b""),
                Operation::Raw(b"x"),
            ],
        );
        assert_eq!(
            result.observations[0].outcome,
            Err(CodecError::Limit {
                limit: 1,
                used: 0,
                attempted: 2
            })
        );
        assert!(matches!(
            result.observations[1].outcome,
            Err(CodecError::Budget(_))
        ));
    }
    let retry = compare(
        Configuration {
            fuel: Some(4097),
            ..Default::default()
        },
        64,
        &[
            Operation::Raw(b"a"),
            Operation::String("x"),
            Operation::Raw(b""),
            Operation::Raw(b"b"),
        ],
    );
    assert_eq!(retry.observations[1].retained, b"a\"");
    assert!(matches!(
        retry.observations[1].outcome,
        Err(CodecError::Budget(BudgetError::Fuel { .. }))
    ));
    assert_eq!(retry.observations[2].outcome, retry.observations[1].outcome);
    assert_eq!(retry.observations[3].retained, b"a\"");
    let scan_stop = compare(
        Configuration {
            prime_charge: Some(1022),
            deadline_read: Some(3),
            ..Default::default()
        },
        64,
        &[
            Operation::String("x"),
            Operation::Raw(b""),
            Operation::Raw(b"b"),
        ],
    );
    assert_eq!(scan_stop.observations[0].retained, b"\"");
    assert!(matches!(
        scan_stop.observations[0].outcome,
        Err(CodecError::Budget(BudgetError::Deadline { .. }))
    ));
    assert_eq!(
        scan_stop.observations[1].outcome,
        scan_stop.observations[0].outcome
    );
}

#[test]
fn size_and_invalid_depth_failures_do_not_poison_valid_zero_block_retries() {
    let object = json!({"中":1});
    let unsafe_integer = json!(9007199254740992_u64);
    let float = json!(1.5);
    let value = json!([null]);
    compare(
        Configuration::default(),
        8,
        &[
            Operation::Raw(b"a"),
            Operation::Raw(b"more than eight"),
            Operation::Raw(b""),
            Operation::Raw(b"b"),
        ],
    );
    compare(
        Configuration::default(),
        1024,
        &[
            Operation::Value(&object, 0),
            Operation::Raw(b""),
            Operation::Value(&unsafe_integer, 0),
            Operation::Value(&float, 0),
            Operation::Raw(b"z"),
        ],
    );
    let result = compare(
        Configuration::default(),
        64,
        &[
            Operation::Value(&value, 31),
            Operation::Value(&value, 32),
            Operation::Raw(b""),
        ],
    );
    assert!(matches!(
        result.observations[1].outcome,
        Err(CodecError::Depth {
            limit: 32,
            attempted: 33
        })
    ));
}

#[test]
fn public_assembly_zero_block_appends_still_observe_external_reconfiguration() {
    fn run(append: fn(&mut Assembly, &[u8], &mut Meter) -> Result<(), CodecError>) -> Transcript {
        let (mut meter, reads) = observed_meter(Configuration::default());
        let mut assembly = Assembly::new(2);
        let mut observations = Vec::new();
        let first = append(&mut assembly, b"a", &mut meter);
        observations.push(Observation {
            outcome: first,
            retained: assembly.bytes.clone(),
            used: meter.used(),
            reserved: meter.reserved(),
            failure: meter.failure(),
            reads: reads.borrow().clone(),
        });
        let log = Rc::clone(&reads);
        meter.set_cancel(Box::new(move || {
            log.borrow_mut().push(('C', 1));
            true
        }));
        for part in [b"b".as_slice(), b"", b"xx", b""] {
            let outcome = append(&mut assembly, part, &mut meter);
            observations.push(Observation {
                outcome,
                retained: assembly.bytes.clone(),
                used: meter.used(),
                reserved: meter.reserved(),
                failure: meter.failure(),
                reads: reads.borrow().clone(),
            });
        }
        let failure = meter.failure();
        let observed_reads = reads.borrow().clone();
        Transcript {
            observations,
            finished: Ok(assembly.finish()),
            used: meter.used(),
            reserved: meter.reserved(),
            failure,
            reads: observed_reads,
        }
    }
    let current = run(Assembly::append);
    assert_eq!(current, run(legacy_append));
    assert_eq!(
        current.observations[1].outcome,
        Err(CodecError::Budget(BudgetError::Cancelled))
    );
    assert_eq!(
        current.observations[2].outcome,
        current.observations[1].outcome
    );
    assert_eq!(
        current.observations[3].outcome,
        Err(CodecError::Limit {
            limit: 2,
            used: 1,
            attempted: 3
        })
    );
    assert_eq!(current.finished.unwrap(), b"a");
}

#[test]
#[ignore = "Coordinator-only optional native microbenchmark, not browser acceptance"]
fn append_zero_native_microbenchmark() {
    use std::{hint::black_box, time::Instant};
    let value = json!({"arguments":[0,1,-1,2,3,4,5],"before":{"a":1,"b":2,"c":3},"kind":"compare","location":{"nodeId":"statement-30","sourceRevision":1},"observations":[{"kind":"read","objectId":"object-1","value":29},{"kind":"write","objectId":"object-2","value":30}]});
    let mut pairs = Vec::new();
    for index in 0..7 {
        let old = || {
            let start = Instant::now();
            for _ in 0..1000 {
                let mut meter = Meter::new();
                meter.set_clock(1000, Box::new(|| 0));
                black_box(
                    ReferenceEncoder::new(&mut meter, 4096)
                        .encode(black_box(&value))
                        .unwrap(),
                );
            }
            start.elapsed().as_nanos()
        };
        let current = || {
            let start = Instant::now();
            for _ in 0..1000 {
                let mut meter = Meter::new();
                meter.set_clock(1000, Box::new(|| 0));
                black_box(
                    Encoder::new(&mut meter, 4096)
                        .encode(black_box(&value))
                        .unwrap(),
                );
            }
            start.elapsed().as_nanos()
        };
        let pair = if index % 2 == 0 {
            let before = old();
            (before, current())
        } else {
            let after = current();
            (old(), after)
        };
        pairs.push(pair);
    }
    eprintln!(
        "append-zero native old/current nanoseconds per 1000 public-value encodes: {pairs:?}; no WASM/browser latency claim"
    );
}
