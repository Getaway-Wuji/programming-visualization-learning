//! STEP-01 reversible deltas over the executor's actual committed states.
//!
//! No C is executed here. A recorder retains deltas and periodic checkpoints,
//! never a full state per step. Import validation checks the closed vocabulary,
//! preconditions, state relationships, observations and checkpoint projections.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::ast::{NodeKind, NodeMapEntry};

pub const MAX_STEPS: usize = 20_000;
/// Space for the bounded enclosing result, terminal and diagnostics is reserved.
pub const MAX_TRACE_BYTES: usize = 16 * 1024 * 1024 - 65_536;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trace {
    pub dsl_version: String,
    pub completeness: String,
    pub initial_state: Value,
    pub steps: Vec<Step>,
    pub checkpoints: Vec<Checkpoint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Step {
    pub seq: usize,
    pub kind: String,
    pub location: Value,
    pub changes: Vec<Value>,
    pub observations: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub cursor: usize,
    pub state: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordError {
    StepLimit,
    ResultLimit { used: usize, attempted: usize },
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Forward,
    Backward,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceError(pub &'static str);

type Checked<T> = Result<T, TraceError>;

#[derive(Debug)]
pub struct Recorder {
    trace: Trace,
    current: Value,
    encoded_bytes: usize,
}

impl Recorder {
    pub fn new(initial_state: Value) -> Self {
        let trace = Trace {
            dsl_version: "1.0.0".into(),
            completeness: "complete".into(),
            initial_state: initial_state.clone(),
            steps: Vec::new(),
            checkpoints: vec![Checkpoint {
                cursor: 0,
                state: initial_state.clone(),
            }],
        };
        let encoded_bytes = serde_json::to_vec(&trace).map_or(usize::MAX, |bytes| bytes.len());
        Self {
            trace,
            current: initial_state,
            encoded_bytes,
        }
    }

    /// Preflight the complete candidate before changing either state or history.
    pub fn commit(
        &mut self,
        kind: &str,
        location: Value,
        after: Value,
        observations: Vec<Value>,
    ) -> Result<(), RecordError> {
        self.commit_with_write(kind, location, after, observations, None)
    }

    /// An actual executor write target preserves same-value writes that a
    /// before/after state diff alone cannot identify. It is never inferred.
    pub fn commit_with_write(
        &mut self,
        kind: &str,
        location: Value,
        after: Value,
        observations: Vec<Value>,
        write: Option<(String, usize)>,
    ) -> Result<(), RecordError> {
        if self.len() >= MAX_STEPS {
            return Err(RecordError::StepLimit);
        }
        if !step_kind(kind)
            || validate_state(&after, None).is_err()
            || validate_state(&self.current, None).is_err()
            || validate_location(&location, None).is_err()
        {
            return Err(RecordError::Invalid);
        }
        let mut changes = diff(&self.current, &after).map_err(|_| RecordError::Invalid)?;
        if let Some((object_id, at)) = write {
            if !matches!(kind, "value.initialize" | "value.write") {
                return Err(RecordError::Invalid);
            }
            let previous = array(&self.current["objects"])
                .map_err(|_| RecordError::Invalid)?
                .iter()
                .find(|object| object["id"] == object_id)
                .ok_or(RecordError::Invalid)?;
            let next = array(&after["objects"])
                .map_err(|_| RecordError::Invalid)?
                .iter()
                .find(|object| object["id"] == object_id)
                .ok_or(RecordError::Invalid)?;
            if previous["defaultValue"] != next["defaultValue"] {
                return Err(RecordError::Invalid);
            }
            let previous_value = effective(previous, at).map_err(|_| RecordError::Invalid)?;
            let next_value = effective(next, at).map_err(|_| RecordError::Invalid)?;
            if !changes.iter().any(|change| {
                change["op"] == "cell" && change["objectId"] == object_id && change["index"] == at
            }) {
                let change = json!({"op":"cell","objectId":object_id,"index":at,"before":previous_value,"after":next_value});
                // Record changes precede cells; singleton/control changes follow.
                let position = changes
                    .iter()
                    .position(|change| !matches!(change["op"].as_str(), Some("record" | "cell")))
                    .unwrap_or(changes.len());
                changes.insert(position, change);
            }
        }
        let step = Step {
            seq: self.len() + 1,
            kind: kind.into(),
            location,
            changes,
            observations,
        };
        // Encode only the newly retained data. Existing steps are never encoded
        // again for a candidate, including candidates rejected at the boundary.
        let step_bytes = serde_json::to_vec(&step)
            .map_err(|_| RecordError::Invalid)?
            .len();
        let checkpoint = step.seq.is_multiple_of(128).then(|| Checkpoint {
            cursor: step.seq,
            state: after.clone(),
        });
        let checkpoint_bytes = checkpoint
            .as_ref()
            .map(|point| serde_json::to_vec(point).map(|bytes| bytes.len()))
            .transpose()
            .map_err(|_| RecordError::Invalid)?;
        let addition = step_bytes
            + usize::from(!self.trace.steps.is_empty())
            + checkpoint_bytes.map_or(0, |bytes| bytes + 1);
        let total = self
            .encoded_bytes
            .checked_add(addition)
            .ok_or(RecordError::ResultLimit {
                used: self.encoded_bytes,
                attempted: usize::MAX,
            })?;
        if total > MAX_TRACE_BYTES {
            return Err(RecordError::ResultLimit {
                used: self.encoded_bytes,
                attempted: total,
            });
        }
        self.encoded_bytes = total;
        self.trace.steps.push(step);
        if let Some(checkpoint) = checkpoint {
            self.trace.checkpoints.push(checkpoint);
        }
        self.current = after;
        Ok(())
    }

    pub fn finish(mut self, complete: bool) -> Trace {
        self.trace.completeness = if complete { "complete" } else { "prefix" }.into();
        self.trace
    }

    pub fn state(&self) -> &Value {
        &self.current
    }
    pub fn len(&self) -> usize {
        self.trace.steps.len()
    }
    pub fn is_empty(&self) -> bool {
        self.trace.steps.is_empty()
    }
}

fn ensure(condition: bool, message: &'static str) -> Checked<()> {
    if condition {
        Ok(())
    } else {
        Err(TraceError(message))
    }
}

fn keys(value: &Value, names: &[&str]) -> Checked<()> {
    let object = value.as_object().ok_or(TraceError("expected object"))?;
    ensure(
        object.len() == names.len() && names.iter().all(|name| object.contains_key(*name)),
        "unexpected or missing field",
    )
}

fn string(value: &Value) -> Checked<&str> {
    value.as_str().ok_or(TraceError("expected string"))
}
fn uint(value: &Value) -> Checked<u64> {
    let number = value
        .as_u64()
        .ok_or(TraceError("expected unsigned integer"))?;
    ensure(number <= MAX_SAFE, "unsafe integer")?;
    Ok(number)
}
fn index(value: &Value) -> Checked<usize> {
    usize::try_from(uint(value)?).map_err(|_| TraceError("index overflow"))
}
fn int32(value: &Value) -> Checked<i32> {
    value
        .as_i64()
        .and_then(|n| i32::try_from(n).ok())
        .ok_or(TraceError("expected int32"))
}
fn nullable_int(value: &Value) -> Checked<()> {
    if value.is_null() {
        Ok(())
    } else {
        int32(value).map(|_| ())
    }
}
fn array(value: &Value) -> Checked<&Vec<Value>> {
    value.as_array().ok_or(TraceError("expected array"))
}
fn id_number(value: &Value, prefix: char) -> Checked<u64> {
    let value = string(value)?;
    ensure(
        value.len() >= 2 && value.len() <= 96 && value.starts_with(prefix),
        "invalid identifier",
    )?;
    let digits = &value[1..];
    ensure(
        !digits.starts_with('0') && digits.bytes().all(|b| b.is_ascii_digit()),
        "invalid identifier",
    )?;
    let number = digits
        .parse::<u64>()
        .map_err(|_| TraceError("identifier overflow"))?;
    ensure(number > 0 && number <= MAX_SAFE, "identifier overflow")?;
    Ok(number)
}
fn node(value: &Value, nodes: Option<&Nodes<'_>>, kind: Option<NodeKind>) -> Checked<()> {
    id_number(value, 'n')?;
    if let Some(nodes) = nodes {
        let found = nodes
            .get(string(value)?)
            .ok_or(TraceError("unknown source node"))?;
        if let Some(kind) = kind {
            ensure(found.kind == kind, "wrong source node kind")?;
        }
    }
    Ok(())
}
type Nodes<'a> = BTreeMap<&'a str, &'a NodeMapEntry>;

fn step_kind(kind: &str) -> bool {
    matches!(
        kind,
        "program.enter"
            | "object.declare"
            | "value.initialize"
            | "value.write"
            | "condition"
            | "scope.enter"
            | "scope.exit"
            | "output.append"
            | "control.jump"
            | "program.return"
            | "nop"
    )
}

fn validate_location(value: &Value, nodes: Option<&Nodes<'_>>) -> Checked<()> {
    match string(&value["kind"])? {
        "source" => {
            let object = value.as_object().ok_or(TraceError("location object"))?;
            ensure(object.len() == 3 || object.len() == 4, "location fields")?;
            ensure(
                object
                    .keys()
                    .all(|k| matches!(k.as_str(), "kind" | "nodeId" | "edge" | "byteRange")),
                "location fields",
            )?;
            node(&value["nodeId"], nodes, None)?;
            ensure(
                matches!(string(&value["edge"])?, "start" | "whole" | "end"),
                "location edge",
            )?;
            if let Some(range) = value.get("byteRange") {
                keys(range, &["start", "end"])?;
                ensure(
                    uint(&range["start"])? <= uint(&range["end"])?
                        && uint(&range["end"])? <= 32_768,
                    "location range",
                )?;
            }
        }
        "synthetic" => {
            let object = value.as_object().ok_or(TraceError("location object"))?;
            ensure(object.len() == 2 || object.len() == 3, "synthetic fields")?;
            ensure(
                object
                    .keys()
                    .all(|k| matches!(k.as_str(), "kind" | "reason" | "anchorNodeId")),
                "synthetic fields",
            )?;
            ensure(
                matches!(
                    string(&value["reason"])?,
                    "initial-state"
                        | "implicit-return"
                        | "pre-execution"
                        | "adapter-cancel"
                        | "adapter-deadline"
                        | "module-load"
                        | "worker-failure"
                        | "protocol-validation"
                        | "encoding-failure"
                ),
                "synthetic reason",
            )?;
            if let Some(anchor) = value.get("anchorNodeId") {
                node(anchor, nodes, None)?;
            }
        }
        _ => return Err(TraceError("unknown location")),
    }
    Ok(())
}

fn validate_record(table: &str, value: &Value, nodes: Option<&Nodes<'_>>) -> Checked<()> {
    match table {
        "frames" => {
            keys(
                value,
                &["id", "functionNodeId", "parentFrameId", "scopeIds"],
            )?;
            id_number(&value["id"], 'f')?;
            node(&value["functionNodeId"], nodes, Some(NodeKind::Function))?;
            ensure(value["parentFrameId"].is_null(), "P0 parent frame")?;
            ids(&value["scopeIds"], 's')?;
        }
        "scopes" => {
            keys(
                value,
                &[
                    "id",
                    "frameId",
                    "parentScopeId",
                    "nodeId",
                    "kind",
                    "objectIds",
                ],
            )?;
            id_number(&value["id"], 's')?;
            id_number(&value["frameId"], 'f')?;
            if !value["parentScopeId"].is_null() {
                id_number(&value["parentScopeId"], 's')?;
            }
            ensure(
                matches!(string(&value["kind"])?, "main" | "block" | "for"),
                "scope kind",
            )?;
            node(
                &value["nodeId"],
                nodes,
                Some(if value["kind"] == "for" {
                    NodeKind::For
                } else {
                    NodeKind::Block
                }),
            )?;
            ids(&value["objectIds"], 'o')?;
        }
        "objects" => {
            keys(
                value,
                &[
                    "id",
                    "declarationNodeId",
                    "frameId",
                    "scopeId",
                    "name",
                    "kind",
                    "length",
                    "baseAddress",
                    "defaultValue",
                    "cells",
                ],
            )?;
            id_number(&value["id"], 'o')?;
            id_number(&value["frameId"], 'f')?;
            id_number(&value["scopeId"], 's')?;
            node(
                &value["declarationNodeId"],
                nodes,
                Some(NodeKind::Declaration),
            )?;
            let name = string(&value["name"])?;
            ensure(
                !name.is_empty()
                    && name.len() <= 32_768
                    && name.bytes().enumerate().all(|(i, c)| {
                        c == b'_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit())
                    }),
                "object name",
            )?;
            let length = uint(&value["length"])?;
            let kind = string(&value["kind"])?;
            ensure(
                matches!(kind, "int" | "int-array")
                    && (1..=262_144).contains(&length)
                    && (kind != "int" || length == 1),
                "object kind/length",
            )?;
            let base = uint(&value["baseAddress"])?;
            ensure(base >= 4096 && base % 4 == 0, "object address")?;
            nullable_int(&value["defaultValue"])?;
            let cells = array(&value["cells"])?;
            ensure(cells.len() <= length as usize, "cell count")?;
            let mut previous = None;
            for cell in cells {
                keys(cell, &["index", "value"])?;
                let at = uint(&cell["index"])?;
                ensure(
                    at < length && previous.is_none_or(|previous| previous < at),
                    "cell order/index",
                )?;
                int32(&cell["value"])?;
                ensure(
                    cell["value"] != value["defaultValue"],
                    "redundant sparse cell",
                )?;
                previous = Some(at);
            }
        }
        _ => return Err(TraceError("unknown record table")),
    }
    Ok(())
}

fn ids(value: &Value, prefix: char) -> Checked<()> {
    let mut seen = BTreeSet::new();
    for item in array(value)? {
        id_number(item, prefix)?;
        ensure(seen.insert(string(item)?), "duplicate reference")?;
    }
    Ok(())
}

fn validate_singleton(name: &str, value: &Value, nodes: Option<&Nodes<'_>>) -> Checked<()> {
    match name {
        "control" => {
            keys(
                value,
                &[
                    "phase",
                    "nextNodeId",
                    "activeFrameId",
                    "returnValue",
                    "flowStack",
                ],
            )?;
            ensure(
                matches!(string(&value["phase"])?, "ready" | "running" | "returned"),
                "control phase",
            )?;
            if !value["nextNodeId"].is_null() {
                node(&value["nextNodeId"], nodes, None)?;
            }
            if !value["activeFrameId"].is_null() {
                id_number(&value["activeFrameId"], 'f')?;
            }
            nullable_int(&value["returnValue"])?;
            let flows = array(&value["flowStack"])?;
            ensure(flows.len() <= 64, "flow depth")?;
            for flow in flows {
                keys(flow, &["nodeId", "stage", "iteration"])?;
                node(&flow["nodeId"], nodes, None)?;
                ensure(
                    matches!(
                        string(&flow["stage"])?,
                        "block" | "init" | "condition" | "body" | "update"
                    ),
                    "flow stage",
                )?;
                uint(&flow["iteration"])?;
            }
        }
        "allocator" => {
            keys(
                value,
                &[
                    "nextAddress",
                    "liveBytes",
                    "nextObject",
                    "nextScope",
                    "nextFrame",
                ],
            )?;
            ensure(
                uint(&value["nextAddress"])? >= 4096 && uint(&value["nextAddress"])? % 4 == 0,
                "allocator address",
            )?;
            ensure(
                uint(&value["liveBytes"])? <= 1_048_576 && uint(&value["liveBytes"])? % 4 == 0,
                "live bytes",
            )?;
            for name in ["nextObject", "nextScope", "nextFrame"] {
                ensure(uint(&value[name])? > 0, "allocator identity")?;
            }
        }
        "counters" => {
            keys(
                value,
                &["comparisons", "scalarWrites", "arrayWrites", "swaps"],
            )?;
            for name in ["comparisons", "scalarWrites", "arrayWrites", "swaps"] {
                uint(&value[name])?;
            }
        }
        _ => return Err(TraceError("unknown singleton")),
    }
    Ok(())
}

fn validate_state(state: &Value, nodes: Option<&Nodes<'_>>) -> Checked<()> {
    keys(
        state,
        &[
            "frames",
            "scopes",
            "objects",
            "control",
            "allocator",
            "output",
            "counters",
        ],
    )?;
    let frames = array(&state["frames"])?;
    let scopes = array(&state["scopes"])?;
    let objects = array(&state["objects"])?;
    ensure(
        frames.len() <= 1 && scopes.len() <= 64 && objects.len() <= 262_144,
        "state table limits",
    )?;
    for name in ["control", "allocator", "counters"] {
        validate_singleton(name, &state[name], nodes)?;
    }
    ensure(string(&state["output"])?.len() <= 16_384, "output bytes")?;
    let mut maps: BTreeMap<&str, BTreeMap<&str, &Value>> = BTreeMap::new();
    for (table, records) in [("frames", frames), ("scopes", scopes), ("objects", objects)] {
        let mut entries = BTreeMap::new();
        for record in records {
            validate_record(table, record, nodes)?;
            ensure(
                entries.insert(string(&record["id"])?, record).is_none(),
                "duplicate state identity",
            )?;
        }
        maps.insert(table, entries);
    }
    let frame_map = &maps["frames"];
    let scope_map = &maps["scopes"];
    let mut ranges = Vec::new();
    let mut live_bytes = 0;
    for frame in frames {
        let owned: Vec<_> = scopes
            .iter()
            .filter(|scope| scope["frameId"] == frame["id"])
            .map(|scope| scope["id"].clone())
            .collect();
        ensure(
            frame["scopeIds"] == Value::Array(owned),
            "frame scope order",
        )?;
        ensure(
            id_number(&frame["id"], 'f')? < uint(&state["allocator"]["nextFrame"])?,
            "frame allocator identity",
        )?;
    }
    for (position, scope) in scopes.iter().enumerate() {
        ensure(
            frame_map.contains_key(string(&scope["frameId"])?),
            "dangling scope frame",
        )?;
        if position == 0 {
            ensure(
                scope["kind"] == "main" && scope["parentScopeId"].is_null(),
                "main scope root",
            )?;
        } else {
            ensure(
                scope["kind"] != "main" && scope["parentScopeId"] == scopes[position - 1]["id"],
                "scope stack parent",
            )?;
        }
        ensure(
            id_number(&scope["id"], 's')? < uint(&state["allocator"]["nextScope"])?,
            "scope allocator identity",
        )?;
        let owned: Vec<_> = objects
            .iter()
            .filter(|object| object["scopeId"] == scope["id"])
            .map(|object| object["id"].clone())
            .collect();
        ensure(
            scope["objectIds"] == Value::Array(owned),
            "scope object order",
        )?;
        let mut seen = BTreeSet::from([string(&scope["id"])?]);
        let mut parent = &scope["parentScopeId"];
        while !parent.is_null() {
            let id = string(parent)?;
            ensure(seen.insert(id), "scope cycle")?;
            let record = scope_map
                .get(id)
                .ok_or(TraceError("dangling scope parent"))?;
            ensure(record["frameId"] == scope["frameId"], "scope parent frame")?;
            parent = &record["parentScopeId"];
        }
    }
    for object in objects {
        let scope = scope_map
            .get(string(&object["scopeId"])?)
            .ok_or(TraceError("dangling object scope"))?;
        ensure(
            frame_map.contains_key(string(&object["frameId"])?)
                && scope["frameId"] == object["frameId"],
            "dangling object frame",
        )?;
        ensure(
            id_number(&object["id"], 'o')? < uint(&state["allocator"]["nextObject"])?,
            "object allocator identity",
        )?;
        let bytes = uint(&object["length"])? * 4;
        live_bytes += bytes;
        let base = uint(&object["baseAddress"])?;
        let end = base
            .checked_add(bytes)
            .ok_or(TraceError("address overflow"))?;
        ensure(
            end <= uint(&state["allocator"]["nextAddress"])?,
            "object outside allocator",
        )?;
        ranges.push((base, end));
    }
    ranges.sort_unstable();
    ensure(
        ranges.windows(2).all(|pair| pair[0].1 <= pair[1].0),
        "overlapping object addresses",
    )?;
    ensure(
        live_bytes == uint(&state["allocator"]["liveBytes"])?,
        "live bytes mismatch",
    )?;
    let control = &state["control"];
    match string(&control["phase"])? {
        "ready" => ensure(
            frames.is_empty()
                && scopes.is_empty()
                && objects.is_empty()
                && control["activeFrameId"].is_null()
                && control["returnValue"].is_null()
                && array(&control["flowStack"])?.is_empty(),
            "ready state",
        )?,
        "running" => ensure(
            frames.len() == 1
                && !scopes.is_empty()
                && frames[0]["id"] == "f1"
                && control["activeFrameId"] == frames[0]["id"]
                && control["returnValue"].is_null(),
            "running state",
        )?,
        "returned" => {
            ensure(
                frames.is_empty()
                    && scopes.is_empty()
                    && objects.is_empty()
                    && control["activeFrameId"].is_null()
                    && control["nextNodeId"].is_null()
                    && array(&control["flowStack"])?.is_empty(),
                "returned state",
            )?;
            int32(&control["returnValue"])?;
        }
        _ => return Err(TraceError("control phase")),
    }
    Ok(())
}

fn effective(object: &Value, at: usize) -> Checked<&Value> {
    ensure(at < index(&object["length"])?, "cell outside object")?;
    let cells = array(&object["cells"])?;
    match cells.binary_search_by_key(&at, |cell| {
        cell["index"].as_u64().unwrap_or(u64::MAX) as usize
    }) {
        Ok(found) => Ok(&cells[found]["value"]),
        Err(_) => Ok(&object["defaultValue"]),
    }
}

fn diff(before: &Value, after: &Value) -> Checked<Vec<Value>> {
    let mut changes = Vec::new();
    for table in ["frames", "scopes", "objects"] {
        let old = array(&before[table])?;
        let new = array(&after[table])?;
        let mut working = old.clone();
        // Remove back to front so every retained record keeps its real index.
        for at in (0..working.len()).rev() {
            if !new.iter().any(|record| record["id"] == working[at]["id"]) {
                let record = working.remove(at);
                changes.push(json!({"op":"record","table":table,"id":record["id"],"index":at,"before":record,"after":null}));
            }
        }
        for (at, record) in new.iter().enumerate() {
            if at >= working.len() || working[at]["id"] != record["id"] {
                ensure(
                    !working
                        .iter()
                        .any(|existing| existing["id"] == record["id"]),
                    "table reordering",
                )?;
                changes.push(json!({"op":"record","table":table,"id":record["id"],"index":at,"before":null,"after":record}));
                working.insert(at, record.clone());
            } else if working[at] != *record {
                let previous = &working[at];
                if table == "objects" && previous["defaultValue"] == record["defaultValue"] {
                    for field in [
                        "id",
                        "declarationNodeId",
                        "frameId",
                        "scopeId",
                        "name",
                        "kind",
                        "length",
                        "baseAddress",
                    ] {
                        ensure(previous[field] == record[field], "object identity changed")?;
                    }
                    let indices: BTreeSet<_> = array(&previous["cells"])?
                        .iter()
                        .chain(array(&record["cells"])?.iter())
                        .map(|cell| index(&cell["index"]))
                        .collect::<Checked<_>>()?;
                    for cell_index in indices {
                        let old_value = effective(previous, cell_index)?;
                        let new_value = effective(record, cell_index)?;
                        if old_value != new_value {
                            changes.push(json!({"op":"cell","objectId":record["id"],"index":cell_index,"before":old_value,"after":new_value}));
                        }
                    }
                } else {
                    changes.push(json!({"op":"record","table":table,"id":record["id"],"index":at,"before":previous,"after":record}));
                }
                working[at] = record.clone();
            }
        }
        ensure(working == *new, "table diff mismatch")?;
    }
    for op in ["control", "allocator", "counters"] {
        if before[op] != after[op] {
            changes.push(json!({"op":op,"before":before[op],"after":after[op]}));
        }
    }
    let old_output = string(&before["output"])?;
    let new_output = string(&after["output"])?;
    ensure(new_output.starts_with(old_output), "non-append output")?;
    if old_output != new_output {
        changes.push(json!({"op":"output","beforeBytes":old_output.len(),"afterBytes":new_output.len(),"append":&new_output[old_output.len()..]}));
    }
    Ok(changes)
}

fn object_identity(before: &Value, after: &Value) -> Checked<()> {
    for name in [
        "id",
        "declarationNodeId",
        "frameId",
        "scopeId",
        "name",
        "kind",
        "length",
        "baseAddress",
    ] {
        ensure(before[name] == after[name], "changed object identity")?;
    }
    Ok(())
}

fn apply_change(state: &mut Value, change: &Value, reverse: bool) -> Checked<()> {
    let op = string(&change["op"])?;
    let (before, after) = if reverse {
        (&change["after"], &change["before"])
    } else {
        (&change["before"], &change["after"])
    };
    match op {
        "record" => {
            keys(change, &["op", "table", "id", "index", "before", "after"])?;
            let table = string(&change["table"])?;
            let prefix = match table {
                "frames" => 'f',
                "scopes" => 's',
                "objects" => 'o',
                _ => return Err(TraceError("record table")),
            };
            id_number(&change["id"], prefix)?;
            let at = index(&change["index"])?;
            ensure(
                at <= match table {
                    "frames" => 0,
                    "scopes" => 63,
                    _ => 262_143,
                },
                "record index",
            )?;
            ensure(!before.is_null() || !after.is_null(), "empty record change")?;
            for record in [before, after] {
                if !record.is_null() {
                    validate_record(table, record, None)?;
                    ensure(record["id"] == change["id"], "record identity mismatch")?;
                }
            }
            if table == "objects" && !before.is_null() && !after.is_null() {
                object_identity(before, after)?;
            }
            if table == "frames" && !before.is_null() && !after.is_null() {
                for field in ["id", "functionNodeId", "parentFrameId"] {
                    ensure(before[field] == after[field], "changed frame identity")?;
                }
            }
            if table == "scopes" && !before.is_null() && !after.is_null() {
                for field in ["id", "frameId", "parentScopeId", "nodeId", "kind"] {
                    ensure(before[field] == after[field], "changed scope identity")?;
                }
            }
            let records = state[table]
                .as_array_mut()
                .ok_or(TraceError("record table array"))?;
            ensure(at <= records.len(), "record index")?;
            if before.is_null() {
                ensure(
                    !records.iter().any(|record| record["id"] == change["id"]),
                    "duplicate record creation",
                )?;
                records.insert(at, after.clone());
            } else {
                ensure(records.get(at) == Some(before), "record before mismatch")?;
                if after.is_null() {
                    records.remove(at);
                } else {
                    records[at] = after.clone();
                }
            }
        }
        "cell" => {
            keys(change, &["op", "objectId", "index", "before", "after"])?;
            id_number(&change["objectId"], 'o')?;
            nullable_int(before)?;
            nullable_int(after)?;
            let at = index(&change["index"])?;
            let records = state["objects"]
                .as_array_mut()
                .ok_or(TraceError("object table"))?;
            let object = records
                .iter_mut()
                .find(|object| object["id"] == change["objectId"])
                .ok_or(TraceError("dangling cell object"))?;
            ensure(effective(object, at)? == before, "cell before mismatch")?;
            // A default int cannot represent a null exception in STEP-01.
            ensure(
                !after.is_null() || object["defaultValue"].is_null(),
                "null sparse exception",
            )?;
            let default = object["defaultValue"].clone();
            let cells = object["cells"]
                .as_array_mut()
                .ok_or(TraceError("cells array"))?;
            let position = cells.binary_search_by_key(&at, |cell| {
                cell["index"].as_u64().unwrap_or(u64::MAX) as usize
            });
            match position {
                Ok(position) => {
                    if after == &default {
                        cells.remove(position);
                    } else {
                        cells[position]["value"] = after.clone();
                    }
                }
                Err(position) => {
                    if after != &default {
                        cells.insert(position, json!({"index":at,"value":after}));
                    }
                }
            }
        }
        "control" | "allocator" | "counters" => {
            keys(change, &["op", "before", "after"])?;
            validate_singleton(op, before, None)?;
            validate_singleton(op, after, None)?;
            ensure(state[op] == *before, "singleton before mismatch")?;
            state[op] = after.clone();
        }
        "output" => {
            keys(change, &["op", "beforeBytes", "afterBytes", "append"])?;
            let old_bytes = index(&change["beforeBytes"])?;
            let new_bytes = index(&change["afterBytes"])?;
            let append = string(&change["append"])?;
            ensure(
                new_bytes <= 16_384 && new_bytes.checked_sub(old_bytes) == Some(append.len()),
                "output byte delta",
            )?;
            let current = string(&state["output"])?;
            let next = if reverse {
                ensure(
                    current.len() == new_bytes && current.ends_with(append),
                    "output reverse mismatch",
                )?;
                current
                    .get(..old_bytes)
                    .ok_or(TraceError("output UTF-8 boundary"))?
                    .to_owned()
            } else {
                ensure(current.len() == old_bytes, "output before mismatch")?;
                let mut next = current.to_owned();
                next.push_str(append);
                next
            };
            state["output"] = Value::String(next);
        }
        _ => return Err(TraceError("unknown change operation")),
    }
    Ok(())
}

/// Apply all changes transactionally; even a late failure leaves `state` intact.
pub fn apply_step(state: &mut Value, step: &Step, direction: Direction) -> Checked<()> {
    ensure(
        step.seq > 0 && step.seq <= MAX_STEPS && step_kind(&step.kind),
        "step sequence/kind",
    )?;
    validate_location(&step.location, None)?;
    validate_state(state, None)?;
    ensure(
        step.changes.len() <= 1_000_000 && step.observations.len() <= 1_000_000,
        "step item limit",
    )?;
    let mut candidate = state.clone();
    match direction {
        Direction::Forward => {
            for change in &step.changes {
                apply_change(&mut candidate, change, false)?;
            }
        }
        Direction::Backward => {
            for change in step.changes.iter().rev() {
                apply_change(&mut candidate, change, true)?;
            }
        }
    }
    validate_state(&candidate, None)?;
    *state = candidate;
    Ok(())
}

#[derive(Debug, Clone)]
struct Write {
    object: String,
    index: usize,
    before: Value,
    after: Value,
}

fn observation_math(operator: &str, operands: &[i32]) -> Checked<i32> {
    let first = i64::from(operands[0]);
    let second = operands.get(1).copied().map(i64::from);
    let value = match (operator, second) {
        ("+", None) => first,
        ("-", None) => -first,
        ("!", None) => i64::from(first == 0),
        ("+", Some(right)) => first + right,
        ("-", Some(right)) => first - right,
        ("*", Some(right)) => first * right,
        ("/", Some(right)) if right != 0 => first / right,
        ("%", Some(right)) if right != 0 && !(first == i64::from(i32::MIN) && right == -1) => {
            first % right
        }
        ("<", Some(right)) => i64::from(first < right),
        ("<=", Some(right)) => i64::from(first <= right),
        (">", Some(right)) => i64::from(first > right),
        (">=", Some(right)) => i64::from(first >= right),
        ("==", Some(right)) => i64::from(first == right),
        ("!=", Some(right)) => i64::from(first != right),
        ("&&", Some(right)) => i64::from(first != 0 && right != 0),
        ("||", Some(right)) => i64::from(first != 0 || right != 0),
        ("&&", None) if first == 0 => 0,
        ("||", None) if first != 0 => 1,
        _ => return Err(TraceError("invalid evaluate operands")),
    };
    i32::try_from(value).map_err(|_| TraceError("invalid evaluate result"))
}

fn descendant(child: &str, ancestor: &str, nodes: &Nodes<'_>) -> bool {
    let mut current = Some(child);
    let mut remaining = nodes.len() + 1;
    while let Some(id) = current {
        if id == ancestor {
            return true;
        }
        if remaining == 0 {
            return false;
        }
        remaining -= 1;
        current = nodes.get(id).and_then(|entry| entry.parent_id.as_deref());
    }
    false
}

fn validate_observations(
    step: &Step,
    before: &Value,
    nodes: Option<&Nodes<'_>>,
    writes: &BTreeMap<usize, Write>,
    swaps: &mut BTreeSet<(usize, usize)>,
) -> Checked<(u64, u64)> {
    let mut comparisons = 0;
    let mut swap_count = 0;
    let mut short_nodes = BTreeSet::new();
    for observation in &step.observations {
        node(&observation["nodeId"], nodes, None)?;
        match string(&observation["kind"])? {
            "read" => {
                keys(
                    observation,
                    &["kind", "nodeId", "objectId", "index", "value"],
                )?;
                id_number(&observation["objectId"], 'o')?;
                let at = index(&observation["index"])?;
                let object = array(&before["objects"])?
                    .iter()
                    .find(|object| object["id"] == observation["objectId"])
                    .ok_or(TraceError("dangling read object"))?;
                int32(&observation["value"])?;
                ensure(
                    effective(object, at)? == &observation["value"],
                    "read value mismatch",
                )?;
            }
            "evaluate" => {
                keys(
                    observation,
                    &["kind", "nodeId", "operator", "operands", "value"],
                )?;
                let operator = string(&observation["operator"])?;
                let operands = array(&observation["operands"])?;
                ensure(
                    !operands.is_empty() && operands.len() <= 2,
                    "evaluate arity",
                )?;
                let operands = operands.iter().map(int32).collect::<Checked<Vec<_>>>()?;
                ensure(
                    observation_math(operator, &operands)? == int32(&observation["value"])?,
                    "evaluate value mismatch",
                )?;
                if matches!(operator, "<" | "<=" | ">" | ">=" | "==" | "!=") {
                    comparisons += 1;
                }
                if matches!(operator, "&&" | "||") && operands.len() == 1 {
                    let matches = step
                        .observations
                        .iter()
                        .filter(|other| {
                            other["kind"] == "short-circuit"
                                && other["nodeId"] == observation["nodeId"]
                        })
                        .count();
                    ensure(matches == 1, "missing short circuit")?;
                }
            }
            "decision" => {
                keys(observation, &["kind", "nodeId", "value", "branch"])?;
                let value = int32(&observation["value"])?;
                ensure(
                    string(&observation["branch"])? == if value == 0 { "false" } else { "true" },
                    "decision branch mismatch",
                )?;
                ensure(step.kind == "condition", "decision outside condition")?;
            }
            "short-circuit" => {
                keys(observation, &["kind", "nodeId", "skippedNodeId"])?;
                node(&observation["skippedNodeId"], nodes, None)?;
                ensure(
                    short_nodes.insert(string(&observation["nodeId"])?),
                    "duplicate short circuit",
                )?;
                ensure(
                    observation["skippedNodeId"] != observation["nodeId"],
                    "self short circuit",
                )?;
                let matches = step
                    .observations
                    .iter()
                    .filter(|other| {
                        other["kind"] == "evaluate"
                            && other["nodeId"] == observation["nodeId"]
                            && matches!(other["operator"].as_str(), Some("&&" | "||"))
                            && other["operands"]
                                .as_array()
                                .is_some_and(|items| items.len() == 1)
                    })
                    .count();
                ensure(matches == 1, "short circuit without evaluate")?;
                if let Some(nodes) = nodes {
                    let skipped = string(&observation["skippedNodeId"])?;
                    ensure(
                        descendant(skipped, string(&observation["nodeId"])?, nodes),
                        "short circuit unrelated subtree",
                    )?;
                    ensure(
                        !step.observations.iter().any(|other| {
                            other["nodeId"]
                                .as_str()
                                .is_some_and(|id| descendant(id, skipped, nodes))
                        }),
                        "observed skipped subtree",
                    )?;
                }
            }
            "swap" => {
                keys(
                    observation,
                    &[
                        "kind",
                        "nodeId",
                        "objectId",
                        "indices",
                        "beforeValues",
                        "writeSeqs",
                    ],
                )?;
                id_number(&observation["objectId"], 'o')?;
                let indices = array(&observation["indices"])?;
                let values = array(&observation["beforeValues"])?;
                let sequences = array(&observation["writeSeqs"])?;
                ensure(
                    indices.len() == 2 && values.len() == 2 && sequences.len() == 2,
                    "swap arity",
                )?;
                let left = index(&indices[0])?;
                let right = index(&indices[1])?;
                let first = index(&sequences[0])?;
                let second = index(&sequences[1])?;
                ensure(
                    left != right
                        && first < second
                        && second == step.seq
                        && step.kind == "value.write",
                    "swap indices/sequences",
                )?;
                int32(&values[0])?;
                int32(&values[1])?;
                let first_write = writes
                    .get(&first)
                    .ok_or(TraceError("swap missing first write"))?;
                let second_write = writes
                    .get(&second)
                    .ok_or(TraceError("swap missing second write"))?;
                ensure(
                    first_write.object == string(&observation["objectId"])?
                        && second_write.object == first_write.object
                        && first_write.index == left
                        && second_write.index == right,
                    "swap write identity",
                )?;
                ensure(
                    first_write.before == values[0]
                        && second_write.before == values[1]
                        && first_write.after == values[1]
                        && second_write.after == values[0],
                    "swap write values",
                )?;
                // The same physical write cannot be reused to invent extra swaps.
                ensure(
                    !swaps
                        .iter()
                        .any(|(a, b)| [*a, *b].contains(&first) || [*a, *b].contains(&second)),
                    "reused swap write",
                )?;
                ensure(swaps.insert((first, second)), "duplicate swap")?;
                for (_, intermediate) in writes.range((first + 1)..second) {
                    ensure(
                        intermediate.object != first_write.object
                            || (intermediate.index != left && intermediate.index != right),
                        "intervening swap write",
                    )?;
                }
                swap_count += 1;
            }
            _ => return Err(TraceError("unknown observation kind")),
        }
    }
    let decisions = step
        .observations
        .iter()
        .filter(|observation| observation["kind"] == "decision")
        .count();
    ensure(
        decisions == usize::from(step.kind == "condition"),
        "condition decision count",
    )?;
    Ok((comparisons, swap_count))
}

fn validate_transition(
    step: &Step,
    before: &Value,
    after: &Value,
    writes: &mut BTreeMap<usize, Write>,
) -> Checked<(u64, u64)> {
    let mut scalar = 0;
    let mut arrays = 0;
    let mut cells = 0;
    let mut array_initializations = 0;
    let mut create_objects = 0_u64;
    let mut create_scopes = 0_u64;
    let mut create_frames = 0_u64;
    let mut allocated = 0_u64;
    let mut deleted_objects = 0;
    let mut deleted_scopes = 0;
    let mut deleted_frames = 0;
    for change in &step.changes {
        match string(&change["op"])? {
            "cell" => {
                ensure(
                    matches!(step.kind.as_str(), "value.initialize" | "value.write"),
                    "cell outside write",
                )?;
                let object = array(&before["objects"])?
                    .iter()
                    .find(|object| object["id"] == change["objectId"])
                    .ok_or(TraceError("write missing object"))?;
                ensure(!change["after"].is_null(), "forward uninitialization")?;
                if step.kind == "value.initialize" {
                    ensure(
                        change["before"].is_null() && object["kind"] == "int",
                        "scalar initialization",
                    )?;
                }
                if object["kind"] == "int" {
                    scalar += 1;
                } else {
                    arrays += 1;
                }
                cells += 1;
                if step.kind == "value.write" {
                    writes.insert(
                        step.seq,
                        Write {
                            object: string(&change["objectId"])?.into(),
                            index: index(&change["index"])?,
                            before: change["before"].clone(),
                            after: change["after"].clone(),
                        },
                    );
                }
            }
            "record" => {
                let table = string(&change["table"])?;
                let previous = &change["before"];
                let next = &change["after"];
                if previous.is_null() {
                    match table {
                        "objects" => {
                            ensure(
                                step.kind == "object.declare"
                                    && next["defaultValue"].is_null()
                                    && array(&next["cells"])?.is_empty(),
                                "object declaration boundary",
                            )?;
                            ensure(
                                id_number(&next["id"], 'o')?
                                    == uint(&before["allocator"]["nextObject"])? + create_objects
                                    && uint(&next["baseAddress"])?
                                        == uint(&before["allocator"]["nextAddress"])? + allocated,
                                "object creation sequence",
                            )?;
                            create_objects += 1;
                            allocated += uint(&next["length"])? * 4;
                        }
                        "scopes" => {
                            ensure(
                                matches!(step.kind.as_str(), "program.enter" | "scope.enter"),
                                "scope creation boundary",
                            )?;
                            ensure(
                                id_number(&next["id"], 's')?
                                    == uint(&before["allocator"]["nextScope"])? + create_scopes,
                                "scope creation sequence",
                            )?;
                            create_scopes += 1;
                        }
                        "frames" => {
                            ensure(step.kind == "program.enter", "frame creation boundary")?;
                            ensure(
                                id_number(&next["id"], 'f')?
                                    == uint(&before["allocator"]["nextFrame"])? + create_frames,
                                "frame creation sequence",
                            )?;
                            create_frames += 1;
                        }
                        _ => return Err(TraceError("record table")),
                    }
                } else if next.is_null() {
                    ensure(
                        matches!(
                            step.kind.as_str(),
                            "scope.exit" | "control.jump" | "program.return"
                        ),
                        "destruction boundary",
                    )?;
                    match table {
                        "objects" => deleted_objects += 1,
                        "scopes" => deleted_scopes += 1,
                        "frames" => {
                            ensure(step.kind == "program.return", "frame destruction boundary")?;
                            deleted_frames += 1;
                        }
                        _ => return Err(TraceError("record table")),
                    }
                } else if table == "objects" {
                    ensure(
                        step.kind == "value.initialize"
                            && previous["kind"] == "int-array"
                            && previous["defaultValue"].is_null()
                            && array(&previous["cells"])?.is_empty()
                            && next["defaultValue"] == 0,
                        "array initialization boundary",
                    )?;
                    arrays += uint(&next["length"])?;
                    array_initializations += 1;
                }
            }
            "output" => ensure(step.kind == "output.append", "output boundary")?,
            _ => {}
        }
    }
    let old_allocator = &before["allocator"];
    let new_allocator = &after["allocator"];
    for (field, increase) in [
        ("nextObject", create_objects),
        ("nextScope", create_scopes),
        ("nextFrame", create_frames),
        ("nextAddress", allocated),
    ] {
        ensure(
            uint(&new_allocator[field])? == uint(&old_allocator[field])? + increase,
            "allocator transition",
        )?;
    }
    match step.kind.as_str() {
        "program.enter" => ensure(
            before["control"]["phase"] == "ready"
                && after["control"]["phase"] == "running"
                && create_frames == 1
                && create_scopes == 1
                && create_objects == 0
                && after["scopes"][0]["kind"] == "main",
            "program enter boundary",
        )?,
        "object.declare" => ensure(
            create_objects == 1 && cells == 0 && array_initializations == 0,
            "declaration object count",
        )?,
        "value.initialize" => ensure(
            cells + array_initializations == 1,
            "initialization target count",
        )?,
        "value.write" => ensure(
            cells == 1 && array_initializations == 0,
            "write target count",
        )?,
        "scope.enter" => ensure(
            create_scopes == 1 && create_objects == 0 && create_frames == 0,
            "scope enter boundary",
        )?,
        "scope.exit" => {
            ensure(
                deleted_scopes == 1 && deleted_frames == 0,
                "scope exit boundary",
            )?;
            let old_scopes = array(&before["scopes"])?;
            let new_scopes = array(&after["scopes"])?;
            ensure(
                old_scopes.len() >= 2
                    && new_scopes.len() + 1 == old_scopes.len()
                    && old_scopes
                        .last()
                        .is_some_and(|scope| scope["kind"] != "main")
                    && old_scopes[..new_scopes.len()] == new_scopes[..],
                "scope exit stack",
            )?;
        }
        "program.return" => ensure(
            before["control"]["phase"] == "running"
                && after["control"]["phase"] == "returned"
                && deleted_frames == 1
                && deleted_scopes > 0,
            "program return boundary",
        )?,
        "control.jump" => ensure(deleted_frames == 0, "jump boundary")?,
        "condition" | "output.append" | "nop" => ensure(
            create_frames + create_scopes + create_objects == 0
                && deleted_objects + deleted_scopes + deleted_frames == 0
                && cells == 0
                && array_initializations == 0,
            "non-write boundary",
        )?,
        _ => return Err(TraceError("step kind")),
    }
    if step.kind != "program.enter" && step.kind != "program.return" {
        ensure(
            before["control"]["phase"] == "running" && after["control"]["phase"] == "running",
            "running step phase",
        )?;
    }
    Ok((scalar, arrays))
}

fn validate_initial(state: &Value, nodes: Option<&Nodes<'_>>) -> Checked<()> {
    validate_state(state, nodes)?;
    ensure(
        state["control"]["phase"] == "ready" && string(&state["output"])?.is_empty(),
        "initial state",
    )?;
    node(
        &state["control"]["nextNodeId"],
        nodes,
        Some(NodeKind::Function),
    )?;
    ensure(
        state["allocator"]
            == json!({"nextAddress":4096,"liveBytes":0,"nextObject":1,"nextScope":1,"nextFrame":1}),
        "initial allocator",
    )?;
    ensure(
        state["counters"] == json!({"comparisons":0,"scalarWrites":0,"arrayWrites":0,"swaps":0}),
        "initial counters",
    )
}

fn validate_body(trace: &Trace, nodes: Option<&Nodes<'_>>) -> Checked<()> {
    ensure(trace.dsl_version == "1.0.0", "unsupported DSL version")?;
    ensure(
        matches!(trace.completeness.as_str(), "complete" | "prefix"),
        "trace completeness",
    )?;
    ensure(trace.steps.len() <= MAX_STEPS, "step limit")?;
    ensure(
        serde_json::to_vec(trace)
            .map_err(|_| TraceError("trace encoding"))?
            .len()
            <= MAX_TRACE_BYTES,
        "trace byte limit",
    )?;
    validate_initial(&trace.initial_state, nodes)?;
    ensure(
        trace.checkpoints.len() == trace.steps.len() / 128 + 1,
        "checkpoint count",
    )?;
    for (i, checkpoint) in trace.checkpoints.iter().enumerate() {
        ensure(checkpoint.cursor == i * 128, "checkpoint cadence")?;
    }
    ensure(
        trace.checkpoints[0].state == trace.initial_state,
        "initial checkpoint mismatch",
    )?;
    let mut state = trace.initial_state.clone();
    let mut writes = BTreeMap::new();
    let mut swaps = BTreeSet::new();
    for (at, step) in trace.steps.iter().enumerate() {
        ensure(
            step.seq == at + 1 && step_kind(&step.kind),
            "step sequence/kind",
        )?;
        validate_location(&step.location, nodes)?;
        let before = state.clone();
        apply_step(&mut state, step, Direction::Forward)?;
        validate_state(&state, nodes)?;
        let (scalar, arrays) = validate_transition(step, &before, &state, &mut writes)?;
        let (comparisons, swap_count) =
            validate_observations(step, &before, nodes, &writes, &mut swaps)?;
        for (name, delta) in [
            ("scalarWrites", scalar),
            ("arrayWrites", arrays),
            ("comparisons", comparisons),
            ("swaps", swap_count),
        ] {
            ensure(
                uint(&state["counters"][name])? == uint(&before["counters"][name])? + delta,
                "counter/observation mismatch",
            )?;
        }
        if step.seq % 128 == 0 {
            ensure(
                trace.checkpoints[step.seq / 128].state == state,
                "checkpoint projection mismatch",
            )?;
        }
    }
    if trace.completeness == "complete" {
        ensure(
            trace.steps.len() >= 2
                && trace
                    .steps
                    .last()
                    .is_some_and(|step| step.kind == "program.return")
                && state["control"]["phase"] == "returned",
            "incomplete success",
        )?;
    } else {
        ensure(state["control"]["phase"] != "returned", "returned prefix")?;
    }
    Ok(())
}

/// Validate all source references and the full reversible state projection.
pub fn validate_trace(trace: &Trace, node_map: &[NodeMapEntry]) -> Checked<()> {
    let mut nodes = Nodes::new();
    for (at, entry) in node_map.iter().enumerate() {
        ensure(
            entry.node_id == format!("n{}", at + 1)
                && entry.byte_range.start <= entry.byte_range.end
                && entry.byte_range.end <= 32_768,
            "node map identity/range",
        )?;
        if let Some(parent) = &entry.parent_id {
            let parent = nodes
                .get(parent.as_str())
                .ok_or(TraceError("node map parent"))?;
            ensure(
                parent.byte_range.start <= entry.byte_range.start
                    && entry.byte_range.end <= parent.byte_range.end,
                "node map containment",
            )?;
        }
        ensure(
            nodes.insert(&entry.node_id, entry).is_none(),
            "duplicate node map identity",
        )?;
    }
    validate_body(trace, Some(&nodes))
}

/// Check imported history before trusting any checkpoint, then seek from the
/// nearest checkpoint with at most 127 forward applications. Validation itself
/// is linear; a future player can retain a once-validated history wrapper.
pub fn restore(trace: &Trace, cursor: usize) -> Checked<Value> {
    ensure(cursor <= trace.steps.len(), "cursor outside trace")?;
    validate_body(trace, None)?;
    let checkpoint = &trace.checkpoints[cursor / 128];
    let mut state = checkpoint.state.clone();
    for step in &trace.steps[checkpoint.cursor..cursor] {
        apply_step(&mut state, step, Direction::Forward)?;
    }
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn initial() -> Value {
        json!({"frames":[],"scopes":[],"objects":[],"control":{"phase":"ready","nextNodeId":"n1","activeFrameId":null,"returnValue":null,"flowStack":[]},"allocator":{"nextAddress":4096,"liveBytes":0,"nextObject":1,"nextScope":1,"nextFrame":1},"output":"","counters":{"comparisons":0,"scalarWrites":0,"arrayWrites":0,"swaps":0}})
    }

    fn entered() -> Value {
        let mut state = initial();
        state["frames"] =
            json!([{"id":"f1","functionNodeId":"n1","parentFrameId":null,"scopeIds":["s1"]}]);
        state["scopes"] = json!([{"id":"s1","frameId":"f1","parentScopeId":null,"nodeId":"n2","kind":"main","objectIds":[]}]);
        state["control"]["phase"] = json!("running");
        state["control"]["activeFrameId"] = json!("f1");
        state["control"]["nextNodeId"] = json!("n3");
        state["allocator"]["nextScope"] = json!(2);
        state["allocator"]["nextFrame"] = json!(2);
        state
    }

    fn location() -> Value {
        json!({"kind":"source","nodeId":"n1","edge":"whole"})
    }

    #[test]
    fn entry_delta_reverses_every_singleton_and_table() {
        let mut recorder = Recorder::new(initial());
        recorder
            .commit("program.enter", location(), entered(), vec![])
            .unwrap();
        let trace = recorder.finish(false);
        let mut state = initial();
        apply_step(&mut state, &trace.steps[0], Direction::Forward).unwrap();
        assert_eq!(state, entered());
        apply_step(&mut state, &trace.steps[0], Direction::Backward).unwrap();
        assert_eq!(state, initial());
        assert_eq!(restore(&trace, 1).unwrap(), entered());
    }

    #[test]
    fn late_operation_failure_is_transactional_in_both_directions() {
        let mut recorder = Recorder::new(initial());
        recorder
            .commit("program.enter", location(), entered(), vec![])
            .unwrap();
        let mut step = recorder.finish(false).steps.remove(0);
        step.changes
            .push(json!({"op":"output","beforeBytes":1,"afterBytes":2,"append":"x"}));
        let mut state = initial();
        assert!(apply_step(&mut state, &step, Direction::Forward).is_err());
        assert_eq!(state, initial());
        let mut state = entered();
        assert!(apply_step(&mut state, &step, Direction::Backward).is_err());
        assert_eq!(state, entered());
    }

    #[test]
    fn unchanged_write_hint_retains_a_real_cell_write() {
        let mut before = entered();
        before["objects"] = json!([{"id":"o1","declarationNodeId":"n3","frameId":"f1","scopeId":"s1","name":"x","kind":"int","length":1,"baseAddress":4096,"defaultValue":null,"cells":[{"index":0,"value":7}]}]);
        before["scopes"][0]["objectIds"] = json!(["o1"]);
        before["allocator"]["nextAddress"] = json!(4100);
        before["allocator"]["liveBytes"] = json!(4);
        before["allocator"]["nextObject"] = json!(2);
        let mut after = before.clone();
        after["counters"]["scalarWrites"] = json!(1);
        let mut recorder = Recorder::new(before.clone());
        recorder
            .commit_with_write(
                "value.write",
                location(),
                after.clone(),
                vec![],
                Some(("o1".into(), 0)),
            )
            .unwrap();
        let trace = recorder.finish(false);
        let cells: Vec<_> = trace.steps[0]
            .changes
            .iter()
            .filter(|change| change["op"] == "cell")
            .collect();
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0]["before"], 7);
        assert_eq!(cells[0]["after"], 7);
        let mut state = before.clone();
        apply_step(&mut state, &trace.steps[0], Direction::Forward).unwrap();
        assert_eq!(state, after);
        apply_step(&mut state, &trace.steps[0], Direction::Backward).unwrap();
        assert_eq!(state, before);
    }

    #[test]
    fn invalid_candidate_does_not_mutate_recorder() {
        let mut recorder = Recorder::new(initial());
        let mut invalid = entered();
        invalid["scopes"] = json!([]);
        invalid["frames"][0]["scopeIds"] = json!([]);
        assert_eq!(
            recorder.commit("program.enter", location(), invalid, vec![]),
            Err(RecordError::Invalid)
        );
        assert_eq!(recorder.state(), &initial());
        assert!(recorder.is_empty());
    }

    #[test]
    fn output_uses_utf8_bytes_and_verified_suffix() {
        let mut before = entered();
        let step = Step {
            seq: 1,
            kind: "output.append".into(),
            location: location(),
            changes: vec![json!({"op":"output","beforeBytes":0,"afterBytes":7,"append":"中文\n"})],
            observations: vec![],
        };
        apply_step(&mut before, &step, Direction::Forward).unwrap();
        assert_eq!(before["output"], "中文\n");
        apply_step(&mut before, &step, Direction::Backward).unwrap();
        assert_eq!(before, entered());
        let mut bad = step;
        bad.changes[0]["afterBytes"] = json!(3);
        assert!(apply_step(&mut before, &bad, Direction::Forward).is_err());
        assert_eq!(before, entered());
    }

    #[test]
    fn damaged_checkpoint_and_unknown_serialized_fields_are_rejected() {
        let mut recorder = Recorder::new(initial());
        recorder
            .commit("program.enter", location(), entered(), vec![])
            .unwrap();
        let mut trace = recorder.finish(false);
        trace.checkpoints[0].state["output"] = json!("wrong");
        assert!(restore(&trace, 1).is_err());
        let mut encoded = serde_json::to_value(trace).unwrap();
        encoded["unknown"] = json!(true);
        assert!(serde_json::from_value::<Trace>(encoded).is_err());
    }
}
