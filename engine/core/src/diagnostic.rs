//! The DIAG-01 checking and basic execution subset. No source excerpts are retained.

use serde::Serialize;

use crate::source::ByteRange;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum DiagnosticCode {
    #[serde(rename = "E_LEX_INVALID")]
    LexInvalid,
    #[serde(rename = "E_UNSUPPORTED_SYNTAX")]
    UnsupportedSyntax,
    #[serde(rename = "E_SOURCE_LIMIT")]
    SourceLimit,
    #[serde(rename = "E_PARSE_INVALID")]
    ParseInvalid,
    #[serde(rename = "E_DEPTH_LIMIT")]
    DepthLimit,
    #[serde(rename = "E_NAME_INVALID")]
    NameInvalid,
    #[serde(rename = "E_TYPE_INVALID")]
    TypeInvalid,
    #[serde(rename = "E_FORMAT_INVALID")]
    FormatInvalid,
    #[serde(rename = "E_UNINITIALIZED")]
    Uninitialized,
    #[serde(rename = "E_DIV_ZERO")]
    DivZero,
    #[serde(rename = "E_INT_OVERFLOW")]
    IntOverflow,
    #[serde(rename = "E_FUEL_LIMIT")]
    FuelLimit,
    #[serde(rename = "E_OUTPUT_LIMIT")]
    OutputLimit,
    #[serde(rename = "E_INDEX_BOUNDS")]
    IndexBounds,
    #[serde(rename = "E_MEMORY_LIMIT")]
    MemoryLimit,
    #[serde(rename = "E_INPUT_INVALID")]
    InputInvalid,
    #[serde(rename = "E_INPUT_ORDER")]
    InputOrder,
    #[serde(rename = "E_BINDING_INVALID")]
    BindingInvalid,
    #[serde(rename = "E_CONTENT_MISMATCH")]
    ContentMismatch,
    #[serde(rename = "E_STEP_LIMIT")]
    StepLimit,
    #[serde(rename = "E_RESULT_LIMIT")]
    ResultLimit,
    #[serde(rename = "E_REQUEST_LIMIT")]
    RequestLimit,
    #[serde(rename = "E_DEADLINE")]
    Deadline,
    #[serde(rename = "E_CANCELLED")]
    Cancelled,
    #[serde(rename = "E_PROTOCOL_INVALID")]
    ProtocolInvalid,
    #[serde(rename = "E_ENCODING_FAILURE")]
    EncodingFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Preflight,
    Lex,
    Parse,
    Semantic,
    Execute,
    Encode,
    Receive,
    Judge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Location {
    Source {
        #[serde(rename = "byteRange")]
        byte_range: ByteRange,
    },
    Synthetic {
        reason: &'static str,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct DiagnosticDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimension: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempted: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub severity: &'static str,
    pub origin: &'static str,
    pub stage: Stage,
    pub location: Location,
    pub details: Box<DiagnosticDetails>,
}

impl Diagnostic {
    pub(crate) fn preflight(code: DiagnosticCode, expected: &'static str) -> Self {
        Self {
            code,
            severity: "error",
            origin: "rust",
            stage: Stage::Preflight,
            location: Location::Synthetic {
                reason: "pre-execution",
            },
            details: Box::new(DiagnosticDetails {
                expected: Some(expected),
                ..Default::default()
            }),
        }
    }

    pub(crate) fn execution(code: DiagnosticCode, range: ByteRange) -> Self {
        Self {
            code,
            severity: "error",
            origin: "rust",
            stage: Stage::Execute,
            location: Location::Source { byte_range: range },
            details: Box::default(),
        }
    }

    pub(crate) fn execution_limit(
        code: DiagnosticCode,
        range: ByteRange,
        dimension: &'static str,
        limit: usize,
        used: usize,
        attempted: usize,
    ) -> Self {
        let mut diagnostic = Self::execution(code, range);
        diagnostic.details.dimension = Some(dimension);
        diagnostic.details.limit = Some(limit);
        diagnostic.details.used = Some(used);
        diagnostic.details.attempted = Some(attempted as u64);
        diagnostic
    }

    pub(crate) fn semantic(code: DiagnosticCode, range: ByteRange, expected: &'static str) -> Self {
        let mut diagnostic = Self::lexical(code, range, expected);
        diagnostic.stage = Stage::Semantic;
        diagnostic
    }
    pub(crate) fn parsing(code: DiagnosticCode, range: ByteRange, expected: &'static str) -> Self {
        let mut diagnostic = Self::lexical(code, range, expected);
        diagnostic.stage = Stage::Parse;
        diagnostic
    }

    pub(crate) fn depth(range: ByteRange, dimension: &'static str, attempted: usize) -> Self {
        let mut diagnostic = Self::parsing(DiagnosticCode::DepthLimit, range, "depth at most 64");
        diagnostic.details.dimension = Some(dimension);
        diagnostic.details.limit = Some(64);
        diagnostic.details.used = Some(64);
        diagnostic.details.attempted = Some(attempted as u64);
        diagnostic
    }
    pub(crate) fn lexical(
        code: DiagnosticCode,
        byte_range: ByteRange,
        expected: &'static str,
    ) -> Self {
        Self {
            code,
            severity: "error",
            origin: "rust",
            stage: Stage::Lex,
            location: Location::Source { byte_range },
            details: Box::new(DiagnosticDetails {
                expected: Some(expected),
                ..Default::default()
            }),
        }
    }

    pub(crate) fn source_limit(attempted: usize, limit: usize) -> Self {
        Self {
            code: DiagnosticCode::SourceLimit,
            severity: "error",
            origin: "rust",
            stage: Stage::Preflight,
            location: Location::Synthetic {
                reason: "pre-execution",
            },
            details: Box::new(DiagnosticDetails {
                dimension: Some("sourceBytes"),
                limit: Some(limit),
                used: Some(0),
                attempted: Some(attempted as u64),
                ..Default::default()
            }),
        }
    }

    pub(crate) fn invalid_encoding() -> Self {
        Self {
            code: DiagnosticCode::LexInvalid,
            severity: "error",
            origin: "rust",
            stage: Stage::Lex,
            location: Location::Synthetic {
                reason: "pre-execution",
            },
            details: Box::new(DiagnosticDetails {
                expected: Some("valid UTF-8 source"),
                ..Default::default()
            }),
        }
    }
}
