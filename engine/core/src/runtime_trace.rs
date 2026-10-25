//! Projection and value provenance for the one runtime's optional STEP recorder.
//! No C is evaluated or replayed here. Addresses are teaching logical addresses.

use crate::ast::{BinaryOp, NodeData, NodeId, UnaryOp};
use crate::runtime_state::RuntimeState;
use crate::semantic::CheckedProgram;
use serde_json::{Value, json};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub(crate) fn node(id: NodeId) -> String {
    format!("n{}", id + 1)
}
pub(crate) fn source(id: NodeId, edge: &str) -> Value {
    json!({"kind":"source","nodeId":node(id),"edge":edge})
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Origin {
    pub object: u64,
    pub index: usize,
    pub value: i32,
    pub version: u64,
}

#[derive(Clone)]
struct PendingWrite {
    index: usize,
    before: i32,
    after: i32,
    version: u64,
    rhs: Origin,
    seq: usize,
}

#[derive(Clone)]
pub(crate) struct Meta {
    pub phase: &'static str,
    pub return_value: Option<i32>,
    pub comparisons: u64,
    pub scalar_writes: u64,
    pub array_writes: u64,
    pub swaps: u64,
    pub observations: Vec<Value>,
    pub last_origin: Option<Origin>,
    pub iterations: BTreeMap<NodeId, u64>,
    pub write_target: Option<(String, usize)>,
    scalar_origins: Arc<BTreeMap<u64, Origin>>,
    versions: Arc<BTreeMap<(u64, usize), u64>>,
    writes: Arc<BTreeMap<u64, PendingWrite>>,
}

impl Default for Meta {
    fn default() -> Self {
        Self {
            phase: "ready",
            return_value: None,
            comparisons: 0,
            scalar_writes: 0,
            array_writes: 0,
            swaps: 0,
            observations: Vec::new(),
            last_origin: None,
            iterations: BTreeMap::new(),
            write_target: None,
            scalar_origins: Arc::new(BTreeMap::new()),
            versions: Arc::new(BTreeMap::new()),
            writes: Arc::new(BTreeMap::new()),
        }
    }
}

impl Meta {
    pub fn read_scalar(&mut self, id: NodeId, object: u64, value: i32) {
        self.observations.push(json!({"kind":"read","nodeId":node(id),"objectId":format!("o{object}"),"index":0,"value":value}));
        self.last_origin = self.scalar_origins.get(&object).copied();
    }
    pub fn read_array(&mut self, id: NodeId, object: u64, index: usize, value: i32) {
        self.observations.push(json!({"kind":"read","nodeId":node(id),"objectId":format!("o{object}"),"index":index,"value":value}));
        self.last_origin = Some(Origin {
            object,
            index,
            value,
            version: *self.versions.get(&(object, index)).unwrap_or(&0),
        });
    }
    pub fn scalar_write(&mut self, object: u64) {
        self.scalar_writes += 1;
        self.write_target = Some((format!("o{object}"), 0));
        if let Some(origin) = self.last_origin {
            Arc::make_mut(&mut self.scalar_origins).insert(object, origin);
        } else {
            Arc::make_mut(&mut self.scalar_origins).remove(&object);
        }
    }
    pub fn array_write(
        &mut self,
        id: NodeId,
        object: u64,
        index: usize,
        before: Option<i32>,
        after: i32,
        seq: usize,
    ) {
        self.array_writes += 1;
        self.write_target = Some((format!("o{object}"), index));
        let version = *self.versions.get(&(object, index)).unwrap_or(&0);
        Arc::make_mut(&mut self.versions).insert((object, index), version + 1);
        let previous = Arc::make_mut(&mut self.writes).remove(&object);
        if let (Some(previous), Some(rhs), Some(before)) = (&previous, self.last_origin, before)
            && previous.index != index
            && previous.after == before
            && previous.before == after
            && previous.rhs.object == object
            && previous.rhs.index == index
            && previous.rhs.value == before
            && previous.rhs.version == version
            && rhs.object == object
            && rhs.index == previous.index
            && rhs.value == after
            && rhs.version == previous.version
        {
            self.swaps += 1;
            self.observations.push(json!({"kind":"swap","nodeId":node(id),"objectId":format!("o{object}"),"indices":[previous.index,index],"beforeValues":[previous.before,before],"writeSeqs":[previous.seq,seq]}));
        } else if let (Some(before), Some(rhs)) = (before, self.last_origin) {
            Arc::make_mut(&mut self.writes).insert(
                object,
                PendingWrite {
                    index,
                    before,
                    after,
                    version,
                    rhs,
                    seq,
                },
            );
        }
    }
    pub fn unary(&mut self, id: NodeId, op: UnaryOp, value: i32, result: i32) {
        let operator = match op {
            UnaryOp::Plus => "+",
            UnaryOp::Minus => "-",
            UnaryOp::Not => "!",
        };
        self.observations.push(json!({"kind":"evaluate","nodeId":node(id),"operator":operator,"operands":[value],"value":result}));
        if op != UnaryOp::Plus {
            self.last_origin = None;
        }
    }
    pub fn binary(
        &mut self,
        id: NodeId,
        op: BinaryOp,
        left: i32,
        right: Option<i32>,
        result: i32,
        skipped: NodeId,
    ) {
        let operator = match op {
            BinaryOp::Multiply => "*",
            BinaryOp::Divide => "/",
            BinaryOp::Remainder => "%",
            BinaryOp::Add => "+",
            BinaryOp::Subtract => "-",
            BinaryOp::Less => "<",
            BinaryOp::LessEqual => "<=",
            BinaryOp::Greater => ">",
            BinaryOp::GreaterEqual => ">=",
            BinaryOp::Equal => "==",
            BinaryOp::NotEqual => "!=",
            BinaryOp::And => "&&",
            BinaryOp::Or => "||",
        };
        if matches!(
            op,
            BinaryOp::Less
                | BinaryOp::LessEqual
                | BinaryOp::Greater
                | BinaryOp::GreaterEqual
                | BinaryOp::Equal
                | BinaryOp::NotEqual
        ) {
            self.comparisons += 1;
        }
        let operands = right.map_or_else(|| vec![left], |right| vec![left, right]);
        self.observations.push(json!({"kind":"evaluate","nodeId":node(id),"operator":operator,"operands":operands,"value":result}));
        if right.is_none() {
            self.observations.push(
                json!({"kind":"short-circuit","nodeId":node(id),"skippedNodeId":node(skipped)}),
            );
        }
        self.last_origin = None;
    }
    pub fn decision(&mut self, id: NodeId, value: i32) {
        self.observations.push(json!({"kind":"decision","nodeId":node(id),"value":value,"branch":if value==0 {"false"} else {"true"}}));
    }
    pub fn retain_live(&mut self, state: &RuntimeState) {
        let scalars = state
            .variables
            .values()
            .map(|v| v.id)
            .collect::<BTreeSet<_>>();
        let arrays = state.arrays.values().map(|v| v.id).collect::<BTreeSet<_>>();
        Arc::make_mut(&mut self.scalar_origins).retain(|id, _| scalars.contains(id));
        Arc::make_mut(&mut self.versions).retain(|(id, _), _| arrays.contains(id));
        Arc::make_mut(&mut self.writes).retain(|id, _| arrays.contains(id));
    }

    pub fn metadata_weight(&self) -> usize {
        self.scalar_origins.len() + self.versions.len() + self.writes.len() + self.iterations.len()
    }
    pub fn scalar_copy_weight(&self) -> usize {
        self.scalar_origins.len()
    }
    pub fn array_copy_weight(&self) -> usize {
        self.versions.len() + self.writes.len()
    }
}

pub(crate) fn weight(state: &RuntimeState) -> usize {
    1 + state.scopes.len()
        + state.variables.len()
        + state.arrays.len()
        + state.arrays.values().map(|a| a.cells.len()).sum::<usize>()
        + state.output.len().div_ceil(64)
}

pub(crate) fn project(
    state: &RuntimeState,
    checked: &CheckedProgram,
    meta: &Meta,
    next: Option<NodeId>,
    flow: Vec<Value>,
) -> Value {
    project_mode(state, checked, meta, next, flow, true)
}

pub(crate) fn shell(
    state: &RuntimeState,
    checked: &CheckedProgram,
    meta: &Meta,
    next: Option<NodeId>,
    flow: Vec<Value>,
) -> Value {
    project_mode(state, checked, meta, next, flow, false)
}

/// Metered producer state needed by delta derivation, without transient JSON
/// maps and formatted identifiers for every unchanged stack/control record.
/// Public Step/Trace/checkpoint Values are still constructed in full.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MeteredShell {
    Typed(ShellData),
    #[cfg(test)]
    Legacy(Value),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellData {
    pub frames: Vec<ShellFrame>,
    pub scopes: Vec<ShellScope>,
    pub control: ShellControl,
    pub allocator: ShellAllocator,
    pub counters: ShellCounters,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellFrame {
    pub function_node: NodeId,
    pub scope_ids: Vec<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellScope {
    pub id: u64,
    pub parent: Option<u64>,
    pub node: NodeId,
    pub kind: Cow<'static, str>,
    pub object_ids: Vec<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellControl {
    pub phase: Cow<'static, str>,
    pub next: Option<NodeId>,
    pub active: bool,
    pub returned: Option<i32>,
    pub flow: Vec<FlowEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FlowEntry {
    pub node: NodeId,
    pub stage: Cow<'static, str>,
    pub iteration: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellAllocator {
    pub next_address: u64,
    pub live_bytes: usize,
    pub next_object: u64,
    pub next_scope: u64,
    pub next_frame: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellCounters {
    pub comparisons: u64,
    pub scalar_writes: u64,
    pub array_writes: u64,
    pub swaps: u64,
}

pub(crate) trait ShellRecord: PartialEq {
    fn id(&self) -> u64;
    fn identity(&self) -> Value;
    fn value(&self) -> Value;
}

impl ShellRecord for ShellFrame {
    fn id(&self) -> u64 {
        1
    }
    fn identity(&self) -> Value {
        "f1".into()
    }
    fn value(&self) -> Value {
        object([
            ("id", self.identity()),
            ("functionNodeId", node(self.function_node).into()),
            ("parentFrameId", Value::Null),
            (
                "scopeIds",
                Value::Array(
                    self.scope_ids
                        .iter()
                        .map(|id| format!("s{id}").into())
                        .collect(),
                ),
            ),
        ])
    }
}

impl ShellRecord for ShellScope {
    fn id(&self) -> u64 {
        self.id
    }
    fn identity(&self) -> Value {
        format!("s{}", self.id).into()
    }
    fn value(&self) -> Value {
        object([
            ("id", self.identity()),
            ("frameId", "f1".into()),
            (
                "parentScopeId",
                self.parent
                    .map_or(Value::Null, |id| format!("s{id}").into()),
            ),
            ("nodeId", node(self.node).into()),
            ("kind", self.kind.as_ref().into()),
            (
                "objectIds",
                Value::Array(
                    self.object_ids
                        .iter()
                        .map(|id| format!("o{id}").into())
                        .collect(),
                ),
            ),
        ])
    }
}

impl FlowEntry {
    pub fn value(&self) -> Value {
        object([
            ("nodeId", node(self.node).into()),
            ("stage", self.stage.as_ref().into()),
            ("iteration", self.iteration.into()),
        ])
    }
}

impl ShellControl {
    pub fn value(&self) -> Value {
        object([
            ("phase", self.phase.as_ref().into()),
            (
                "nextNodeId",
                self.next.map(node).map_or(Value::Null, Value::String),
            ),
            (
                "activeFrameId",
                if self.active {
                    "f1".into()
                } else {
                    Value::Null
                },
            ),
            (
                "returnValue",
                self.returned.map_or(Value::Null, Value::from),
            ),
            (
                "flowStack",
                Value::Array(self.flow.iter().map(FlowEntry::value).collect()),
            ),
        ])
    }
}

impl ShellAllocator {
    pub fn value(&self) -> Value {
        object([
            ("nextAddress", self.next_address.into()),
            ("liveBytes", self.live_bytes.into()),
            ("nextObject", self.next_object.into()),
            ("nextScope", self.next_scope.into()),
            ("nextFrame", self.next_frame.into()),
        ])
    }
}

impl ShellCounters {
    pub fn value(&self) -> Value {
        object([
            ("comparisons", self.comparisons.into()),
            ("scalarWrites", self.scalar_writes.into()),
            ("arrayWrites", self.array_writes.into()),
            ("swaps", self.swaps.into()),
        ])
    }
}

impl MeteredShell {
    /// Preserve TraceWire's existing boundary for every trusted runtime
    /// projection, including native atomic tests initialized with live scopes.
    /// Only this one-time conversion owns labels; per-step projection borrows
    /// the runtime's static phase/kind/stage strings.
    pub fn initial(initial: &Value) -> Self {
        fn identity(value: &Value, prefix: char) -> u64 {
            value
                .as_str()
                .expect("runtime identity")
                .strip_prefix(prefix)
                .expect("runtime identity prefix")
                .parse()
                .expect("runtime numeric identity")
        }
        fn node_identity(value: &Value) -> NodeId {
            identity(value, 'n') as NodeId - 1
        }
        let control = &initial["control"];
        let next =
            (!control["nextNodeId"].is_null()).then(|| node_identity(&control["nextNodeId"]));
        let allocator = &initial["allocator"];
        let counters = &initial["counters"];
        Self::Typed(ShellData {
            frames: initial["frames"]
                .as_array()
                .unwrap()
                .iter()
                .map(|frame| ShellFrame {
                    function_node: node_identity(&frame["functionNodeId"]),
                    scope_ids: frame["scopeIds"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|scope| identity(scope, 's'))
                        .collect(),
                })
                .collect(),
            scopes: initial["scopes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|scope| ShellScope {
                    id: identity(&scope["id"], 's'),
                    parent: (!scope["parentScopeId"].is_null())
                        .then(|| identity(&scope["parentScopeId"], 's')),
                    node: node_identity(&scope["nodeId"]),
                    kind: scope["kind"].as_str().unwrap().to_owned().into(),
                    object_ids: scope["objectIds"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|object| identity(object, 'o'))
                        .collect(),
                })
                .collect(),
            control: ShellControl {
                phase: control["phase"].as_str().unwrap().to_owned().into(),
                next,
                active: !control["activeFrameId"].is_null(),
                returned: control["returnValue"].as_i64().map(|value| value as i32),
                flow: control["flowStack"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|flow| FlowEntry {
                        node: node_identity(&flow["nodeId"]),
                        stage: flow["stage"].as_str().unwrap().to_owned().into(),
                        iteration: flow["iteration"].as_u64().unwrap(),
                    })
                    .collect(),
            },
            allocator: ShellAllocator {
                next_address: allocator["nextAddress"].as_u64().unwrap(),
                live_bytes: allocator["liveBytes"].as_u64().unwrap() as usize,
                next_object: allocator["nextObject"].as_u64().unwrap(),
                next_scope: allocator["nextScope"].as_u64().unwrap(),
                next_frame: allocator["nextFrame"].as_u64().unwrap(),
            },
            counters: ShellCounters {
                comparisons: counters["comparisons"].as_u64().unwrap(),
                scalar_writes: counters["scalarWrites"].as_u64().unwrap(),
                array_writes: counters["arrayWrites"].as_u64().unwrap(),
                swaps: counters["swaps"].as_u64().unwrap(),
            },
        })
    }

    pub fn data(&self) -> &ShellData {
        match self {
            Self::Typed(data) => data,
            #[cfg(test)]
            Self::Legacy(_) => unreachable!("legacy differential shell uses its frozen delta"),
        }
    }

    pub fn flow_values(&self) -> Vec<Value> {
        match self {
            Self::Typed(data) => data.control.flow.iter().map(FlowEntry::value).collect(),
            #[cfg(test)]
            Self::Legacy(value) => value["control"]["flowStack"].as_array().unwrap().clone(),
        }
    }

    #[cfg(test)]
    fn value(&self, output: &str) -> Value {
        let data = self.data();
        object([
            (
                "frames",
                Value::Array(data.frames.iter().map(ShellRecord::value).collect()),
            ),
            (
                "scopes",
                Value::Array(data.scopes.iter().map(ShellRecord::value).collect()),
            ),
            ("objects", Value::Array(Vec::new())),
            ("control", data.control.value()),
            ("allocator", data.allocator.value()),
            ("counters", data.counters.value()),
            ("output", output.into()),
        ])
    }
}

pub(crate) fn metered_shell(
    state: &RuntimeState,
    checked: &CheckedProgram,
    meta: &Meta,
    next: Option<NodeId>,
    flow: Vec<FlowEntry>,
) -> MeteredShell {
    let active = meta.phase == "running";
    MeteredShell::Typed(ShellData {
        frames: if active {
            vec![ShellFrame {
                function_node: checked.parsed.program.root,
                scope_ids: state.scopes.iter().map(|scope| scope.id).collect(),
            }]
        } else {
            Vec::new()
        },
        scopes: state
            .scopes
            .iter()
            .enumerate()
            .map(|(index, scope)| ShellScope {
                id: scope.id,
                parent: if index == 0 {
                    None
                } else {
                    Some(state.scopes[index - 1].id)
                },
                node: scope.node_id,
                kind: (if index == 0 {
                    "main"
                } else if matches!(
                    checked.parsed.program.nodes[scope.node_id].data,
                    NodeData::For { .. }
                ) {
                    "for"
                } else {
                    "block"
                })
                .into(),
                object_ids: scope
                    .declaration_nodes
                    .iter()
                    .map(|id| {
                        state
                            .variables
                            .get(id)
                            .map(|variable| variable.id)
                            .unwrap_or_else(|| state.arrays[id].id)
                    })
                    .collect(),
            })
            .collect(),
        control: ShellControl {
            phase: meta.phase.into(),
            next,
            active,
            returned: meta.return_value,
            flow,
        },
        allocator: ShellAllocator {
            next_address: state.next_address,
            live_bytes: state.live_bytes,
            next_object: state.next_object_id,
            next_scope: state.next_scope_id,
            next_frame: if meta.phase == "ready" { 1 } else { 2 },
        },
        counters: ShellCounters {
            comparisons: meta.comparisons,
            scalar_writes: meta.scalar_writes,
            array_writes: meta.array_writes,
            swaps: meta.swaps,
        },
    })
}

fn project_mode(
    state: &RuntimeState,
    checked: &CheckedProgram,
    meta: &Meta,
    next: Option<NodeId>,
    flow: Vec<Value>,
    include_objects: bool,
) -> Value {
    let active = meta.phase == "running";
    let frames = if active {
        vec![object([
            ("id", "f1".into()),
            ("functionNodeId", node(checked.parsed.program.root).into()),
            ("parentFrameId", Value::Null),
            (
                "scopeIds",
                Value::Array(
                    state
                        .scopes
                        .iter()
                        .map(|scope| format!("s{}", scope.id).into())
                        .collect(),
                ),
            ),
        ])]
    } else {
        Vec::new()
    };
    let scopes = state
        .scopes
        .iter()
        .enumerate()
        .map(|(index, scope)| {
            let objects = scope
                .declaration_nodes
                .iter()
                .map(|id| {
                    let object = state
                        .variables
                        .get(id)
                        .map(|variable| variable.id)
                        .unwrap_or_else(|| state.arrays[id].id);
                    format!("o{object}").into()
                })
                .collect();
            object([
                ("id", format!("s{}", scope.id).into()),
                ("frameId", "f1".into()),
                (
                    "parentScopeId",
                    if index == 0 {
                        Value::Null
                    } else {
                        format!("s{}", state.scopes[index - 1].id).into()
                    },
                ),
                ("nodeId", node(scope.node_id).into()),
                (
                    "kind",
                    if index == 0 {
                        "main"
                    } else if matches!(
                        checked.parsed.program.nodes[scope.node_id].data,
                        NodeData::For { .. }
                    ) {
                        "for"
                    } else {
                        "block"
                    }
                    .into(),
                ),
                ("objectIds", Value::Array(objects)),
            ])
        })
        .collect();
    let mut objects = Vec::new();
    if include_objects {
        for id in state
            .scopes
            .iter()
            .flat_map(|scope| &scope.declaration_nodes)
        {
            if let Some(variable) = state.variables.get(id) {
                objects.push(object([
                    ("id", format!("o{}", variable.id).into()),
                    ("declarationNodeId", node(variable.declaration_node).into()),
                    ("frameId", "f1".into()),
                    ("scopeId", format!("s{}", variable.scope_id).into()),
                    ("name", variable.name.clone().into()),
                    ("kind", "int".into()),
                    ("length", 1.into()),
                    ("baseAddress", variable.base_address.into()),
                    ("defaultValue", Value::Null),
                    (
                        "cells",
                        Value::Array(
                            variable
                                .value
                                .map(|value| {
                                    vec![object([("index", 0.into()), ("value", value.into())])]
                                })
                                .unwrap_or_default(),
                        ),
                    ),
                ]));
            } else {
                let array = &state.arrays[id];
                objects.push(object([
                    ("id", format!("o{}", array.id).into()),
                    ("declarationNodeId", node(array.declaration_node).into()),
                    ("frameId", "f1".into()),
                    ("scopeId", format!("s{}", array.scope_id).into()),
                    ("name", array.name.clone().into()),
                    ("kind", "int-array".into()),
                    ("length", array.length.into()),
                    ("baseAddress", array.base_address.into()),
                    (
                        "defaultValue",
                        array.default_value.map_or(Value::Null, Value::from),
                    ),
                    (
                        "cells",
                        Value::Array(
                            array
                                .cells
                                .iter()
                                .map(|(&index, &value)| {
                                    object([("index", index.into()), ("value", value.into())])
                                })
                                .collect(),
                        ),
                    ),
                ]));
            }
        }
    }
    object([
        ("frames", Value::Array(frames)),
        ("scopes", Value::Array(scopes)),
        ("objects", Value::Array(objects)),
        (
            "control",
            object([
                ("phase", meta.phase.into()),
                (
                    "nextNodeId",
                    next.map(node).map_or(Value::Null, Value::String),
                ),
                (
                    "activeFrameId",
                    if active { "f1".into() } else { Value::Null },
                ),
                (
                    "returnValue",
                    meta.return_value.map_or(Value::Null, Value::from),
                ),
                ("flowStack", Value::Array(flow)),
            ]),
        ),
        (
            "allocator",
            object([
                ("nextAddress", state.next_address.into()),
                ("liveBytes", state.live_bytes.into()),
                ("nextObject", state.next_object_id.into()),
                ("nextScope", state.next_scope_id.into()),
                (
                    "nextFrame",
                    if meta.phase == "ready" { 1 } else { 2 }.into(),
                ),
            ]),
        ),
        ("output", state.output.clone().into()),
        (
            "counters",
            object([
                ("comparisons", meta.comparisons.into()),
                ("scalarWrites", meta.scalar_writes.into()),
                ("arrayWrites", meta.array_writes.into()),
                ("swaps", meta.swaps.into()),
            ]),
        ),
    ])
}

/// Consume already projected children instead of serializing `Value` back into
/// another `Value`. Each field and array remains owned by this one projection.
fn object<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

#[cfg(test)]
mod projection_differential_tests {
    use super::*;
    use crate::semantic::analyze;

    fn assert_original_projection(
        state: &RuntimeState,
        checked: &CheckedProgram,
        meta: &Meta,
        next: Option<NodeId>,
        flow: &[Value],
    ) {
        for include_objects in [false, true] {
            let original =
                legacy_project_mode(state, checked, meta, next, flow.to_vec(), include_objects);
            let actual = project_mode(state, checked, meta, next, flow.to_vec(), include_objects);
            assert_eq!(actual, original);
            assert_eq!(
                serde_json::to_vec(&actual).unwrap(),
                serde_json::to_vec(&original).unwrap(),
                "canonical bytes, including ordered arrays, must remain identical"
            );
        }
    }

    fn declaration(checked: &CheckedProgram, name: &str) -> NodeId {
        checked
            .declarations
            .iter()
            .find(|declaration| declaration.name == name)
            .unwrap()
            .node_id
    }

    fn main_scope(checked: &CheckedProgram) -> NodeId {
        let NodeData::Function { body } =
            checked.parsed.program.nodes[checked.parsed.program.root].data
        else {
            unreachable!()
        };
        body
    }

    #[test]
    fn moved_projection_matches_original_for_scalar_lifecycle_and_control() {
        let checked = analyze("int main(){int x;return 0;}").unwrap();
        let mut state = RuntimeState::default();
        let mut meta = Meta::default();
        assert_original_projection(&state, &checked, &meta, None, &[]);
        state.enter_scope(main_scope(&checked));
        meta.phase = "running";
        let x = declaration(&checked, "x");
        assert_original_projection(&state, &checked, &meta, Some(x), &[]);
        state.declare(x, "x".into());
        assert_original_projection(&state, &checked, &meta, Some(x), &[]);
        for value in [i32::MIN, -999, 0, 999, i32::MAX] {
            state.write(x, value);
            meta.scalar_writes += 1;
            state.output.push_str("中文\"\\\n😀\t");
            assert_original_projection(&state, &checked, &meta, None, &[]);
        }
        state.leave_scope();
        meta.phase = "completed";
        meta.return_value = Some(i32::MIN);
        assert_original_projection(&state, &checked, &meta, None, &[]);
    }

    #[test]
    fn moved_projection_matches_original_for_dynamic_for_block_and_recreated_objects() {
        let checked = analyze(
            "int main(){int outer=1;for(int i=0;i<2;i=i+1){int inner=2;int a[3];}return 0;}",
        )
        .unwrap();
        let mut state = RuntimeState::default();
        let meta = Meta {
            phase: "running",
            ..Meta::default()
        };
        state.enter_scope(main_scope(&checked));
        let outer = declaration(&checked, "outer");
        state.declare(outer, "outer".into());
        state.write(outer, 1);
        let (loop_node, loop_body) = checked
            .parsed
            .program
            .nodes
            .iter()
            .enumerate()
            .find_map(|(id, node)| {
                if let NodeData::For { body, .. } = node.data {
                    Some((id, body))
                } else {
                    None
                }
            })
            .unwrap();
        state.enter_scope(loop_node);
        let i = declaration(&checked, "i");
        state.declare(i, "i".into());
        let inner = declaration(&checked, "inner");
        let a = declaration(&checked, "a");
        for iteration in 0..3 {
            state.write(i, iteration);
            state.enter_scope(loop_body);
            state.declare(inner, "inner".into());
            state.write(inner, 2 - iteration);
            state.declare_array(a, "a".into(), 3);
            let flow = vec![json!({"nodeId":node(loop_node),"stage":"body","iteration":iteration})];
            assert_original_projection(&state, &checked, &meta, Some(inner), &flow);
            state.write_array(a, 2, -999);
            assert_original_projection(&state, &checked, &meta, Some(a), &flow);
            state.initialize_array(a, vec![0, 1]);
            assert_original_projection(&state, &checked, &meta, Some(a), &flow);
            state.leave_scope();
            assert_original_projection(&state, &checked, &meta, Some(loop_node), &flow);
        }
        state.leave_scope();
        assert_original_projection(&state, &checked, &meta, None, &[]);
    }

    #[test]
    fn moved_projection_matches_original_for_thirty_cells_defaults_and_changed_counters() {
        let checked = analyze("int main(){int a[30];int z[30];return 0;}").unwrap();
        let mut state = RuntimeState::default();
        let mut meta = Meta {
            phase: "running",
            ..Meta::default()
        };
        state.enter_scope(main_scope(&checked));
        let a = declaration(&checked, "a");
        let z = declaration(&checked, "z");
        state.declare_array(a, "a".into(), 30);
        state.declare_array(z, "z".into(), 30);
        assert_original_projection(&state, &checked, &meta, Some(a), &[]);
        state.initialize_array(a, (0..30).rev().collect());
        state.initialize_array(z, vec![]);
        for index in 0..30 {
            state.write_array(a, index, index as i32 - 15);
            state.write_array(z, index, if index % 2 == 0 { 0 } else { i32::MIN });
            meta.comparisons += 1;
            meta.array_writes += 2;
            meta.swaps += 1;
            assert_original_projection(&state, &checked, &meta, Some(z), &[]);
        }
        state.leave_scope();
        meta.phase = "completed";
        meta.return_value = Some(0);
        assert_original_projection(&state, &checked, &meta, None, &[]);
    }
    fn legacy_project_mode(
        state: &RuntimeState,
        checked: &CheckedProgram,
        meta: &Meta,
        next: Option<NodeId>,
        flow: Vec<Value>,
        include_objects: bool,
    ) -> Value {
        let active = meta.phase == "running";
        let frames = if active {
            vec![
                json!({"id":"f1","functionNodeId":node(checked.parsed.program.root),"parentFrameId":null,"scopeIds":state.scopes.iter().map(|s|format!("s{}",s.id)).collect::<Vec<_>>()}),
            ]
        } else {
            Vec::new()
        };
        let scopes=state.scopes.iter().enumerate().map(|(index,scope)|{
        let objects=scope.declaration_nodes.iter().map(|id|state.variables.get(id).map(|v|v.id).unwrap_or_else(||state.arrays[id].id)).collect::<Vec<_>>();
        json!({"id":format!("s{}",scope.id),"frameId":"f1","parentScopeId":if index==0 {None} else {Some(format!("s{}",state.scopes[index-1].id))},"nodeId":node(scope.node_id),"kind":if index==0 {"main"} else if matches!(checked.parsed.program.nodes[scope.node_id].data,NodeData::For{..}) {"for"} else {"block"},"objectIds":objects.into_iter().map(|id|format!("o{id}")).collect::<Vec<_>>()})
    }).collect::<Vec<_>>();
        let mut objects = Vec::new();
        if include_objects {
            for id in state
                .scopes
                .iter()
                .flat_map(|scope| &scope.declaration_nodes)
            {
                if let Some(variable) = state.variables.get(id) {
                    objects.push(json!({"id":format!("o{}",variable.id),"declarationNodeId":node(variable.declaration_node),"frameId":"f1","scopeId":format!("s{}",variable.scope_id),"name":variable.name,"kind":"int","length":1,"baseAddress":variable.base_address,"defaultValue":null,"cells":variable.value.map(|value|vec![json!({"index":0,"value":value})]).unwrap_or_default()}));
                } else {
                    let array = &state.arrays[id];
                    objects.push(json!({"id":format!("o{}",array.id),"declarationNodeId":node(array.declaration_node),"frameId":"f1","scopeId":format!("s{}",array.scope_id),"name":array.name,"kind":"int-array","length":array.length,"baseAddress":array.base_address,"defaultValue":array.default_value,"cells":array.cells.iter().map(|(&index,&value)|json!({"index":index,"value":value})).collect::<Vec<_>>()}));
                }
            }
        }
        json!({"frames":frames,"scopes":scopes,"objects":objects,"control":{"phase":meta.phase,"nextNodeId":next.map(node),"activeFrameId":if active {Some("f1")} else {None},"returnValue":meta.return_value,"flowStack":flow},"allocator":{"nextAddress":state.next_address,"liveBytes":state.live_bytes,"nextObject":state.next_object_id,"nextScope":state.next_scope_id,"nextFrame":if meta.phase=="ready" {1} else {2}},"output":state.output,"counters":{"comparisons":meta.comparisons,"scalarWrites":meta.scalar_writes,"arrayWrites":meta.array_writes,"swaps":meta.swaps}})
    }
}

#[cfg(test)]
#[path = "runtime_trace_shell_tests.rs"]
mod shell_tests;
