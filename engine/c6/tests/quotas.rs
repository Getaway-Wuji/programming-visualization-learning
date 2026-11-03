//! Primitive boundary admissions complement the actual C matrix. They are not claimed as C executions.
use c_viz_c6::{
    api::{self, Wire},
    budget::{Limits, Meter},
    check,
    runtime::{Allocation, Runtime},
    state::Totals,
    syntax,
    types::Ty,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
#[test]
fn cumulative_step_20000_and_object_4096_admit_exactly_one_last_real_change() {
    for object_cap in [false, true] {
        let mut meter = Meter::new();
        let checked = check::check(
            syntax::parse("int global;int main(){return 0;}", &mut meter).unwrap(),
            &mut meter,
        )
        .unwrap();
        // Model quota already consumed by earlier independent case states; this is a direct admission test.
        let mut totals = Totals {
            steps: if object_cap { 0 } else { 19999 },
            objects: if object_cap { 4095 } else { 0 },
            ..Totals::default()
        };
        let root = checked.program.root;
        let mut runtime =
            Runtime::new(&checked, b"", BTreeSet::new(), 0, &mut totals, &mut meter).unwrap();
        if object_cap {
            let policy = || Allocation {
                storage: "static",
                zero: true,
                writable: true,
                parameter: false,
            };
            runtime.allocate(Ty::Int, "last", root, policy()).unwrap();
            let before = runtime.journal.state.clone();
            assert_eq!(runtime.totals.objects, 4096);
            assert_eq!(
                runtime
                    .allocate(Ty::Int, "over", root, policy())
                    .unwrap_err()
                    .code,
                "E_OBJECT_LIMIT"
            );
            assert_eq!(runtime.journal.state, before);
        } else {
            runtime.emit(root, "nop", vec![]).unwrap();
            let before = runtime.journal.state.clone();
            assert_eq!(runtime.totals.steps, 20000);
            assert_eq!(
                runtime.emit(root, "nop", vec![]).unwrap_err().code,
                "E_STEP_LIMIT"
            );
            assert_eq!(runtime.journal.state, before);
        }
    }
}
#[test]
fn meter_fuel_cannot_cross_one_million_or_renew_a_terminal_deadline() {
    let mut meter = Meter::new();
    meter.begin_finalization().unwrap();
    meter.charge(1_000_000).unwrap();
    assert_eq!(meter.used(), 1_000_000);
    assert!(meter.charge(1).is_err());
    let clock = std::rc::Rc::new(std::cell::Cell::new(0u64));
    let callback = clock.clone();
    let mut timed = Meter::new();
    timed.set_clock(1000, Box::new(move || callback.get()));
    clock.set(999);
    timed.check_commit().unwrap();
    clock.set(1000);
    assert!(matches!(
        timed.check_commit(),
        Err(c_viz_c6::budget::BudgetError::Deadline { .. })
    ));
    assert!(timed.begin_finalization().is_err());
}
fn large_json(extra: bool) -> Vec<u8> {
    // 512 bounded ASCII strings in a flat canonical JSON array; total exactly16MiB or one byte more.
    let mut bytes = vec![b'['];
    for i in 0..512 {
        if i > 0 {
            bytes.push(b',')
        }
        bytes.push(b'"');
        bytes.extend(std::iter::repeat_n(
            b'x',
            if i == 511 {
                31231 + usize::from(extra)
            } else {
                32768
            },
        ));
        bytes.push(b'"')
    }
    bytes.push(b']');
    bytes
}
#[test]
fn canonical_output_serialization_admits_16_mib_and_refuses_one_more_byte() {
    for extra in [false, true] {
        let raw = large_json(extra);
        assert_eq!(raw.len(), 16_777_216 + usize::from(extra));
        let mut meter = Meter::new();
        meter.begin_finalization().unwrap();
        let result = api::finish_wire(&Wire::Raw(&raw), &mut meter);
        if extra {
            assert_eq!(result.unwrap_err(), "E_RESULT_LIMIT")
        } else {
            assert_eq!(result.unwrap(), raw);
            assert!(meter.used() <= 1_000_000)
        }
    }
}
fn request(source: &str) -> Value {
    json!({"execVersion":"1.5.0","dslVersion":"1.4.0","diagnosticVersion":"1.4.0","integerEncoding":"1.0.0","language":"c","engineId":"engine.rust.c6","engineVersion":"0.1.0","runId":"request-cap","sourceRevision":"revision-1","sourceSha256":api::source_hash(source),"source":source,"input":{"kind":"stdin-ascii","text":""}})
}
#[test]
fn real_32k_c_source_fits_exactly_64k_request_and_one_extra_encoded_byte_is_rejected() {
    let tail = "*/int main(){return 0;}";
    let base = format!("/*{}{}", "x".repeat(32768 - tail.len() - 2), tail);
    let initial = serde_json::to_vec(&request(&base)).unwrap().len();
    let newlines = 65536 - initial;
    for extra in [false, true] {
        let n = newlines + usize::from(extra);
        let source = format!(
            "/*{}{}{}",
            "\n".repeat(n),
            "x".repeat(base.len() - tail.len() - 2 - n),
            tail
        );
        assert_eq!(source.len(), 32768);
        let bytes = serde_json::to_vec(&request(&source)).unwrap();
        assert_eq!(bytes.len(), 65536 + usize::from(extra));
        let mut meter = Meter::with_limits(Limits::default());
        let result = api::execute(&bytes, &"a".repeat(64), &mut meter);
        if extra {
            assert_eq!(result.unwrap_err(), "E_REQUEST_LIMIT")
        } else {
            let result: Value = serde_json::from_slice(&result.unwrap()).unwrap();
            assert_eq!(result["terminal"]["status"], "completed");
            assert_eq!(result["terminal"]["returnValue"], 0);
        }
    }
}
