//! Incremental retained canonical fragments for a trusted runtime producer.
//! Import validation remains trace::validate_trace, outside this producer path.

use crate::budget::{Meter, TERMINAL_BYTES, TimingPhase};
use crate::codec::{self, Assembly, CodecError};
use crate::diagnostic::{Diagnostic, Location, Stage};
use crate::runtime_state::{RuntimeArray, RuntimeState, RuntimeVariable};
use crate::runtime_trace::{MeteredShell, ShellRecord, node};
use crate::trace::{Checkpoint, Step, Trace};
use serde_json::{Value, json};

fn encode_point(
    point: &Checkpoint,
    meter: &mut Meter,
    limit: usize,
) -> Result<Vec<u8>, CodecError> {
    let mut out = codec::Encoder::new(meter, limit);
    out.raw(b"{\"cursor\":")?;
    out.value_ref(&json!(point.cursor), 1)?;
    out.raw(b",\"state\":")?;
    out.value_ref(&point.state, 1)?;
    out.raw(b"}")?;
    out.finish()
}
fn encode_step(step: &Step, meter: &mut Meter, limit: usize) -> Result<Vec<u8>, CodecError> {
    let mut out = codec::Encoder::new(meter, limit);
    out.raw(b"{\"changes\":")?;
    out.array_values(&step.changes, 1)?;
    out.raw(b",\"kind\":")?;
    out.string_value(&step.kind)?;
    out.raw(b",\"location\":")?;
    out.value_ref(&step.location, 1)?;
    out.raw(b",\"observations\":")?;
    out.array_values(&step.observations, 1)?;
    out.raw(b",\"seq\":")?;
    out.value_ref(&json!(step.seq), 1)?;
    out.raw(b"}")?;
    out.finish()
}

pub(crate) fn location() -> Location {
    Location::Synthetic {
        reason: "encoding-failure",
    }
}
pub(crate) fn error(error: CodecError) -> Diagnostic {
    error.diagnostic(Stage::Encode, location())
}
fn charge(meter: &mut Meter, n: usize) -> Result<(), Diagnostic> {
    meter
        .charge(n)
        .map_err(|e| e.diagnostic(Stage::Encode, location()))
}

pub(crate) struct TraceWire {
    pub trace: Trace,
    pub shell: MeteredShell,
    initial: Vec<u8>,
    steps: Vec<Vec<u8>>,
    points: Vec<Vec<u8>>,
    payload: usize,
    overhead: usize,
}

impl TraceWire {
    pub fn new(initial: Value, overhead: usize, meter: &mut Meter) -> Result<Self, Diagnostic> {
        meter.measure(TimingPhase::TraceEncodeAdmission, |meter| {
            Self::new_inner(initial, overhead, meter)
        })
    }

    fn new_inner(initial: Value, overhead: usize, meter: &mut Meter) -> Result<Self, Diagnostic> {
        charge(meter, 2)?;
        let limit = meter.limits().result_bytes;
        let initial_bytes = codec::encode(&initial, meter, limit).map_err(error)?;
        let point = Checkpoint {
            cursor: 0,
            state: initial.clone(),
        };
        let point_bytes = encode_point(&point, meter, limit).map_err(error)?;
        let payload = initial_bytes.len() + point_bytes.len();
        let wire = Self {
            trace: Trace {
                dsl_version: "1.0.0".into(),
                completeness: "prefix".into(),
                initial_state: initial.clone(),
                steps: Vec::new(),
                checkpoints: vec![point],
            },
            shell: MeteredShell::initial(&initial),
            initial: initial_bytes,
            steps: Vec::new(),
            points: vec![point_bytes],
            payload,
            overhead,
        };
        wire.reserve(meter, payload)?;
        Ok(wire)
    }
    fn reserve(&self, meter: &mut Meter, payload: usize) -> Result<(), Diagnostic> {
        let size = payload
            .saturating_add(128)
            .saturating_add(self.overhead)
            .saturating_add(TERMINAL_BYTES);
        let limit = meter.limits().result_bytes;
        if size > limit {
            return Err(error(CodecError::Limit {
                limit,
                used: self.payload + self.overhead + 128,
                attempted: size,
            }));
        }
        meter
            .reserve_result(size)
            .map_err(|e| e.diagnostic(Stage::Encode, location()))
    }
    pub fn admit(
        &mut self,
        step: Step,
        point: Option<Value>,
        shell: MeteredShell,
        meter: &mut Meter,
    ) -> Result<(), Diagnostic> {
        meter.measure(TimingPhase::TraceEncodeAdmission, |meter| {
            self.admit_inner(step, point, shell, meter)
        })
    }

    fn admit_inner(
        &mut self,
        step: Step,
        point: Option<Value>,
        shell: MeteredShell,
        meter: &mut Meter,
    ) -> Result<(), Diagnostic> {
        charge(meter, step.changes.len() + step.observations.len() + 1)?;
        let bytes = encode_step(&step, meter, meter.limits().result_bytes).map_err(error)?;
        let checkpoint = point.map(|state| Checkpoint {
            cursor: step.seq,
            state,
        });
        let point_bytes = checkpoint
            .as_ref()
            .map(|point| encode_point(point, meter, meter.limits().result_bytes))
            .transpose()
            .map_err(error)?;
        let payload = self.payload
            + bytes.len()
            + usize::from(!self.steps.is_empty())
            + point_bytes.as_ref().map_or(0, |bytes| bytes.len() + 1);
        self.reserve(meter, payload)?;
        meter
            .check_commit()
            .map_err(|e| e.diagnostic(Stage::Execute, location()))?;
        self.payload = payload;
        self.steps.push(bytes);
        self.trace.steps.push(step);
        if let (Some(point), Some(bytes)) = (checkpoint, point_bytes) {
            self.trace.checkpoints.push(point);
            self.points.push(bytes);
        }
        self.shell = shell;
        Ok(())
    }
    pub fn write(&self, buffer: &mut Assembly, meter: &mut Meter) -> Result<(), CodecError> {
        buffer.append(b"{\"checkpoints\":[", meter)?;
        for (i, point) in self.points.iter().enumerate() {
            if i > 0 {
                buffer.append(b",", meter)?;
            }
            buffer.append(point, meter)?;
        }
        buffer.append(
            if self.trace.completeness == "complete" {
                b"],\"completeness\":\"complete\",\"dslVersion\":\"1.0.0\",\"initialState\":"
            } else {
                b"],\"completeness\":\"prefix\",\"dslVersion\":\"1.0.0\",\"initialState\":"
            },
            meter,
        )?;
        buffer.append(&self.initial, meter)?;
        buffer.append(b",\"steps\":[", meter)?;
        for (i, step) in self.steps.iter().enumerate() {
            if i > 0 {
                buffer.append(b",", meter)?;
            }
            buffer.append(step, meter)?;
        }
        buffer.append(b"]}", meter)
    }
    pub fn encoded_len(&self) -> usize {
        self.payload+b"{\"checkpoints\":[],\"completeness\":\"complete\",\"dslVersion\":\"1.0.0\",\"initialState\":,\"steps\":[]}".len()-if self.trace.completeness=="prefix"{2}else{0}
    }
}

enum Object<'a> {
    Scalar(&'a RuntimeVariable),
    Array(&'a RuntimeArray),
}
impl Object<'_> {
    fn id(&self) -> u64 {
        match self {
            Self::Scalar(v) => v.id,
            Self::Array(v) => v.id,
        }
    }
    fn length(&self) -> usize {
        match self {
            Self::Scalar(_) => 1,
            Self::Array(v) => v.length,
        }
    }
    fn default(&self) -> Option<i32> {
        match self {
            Self::Scalar(_) => None,
            Self::Array(v) => v.default_value,
        }
    }
    fn cells(&self) -> usize {
        match self {
            Self::Scalar(v) => usize::from(v.value.is_some()),
            Self::Array(v) => v.cells.len(),
        }
    }
    fn name_bytes(&self) -> usize {
        match self {
            Self::Scalar(v) => v.name.len(),
            Self::Array(v) => v.name.len(),
        }
    }
    fn value(&self, index: usize) -> Option<i32> {
        match self {
            Self::Scalar(v) => v.value,
            Self::Array(v) => v.cells.get(&index).copied().or(v.default_value),
        }
    }
    fn json(&self) -> Value {
        match self {
            Self::Scalar(v) => object_value([
                ("id", format!("o{}", v.id).into()),
                ("declarationNodeId", node(v.declaration_node).into()),
                ("frameId", "f1".into()),
                ("scopeId", format!("s{}", v.scope_id).into()),
                ("name", v.name.clone().into()),
                ("kind", "int".into()),
                ("length", 1.into()),
                ("baseAddress", v.base_address.into()),
                ("defaultValue", Value::Null),
                (
                    "cells",
                    Value::Array(
                        v.value
                            .map(|value| {
                                vec![object_value([("index", 0.into()), ("value", value.into())])]
                            })
                            .unwrap_or_default(),
                    ),
                ),
            ]),
            Self::Array(v) => object_value([
                ("id", format!("o{}", v.id).into()),
                ("declarationNodeId", node(v.declaration_node).into()),
                ("frameId", "f1".into()),
                ("scopeId", format!("s{}", v.scope_id).into()),
                ("name", v.name.clone().into()),
                ("kind", "int-array".into()),
                ("length", v.length.into()),
                ("baseAddress", v.base_address.into()),
                (
                    "defaultValue",
                    v.default_value.map_or(Value::Null, Value::from),
                ),
                (
                    "cells",
                    Value::Array(
                        v.cells
                            .iter()
                            .map(|(&index, &value)| {
                                object_value([("index", index.into()), ("value", value.into())])
                            })
                            .collect(),
                    ),
                ),
            ]),
        }
    }
}
fn objects(state: &RuntimeState) -> Vec<Object<'_>> {
    let mut objects = Vec::with_capacity(state.variables.len() + state.arrays.len());
    objects.extend(
        state
            .scopes
            .iter()
            .flat_map(|scope| scope.declaration_nodes.iter())
            .map(|id| {
                state
                    .variables
                    .get(id)
                    .map(Object::Scalar)
                    .unwrap_or_else(|| Object::Array(&state.arrays[id]))
            }),
    );
    objects
}

/// Keep the canonical decimal identity comparison without allocating a new
/// formatted ID for every live object inspected by every value-write step.
fn object_id_matches(id: &str, mut object: u64) -> bool {
    let bytes = id.as_bytes();
    if bytes.first() != Some(&b'o') {
        return false;
    }
    let mut at = bytes.len();
    loop {
        if at <= 1 || bytes[at - 1] != b'0' + (object % 10) as u8 {
            return false;
        }
        at -= 1;
        object /= 10;
        if object == 0 {
            return at == 1;
        }
    }
}

/// Existing borrowed state is cloned once; fresh child projections are moved.
fn object_value<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Derive only the records actually touched by the successful atomic action.
/// Active scopes/declarations are already in dynamic allocation order.
pub(crate) fn delta(
    before: &RuntimeState,
    after: &RuntimeState,
    old: &MeteredShell,
    new: &MeteredShell,
    write: Option<(String, usize)>,
    meter: &mut Meter,
) -> Result<Vec<Value>, Diagnostic> {
    #[cfg(test)]
    if let (MeteredShell::Legacy(old), MeteredShell::Legacy(new)) = (old, new) {
        return shell_tests::legacy_delta(before, after, old, new, write, meter);
    }
    charge(
        meter,
        before.scopes.len()
            + after.scopes.len()
            + before.variables.len()
            + before.arrays.len()
            + after.variables.len()
            + after.arrays.len(),
    )?;
    let mut changes = Vec::new();
    let old = old.data();
    let new = new.data();
    stack_changes(&old.frames, &new.frames, "frames", &mut changes, meter)?;
    stack_changes(&old.scopes, &new.scopes, "scopes", &mut changes, meter)?;
    let old_objects = objects(before);
    let new_objects = objects(after);
    let common = old_objects.len().min(new_objects.len());
    for (i, o) in old_objects.iter().enumerate().skip(common).rev() {
        charge(meter, 1 + o.cells() + o.name_bytes().div_ceil(64))?;
        changes.push(object_value([
            ("op", "record".into()),
            ("table", "objects".into()),
            ("id", format!("o{}", o.id()).into()),
            ("index", i.into()),
            ("before", o.json()),
            ("after", Value::Null),
        ]));
    }
    for (i, n) in new_objects.iter().enumerate() {
        charge(meter, 1)?;
        match old_objects.get(i) {
            None => {
                charge(meter, n.cells() + n.name_bytes().div_ceil(64))?;
                changes.push(object_value([
                    ("op", "record".into()),
                    ("table", "objects".into()),
                    ("id", format!("o{}", n.id()).into()),
                    ("index", i.into()),
                    ("before", Value::Null),
                    ("after", n.json()),
                ]));
            }
            Some(o) if o.default() != n.default() => {
                assert_eq!(o.id(), n.id());
                charge(
                    meter,
                    o.cells() + n.cells() + (o.name_bytes() + n.name_bytes()).div_ceil(64),
                )?;
                changes.push(object_value([
                    ("op", "record".into()),
                    ("table", "objects".into()),
                    ("id", format!("o{}", n.id()).into()),
                    ("index", i.into()),
                    ("before", o.json()),
                    ("after", n.json()),
                ]));
            }
            Some(o) => {
                if let Some((id, index)) = &write
                    && object_id_matches(id, n.id())
                {
                    assert!(*index < n.length());
                    changes.push(object_value([
                        ("op", "cell".into()),
                        ("objectId", id.clone().into()),
                        ("index", (*index).into()),
                        ("before", o.value(*index).map_or(Value::Null, Value::from)),
                        ("after", n.value(*index).map_or(Value::Null, Value::from)),
                    ]));
                }
            }
        }
    }
    for key in ["control", "allocator", "counters"] {
        charge(meter, 1)?;
        let differs = match key {
            "control" => old.control != new.control,
            "allocator" => old.allocator != new.allocator,
            "counters" => old.counters != new.counters,
            _ => unreachable!(),
        };
        if differs {
            let (before, after) = match key {
                "control" => (old.control.value(), new.control.value()),
                "allocator" => (old.allocator.value(), new.allocator.value()),
                "counters" => (old.counters.value(), new.counters.value()),
                _ => unreachable!(),
            };
            changes.push(object_value([
                ("op", key.into()),
                ("before", before),
                ("after", after),
            ]));
        }
    }
    if before.output.len() != after.output.len() {
        charge(
            meter,
            (after.output.len() - before.output.len()).div_ceil(64),
        )?;
        changes.push(object_value([
            ("op", "output".into()),
            ("beforeBytes", before.output.len().into()),
            ("afterBytes", after.output.len().into()),
            ("append", after.output[before.output.len()..].into()),
        ]));
    }
    Ok(changes)
}

fn stack_changes<T: ShellRecord>(
    old: &[T],
    new: &[T],
    table: &'static str,
    changes: &mut Vec<Value>,
    meter: &mut Meter,
) -> Result<(), Diagnostic> {
    let common = old.len().min(new.len());
    for i in 0..common {
        charge(meter, 1)?;
        assert_eq!(old[i].id(), new[i].id(), "stack table identity");
        if old[i] != new[i] {
            changes.push(object_value([
                ("op", "record".into()),
                ("table", table.into()),
                ("id", new[i].identity()),
                ("index", i.into()),
                ("before", old[i].value()),
                ("after", new[i].value()),
            ]));
        }
    }
    for i in (common..old.len()).rev() {
        charge(meter, 1)?;
        changes.push(object_value([
            ("op", "record".into()),
            ("table", table.into()),
            ("id", old[i].identity()),
            ("index", i.into()),
            ("before", old[i].value()),
            ("after", Value::Null),
        ]));
    }
    for (i, record) in new.iter().enumerate().skip(common) {
        charge(meter, 1)?;
        changes.push(object_value([
            ("op", "record".into()),
            ("table", table.into()),
            ("id", record.identity()),
            ("index", i.into()),
            ("before", Value::Null),
            ("after", record.value()),
        ]));
    }
    Ok(())
}

#[cfg(test)]
#[path = "trace_wire_shell_tests.rs"]
mod shell_tests;

#[cfg(test)]
mod delta_differential_tests {
    use super::*;
    use crate::budget::{FINALIZATION_RESERVE, Limits};
    use crate::runtime_trace::{self, Meta};
    use crate::semantic::analyze;
    use std::{cell::Cell, rc::Rc};

    pub(super) type Case = (
        RuntimeState,
        RuntimeState,
        Value,
        Value,
        MeteredShell,
        MeteredShell,
        Option<(String, usize)>,
    );

    pub(super) fn cases() -> Vec<Case> {
        let checked =
            analyze("int main(){int x;int a[30];for(int i=0;i<2;i=i+1){int t;}return 0;}").unwrap();
        let declaration = |name: &str| {
            checked
                .declarations
                .iter()
                .find(|d| d.name == name)
                .unwrap()
                .node_id
        };
        let crate::ast::NodeData::Function { body } =
            checked.parsed.program.nodes[checked.parsed.program.root].data
        else {
            unreachable!()
        };
        let (loop_node, loop_body) = checked
            .parsed
            .program
            .nodes
            .iter()
            .enumerate()
            .find_map(|(id, node)| {
                if let crate::ast::NodeData::For { body, .. } = node.data {
                    Some((id, body))
                } else {
                    None
                }
            })
            .unwrap();
        let mut state = RuntimeState::default();
        let mut meta = Meta::default();
        let mut previous = (
            state.clone(),
            runtime_trace::shell(&state, &checked, &meta, None, vec![]),
            runtime_trace::metered_shell(&state, &checked, &meta, None, vec![]),
        );
        let mut cases = Vec::new();
        let mut push = |state: &RuntimeState, meta: &Meta, write: Option<(String, usize)>| {
            let flow = if state.scopes.len() > 1 {
                vec![runtime_trace::FlowEntry {
                    node: loop_node,
                    stage: "body".into(),
                    iteration: meta.comparisons,
                }]
            } else {
                vec![]
            };
            let shell = runtime_trace::shell(
                state,
                &checked,
                meta,
                None,
                flow.iter().map(runtime_trace::FlowEntry::value).collect(),
            );
            let typed = runtime_trace::metered_shell(state, &checked, meta, None, flow);
            cases.push((
                previous.0.clone(),
                state.clone(),
                previous.1.clone(),
                shell.clone(),
                previous.2.clone(),
                typed.clone(),
                write,
            ));
            previous = (state.clone(), shell, typed);
        };
        state.enter_scope(body);
        meta.phase = "running";
        push(&state, &meta, None);
        let x = declaration("x");
        let a = declaration("a");
        state.declare(x, "x".into());
        push(&state, &meta, None);
        for value in [i32::MIN, 0, i32::MAX, i32::MAX] {
            state.write(x, value);
            meta.scalar_writes += 1;
            push(
                &state,
                &meta,
                Some((format!("o{}", state.variables[&x].id), 0)),
            );
        }
        state.declare_array(a, "a".into(), 30);
        push(&state, &meta, None);
        state.write_array(a, 29, 99);
        meta.array_writes += 1;
        push(
            &state,
            &meta,
            Some((format!("o{}", state.arrays[&a].id), 29)),
        );
        state.initialize_array(a, (0..30).rev().collect());
        meta.array_writes += 30;
        push(&state, &meta, None);
        for (index, value) in [(0, 999), (29, -999), (0, 0), (29, 0), (29, 0)] {
            state.write_array(a, index, value);
            meta.array_writes += 1;
            meta.comparisons += 1;
            push(
                &state,
                &meta,
                Some((format!("o{}", state.arrays[&a].id), index)),
            );
        }
        state.output.push_str("中文\"\\😀\n");
        push(&state, &meta, None);
        state.output.push_str(&"中".repeat(70));
        push(&state, &meta, None);
        state.enter_scope(loop_node);
        let i = declaration("i");
        state.declare(i, "i".into());
        push(&state, &meta, None);
        let t = declaration("t");
        for iteration in 0..2 {
            state.write(i, iteration);
            meta.scalar_writes += 1;
            push(
                &state,
                &meta,
                Some((format!("o{}", state.variables[&i].id), 0)),
            );
            state.enter_scope(loop_body);
            state.declare(t, "t".into());
            push(&state, &meta, None);
            state.write(t, iteration);
            meta.scalar_writes += 1;
            push(
                &state,
                &meta,
                Some((format!("o{}", state.variables[&t].id), 0)),
            );
            state.leave_scope();
            push(&state, &meta, None);
        }
        state.leave_scope();
        push(&state, &meta, None);
        state.leave_scope();
        meta.phase = "completed";
        meta.return_value = Some(0);
        push(&state, &meta, None);
        cases
    }

    fn meter(fuel: usize, mode: u8) -> (Meter, Rc<Cell<usize>>, Rc<Cell<usize>>) {
        let mut meter = Meter::with_limits(Limits {
            fuel,
            ..Limits::default()
        });
        let clocks = Rc::new(Cell::new(0));
        let cancels = Rc::new(Cell::new(0));
        let read_clocks = clocks.clone();
        meter.set_clock(
            1000,
            Box::new(move || {
                let count = read_clocks.get();
                read_clocks.set(count + 1);
                if mode == 2 && count > 0 { 1000 } else { 0 }
            }),
        );
        let read_cancels = cancels.clone();
        meter.set_cancel(Box::new(move || {
            read_cancels.set(read_cancels.get() + 1);
            mode == 1
        }));
        (meter, clocks, cancels)
    }

    fn compare(case: &Case, fuel: usize, mode: u8) -> usize {
        let (before, after, old, new, old_typed, new_typed, write) = case;
        let (mut original, old_clocks, old_cancels) = meter(fuel, mode);
        let (mut current, new_clocks, new_cancels) = meter(fuel, mode);
        let expected = legacy_delta(before, after, old, new, write.clone(), &mut original);
        let actual = delta(
            before,
            after,
            old_typed,
            new_typed,
            write.clone(),
            &mut current,
        );
        assert_eq!(actual, expected);
        assert_eq!(current.used(), original.used());
        assert_eq!(current.reserved(), original.reserved());
        assert_eq!(current.failure(), original.failure());
        assert_eq!(new_clocks.get(), old_clocks.get());
        assert_eq!(new_cancels.get(), old_cancels.get());
        if let Ok(actual) = actual {
            assert_eq!(
                serde_json::to_vec(&actual).unwrap(),
                serde_json::to_vec(&expected.unwrap()).unwrap()
            );
        }
        current.used()
    }

    #[test]
    fn owned_delta_matches_original_lifecycle_order_bytes_and_fuel() {
        let cases = cases();
        assert_eq!(cases.len(), 27);
        for case in &cases {
            compare(case, Limits::default().fuel, 0);
        }
    }

    #[test]
    fn owned_delta_preserves_each_fuel_rejection_and_control_priority() {
        for case in cases() {
            let cost = compare(&case, Limits::default().fuel, 0);
            for available in 0..=cost + 1 {
                compare(&case, FINALIZATION_RESERVE + available, 0);
            }
            for mode in [1, 2] {
                for fuel in [0, FINALIZATION_RESERVE, Limits::default().fuel] {
                    compare(&case, fuel, mode);
                }
            }
        }
    }

    #[test]
    fn moved_object_json_matches_original_for_uninitialized_sparse_and_default_cells() {
        let checked = analyze("int main(){int x;int a[30];return 0;}").unwrap();
        let x = checked.declarations[0].node_id;
        let a = checked.declarations[1].node_id;
        let mut state = RuntimeState::default();
        state.enter_scope(checked.parsed.program.root);
        state.declare(x, "x".into());
        state.declare_array(a, "a".into(), 30);
        for at in 0..34 {
            if at < 30 {
                state.write_array(a, at, at as i32 - 15);
            }
            if at == 30 {
                state.initialize_array(a, (0..30).rev().collect());
            }
            if at == 31 {
                state.initialize_array(a, vec![]);
            }
            if at == 32 {
                state.write(x, i32::MIN);
            }
            if at == 33 {
                state.write(x, i32::MAX);
            }
            for (current, original) in objects(&state).iter().zip(legacy_objects(&state)) {
                let actual = current.json();
                let expected = original.json();
                assert_eq!(actual, expected);
                assert_eq!(
                    serde_json::to_vec(&actual).unwrap(),
                    serde_json::to_vec(&expected).unwrap()
                );
            }
        }
    }

    #[test]
    fn decimal_identity_matches_exact_formatted_ids_without_allocation() {
        let mut values = vec![
            0,
            1,
            9,
            10,
            99,
            100,
            999,
            1000,
            9_007_199_254_740_991,
            u64::MAX,
        ];
        let mut next = 7_u64;
        for _ in 0..128 {
            next = next.wrapping_mul(6364136223846793005).wrapping_add(1);
            values.push(next);
        }
        for value in values {
            let canonical = format!("o{value}");
            for candidate in [
                canonical.clone(),
                format!("o0{value}"),
                format!("o+{value}"),
                format!("{value}"),
                format!("{canonical}0"),
                format!("{canonical}\0"),
                "o".into(),
                "o-1".into(),
                "o١".into(),
            ] {
                assert_eq!(object_id_matches(&candidate, value), candidate == canonical);
            }
        }
    }
    enum LegacyObject<'a> {
        Scalar(&'a RuntimeVariable),
        Array(&'a RuntimeArray),
    }
    impl LegacyObject<'_> {
        fn id(&self) -> u64 {
            match self {
                Self::Scalar(v) => v.id,
                Self::Array(v) => v.id,
            }
        }
        fn length(&self) -> usize {
            match self {
                Self::Scalar(_) => 1,
                Self::Array(v) => v.length,
            }
        }
        fn default(&self) -> Option<i32> {
            match self {
                Self::Scalar(_) => None,
                Self::Array(v) => v.default_value,
            }
        }
        fn cells(&self) -> usize {
            match self {
                Self::Scalar(v) => usize::from(v.value.is_some()),
                Self::Array(v) => v.cells.len(),
            }
        }
        fn name_bytes(&self) -> usize {
            match self {
                Self::Scalar(v) => v.name.len(),
                Self::Array(v) => v.name.len(),
            }
        }
        fn value(&self, index: usize) -> Option<i32> {
            match self {
                Self::Scalar(v) => v.value,
                Self::Array(v) => v.cells.get(&index).copied().or(v.default_value),
            }
        }
        fn json(&self) -> Value {
            match self {
                Self::Scalar(v) => {
                    json!({"id":format!("o{}",v.id),"declarationNodeId":node(v.declaration_node),"frameId":"f1","scopeId":format!("s{}",v.scope_id),"name":v.name,"kind":"int","length":1,"baseAddress":v.base_address,"defaultValue":null,"cells":v.value.map(|value|vec![json!({"index":0,"value":value})]).unwrap_or_default()})
                }
                Self::Array(v) => {
                    json!({"id":format!("o{}",v.id),"declarationNodeId":node(v.declaration_node),"frameId":"f1","scopeId":format!("s{}",v.scope_id),"name":v.name,"kind":"int-array","length":v.length,"baseAddress":v.base_address,"defaultValue":v.default_value,"cells":v.cells.iter().map(|(&index,&value)|json!({"index":index,"value":value})).collect::<Vec<_>>()})
                }
            }
        }
    }
    fn legacy_objects(state: &RuntimeState) -> Vec<LegacyObject<'_>> {
        state
            .scopes
            .iter()
            .flat_map(|scope| scope.declaration_nodes.iter())
            .map(|id| {
                state
                    .variables
                    .get(id)
                    .map(LegacyObject::Scalar)
                    .unwrap_or_else(|| LegacyObject::Array(&state.arrays[id]))
            })
            .collect()
    }

    /// Derive only the records actually touched by the successful atomic action.
    /// Active scopes/declarations are already in dynamic allocation order.
    fn legacy_delta(
        before: &RuntimeState,
        after: &RuntimeState,
        old: &Value,
        new: &Value,
        write: Option<(String, usize)>,
        meter: &mut Meter,
    ) -> Result<Vec<Value>, Diagnostic> {
        charge(
            meter,
            before.scopes.len()
                + after.scopes.len()
                + before.variables.len()
                + before.arrays.len()
                + after.variables.len()
                + after.arrays.len(),
        )?;
        let mut changes = Vec::new();
        for table in ["frames", "scopes"] {
            let old = old[table].as_array().expect("shell table");
            let new = new[table].as_array().expect("shell table");
            let common = old.len().min(new.len());
            for i in 0..common {
                charge(meter, 1)?;
                assert_eq!(old[i]["id"], new[i]["id"], "stack table identity");
                if old[i] != new[i] {
                    changes.push(json!({"op":"record","table":table,"id":new[i]["id"],"index":i,"before":old[i],"after":new[i]}));
                }
            }
            for i in (common..old.len()).rev() {
                charge(meter, 1)?;
                changes.push(json!({"op":"record","table":table,"id":old[i]["id"],"index":i,"before":old[i],"after":null}));
            }
            for (i, r) in new.iter().enumerate().skip(common) {
                charge(meter, 1)?;
                changes.push(
                json!({"op":"record","table":table,"id":r["id"],"index":i,"before":null,"after":r}),
            );
            }
        }
        let old_objects = legacy_objects(before);
        let new_objects = legacy_objects(after);
        let common = old_objects.len().min(new_objects.len());
        for (i, o) in old_objects.iter().enumerate().skip(common).rev() {
            charge(meter, 1 + o.cells() + o.name_bytes().div_ceil(64))?;
            changes.push(json!({"op":"record","table":"objects","id":format!("o{}",o.id()),"index":i,"before":o.json(),"after":null}));
        }
        for (i, n) in new_objects.iter().enumerate() {
            charge(meter, 1)?;
            match old_objects.get(i) {
                None => {
                    charge(meter, n.cells() + n.name_bytes().div_ceil(64))?;
                    changes.push(json!({"op":"record","table":"objects","id":format!("o{}",n.id()),"index":i,"before":null,"after":n.json()}));
                }
                Some(o) if o.default() != n.default() => {
                    assert_eq!(o.id(), n.id());
                    charge(
                        meter,
                        o.cells() + n.cells() + (o.name_bytes() + n.name_bytes()).div_ceil(64),
                    )?;
                    changes.push(json!({"op":"record","table":"objects","id":format!("o{}",n.id()),"index":i,"before":o.json(),"after":n.json()}));
                }
                Some(o) => {
                    if let Some((id, index)) = &write
                        && *id == format!("o{}", n.id())
                    {
                        assert!(*index < n.length());
                        changes.push(json!({"op":"cell","objectId":id,"index":index,"before":o.value(*index),"after":n.value(*index)}));
                    }
                }
            }
        }
        for key in ["control", "allocator", "counters"] {
            charge(meter, 1)?;
            if old[key] != new[key] {
                changes.push(json!({"op":key,"before":old[key],"after":new[key]}));
            }
        }
        if before.output.len() != after.output.len() {
            charge(
                meter,
                (after.output.len() - before.output.len()).div_ceil(64),
            )?;
            changes.push(json!({"op":"output","beforeBytes":before.output.len(),"afterBytes":after.output.len(),"append":&after.output[before.output.len()..]}));
        }
        Ok(changes)
    }
}
