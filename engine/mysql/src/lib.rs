//! MySQL 8.0 teaching subset: current SQL is interpreted in an isolated session.
mod api;
#[path = "../../core/src/budget.rs"]
pub mod budget;
#[path = "../../core/src/codec.rs"]
#[allow(dead_code)]
mod codec;
#[path = "../../core/src/diagnostic.rs"]
#[allow(dead_code)]
mod diagnostic;
mod eval;
pub mod model;
mod runtime;
#[path = "../../core/src/source.rs"]
#[allow(dead_code)]
pub mod source;
mod syntax;
#[cfg(test)]
mod tests;
pub use api::execute;
use budget::{BudgetError, Meter};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ByteRange {
    pub end: usize,
    pub start: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fault {
    pub byte_range: ByteRange,
    pub code: &'static str,
}
impl Fault {
    pub(crate) fn new(code: &'static str, range: ByteRange) -> Self {
        Self {
            byte_range: range,
            code,
        }
    }
    pub(crate) fn status(&self) -> &'static str {
        if self.code.ends_with("_LIMIT") || self.code == "E_DEADLINE" {
            "limited"
        } else {
            "error"
        }
    }
}
pub(crate) fn span(start: usize, end: usize) -> ByteRange {
    ByteRange { end, start }
}
pub(crate) fn charge(meter: &mut Meter, amount: usize, range: ByteRange) -> Result<(), Fault> {
    meter
        .charge(amount)
        .map_err(|e| Fault::new(budget_code(e), range))
}
pub(crate) fn budget_code(e: BudgetError) -> &'static str {
    match e {
        BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
        BudgetError::Deadline { .. } => "E_DEADLINE",
        BudgetError::Cancelled => "E_CANCELLED",
    }
}
