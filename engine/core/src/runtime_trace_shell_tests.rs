//! Frozen pre-typed-shell projection body; only the function name is changed.
use super::*;

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

#[test]
fn typed_shell_matches_frozen_value_projection_and_canonical_bytes() {
    use crate::budget::Meter;
    use crate::codec;
    use crate::semantic::analyze;

    let checked =
        analyze("int main(){int x;int a[30];for(int i=0;i<2;i=i+1){int t;}return 0;}").unwrap();
    let declaration = |name: &str| {
        checked
            .declarations
            .iter()
            .find(|item| item.name == name)
            .unwrap()
            .node_id
    };
    let NodeData::Function { body } =
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
            if let NodeData::For { body, .. } = node.data {
                Some((id, body))
            } else {
                None
            }
        })
        .unwrap();
    let mut state = RuntimeState::default();
    let mut meta = Meta::default();
    let mut compared = 0;
    let mut compare = |state: &RuntimeState, meta: &Meta| {
        for next in [
            None,
            Some(checked.parsed.program.root),
            Some(declaration("a")),
        ] {
            for stage in ["block", "init", "condition", "body", "update"] {
                let flow = if meta.phase == "ready" {
                    Vec::new()
                } else {
                    vec![FlowEntry {
                        node: loop_node,
                        stage: stage.into(),
                        iteration: meta.comparisons,
                    }]
                };
                let expected = legacy_project_mode(
                    state,
                    &checked,
                    meta,
                    next,
                    flow.iter().map(FlowEntry::value).collect(),
                    false,
                );
                let actual = metered_shell(state, &checked, meta, next, flow).value(&state.output);
                assert_eq!(actual, expected);
                assert_eq!(
                    MeteredShell::initial(&expected).value(&state.output),
                    expected
                );
                let mut original = Meter::new();
                original.set_clock(1000, Box::new(|| 0));
                let mut current = Meter::new();
                current.set_clock(1000, Box::new(|| 0));
                assert_eq!(
                    codec::encode(&actual, &mut current, 16_777_216),
                    codec::encode(&expected, &mut original, 16_777_216)
                );
                assert_eq!(current.used(), original.used());
                assert_eq!(current.reserved(), original.reserved());
                compared += 1;
            }
        }
    };
    compare(&state, &meta);
    let initial = legacy_project_mode(
        &state,
        &checked,
        &meta,
        Some(checked.parsed.program.root),
        vec![],
        false,
    );
    assert_eq!(MeteredShell::initial(&initial).value(""), initial);
    state.enter_scope(body);
    meta.phase = "running";
    compare(&state, &meta);
    let x = declaration("x");
    let a = declaration("a");
    state.declare(x, "x".into());
    state.declare_array(a, "a".into(), 30);
    compare(&state, &meta);
    state.initialize_array(a, (0..30).rev().collect());
    for value in [i32::MIN, -999, 0, 999, i32::MAX] {
        state.write(x, value);
        meta.scalar_writes += 1;
        meta.comparisons += 1;
        state.output.push_str("中文\"\\😀\n\t");
        compare(&state, &meta);
    }
    state.enter_scope(loop_node);
    let i = declaration("i");
    state.declare(i, "i".into());
    for iteration in 0..3 {
        state.write(i, iteration);
        state.enter_scope(loop_body);
        let t = declaration("t");
        state.declare(t, "t".into());
        state.write(t, iteration);
        meta.comparisons += 1;
        meta.array_writes += 2;
        meta.swaps += 1;
        compare(&state, &meta);
        state.leave_scope();
        compare(&state, &meta);
    }
    state.leave_scope();
    compare(&state, &meta);
    state.leave_scope();
    meta.phase = "returned";
    for value in [i32::MIN, 0, i32::MAX] {
        meta.return_value = Some(value);
        compare(&state, &meta);
    }
    assert_eq!(compared, 270);
}
