use serde::ser::SerializeMap;
use serde::{Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};

use crate::budget::TERMINAL_BYTES;
use crate::codec::{self, CodecError};
use crate::parser::{self, Node, Program};
use crate::runtime::{
    self, ALIAS, AND_RIGHT, AND_SHORT, BRANCH, CONCAT, CONVERT, DIVIDE, FLOOR, MUTATED, NESTED,
    RANGE, REM, SLICE, STR_INDEX, SUBTRACT, WHILE,
};
use crate::trace::{
    Change, OrderedItems, Proof, Trace, Usage, Value, ordered, ordered_items, serialized_size,
};
use crate::{Fault, Meter, charge, span};

const ENGINE: &str = "engine.rust.python3";
const ENGINE_VERSION: &str = "0.1.0";
const PACKAGE: &str = "content.python.runoob3";
const VERSION: &str = "1.0.0";
const JUDGE: &str = "2.1.0";
const EXEC: &str = "1.6.0";
const STEP: &str = "1.5.0";
const DIAG: &str = "1.5.0";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    language: String,
    engine_id: String,
    engine_version: String,
    python_reference: String,
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
    language: &'static str,
    #[serde(serialize_with = "ordered_items")]
    node_map: Vec<Node>,
    python_reference: &'static str,
    result: ResultKind<'a>,
    run_id: &'a str,
    source_revision: &'a str,
    source_sha256: &'a str,
    usage: Usage,
}

enum ResultKind<'a> {
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

impl Serialize for ResultKind<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let count = match self {
            Self::Run { .. } => 2,
            Self::Judge { .. } | Self::Edit { .. } => 7,
        };
        let mut map = serializer.serialize_map(Some(count))?;
        match self {
            Self::Run { packet } => {
                map.serialize_entry("kind", "run")?;
                map.serialize_entry("packet", packet)?;
            }
            Self::Judge {
                judge_version,
                package_ref,
                profile_ref,
                status,
                diagnostic,
                cases,
            } => {
                map.serialize_entry("cases", cases)?;
                map.serialize_entry(
                    "diagnostic",
                    &serde_json::to_value(diagnostic).map_err(serde::ser::Error::custom)?,
                )?;
                map.serialize_entry("judgeVersion", judge_version)?;
                map.serialize_entry("kind", "judge")?;
                map.serialize_entry("packageRef", package_ref)?;
                map.serialize_entry("profileRef", profile_ref)?;
                map.serialize_entry("status", status)?;
            }
            Self::Edit {
                edit_version,
                package_ref,
                document_id,
                status,
                diagnostic,
                block_map,
            } => {
                map.serialize_entry("blockMap", &OrderedItems(block_map))?;
                map.serialize_entry(
                    "diagnostic",
                    &serde_json::to_value(diagnostic).map_err(serde::ser::Error::custom)?,
                )?;
                map.serialize_entry("documentId", document_id)?;
                map.serialize_entry("editVersion", edit_version)?;
                map.serialize_entry("kind", "edit")?;
                map.serialize_entry("packageRef", package_ref)?;
                map.serialize_entry("status", status)?;
            }
        }
        map.end()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Packet {
    terminal: Terminal,
    trace: Option<Trace>,
}

#[derive(Serialize)]
struct Terminal {
    cursor: usize,
    #[serde(serialize_with = "ordered")]
    diagnostic: Option<Fault>,
    status: &'static str,
}

impl Packet {
    fn new(trace: Option<Trace>, diagnostic: Option<Fault>) -> Self {
        let status = diagnostic.as_ref().map_or("completed", Fault::status);
        let cursor = trace.as_ref().map_or(0, |trace| trace.steps.len());
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
    #[serde(serialize_with = "ordered_items")]
    observations: Vec<Observation>,
    packet: Packet,
    stdout_matches: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    seq: usize,
    node_id: u32,
    tag: &'static str,
    value: Option<Value>,
}

fn is_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))
}

fn identity(value: &str) -> bool {
    (1..=96).contains(&value.len())
        && value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'.' | b'-' | b'_'))
}

fn package_is(reference: &Reference) -> bool {
    reference.id == PACKAGE && reference.version == VERSION
}

fn validate(request: &Request, build_id: &str, meter: &mut Meter) -> Result<(), &'static str> {
    if request.language != "python"
        || request.engine_id != ENGINE
        || request.engine_version != ENGINE_VERSION
        || request.python_reference != "3.13"
        || request.exec_version != EXEC
        || request.dsl_version != STEP
        || request.diagnostic_version != DIAG
        || request.integer_encoding != VERSION
        || !identity(&request.run_id)
        || !identity(&request.source_revision)
        || !is_hex(build_id)
        || !is_hex(&request.source_sha256)
    {
        return Err("E_PROTOCOL_INVALID");
    }
    if request.source.len() > meter.limits().source_bytes {
        return Err("E_SOURCE_LIMIT");
    }
    charge(
        meter,
        request.source.len().div_ceil(16) + 1,
        span(0, request.source.len()),
        "preflight",
    )
    .map_err(|error| error.code)?;
    let sha = format!("{:x}", Sha256::digest(request.source.as_bytes()));
    if sha != request.source_sha256 {
        return Err("E_SOURCE_IDENTITY");
    }
    match &request.operation {
        Operation::Run { input } => {
            if input.kind != "stdin-utf8" {
                return Err("E_PROTOCOL_INVALID");
            }
            if !runtime::valid_input(&input.text) {
                return Err("E_INPUT_LIMIT");
            }
        }
        Operation::Judge {
            judge_version,
            package_ref,
            profile_ref,
        } => {
            if judge_version != JUDGE
                || !package_is(package_ref)
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
            if edit_version != JUDGE || !package_is(package_ref) || !identity(document_id) {
                return Err("E_PROTOCOL_INVALID");
            }
        }
    }
    Ok(())
}

/// Interpret a closed JSON-INT request and emit the matching Python-only packet.
/// Deadline and cancellation are infrastructure outcomes and never grant a pass.
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    let decoded =
        codec::decode(bytes, meter, meter.limits().request_bytes).map_err(|error| match error {
            CodecError::Budget(error) => Fault::budget(error, span(0, 0), "preflight").code,
            CodecError::Limit { .. } => "E_REQUEST_LIMIT",
            _ => "E_PROTOCOL_INVALID",
        })?;
    let request: Request = serde_json::from_value(decoded).map_err(|_| "E_PROTOCOL_INVALID")?;
    validate(&request, build_id, meter)?;
    let profile = if let Operation::Judge { profile_ref, .. } = &request.operation {
        let catalog = include_str!("../../../content/python3/judges-1.0.0.json");
        charge(meter, catalog.len().div_ceil(8), span(0, 0), "judge")
            .map_err(|fault| fault.code)?;
        let profiles: Vec<Profile> =
            serde_json::from_str(catalog).map_err(|_| "E_PROFILE_INVALID")?;
        Some(
            profiles
                .into_iter()
                .find(|profile| profile.id == profile_ref.id)
                .ok_or("E_PROFILE_INVALID")?,
        )
    } else {
        None
    };
    let parsed = parser::parse(&request.source, meter);
    let mut usage = Usage {
        result_bytes: TERMINAL_BYTES
            + parsed.as_ref().ok().map_or(0, |program| {
                serialized_size(&program.nodes).unwrap_or(usize::MAX / 2)
            }),
        ..Usage::default()
    };
    if usage.result_bytes > meter.limits().result_bytes {
        return Err("E_RESULT_LIMIT");
    }
    if parsed.is_ok() {
        meter
            .reserve_result(usage.result_bytes)
            .map_err(|error| Fault::budget(error, span(0, 0), "preflight").code)?;
    }
    let (node_map, result) = match parsed {
        Ok(program) => {
            let result = match &request.operation {
                Operation::Run { input } => {
                    let run = runtime::run(&program, &input.text, meter, &mut usage);
                    ResultKind::Run {
                        packet: Packet::new(Some(run.trace), run.diagnostic),
                    }
                }
                Operation::Judge {
                    package_ref,
                    profile_ref,
                    ..
                } => {
                    let (status, cases) = judge(
                        &program,
                        profile.as_ref().expect("resolved profile"),
                        meter,
                        &mut usage,
                    );
                    ResultKind::Judge {
                        judge_version: JUDGE,
                        package_ref,
                        profile_ref,
                        status,
                        cases,
                        diagnostic: None,
                    }
                }
                Operation::Edit {
                    package_ref,
                    document_id,
                    ..
                } => {
                    let mapped = crate::edit::map(&program);
                    ResultKind::Edit {
                        edit_version: JUDGE,
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
            };
            (program.nodes, result)
        }
        Err(error) => {
            let result = match &request.operation {
                Operation::Run { .. } => ResultKind::Run {
                    packet: Packet::new(None, Some(error)),
                },
                Operation::Judge {
                    package_ref,
                    profile_ref,
                    ..
                } => ResultKind::Judge {
                    judge_version: JUDGE,
                    package_ref,
                    profile_ref,
                    status: "incomplete",
                    diagnostic: Some(error),
                    cases: Vec::new(),
                },
                Operation::Edit {
                    package_ref,
                    document_id,
                    ..
                } => ResultKind::Edit {
                    edit_version: JUDGE,
                    package_ref,
                    document_id,
                    status: if error.code == "E_PY_UNSUPPORTED" {
                        "unsupported"
                    } else {
                        "invalid"
                    },
                    diagnostic: Some(error),
                    block_map: Vec::new(),
                },
            };
            (Vec::new(), result)
        }
    };
    let mut response = Response {
        language: "python",
        engine_id: ENGINE,
        engine_version: ENGINE_VERSION,
        engine_build_sha256: build_id,
        python_reference: "3.13",
        exec_version: EXEC,
        dsl_version: STEP,
        diagnostic_version: DIAG,
        integer_encoding: VERSION,
        run_id: &request.run_id,
        source_revision: &request.source_revision,
        source_sha256: &request.source_sha256,
        node_map,
        result,
        usage: Usage {
            result_bytes: 0,
            ..usage
        },
        fuel: 0,
    };
    meter
        .begin_finalization()
        .map_err(|error| Fault::budget(error, span(0, 0), "encode").code)?;
    let estimate = serialized_size(&response).map_err(|_| "E_ENCODING_FAILURE")?;
    if estimate + 24 > meter.limits().result_bytes {
        return Err("E_RESULT_LIMIT");
    }
    charge(meter, estimate.div_ceil(64), span(0, 0), "encode").map_err(|error| error.code)?;
    response.fuel = meter.used();
    // Replace the two placeholder digits with the actual fuel and result size.
    let overhead = estimate - 2 + digits(response.fuel);
    response.usage.result_bytes = overhead + 1;
    loop {
        let exact = overhead + digits(response.usage.result_bytes);
        if exact == response.usage.result_bytes {
            break;
        }
        response.usage.result_bytes = exact;
    }
    let encoded = serde_json::to_vec(&response).map_err(|_| "E_ENCODING_FAILURE")?;
    if encoded.len() > meter.limits().result_bytes {
        return Err("E_RESULT_LIMIT");
    }
    if encoded.len() != response.usage.result_bytes {
        return Err("E_ENCODING_FAILURE");
    }
    meter
        .check_commit()
        .map_err(|error| Fault::budget(error, span(0, 0), "encode").code)?;
    Ok(encoded)
}

fn digits(value: usize) -> usize {
    value.checked_ilog10().map_or(1, |power| power as usize + 1)
}

fn judge(
    program: &Program,
    profile: &Profile,
    meter: &mut Meter,
    usage: &mut Usage,
) -> (&'static str, Vec<Case>) {
    let mut cases = Vec::with_capacity(4);
    for (index, (input, expected)) in profile.cases.iter().enumerate() {
        let run = runtime::run(program, input, meter, usage);
        let stdout_matches = run.state.output == *expected;
        let observation_matches =
            run.diagnostic.is_none() && matches_goal(&profile.id, index, &run);
        let observations = witnesses(&profile.id, &run);
        let packet = Packet::new(Some(run.trace), run.diagnostic);
        let interrupted = matches!(packet.terminal.status, "limited" | "cancelled");
        cases.push(Case {
            case_key: index + 1,
            stdout_matches,
            observation_matches,
            observations,
            packet,
        });
        if interrupted {
            return ("incomplete", cases);
        }
    }
    if cases
        .iter()
        .all(|case| case.stdout_matches && case.observation_matches)
    {
        ("passed", cases)
    } else {
        ("failed", cases)
    }
}

fn matches_goal(id: &str, index: usize, run: &runtime::Run) -> bool {
    let facts = &run.facts;
    let print = |index| {
        facts
            .prints
            .get(index)
            .map_or(Proof::default(), |item: &runtime::Printed| item.proof)
    };
    let first = print(0);
    let second = print(1);
    let requires =
        |proof: Proof, flags, inputs| proof.has(flags) && proof.inputs & inputs == inputs;
    match id {
        "py3.practice.greeting" => facts.reads == 1 && requires(first, CONCAT, 1),
        "py3.practice.floor-pair" => facts.reads == 2 && requires(first, FLOOR, 3) && requires(second, REM, 3),
        "py3.practice.short-circuit" => facts.reads == 2 && if index == 0 {
            requires(first, AND_SHORT, 2)
        } else { requires(first, AND_RIGHT | FLOOR, 3) },
        "py3.practice.true-division" => facts.reads == 2 && requires(first, DIVIDE, 3),
        "py3.practice.code-point" => facts.reads == 2 && requires(first, STR_INDEX, 3),
        "py3.practice.list-alias" => facts.reads == 2 && requires(first, ALIAS | MUTATED, 2) &&
            run.trace.steps.iter().any(|step| step.kind == "list-create" && step.changes.iter().any(|change|
                matches!(change, Change::Object { object_id, after: Some(items), .. }
                    if *object_id == first.observed_list && items.len() == 1 && items[0].proof.inputs & 1 == 1))),
        "py3.practice.slice-copy" => facts.reads == 2 && requires(first, MUTATED, 2) &&
            requires(second, SLICE, 1) && first.observed_list != second.observed_list,
        "py3.practice.nested-if" => facts.reads == 2 && if index < 2 {
            requires(first, BRANCH, 1) && !first.has(NESTED)
        } else { requires(first, BRANCH | NESTED, 3) },
        "py3.practice.while-odd-sum" => facts.reads == 1 && if index == 3 {
            facts.while_tests == 1 && facts.while_entries == 0 && facts.while_test_inputs == 1
        } else { facts.while_entries > 0 && requires(first, WHILE, 1) },
        "py3.practice.range-sum" => facts.reads == 3 && if index == 2 {
            facts.range_tests == 1 && facts.range_entries == 0 && facts.range_inputs == 7
        } else { facts.range_entries > 0 && requires(first, RANGE, 7) },
        "py3.practice.function-return" => facts.reads == 2 && requires(first, 0, 3) && requires(second, 0, 3) &&
            first.function_node > 0 && first.function_node == second.function_node && first.function_node != u32::MAX &&
            first.returned_from != 0 && second.returned_from != 0 && first.returned_from != second.returned_from,
        "py3.practice.stdin-lines" => facts.reads == 2 && requires(first, CONVERT | SUBTRACT, 3) &&
            first.converted_inputs == 3,
        _ => false,
    }
}

fn witnesses(id: &str, run: &runtime::Run) -> Vec<Observation> {
    let tags: &[&str] = match id {
        "py3.practice.greeting" => &["string-concat"],
        "py3.practice.floor-pair" => &["integer-floor", "integer-remainder"],
        "py3.practice.short-circuit" => &["boolean-short", "boolean-right", "integer-floor"],
        "py3.practice.true-division" => &["true-division"],
        "py3.practice.code-point" => &["string-index"],
        "py3.practice.list-alias" => &["list-create", "bind", "list-write", "list-index"],
        "py3.practice.slice-copy" => &["list-create", "list-slice", "list-write", "list-index"],
        "py3.practice.nested-if" => &["if-test"],
        "py3.practice.while-odd-sum" => &["while-test", "bind"],
        "py3.practice.range-sum" => &["range-test", "bind"],
        "py3.practice.function-return" => &["frame-enter", "return", "frame-exit"],
        "py3.practice.stdin-lines" => &["integer-convert", "subtract"],
        _ => &[],
    };
    let mut nodes = run
        .trace
        .steps
        .iter()
        .filter(|step| step.kind == "input-read" || tags.contains(&step.kind))
        .take(20)
        .map(|step| Observation {
            seq: step.seq,
            node_id: step.node_id,
            tag: step.kind,
            value: step.value.clone(),
        })
        .collect::<Vec<_>>();
    for entry in run.facts.prints.iter().take(4) {
        if !nodes.iter().any(|node| node.seq == entry.seq) {
            nodes.push(Observation {
                seq: entry.seq,
                node_id: entry.node_id,
                tag: "print",
                value: None,
            });
        }
    }
    nodes.sort_by_key(|node| node.seq);
    nodes
}

#[cfg(test)]
mod tests;
