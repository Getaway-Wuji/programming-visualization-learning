use std::collections::BTreeMap;

use serde::ser::{Error as _, SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};

use crate::parser::Node;
use crate::{Fault, MAX_OBJECTS, Meter, PyResult, charge};

pub(crate) const CHECKPOINT: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Value {
    None,
    Bool {
        value: bool,
    },
    Int {
        value: i64,
    },
    F64 {
        #[serde(serialize_with = "float_bits")]
        bits: u64,
    },
    Str {
        value: String,
    },
    ListRef {
        object_id: u32,
    },
    FunctionRef {
        node_id: u32,
    },
    BuiltinRef {
        name: String,
    },
}

fn float_bits<S: Serializer>(bits: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&format!("{bits:016x}"))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Proof {
    pub flags: u32,
    pub inputs: u16,
    pub returned_from: u32,
    pub function_node: u32,
    pub converted_inputs: u16,
    pub observed_list: u32,
}

impl Proof {
    pub fn with(mut self, flag: u32) -> Self {
        self.flags |= flag;
        self
    }
    pub fn has(self, flags: u32) -> bool {
        self.flags & flags == flags
    }
}

impl std::ops::BitOr for Proof {
    type Output = Self;
    fn bitor(self, other: Self) -> Self {
        Self {
            flags: self.flags | other.flags,
            inputs: self.inputs | other.inputs,
            converted_inputs: self.converted_inputs | other.converted_inputs,
            observed_list: match (self.observed_list, other.observed_list) {
                (0, id) | (id, 0) => id,
                (a, b) if a == b => a,
                _ => u32::MAX,
            },
            returned_from: match (self.returned_from, other.returned_from) {
                (0, id) | (id, 0) => id,
                (a, b) if a == b => a,
                _ => u32::MAX,
            },
            function_node: match (self.function_node, other.function_node) {
                (0, id) | (id, 0) => id,
                (a, b) if a == b => a,
                _ => u32::MAX,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Binding {
    pub frame: u32,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct Datum {
    pub value: Value,
    #[serde(skip)]
    pub proof: Proof,
    #[serde(skip)]
    pub binding: Option<Binding>,
    #[serde(skip)]
    pub last_writer: Option<Binding>,
}

impl Datum {
    pub fn new(value: Value) -> Self {
        Self::observed(value, Proof::default())
    }
    pub fn observed(value: Value, proof: Proof) -> Self {
        Self {
            value,
            proof,
            binding: None,
            last_writer: None,
        }
    }
    pub fn int(value: i64) -> Self {
        Self::new(Value::Int { value })
    }
    pub fn size(&self) -> usize {
        32 + match &self.value {
            Value::Str { value } => value.len(),
            _ => 0,
        }
    }
    pub fn list_id(&self) -> Option<u32> {
        if let Value::ListRef { object_id } = self.value {
            Some(object_id)
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Frame {
    pub id: u32,
    pub function_node_id: u32,
    pub call_node_id: u32,
    pub bindings: BTreeMap<String, Datum>,
}
impl Frame {
    fn size(&self) -> usize {
        48 + self
            .bindings
            .iter()
            .map(|(name, datum)| datum.size() + name.len())
            .sum::<usize>()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Iteration {
    pub node_id: u32,
    pub frame_id: u32,
    pub index: u32,
    pub current: Option<i64>,
    pub stop: Option<i64>,
    pub stride: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Control {
    pub node_id: Option<u32>,
    pub pending: Vec<u32>,
    pub input_cursor: usize,
    pub iterations: Vec<Iteration>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Allocator {
    pub next_object: u32,
    pub next_frame: u32,
    pub live_bytes: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Counters {
    pub assignments: u32,
    pub list_writes: u32,
    pub comparisons: u32,
    pub calls: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct State {
    pub globals: BTreeMap<String, Datum>,
    pub frames: Vec<Frame>,
    #[serde(serialize_with = "object_records")]
    pub objects: BTreeMap<u32, Vec<Datum>>,
    pub control: Control,
    pub allocator: Allocator,
    pub output: String,
    pub counters: Counters,
}

fn object_records<S: Serializer>(
    objects: &BTreeMap<u32, Vec<Datum>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut output = serializer.serialize_map(Some(objects.len()))?;
    for (id, items) in objects {
        output.serialize_entry(&format!("o{id}"), items)?;
    }
    output.end()
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "op", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum Change {
    Binding {
        frame_id: u32,
        name: String,
        before: Option<Datum>,
        after: Option<Datum>,
    },
    Object {
        object_id: u32,
        before: Option<Vec<Datum>>,
        after: Option<Vec<Datum>>,
    },
    Slot {
        object_id: u32,
        index: usize,
        before_len: usize,
        after_len: usize,
        before: Option<Datum>,
        after: Option<Datum>,
    },
    Frame {
        before: Option<Frame>,
        after: Option<Frame>,
    },
    Control {
        before: Control,
        after: Control,
    },
    Allocator {
        before: Allocator,
        after: Allocator,
    },
    Output {
        before_bytes: usize,
        after_bytes: usize,
        append: String,
    },
    Counters {
        before: Counters,
        after: Counters,
    },
}

fn object_size(items: &[Datum]) -> usize {
    32 + items.iter().map(Datum::size).sum::<usize>()
}

impl Change {
    fn live_delta(&self) -> isize {
        let (before, after) = match self {
            Self::Binding {
                name,
                before,
                after,
                ..
            } => (
                before.as_ref().map_or(0, |d| d.size() + name.len()),
                after.as_ref().map_or(0, |d| d.size() + name.len()),
            ),
            Self::Object { before, after, .. } => (
                before.as_deref().map_or(0, object_size),
                after.as_deref().map_or(0, object_size),
            ),
            Self::Slot { before, after, .. } => (
                before.as_ref().map_or(0, Datum::size),
                after.as_ref().map_or(0, Datum::size),
            ),
            Self::Frame { before, after } => (
                before.as_ref().map_or(0, Frame::size),
                after.as_ref().map_or(0, Frame::size),
            ),
            _ => (0, 0),
        };
        after as isize - before as isize
    }
}

impl State {
    pub fn bindings(&self, frame: u32) -> &BTreeMap<String, Datum> {
        if frame == 0 {
            &self.globals
        } else {
            &self
                .frames
                .iter()
                .find(|entry| entry.id == frame)
                .expect("active frame")
                .bindings
        }
    }
    fn bindings_mut(&mut self, frame: u32) -> &mut BTreeMap<String, Datum> {
        if frame == 0 {
            &mut self.globals
        } else {
            &mut self
                .frames
                .iter_mut()
                .find(|entry| entry.id == frame)
                .expect("active frame")
                .bindings
        }
    }
    pub(crate) fn apply(&mut self, step: &Step, forward: bool) {
        if forward {
            for change in &step.changes {
                self.change(change, true);
            }
        } else {
            for change in step.changes.iter().rev() {
                self.change(change, false);
            }
        }
    }
    fn change(&mut self, change: &Change, forward: bool) {
        macro_rules! direction {
            ($before:expr, $after:expr) => {
                if forward {
                    ($before, $after)
                } else {
                    ($after, $before)
                }
            };
        }
        match change {
            Change::Binding {
                frame_id,
                name,
                before,
                after,
            } => {
                let (from, to) = direction!(before, after);
                let bindings = self.bindings_mut(*frame_id);
                assert_eq!(bindings.get(name), from.as_ref());
                if let Some(value) = to {
                    bindings.insert(name.clone(), value.clone());
                } else {
                    bindings.remove(name);
                }
            }
            Change::Object {
                object_id,
                before,
                after,
            } => {
                let (from, to) = direction!(before, after);
                assert_eq!(self.objects.get(object_id), from.as_ref());
                if let Some(value) = to {
                    self.objects.insert(*object_id, value.clone());
                } else {
                    self.objects.remove(object_id);
                }
            }
            Change::Slot {
                object_id,
                index,
                before_len,
                after_len,
                before,
                after,
            } => {
                let (from, to) = direction!(before, after);
                let (len, next) = direction!(before_len, after_len);
                let items = self.objects.get_mut(object_id).expect("live list");
                assert_eq!(items.len(), *len);
                if let Some(from) = from {
                    assert_eq!(&items[*index], from);
                    if let Some(to) = to {
                        items[*index] = to.clone();
                    } else {
                        items.remove(*index);
                    }
                } else if let Some(to) = to {
                    items.insert(*index, to.clone());
                }
                assert_eq!(items.len(), *next);
            }
            Change::Frame { before, after } => {
                let (from, to) = direction!(before, after);
                if let Some(frame) = from {
                    assert_eq!(self.frames.pop().as_ref(), Some(frame));
                }
                if let Some(frame) = to {
                    self.frames.push(frame.clone());
                }
            }
            Change::Control { before, after } => {
                let (from, to) = direction!(before, after);
                assert_eq!(&self.control, from);
                self.control = to.clone();
            }
            Change::Allocator { before, after } => {
                let (from, to) = direction!(before, after);
                assert_eq!(&self.allocator, from);
                self.allocator = to.clone();
            }
            Change::Counters { before, after } => {
                let (from, to) = direction!(before, after);
                assert_eq!(&self.counters, from);
                self.counters = to.clone();
            }
            Change::Output {
                before_bytes,
                after_bytes,
                append,
            } => {
                if forward {
                    assert_eq!(self.output.len(), *before_bytes);
                    self.output.push_str(append);
                    assert_eq!(self.output.len(), *after_bytes);
                } else {
                    assert_eq!(self.output.len(), *after_bytes);
                    assert_eq!(&self.output[*before_bytes..], append);
                    self.output.truncate(*before_bytes);
                }
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Step {
    pub seq: usize,
    pub kind: &'static str,
    pub node_id: u32,
    pub value: Option<Value>,
    pub changes: Vec<Change>,
}

#[derive(Debug, Serialize)]
pub(crate) struct Checkpoint {
    pub cursor: usize,
    pub state: State,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Trace {
    #[serde(serialize_with = "ordered_items")]
    pub checkpoints: Vec<Checkpoint>,
    pub completeness: &'static str,
    #[serde(serialize_with = "ordered")]
    pub initial_state: State,
    #[serde(serialize_with = "ordered_items")]
    pub steps: Vec<Step>,
}
impl Default for Trace {
    fn default() -> Self {
        Self {
            completeness: "complete",
            initial_state: State::default(),
            steps: vec![],
            checkpoints: vec![],
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Usage {
    pub objects: usize,
    pub output_bytes: usize,
    pub result_bytes: usize,
    pub steps: usize,
}

impl Trace {
    pub fn commit(
        &mut self,
        state: &mut State,
        meter: &mut Meter,
        usage: &mut Usage,
        node: Node,
        mut step: Step,
        temporary_bytes: usize,
    ) -> PyResult<usize> {
        let error = |code| Fault::new(code, node.byte_range, "runtime");
        let limits = *meter.limits();
        if usage.steps >= limits.steps {
            return Err(error("E_STEP_LIMIT"));
        }
        let changes = &mut step.changes;
        let output = changes
            .iter()
            .filter_map(|item| match item {
                Change::Output { append, .. } => Some(append.len()),
                _ => None,
            })
            .sum::<usize>();
        let objects = changes
            .iter()
            .filter(|change| {
                matches!(
                    change,
                    Change::Object {
                        before: None,
                        after: Some(_),
                        ..
                    }
                )
            })
            .count();
        if usage.output_bytes + output > limits.output_bytes {
            return Err(error("E_OUTPUT_LIMIT"));
        }
        if usage.objects + objects > MAX_OBJECTS {
            return Err(error("E_MEMORY_LIMIT"));
        }
        let mut allocator = state.allocator.clone();
        let mut counters = state.counters.clone();
        let delta = changes.iter().map(Change::live_delta).sum::<isize>();
        allocator.live_bytes = allocator
            .live_bytes
            .checked_add_signed(delta)
            .ok_or_else(|| error("E_MEMORY_LIMIT"))?;
        if allocator.live_bytes + temporary_bytes > limits.live_bytes {
            return Err(error("E_MEMORY_LIMIT"));
        }
        allocator.next_object += objects as u32;
        for change in changes.iter() {
            match change {
                Change::Binding { .. } => counters.assignments += 1,
                Change::Slot { .. } => counters.list_writes += 1,
                Change::Frame {
                    before: None,
                    after: Some(_),
                } => {
                    allocator.next_frame += 1;
                    counters.calls += 1;
                }
                _ => {}
            }
        }
        if step.kind == "compare" {
            counters.comparisons += 1;
        }
        if allocator != state.allocator {
            changes.push(Change::Allocator {
                before: state.allocator.clone(),
                after: allocator,
            });
        }
        if counters != state.counters {
            changes.push(Change::Counters {
                before: state.counters.clone(),
                after: counters,
            });
        }
        let seq = self.steps.len() + 1;
        step.seq = seq;
        let step_bytes = serialized_size(&step).map_err(|_| error("E_ENCODING_FAILURE"))? + 1;
        charge(
            meter,
            4 + step_bytes.div_ceil(64),
            node.byte_range,
            "runtime",
        )?;
        let checkpoint = if seq.is_multiple_of(CHECKPOINT) {
            charge(
                meter,
                state.allocator.live_bytes.div_ceil(64) + 1,
                node.byte_range,
                "runtime",
            )?;
            let mut after = state.clone();
            after.apply(&step, true);
            Some(Checkpoint {
                cursor: seq,
                state: after,
            })
        } else {
            None
        };
        let checkpoint_bytes = checkpoint
            .as_ref()
            .map(serialized_size)
            .transpose()
            .map_err(|_| error("E_ENCODING_FAILURE"))?
            .map_or(0, |bytes| bytes + 1);
        let next_size = usage.result_bytes + step_bytes + checkpoint_bytes;
        if next_size > limits.result_bytes {
            return Err(error("E_RESULT_LIMIT"));
        }
        charge(
            meter,
            checkpoint_bytes.div_ceil(64),
            node.byte_range,
            "runtime",
        )?;
        meter
            .reserve_result(next_size)
            .map_err(|e| Fault::budget(e, node.byte_range, "runtime"))?;
        if let Some(checkpoint) = checkpoint {
            *state = checkpoint.state.clone();
            self.checkpoints.push(checkpoint);
        } else {
            state.apply(&step, true);
        }
        self.steps.push(step);
        usage.result_bytes = next_size;
        usage.steps += 1;
        usage.objects += objects;
        usage.output_bytes += output;
        Ok(seq)
    }
}

pub(crate) fn serialized_size(value: &impl Serialize) -> Result<usize, serde_json::Error> {
    struct Count(usize);
    impl std::io::Write for Count {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count(0);
    serde_json::to_writer(&mut count, value)?;
    Ok(count.0)
}

// Sort each bounded trace fragment independently to avoid retaining a second
// JSON tree for the complete result in WASM linear memory.
pub(crate) fn ordered<T: Serialize, S: Serializer>(
    value: &T,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serde_json::to_value(value)
        .map_err(S::Error::custom)?
        .serialize(serializer)
}

pub(crate) struct OrderedItems<'a, T>(pub &'a [T]);

impl<T: Serialize> Serialize for OrderedItems<'_, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ordered_items(self.0, serializer)
    }
}

pub(crate) fn ordered_items<T: Serialize, S: Serializer>(
    items: &[T],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut output = serializer.serialize_seq(Some(items.len()))?;
    for item in items {
        output.serialize_element(&serde_json::to_value(item).map_err(S::Error::custom)?)?;
    }
    output.end()
}
