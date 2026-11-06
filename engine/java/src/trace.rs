use std::collections::BTreeMap;

use serde::Serialize;

use crate::budget::{FINALIZATION_RESERVE, TERMINAL_BYTES};
use crate::syntax::{Node, Type};
use crate::{Fault, JavaResult, Meter, budget_fault, charge};

pub(crate) const MAX_OBJECTS: u32 = 4096;
pub(crate) const MAX_FRAMES: usize = 32;
pub(crate) const MAX_ARRAY: usize = 256;
const CHECKPOINT_INTERVAL: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Value {
    Null,
    Bool {
        value: bool,
    },
    Int {
        value: i32,
    },
    Long {
        #[serde(serialize_with = "long")]
        value: i64,
    },
    String {
        value: String,
    },
    Ref {
        object_id: u32,
    },
}

fn long<S: serde::Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_str(value)
}

impl Value {
    pub fn default_for(ty: &Type) -> Self {
        match ty {
            Type::Int => Self::Int { value: 0 },
            Type::Long => Self::Long { value: 0 },
            Type::Bool => Self::Bool { value: false },
            _ => Self::Null,
        }
    }

    pub fn display(&self) -> String {
        match self {
            Self::Null => "null".to_owned(),
            Self::Bool { value } => value.to_string(),
            Self::Int { value } => value.to_string(),
            Self::Long { value } => value.to_string(),
            Self::String { value } => value.clone(),
            Self::Ref { .. } => unreachable!("reference stringification is outside the subset"),
        }
    }

    pub fn as_int(&self) -> i32 {
        let Self::Int { value } = *self else {
            unreachable!("checked int expression");
        };
        value
    }

    pub fn as_number(&self) -> i64 {
        match *self {
            Self::Int { value } => i64::from(value),
            Self::Long { value } => value,
            _ => unreachable!("checked numeric expression"),
        }
    }

    pub fn as_bool(&self) -> bool {
        let Self::Bool { value } = *self else {
            unreachable!("checked boolean expression");
        };
        value
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Evidence {
    pub flags: u32,
    pub inputs: u64,
    pub storage_object: u32,
}

impl Evidence {
    pub fn tag(mut self, flag: u32) -> Self {
        self.flags |= flag;
        self
    }
}

impl std::ops::BitOr for Evidence {
    type Output = Self;
    fn bitor(self, other: Self) -> Self {
        Self {
            flags: self.flags | other.flags,
            inputs: self.inputs | other.inputs,
            storage_object: match (self.storage_object, other.storage_object) {
                (0, object) | (object, 0) => object,
                (a, b) if a == b => a,
                _ => u32::MAX,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BindingKey {
    pub frame: u32,
    pub declaration: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct Datum {
    pub value: Value,
    #[serde(skip)]
    pub evidence: Evidence,
    #[serde(skip)]
    pub origin: Option<BindingKey>,
    #[serde(skip)]
    pub writer: Option<BindingKey>,
}

impl Datum {
    pub fn new(value: Value) -> Self {
        Self::observed(value, Evidence::default())
    }

    pub fn observed(value: Value, evidence: Evidence) -> Self {
        Self {
            value,
            evidence,
            origin: None,
            writer: None,
        }
    }

    pub fn int(value: i32) -> Self {
        Self::new(Value::Int { value })
    }

    pub(crate) fn size(&self) -> usize {
        48 + match &self.value {
            Value::String { value } => value.len(),
            _ => 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Frame {
    pub bindings: BTreeMap<String, Datum>,
    pub call_node_id: u32,
    pub id: u32,
    pub method_node_id: u32,
}

impl Frame {
    pub(crate) fn size(&self) -> usize {
        64 + self
            .bindings
            .iter()
            .map(|(name, datum)| name.len() + datum.size())
            .sum::<usize>()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Object {
    IntArray {
        slots: Vec<Datum>,
    },
    StringArray {
        slots: Vec<Datum>,
    },
    Instance {
        class_name: String,
        fields: BTreeMap<String, Datum>,
    },
    Scanner,
}

impl Object {
    pub fn slots(&self) -> &[Datum] {
        match self {
            Self::IntArray { slots } | Self::StringArray { slots } => slots,
            _ => unreachable!("checked array access"),
        }
    }

    fn slots_mut(&mut self) -> &mut [Datum] {
        match self {
            Self::IntArray { slots } | Self::StringArray { slots } => slots,
            _ => unreachable!("checked array access"),
        }
    }

    pub(crate) fn size(&self) -> usize {
        80 + match self {
            Self::IntArray { slots } | Self::StringArray { slots } => {
                slots.iter().map(Datum::size).sum()
            }
            Self::Instance { class_name, fields } => {
                class_name.len()
                    + fields
                        .iter()
                        .map(|(name, datum)| name.len() + datum.size())
                        .sum::<usize>()
            }
            Self::Scanner => 0,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Control {
    pub input_cursor: usize,
    pub node_id: Option<u32>,
    pub path: Vec<u32>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Allocator {
    pub frames: u32,
    pub live_bytes: usize,
    pub objects: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Counters {
    pub calls: u32,
    pub comparisons: u32,
    pub writes: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct State {
    pub allocator: Allocator,
    pub control: Control,
    pub counters: Counters,
    pub frames: Vec<Frame>,
    #[serde(serialize_with = "ordered_objects")]
    pub objects: BTreeMap<u32, Object>,
    pub output: String,
}

#[derive(Debug)]
pub(crate) enum Change {
    Binding {
        frame_id: u32,
        name: String,
        before: Option<Datum>,
        after: Option<Datum>,
    },
    Frame {
        before: Option<Frame>,
        after: Option<Frame>,
    },
    Object {
        object_id: u32,
        before: Option<Object>,
        after: Option<Object>,
    },
    Slot {
        object_id: u32,
        index: usize,
        before: Datum,
        after: Datum,
    },
    Field {
        object_id: u32,
        name: String,
        before: Datum,
        after: Datum,
    },
    Control {
        before: Control,
        after: Control,
    },
    Allocator {
        before: Allocator,
        after: Allocator,
    },
    Counters {
        before: Counters,
        after: Counters,
    },
    Output {
        before_bytes: usize,
        after_bytes: usize,
        append: String,
    },
}

impl Change {
    fn live_delta(&self) -> isize {
        fn difference(before: usize, after: usize) -> isize {
            after as isize - before as isize
        }
        match self {
            Self::Binding {
                name,
                before,
                after,
                ..
            } => {
                let size =
                    |slot: &Option<Datum>| slot.as_ref().map_or(0, |d| d.size() + name.len());
                difference(size(before), size(after))
            }
            Self::Frame { before, after } => difference(
                before.as_ref().map_or(0, Frame::size),
                after.as_ref().map_or(0, Frame::size),
            ),
            Self::Object { before, after, .. } => difference(
                before.as_ref().map_or(0, Object::size),
                after.as_ref().map_or(0, Object::size),
            ),
            Self::Slot { before, after, .. } | Self::Field { before, after, .. } => {
                difference(before.size(), after.size())
            }
            Self::Control { before, after } => {
                difference(before.path.len() * 4, after.path.len() * 4)
            }
            Self::Output {
                before_bytes,
                after_bytes,
                ..
            } => difference(*before_bytes, *after_bytes),
            _ => 0,
        }
    }

    fn apply(&self, state: &mut State, forward: bool) {
        fn side<'a, T>(before: &'a T, after: &'a T, forward: bool) -> &'a T {
            if forward { after } else { before }
        }
        match self {
            Self::Binding {
                frame_id,
                name,
                before,
                after,
            } => {
                let frame = state
                    .frames
                    .iter_mut()
                    .find(|frame| frame.id == *frame_id)
                    .unwrap();
                if let Some(value) = side(before, after, forward) {
                    frame.bindings.insert(name.clone(), value.clone());
                } else {
                    frame.bindings.remove(name);
                }
            }
            Self::Frame { before, after } => {
                if let Some(frame) = side(before, after, forward) {
                    state.frames.push(frame.clone());
                } else {
                    state.frames.pop();
                }
            }
            Self::Object {
                object_id,
                before,
                after,
            } => {
                if let Some(object) = side(before, after, forward) {
                    state.objects.insert(*object_id, object.clone());
                } else {
                    state.objects.remove(object_id);
                }
            }
            Self::Slot {
                object_id,
                index,
                before,
                after,
            } => {
                state.objects.get_mut(object_id).unwrap().slots_mut()[*index] =
                    side(before, after, forward).clone();
            }
            Self::Field {
                object_id,
                name,
                before,
                after,
            } => {
                let Object::Instance { fields, .. } = state.objects.get_mut(object_id).unwrap()
                else {
                    unreachable!("field change requires an instance");
                };
                *fields.get_mut(name).unwrap() = side(before, after, forward).clone();
            }
            Self::Control { before, after } => state.control = side(before, after, forward).clone(),
            Self::Allocator { before, after } => state.allocator = *side(before, after, forward),
            Self::Counters { before, after } => state.counters = *side(before, after, forward),
            Self::Output {
                before_bytes,
                append,
                ..
            } => {
                if forward {
                    state.output.push_str(append);
                } else {
                    state.output.truncate(*before_bytes);
                }
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Step {
    pub changes: Vec<Change>,
    pub kind: &'static str,
    pub node_id: u32,
    pub seq: usize,
    pub value: Option<Value>,
}

#[derive(Serialize)]
pub(crate) struct Checkpoint {
    cursor: usize,
    state: State,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Trace {
    checkpoints: Vec<Checkpoint>,
    pub completeness: &'static str,
    pub initial_state: State,
    pub steps: Vec<Step>,
}

impl Default for Trace {
    fn default() -> Self {
        Self {
            completeness: "complete",
            initial_state: State::default(),
            steps: Vec::new(),
            checkpoints: Vec::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct Recorder {
    pub state: State,
    pub trace: Trace,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Usage {
    pub objects: u32,
    pub output_bytes: usize,
    pub result_bytes: usize,
    pub steps: usize,
}

impl Recorder {
    pub fn commit(
        &mut self,
        meter: &mut Meter,
        usage: &mut Usage,
        node: &Node,
        mut step: Step,
        temp_bytes: usize,
    ) -> JavaResult<usize> {
        let changes = &mut step.changes;
        let fault = |code| Fault::new(code, node.byte_range, "budget");
        if usage.steps >= meter.limits().steps {
            return Err(fault("E_STEP_LIMIT"));
        }
        let output = changes
            .iter()
            .find_map(|change| {
                if let Change::Output { append, .. } = change {
                    Some(append.len())
                } else {
                    None
                }
            })
            .unwrap_or(0);
        if output + usage.output_bytes > meter.limits().output_bytes {
            return Err(fault("E_OUTPUT_LIMIT"));
        }
        let mut next = self.state.allocator;
        for change in changes.iter() {
            match change {
                Change::Object {
                    before: None,
                    after: Some(_),
                    ..
                } => next.objects += 1,
                Change::Frame {
                    before: None,
                    after: Some(_),
                    ..
                } => next.frames += 1,
                _ => {}
            }
        }
        let new_objects = next.objects - self.state.allocator.objects;
        if new_objects + usage.objects > MAX_OBJECTS {
            return Err(fault("E_MEMORY_LIMIT"));
        }
        let delta = changes.iter().map(Change::live_delta).sum::<isize>();
        next.live_bytes = next
            .live_bytes
            .checked_add_signed(delta)
            .ok_or_else(|| fault("E_MEMORY_LIMIT"))?;
        if next.live_bytes + temp_bytes > meter.limits().live_bytes {
            return Err(fault("E_MEMORY_LIMIT"));
        }
        if next != self.state.allocator {
            changes.push(Change::Allocator {
                before: self.state.allocator,
                after: next,
            });
        }
        let seq = self.trace.steps.len() + 1;
        step.seq = seq;
        let limit = meter.limits().result_bytes.saturating_sub(TERMINAL_BYTES);
        let step_bytes = encoded_size(&step).ok_or_else(|| fault("E_RESULT_LIMIT"))? + 1;
        if usage.result_bytes + step_bytes > limit {
            return Err(fault("E_RESULT_LIMIT"));
        }
        charge(
            meter,
            step_bytes.div_ceil(16).max(1),
            node.byte_range,
            "budget",
        )?;
        for change in &step.changes {
            change.apply(&mut self.state, true);
        }
        let admitted = (|| {
            let checkpoint = if seq.is_multiple_of(CHECKPOINT_INTERVAL) {
                Some(Checkpoint {
                    cursor: seq,
                    state: self.state.clone(),
                })
            } else {
                None
            };
            let checkpoint_bytes = if let Some(checkpoint) = &checkpoint {
                let size = encoded_size(checkpoint).ok_or_else(|| fault("E_RESULT_LIMIT"))? + 1;
                if usage.result_bytes + step_bytes + size > limit {
                    return Err(fault("E_RESULT_LIMIT"));
                }
                charge(meter, size.div_ceil(16).max(1), node.byte_range, "budget")?;
                size
            } else {
                0
            };
            let estimated = usage.result_bytes + step_bytes + checkpoint_bytes + TERMINAL_BYTES;
            if FINALIZATION_RESERVE + estimated.div_ceil(64) > meter.reserved() {
                meter
                    .reserve_result(estimated)
                    .map_err(|error| budget_fault(error, node.byte_range, "budget"))?;
            }
            Ok((checkpoint, checkpoint_bytes))
        })();
        match admitted {
            Ok((checkpoint, bytes)) => {
                if let Some(checkpoint) = checkpoint {
                    self.trace.checkpoints.push(checkpoint);
                }
                usage.result_bytes += bytes;
            }
            Err(error) => {
                for change in step.changes.iter().rev() {
                    change.apply(&mut self.state, false);
                }
                return Err(error);
            }
        }
        self.trace.steps.push(step);
        usage.steps += 1;
        usage.objects += new_objects;
        usage.output_bytes += output;
        usage.result_bytes += step_bytes;
        Ok(seq)
    }
}

pub(crate) fn encoded_size(value: &impl Serialize) -> Option<usize> {
    #[derive(Default)]
    struct Size(usize);
    impl std::io::Write for Size {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut size = Size::default();
    serde_json::to_writer(&mut size, value).ok()?;
    Some(size.0)
}

impl Serialize for Object {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::IntArray { slots } => {
                ordered_map!(serializer; "kind" => "int-array", "slots" => slots)
            }
            Self::StringArray { slots } => {
                ordered_map!(serializer; "kind" => "string-array", "slots" => slots)
            }
            Self::Instance { class_name, fields } => {
                ordered_map!(serializer; "className" => class_name, "fields" => fields, "kind" => "instance")
            }
            Self::Scanner => ordered_map!(serializer; "kind" => "scanner"),
        }
    }
}

fn ordered_objects<S: serde::Serializer>(
    objects: &BTreeMap<u32, Object>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap as _;
    let mut map = serializer.serialize_map(Some(objects.len()))?;
    for (id, object) in objects {
        map.serialize_entry(&format!("o{id:04}"), object)?;
    }
    map.end()
}

impl Serialize for Change {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Binding {
                frame_id,
                name,
                before,
                after,
            } => ordered_map!(serializer;
                "after" => after, "before" => before, "frameId" => frame_id, "name" => name, "op" => "binding"),
            Self::Frame { before, after } => ordered_map!(serializer;
                "after" => after, "before" => before, "op" => "frame"),
            Self::Object {
                object_id,
                before,
                after,
            } => ordered_map!(serializer;
                "after" => after, "before" => before, "objectId" => object_id, "op" => "object"),
            Self::Slot {
                object_id,
                index,
                before,
                after,
            } => ordered_map!(serializer;
                "after" => after, "before" => before, "index" => index, "objectId" => object_id, "op" => "slot"),
            Self::Field {
                object_id,
                name,
                before,
                after,
            } => ordered_map!(serializer;
                "after" => after, "before" => before, "name" => name, "objectId" => object_id, "op" => "field"),
            Self::Control { before, after } => ordered_map!(serializer;
                "after" => after, "before" => before, "op" => "control"),
            Self::Allocator { before, after } => ordered_map!(serializer;
                "after" => after, "before" => before, "op" => "allocator"),
            Self::Counters { before, after } => ordered_map!(serializer;
                "after" => after, "before" => before, "op" => "counters"),
            Self::Output {
                before_bytes,
                after_bytes,
                append,
            } => ordered_map!(serializer;
                "afterBytes" => after_bytes, "append" => append, "beforeBytes" => before_bytes, "op" => "output"),
        }
    }
}
