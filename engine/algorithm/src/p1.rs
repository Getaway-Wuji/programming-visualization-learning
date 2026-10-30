//! Independently versioned, bounded C-function / algorithm C++ interpreter.
//! It never translates C++ to C and never invokes a host compiler or process.

use crate::{
    budget::{BudgetError, Meter},
    codec,
    p1_syntax::{self as syntax, Expr, Fault, Id, Init, Kind, Output, Program},
    source::ByteRange,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const EXEC_VERSION: &str = "1.2.0";
pub const DSL_VERSION: &str = "1.1.0";
pub const ENGINE_ID: &str = "engine.rust.p1";
pub const STACK_LIMIT: usize = 32;
/// Simultaneously active interpreter call/block/statement/expression entries.
/// This independent bound closes the product of source nesting and call depth.
pub const EXECUTION_DEPTH_LIMIT: usize = 256;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    #[serde(skip)]
    revision: usize,
    id: String,
    function_node_id: String,
    function_name: String,
    parent_frame_id: Option<String>,
    call_node_id: Option<String>,
    scope_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Scope {
    #[serde(skip)]
    revision: usize,
    id: String,
    frame_id: String,
    node_id: String,
    object_ids: Vec<String>,
    aliases: Vec<Alias>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Alias {
    name: String,
    object_id: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Object {
    #[serde(skip)]
    revision: usize,
    #[serde(skip)]
    last_write: Option<usize>,
    id: String,
    declaration_node_id: String,
    frame_id: String,
    scope_id: String,
    name: String,
    kind: &'static str,
    length: usize,
    base_address: u64,
    default_value: Option<i32>,
    cells: Vec<Cell>,
}
#[derive(Clone, Debug, Serialize)]
struct Cell {
    index: usize,
    value: i32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Control {
    active_frame_id: Option<String>,
    next_node_id: Option<String>,
    return_value: Option<i32>,
    input_cursor: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Allocator {
    next_address: u64,
    live_bytes: usize,
    next_object: usize,
    next_scope: usize,
    next_frame: usize,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Counters {
    comparisons: usize,
    scalar_writes: usize,
    array_writes: usize,
    swaps: usize,
}
#[derive(Clone, Debug, Serialize)]
struct State {
    #[serde(skip)]
    dirty_frames: BTreeSet<usize>,
    #[serde(skip)]
    dirty_scopes: BTreeSet<usize>,
    #[serde(skip)]
    dirty_objects: BTreeSet<usize>,
    frames: Vec<Frame>,
    scopes: Vec<Scope>,
    objects: Vec<Object>,
    control: Control,
    allocator: Allocator,
    output: String,
    counters: Counters,
}
impl State {
    fn new(main: Id) -> Self {
        Self {
            dirty_frames: BTreeSet::new(),
            dirty_scopes: BTreeSet::new(),
            dirty_objects: BTreeSet::new(),
            frames: vec![],
            scopes: vec![],
            objects: vec![],
            control: Control {
                active_frame_id: None,
                next_node_id: Some(nid(main)),
                return_value: None,
                input_cursor: 0,
            },
            allocator: Allocator {
                next_address: 4096,
                live_bytes: 0,
                next_object: 1,
                next_scope: 1,
                next_frame: 1,
            },
            output: String::new(),
            counters: Counters::default(),
        }
    }
}
fn nid(id: Id) -> String {
    format!("n{}", id + 1)
}
fn fault(code: &'static str, byte_range: ByteRange) -> Fault {
    Fault { code, byte_range }
}
fn budget(error: BudgetError, range: ByteRange) -> Fault {
    fault(
        match error {
            BudgetError::Cancelled => "E_CANCELLED",
            BudgetError::Deadline { .. } => "E_DEADLINE",
            _ => "E_FUEL_LIMIT",
        },
        range,
    )
}
fn codec_fault(error: codec::CodecError, range: ByteRange) -> Fault {
    match error {
        codec::CodecError::Budget(e) => budget(e, range),
        codec::CodecError::Limit { .. } => fault("E_RESULT_LIMIT", range),
        _ => fault("E_ENCODING_FAILURE", range),
    }
}

struct Recording {
    initial: Vec<u8>,
    current: Value,
    steps: Vec<Vec<u8>>,
    checkpoints: Vec<Vec<u8>>,
    bytes: usize,
    metadata_bytes: usize,
    frame_versions: Vec<usize>,
    scope_versions: Vec<usize>,
    object_versions: Vec<usize>,
}
impl Recording {
    fn new(
        state: &State,
        metadata_bytes: usize,
        meter: &mut Meter,
        range: ByteRange,
    ) -> Result<Self, Fault> {
        let initial = serde_json::to_value(state).unwrap();
        let point = codec::encode(
            &json!({"cursor":0,"state":initial}),
            meter,
            meter.limits().result_bytes,
        )
        .map_err(|e| codec_fault(e, range))?;
        let initial_bytes = codec::encode(&initial, meter, meter.limits().result_bytes)
            .map_err(|e| codec_fault(e, range))?;
        let bytes = metadata_bytes + initial_bytes.len() + point.len() + 8192;
        if bytes > meter.limits().result_bytes.saturating_sub(65536) {
            return Err(fault("E_RESULT_LIMIT", range));
        }
        meter
            .reserve_result(bytes + metadata_bytes)
            .map_err(|e| budget(e, range))?;
        Ok(Self {
            current: initial.clone(),
            initial: initial_bytes,
            steps: vec![],
            checkpoints: vec![point],
            bytes,
            metadata_bytes,
            frame_versions: vec![],
            scope_versions: vec![],
            object_versions: vec![],
        })
    }
    fn emit(
        &mut self,
        state: &State,
        node: Id,
        kind: &str,
        meter: &mut Meter,
        range: ByteRange,
    ) -> Result<(), Fault> {
        if self.steps.len() >= meter.limits().steps {
            return Err(fault("E_STEP_LIMIT", range));
        }
        meter.check_commit().map_err(|e| budget(e, range))?;
        let mut changes = table_changes(
            "objects",
            &state.objects,
            &self.current["objects"],
            &self.object_versions,
            &state.dirty_objects,
            meter,
            range,
        )?;
        changes.extend(table_changes(
            "scopes",
            &state.scopes,
            &self.current["scopes"],
            &self.scope_versions,
            &state.dirty_scopes,
            meter,
            range,
        )?);
        changes.extend(table_changes(
            "frames",
            &state.frames,
            &self.current["frames"],
            &self.frame_versions,
            &state.dirty_frames,
            meter,
            range,
        )?);
        for (op, value) in [
            ("control", serde_json::to_value(&state.control).unwrap()),
            ("allocator", serde_json::to_value(&state.allocator).unwrap()),
            ("counters", serde_json::to_value(&state.counters).unwrap()),
        ] {
            meter.charge(1).map_err(|e| budget(e, range))?;
            if self.current[op] != value {
                changes.push(json!({"op":op,"before":self.current[op],"after":value}));
            }
        }
        let old_output = self.current["output"].as_str().unwrap();
        if old_output.len() != state.output.len() {
            let append = &state.output[old_output.len()..];
            meter
                .charge(append.len().div_ceil(64))
                .map_err(|e| budget(e, range))?;
            changes.push(json!({"op":"output","beforeBytes":old_output.len(),"afterBytes":state.output.len(),"append":append}));
        }
        let step =
            json!({"seq":self.steps.len()+1,"kind":kind,"nodeId":nid(node),"changes":changes});
        let checkpoint = if (self.steps.len() + 1).is_multiple_of(128) {
            let size = state.frames.len()
                + state.scopes.len()
                + state
                    .objects
                    .iter()
                    .map(|o| 1 + o.cells.len())
                    .sum::<usize>();
            meter
                .charge(size + state.output.len().div_ceil(64))
                .map_err(|e| budget(e, range))?;
            let mut after = self.current.clone();
            apply_changes_inner(&mut after, step["changes"].as_array().unwrap(), false)
                .expect("trusted checkpoint delta");
            Some(json!({"cursor":self.steps.len()+1,"state":after}))
        } else {
            None
        };
        let step_bytes = codec::encode(&step, meter, meter.limits().result_bytes)
            .map_err(|e| codec_fault(e, range))?;
        let point_bytes = checkpoint
            .as_ref()
            .map(|point| {
                codec::encode(point, meter, meter.limits().result_bytes)
                    .map_err(|e| codec_fault(e, range))
            })
            .transpose()?;
        let bytes = step_bytes.len() + 1 + point_bytes.as_ref().map_or(0, |point| point.len() + 1);
        if self.bytes.saturating_add(bytes) > meter.limits().result_bytes.saturating_sub(65536) {
            return Err(fault("E_RESULT_LIMIT", range));
        }
        meter
            .reserve_result(self.bytes + bytes + self.metadata_bytes)
            .map_err(|e| budget(e, range))?;
        meter.check_commit().map_err(|e| budget(e, range))?;
        self.bytes += bytes;
        apply_changes_inner(
            &mut self.current,
            step["changes"].as_array().unwrap(),
            false,
        )
        .expect("trusted committed delta");
        sync_versions(&state.frames, &mut self.frame_versions, &state.dirty_frames);
        sync_versions(&state.scopes, &mut self.scope_versions, &state.dirty_scopes);
        sync_versions(
            &state.objects,
            &mut self.object_versions,
            &state.dirty_objects,
        );
        self.steps.push(step_bytes);
        if let Some(point) = point_bytes {
            self.checkpoints.push(point);
        }
        Ok(())
    }
    fn write(
        &self,
        complete: bool,
        out: &mut codec::Assembly,
        meter: &mut Meter,
    ) -> Result<(), codec::CodecError> {
        out.append(b"{\"checkpoints\":[", meter)?;
        for (at, point) in self.checkpoints.iter().enumerate() {
            if at > 0 {
                out.append(b",", meter)?;
            }
            out.append(point, meter)?;
        }
        out.append(
            if complete {
                b"],\"completeness\":\"complete\",\"dslVersion\":\"1.1.0\",\"initialState\":"
            } else {
                b"],\"completeness\":\"prefix\",\"dslVersion\":\"1.1.0\",\"initialState\":"
            },
            meter,
        )?;
        out.append(&self.initial, meter)?;
        out.append(b",\"steps\":[", meter)?;
        for (at, step) in self.steps.iter().enumerate() {
            if at > 0 {
                out.append(b",", meter)?;
            }
            out.append(step, meter)?;
        }
        out.append(b"]}", meter)
    }
}
fn effective(object: &Value, index: usize) -> Value {
    object["cells"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["index"] == index)
        .map_or_else(|| object["defaultValue"].clone(), |c| c["value"].clone())
}
trait Versioned: Serialize {
    fn id(&self) -> &str;
    fn revision(&self) -> usize;
    fn weight(&self) -> usize {
        1
    }
    fn cell_update(&self) -> Option<(usize, i32)> {
        None
    }
}
impl Versioned for Frame {
    fn id(&self) -> &str {
        &self.id
    }
    fn revision(&self) -> usize {
        self.revision
    }
    fn weight(&self) -> usize {
        1 + self.scope_ids.len()
    }
}
impl Versioned for Scope {
    fn id(&self) -> &str {
        &self.id
    }
    fn revision(&self) -> usize {
        self.revision
    }
    fn weight(&self) -> usize {
        1 + self.object_ids.len() + self.aliases.len()
    }
}
impl Versioned for Object {
    fn id(&self) -> &str {
        &self.id
    }
    fn revision(&self) -> usize {
        self.revision
    }
    fn weight(&self) -> usize {
        1 + self.cells.len()
    }
    fn cell_update(&self) -> Option<(usize, i32)> {
        self.last_write.map(|index| {
            (
                index,
                self.cells
                    .binary_search_by_key(&index, |c| c.index)
                    .ok()
                    .map(|at| self.cells[at].value)
                    .or(self.default_value)
                    .expect("actual initialized write"),
            )
        })
    }
}
fn sync_versions<T: Versioned>(rows: &[T], versions: &mut Vec<usize>, dirty: &BTreeSet<usize>) {
    versions.truncate(rows.len());
    let length = versions.len();
    versions.extend(rows.iter().skip(length).map(Versioned::revision));
    for &at in dirty {
        if at < rows.len() {
            versions[at] = rows[at].revision();
        }
    }
}
fn table_changes<T: Versioned>(
    table: &str,
    rows: &[T],
    old: &Value,
    versions: &[usize],
    dirty: &BTreeSet<usize>,
    meter: &mut Meter,
    range: ByteRange,
) -> Result<Vec<Value>, Fault> {
    let old = old.as_array().unwrap();
    // Scope/frame storage is a stack. Only explicitly dirtied records and the
    // appended/removed suffix need visiting; stable ancestor data is borrowed.
    let common = old.len().min(rows.len());
    meter
        .charge(dirty.len() + old.len().abs_diff(rows.len()))
        .map_err(|e| budget(e, range))?;
    let mut changes = vec![];
    for at in (common..old.len()).rev() {
        let record = &old[at];
        meter
            .charge(record["cells"].as_array().map_or(1, |c| 1 + c.len()))
            .map_err(|e| budget(e, range))?;
        changes.push(json!({"op":"record","table":table,"id":record["id"],"index":at,"before":record,"after":null}));
    }
    let changed: BTreeSet<usize> = dirty
        .iter()
        .copied()
        .filter(|at| *at < rows.len())
        .chain(common..rows.len())
        .collect();
    for at in changed {
        let row = &rows[at];
        assert!(
            at >= common || old[at]["id"].as_str() == Some(row.id()),
            "stable stack record identity"
        );
        if at < common && versions.get(at) == Some(&row.revision()) {
            continue;
        }
        if at < common
            && versions
                .get(at)
                .is_some_and(|v| v.checked_add(1) == Some(row.revision()))
            && let Some((index, value)) = row.cell_update()
        {
            let cells = old[at]["cells"].as_array().unwrap();
            meter
                .charge(1 + cells.len().checked_ilog2().unwrap_or(0) as usize)
                .map_err(|e| budget(e, range))?;
            let previous = cells
                .binary_search_by_key(&index, |c| c["index"].as_u64().unwrap() as usize)
                .ok()
                .map_or(
                    &old[at]["defaultValue"],
                    |position| &cells[position]["value"],
                );
            if previous != &json!(value) {
                changes.push(json!({"op":"cell","objectId":row.id(),"index":index,"before":previous,"after":value}));
            }
            continue;
        }
        meter.charge(row.weight()).map_err(|e| budget(e, range))?;
        let new = serde_json::to_value(row).unwrap();
        if at >= common {
            changes.push(json!({"op":"record","table":table,"id":row.id(),"index":at,"before":null,"after":new}));
            continue;
        }
        let previous = &old[at];
        if previous == &new {
            continue;
        }
        if table == "objects" && previous["defaultValue"] == new["defaultValue"] {
            let old_cells: BTreeMap<usize, &Value> = previous["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| (c["index"].as_u64().unwrap() as usize, &c["value"]))
                .collect();
            let new_cells: BTreeMap<usize, &Value> = new["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| (c["index"].as_u64().unwrap() as usize, &c["value"]))
                .collect();
            let work = old_cells.len() + new_cells.len();
            meter
                .charge(work.saturating_mul(1 + work.checked_ilog2().unwrap_or(0) as usize))
                .map_err(|e| budget(e, range))?;
            let indices: BTreeSet<_> = old_cells.keys().chain(new_cells.keys()).copied().collect();
            for index in indices {
                let a = old_cells
                    .get(&index)
                    .copied()
                    .unwrap_or(&previous["defaultValue"]);
                let b = new_cells
                    .get(&index)
                    .copied()
                    .unwrap_or(&new["defaultValue"]);
                if a != b {
                    changes.push(
                        json!({"op":"cell","objectId":row.id(),"index":index,"before":a,"after":b}),
                    );
                }
            }
        } else {
            changes.push(json!({"op":"record","table":table,"id":row.id(),"index":at,"before":previous,"after":new}));
        }
    }
    Ok(changes)
}
pub fn apply_changes(
    state: &mut Value,
    changes: &[Value],
    reverse: bool,
) -> Result<(), &'static str> {
    let mut next = state.clone();
    apply_changes_inner(&mut next, changes, reverse)?;
    *state = next;
    Ok(())
}
/// Test/replay helper. It applies recorded deltas only and never interprets code.
fn apply_changes_inner(
    state: &mut Value,
    changes: &[Value],
    reverse: bool,
) -> Result<(), &'static str> {
    let next = state;
    let order: Vec<_> = if reverse {
        changes.iter().rev().collect()
    } else {
        changes.iter().collect()
    };
    for c in order {
        let (a, b) = if reverse {
            (&c["after"], &c["before"])
        } else {
            (&c["before"], &c["after"])
        };
        match c["op"].as_str() {
            Some("record") => {
                let table = c["table"].as_str().ok_or("table")?;
                if !["frames", "scopes", "objects"].contains(&table) {
                    return Err("table");
                };
                let rows = next[table].as_array_mut().ok_or("rows")?;
                let at = c["index"].as_u64().ok_or("index")? as usize;
                if at > rows.len() {
                    return Err("index");
                };
                if a.is_null() {
                    if rows.iter().any(|r| r["id"] == c["id"]) {
                        return Err("duplicate");
                    };
                    rows.insert(at, b.clone());
                } else {
                    if rows.get(at) != Some(a) {
                        return Err("before");
                    };
                    if b.is_null() {
                        rows.remove(at);
                    } else {
                        rows[at] = b.clone();
                    }
                }
            }
            Some("cell") => {
                let object = next["objects"]
                    .as_array_mut()
                    .ok_or("objects")?
                    .iter_mut()
                    .find(|o| o["id"] == c["objectId"])
                    .ok_or("object")?;
                let index = c["index"].as_u64().ok_or("index")? as usize;
                if index >= object["length"].as_u64().ok_or("length")? as usize
                    || effective(object, index) != *a
                {
                    return Err("cell before");
                };
                let default = object["defaultValue"].clone();
                let cells = object["cells"].as_array_mut().ok_or("cells")?;
                if let Some(at) = cells.iter().position(|cell| cell["index"] == index) {
                    cells.remove(at);
                }
                if *b != default {
                    cells.push(json!({"index":index,"value":b}));
                    cells.sort_by_key(|cell| cell["index"].as_u64().unwrap());
                }
            }
            Some("control" | "allocator" | "counters") => {
                let op = c["op"].as_str().unwrap();
                if next[op] != *a {
                    return Err("singleton before");
                };
                next[op] = b.clone();
            }
            Some("output") => {
                let text = next["output"].as_str().ok_or("output")?;
                let append = c["append"].as_str().ok_or("append")?;
                let before = c["beforeBytes"].as_u64().ok_or("bytes")? as usize;
                let after = c["afterBytes"].as_u64().ok_or("bytes")? as usize;
                if after.checked_sub(before) != Some(append.len()) {
                    return Err("output bytes");
                };
                next["output"] = if reverse {
                    if text.len() != after || !text.ends_with(append) {
                        return Err("output before");
                    };
                    json!(text.get(..before).ok_or("utf8")?)
                } else {
                    if text.len() != before {
                        return Err("output before");
                    };
                    json!(format!("{text}{append}"))
                };
            }
            _ => return Err("op"),
        }
    }

    Ok(())
}

#[derive(Clone, Copy, PartialEq)]
enum Ty {
    Int,
    Array,
    Void,
}
struct Checker<'a, 'm> {
    p: &'a Program,
    meter: &'m mut Meter,
    env: Vec<BTreeMap<String, Ty>>,
    function: usize,
    loops: usize,
}
impl Checker<'_, '_> {
    fn err(&self, code: &'static str, id: Id) -> Fault {
        fault(code, self.p.nodes[id].range)
    }
    fn expr(&mut self, id: Id) -> Result<Ty, Fault> {
        self.meter
            .charge(1)
            .map_err(|e| budget(e, self.p.nodes[id].range))?;
        let kind = self.p.nodes[id].kind.clone();
        match kind {
            Kind::Expr(Expr::Int(_)) => Ok(Ty::Int),
            Kind::Expr(Expr::Name(name)) => self
                .env
                .iter()
                .rev()
                .find_map(|s| s.get(&name).copied())
                .ok_or_else(|| self.err("E_UNDECLARED", id)),
            Kind::Expr(Expr::Index { array, index }) => {
                if self.expr(array)? != Ty::Array || self.expr(index)? != Ty::Int {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ok(Ty::Int)
            }
            Kind::Expr(Expr::Unary { arg, .. }) => {
                self.int(arg)?;
                Ok(Ty::Int)
            }
            Kind::Expr(Expr::Binary { left, right, .. }) => {
                self.int(left)?;
                self.int(right)?;
                Ok(Ty::Int)
            }
            Kind::Expr(Expr::Call { name, args }) => {
                if self.env.iter().rev().any(|scope| scope.contains_key(&name)) {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                let target = self
                    .p
                    .functions
                    .iter()
                    .position(|f| f.name == name)
                    .ok_or_else(|| self.err("E_UNDECLARED", id))?;
                if target > self.function || name == "main" {
                    return Err(self.err("E_UNDECLARED", id));
                }
                let f = &self.p.functions[target];
                if args.len() != f.params.len() {
                    return Err(self.err("E_ARGUMENTS", id));
                }
                for (arg, param) in args.iter().zip(f.params.clone()) {
                    if self.expr(*arg)? != if param.is_array { Ty::Array } else { Ty::Int } {
                        return Err(self.err("E_TYPE_INVALID", *arg));
                    }
                }
                Ok(if f.returns_void { Ty::Void } else { Ty::Int })
            }
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn int(&mut self, id: Id) -> Result<(), Fault> {
        if self.expr(id)? != Ty::Int {
            Err(self.err("E_TYPE_INVALID", id))
        } else {
            Ok(())
        }
    }
    fn target(&mut self, id: Id) -> Result<(), Fault> {
        if !matches!(
            self.p.nodes[id].kind,
            Kind::Expr(Expr::Name(_) | Expr::Index { .. })
        ) {
            return Err(self.err("E_TYPE_INVALID", id));
        }
        self.int(id)
    }
    fn stmt(&mut self, id: Id, root: bool) -> Result<(), Fault> {
        self.meter
            .charge(1)
            .map_err(|e| budget(e, self.p.nodes[id].range))?;
        match self.p.nodes[id].kind.clone() {
            Kind::Block(ids) => {
                if !root {
                    self.env.push(BTreeMap::new());
                }
                for child in ids {
                    self.stmt(child, false)?;
                }
                if !root {
                    self.env.pop();
                }
            }
            Kind::Declare { name, length, init } => {
                if self.env.last().unwrap().contains_key(&name) {
                    return Err(self.err("E_DUPLICATE", id));
                }
                self.env
                    .last_mut()
                    .unwrap()
                    .insert(name, if length.is_some() { Ty::Array } else { Ty::Int });
                match init {
                    Init::None => {}
                    Init::Scalar(expr) => {
                        if length.is_some() {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        self.int(expr)?;
                    }
                    Init::Array(ids) => {
                        if length.is_none() || ids.len() > length.unwrap() {
                            return Err(self.err("E_TYPE_INVALID", id));
                        }
                        for expr in ids {
                            let literal = match &self.p.nodes[expr].kind {
                                Kind::Expr(Expr::Int(_)) => true,
                                Kind::Expr(Expr::Unary { op, arg }) if op == "+" || op == "-" => {
                                    matches!(self.p.nodes[*arg].kind, Kind::Expr(Expr::Int(_)))
                                }
                                _ => false,
                            };
                            if !literal {
                                return Err(self.err("E_UNSUPPORTED_SYNTAX", expr));
                            }
                            self.int(expr)?;
                        }
                    }
                }
            }
            Kind::Assign { target, value } => {
                self.target(target)?;
                self.int(value)?;
            }
            Kind::If { condition, yes, no } => {
                self.int(condition)?;
                self.stmt(yes, false)?;
                if let Some(no) = no {
                    self.stmt(no, false)?;
                }
            }
            Kind::While { condition, body } => {
                self.int(condition)?;
                self.loops += 1;
                self.stmt(body, false)?;
                self.loops -= 1;
            }
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                self.env.push(BTreeMap::new());
                if let Some(init) = init {
                    self.stmt(init, false)?;
                }
                if let Some(c) = condition {
                    self.int(c)?;
                }
                if let Some(update) = update {
                    self.stmt(update, false)?;
                }
                self.loops += 1;
                self.stmt(body, false)?;
                self.loops -= 1;
                self.env.pop();
            }
            Kind::Return(value) => {
                let void = self.p.functions[self.function].returns_void;
                if void != value.is_none() {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                if let Some(value) = value {
                    self.int(value)?;
                }
            }
            Kind::Break | Kind::Continue => {
                if self.loops == 0 {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
            }
            Kind::ExprStmt(expr) => {
                if !matches!(self.p.nodes[expr].kind, Kind::Expr(Expr::Call { .. })) {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                self.expr(expr)?;
            }
            Kind::Print { format, args } => {
                let mut count = 0;
                let mut chars = format.chars();
                while let Some(ch) = chars.next() {
                    if ch == '%' {
                        match chars.next() {
                            Some('d') => count += 1,
                            Some('%') => {}
                            _ => return Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
                        }
                    }
                }
                if count != args.len() {
                    return Err(self.err("E_ARGUMENTS", id));
                }
                for arg in args {
                    self.int(arg)?;
                }
            }
            Kind::Cout(parts) => {
                for part in parts {
                    if let Output::Expr(expr) = part {
                        self.int(expr)?;
                    }
                }
            }
            Kind::Cin(targets) => {
                for target in targets {
                    self.target(target)?;
                }
            }
            Kind::Empty => {}
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        }
        Ok(())
    }
}
fn check(p: &Program, meter: &mut Meter) -> Result<(), Fault> {
    let mut names = BTreeSet::new();
    for (index, f) in p.functions.iter().enumerate() {
        if !names.insert(&f.name) {
            return Err(fault("E_DUPLICATE", p.nodes[f.node].range));
        }
        let mut env = BTreeMap::new();
        for param in &f.params {
            if env
                .insert(
                    param.name.clone(),
                    if param.is_array { Ty::Array } else { Ty::Int },
                )
                .is_some()
            {
                return Err(fault("E_DUPLICATE", p.nodes[param.node].range));
            }
        }
        let mut checker = Checker {
            p,
            meter,
            env: vec![env],
            function: index,
            loops: 0,
        };
        checker.stmt(f.body, true)?;
    }
    Ok(())
}

enum Flow {
    Next,
    Return(Option<i32>, Id),
    Break,
    Continue,
}
enum Argument {
    Int(i32),
    Array(String),
}
struct Runtime<'a, 'm> {
    p: &'a Program,
    meter: &'m mut Meter,
    input: &'a [i32],
    cpp: bool,
    depth: usize,
    state: State,
    record: Recording,
}
impl Runtime<'_, '_> {
    fn guarded<T>(
        &mut self,
        id: Id,
        work: impl FnOnce(&mut Self) -> Result<T, Fault>,
    ) -> Result<T, Fault> {
        if self.depth >= EXECUTION_DEPTH_LIMIT {
            return Err(self.err("E_DEPTH_LIMIT", id));
        }
        self.depth += 1;
        let result = work(self);
        self.depth -= 1;
        result
    }
    fn err(&self, code: &'static str, id: Id) -> Fault {
        fault(code, self.p.nodes[id].range)
    }
    fn tick(&mut self, id: Id, units: usize) -> Result<(), Fault> {
        self.meter
            .charge(units)
            .map_err(|e| budget(e, self.p.nodes[id].range))
    }
    fn emit(&mut self, id: Id, kind: &str) -> Result<(), Fault> {
        self.state.control.next_node_id = Some(nid(id));
        let result = self
            .record
            .emit(&self.state, id, kind, self.meter, self.p.nodes[id].range);
        if result.is_ok() {
            self.state.dirty_frames.clear();
            self.state.dirty_scopes.clear();
            self.state.dirty_objects.clear();
        }
        result
    }
    fn object_index(&mut self, name: &str, id: Id) -> Result<usize, Fault> {
        let frame = self
            .state
            .frames
            .last()
            .ok_or_else(|| self.err("E_UNDECLARED", id))?;
        for scope_id in frame.scope_ids.iter().rev() {
            let scope = self
                .state
                .scopes
                .iter()
                .find(|s| s.id == *scope_id)
                .unwrap();
            if let Some(alias) = scope.aliases.iter().find(|a| a.name == name) {
                return self
                    .state
                    .objects
                    .iter()
                    .position(|o| o.id == alias.object_id)
                    .ok_or_else(|| self.err("E_UNDECLARED", id));
            }
            if let Some(index) = self
                .state
                .objects
                .iter()
                .position(|o| o.scope_id == scope.id && o.name == name)
            {
                return Ok(index);
            }
        }
        Err(self.err("E_UNDECLARED", id))
    }
    fn array(&mut self, id: Id) -> Result<usize, Fault> {
        if let Kind::Expr(Expr::Name(name)) = &self.p.nodes[id].kind {
            let index = self.object_index(&name.clone(), id)?;
            if self.state.objects[index].kind == "int-array" {
                return Ok(index);
            }
        }
        Err(self.err("E_TYPE_INVALID", id))
    }
    fn target(&mut self, id: Id) -> Result<(usize, usize), Fault> {
        match self.p.nodes[id].kind.clone() {
            Kind::Expr(Expr::Name(name)) => {
                let object = self.object_index(&name, id)?;
                if self.state.objects[object].kind != "int" {
                    return Err(self.err("E_TYPE_INVALID", id));
                }
                Ok((object, 0))
            }
            Kind::Expr(Expr::Index { array, index }) => {
                let array_index = self.array(array)?;
                let object_id = self.state.objects[array_index].id.clone();
                let at = self.eval(index)?;
                let object = self
                    .state
                    .objects
                    .iter()
                    .position(|o| o.id == object_id)
                    .unwrap();
                if at < 0 || at as usize >= self.state.objects[object].length {
                    return Err(self.err("E_BOUNDS", id));
                }
                Ok((object, at as usize))
            }
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn value(&self, object: usize, index: usize, id: Id) -> Result<i32, Fault> {
        let object = &self.state.objects[object];
        object
            .cells
            .iter()
            .find(|c| c.index == index)
            .map(|c| c.value)
            .or(object.default_value)
            .ok_or_else(|| self.err("E_UNINITIALIZED", id))
    }
    fn write(&mut self, object: usize, index: usize, value: i32) {
        self.state.dirty_objects.insert(object);
        let object = &mut self.state.objects[object];
        object.revision += 1;
        object.last_write = Some(index);
        if object.kind == "int" {
            self.state.counters.scalar_writes += 1;
        } else {
            self.state.counters.array_writes += 1;
        }
        match object.cells.binary_search_by_key(&index, |c| c.index) {
            Ok(at) => {
                if Some(value) == object.default_value {
                    object.cells.remove(at);
                } else {
                    object.cells[at].value = value;
                }
            }
            Err(at) => {
                if Some(value) != object.default_value {
                    object.cells.insert(at, Cell { index, value });
                }
            }
        }
    }
    fn eval(&mut self, id: Id) -> Result<i32, Fault> {
        self.guarded(id, |runtime| runtime.eval_inner(id))
    }
    fn eval_inner(&mut self, id: Id) -> Result<i32, Fault> {
        self.tick(id, 1)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Expr(Expr::Int(v)) => Ok(v),
            Kind::Expr(Expr::Name(_) | Expr::Index { .. }) => {
                let (o, i) = self.target(id)?;
                self.value(o, i, id)
            }
            Kind::Expr(Expr::Unary { op, arg }) => {
                let v = self.eval(arg)?;
                match op.as_str() {
                    "+" => Ok(v),
                    "-" => v.checked_neg().ok_or_else(|| self.err("E_OVERFLOW", id)),
                    "!" => Ok(i32::from(v == 0)),
                    _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
                }
            }
            Kind::Expr(Expr::Binary { op, left, right }) => {
                let a = self.eval(left)?;
                if op == "&&" && a == 0 {
                    return Ok(0);
                }
                if op == "||" && a != 0 {
                    return Ok(1);
                }
                let b = self.eval(right)?;
                let overflow = || self.err("E_OVERFLOW", id);
                match op.as_str() {
                    "+" => a.checked_add(b).ok_or_else(overflow),
                    "-" => a.checked_sub(b).ok_or_else(overflow),
                    "*" => a.checked_mul(b).ok_or_else(overflow),
                    "/" | "%" => {
                        if b == 0 {
                            return Err(self.err("E_DIV_ZERO", id));
                        }
                        if op == "/" {
                            a.checked_div(b).ok_or_else(overflow)
                        } else {
                            a.checked_rem(b).ok_or_else(overflow)
                        }
                    }
                    "&&" => Ok(i32::from(a != 0 && b != 0)),
                    "||" => Ok(i32::from(a != 0 || b != 0)),
                    "<" | "<=" | ">" | ">=" | "==" | "!=" => {
                        self.state.counters.comparisons += 1;
                        Ok(i32::from(match op.as_str() {
                            "<" => a < b,
                            "<=" => a <= b,
                            ">" => a > b,
                            ">=" => a >= b,
                            "==" => a == b,
                            _ => a != b,
                        }))
                    }
                    _ => Err(self.err("E_UNSUPPORTED_SYNTAX", id)),
                }
            }
            Kind::Expr(Expr::Call { name, args }) => self
                .call(&name, &args, Some(id))?
                .ok_or_else(|| self.err("E_TYPE_INVALID", id)),
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn scope_enter(&mut self, node: Id) -> Result<(), Fault> {
        self.state.dirty_frames.insert(self.state.frames.len() - 1);
        let frame = self.state.frames.last_mut().unwrap();
        let id = format!("s{}", self.state.allocator.next_scope);
        self.state.allocator.next_scope += 1;
        frame.scope_ids.push(id.clone());
        frame.revision += 1;
        self.state.scopes.push(Scope {
            revision: 0,
            id,
            frame_id: frame.id.clone(),
            node_id: nid(node),
            object_ids: vec![],
            aliases: vec![],
        });
        self.emit(node, "scope.enter")
    }
    fn scope_pop(&mut self) {
        self.state.dirty_frames.insert(self.state.frames.len() - 1);
        self.state.frames.last_mut().unwrap().revision += 1;
        let id = self
            .state
            .frames
            .last_mut()
            .unwrap()
            .scope_ids
            .pop()
            .unwrap();
        assert_eq!(self.state.scopes.last().unwrap().id, id);
        self.state.scopes.pop();
        while self.state.objects.last().is_some_and(|o| o.scope_id == id) {
            let object = self.state.objects.pop().unwrap();
            self.state.allocator.live_bytes -= object.length * 4;
        }
    }
    fn scope_exit(&mut self, node: Id) -> Result<(), Fault> {
        self.scope_pop();
        self.emit(node, "scope.exit")
    }
    fn allocate(&mut self, name: String, length: Option<usize>, node: Id) -> Result<usize, Fault> {
        let size = length.unwrap_or(1);
        let bytes = size
            .checked_mul(4)
            .ok_or_else(|| self.err("E_MEMORY_LIMIT", node))?;
        if self.state.allocator.live_bytes.saturating_add(bytes) > self.meter.limits().live_bytes {
            return Err(self.err("E_MEMORY_LIMIT", node));
        }
        // Teaching addresses outlive released objects and must not inherit the
        // host pointer width. Keep every address exact in the JSON consumer.
        let next_address = self
            .state
            .allocator
            .next_address
            .checked_add(bytes as u64)
            .filter(|address| *address <= 9_007_199_254_740_991)
            .ok_or_else(|| self.err("E_MEMORY_LIMIT", node))?;
        self.state.dirty_scopes.insert(self.state.scopes.len() - 1);
        let frame = self.state.frames.last().unwrap();
        let scope = self.state.scopes.last_mut().unwrap();
        let id = format!("o{}", self.state.allocator.next_object);
        let object = Object {
            revision: 0,
            last_write: None,
            id: id.clone(),
            declaration_node_id: nid(node),
            frame_id: frame.id.clone(),
            scope_id: scope.id.clone(),
            name,
            kind: if length.is_some() { "int-array" } else { "int" },
            length: size,
            base_address: self.state.allocator.next_address,
            default_value: None,
            cells: vec![],
        };
        self.state.allocator.next_object += 1;
        self.state.allocator.next_address = next_address;
        self.state.allocator.live_bytes += bytes;
        scope.object_ids.push(id);
        scope.revision += 1;
        self.state.objects.push(object);
        Ok(self.state.objects.len() - 1)
    }
    fn call(&mut self, name: &str, args: &[Id], call: Option<Id>) -> Result<Option<i32>, Fault> {
        let node = call.unwrap_or_else(|| {
            self.p
                .functions
                .iter()
                .find(|f| f.name == name)
                .unwrap()
                .node
        });
        self.guarded(node, |runtime| runtime.call_inner(name, args, call))
    }
    fn call_inner(
        &mut self,
        name: &str,
        args: &[Id],
        call: Option<Id>,
    ) -> Result<Option<i32>, Fault> {
        let f = self
            .p
            .functions
            .iter()
            .find(|f| f.name == name)
            .unwrap()
            .clone();
        let at = call.unwrap_or(f.node);
        if self.state.frames.len() >= STACK_LIMIT {
            return Err(self.err("E_STACK_LIMIT", at));
        }
        let mut values = vec![];
        for (arg, param) in args.iter().zip(&f.params) {
            values.push(if param.is_array {
                let index = self.array(*arg)?;
                Argument::Array(self.state.objects[index].id.clone())
            } else {
                Argument::Int(self.eval(*arg)?)
            })
        }
        let parent = self.state.frames.last().map(|f| f.id.clone());
        let id = format!("f{}", self.state.allocator.next_frame);
        let scope = format!("s{}", self.state.allocator.next_scope);
        self.state.allocator.next_frame += 1;
        self.state.allocator.next_scope += 1;
        self.state.frames.push(Frame {
            revision: 0,
            id: id.clone(),
            function_node_id: nid(f.node),
            function_name: f.name.clone(),
            parent_frame_id: parent,
            call_node_id: call.map(nid),
            scope_ids: vec![scope.clone()],
        });
        self.state.scopes.push(Scope {
            revision: 0,
            id: scope,
            frame_id: id.clone(),
            node_id: nid(f.body),
            object_ids: vec![],
            aliases: vec![],
        });
        self.state.control.active_frame_id = Some(id);
        self.state.control.return_value = None;
        for (param, value) in f.params.iter().zip(values) {
            match value {
                Argument::Int(value) => {
                    let index = self.allocate(param.name.clone(), None, param.node)?;
                    self.write(index, 0, value);
                }
                Argument::Array(object_id) => {
                    self.state.dirty_scopes.insert(self.state.scopes.len() - 1);
                    self.state.scopes.last_mut().unwrap().revision += 1;
                    self.state.scopes.last_mut().unwrap().aliases.push(Alias {
                        name: param.name.clone(),
                        object_id,
                    })
                }
            }
        }
        self.emit(
            f.node,
            if name == "main" {
                "program.enter"
            } else {
                "function.enter"
            },
        )?;
        let flow = self.block(f.body, false)?;
        let (value, return_node) = match flow {
            Flow::Return(value, node) => (value, node),
            Flow::Next => {
                if name == "main" {
                    (Some(0), f.body)
                } else if f.returns_void {
                    (None, f.body)
                } else {
                    return Err(self.err("E_RETURN_MISSING", f.node));
                }
            }
            _ => return Err(self.err("E_TYPE_INVALID", f.node)),
        };
        while !self.state.frames.last().unwrap().scope_ids.is_empty() {
            self.scope_pop();
        }
        self.state.frames.pop();
        self.state.control.active_frame_id = self.state.frames.last().map(|f| f.id.clone());
        self.state.control.return_value = value;
        self.emit(
            return_node,
            if name == "main" {
                "program.return"
            } else {
                "function.return"
            },
        )?;
        Ok(value)
    }
    fn block(&mut self, id: Id, scope: bool) -> Result<Flow, Fault> {
        self.guarded(id, |runtime| runtime.block_inner(id, scope))
    }
    fn block_inner(&mut self, id: Id, scope: bool) -> Result<Flow, Fault> {
        if scope {
            self.scope_enter(id)?;
        }
        let ids = if let Kind::Block(ids) = self.p.nodes[id].kind.clone() {
            ids
        } else {
            return self.stmt(id);
        };
        for child in ids {
            let flow = self.stmt(child)?;
            if !matches!(flow, Flow::Next) {
                if scope {
                    self.scope_exit(id)?;
                }
                return Ok(flow);
            }
        }
        if scope {
            self.scope_exit(id)?;
        }
        Ok(Flow::Next)
    }
    fn output(&mut self, text: String, id: Id) -> Result<(), Fault> {
        self.tick(id, text.len().div_ceil(64))?;
        if self.state.output.len().saturating_add(text.len()) > self.meter.limits().output_bytes {
            return Err(self.err("E_OUTPUT_LIMIT", id));
        }
        self.state.output.push_str(&text);
        self.emit(id, "output.append")
    }
    fn stmt(&mut self, id: Id) -> Result<Flow, Fault> {
        self.guarded(id, |runtime| runtime.stmt_inner(id))
    }
    fn stmt_inner(&mut self, id: Id) -> Result<Flow, Fault> {
        self.tick(id, 1)?;
        match self.p.nodes[id].kind.clone() {
            Kind::Block(_) => return self.block(id, true),
            Kind::Declare { name, length, init } => {
                let object = self.allocate(name, length, id)?;
                let oid = self.state.objects[object].id.clone();
                self.emit(id, "object.declare")?;
                match init {
                    Init::None => {}
                    Init::Scalar(expr) => {
                        let v = self.eval(expr)?;
                        let index = self.state.objects.iter().position(|o| o.id == oid).unwrap();
                        self.write(index, 0, v);
                        self.emit(id, "value.initialize")?;
                    }
                    Init::Array(expressions) => {
                        let mut values = vec![];
                        for expr in expressions {
                            values.push(self.eval(expr)?);
                        }
                        let object = self.state.objects.iter().position(|o| o.id == oid).unwrap();
                        let length = self.state.objects[object].length;
                        self.tick(id, length)?;
                        self.state.dirty_objects.insert(object);
                        self.state.objects[object].revision += 1;
                        self.state.objects[object].last_write = None;
                        self.state.objects[object].default_value = Some(0);
                        self.state.objects[object].cells = values
                            .into_iter()
                            .enumerate()
                            .filter(|(_, v)| *v != 0)
                            .map(|(index, value)| Cell { index, value })
                            .collect();
                        self.state.counters.array_writes += length;
                        self.emit(id, "value.initialize")?;
                    }
                }
            }
            Kind::Assign { target, value } => {
                // C++20 [expr.ass] sequences RHS before LHS, while the C
                // teaching increment retains the frozen P0 target-first rule.
                let (oid, index, value) = if self.cpp {
                    let value = self.eval(value)?;
                    let (object, index) = self.target(target)?;
                    (self.state.objects[object].id.clone(), index, value)
                } else {
                    let (object, index) = self.target(target)?;
                    let oid = self.state.objects[object].id.clone();
                    let value = self.eval(value)?;
                    (oid, index, value)
                };
                let object = self.state.objects.iter().position(|o| o.id == oid).unwrap();
                self.write(object, index, value);
                self.emit(id, "value.write")?;
            }
            Kind::If { condition, yes, no } => {
                let value = self.eval(condition)?;
                self.emit(condition, "condition")?;
                if value != 0 {
                    return self.stmt(yes);
                }
                if let Some(no) = no {
                    return self.stmt(no);
                }
            }
            Kind::While { condition, body } => loop {
                let value = self.eval(condition)?;
                self.emit(condition, "condition")?;
                if value == 0 {
                    break;
                }
                match self.stmt(body)? {
                    Flow::Return(value, node) => return Ok(Flow::Return(value, node)),
                    Flow::Break => break,
                    _ => {}
                }
            },
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                self.scope_enter(id)?;
                if let Some(init) = init {
                    self.stmt(init)?;
                }
                loop {
                    let value = if let Some(c) = condition {
                        self.eval(c)?
                    } else {
                        1
                    };
                    self.emit(condition.unwrap_or(id), "condition")?;
                    if value == 0 {
                        break;
                    }
                    match self.stmt(body)? {
                        Flow::Return(value, node) => {
                            self.scope_exit(id)?;
                            return Ok(Flow::Return(value, node));
                        }
                        Flow::Break => break,
                        _ => {}
                    }
                    if let Some(update) = update {
                        self.stmt(update)?;
                    }
                }
                self.scope_exit(id)?;
            }
            Kind::Return(value) => {
                let value = if let Some(value) = value {
                    Some(self.eval(value)?)
                } else {
                    None
                };
                return Ok(Flow::Return(value, id));
            }
            Kind::Break => {
                self.emit(id, "control.jump")?;
                return Ok(Flow::Break);
            }
            Kind::Continue => {
                self.emit(id, "control.jump")?;
                return Ok(Flow::Continue);
            }
            Kind::ExprStmt(expr) => {
                if let Kind::Expr(Expr::Call { name, args }) = self.p.nodes[expr].kind.clone() {
                    self.call(&name, &args, Some(expr))?;
                } else {
                    self.eval(expr)?;
                }
            }
            Kind::Print { format, args } => {
                let mut values = vec![];
                for arg in args {
                    values.push(self.eval(arg)?);
                }
                let mut text = String::new();
                let mut chars = format.chars();
                let mut next = values.iter();
                while let Some(c) = chars.next() {
                    if c == '%' {
                        match chars.next() {
                            Some('%') => text.push('%'),
                            Some('d') => text.push_str(&next.next().unwrap().to_string()),
                            _ => unreachable!(),
                        }
                    } else {
                        text.push(c)
                    }
                }
                self.output(text, id)?;
            }
            Kind::Cout(parts) => {
                for part in parts {
                    let text = match part {
                        Output::Text(text) => text,
                        Output::Expr(expr) => self.eval(expr)?.to_string(),
                    };
                    self.output(text, id)?;
                }
            }
            Kind::Cin(targets) => {
                for target in targets {
                    let (object, index) = self.target(target)?;
                    let value = self
                        .input
                        .get(self.state.control.input_cursor)
                        .copied()
                        .ok_or_else(|| self.err("E_INPUT_EXHAUSTED", target))?;
                    self.write(object, index, value);
                    self.state.control.input_cursor += 1;
                    self.emit(target, "input.read")?;
                }
            }
            Kind::Empty => self.emit(id, "nop")?,
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        }
        Ok(Flow::Next)
    }
}

fn valid_id(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 96
            && s.bytes()
                .enumerate()
                .all(|(i, c)| c.is_ascii_alphanumeric() || (i > 0 && b"._:-".contains(&c)))
    })
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.len() == keys.len() && keys.iter().all(|k| map.contains_key(*k)))
}
/// Closed canonical EXEC-01 1.2.0 boundary. Protocol errors never execute code.
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    if build_id.len() != 64
        || !build_id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("E_PROTOCOL_INVALID");
    }
    let request =
        codec::decode(bytes, meter, meter.limits().request_bytes).map_err(|e| match e {
            codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
            codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
            codec::CodecError::Budget(_) => "E_FUEL_LIMIT",
            codec::CodecError::Limit { .. } => "E_REQUEST_LIMIT",
            _ => "E_PROTOCOL_INVALID",
        })?;
    if !exact(
        &request,
        &[
            "execVersion",
            "dslVersion",
            "diagnosticVersion",
            "integerEncoding",
            "language",
            "engineId",
            "runId",
            "sourceRevision",
            "source",
            "input",
        ],
    ) {
        return Err("E_PROTOCOL_INVALID");
    }
    if request["execVersion"] != EXEC_VERSION
        || request["dslVersion"] != DSL_VERSION
        || request["diagnosticVersion"] != "1.1.0"
        || request["integerEncoding"] != "1.0.0"
        || request["engineId"] != ENGINE_ID
    {
        return Err("E_UNSUPPORTED_VERSION");
    }
    if !valid_id(&request["runId"])
        || !valid_id(&request["sourceRevision"])
        || !matches!(request["language"].as_str(), Some("c" | "cpp"))
    {
        return Err("E_PROTOCOL_INVALID");
    }
    let source = request["source"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    let input = request["input"].as_array().ok_or("E_INPUT_INVALID")?;
    if input.len() > 30 {
        return Err("E_INPUT_INVALID");
    }
    let input: Vec<i32> = input
        .iter()
        .map(|v| {
            v.as_i64()
                .and_then(|i| i32::try_from(i).ok())
                .filter(|i| (-999..=999).contains(i))
                .ok_or("E_INPUT_INVALID")
        })
        .collect::<Result<_, _>>()?;
    let mut node_map = vec![];
    let mut trace = None;
    let mut error = None;
    let mut returned = None;
    match syntax::parse(source, request["language"].as_str().unwrap(), meter).and_then(|p| {
        check(&p, meter)?;
        Ok(p)
    }) {
        Err(e) => error = Some(e),
        Ok(p) => {
            for (id, node) in p.nodes.iter().enumerate() {
                node_map
                    .push(json!({"nodeId":nid(id),"kind":node.kind.tag(),"byteRange":node.range}));
            }
            let main = p.functions.iter().find(|f| f.name == "main").unwrap();
            let state = State::new(main.node);
            let metadata = codec::encode(&json!(node_map), meter, meter.limits().result_bytes)
                .map_err(|e| match e {
                    codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
                    codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
                    _ => "E_RESULT_LIMIT",
                })?
                .len();
            match Recording::new(&state, metadata, meter, p.nodes[main.node].range) {
                Err(e) => error = Some(e),
                Ok(record) => {
                    let mut runtime = Runtime {
                        p: &p,
                        meter,
                        input: &input,
                        cpp: request["language"] == "cpp",
                        depth: 0,
                        state,
                        record,
                    };
                    match runtime.call("main", &[], None) {
                        Ok(value) => returned = value,
                        Err(e) => error = Some(e),
                    }
                    trace = Some(runtime.record);
                }
            }
        }
    }
    let status = match error.as_ref().map(|e| e.code) {
        None => "completed",
        Some("E_CANCELLED") => "cancelled",
        Some(code) if code.ends_with("_LIMIT") || code == "E_DEADLINE" => "limited",
        _ => "error",
    };
    if matches!(
        error.as_ref().map(|e| e.code),
        Some("E_CANCELLED" | "E_DEADLINE")
    ) {
        trace = None;
    }
    let cursor = trace.as_ref().map_or(0, |t| t.steps.len());
    // Reserved terminal encoding remains possible after fuel exhaustion. A hard
    // cancellation/deadline is returned out-of-band, with no retained trace.
    if let Err(e) = meter.begin_finalization() {
        return Err(match e {
            BudgetError::Cancelled => "E_CANCELLED",
            BudgetError::Deadline { .. } => "E_DEADLINE",
            _ => "E_FUEL_LIMIT",
        });
    }
    let result = json!({"execVersion":EXEC_VERSION,"dslVersion":DSL_VERSION,"diagnosticVersion":"1.1.0","integerEncoding":"1.0.0","language":request["language"],"engine":{"id":ENGINE_ID,"version":"0.1.0","buildId":build_id},"identity":{"runId":request["runId"],"sourceRevision":request["sourceRevision"]},"nodeMap":node_map,"terminal":{"status":status,"code":error.as_ref().map(|e|e.code),"byteRange":error.as_ref().map(|e|e.byte_range),"cursor":cursor,"returnValue":returned},"stats":{"fuelUsed":meter.used()}});
    let assembled = (|| -> Result<Vec<u8>, codec::CodecError> {
        let metadata = codec::encode(&result, meter, meter.limits().result_bytes)?;
        let mut output = codec::Assembly::new(meter.limits().result_bytes);
        output.append(&metadata[..metadata.len() - 1], meter)?;
        output.append(b",\"trace\":", meter)?;
        if let Some(trace) = trace {
            trace.write(error.is_none(), &mut output, meter)?;
        } else {
            output.append(b"null", meter)?;
        }
        output.append(b"}", meter)?;
        meter.check_commit()?;
        Ok(output.finish())
    })();
    assembled.map_err(|e| match e {
        codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
        codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
        codec::CodecError::Limit { .. } => "E_RESULT_LIMIT",
        codec::CodecError::Budget(_) => "E_FUEL_LIMIT",
        _ => "E_ENCODING_FAILURE",
    })
}
