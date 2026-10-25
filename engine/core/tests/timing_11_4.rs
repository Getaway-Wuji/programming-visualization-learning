//! Optional private observations preserve the real pipeline and control reads.
use c_viz_core::{
    budget::{BudgetError, Limits, Meter, TIMING_PHASE_COUNT, TIMING_VECTOR_LEN, TimingPhase},
    codec,
    exec::{self, ExecFailure},
    run,
};
use serde_json::{Value, json};
use std::{cell::Cell, cell::RefCell, rc::Rc};

struct Controls {
    events: Rc<RefCell<Vec<char>>>,
    observer_reads: Rc<Cell<u32>>,
}

fn meter(
    observed: bool,
    limits: Limits,
    deadline_read: Option<usize>,
    cancel_read: Option<usize>,
) -> (Meter, Controls) {
    let mut meter = Meter::with_limits(limits);
    let events = Rc::new(RefCell::new(Vec::new()));
    let clock_events = Rc::clone(&events);
    let mut clock_reads = 0;
    meter.set_clock(
        1000,
        Box::new(move || {
            clock_events.borrow_mut().push('T');
            clock_reads += 1;
            if deadline_read.is_some_and(|limit| clock_reads >= limit) {
                1000
            } else {
                0
            }
        }),
    );
    let cancel_events = Rc::clone(&events);
    let mut cancel_reads = 0;
    meter.set_cancel(Box::new(move || {
        cancel_events.borrow_mut().push('C');
        cancel_reads += 1;
        cancel_read.is_some_and(|limit| cancel_reads >= limit)
    }));
    let observer_reads = Rc::new(Cell::new(0));
    if observed {
        let count = Rc::clone(&observer_reads);
        meter.set_observer_clock(Box::new(move || {
            count.set(count.get() + 1);
            f64::from(count.get()) * 25.0
        }));
    }
    (
        meter,
        Controls {
            events,
            observer_reads,
        },
    )
}

fn phase_calls(vector: &[f64; TIMING_VECTOR_LEN], phase: TimingPhase) -> f64 {
    vector[1 + TIMING_PHASE_COUNT + phase as usize]
}

#[test]
fn observation_is_optional_numeric_and_has_no_budget_or_cancel_reads_of_its_own() {
    let (mut plain, plain_controls) = meter(false, Limits::default(), None, None);
    let (mut observed, observed_controls) = meter(true, Limits::default(), None, None);
    let plain_result = plain.measure(TimingPhase::RustTotal, |meter| meter.charge(10_000));
    let observed_result = observed.measure(TimingPhase::RustTotal, |meter| meter.charge(10_000));
    assert_eq!(plain_result, observed_result);
    assert_eq!(plain.used(), observed.used());
    assert_eq!(
        *plain_controls.events.borrow(),
        *observed_controls.events.borrow()
    );
    assert_eq!(plain.timing_vector(), [0.0; TIMING_VECTOR_LEN]);
    assert_eq!(plain_controls.observer_reads.get(), 0);
    assert_eq!(observed_controls.observer_reads.get(), 2);
    let vector = observed.timing_vector();
    assert_eq!(vector[0], 1.0);
    assert_eq!(vector[1 + TimingPhase::RustTotal as usize], 25.0);
    assert_eq!(phase_calls(&vector, TimingPhase::RustTotal), 1.0);
    assert_eq!(vector[TIMING_VECTOR_LEN - 2], 2.0);
    assert_eq!(vector[TIMING_VECTOR_LEN - 1], 0.0);
}

#[test]
fn real_parser_semantics_trace_and_complete_final_bytes_remain_exactly_equal() {
    let sources = [
        "int main(){int x=0;for(int i=0;i<20;i=i+1){x=x+i;}printf(\"%d\",x);return 0;}",
        "int main(){return ;}",
        "int main(){int x=0;int x=2;return 0;}",
        "int main(){int x=0;printf(\"%d\",1/x);return 0;}",
    ];
    for source in sources {
        let (mut plain, plain_controls) = meter(false, Limits::default(), None, None);
        let (mut observed, observed_controls) = meter(true, Limits::default(), None, None);
        let before = run::run(source, &mut plain);
        let after = run::run(source, &mut observed);
        assert_eq!(before.bytes, after.bytes, "{source}");
        assert_eq!(before.status, after.status);
        assert_eq!(before.stats, after.stats);
        assert_eq!(before.diagnostics, after.diagnostics);
        assert_eq!(plain.used(), observed.used());
        assert_eq!(plain.failure(), observed.failure());
        assert_eq!(
            *plain_controls.events.borrow(),
            *observed_controls.events.borrow()
        );
        assert!(observed_controls.observer_reads.get() > 0);
        let vector = observed.timing_vector();
        assert!(phase_calls(&vector, TimingPhase::SourceParse) > 0.0);
        assert_eq!(phase_calls(&vector, TimingPhase::FinalEncode), 1.0);
        if let Some(trace) = after.trace {
            assert_eq!(phase_calls(&vector, TimingPhase::ExecuteInclusive), 1.0);
            assert_eq!(
                phase_calls(&vector, TimingPhase::TraceEncodeAdmission),
                trace.steps.len() as f64 + 1.0
            );
        }
    }
}

#[test]
fn deadline_cancellation_fuel_failure_priority_and_control_sequences_do_not_change() {
    for (deadline, cancel, fuel) in [
        (Some(3), None, 1_000_000),
        (Some(7), None, 1_000_000),
        (None, Some(2), 1_000_000),
        (Some(3), Some(2), 1_000_000),
        (None, None, 5000),
    ] {
        let limits = Limits {
            fuel,
            ..Limits::default()
        };
        let (mut plain, plain_controls) = meter(false, limits, deadline, cancel);
        let (mut observed, observed_controls) = meter(true, limits, deadline, cancel);
        let source = "int main(){int i=0;while(i<20){i=i+1;}return 0;}";
        let before = run::run(source, &mut plain);
        let after = run::run(source, &mut observed);
        assert_eq!(before.bytes, after.bytes);
        assert_eq!(before.status, after.status);
        assert_eq!(before.diagnostics, after.diagnostics);
        assert_eq!(plain.used(), observed.used());
        assert_eq!(plain.failure(), observed.failure());
        assert_eq!(
            *plain_controls.events.borrow(),
            *observed_controls.events.borrow()
        );
        assert!(observed_controls.observer_reads.get() > 0);
        if deadline == Some(3) && cancel == Some(2) {
            assert_eq!(observed.failure(), Some(BudgetError::Cancelled));
        }
    }
}

fn catalog_and_request() -> (Value, Vec<u8>) {
    let package: Value =
        serde_json::from_str(include_str!("../../../项目文档/契约/02.1-内容样例.json")).unwrap();
    let find = |collection: &str, id: &str| {
        package[collection]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == id)
            .unwrap()
            .clone()
    };
    let subject = find("cases", "case.c.assignment");
    let program = find("programs", subject["programRef"]["id"].as_str().unwrap());
    let spec = find("inputSpecs", program["inputRef"]["id"].as_str().unwrap());
    let catalog = json!({
        "packageRef":{"id":package["packageId"],"version":package["packageVersion"]},
        "subject":subject,"program":program,"inputSpec":spec
    });
    let (mut preparation_meter, _) = meter(false, Limits::default(), None, None);
    let prepared: Value = serde_json::from_slice(
        &exec::prepare_input(&catalog, &program["exampleInput"], &mut preparation_meter).unwrap(),
    )
    .unwrap();
    let request = json!({
        "kind":"execute","protocolVersion":"1.0.0","traceVersion":"1.0.0","diagnosticVersion":"1.0.0","judgeVersion":"1.0.0","encodingVersion":"1.0.0",
        "identity":{"contextId":"timing-11.4","contextRevision":1,"submissionId":"timing","runId":"timing","sourceRevision":1,"testCaseKey":null},
        "mode":"case","packageRef":catalog["packageRef"],"languageRef":program["languageRef"],"subsetRef":program["subsetRef"],
        "programRef":subject["programRef"],"subjectRef":{"id":subject["id"],"version":subject["version"]},"learningRevision":subject["learningRevision"],
        "engineRef":{"id":"engine.c.p0","version":"1.0.0","buildId":"timing-build"},"source":prepared["source"],
        "input":{"specRef":program["inputRef"],"values":program["exampleInput"],"random":null},"judge":null,"budgetRef":{"id":"budget.p0","version":"1.0.0"},"remainingMs":1000
    });
    let bytes = codec::encode(&request, &mut preparation_meter, 65536).unwrap();
    (catalog, bytes)
}

#[test]
fn complete_exec_envelope_and_early_rejections_are_equal_and_phases_are_inclusive() {
    let (catalog, bytes) = catalog_and_request();
    for bytes in [bytes, b"{}".to_vec(), b"{bad".to_vec()] {
        let (mut plain, plain_controls) = meter(false, Limits::default(), None, None);
        let (mut observed, observed_controls) = meter(true, Limits::default(), None, None);
        let before = exec::execute_request(&bytes, &catalog, "timing-build", &mut plain);
        let after = exec::execute_request(&bytes, &catalog, "timing-build", &mut observed);
        assert_eq!(before, after);
        assert_eq!(plain.used(), observed.used());
        assert_eq!(plain.failure(), observed.failure());
        assert_eq!(
            *plain_controls.events.borrow(),
            *observed_controls.events.borrow()
        );
        let vector = observed.timing_vector();
        assert_eq!(phase_calls(&vector, TimingPhase::CoreRequest), 1.0);
        assert_eq!(phase_calls(&vector, TimingPhase::RequestPreflight), 1.0);
        if after.is_ok() {
            assert_eq!(phase_calls(&vector, TimingPhase::SourceParse), 2.0);
            assert_eq!(phase_calls(&vector, TimingPhase::Semantic), 2.0);
            assert_eq!(phase_calls(&vector, TimingPhase::MetadataEncode), 1.0);
            assert_eq!(phase_calls(&vector, TimingPhase::FinalEncode), 1.0);
            assert!(
                vector[1 + TimingPhase::CoreRequest as usize]
                    > vector[1 + TimingPhase::RequestPreflight as usize]
            );
            assert!(
                vector[1 + TimingPhase::ExecuteInclusive as usize]
                    >= vector[1 + TimingPhase::TraceEncodeAdmission as usize]
            );
        } else {
            assert_eq!(after, Err(ExecFailure("E_PROTOCOL_INVALID")));
            assert_eq!(phase_calls(&vector, TimingPhase::MetadataEncode), 0.0);
        }
    }
}

#[test]
fn invalid_observer_values_cannot_corrupt_execution_or_produce_non_numeric_metrics() {
    for invalid in [f64::NAN, f64::INFINITY, -1.0] {
        let (mut plain, plain_controls) = meter(false, Limits::default(), None, None);
        let (mut observed, observed_controls) = meter(false, Limits::default(), None, None);
        observed.set_observer_clock(Box::new(move || invalid));
        let source = "int main(){return 0;}";
        assert_eq!(
            run::run(source, &mut plain).bytes,
            run::run(source, &mut observed).bytes
        );
        assert_eq!(plain.used(), observed.used());
        assert_eq!(
            *plain_controls.events.borrow(),
            *observed_controls.events.borrow()
        );
        let vector = observed.timing_vector();
        assert!(
            vector
                .iter()
                .all(|value| value.is_finite() && *value >= 0.0)
        );
        assert!(vector[TIMING_VECTOR_LEN - 1] > 0.0);
    }
}
