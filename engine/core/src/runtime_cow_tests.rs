//! Compare the private lazy before-image with the exact old eager clone policy.
//! Atomic actions, metering and rollback use the same unchanged function bodies.

use super::*;
use crate::budget::{BudgetError, Limits};
use crate::codec::Assembly;
use crate::semantic::analyze;
use crate::trace::{Direction, apply_step, validate_trace};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

#[derive(Clone, Copy, Default)]
struct Controls {
    cancel_at: Option<usize>,
    deadline_at: Option<usize>,
}

#[derive(Debug, PartialEq)]
struct Observed {
    execution: Option<Execution>,
    trace: Option<Trace>,
    canonical_trace: Option<Vec<u8>>,
    setup_error: Option<Diagnostic>,
    peak: usize,
    fuel: usize,
    reserved: usize,
    failure: Option<BudgetError>,
    controls: Vec<char>,
}

fn metered(checked: &CheckedProgram, eager: bool, limits: Limits, controls: Controls) -> Observed {
    let events = Rc::new(RefCell::new(Vec::new()));
    let clock_events = events.clone();
    let clock_reads = Rc::new(Cell::new(0));
    let mut meter = Meter::with_limits(limits);
    meter.set_clock(
        1000,
        Box::new(move || {
            clock_events.borrow_mut().push('t');
            let read = clock_reads.get() + 1;
            clock_reads.set(read);
            if controls.deadline_at.is_some_and(|at| read >= at) {
                1000
            } else {
                0
            }
        }),
    );
    let cancel_events = events.clone();
    let cancel_reads = Rc::new(Cell::new(0));
    meter.set_cancel(Box::new(move || {
        cancel_events.borrow_mut().push('c');
        let read = cancel_reads.get() + 1;
        cancel_reads.set(read);
        controls.cancel_at.is_some_and(|at| read >= at)
    }));
    // This is the unchanged execute_metered setup; only the before-image
    // Clone policy differs. Parsing is independently completed beforehand.
    let result = (|| {
        meter
            .charge(
                checked.parsed.program.nodes.len() * 3
                    + checked.references.len()
                    + checked.outputs.len(),
            )
            .map_err(|error| {
                error.diagnostic(
                    Stage::Execute,
                    Location::Synthetic {
                        reason: "pre-execution",
                    },
                )
            })?;
        let mut machine = Machine::new(checked, true);
        machine.state.legacy_eager = eager;
        machine.wire = Some(TraceWire::new(machine.projection(), 128, &mut meter)?);
        machine.meter = Some(&mut meter);
        Ok::<_, Diagnostic>(machine.run())
    })();
    let mut observed = Observed {
        execution: None,
        trace: None,
        canonical_trace: None,
        setup_error: None,
        peak: 0,
        fuel: meter.used(),
        reserved: meter.reserved(),
        failure: meter.failure(),
        controls: events.borrow().clone(),
    };
    match result {
        Err(error) => observed.setup_error = Some(error),
        Ok((execution, _, wire, peak)) => {
            let wire = wire.unwrap();
            // Inspect the already retained bytes with an independent meter;
            // the production meter and its sticky failure are not touched.
            let mut encode_meter = Meter::new();
            encode_meter.set_clock(1000, Box::new(|| 0));
            let mut assembly = Assembly::new(Limits::default().result_bytes);
            wire.write(&mut assembly, &mut encode_meter).unwrap();
            let canonical = assembly.finish();
            assert_eq!(canonical.len(), wire.encoded_len());
            assert_eq!(
                serde_json::from_slice::<Trace>(&canonical).unwrap(),
                wire.trace
            );
            let nodes = checked.parsed.program.node_map();
            validate_trace(&wire.trace, &nodes).unwrap();
            let initial = wire.trace.initial_state.clone();
            let mut restored = initial.clone();
            for step in &wire.trace.steps {
                apply_step(&mut restored, step, Direction::Forward).unwrap();
            }
            for step in wire.trace.steps.iter().rev() {
                apply_step(&mut restored, step, Direction::Backward).unwrap();
            }
            assert_eq!(restored, initial);
            observed.execution = Some(execution);
            observed.trace = Some(wire.trace);
            observed.canonical_trace = Some(canonical);
            observed.peak = peak;
        }
    }
    observed
}

fn differential(source: &str, limits: Limits, controls: Controls) -> Observed {
    let checked = analyze(source).unwrap();
    let lazy = metered(&checked, false, limits, controls);
    let eager = metered(&checked, true, limits, controls);
    assert_eq!(lazy, eager, "lazy/eager divergence for {source}");
    lazy
}

fn source(body: &str) -> String {
    format!("int main(){{{body}}}")
}

fn sort_source(selection: bool) -> String {
    let values = (0..30)
        .rev()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let algorithm = if selection {
        "for(int i=0;i<n-1;i=i+1){int min=i;for(int j=i+1;j<n;j=j+1){if(a[j]<a[min]){min=j;}}if(min!=i){int temp=a[i];a[i]=a[min];a[min]=temp;}}"
    } else {
        "for(int i=0;i<n-1;i=i+1){for(int j=0;j<n-i-1;j=j+1){if(a[j]>a[j+1]){int temp=a[j];a[j]=a[j+1];a[j+1]=temp;}}}"
    };
    source(&format!(
        "int n=30;int a[30]={{{values}}};{algorithm}for(int k=0;k<n;k=k+1){{printf(\"%d \",a[k]);}}return 0;"
    ))
}

#[test]
fn state_cow_shares_read_only_before_images_and_detaches_on_first_write() {
    let mut state = StateSnapshot::new(RuntimeState::default());
    state.enter_scope(1);
    state.declare(2, "x".into());
    state.write(2, 3);
    state.declare_array(3, "a".into(), 30);
    state.initialize_array(3, vec![1, 2, 3]);
    let before = state.clone();
    assert!(Arc::ptr_eq(&state.value, &before.value));
    assert_eq!(state.read(2), Some(3));
    assert_eq!(state.read_array(3, 2), Some(3));
    assert!(Arc::ptr_eq(&state.value, &before.value));
    state.write(2, 9);
    assert!(!Arc::ptr_eq(&state.value, &before.value));
    assert_eq!(before.read(2), Some(3));
    assert!(Arc::ptr_eq(
        &state.arrays[&3].cells,
        &before.arrays[&3].cells
    ));
    state.write_array(3, 2, -99);
    assert_eq!(before.read_array(3, 2), Some(3));
    assert_eq!(state.read_array(3, 2), Some(-99));
    state = before;
    assert_eq!(state.read(2), Some(3));
    assert_eq!(state.read_array(3, 2), Some(3));
    assert_eq!(Arc::strong_count(&state.value), 1);
    assert_eq!(state.into_inner().read(2), Some(3));
}

#[test]
fn state_cow_matches_eager_thirty_cell_bubble_and_selection_bytes() {
    for selection in [false, true] {
        let result = differential(
            &sort_source(selection),
            Limits::default(),
            Controls::default(),
        );
        let execution = result.execution.unwrap();
        assert_eq!(
            execution.outcome,
            ExecutionOutcome::Completed { exit_code: 0 }
        );
        let expected = (0..30).map(|value| format!("{value} ")).collect::<String>();
        assert_eq!(execution.state.output, expected);
        assert!(result.trace.unwrap().steps.len() > 1000);
    }
}

#[test]
fn state_cow_matches_eager_condition_short_circuit_scopes_jumps_and_output() {
    let bodies = [
        "int x=0;if(0&&(1/0)){x=99;}if(1||(1/0)){x=1;};;;printf(\"%d\",x);return x;",
        "int x=0;for(int i=0;i<5;i=i+1){int a[3]={0,0,2};a[0]=i;if(i==1){continue;}if(i==4){break;}x=x+a[0];}printf(\"值=%d\\n\",x);return x;",
        "int x=3;while(x>0){{int x=7;printf(\"%d\",x);}x=x-1;}return 0;",
        "int a[30]={0};a[0]=999;a[29]=-999;a[0]=0;printf(\"%d %d\",a[0],a[29]);return 0;",
    ];
    for body in bodies {
        let result = differential(&source(body), Limits::default(), Controls::default());
        assert!(matches!(
            result.execution.unwrap().outcome,
            ExecutionOutcome::Completed { .. }
        ));
    }
}

#[test]
fn state_cow_matches_eager_program_errors_and_atomic_rollback() {
    for body in [
        "int x=7;int y=x/0;return 0;",
        "int a[3]={1,2,3};int x=3;a[x]=9;return 0;",
        "int x=2147483647;x=x+1;return 0;",
        "int x;printf(\"prefix %d\",x);return 0;",
    ] {
        let result = differential(&source(body), Limits::default(), Controls::default());
        assert!(matches!(
            result.execution.unwrap().outcome,
            ExecutionOutcome::ProgramError { .. }
        ));
        assert_eq!(result.trace.unwrap().completeness, "prefix");
    }
    // A budget failure after writing, during projection/admission, must restore
    // values as well as all pending work, metadata and teaching identities.
    let checked = analyze(&source("int x=1;x=2;return 0;")).unwrap();
    let write = checked
        .parsed
        .program
        .nodes
        .iter()
        .enumerate()
        .find_map(|(id, node)| matches!(node.data, NodeData::Assignment { .. }).then_some(id))
        .unwrap();
    let declaration = checked.declarations[0].node_id;
    let NodeData::Function { body } =
        checked.parsed.program.nodes[checked.parsed.program.root].data
    else {
        unreachable!()
    };
    for eager in [false, true] {
        let mut meter = Meter::with_limits(Limits {
            fuel: 50000,
            ..Limits::default()
        });
        meter.set_clock(1000, Box::new(|| 0));
        let mut machine = Machine::new(&checked, true);
        machine.state.legacy_eager = eager;
        machine.state.enter_scope(body);
        machine.state.declare(declaration, "x".into());
        machine.state.write(declaration, 7);
        let original = (*machine.state).clone();
        machine.wire = Some(TraceWire::new(machine.projection(), 128, &mut meter).unwrap());
        machine.meter = Some(&mut meter);
        let error = machine
            .atomic(
                write,
                "value.write",
                runtime_trace::source(write, "whole"),
                |machine| {
                    machine.state.write(declaration, 9);
                    machine.charge(write, 50000)?;
                    Ok(())
                },
            )
            .unwrap_err();
        assert_eq!(error.code, DiagnosticCode::FuelLimit);
        assert_eq!(*machine.state, original);
        assert_eq!(machine.trace_len(), 0);
    }
}

#[test]
fn state_cow_matches_eager_smaller_fuel_step_output_memory_and_result_budgets() {
    let program = source(
        "int a[30]={1,2,3};int x=0;for(int i=0;i<12;i=i+1){x=x+a[i];printf(\"%d \",x);}return 0;",
    );
    let limits = [
        Limits {
            fuel: 4100,
            ..Limits::default()
        },
        Limits {
            fuel: 5000,
            ..Limits::default()
        },
        Limits {
            fuel: 10000,
            ..Limits::default()
        },
        Limits {
            steps: 3,
            ..Limits::default()
        },
        Limits {
            steps: 12,
            ..Limits::default()
        },
        Limits {
            output_bytes: 1,
            ..Limits::default()
        },
        Limits {
            live_bytes: 4,
            ..Limits::default()
        },
        Limits {
            result_bytes: 5000,
            ..Limits::default()
        },
        Limits {
            result_bytes: 16000,
            ..Limits::default()
        },
    ];
    for limits in limits {
        let result = differential(&program, limits, Controls::default());
        assert!(
            result.setup_error.is_some()
                || matches!(
                    result.execution.unwrap().outcome,
                    ExecutionOutcome::ResourceLimit { .. }
                )
        );
    }
}

#[test]
fn state_cow_matches_eager_cancel_deadline_and_control_callback_sequences() {
    let program = source("int x=0;while(x<100){x=x+1;}return 0;");
    for at in [1, 2, 5, 20] {
        for controls in [
            Controls {
                cancel_at: Some(at),
                deadline_at: None,
            },
            Controls {
                cancel_at: None,
                deadline_at: Some(at + 1),
            },
        ] {
            let result = differential(&program, Limits::default(), controls);
            assert!(!result.controls.is_empty());
            assert!(
                result.setup_error.is_some()
                    || !matches!(
                        result.execution.unwrap().outcome,
                        ExecutionOutcome::Completed { .. }
                    )
            );
        }
    }
}

#[test]
fn state_cow_matches_eager_unmetered_recorded_and_unrecorded_execution() {
    for body in [
        "int x=0;while(x<3){x=x+1;}printf(\"%d\",x);return x;",
        "int a[3]={1,2,3};a[1]=9;printf(\"%d\",a[1]);return 0;",
        "int x=7;{int x=2;printf(\"%d\",x);}return x/0;",
    ] {
        let checked = analyze(&source(body)).unwrap();
        for recording in [false, true] {
            let run = |eager| {
                let mut machine = Machine::new(&checked, recording);
                machine.state.legacy_eager = eager;
                let (execution, trace, wire, peak) = machine.run();
                assert!(wire.is_none());
                (execution, trace, peak)
            };
            assert_eq!(run(false), run(true));
        }
    }
}
