//! Restricted Rust 2018 source is parsed, checked and interpreted here.

#[path = "../../core/src/budget.rs"]
pub mod budget;
#[path = "../../core/src/codec.rs"]
#[allow(
    dead_code,
    reason = "Shared codec also provides encoders used by other language engines"
)]
mod codec;
#[path = "../../core/src/diagnostic.rs"]
#[allow(
    dead_code,
    reason = "Shared budget and source modules use the common diagnostic definitions"
)]
mod diagnostic;
#[path = "../../core/src/source.rs"]
pub mod source;

mod api;
mod check;
mod flow;
mod model;
mod runtime;
mod syntax;
#[cfg(test)]
mod tests;
mod trace;

pub use api::execute;
use budget::{BudgetError, Meter};
use serde::Serialize;
use source::ByteRange;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fault {
    #[serde(serialize_with = "serialize_range")]
    pub byte_range: ByteRange,
    pub code: &'static str,
}

// JSON-INT-01 requires sorted keys. Keep the shared source range type unchanged
// and write the canonical local wire representation directly to the serializer.
pub(crate) fn serialize_range<S: serde::Serializer>(
    range: &ByteRange,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct Range {
        end: usize,
        start: usize,
    }
    Range {
        end: range.end,
        start: range.start,
    }
    .serialize(serializer)
}

impl Fault {
    pub(crate) fn new(code: &'static str, byte_range: ByteRange) -> Self {
        Self { code, byte_range }
    }
    pub(crate) fn status(&self) -> &'static str {
        if matches!(
            self.code,
            "E_STEP_LIMIT"
                | "E_FUEL_LIMIT"
                | "E_STACK_LIMIT"
                | "E_MEMORY_LIMIT"
                | "E_OBJECT_LIMIT"
                | "E_OUTPUT_LIMIT"
                | "E_RESULT_LIMIT"
                | "E_DEPTH_LIMIT"
                | "E_DEADLINE"
        ) {
            "limited"
        } else {
            "error"
        }
    }
}

pub(crate) fn span(start: usize, end: usize) -> ByteRange {
    ByteRange { start, end }
}

pub(crate) fn charge(meter: &mut Meter, amount: usize, range: ByteRange) -> Result<(), Fault> {
    meter.charge(amount).map_err(|error| {
        Fault::new(
            match error {
                BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
                BudgetError::Deadline { .. } => "E_DEADLINE",
                BudgetError::Cancelled => "E_CANCELLED",
            },
            range,
        )
    })
}
