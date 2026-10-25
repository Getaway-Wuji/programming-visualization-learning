//! Internal P0-C int/array execution over the existing checked AST.
//!
//! Optional STEP-01 recording shares this one evaluator. Production integration
//! must use `run` and its shared meter; standalone execute helpers are trusted
//! low-level checks. `work_used` is not the full run's stats.fuelUsed.
//! No native program, host stdout, persistence or external library is invoked.

use crate::ast::{Expression, Initializer, NodeData, NodeId, NodeMapEntry};
use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, DiagnosticCode};
use crate::diagnostic::{Location, Stage};
use crate::format::FormatPart;
use crate::integer::{self, IntError};
use crate::runtime_state::RuntimeState;
use crate::runtime_trace::{self, Meta};
use crate::semantic::CheckedProgram;
use crate::source::ByteRange;
use crate::trace::Step;
use crate::trace::{RecordError, Recorder, Trace};
use crate::trace_wire::{self, TraceWire};
use serde_json::{Value, json};
use std::ops::{Deref, DerefMut};
use std::sync::Arc;

pub const MAX_EXECUTION_WORK: usize = 1_000_000;
pub const MAX_OUTPUT_BYTES: usize = 16_384;
pub const MAX_LIVE_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Execution {
    pub state: RuntimeState,
    pub outcome: ExecutionOutcome,
    /// Basic runtime-only work, not the full run's stats.fuelUsed.
    pub work_used: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TracedExecution {
    pub execution: Execution,
    pub trace: Trace,
    pub node_map: Vec<NodeMapEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionOutcome {
    Completed { exit_code: i32 },
    ProgramError { diagnostic: Diagnostic },
    ResourceLimit { diagnostic: Diagnostic },
}

/// Execute a fresh state from the exact `semantic::analyze` result.
///
/// `CheckedProgram` is an internal trusted representation, not an import or
/// deserialization boundary. Callers must not construct or mutate its arena,
/// bindings or compiled formats. Only reached declarations allocate objects;
/// capacity bounds are checked before each actual array allocation.
pub fn execute(checked: &CheckedProgram) -> Execution {
    Machine::new(checked, false).run().0
}

pub fn execute_traced(checked: &CheckedProgram) -> TracedExecution {
    let (execution, trace, _, _) = Machine::new(checked, true).run();
    TracedExecution {
        execution,
        trace: trace.expect("recording requested"),
        node_map: checked.parsed.program.node_map(),
    }
}

pub(crate) fn execute_metered<'a>(
    checked: &'a CheckedProgram,
    meter: &'a mut Meter,
    overhead: usize,
) -> Result<(Execution, TraceWire, usize), Diagnostic> {
    meter
        .charge(
            checked.parsed.program.nodes.len() * 3
                + checked.references.len()
                + checked.outputs.len(),
        )
        .map_err(|e| {
            e.diagnostic(
                Stage::Execute,
                Location::Synthetic {
                    reason: "pre-execution",
                },
            )
        })?;
    let mut machine = Machine::new(checked, true);
    machine.wire = Some(TraceWire::new(machine.projection(), overhead, meter)?);
    machine.meter = Some(meter);
    let (execution, _, wire, peak) = machine.run();
    Ok((execution, wire.expect("metered wire"), peak))
}

#[derive(Clone, Copy)]
enum Target {
    Scalar(NodeId),
    Cell { declaration: NodeId, index: usize },
}

#[derive(Debug, Clone, Copy)]
enum Work {
    Visit(NodeId),
    BlockNext {
        node: NodeId,
        index: usize,
    },
    LeaveScope(NodeId),
    Initialize(NodeId),
    Init {
        node: NodeId,
        child: NodeId,
    },
    Update {
        node: NodeId,
        child: NodeId,
        iteration: u64,
    },
    WhileCheck {
        node: NodeId,
        iteration: u64,
    },
    ForCheck {
        node: NodeId,
        iteration: u64,
    },
    LoopMarker {
        node: NodeId,
        iteration: u64,
        break_len: usize,
        continue_len: usize,
        break_scopes: usize,
        continue_scopes: usize,
    },
}

// A before-image only needs to own the old state if an action actually writes.
// Keep this private: published Execution and RuntimeState retain their shape.
// All existing metering and commit/rollback sites remain in atomic unchanged.
struct StateSnapshot {
    value: Arc<RuntimeState>,
    #[cfg(test)]
    legacy_eager: bool,
}

impl StateSnapshot {
    fn new(value: RuntimeState) -> Self {
        Self {
            value: Arc::new(value),
            #[cfg(test)]
            legacy_eager: false,
        }
    }

    fn into_inner(self) -> RuntimeState {
        Arc::unwrap_or_clone(self.value)
    }
}

impl Clone for StateSnapshot {
    fn clone(&self) -> Self {
        #[cfg(test)]
        if self.legacy_eager {
            // Frozen oracle: each original atomic before-image eagerly used
            // RuntimeState::clone at precisely this call site.
            return Self {
                value: Arc::new((*self.value).clone()),
                legacy_eager: true,
            };
        }
        Self {
            value: Arc::clone(&self.value),
            #[cfg(test)]
            legacy_eager: false,
        }
    }
}

impl Deref for StateSnapshot {
    type Target = RuntimeState;

    fn deref(&self) -> &Self::Target {
        &self.value
    }
}

impl DerefMut for StateSnapshot {
    fn deref_mut(&mut self) -> &mut Self::Target {
        Arc::make_mut(&mut self.value)
    }
}

struct Machine<'a> {
    checked: &'a CheckedProgram,
    state: StateSnapshot,
    references: Vec<Option<NodeId>>,
    formats: Vec<Option<usize>>,
    pending: Vec<Work>,
    work_used: usize,
    returned: Option<i32>,
    meta: Meta,
    recorder: Option<Recorder>,
    meter: Option<&'a mut Meter>,
    wire: Option<TraceWire>,
    peak: usize,
    flow_positions: Vec<usize>,
    flow_touched: Vec<NodeId>,
    #[cfg(test)]
    legacy_shell: bool,
}

impl<'a> Machine<'a> {
    fn new(checked: &'a CheckedProgram, recording: bool) -> Self {
        let mut references = vec![None; checked.parsed.program.nodes.len()];
        for reference in &checked.references {
            references[reference.expression_node] = Some(reference.declaration_node);
        }
        let mut formats = vec![None; references.len()];
        for (index, output) in checked.outputs.iter().enumerate() {
            formats[output.output_node] = Some(index);
        }
        let mut machine = Self {
            checked,
            state: StateSnapshot::new(RuntimeState::default()),
            references,
            formats,
            pending: vec![Work::Visit(checked.parsed.program.root)],
            work_used: 0,
            returned: None,
            meta: Meta::default(),
            recorder: None,
            meter: None,
            wire: None,
            peak: 0,
            flow_positions: vec![usize::MAX; checked.parsed.program.nodes.len()],
            flow_touched: Vec::new(),
            #[cfg(test)]
            legacy_shell: false,
        };
        if recording {
            machine.recorder = Some(Recorder::new(machine.projection()));
        }
        machine
    }

    fn run(mut self) -> (Execution, Option<Trace>, Option<TraceWire>, usize) {
        let result = self.run_pending();
        let outcome = match result {
            Ok(()) => ExecutionOutcome::Completed {
                exit_code: self.returned.unwrap_or(0),
            },
            Err(diagnostic)
                if matches!(
                    diagnostic.code,
                    DiagnosticCode::FuelLimit
                        | DiagnosticCode::OutputLimit
                        | DiagnosticCode::MemoryLimit
                        | DiagnosticCode::StepLimit
                        | DiagnosticCode::ResultLimit
                        | DiagnosticCode::Deadline
                ) =>
            {
                ExecutionOutcome::ResourceLimit { diagnostic }
            }
            Err(diagnostic) => ExecutionOutcome::ProgramError { diagnostic },
        };
        let complete = matches!(outcome, ExecutionOutcome::Completed { .. });
        if let Some(wire) = self.wire.as_mut() {
            wire.trace.completeness = if complete { "complete" } else { "prefix" }.into();
        }
        let trace = self
            .recorder
            .take()
            .map(|recorder| recorder.finish(complete));
        (
            Execution {
                state: self.state.into_inner(),
                outcome,
                work_used: self.work_used,
            },
            trace,
            self.wire,
            self.peak,
        )
    }

    fn run_pending(&mut self) -> Result<(), Diagnostic> {
        self.normalize();
        while let Some(work) = self.pending.pop() {
            match work {
                Work::Visit(id) => self.visit(id)?,
                Work::BlockNext { .. } => unreachable!("normalized block cursor"),
                Work::LeaveScope(id) => {
                    if self.state.scopes.len() == 1 {
                        let location = json!({"kind":"synthetic","reason":"implicit-return","anchorNodeId":runtime_trace::node(id)});
                        self.atomic(id, "program.return", location, |machine| {
                            machine.exit_to(0, id)?;
                            machine.returned = Some(0);
                            machine.pending.clear();
                            machine.meta.phase = "returned";
                            machine.meta.return_value = Some(0);
                            Ok(())
                        })?;
                    } else {
                        self.atomic(
                            id,
                            "scope.exit",
                            runtime_trace::source(id, "end"),
                            |machine| machine.exit_to(machine.state.scopes.len() - 1, id),
                        )?;
                    }
                }
                Work::Initialize(id) => self.initialize(id)?,
                Work::Init { child, .. } | Work::Update { child, .. } => self.visit(child)?,
                Work::WhileCheck { node, iteration } => self.while_check(node, iteration)?,
                Work::ForCheck { node, iteration } => self.for_check(node, iteration)?,
                Work::LoopMarker { .. } => {}
            }
            self.normalize();
        }
        Ok(())
    }

    fn visit(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        self.charge(id, 1)?;
        // Copy the shared reference, rather than cloning potentially wide AST
        // blocks/formats on every loop iteration. The scheduler holds one
        // statement cursor per block, so its space is bounded by syntax depth.
        let checked = self.checked;
        match &checked.parsed.program.nodes[id].data {
            NodeData::Function { body } => self.atomic(
                id,
                "program.enter",
                runtime_trace::source(id, "whole"),
                |machine| {
                    machine.charge(*body, 1)?;
                    machine.state.enter_scope(*body);
                    machine.meta.phase = "running";
                    machine.pending.push(Work::LeaveScope(*body));
                    machine.pending.push(Work::BlockNext {
                        node: *body,
                        index: 0,
                    });
                    Ok(())
                },
            )?,
            NodeData::Block { .. } => self.atomic(
                id,
                "scope.enter",
                runtime_trace::source(id, "start"),
                |machine| {
                    machine.state.enter_scope(id);
                    machine.pending.push(Work::LeaveScope(id));
                    machine.pending.push(Work::BlockNext { node: id, index: 0 });
                    Ok(())
                },
            )?,
            NodeData::Declaration {
                name,
                array_length,
                initializer,
                ..
            } => self.atomic(
                id,
                "object.declare",
                runtime_trace::source(id, "whole"),
                |machine| {
                    // Declaration is committed independently of initialization.
                    // A self initializer must read the new, still unset object.
                    machine.charge(id, 1)?;
                    let length = array_length.map_or(1, |length| length as u64);
                    machine.check_allocation(id, length)?;
                    if array_length.is_some() {
                        machine
                            .state
                            .declare_array(id, name.clone(), length as usize);
                    } else {
                        machine.state.declare(id, name.clone());
                    }
                    if !matches!(initializer, Initializer::None) {
                        machine.pending.push(Work::Initialize(id));
                    }
                    Ok(())
                },
            )?,
            NodeData::Assignment { target, value } => self.atomic(
                id,
                "value.write",
                runtime_trace::source(id, "whole"),
                |machine| {
                    let target = machine.target(*target)?;
                    let value = machine.eval(*value)?;
                    machine.charge(id, 1)?;
                    match target {
                        Target::Scalar(declaration) => {
                            if machine.meter.is_some() {
                                machine.charge(id, machine.meta.scalar_copy_weight())?;
                            }
                            machine.state.write(declaration, value);
                            if machine.recording() {
                                machine
                                    .meta
                                    .scalar_write(machine.state.variables[&declaration].id);
                            }
                        }
                        Target::Cell { declaration, index } => {
                            if machine.meter.is_some() {
                                machine.charge(
                                    id,
                                    machine.state.arrays[&declaration].cells.len()
                                        + machine.meta.array_copy_weight(),
                                )?;
                            }
                            let before = machine.state.read_array(declaration, index);
                            let object = machine.state.arrays[&declaration].id;
                            machine.state.write_array(declaration, index, value);
                            if machine.recording() {
                                machine.meta.array_write(
                                    id,
                                    object,
                                    index,
                                    before,
                                    value,
                                    machine.trace_len() + 1,
                                );
                            }
                        }
                    }
                    Ok(())
                },
            )?,
            NodeData::If {
                condition,
                then_block,
                else_block,
            } => self.atomic(
                *condition,
                "condition",
                runtime_trace::source(*condition, "whole"),
                |machine| {
                    if machine.condition(*condition)? {
                        machine.pending.push(Work::Visit(*then_block));
                    } else if let Some(block) = else_block {
                        machine.pending.push(Work::Visit(*block));
                    }
                    Ok(())
                },
            )?,
            NodeData::While { .. } => self.pending.push(Work::WhileCheck {
                node: id,
                iteration: 0,
            }),
            NodeData::For { init, .. } => self.atomic(
                id,
                "scope.enter",
                runtime_trace::source(id, "start"),
                |machine| {
                    machine.state.enter_scope(id);
                    machine.meta.iterations.insert(id, 0);
                    machine.pending.push(Work::LeaveScope(id));
                    machine.pending.push(Work::ForCheck {
                        node: id,
                        iteration: 0,
                    });
                    if let Some(init) = init {
                        machine.pending.push(Work::Init {
                            node: id,
                            child: *init,
                        });
                    }
                    Ok(())
                },
            )?,
            NodeData::Output { arguments, .. } => self.atomic(
                id,
                "output.append",
                runtime_trace::source(id, "whole"),
                |machine| machine.output(id, arguments),
            )?,
            NodeData::Return { value } => self.atomic(
                id,
                "program.return",
                runtime_trace::source(id, "whole"),
                |machine| {
                    let value = machine.eval(*value)?;
                    machine.exit_to(0, id)?;
                    machine.returned = Some(value);
                    machine.meta.phase = "returned";
                    machine.meta.return_value = Some(value);
                    machine.pending.clear();
                    Ok(())
                },
            )?,
            NodeData::Break => self.atomic(
                id,
                "control.jump",
                runtime_trace::source(id, "whole"),
                |machine| machine.jump(id, false),
            )?,
            NodeData::Continue => self.atomic(
                id,
                "control.jump",
                runtime_trace::source(id, "whole"),
                |machine| machine.jump(id, true),
            )?,
            NodeData::Empty => {
                self.atomic(id, "nop", runtime_trace::source(id, "whole"), |_| Ok(()))?
            }
            NodeData::Condition { .. } | NodeData::Expr(_) => {
                unreachable!("expressions are evaluated by their owning action")
            }
        }
        Ok(())
    }

    fn initialize(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let checked = self.checked;
        let NodeData::Declaration { initializer, .. } = &checked.parsed.program.nodes[id].data
        else {
            unreachable!("checked declaration initializer")
        };
        self.atomic(
            id,
            "value.initialize",
            runtime_trace::source(id, "whole"),
            |machine| {
                match initializer {
                    Initializer::Scalar(expression) => {
                        let value = machine.eval(*expression)?;
                        machine.charge(id, 1)?;
                        if machine.meter.is_some() {
                            machine.charge(id, machine.meta.scalar_copy_weight())?;
                        }
                        machine.state.write(id, value);
                        if machine.recording() {
                            machine.meta.scalar_write(machine.state.variables[&id].id);
                        }
                    }
                    Initializer::Array(expressions) => {
                        let mut values = Vec::with_capacity(expressions.len());
                        for &expression in expressions {
                            values.push(machine.eval(expression)?);
                        }
                        let length = machine.state.arrays[&id].length;
                        machine.charge(id, length)?;
                        machine.state.initialize_array(id, values);
                        if machine.recording() {
                            machine.meta.array_writes += length as u64;
                        }
                    }
                    Initializer::None => {
                        unreachable!("no initializer task for absent initialization")
                    }
                }
                Ok(())
            },
        )
    }

    fn while_check(&mut self, id: NodeId, iteration: u64) -> Result<(), Diagnostic> {
        let NodeData::While { condition, body } = self.checked.parsed.program.nodes[id].data else {
            unreachable!("while task references its loop")
        };
        self.atomic(
            condition,
            "condition",
            runtime_trace::source(condition, "whole"),
            |machine| {
                if machine.condition(condition)? {
                    let break_len = machine.pending.len();
                    machine.pending.push(Work::WhileCheck {
                        node: id,
                        iteration: iteration + 1,
                    });
                    let continue_len = machine.pending.len();
                    let scopes = machine.state.scopes.len();
                    machine.pending.push(Work::LoopMarker {
                        node: id,
                        iteration: iteration + 1,
                        break_len,
                        continue_len,
                        break_scopes: scopes,
                        continue_scopes: scopes,
                    });
                    machine.pending.push(Work::Visit(body));
                }
                Ok(())
            },
        )
    }

    fn for_check(&mut self, id: NodeId, iteration: u64) -> Result<(), Diagnostic> {
        let NodeData::For {
            condition,
            update,
            body,
            ..
        } = self.checked.parsed.program.nodes[id].data
        else {
            unreachable!("for task references its loop")
        };
        let anchor = condition.unwrap_or(id);
        self.atomic(
            anchor,
            "condition",
            runtime_trace::source(anchor, "whole"),
            |machine| {
                machine.meta.iterations.insert(id, iteration);
                let take_body = match condition {
                    Some(condition) => machine.condition(condition)?,
                    None => {
                        machine.charge(id, 1)?;
                        if machine.recording() {
                            machine.meta.decision(id, 1);
                        }
                        true
                    }
                };
                if take_body {
                    // A break also removes the pending for-scope exit; the jump
                    // destroys that scope together with any active body scopes.
                    let break_len = machine.pending.len() - 1;
                    machine.pending.push(Work::ForCheck {
                        node: id,
                        iteration: iteration + 1,
                    });
                    if let Some(update) = update {
                        machine.pending.push(Work::Update {
                            node: id,
                            child: update,
                            iteration: iteration + 1,
                        });
                    }
                    let continue_len = machine.pending.len();
                    let scopes = machine.state.scopes.len();
                    machine.pending.push(Work::LoopMarker {
                        node: id,
                        iteration: iteration + 1,
                        break_len,
                        continue_len,
                        break_scopes: scopes - 1,
                        continue_scopes: scopes,
                    });
                    machine.pending.push(Work::Visit(body));
                }
                Ok(())
            },
        )
    }

    fn jump(&mut self, id: NodeId, is_continue: bool) -> Result<(), Diagnostic> {
        let marker = self
            .pending
            .iter()
            .rev()
            .find_map(|work| match *work {
                Work::LoopMarker {
                    break_len,
                    continue_len,
                    break_scopes,
                    continue_scopes,
                    ..
                } => Some((break_len, continue_len, break_scopes, continue_scopes)),
                _ => None,
            })
            .expect("semantic checking requires a containing loop");
        let (length, scopes) = if is_continue {
            (marker.1, marker.3)
        } else {
            (marker.0, marker.2)
        };
        self.exit_to(scopes, id)?;
        self.pending.truncate(length);
        Ok(())
    }

    fn exit_to(&mut self, depth: usize, id: NodeId) -> Result<(), Diagnostic> {
        // Precharge the entire destruction before changing any scope/object.
        // A failed jump/return must not destroy half of its scopes.
        let work = self.state.scopes[depth..]
            .iter()
            .map(|scope| 1 + scope.declaration_nodes.len())
            .sum();
        self.charge(id, work)?;
        while self.state.scopes.len() > depth {
            self.state.leave_scope();
        }
        Ok(())
    }

    fn condition(&mut self, id: NodeId) -> Result<bool, Diagnostic> {
        let NodeData::Condition { expression } = self.checked.parsed.program.nodes[id].data else {
            unreachable!("checked control condition")
        };
        let value = self.eval(expression)?;
        self.charge(id, 1)?;
        if self.recording() {
            self.meta.decision(id, value);
        }
        Ok(integer::truth(value))
    }

    fn recording(&self) -> bool {
        self.recorder.is_some()
    }

    fn trace_len(&self) -> usize {
        self.wire.as_ref().map_or_else(
            || self.recorder.as_ref().map_or(0, Recorder::len),
            |wire| wire.trace.steps.len(),
        )
    }

    fn normalize(&mut self) {
        loop {
            match self.pending.last().copied() {
                Some(Work::BlockNext { node, index }) => {
                    self.pending.pop();
                    let NodeData::Block { statements } =
                        &self.checked.parsed.program.nodes[node].data
                    else {
                        unreachable!("block cursor")
                    };
                    if let Some(&id) = statements.get(index) {
                        self.pending.push(Work::BlockNext {
                            node,
                            index: index + 1,
                        });
                        self.pending.push(Work::Visit(id));
                    }
                }
                Some(Work::LoopMarker { .. }) => {
                    self.pending.pop();
                }
                _ => break,
            }
        }
    }

    fn next_node(&self) -> Option<NodeId> {
        self.pending.last().map(|work| match *work {
            Work::Visit(id) => match self.checked.parsed.program.nodes[id].data {
                NodeData::If { condition, .. } | NodeData::While { condition, .. } => condition,
                _ => id,
            },
            Work::Initialize(id) | Work::LeaveScope(id) => id,
            Work::Init { child, .. } | Work::Update { child, .. } => child,
            Work::WhileCheck { node, .. } => match self.checked.parsed.program.nodes[node].data {
                NodeData::While { condition, .. } => condition,
                _ => unreachable!(),
            },
            Work::ForCheck { node, .. } => match self.checked.parsed.program.nodes[node].data {
                NodeData::For { condition, .. } => condition.unwrap_or(node),
                _ => unreachable!(),
            },
            _ => unreachable!("only atomic tasks at the normalized cursor"),
        })
    }

    fn projection(&self) -> Value {
        self.project(false)
    }

    fn project(&self, shell: bool) -> Value {
        let mut flow: Vec<(NodeId, &str, u64)> = Vec::new();
        for work in &self.pending {
            let item = match *work {
                Work::LeaveScope(id) | Work::BlockNext { node: id, .. }
                    if self.state.scopes.iter().any(|scope| scope.node_id == id) =>
                {
                    Some((
                        id,
                        if matches!(
                            self.checked.parsed.program.nodes[id].data,
                            NodeData::For { .. }
                        ) {
                            "condition"
                        } else {
                            "block"
                        },
                        *self.meta.iterations.get(&id).unwrap_or(&0),
                    ))
                }
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
                Work::Initialize(id) => self.state.scopes.iter().find_map(|scope| {
                    match self.checked.parsed.program.nodes[scope.node_id].data {
                        NodeData::For {
                            init: Some(init), ..
                        } if init == id => Some((scope.node_id, "init", 0)),
                        _ => None,
                    }
                }),
                _ => None,
            };
            if let Some((id, stage, iteration)) = item {
                if let Some(entry) = flow.iter_mut().find(|entry| entry.0 == id) {
                    if stage != "block" {
                        *entry = (id, stage, iteration);
                    }
                } else {
                    flow.push((id, stage, iteration));
                }
            }
        }
        let flow=flow.into_iter().map(|(id,stage,iteration)|json!({"nodeId":runtime_trace::node(id),"stage":stage,"iteration":iteration})).collect();
        let projector = if shell {
            runtime_trace::shell
        } else {
            runtime_trace::project
        };
        projector(
            &self.state,
            self.checked,
            &self.meta,
            self.next_node(),
            flow,
        )
    }

    fn atomic<F>(
        &mut self,
        id: NodeId,
        kind: &str,
        location: Value,
        action: F,
    ) -> Result<(), Diagnostic>
    where
        F: FnOnce(&mut Self) -> Result<(), Diagnostic>,
    {
        if self.meter.is_some() {
            return self.atomic_metered(id, kind, location, action);
        }
        if !self.recording() {
            return action(self);
        }
        let cursor = self.recorder.as_ref().unwrap().len();
        if cursor >= 20_000 {
            return Err(Diagnostic::execution_limit(
                DiagnosticCode::StepLimit,
                self.range(id),
                "steps",
                20_000,
                cursor,
                cursor + 1,
            ));
        }
        // Bound the temporary snapshots and projection scans too. This basic
        // charge is not the complete cross-phase/encoding run meter of 06.4.
        self.charge(id, runtime_trace::weight(&self.state) + self.pending.len())?;
        let before = self.state.clone();
        let pending = self.pending.clone();
        let meta = self.meta.clone();
        let returned = self.returned;
        self.meta.observations.clear();
        self.meta.last_origin = None;
        self.meta.write_target = None;
        let result = (|| {
            action(self)?;
            self.normalize();
            self.charge(
                id,
                runtime_trace::weight(&self.state)
                    + self.pending.len()
                    + self.meta.observations.len(),
            )?;
            self.meta.retain_live(&self.state);
            let after = self.projection();
            let observations = std::mem::take(&mut self.meta.observations);
            let write = self.meta.write_target.take();
            match self.recorder.as_mut().unwrap().commit_with_write(
                kind,
                location,
                after,
                observations,
                write,
            ) {
                Ok(()) => Ok(()),
                Err(RecordError::StepLimit) => Err(Diagnostic::execution_limit(
                    DiagnosticCode::StepLimit,
                    self.range(id),
                    "steps",
                    20_000,
                    cursor,
                    cursor + 1,
                )),
                Err(RecordError::ResultLimit { used, attempted }) => {
                    Err(Diagnostic::execution_limit(
                        DiagnosticCode::ResultLimit,
                        self.range(id),
                        "resultBytes",
                        16_777_216 - 65_536,
                        used,
                        attempted,
                    ))
                }
                Err(RecordError::Invalid) => panic!("runtime generated an invalid STEP transition"),
            }
        })();
        if result.is_err() {
            self.state = before;
            self.pending = pending;
            self.meta = meta;
            self.returned = returned;
        }
        result
    }

    fn atomic_metered<F>(
        &mut self,
        id: NodeId,
        kind: &str,
        location: Value,
        action: F,
    ) -> Result<(), Diagnostic>
    where
        F: FnOnce(&mut Self) -> Result<(), Diagnostic>,
    {
        let cursor = self.trace_len();
        let limit = self.meter.as_ref().unwrap().limits().steps;
        if cursor >= limit {
            return Err(Diagnostic::execution_limit(
                DiagnosticCode::StepLimit,
                self.range(id),
                "steps",
                limit,
                cursor,
                cursor + 1,
            ));
        }
        // COW arrays and provenance avoid copying every unchanged element on
        // unrelated scalar/control actions. Cloned active records are charged.
        let name_bytes = self
            .state
            .variables
            .values()
            .map(|v| v.name.len())
            .sum::<usize>()
            + self
                .state
                .arrays
                .values()
                .map(|v| v.name.len())
                .sum::<usize>();
        self.charge(
            id,
            self.state.scopes.len()
                + 2 * (self.state.variables.len() + self.state.arrays.len())
                + self.pending.len()
                + self.meta.iterations.len()
                + (self.state.output.len() + name_bytes).div_ceil(64),
        )?;
        let before = self.state.clone();
        let pending = self.pending.clone();
        let meta = self.meta.clone();
        let returned = self.returned;
        self.meta.observations.clear();
        self.meta.last_origin = None;
        self.meta.write_target = None;
        let result = (|| {
            action(self)?;
            self.normalize();
            self.peak = self.peak.max(self.state.live_bytes);
            self.charge(id, self.meta.observations.len())?;
            if self.state.scopes.len() < before.scopes.len() {
                self.charge(id, self.meta.metadata_weight())?;
                self.meta.retain_live(&self.state);
            }
            let shell = self.metered_projection(id)?;
            let write = self.meta.write_target.take();
            let observations = std::mem::take(&mut self.meta.observations);
            let meter = self.meter.as_deref_mut().unwrap();
            let changes = trace_wire::delta(
                &before,
                &self.state,
                &self.wire.as_ref().unwrap().shell,
                &shell,
                write,
                meter,
            )?;
            let point = if (cursor + 1).is_multiple_of(128) {
                self.charge(
                    id,
                    runtime_trace::weight(&self.state) + name_bytes.div_ceil(64),
                )?;
                Some(runtime_trace::project(
                    &self.state,
                    self.checked,
                    &self.meta,
                    self.next_node(),
                    shell.flow_values(),
                ))
            } else {
                None
            };
            self.wire.as_mut().unwrap().admit(
                Step {
                    seq: cursor + 1,
                    kind: kind.into(),
                    location,
                    changes,
                    observations,
                },
                point,
                shell,
                self.meter.as_deref_mut().unwrap(),
            )
        })();
        if result.is_err() {
            self.state = before;
            self.pending = pending;
            self.meta = meta;
            self.returned = returned;
        }
        result
    }

    fn metered_projection(
        &mut self,
        id: NodeId,
    ) -> Result<runtime_trace::MeteredShell, Diagnostic> {
        #[cfg(test)]
        if self.legacy_shell {
            return self
                .legacy_metered_projection(id)
                .map(runtime_trace::MeteredShell::Legacy);
        }
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
        let mut flow: Vec<(NodeId, &'static str, u64)> = Vec::new();
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
        let flow = flow
            .into_iter()
            .map(|(node, stage, iteration)| runtime_trace::FlowEntry {
                node,
                stage: stage.into(),
                iteration,
            })
            .collect();
        Ok(runtime_trace::metered_shell(
            &self.state,
            self.checked,
            &self.meta,
            self.next_node(),
            flow,
        ))
    }

    fn eval(&mut self, id: NodeId) -> Result<i32, Diagnostic> {
        // Expression recursion is bounded by the parser's independently
        // validated maximum AST depth of 64, including flat operator chains.
        self.charge(id, 1)?;
        let checked = self.checked;
        let NodeData::Expr(expression) = &checked.parsed.program.nodes[id].data else {
            unreachable!("checked int expression")
        };
        match expression {
            Expression::Integer(value) => {
                self.meta.last_origin = None;
                Ok(*value)
            }
            Expression::Name(_) => {
                self.charge(id, 1)?;
                let declaration = self.references[id].expect("checked name binding");
                let value = self
                    .state
                    .read(declaration)
                    .ok_or_else(|| self.error(id, DiagnosticCode::Uninitialized))?;
                if self.recording() {
                    self.meta
                        .read_scalar(id, self.state.variables[&declaration].id, value);
                }
                Ok(value)
            }
            Expression::Unary { op, operand } => {
                let value = self.eval(*operand)?;
                self.charge(id, 1)?;
                let result =
                    integer::unary(*op, value).map_err(|error| self.int_error(id, error))?;
                if self.recording() {
                    self.meta.unary(id, *op, value, result);
                }
                Ok(result)
            }
            Expression::Binary { op, left, right } => {
                let left = self.eval(*left)?;
                if let Some(value) = integer::short_circuit(*op, left) {
                    self.charge(id, 1)?;
                    if self.recording() {
                        self.meta.binary(id, *op, left, None, value, *right);
                    }
                    return Ok(value);
                }
                let right_id = *right;
                let right = self.eval(*right)?;
                self.charge(id, 1)?;
                let result =
                    integer::binary(*op, left, right).map_err(|error| self.int_error(id, error))?;
                if self.recording() {
                    self.meta
                        .binary(id, *op, left, Some(right), result, right_id);
                }
                Ok(result)
            }
            Expression::Index { .. } => {
                let Target::Cell { declaration, index } = self.target(id)? else {
                    unreachable!("index expression has a checked array lvalue")
                };
                self.charge(id, 1)?;
                let value = self
                    .state
                    .read_array(declaration, index)
                    .ok_or_else(|| self.error(id, DiagnosticCode::Uninitialized))?;
                if self.recording() {
                    self.meta
                        .read_array(id, self.state.arrays[&declaration].id, index, value);
                }
                Ok(value)
            }
        }
    }

    fn target(&mut self, id: NodeId) -> Result<Target, Diagnostic> {
        match self.checked.parsed.program.nodes[id].data {
            NodeData::Expr(Expression::Name(_)) => Ok(Target::Scalar(
                self.references[id].expect("checked scalar binding"),
            )),
            NodeData::Expr(Expression::Index { array, index }) => {
                let declaration = self.references[array].expect("checked array binding");
                let value = self.eval(index)?;
                self.charge(id, 1)?;
                let length = self.state.arrays[&declaration].length;
                if value < 0 || value as u64 >= length as u64 {
                    return Err(self.error(id, DiagnosticCode::IndexBounds));
                }
                Ok(Target::Cell {
                    declaration,
                    index: value as usize,
                })
            }
            _ => unreachable!("checked assignment target"),
        }
    }

    fn check_allocation(&self, id: NodeId, length: u64) -> Result<(), Diagnostic> {
        // The maximum C length is int32, so u64 multiply/add is exact on both
        // native and wasm32. Check before narrowing or creating any object.
        let attempted = self.state.live_bytes as u64 + length * 4;
        let limit = self
            .meter
            .as_ref()
            .map_or(MAX_LIVE_BYTES, |meter| meter.limits().live_bytes);
        if attempted > limit as u64 {
            let mut diagnostic = Diagnostic::execution_limit(
                DiagnosticCode::MemoryLimit,
                self.range(id),
                "liveBytes",
                limit,
                self.state.live_bytes,
                0,
            );
            diagnostic.details.attempted = Some(attempted);
            return Err(diagnostic);
        }
        Ok(())
    }

    fn output(&mut self, id: NodeId, arguments: &[NodeId]) -> Result<(), Diagnostic> {
        let mut values = Vec::with_capacity(arguments.len());
        for &argument in arguments {
            values.push(self.eval(argument)?);
        }
        let checked = self.checked;
        let compiled = &checked.outputs[self.formats[id].expect("checked output format")].format;
        let mut rendered = String::new();
        let mut values = values.into_iter();
        for part in &compiled.parts {
            self.charge(id, 1)?;
            match part {
                FormatPart::Text(text) => {
                    if self.meter.is_some() {
                        self.charge(id, text.len().div_ceil(64))?;
                    }
                    rendered.push_str(text)
                }
                FormatPart::Decimal => {
                    if self.meter.is_some() {
                        self.charge(id, 1)?;
                    }
                    rendered.push_str(&values.next().expect("checked format arity").to_string())
                }
            }
        }
        self.charge(id, rendered.len().div_ceil(64))?;
        let attempted = self.state.output.len() + rendered.len();
        let limit = self
            .meter
            .as_ref()
            .map_or(MAX_OUTPUT_BYTES, |meter| meter.limits().output_bytes);
        if attempted > limit {
            return Err(Diagnostic::execution_limit(
                DiagnosticCode::OutputLimit,
                self.range(id),
                "outputBytes",
                limit,
                self.state.output.len(),
                attempted,
            ));
        }
        // The candidate text is small (bounded by source/arity), and no prefix
        // from this call is visible before all arguments and checks succeed.
        self.state.output.push_str(&rendered);
        Ok(())
    }

    fn charge(&mut self, id: NodeId, amount: usize) -> Result<(), Diagnostic> {
        let range = self.range(id);
        if let Some(meter) = self.meter.as_deref_mut() {
            meter.charge(amount).map_err(|e| {
                e.diagnostic(Stage::Execute, Location::Source { byte_range: range })
            })?;
            self.work_used += amount;
            return Ok(());
        }
        let attempted = self.work_used + amount;
        if attempted > MAX_EXECUTION_WORK {
            return Err(Diagnostic::execution_limit(
                DiagnosticCode::FuelLimit,
                self.range(id),
                "fuel",
                MAX_EXECUTION_WORK,
                self.work_used,
                attempted,
            ));
        }
        self.work_used = attempted;
        Ok(())
    }

    fn range(&self, id: NodeId) -> ByteRange {
        self.checked.parsed.program.nodes[id].byte_range
    }

    fn error(&self, id: NodeId, code: DiagnosticCode) -> Diagnostic {
        Diagnostic::execution(code, self.range(id))
    }

    fn int_error(&self, id: NodeId, error: IntError) -> Diagnostic {
        self.error(
            id,
            match error {
                IntError::DivideByZero => DiagnosticCode::DivZero,
                IntError::Overflow => DiagnosticCode::IntOverflow,
            },
        )
    }
}

#[cfg(test)]
#[path = "runtime_cow_tests.rs"]
mod cow_tests;

#[cfg(test)]
#[path = "runtime_shell_tests.rs"]
mod shell_tests;
