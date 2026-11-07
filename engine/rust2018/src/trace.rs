use crate::{Fault, Meter, charge, model::State, source::ByteRange};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Change {
    pub after: Value,
    pub before: Value,
    pub component: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u32>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Step {
    pub changes: Vec<Change>,
    pub event: &'static str,
    pub node_id: u32,
    pub seq: usize,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Checkpoint {
    pub cursor: usize,
    pub state: State,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Trace {
    pub checkpoints: Vec<Checkpoint>,
    pub completeness: &'static str,
    pub initial_state: State,
    pub steps: Vec<Step>,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Usage {
    pub fuel: usize,
    pub objects: usize,
    pub output_bytes: usize,
    pub result_bytes: usize,
    pub steps: usize,
    #[serde(skip)]
    pub metadata_bytes: usize,
}

pub(crate) struct TracePoint {
    pub node: u32,
    pub event: &'static str,
    pub range: ByteRange,
}

fn table_changes<T: Serialize + PartialEq>(
    component: &'static str,
    before: &[T],
    after: &[T],
    id: impl Fn(&T) -> u32,
    changes: &mut Vec<Change>,
    range: ByteRange,
) -> Result<(), Fault> {
    let mut left = 0;
    let mut right = 0;
    while left < before.len() || right < after.len() {
        let old = before.get(left);
        let new = after.get(right);
        let selected = match (old, new) {
            (Some(a), Some(b)) => id(a).min(id(b)),
            (Some(a), None) => id(a),
            (None, Some(b)) => id(b),
            (None, None) => break,
        };
        let a = old.filter(|value| id(value) == selected);
        let b = new.filter(|value| id(value) == selected);
        if a != b {
            changes.push(Change {
                component,
                id: Some(selected),
                before: serde_json::to_value(a).map_err(|_| Fault::new("E_RESULT_LIMIT", range))?,
                after: serde_json::to_value(b).map_err(|_| Fault::new("E_RESULT_LIMIT", range))?,
            });
        }
        left += usize::from(a.is_some());
        right += usize::from(b.is_some());
    }
    Ok(())
}

fn singleton_change<T: Serialize + PartialEq>(
    component: &'static str,
    before: &T,
    after: &T,
    changes: &mut Vec<Change>,
    range: ByteRange,
) -> Result<(), Fault> {
    if before != after {
        changes.push(Change {
            component,
            id: None,
            before: serde_json::to_value(before)
                .map_err(|_| Fault::new("E_RESULT_LIMIT", range))?,
            after: serde_json::to_value(after).map_err(|_| Fault::new("E_RESULT_LIMIT", range))?,
        });
    }
    Ok(())
}

impl Trace {
    pub fn new() -> Self {
        let state = State::default();
        Self {
            initial_state: state.clone(),
            steps: Vec::new(),
            checkpoints: vec![Checkpoint { cursor: 0, state }],
            completeness: "prefix",
        }
    }
    pub fn commit(
        &mut self,
        before: &State,
        state: &State,
        point: TracePoint,
        meter: &mut Meter,
        usage: &mut Usage,
    ) -> Result<(), Fault> {
        let TracePoint { node, event, range } = point;
        charge(meter, 1, range)?;
        if usage.steps >= meter.limits().steps {
            return Err(Fault::new("E_STEP_LIMIT", range));
        }
        if state.allocator.live_bytes > meter.limits().live_bytes {
            return Err(Fault::new("E_MEMORY_LIMIT", range));
        }
        if state.output.len()
            > meter
                .limits()
                .output_bytes
                .saturating_sub(usage.output_bytes)
        {
            return Err(Fault::new("E_OUTPUT_LIMIT", range));
        }
        let mut changes = Vec::new();
        table_changes(
            "bindings",
            &before.bindings,
            &state.bindings,
            |record| record.id,
            &mut changes,
            range,
        )?;
        table_changes(
            "objects",
            &before.objects,
            &state.objects,
            |record| record.id,
            &mut changes,
            range,
        )?;
        table_changes(
            "loans",
            &before.loans,
            &state.loans,
            |record| record.id,
            &mut changes,
            range,
        )?;
        table_changes(
            "temporaries",
            &before.temporaries,
            &state.temporaries,
            |record| record.id,
            &mut changes,
            range,
        )?;
        singleton_change("frames", &before.frames, &state.frames, &mut changes, range)?;
        singleton_change(
            "control",
            &before.control,
            &state.control,
            &mut changes,
            range,
        )?;
        singleton_change(
            "allocator",
            &before.allocator,
            &state.allocator,
            &mut changes,
            range,
        )?;
        singleton_change("output", &before.output, &state.output, &mut changes, range)?;
        let step = Step {
            seq: self.steps.len() + 1,
            node_id: node,
            event,
            changes,
        };
        let size = serde_json::to_vec(&step)
            .map_err(|_| Fault::new("E_RESULT_LIMIT", range))?
            .len();
        let checkpoint = if (self.steps.len() + 1).is_multiple_of(128) {
            Some(Checkpoint {
                cursor: self.steps.len() + 1,
                state: state.clone(),
            })
        } else {
            None
        };
        let checkpoint_size = checkpoint
            .as_ref()
            .map(|value| serde_json::to_vec(value).map(|bytes| bytes.len()))
            .transpose()
            .map_err(|_| Fault::new("E_RESULT_LIMIT", range))?
            .unwrap_or(0);
        let admitted = usage.result_bytes + size + checkpoint_size;
        let final_estimate = admitted + usage.metadata_bytes + 65536;
        if final_estimate > meter.limits().result_bytes {
            return Err(Fault::new("E_RESULT_LIMIT", range));
        }
        meter.reserve_result(final_estimate).map_err(|error| {
            Fault::new(
                match error {
                    crate::budget::BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
                    crate::budget::BudgetError::Deadline { .. } => "E_DEADLINE",
                    crate::budget::BudgetError::Cancelled => "E_CANCELLED",
                },
                range,
            )
        })?;
        usage.result_bytes = admitted;
        usage.steps += 1;
        self.steps.push(step);
        if let Some(checkpoint) = checkpoint {
            self.checkpoints.push(checkpoint);
        }
        Ok(())
    }
}
