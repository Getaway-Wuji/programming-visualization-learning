//! The Python 3.13 teaching subset. All user programs are interpreted here.

pub use c_viz_core::budget;
use c_viz_core::budget::{BudgetError, Meter};
use c_viz_core::source::ByteRange;
use serde::Serialize;

mod api;
mod edit;
mod lexer;
mod parser;
mod printable;
mod runtime;
mod trace;
mod values;

pub use api::execute;

const INT_MAX: i64 = 9_007_199_254_740_991;
const MAX_STRING: usize = 4096;
const MAX_LIST: usize = 256;
const MAX_INPUT: usize = 256;
const MAX_FRAMES: usize = 32;
const MAX_BINDINGS: usize = 128;
const MAX_OBJECTS: usize = 4096;
const MAX_DEPTH: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fault {
    pub code: &'static str,
    pub byte_range: ByteRange,
    pub stage: &'static str,
}

impl Fault {
    fn new(code: &'static str, byte_range: ByteRange, stage: &'static str) -> Self {
        Self {
            code,
            byte_range,
            stage,
        }
    }

    fn budget(error: BudgetError, span: ByteRange, stage: &'static str) -> Self {
        Self::new(
            match error {
                BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
                BudgetError::Deadline { .. } => "E_DEADLINE",
                BudgetError::Cancelled => "E_CANCELLED",
            },
            span,
            stage,
        )
    }

    fn status(&self) -> &'static str {
        match self.code {
            "E_CANCELLED" => "cancelled",
            "E_DEADLINE" | "E_FUEL_LIMIT" | "E_SOURCE_LIMIT" | "E_PY_INTEGER_LIMIT"
            | "E_STEP_LIMIT" | "E_MEMORY_LIMIT" | "E_OUTPUT_LIMIT" | "E_RESULT_LIMIT"
            | "E_STACK_LIMIT" | "E_DEPTH_LIMIT" => "limited",
            _ => "error",
        }
    }
}

type PyResult<T> = Result<T, Fault>;

fn charge(meter: &mut Meter, units: usize, span: ByteRange, stage: &'static str) -> PyResult<()> {
    meter
        .charge(units)
        .map_err(|error| Fault::budget(error, span, stage))
}

fn span(start: usize, end: usize) -> ByteRange {
    ByteRange { start, end }
}
