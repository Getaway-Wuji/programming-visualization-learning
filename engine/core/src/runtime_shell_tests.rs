//! Frozen metered projection body; only the method name/visibility is changed.
use super::*;

impl Machine<'_> {
    pub(super) fn legacy_metered_projection(&mut self, id: NodeId) -> Result<Value, Diagnostic> {
        self.charge(
            id,
            self.flow_touched.len()
                + self.pending.len()
                + self.state.scopes.len()
                + self.state.variables.len()
                + self.state.arrays.len()
                + self.state.output.len().div_ceil(64),
        )?;
        for node in self.flow_touched.drain(..) {
            self.flow_positions[node] = usize::MAX;
        }
        let mut flow: Vec<(NodeId, &str, u64)> = Vec::new();
        for i in 0..self.pending.len() {
            let item = match self.pending[i] {
                Work::LeaveScope(node) => Some((
                    node,
                    if matches!(
                        self.checked.parsed.program.nodes[node].data,
                        NodeData::For { .. }
                    ) {
                        "condition"
                    } else {
                        "block"
                    },
                    *self.meta.iterations.get(&node).unwrap_or(&0),
                )),
                Work::WhileCheck { node, iteration } | Work::ForCheck { node, iteration } => {
                    Some((node, "condition", iteration))
                }
                Work::LoopMarker {
                    node, iteration, ..
                } => Some((node, "body", iteration)),
                Work::Init { node, .. } => Some((node, "init", 0)),
                Work::Update {
                    node, iteration, ..
                } => Some((node, "update", iteration)),
                Work::Initialize(child) => {
                    let mut found = None;
                    for at in 0..self.state.scopes.len() {
                        self.charge(id, 1)?;
                        let node = self.state.scopes[at].node_id;
                        if matches!(self.checked.parsed.program.nodes[node].data,NodeData::For{init:Some(init),..} if init==child)
                        {
                            found = Some((node, "init", 0));
                            break;
                        }
                    }
                    found
                }
                _ => None,
            };
            if let Some((node, stage, iteration)) = item {
                let at = self.flow_positions[node];
                if at == usize::MAX {
                    self.flow_positions[node] = flow.len();
                    self.flow_touched.push(node);
                    flow.push((node, stage, iteration));
                } else if stage != "block" {
                    flow[at] = (node, stage, iteration);
                }
            }
        }
        self.charge(id, flow.len())?;
        let flow=flow.into_iter().map(|(node,stage,iteration)|json!({"nodeId":runtime_trace::node(node),"stage":stage,"iteration":iteration})).collect();
        Ok(runtime_trace::shell(
            &self.state,
            self.checked,
            &self.meta,
            self.next_node(),
            flow,
        ))
    }
}

#[derive(Clone, Copy, Default)]
struct Controls {
    cancel_at: Option<usize>,
    deadline_at: Option<usize>,
}

#[derive(Debug, PartialEq)]
struct Observed {
    execution: Option<Execution>,
    trace: Option<Trace>,
    bytes: Option<Vec<u8>>,
    setup_error: Option<Diagnostic>,
    peak: usize,
    fuel: usize,
    reserved: usize,
    failure: Option<crate::budget::BudgetError>,
    controls: Vec<char>,
}

fn observed(
    checked: &CheckedProgram,
    legacy: bool,
    limits: crate::budget::Limits,
    controls: Controls,
) -> Observed {
    use crate::codec::Assembly;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

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
        machine.legacy_shell = legacy;
        let initial = machine.projection();
        let mut wire = TraceWire::new(initial.clone(), 128, &mut meter)?;
        if legacy {
            wire.shell = runtime_trace::MeteredShell::Legacy(initial);
        }
        machine.wire = Some(wire);
        machine.meter = Some(&mut meter);
        Ok::<_, Diagnostic>(machine.run())
    })();
    let mut observed = Observed {
        execution: None,
        trace: None,
        bytes: None,
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
            let mut encode = Meter::new();
            encode.set_clock(1000, Box::new(|| 0));
            let mut assembly = Assembly::new(crate::budget::Limits::default().result_bytes);
            wire.write(&mut assembly, &mut encode).unwrap();
            let bytes = assembly.finish();
            assert_eq!(bytes.len(), wire.encoded_len());
            assert_eq!(serde_json::from_slice::<Trace>(&bytes).unwrap(), wire.trace);
            observed.execution = Some(execution);
            observed.trace = Some(wire.trace);
            observed.bytes = Some(bytes);
            observed.peak = peak;
        }
    }
    observed
}

#[test]
fn typed_shell_atomic_execution_matches_frozen_projection_delta_and_failure_order() {
    use crate::budget::{FINALIZATION_RESERVE, Limits};
    use crate::semantic::analyze;
    use crate::trace::{Direction, apply_step, validate_trace};

    let sources = [
        "int main(){int x=2;x=x+1;printf(\"%d\\n\",x);return 0;}",
        "int main(){int x=0;for(int i=0;i<130;i=i+1){x=x+1;}printf(\"%d\\n\",x);return 0;}",
        "int main(){int a[30]={3,2,1};for(int i=0;i<30;i=i+1){a[i]=i;}printf(\"%d\\n\",a[29]);return 0;}",
        "int main(){int x=0;if(0&&(1/0)){x=1;}if(1||(1/0)){x=x+2;}return x;}",
        "int main(){int x=0;for(int i=0;i<4;i=i+1){if(i==1){continue;}for(int j=0;j<3;j=j+1){if(j==2){break;}x=x+1;}}return x;}",
        "int main(){int x=2147483647;x=x+1;return 0;}",
        "int main(){int x;printf(\"%d\\n\",x);return 0;}",
    ];
    for source in sources {
        let checked = analyze(source).unwrap();
        let compare = |limits, controls| {
            let expected = observed(&checked, true, limits, controls);
            let actual = observed(&checked, false, limits, controls);
            assert_eq!(actual, expected, "{source}");
            if let Some(trace) = &actual.trace {
                validate_trace(trace, &checked.parsed.program.node_map()).unwrap();
                let mut state = trace.initial_state.clone();
                for step in &trace.steps {
                    apply_step(&mut state, step, Direction::Forward).unwrap();
                }
                for step in trace.steps.iter().rev() {
                    apply_step(&mut state, step, Direction::Backward).unwrap();
                }
                assert_eq!(state, trace.initial_state);
            }
            actual
        };
        let normal = compare(Limits::default(), Controls::default());
        let fuel = normal.fuel;
        for limit in [
            0,
            FINALIZATION_RESERVE,
            FINALIZATION_RESERVE + 1,
            fuel.saturating_sub(1) + FINALIZATION_RESERVE,
            fuel + FINALIZATION_RESERVE,
        ] {
            compare(
                Limits {
                    fuel: limit,
                    ..Limits::default()
                },
                Controls::default(),
            );
        }
        for steps in [0, 1, 127, 128, 129] {
            compare(
                Limits {
                    steps,
                    ..Limits::default()
                },
                Controls::default(),
            );
        }
        for result_bytes in [0, 128, 1024, 4096, 16384] {
            compare(
                Limits {
                    result_bytes,
                    ..Limits::default()
                },
                Controls::default(),
            );
        }
        for at in [1, 2, 3, 8, 32, 128] {
            compare(
                Limits::default(),
                Controls {
                    cancel_at: Some(at),
                    deadline_at: None,
                },
            );
            compare(
                Limits::default(),
                Controls {
                    cancel_at: None,
                    deadline_at: Some(at + 1),
                },
            );
            compare(
                Limits::default(),
                Controls {
                    cancel_at: Some(at),
                    deadline_at: Some(at + 1),
                },
            );
        }
    }
}
