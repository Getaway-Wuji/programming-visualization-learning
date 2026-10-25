//! Bounded core pipeline for 06.4. Browser EXEC identities/lifecycle are 07.1.
//! The internal canonical report includes every retained map/trace/diagnostic
//! and statistic; it is not an EXEC-01 result or a learning event.

use crate::ast::NodeMapEntry;
use crate::budget::{Meter, TimingPhase};
use crate::codec::{self, Assembly, CodecError};
use crate::diagnostic::{Diagnostic, DiagnosticCode, Stage};
use crate::runtime::{self, ExecutionOutcome};
use crate::semantic;
use crate::trace::Trace;
use crate::trace_wire::{self, TraceWire};
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    Completed,
    Rejected,
    ProgramError,
    ResourceLimit,
    Cancelled,
    InfrastructureFailure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStats {
    pub fuel_used: usize,
    pub peak_virtual_bytes: usize,
    pub max_syntax_depth: usize,
    pub max_ast_depth: usize,
    pub rust_micros: Option<u64>,
}

pub struct RunResult {
    pub status: RunStatus,
    pub exit_code: Option<i32>,
    pub diagnostics: Vec<Diagnostic>,
    pub trace: Option<Trace>,
    pub node_map: Vec<NodeMapEntry>,
    pub stats: Option<RunStats>,
    pub bytes: Vec<u8>,
}
impl std::fmt::Debug for RunResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunResult")
            .field("status", &self.status)
            .field("exit_code", &self.exit_code)
            .field("diagnostics", &self.diagnostics)
            .field("stats", &self.stats)
            .field("steps", &self.trace.as_ref().map(|t| t.steps.len()))
            .field("node_count", &self.node_map.len())
            .field("encoded_bytes", &self.bytes.len())
            .finish()
    }
}

pub(crate) fn status(d: &Diagnostic) -> RunStatus {
    match d.code {
        DiagnosticCode::Cancelled => RunStatus::Cancelled,
        DiagnosticCode::FuelLimit
        | DiagnosticCode::StepLimit
        | DiagnosticCode::SourceLimit
        | DiagnosticCode::RequestLimit
        | DiagnosticCode::DepthLimit
        | DiagnosticCode::MemoryLimit
        | DiagnosticCode::OutputLimit
        | DiagnosticCode::ResultLimit
        | DiagnosticCode::Deadline => RunStatus::ResourceLimit,
        DiagnosticCode::EncodingFailure => RunStatus::InfrastructureFailure,
        DiagnosticCode::InputInvalid
        | DiagnosticCode::InputOrder
        | DiagnosticCode::BindingInvalid
        | DiagnosticCode::ContentMismatch
        | DiagnosticCode::ProtocolInvalid => RunStatus::Rejected,
        _ => RunStatus::ProgramError,
    }
}
fn empty(diagnostic: Diagnostic) -> RunResult {
    RunResult {
        status: status(&diagnostic),
        exit_code: None,
        diagnostics: vec![diagnostic],
        trace: None,
        node_map: Vec::new(),
        stats: None,
        bytes: Vec::new(),
    }
}

pub fn run(source: &str, meter: &mut Meter) -> RunResult {
    run_bytes(source.as_bytes(), meter)
}

pub fn run_bytes(source: &[u8], meter: &mut Meter) -> RunResult {
    run_pipeline(
        meter,
        128,
        None,
        |meter| semantic::analyze_bytes_metered(source, meter),
        |parts, meter| {
            encode_report(
                parts.status,
                parts.exit_code,
                parts.diagnostics,
                parts.nodes,
                parts.wire,
                parts.stats,
                meter,
            )
        },
    )
}

pub(crate) struct ReportParts<'a> {
    pub status: RunStatus,
    pub exit_code: Option<i32>,
    pub diagnostics: &'a [Diagnostic],
    pub nodes: &'a [u8],
    pub wire: Option<&'a TraceWire>,
    pub stats: &'a mut RunStats,
    pub judge: &'a Value,
}

/// A formal transport uses the same checked program, runtime and retained
/// canonical fragments; the trace is never decoded/re-encoded a second time.
pub(crate) fn run_pipeline<C, E>(
    meter: &mut Meter,
    overhead: usize,
    judge_request: Option<&Value>,
    check: C,
    encode: E,
) -> RunResult
where
    C: FnOnce(&mut Meter) -> Result<semantic::CheckedProgram, Diagnostic>,
    E: FnOnce(ReportParts<'_>, &mut Meter) -> Result<Vec<u8>, CodecError>,
{
    if let Err(error) = meter.check_commit() {
        return empty(error.diagnostic(
            Stage::Preflight,
            crate::diagnostic::Location::Synthetic {
                reason: "pre-execution",
            },
        ));
    }
    let mut stats = RunStats {
        fuel_used: 0,
        peak_virtual_bytes: 0,
        max_syntax_depth: 0,
        max_ast_depth: 0,
        rust_micros: None,
    };
    let mut result_status = RunStatus::Completed;
    let mut exit_code = None;
    let mut diagnostics = Vec::new();
    let mut nodes = Vec::new();
    let mut wire = None;
    let mut node_bytes = b"[]".to_vec();
    let mut checked_program = None;
    let execution = (|| -> Result<(), Diagnostic> {
        checked_program = Some(check(meter)?);
        let checked = checked_program.as_ref().unwrap();
        stats.max_syntax_depth = checked.parsed.max_syntax_depth;
        stats.max_ast_depth = checked.parsed.max_ast_depth;
        nodes = checked.parsed.program.node_map_metered(meter)?;
        // A P0 node entry uses less than 128 canonical bytes (bounded node IDs,
        // kinds and source offsets). Reserve its final copy before encoding it;
        // a failure before any C action can still emit a small honest terminal.
        if let Err(error) = meter.reserve_result(
            nodes
                .len()
                .saturating_mul(128)
                .saturating_add(crate::budget::TERMINAL_BYTES + overhead),
        ) {
            nodes.clear();
            return Err(error.diagnostic(Stage::Encode, trace_wire::location()));
        }
        if let Err(error) = meter.charge(nodes.len()) {
            nodes.clear();
            return Err(error.diagnostic(Stage::Encode, trace_wire::location()));
        }
        node_bytes = match meter.measure(TimingPhase::NodeMapEncode, |meter| {
            codec::encode(
                &serde_json::to_value(&nodes).expect("node map"),
                meter,
                meter.limits().result_bytes,
            )
        }) {
            Ok(bytes) => bytes,
            Err(error) => {
                nodes.clear();
                return Err(trace_wire::error(error));
            }
        };
        // This interval includes initial projection, incremental canonical
        // trace encoding/admission and teardown, not pure C evaluation.
        let (execution, recording, peak) = meter
            .measure(TimingPhase::ExecuteInclusive, |meter| {
                runtime::execute_metered(checked, meter, node_bytes.len() + overhead)
            })?;
        stats.peak_virtual_bytes = peak;
        wire = Some(recording);
        match execution.outcome {
            ExecutionOutcome::Completed { exit_code: code } => exit_code = Some(code),
            ExecutionOutcome::ProgramError { diagnostic }
            | ExecutionOutcome::ResourceLimit { diagnostic } => return Err(diagnostic),
        }
        Ok(())
    })();
    if let Err(diagnostic) = execution {
        result_status = status(&diagnostic);
        diagnostics.push(diagnostic);
    }
    let mut judge = judge_request.map_or(Value::Null, crate::judge::unevaluated);
    if let Some(request) = judge_request
        && result_status == RunStatus::Completed
        && let (Some(checked), Some(recording)) = (checked_program.as_ref(), wire.as_ref())
    {
        match meter.measure(TimingPhase::Judge, |meter| {
            crate::judge::evaluate(request, checked, &recording.trace, exit_code, meter)
        }) {
            Ok(value) => judge = value,
            Err(diagnostic) => {
                result_status = status(&diagnostic);
                exit_code = None;
                diagnostics.push(diagnostic);
                if let Some(recording) = wire.as_mut() {
                    recording.trace.completeness = "prefix".into();
                }
            }
        }
    }
    if diagnostics
        .iter()
        .any(|d| matches!(d.code, DiagnosticCode::Cancelled | DiagnosticCode::Deadline))
    {
        return empty(diagnostics.remove(0));
    }
    if let Err(error) = meter.begin_finalization() {
        return empty(error.diagnostic(Stage::Encode, trace_wire::location()));
    }
    // Includes the final bounded byte-buffer Assembly, before returning any
    // bytes. Existing public stats.rustMicros is deliberately unchanged.
    let bytes = match meter.measure(TimingPhase::FinalEncode, |meter| {
        encode(
            ReportParts {
                status: result_status,
                exit_code,
                diagnostics: &diagnostics,
                nodes: &node_bytes,
                wire: wire.as_ref(),
                stats: &mut stats,
                judge: &judge,
            },
            meter,
        )
    }) {
        Ok(bytes) => bytes,
        Err(CodecError::Budget(error))
            if matches!(
                error,
                crate::budget::BudgetError::Cancelled | crate::budget::BudgetError::Deadline { .. }
            ) =>
        {
            return empty(error.diagnostic(Stage::Encode, trace_wire::location()));
        }
        Err(_) => {
            return empty(CodecError::Allocation.diagnostic(Stage::Encode, trace_wire::location()));
        }
    };
    RunResult {
        status: result_status,
        exit_code,
        diagnostics,
        trace: wire.map(|wire| wire.trace),
        node_map: nodes,
        stats: Some(stats),
        bytes,
    }
}

fn encode_report(
    status: RunStatus,
    exit: Option<i32>,
    diagnostics: &[Diagnostic],
    nodes: &[u8],
    wire: Option<&TraceWire>,
    stats: &mut RunStats,
    meter: &mut Meter,
) -> Result<Vec<u8>, CodecError> {
    let limit = meter.limits().result_bytes;
    let diagnostics = codec::encode(
        &serde_json::to_value(diagnostics).expect("diagnostics"),
        meter,
        limit,
    )?;
    let exit = codec::encode(&json!(exit), meter, limit)?;
    let status = codec::encode(&serde_json::to_value(status).expect("status"), meter, limit)?;
    let stats_bytes = codec::encode(&serde_json::to_value(&*stats).expect("stats"), meter, limit)?;
    let marker = b"\"fuelUsed\":0";
    let start = stats_bytes
        .windows(marker.len())
        .position(|part| part == marker)
        .expect("stats fuel marker")
        + marker.len()
        - 1;
    let trace_len = wire.map_or(4, TraceWire::encoded_len);
    let fixed = b"{\"diagnostics\":,\"exitCode\":,\"nodeMap\":,\"stats\":,\"status\":,\"trace\":}"
        .len()
        + diagnostics.len()
        + exit.len()
        + nodes.len()
        + stats_bytes.len()
        - 1
        + status.len()
        + trace_len;
    // Only the final integer's single output block and final byte-buffer copy
    // remain. Integer formatting is part of the JSON byte phase, not C maths.
    let mut final_fuel = meter.used() + 1 + (fixed + 7).div_ceil(64);
    for _ in 0..4 {
        final_fuel = meter.used() + 1 + (fixed + final_fuel.to_string().len()).div_ceil(64);
    }
    let fuel = codec::encode(&json!(final_fuel), meter, 32)?;
    let mut out = Assembly::with_capacity(limit, fixed + fuel.len())?;
    out.append(b"{\"diagnostics\":", meter)?;
    out.append(&diagnostics, meter)?;
    out.append(b",\"exitCode\":", meter)?;
    out.append(&exit, meter)?;
    out.append(b",\"nodeMap\":", meter)?;
    out.append(nodes, meter)?;
    out.append(b",\"stats\":", meter)?;
    out.append(&stats_bytes[..start], meter)?;
    out.append(&fuel, meter)?;
    out.append(&stats_bytes[start + 1..], meter)?;
    out.append(b",\"status\":", meter)?;
    out.append(&status, meter)?;
    out.append(b",\"trace\":", meter)?;
    if let Some(wire) = wire {
        wire.write(&mut out, meter)?;
    } else {
        out.append(b"null", meter)?;
    }
    out.append(b"}", meter)?;
    meter.check_commit()?;
    debug_assert_eq!(meter.used(), final_fuel, "accounted final assembly");
    stats.fuel_used = meter.used();
    Ok(out.finish())
}
