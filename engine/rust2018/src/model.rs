use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Value {
    Unit,
    I32 { value: i32 },
    Bool { value: bool },
    StringObject { object_id: u32 },
    ArrayObject { object_id: u32 },
    Reference { loan_id: u32 },
}

impl Value {
    pub fn object_id(&self) -> Option<u32> {
        match self {
            Self::StringObject { object_id } | Self::ArrayObject { object_id } => Some(*object_id),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Frame {
    pub call_node: Option<u32>,
    pub function_node: u32,
    pub id: u32,
    pub scope_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Binding {
    pub declaration_node: u32,
    pub frame_id: u32,
    pub id: u32,
    pub mutable: bool,
    pub name: String,
    pub scope_id: u32,
    pub status: &'static str,
    pub r#type: String,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Object {
    pub alive: bool,
    pub id: u32,
    pub items: Option<Vec<i32>>,
    pub kind: &'static str,
    pub text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Loan {
    pub id: u32,
    pub mutable: bool,
    pub parameter_binding_id: u32,
    pub target_binding_id: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Temporary {
    pub id: u32,
    pub r#type: String,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Control {
    pub input_cursor: usize,
    pub node_id: Option<u32>,
    pub return_value: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Allocator {
    pub live_bytes: usize,
    pub next_binding: u32,
    pub next_frame: u32,
    pub next_loan: u32,
    pub next_object: u32,
    pub next_scope: u32,
    pub next_temporary: u32,
}
impl Default for Allocator {
    fn default() -> Self {
        Self {
            next_frame: 1,
            next_scope: 1,
            next_binding: 1,
            next_object: 1,
            next_loan: 1,
            next_temporary: 1,
            live_bytes: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Default)]
pub(crate) struct State {
    pub allocator: Allocator,
    pub bindings: Vec<Binding>,
    pub control: Control,
    pub frames: Vec<Frame>,
    pub loans: Vec<Loan>,
    pub objects: Vec<Object>,
    pub output: String,
    pub temporaries: Vec<Temporary>,
}

impl State {
    pub fn recount(&mut self) {
        self.allocator.live_bytes = self
            .objects
            .iter()
            .filter(|object| object.alive)
            .map(|object| {
                object.text.as_ref().map_or_else(
                    || object.items.as_ref().map_or(0, |items| items.len() * 4),
                    String::len,
                )
            })
            .sum();
    }
}
