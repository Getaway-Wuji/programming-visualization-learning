use crate::{
    Fault, Meter, charge, check, codec, runtime, span, syntax,
    trace::{Trace, Usage},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseProfile {
    input: String,
    expected: String,
    #[serde(default)]
    required_features: Vec<String>,
}
#[derive(Deserialize)]
struct Profile {
    id: String,
    cases: Vec<CaseProfile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Identity<'a> {
    run_id: &'a str,
    source_revision: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Analysis {
    block_map: Vec<u32>,
    status: &'static str,
}

#[derive(Serialize)]
struct CaseResult {
    diagnostic: Option<Fault>,
    index: usize,
    passed: bool,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Judgement {
    cases: Vec<CaseResult>,
    passed: bool,
    review_case: usize,
}

#[derive(Serialize)]
struct Terminal {
    cursor: usize,
    diagnostic: Option<Fault>,
    status: &'static str,
}

#[derive(Serialize)]
struct Replay {
    terminal: Terminal,
    trace: Trace,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response<'a> {
    analysis: Option<Analysis>,
    build_id: &'a str,
    diagnostic: Option<Fault>,
    edition: &'static str,
    identity: Identity<'a>,
    judgement: Option<Judgement>,
    language: &'static str,
    node_map: Vec<syntax::Node>,
    operation: &'a str,
    replay: Option<Replay>,
    status: &'static str,
    usage: Usage,
    version: &'static str,
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, &'static str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or("E_REQUEST_INVALID")
}
fn identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}
fn packet(run: runtime::Run) -> Replay {
    Replay {
        terminal: Terminal {
            status: run.fault.as_ref().map_or("completed", Fault::status),
            diagnostic: run.fault,
            cursor: run.trace.steps.len(),
        },
        trace: run.trace,
    }
}

/// Decode one closed request and interpret its current source under one meter.
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    if build_id.len() != 64
        || !build_id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("E_REQUEST_INVALID");
    }
    let decoded =
        codec::decode(bytes, meter, meter.limits().request_bytes).map_err(|error| match error {
            codec::CodecError::Budget(crate::budget::BudgetError::Deadline { .. }) => "E_DEADLINE",
            codec::CodecError::Budget(crate::budget::BudgetError::Fuel { .. }) => "E_FUEL_LIMIT",
            codec::CodecError::Budget(crate::budget::BudgetError::Cancelled) => "E_CANCELLED",
            _ => "E_REQUEST_INVALID",
        })?;
    let operation = text(&decoded, "operation")?;
    let expected: &[&str] = match operation {
        "execute" => &[
            "version",
            "language",
            "edition",
            "runId",
            "sourceRevision",
            "source",
            "operation",
            "input",
        ],
        "analyze" => &[
            "version",
            "language",
            "edition",
            "runId",
            "sourceRevision",
            "source",
            "operation",
        ],
        "judge" => &[
            "version",
            "language",
            "edition",
            "runId",
            "sourceRevision",
            "source",
            "operation",
            "profile",
            "reviewCase",
        ],
        _ => return Err("E_REQUEST_INVALID"),
    };
    let object = decoded.as_object().ok_or("E_REQUEST_INVALID")?;
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err("E_REQUEST_INVALID");
    }
    if text(&decoded, "version")? != "1.0.0"
        || text(&decoded, "language")? != "rust"
        || text(&decoded, "edition")? != "2018"
    {
        return Err("E_VERSION_UNSUPPORTED");
    }
    let run_id = text(&decoded, "runId")?;
    let revision = text(&decoded, "sourceRevision")?;
    if !identity(run_id) || !identity(revision) {
        return Err("E_REQUEST_INVALID");
    }
    let source = text(&decoded, "source")?;
    if source.len() > 32768 {
        return Err("E_SOURCE_LIMIT");
    }
    let input = if operation == "execute" {
        let value = text(&decoded, "input")?;
        if value.len() > 256 {
            return Err("E_INPUT_LIMIT");
        }
        value
    } else {
        ""
    };
    let mut review_case = 0;
    let mut profile = None;
    if operation == "judge" {
        let id = text(&decoded, "profile")?;
        review_case = decoded
            .get("reviewCase")
            .and_then(Value::as_u64)
            .filter(|v| *v < 4)
            .ok_or("E_REQUEST_INVALID")? as usize;
        let profiles: Vec<Profile> = serde_json::from_str(include_str!(
            "../../../shared/contracts/rust2018-profiles-1.0.0.json"
        ))
        .map_err(|_| "E_PROFILE_UNKNOWN")?;
        profile = Some(
            profiles
                .into_iter()
                .find(|p| p.id == id)
                .ok_or("E_PROFILE_UNKNOWN")?,
        );
    }
    let mut usage = Usage::default();
    let parsed = syntax::parse(source, meter);
    let mut node_map = Vec::new();
    let mut diagnostic = None;
    let mut analysis = None;
    let mut judgement = None;
    let mut replay = None;
    let mut status = "completed";
    match parsed {
        Err(fault) => {
            status = fault.status();
            diagnostic = Some(fault);
        }
        Ok(program) => {
            node_map = program.nodes.clone();
            usage.metadata_bytes = serde_json::to_vec(&node_map)
                .map_err(|_| "E_RESULT_LIMIT")?
                .len();
            if let Err(fault) = check::check(&program, meter) {
                status = fault.status();
                diagnostic = Some(fault);
            } else if operation == "analyze" {
                let mapped = program.functions.len() == 1
                    && !source.contains("//")
                    && !source.contains("/*")
                    && program.nodes.iter().all(|n| {
                        matches!(
                            n.kind.as_str(),
                            "function"
                                | "block"
                                | "let"
                                | "assign"
                                | "name"
                                | "int"
                                | "bool"
                                | "binary"
                                | "unary"
                                | "print"
                                | "if"
                                | "while"
                                | "for"
                                | "return"
                                | "expression"
                        )
                    });
                analysis = Some(Analysis {
                    status: if mapped { "mapped" } else { "code-only" },
                    block_map: if mapped {
                        program.nodes.iter().map(|n| n.id).collect()
                    } else {
                        Vec::new()
                    },
                });
            } else if operation == "execute" {
                let run = runtime::run(&program, input, meter, &mut usage);
                if run
                    .fault
                    .as_ref()
                    .is_some_and(|fault| fault.code == "E_CANCELLED")
                {
                    return Err("E_CANCELLED");
                }
                status = run.fault.as_ref().map_or("completed", Fault::status);
                diagnostic = run.fault.clone();
                replay = Some(packet(run));
            } else if let Some(profile) = profile {
                let mut cases = Vec::new();
                let mut all = true;
                for (index, case) in profile.cases.iter().enumerate() {
                    if case.input.len() > 256 {
                        return Err("E_PROFILE_UNKNOWN");
                    }
                    let run = runtime::run(&program, &case.input, meter, &mut usage);
                    let case_status = run.fault.as_ref().map_or("completed", Fault::status);
                    if run
                        .fault
                        .as_ref()
                        .is_some_and(|fault| fault.code == "E_CANCELLED")
                    {
                        return Err("E_CANCELLED");
                    }
                    let required = case
                        .required_features
                        .iter()
                        .fold(0, |flags, name| flags | runtime::feature(name));
                    let passed = run.fault.is_none()
                        && run.state.output == case.expected
                        && run.state.control.input_cursor == case.input.len()
                        && run.features & required == required;
                    all &= passed;
                    cases.push(CaseResult {
                        index,
                        status: case_status,
                        passed,
                        diagnostic: run.fault.clone(),
                    });
                    if status == "completed" && case_status != "completed" {
                        status = case_status;
                        diagnostic = run.fault.clone();
                    }
                    if index == review_case {
                        replay = Some(packet(run));
                    }
                    if case_status == "limited" {
                        break;
                    }
                }
                judgement = Some(Judgement {
                    passed: all && cases.len() == 4,
                    review_case,
                    cases,
                });
            }
        }
    }
    if diagnostic
        .as_ref()
        .is_some_and(|fault| fault.code == "E_CANCELLED")
    {
        return Err("E_CANCELLED");
    }
    if operation == "analyze" && analysis.is_none() {
        analysis = Some(Analysis {
            status: if diagnostic
                .as_ref()
                .is_some_and(|d| d.code == "E_UNSUPPORTED")
            {
                "unsupported"
            } else {
                "invalid"
            },
            block_map: Vec::new(),
        });
    }
    // Keep the typed trace owned here. Converting it to a second Value tree can
    // exhaust the bounded WASM heap before an otherwise valid prefix is encoded.
    let mut response = Response {
        version: "1.0.0",
        language: "rust",
        edition: "2018",
        operation,
        build_id,
        identity: Identity {
            run_id,
            source_revision: revision,
        },
        status,
        diagnostic,
        node_map,
        analysis,
        judgement,
        replay,
        usage,
    };
    meter.begin_finalization().map_err(|error| match error {
        crate::budget::BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
        crate::budget::BudgetError::Deadline { .. } => "E_DEADLINE",
        crate::budget::BudgetError::Cancelled => "E_CANCELLED",
    })?;
    let estimated = serde_json::to_vec(&response)
        .map_err(|_| "E_RESULT_LIMIT")?
        .len();
    let mut charged = estimated.div_ceil(64);
    charge(meter, charged, span(0, 0)).map_err(|e| e.code)?;
    response.usage.fuel = meter.used();
    for _ in 0..8 {
        let bytes = serde_json::to_vec(&response).map_err(|_| "E_RESULT_LIMIT")?;
        if bytes.len() > meter.limits().result_bytes {
            return Err("E_RESULT_LIMIT");
        }
        let actual_charge = bytes.len().div_ceil(64);
        if actual_charge <= charged {
            meter.check_commit().map_err(|error| match error {
                crate::budget::BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
                crate::budget::BudgetError::Deadline { .. } => "E_DEADLINE",
                crate::budget::BudgetError::Cancelled => "E_CANCELLED",
            })?;
            return Ok(bytes);
        }
        charge(meter, actual_charge - charged, span(0, 0)).map_err(|e| e.code)?;
        charged = actual_charge;
        response.usage.fuel = meter.used();
    }
    Err("E_RESULT_LIMIT")
}
