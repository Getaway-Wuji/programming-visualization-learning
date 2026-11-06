use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::budget::TERMINAL_BYTES;
use crate::codec::{self, CodecError};
use crate::runtime::{self, Run};
use crate::syntax::{self, Node, Program};
use crate::trace::{Trace, Usage, Value, encoded_size};
use crate::types::{self, Typed};
use crate::{Fault, Meter, budget_fault, charge, edit, span};

const ENGINE: &str = "engine.rust.java";
const ENGINE_VERSION: &str = "0.1.0";
const EXEC: &str = "1.7.0";
const STEP: &str = "1.6.0";
const DIAG: &str = "1.6.0";
const INTEGER: &str = "1.1.0";
const JUDGE: &str = "2.2.0";
const EDIT: &str = "2.2.0";
const VERSION: &str = "1.0.0";
const PACKAGE: &str = "content.java.runoob";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    language: String,
    engine_id: String,
    engine_version: String,
    java_reference: String,
    exec_version: String,
    dsl_version: String,
    diagnostic_version: String,
    integer_encoding: String,
    run_id: String,
    source_revision: String,
    source_sha256: String,
    source: String,
    operation: Operation,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Operation {
    Run {
        input: Input,
    },
    Judge {
        judge_version: String,
        package_ref: Reference,
        profile_ref: Reference,
    },
    Edit {
        edit_version: String,
        package_ref: Reference,
        document_id: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    kind: String,
    text: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Reference {
    id: String,
    version: String,
}

impl Reference {
    fn is_package(&self) -> bool {
        self.id == PACKAGE && self.version == VERSION
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    id: String,
    cases: [(String, String); 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response<'a> {
    diagnostic_version: &'static str,
    dsl_version: &'static str,
    engine_build_sha256: &'a str,
    engine_id: &'static str,
    engine_version: &'static str,
    exec_version: &'static str,
    fuel: usize,
    integer_encoding: &'static str,
    java_reference: &'static str,
    language: &'static str,
    node_map: Vec<Node>,
    result: Output<'a>,
    run_id: &'a str,
    source_revision: &'a str,
    source_sha256: &'a str,
    usage: Usage,
}

enum Output<'a> {
    Run {
        packet: Packet,
    },
    Judge {
        judge_version: &'static str,
        package_ref: &'a Reference,
        profile_ref: &'a Reference,
        status: &'static str,
        diagnostic: Option<Fault>,
        cases: Vec<Case>,
    },
    Edit {
        edit_version: &'static str,
        package_ref: &'a Reference,
        document_id: &'a str,
        status: &'static str,
        diagnostic: Option<Fault>,
        block_map: Vec<Node>,
    },
}

impl Serialize for Output<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Run { packet } => ordered_map!(serializer; "kind" => "run", "packet" => packet),
            Self::Judge {
                judge_version,
                package_ref,
                profile_ref,
                status,
                diagnostic,
                cases,
            } => ordered_map!(serializer; "cases" => cases, "diagnostic" => diagnostic,
                    "judgeVersion" => judge_version, "kind" => "judge", "packageRef" => package_ref,
                    "profileRef" => profile_ref, "status" => status),
            Self::Edit {
                edit_version,
                package_ref,
                document_id,
                status,
                diagnostic,
                block_map,
            } => ordered_map!(serializer; "blockMap" => block_map, "diagnostic" => diagnostic,
                    "documentId" => document_id, "editVersion" => edit_version, "kind" => "edit",
                    "packageRef" => package_ref, "status" => status),
        }
    }
}

#[derive(Serialize)]
struct Packet {
    terminal: Terminal,
    trace: Option<Trace>,
}

#[derive(Serialize)]
struct Terminal {
    cursor: usize,
    diagnostic: Option<Fault>,
    status: &'static str,
}

impl Packet {
    fn new(trace: Option<Trace>, diagnostic: Option<Fault>) -> Self {
        let cursor = trace.as_ref().map_or(0, |trace| trace.steps.len());
        let status = diagnostic
            .as_ref()
            .map_or("completed", |fault| status(fault.code));
        Self {
            terminal: Terminal {
                status,
                cursor,
                diagnostic,
            },
            trace,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    case_key: usize,
    observation_matches: bool,
    observations: Vec<Observation>,
    packet: Packet,
    stdout_matches: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    node_id: u32,
    seq: usize,
    tag: &'static str,
    value: Value,
}

fn status(code: &str) -> &'static str {
    match code {
        "E_CANCELLED" => "cancelled",
        "E_DEPTH_LIMIT" | "E_MEMORY_LIMIT" | "E_STACK_LIMIT" | "E_STEP_LIMIT"
        | "E_RESULT_LIMIT" | "E_FUEL_LIMIT" | "E_DEADLINE" | "E_OUTPUT_LIMIT" => "limited",
        _ => "error",
    }
}

fn identity(value: &str) -> bool {
    (1..=96).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid_input(text: &str) -> bool {
    text.len() <= 256
}

fn validate(request: &Request, build_id: &str, meter: &mut Meter) -> Result<(), &'static str> {
    if request.language != "java"
        || request.engine_id != ENGINE
        || request.engine_version != ENGINE_VERSION
        || request.java_reference != "21"
        || request.exec_version != EXEC
        || request.dsl_version != STEP
        || request.diagnostic_version != DIAG
        || request.integer_encoding != INTEGER
        || !identity(&request.run_id)
        || !identity(&request.source_revision)
        || !hash(build_id)
        || !hash(&request.source_sha256)
    {
        return Err("E_PROTOCOL_INVALID");
    }
    let size = request.source.len();
    if size > meter.limits().source_bytes {
        return Err("E_SOURCE_LIMIT");
    }
    charge(meter, size.div_ceil(16) + 1, span(0, size), "preflight").map_err(|fault| fault.code)?;
    if format!("{:x}", Sha256::digest(request.source.as_bytes())) != request.source_sha256 {
        return Err("E_SOURCE_IDENTITY");
    }
    match &request.operation {
        Operation::Run { input } => {
            if input.kind != "stdin-utf8" {
                return Err("E_PROTOCOL_INVALID");
            }
            if !valid_input(&input.text) {
                return Err("E_INPUT_LIMIT");
            }
        }
        Operation::Judge {
            judge_version,
            package_ref,
            profile_ref,
        } => {
            if judge_version != JUDGE
                || !package_ref.is_package()
                || profile_ref.version != VERSION
                || !identity(&profile_ref.id)
            {
                return Err("E_PROTOCOL_INVALID");
            }
        }
        Operation::Edit {
            edit_version,
            package_ref,
            document_id,
        } => {
            if edit_version != EDIT || !package_ref.is_package() || !identity(document_id) {
                return Err("E_PROTOCOL_INVALID");
            }
        }
    }
    Ok(())
}

/// Handle a closed Java request. The caller enforces the outer Worker deadline.
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    let at_start = span(0, 0);
    let decoded =
        codec::decode(bytes, meter, meter.limits().request_bytes).map_err(|error| match error {
            CodecError::Budget(error) => budget_fault(error, at_start, "preflight").code,
            CodecError::Limit { .. } => "E_REQUEST_LIMIT",
            _ => "E_PROTOCOL_INVALID",
        })?;
    let request: Request = serde_json::from_value(decoded).map_err(|_| "E_PROTOCOL_INVALID")?;
    validate(&request, build_id, meter)?;
    meter
        .reserve_result(TERMINAL_BYTES)
        .map_err(|error| budget_fault(error, at_start, "preflight").code)?;
    let profile = if let Operation::Judge { profile_ref, .. } = &request.operation {
        let catalog = include_str!("../../../content/java/judges-1.0.0.json");
        charge(meter, catalog.len().div_ceil(8), at_start, "judge").map_err(|fault| fault.code)?;
        let profiles: Vec<Profile> =
            serde_json::from_str(catalog).map_err(|_| "E_PROFILE_INVALID")?;
        Some(
            profiles
                .into_iter()
                .find(|item| item.id == profile_ref.id)
                .filter(|p| p.cases.iter().all(|(input, _)| valid_input(input)))
                .ok_or("E_PROFILE_INVALID")?,
        )
    } else {
        None
    };
    let parsed = syntax::parse(&request.source, meter);
    let mut usage = Usage::default();
    let (nodes, output) = match parsed {
        Ok(program) => {
            let typed = types::check(&program, meter);
            usage.result_bytes = encoded_size(&program.nodes).ok_or("E_ENCODING_FAILURE")?;
            if usage.result_bytes + TERMINAL_BYTES > meter.limits().result_bytes {
                return Err("E_RESULT_LIMIT");
            }
            let output = if let Ok(typed) = typed {
                meter
                    .reserve_result(usage.result_bytes + TERMINAL_BYTES)
                    .map_err(|error| budget_fault(error, at_start, "preflight").code)?;
                success(
                    &request.operation,
                    &program,
                    &typed,
                    profile.as_ref(),
                    meter,
                    &mut usage,
                )
            } else {
                rejected(&request.operation, typed.err().expect("checked rejection"))
            };
            (program.nodes, output)
        }
        Err(fault) => (Vec::new(), rejected(&request.operation, fault)),
    };
    usage.result_bytes = 0;
    let mut response = Response {
        language: "java",
        engine_id: ENGINE,
        engine_version: ENGINE_VERSION,
        java_reference: "21",
        exec_version: EXEC,
        dsl_version: STEP,
        diagnostic_version: DIAG,
        integer_encoding: INTEGER,
        run_id: &request.run_id,
        source_revision: &request.source_revision,
        source_sha256: &request.source_sha256,
        engine_build_sha256: build_id,
        node_map: nodes,
        result: output,
        usage,
        fuel: 0,
    };
    meter
        .begin_finalization()
        .map_err(|error| budget_fault(error, at_start, "encode").code)?;
    let estimate = encoded_size(&response).ok_or("E_ENCODING_FAILURE")?;
    if estimate + 24 > meter.limits().result_bytes {
        return Err("E_RESULT_LIMIT");
    }
    charge(meter, estimate.div_ceil(64), at_start, "encode").map_err(|fault| fault.code)?;
    response.fuel = meter.used();
    let base = estimate - 2 + digits(response.fuel);
    response.usage.result_bytes = base + 1;
    while response.usage.result_bytes != base + digits(response.usage.result_bytes) {
        response.usage.result_bytes = base + digits(response.usage.result_bytes);
    }
    let bytes = serde_json::to_vec(&response).map_err(|_| "E_ENCODING_FAILURE")?;
    if bytes.len() != response.usage.result_bytes {
        return Err("E_ENCODING_FAILURE");
    }
    meter
        .check_commit()
        .map_err(|error| budget_fault(error, at_start, "encode").code)?;
    Ok(bytes)
}

fn digits(value: usize) -> usize {
    value.checked_ilog10().map_or(1, |power| power as usize + 1)
}

fn rejected(operation: &Operation, fault: Fault) -> Output<'_> {
    match operation {
        Operation::Run { .. } => Output::Run {
            packet: Packet::new(None, Some(fault)),
        },
        Operation::Judge {
            package_ref,
            profile_ref,
            ..
        } => Output::Judge {
            judge_version: JUDGE,
            package_ref,
            profile_ref,
            status: "incomplete",
            diagnostic: Some(fault),
            cases: Vec::new(),
        },
        Operation::Edit {
            package_ref,
            document_id,
            ..
        } => Output::Edit {
            edit_version: EDIT,
            package_ref,
            document_id,
            status: if fault.code == "E_JAVA_UNSUPPORTED" {
                "unsupported"
            } else {
                "invalid"
            },
            diagnostic: Some(fault),
            block_map: Vec::new(),
        },
    }
}

fn success<'a>(
    operation: &'a Operation,
    program: &Program,
    typed: &Typed,
    profile: Option<&Profile>,
    meter: &mut Meter,
    usage: &mut Usage,
) -> Output<'a> {
    match operation {
        Operation::Run { input } => {
            let run = runtime::run(program, typed, &input.text, meter, usage);
            Output::Run {
                packet: Packet::new(Some(run.trace), run.fault),
            }
        }
        Operation::Judge {
            package_ref,
            profile_ref,
            ..
        } => {
            let profile = profile.expect("resolved fixed Java profile");
            let mut result = "passed";
            let mut cases = Vec::new();
            for (index, (input, stdout)) in profile.cases.iter().enumerate() {
                let run = runtime::run(program, typed, input, meter, usage);
                let stdout_matches = run.fault.is_none() && run.stdout == *stdout;
                let observation_matches = run.fault.is_none() && observes(&profile.id, index, &run);
                if !stdout_matches || !observation_matches {
                    result = "failed";
                }
                let packet = Packet::new(Some(run.trace), run.fault);
                let incomplete = matches!(packet.terminal.status, "limited" | "cancelled");
                let observations = if observation_matches {
                    run.printed
                        .into_iter()
                        .map(|print| Observation {
                            seq: print.seq,
                            node_id: print.node_id,
                            tag: "print",
                            value: print.value,
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                cases.push(Case {
                    case_key: index + 1,
                    stdout_matches,
                    observation_matches,
                    observations,
                    packet,
                });
                if incomplete {
                    result = "incomplete";
                    break;
                }
            }
            Output::Judge {
                judge_version: JUDGE,
                package_ref,
                profile_ref,
                status: result,
                diagnostic: None,
                cases,
            }
        }
        Operation::Edit {
            package_ref,
            document_id,
            ..
        } => {
            let mapped = edit::map(program);
            Output::Edit {
                edit_version: EDIT,
                package_ref,
                document_id,
                status: if mapped.is_some() {
                    "mapped"
                } else {
                    "code-only"
                },
                diagnostic: None,
                block_map: mapped.unwrap_or_default(),
            }
        }
    }
}

fn observes(profile: &str, index: usize, execution: &Run) -> bool {
    use runtime::*;
    let flags = |print: &Print, mask| print.evidence.flags & mask == mask;
    let from = |print: &Print, mask| print.evidence.inputs & mask == mask;
    let count = |mask| matches!(execution.printed.as_slice(), [print] if flags(print, mask) && from(print, 1));
    match profile.strip_prefix("java.practice.") {
        Some("utf16-length") => count(LENGTH),
        Some("quotient-remainder") => matches!(execution.printed.as_slice(), [quotient, remainder]
            if flags(quotient, DIV) && flags(remainder, REM) && from(quotient, 3) && from(remainder, 3)),
        Some("widen-before-add") => {
            matches!(execution.printed.as_slice(), [print] if flags(print, WIDE_ADD) && from(print, 3))
        }
        Some("narrow-to-int") => count(NARROW),
        Some("short-circuit") if index == 0 => count(AND_SHORT),
        Some("short-circuit") => count(AND_RIGHT | DIV),
        Some("credit-branch") => count(BRANCH),
        Some("odd-total") if index == 0 => {
            execution.while_test_inputs & 1 != 0 && execution.printed.len() == 1
        }
        Some("odd-total") => count(WHILE_UPDATE),
        Some("loop-product") if index == 0 => {
            execution.for_test_inputs & 1 != 0 && execution.printed.len() == 1
        }
        Some("loop-product") => count(FOR_UPDATE),
        Some("array-difference") => {
            matches!(execution.printed.as_slice(), [print] if flags(print, SLOT_0 | SLOT_1 | SUB) && from(print, 3)
                && (1..=crate::trace::MAX_OBJECTS).contains(&print.evidence.storage_object))
        }
        Some("object-alias") => matches!(execution.printed.as_slice(), [default, written]
            if flags(default, FIELD_DEFAULT) && flags(written, FIELD_ALIAS) && from(written, 1)
                && default.evidence.storage_object == written.evidence.storage_object),
        Some("method-gap") => {
            matches!(execution.printed.as_slice(), [print] if flags(print, METHOD_RETURN) && from(print, 3))
        }
        Some("reference-parameter") => count(REFERENCE_PARAMETER),
        _ => false,
    }
}

#[cfg(test)]
mod tests;
