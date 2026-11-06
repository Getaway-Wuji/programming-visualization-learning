//! Java SE 21 teaching subset. User programs are interpreted without a JVM.

#[path = "../../core/src/budget.rs"]
pub mod budget;
// Compile the shared utilities here to avoid path-dependent external crate identities.
#[allow(
    dead_code,
    reason = "Shared encoding helpers for other language crates"
)]
#[path = "../../core/src/codec.rs"]
mod codec;
#[allow(
    dead_code,
    reason = "Shared diagnostic constructors for other language crates"
)]
#[path = "../../core/src/diagnostic.rs"]
mod diagnostic;
#[path = "../../core/src/source.rs"]
pub mod source;

macro_rules! ordered_map {
    ($serializer:expr; $($key:literal => $value:expr),+ $(,)?) => {{
        use serde::ser::SerializeMap as _;
        let mut map = $serializer.serialize_map(None)?;
        $(map.serialize_entry($key, $value)?;)+
        map.end()
    }};
}

mod api;
mod edit;
mod lexer;
mod runtime;
mod syntax;
mod trace;
mod types;

pub use api::execute;
use budget::{BudgetError, Meter};
use serde::Serialize;
use source::ByteRange;

type JavaResult<T> = Result<T, Fault>;

const MAX_SYNTAX_DEPTH: usize = 64;
const MAX_STRING_BYTES: usize = 4096;
const MAX_BINDINGS: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fault {
    #[serde(serialize_with = "ordered_range")]
    pub byte_range: ByteRange,
    pub code: &'static str,
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
}

fn charge(
    meter: &mut Meter,
    amount: usize,
    range: ByteRange,
    stage: &'static str,
) -> JavaResult<()> {
    meter
        .charge(amount)
        .map_err(|error| budget_fault(error, range, stage))
}

fn budget_fault(error: BudgetError, range: ByteRange, stage: &'static str) -> Fault {
    let code = match error {
        BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
        BudgetError::Deadline { .. } => "E_DEADLINE",
        BudgetError::Cancelled => "E_CANCELLED",
    };
    Fault::new(code, range, stage)
}

fn span(start: usize, end: usize) -> ByteRange {
    ByteRange { start, end }
}

fn ordered_range<S: serde::Serializer>(
    range: &ByteRange,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    ordered_map!(serializer; "end" => &range.end, "start" => &range.start)
}
