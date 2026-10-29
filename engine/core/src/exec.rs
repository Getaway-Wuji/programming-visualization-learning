//! Formal EXEC-01 product boundary. The catalog is a separately trusted,
//! verified static-content selection supplied by the controlled Worker, never
//! an entity copied from the execution request. No user content is retained.

use crate::budget::{BudgetError, Meter, TimingPhase};
use crate::codec::{self, Assembly, CodecError};
use crate::diagnostic::{Diagnostic, DiagnosticCode};
use crate::input::{self, BindingMapEntry};
use crate::run::{self, ReportParts};
use crate::source::ByteRange;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const VERSION: &str = "1.0.0";
const VERSIONS: [&str; 5] = [
    "protocolVersion",
    "traceVersion",
    "diagnosticVersion",
    "judgeVersion",
    "encodingVersion",
];
const REQUEST_KEYS: [&str; 20] = [
    "kind",
    "protocolVersion",
    "traceVersion",
    "diagnosticVersion",
    "judgeVersion",
    "encodingVersion",
    "identity",
    "mode",
    "packageRef",
    "languageRef",
    "subsetRef",
    "programRef",
    "subjectRef",
    "learningRevision",
    "engineRef",
    "source",
    "input",
    "judge",
    "budgetRef",
    "remainingMs",
];

/// Static technical error only: the adapter supplies its own trusted identity
/// for requests/transport failures that do not have a trustworthy Rust result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExecFailure(pub &'static str);

fn codec_failure(error: CodecError) -> ExecFailure {
    ExecFailure(match error {
        CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
        CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
        CodecError::Budget(BudgetError::Fuel { .. }) => "E_FUEL_LIMIT",
        CodecError::Limit { .. } => "E_REQUEST_LIMIT",
        CodecError::Allocation => "E_ENCODING_FAILURE",
        _ => "E_PROTOCOL_INVALID",
    })
}
fn protocol<T>() -> Result<T, ExecFailure> {
    Err(ExecFailure("E_PROTOCOL_INVALID"))
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}
fn opaque(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        let mut bytes = text.bytes();
        (1..=96).contains(&text.len())
            && bytes.next().is_some_and(|b| b.is_ascii_alphanumeric())
            && bytes.all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    })
}
fn entity(text: &str) -> bool {
    let mut parts = text.split('.');
    let first = parts.next().unwrap_or_default();
    !text.is_empty()
        && text.len() <= 96
        && first.bytes().next().is_some_and(|b| b.is_ascii_lowercase())
        && first
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && parts.clone().next().is_some()
        && parts.all(|part| {
            !part.is_empty()
                && part.split('-').all(|piece| {
                    !piece.is_empty()
                        && piece
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                })
        })
}
fn version(text: &str) -> bool {
    let parts: Vec<_> = text.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|p| {
            !p.is_empty()
                && (p.len() == 1 || !p.starts_with('0'))
                && p.bytes().all(|b| b.is_ascii_digit())
        })
}
fn reference(value: &Value) -> bool {
    exact(value, &["id", "version"])
        && value["id"].as_str().is_some_and(entity)
        && value["version"].as_str().is_some_and(version)
}
fn fixed_ref(value: &Value, id: &str) -> bool {
    reference(value) && value["id"] == id && value["version"] == VERSION
}
fn positive(value: &Value) -> bool {
    value
        .as_u64()
        .is_some_and(|n| (1..=9_007_199_254_740_991).contains(&n))
}
fn int32(value: &Value) -> bool {
    value.as_i64().is_some_and(|n| i32::try_from(n).is_ok())
}
fn ref_of(entity: &Value) -> Value {
    json!({"id":entity["id"],"version":entity["version"]})
}
fn range(value: &Value, source: &str) -> Option<ByteRange> {
    if !exact(value, &["start", "end"]) {
        return None;
    }
    let start = usize::try_from(value["start"].as_u64()?).ok()?;
    let end = usize::try_from(value["end"].as_u64()?).ok()?;
    let boundary = |at: usize| {
        source.is_char_boundary(at)
            && !(at > 0
                && source.as_bytes().get(at - 1) == Some(&b'\r')
                && source.as_bytes().get(at) == Some(&b'\n'))
    };
    (start < end && end <= source.len() && end <= 32768 && boundary(start) && boundary(end))
        .then_some(ByteRange { start, end })
}

fn request_shape(
    request: &Value,
    build_id: &str,
    meter: &mut Meter,
) -> Result<Vec<BindingMapEntry>, ExecFailure> {
    if !exact(request, &REQUEST_KEYS) || request["kind"] != "execute" {
        return protocol();
    }
    let p05 = request["protocolVersion"] == "1.1.0"
        && request["judgeVersion"] == "1.1.0"
        && ["traceVersion", "diagnosticVersion", "encodingVersion"]
            .iter()
            .all(|key| request[*key] == VERSION)
        && request["mode"] == "exercise-test"
        && request["packageRef"] == json!({"id":"content.c.p05","version":"1.0.0"});
    if !p05 && VERSIONS.iter().any(|key| request[*key] != VERSION) {
        return Err(ExecFailure("E_PROTOCOL_VERSION"));
    }
    let id = &request["identity"];
    if !exact(
        id,
        &[
            "contextId",
            "contextRevision",
            "submissionId",
            "runId",
            "sourceRevision",
            "testCaseKey",
        ],
    ) || !["contextId", "submissionId", "runId"]
        .iter()
        .all(|key| opaque(&id[*key]))
        || !positive(&id["contextRevision"])
        || !positive(&id["sourceRevision"])
        || !(id["testCaseKey"].is_null() || opaque(&id["testCaseKey"]))
    {
        return protocol();
    }
    for key in ["packageRef", "programRef", "subjectRef"] {
        if !reference(&request[key]) {
            return protocol();
        }
    }
    if !positive(&request["learningRevision"])
        || !fixed_ref(&request["languageRef"], "lang.c")
        || !fixed_ref(&request["subsetRef"], "subset.c.p0")
        || !fixed_ref(&request["budgetRef"], "budget.p0")
        || !exact(&request["engineRef"], &["id", "version", "buildId"])
        || request["engineRef"]["id"] != "engine.c.p0"
        || request["engineRef"]["version"] != VERSION
        || !opaque(&request["engineRef"]["buildId"])
        || request["engineRef"]["buildId"] != build_id
    {
        return protocol();
    }
    let remaining = request["remainingMs"]
        .as_u64()
        .filter(|n| (1..=1000).contains(n))
        .ok_or(ExecFailure("E_PROTOCOL_INVALID"))?;
    meter.shorten_deadline(remaining);
    meter
        .check_commit()
        .map_err(|e| codec_failure(CodecError::Budget(e)))?;
    match request["mode"].as_str() {
        Some("case") if request["judge"].is_null() && id["testCaseKey"].is_null() => {}
        Some("exercise-test") if opaque(&id["testCaseKey"]) => {
            let judge = &request["judge"];
            let has_array = judge.get("expectedArray").is_some();
            let keys = [
                "profileRef",
                "rule",
                "expectedStdout",
                "expectedExitCode",
                "expectedArray",
            ];
            if !exact(judge, &keys[..if has_array { 5 } else { 4 }])
                || !reference(&judge["profileRef"])
                || !(if p05 {
                    judge["rule"]
                        .as_str()
                        .and_then(crate::judge::p05_profile_for_rule)
                        .is_some_and(|profile| {
                            judge["profileRef"] == json!({"id":profile,"version":"1.0.0"})
                        })
                } else {
                    [
                        "input-read-output",
                        "multiply-add-output",
                        "if-else-paths",
                        "while-for-accumulations",
                        "single-index-increment",
                        "logical-array-accumulation",
                    ]
                    .iter()
                    .any(|r| judge["rule"] == *r)
                })
                || !judge["expectedStdout"]
                    .as_str()
                    .is_some_and(|s| s.len() <= 16384)
                || judge["expectedExitCode"] != 0
                || (has_array
                    && !judge["expectedArray"]
                        .as_array()
                        .is_some_and(|a| a.len() <= 30 && a.iter().all(int32)))
            {
                return protocol();
            }
        }
        _ => return protocol(),
    }
    let source = &request["source"];
    if !exact(source, &["text", "blockMap", "bindingMap"]) {
        return protocol();
    }
    let text = source["text"]
        .as_str()
        .ok_or(ExecFailure("E_PROTOCOL_INVALID"))?;
    if text.len() > 32768 {
        return Err(ExecFailure("E_SOURCE_LIMIT"));
    }
    let mut bindings = Vec::new();
    for (key, field) in [("blockId", "blockMap"), ("bindingKey", "bindingMap")] {
        let entries = source[field]
            .as_array()
            .filter(|a| a.len() <= 32768)
            .ok_or(ExecFailure("E_PROTOCOL_INVALID"))?;
        let mut seen = BTreeSet::new();
        for entry in entries {
            meter
                .charge(1 + seen.len())
                .map_err(|e| codec_failure(e.into()))?;
            if !exact(entry, &[key, "byteRange"])
                || !opaque(&entry[key])
                || !seen.insert(entry[key].as_str().unwrap())
            {
                return protocol();
            }
            let byte_range =
                range(&entry["byteRange"], text).ok_or(ExecFailure("E_PROTOCOL_INVALID"))?;
            if field == "bindingMap" {
                bindings.push(BindingMapEntry {
                    binding_key: entry[key].as_str().unwrap().to_owned(),
                    byte_range,
                });
            }
        }
    }
    let input = &request["input"];
    if !exact(input, &["specRef", "values", "random"]) || !reference(&input["specRef"]) {
        return protocol();
    }
    let no_input = p05
        && matches!(
            request["judge"]["profileRef"]["id"].as_str(),
            Some("judge.c.first-output" | "judge.c.partial-array-init")
        );
    if no_input {
        let suffix = if request["judge"]["profileRef"]["id"] == "judge.c.first-output" {
            "first-output"
        } else {
            "partial-array-init"
        };
        if request["programRef"]
            != json!({"id":format!("program.c.practice-{suffix}"),"version":"1.0.0"})
            || input["specRef"] != json!({"id":format!("input.c.{suffix}"),"version":"1.0.0"})
            || input["values"] != json!({})
            || !input["random"].is_null()
            || source["bindingMap"] != json!([])
        {
            return protocol();
        }
    }
    let values = input["values"]
        .as_object()
        .filter(|v| !v.is_empty() || no_input)
        .ok_or(ExecFailure("E_PROTOCOL_INVALID"))?;
    for (key, value) in values {
        let mut bytes = key.bytes();
        if key.len() > 96
            || !bytes
                .next()
                .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
            || !bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
            || !(int32(value)
                || value
                    .as_array()
                    .is_some_and(|a| a.len() <= 30 && a.iter().all(int32)))
        {
            return protocol();
        }
    }
    let random = &input["random"];
    if !random.is_null()
        && (!exact(random, &["generatorRef", "seed"])
            || !reference(&random["generatorRef"])
            || !random["seed"]
                .as_str()
                .is_some_and(|s| (1..=128).contains(&s.chars().count())))
    {
        return protocol();
    }
    Ok(bindings)
}

/// Trusted catalog parsing is separately bounded and charged. JSON-INT is
/// mandatory for requests; the private static catalog may use pretty JSON.
pub fn parse_catalog(text: &str, meter: &mut Meter) -> Result<Value, ExecFailure> {
    if text.len() > 65536 {
        return Err(ExecFailure("E_CONTENT_MISMATCH"));
    }
    meter
        .charge(text.len().div_ceil(64))
        .map_err(|e| codec_failure(e.into()))?;
    let value: Value = serde_json::from_str(text).map_err(|_| ExecFailure("E_CONTENT_MISMATCH"))?;
    if !(exact(&value, &["packageRef", "subject", "program", "inputSpec"])
        || exact(
            &value,
            &[
                "packageRef",
                "subject",
                "program",
                "inputSpec",
                "judgeProfile",
            ],
        ))
    {
        return Err(ExecFailure("E_CONTENT_MISMATCH"));
    }
    Ok(value)
}

fn content_matches(request: &Value, catalog: &Value) -> bool {
    let subject = &catalog["subject"];
    if request["packageRef"] != catalog["packageRef"]
        || request["subjectRef"] != ref_of(subject)
        || request["programRef"] != ref_of(&catalog["program"])
        || subject["programRef"] != request["programRef"]
        || subject["learningRevision"] != request["learningRevision"]
        || subject["languageRef"] != request["languageRef"]
        || catalog["program"]["languageRef"] != request["languageRef"]
        || catalog["program"]["subsetRef"] != request["subsetRef"]
        || request["input"]["specRef"] != ref_of(&catalog["inputSpec"])
        || catalog["program"]["inputRef"] != request["input"]["specRef"]
    {
        return false;
    }
    if request["mode"] == "case" {
        return subject["id"]
            .as_str()
            .is_some_and(|s| s.starts_with("case."));
    }
    let Some(tests) = subject["tests"].as_array() else {
        return false;
    };
    let matches: Vec<_> = tests
        .iter()
        .filter(|test| test["caseKey"] == request["identity"]["testCaseKey"])
        .collect();
    if matches.len() != 1 {
        return false;
    }
    let test = matches[0];
    let judge = &request["judge"];
    subject["id"]
        .as_str()
        .is_some_and(|s| s.starts_with("exercise."))
        && subject["judgeRef"] == ref_of(&catalog["judgeProfile"])
        && judge["profileRef"] == subject["judgeRef"]
        && judge["rule"] == catalog["judgeProfile"]["rule"]
        && request["input"]["values"] == test["input"]
        && judge["expectedStdout"] == test["expectedStdout"]
        && judge["expectedExitCode"] == test["expectedExitCode"]
        && judge.get("expectedArray") == test.get("expectedArray")
}

/// Prepare the currently selected case's example before the run trigger. The
/// returned complete source is what the UI displays and later submits.
pub fn prepare_case(catalog: &Value, meter: &mut Meter) -> Result<Vec<u8>, ExecFailure> {
    prepare_input(catalog, &catalog["program"]["exampleInput"], meter)
}

/// Instantiate explicit, already selected input against the unchanged static
/// program. Runtime verification later checks these same values and source.
pub fn prepare_input(
    catalog: &Value,
    values: &Value,
    meter: &mut Meter,
) -> Result<Vec<u8>, ExecFailure> {
    let program = &catalog["program"];
    let prepared = input::prepare_metered(program, &catalog["inputSpec"], values, meter).map_err(
        |diagnostic| {
            ExecFailure(match diagnostic.code {
                DiagnosticCode::Cancelled => "E_CANCELLED",
                DiagnosticCode::Deadline => "E_DEADLINE",
                DiagnosticCode::FuelLimit => "E_FUEL_LIMIT",
                DiagnosticCode::SourceLimit => "E_SOURCE_LIMIT",
                DiagnosticCode::EncodingFailure => "E_ENCODING_FAILURE",
                DiagnosticCode::InputInvalid => "E_INPUT_INVALID",
                DiagnosticCode::InputOrder => "E_INPUT_ORDER",
                _ => "E_CONTENT_MISMATCH",
            })
        },
    )?;
    let binding_map: Vec<_> = prepared
        .bindings()
        .iter()
        .map(|binding| json!({"bindingKey":binding.binding_key,"byteRange":binding.byte_range}))
        .collect();
    let mut block_map = Vec::new();
    for node in &prepared.checked().parsed.program.nodes {
        if !catalog["subject"]["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("exercise."))
        {
            break;
        }
        meter.charge(1).map_err(|e| codec_failure(e.into()))?;
        let kind = match node.data {
            crate::ast::NodeData::If { .. } => "if",
            crate::ast::NodeData::While { .. } => "while",
            crate::ast::NodeData::For { .. } => "for",
            _ => continue,
        };
        block_map.push(json!({"blockId":format!("control-{kind}-{}",block_map.len()+1),"byteRange":node.byte_range}));
    }
    codec::encode(
        &json!({"source":{"text":prepared.source(),"blockMap":block_map,"bindingMap":binding_map}}),
        meter,
        65536,
    )
    .map_err(codec_failure)
}

/// Canonical bounded preparation input shares the same meter as static
/// configuration and AST instantiation, including cancellation/deadline.
pub fn prepare_input_bytes(
    catalog: &Value,
    bytes: &[u8],
    meter: &mut Meter,
) -> Result<Vec<u8>, ExecFailure> {
    let values = codec::decode(bytes, meter, 65536).map_err(|error| match error {
        CodecError::Budget(_) => codec_failure(error),
        _ => ExecFailure("E_INPUT_INVALID"),
    })?;
    prepare_input(catalog, &values, meter)
}

pub fn execute_request(
    bytes: &[u8],
    catalog: &Value,
    build_id: &str,
    meter: &mut Meter,
) -> Result<Vec<u8>, ExecFailure> {
    // Includes destruction of the retained Rust Trace model after moving its
    // canonical bytes out of RunResult. That cost is outside run_pipeline.
    meter.measure(TimingPhase::CoreRequest, |meter| {
        execute_request_inner(bytes, catalog, build_id, meter)
    })
}

fn execute_request_inner(
    bytes: &[u8],
    catalog: &Value,
    build_id: &str,
    meter: &mut Meter,
) -> Result<Vec<u8>, ExecFailure> {
    let (request, _binding_map, checked, resolved) = meter.measure(TimingPhase::RequestPreflight, |meter| {
        let request =
            codec::decode(bytes, meter, meter.limits().request_bytes).map_err(codec_failure)?;
        let binding_map = request_shape(&request, build_id, meter)?;
        let mut resolved = Vec::new();
        let checked = if !content_matches(&request, catalog) {
            Err(Diagnostic::preflight(
                DiagnosticCode::ContentMismatch,
                "current exact static CONTENT references and test configuration",
            ))
        } else {
            input::verify_instance_metered(
                &catalog["program"],
                &catalog["inputSpec"],
                &request["input"]["values"],
                request["source"]["text"].as_str().unwrap(),
                &binding_map,
                meter,
            )
        };
        if let Ok(checked) = &checked {
            for binding in &binding_map {
                meter
                    .charge(1 + checked.declarations.len())
                    .map_err(|e| codec_failure(e.into()))?;
                let declaration = checked
                    .declarations
                    .iter()
                    .find(|d| {
                        checked.parsed.program.nodes[d.node_id].byte_range == binding.byte_range
                    })
                    .ok_or(ExecFailure("E_BINDING_INVALID"))?;
                resolved.push(json!({"bindingKey":binding.binding_key,"declarationNodeId":format!("n{}",declaration.node_id + 1)}));
            }
        }
        // Keep the original binding-map allocation alive until request return;
        // adding an observation boundary must not shorten payload lifetimes.
        Ok::<_, ExecFailure>((request, binding_map, checked, resolved))
    })?;
    let (fields, _judge) = meter.measure(TimingPhase::MetadataEncode, |meter| {
        let mut fields = BTreeMap::new();
        for key in [
            "identity",
            "engineRef",
            "packageRef",
            "languageRef",
            "subsetRef",
            "programRef",
            "subjectRef",
            "learningRevision",
            "budgetRef",
        ] {
            fields.insert(
                key,
                codec::encode(&request[key], meter, 65536).map_err(codec_failure)?,
            );
        }
        for key in VERSIONS {
            fields.insert(
                key,
                codec::encode(&request[key], meter, 64).map_err(codec_failure)?,
            );
        }
        fields.insert("kind", b"\"result\"".to_vec());
        fields.insert("producer", b"\"rust\"".to_vec());
        fields.insert(
            "resolvedBindings",
            codec::encode(&json!(resolved), meter, 65536).map_err(codec_failure)?,
        );
        let judge = crate::judge::unevaluated(&request);
        fields.insert(
            "judgeResult",
            codec::encode(&judge, meter, 65536).map_err(codec_failure)?,
        );
        Ok::<_, ExecFailure>((fields, judge))
    })?;
    let overhead = fields
        .iter()
        .map(|(key, value)| key.len() + value.len() + 4)
        .sum::<usize>()
        + 2048;
    let result = run::run_pipeline(
        meter,
        overhead
            + if request["mode"] == "exercise-test" {
                8192
            } else {
                0
            },
        (request["mode"] == "exercise-test").then_some(&request),
        |_| checked,
        |parts, meter| encode_result(fields, parts, meter),
    );
    if result.bytes.is_empty() {
        return Err(ExecFailure(
            match result.diagnostics.first().map(|d| d.code) {
                Some(DiagnosticCode::Cancelled) => "E_CANCELLED",
                Some(DiagnosticCode::Deadline) => "E_DEADLINE",
                _ => "E_ENCODING_FAILURE",
            },
        ));
    }
    Ok(result.bytes)
}

fn encode_result(
    mut fields: BTreeMap<&'static str, Vec<u8>>,
    parts: ReportParts<'_>,
    meter: &mut Meter,
) -> Result<Vec<u8>, CodecError> {
    if parts.nodes == b"[]" {
        fields.insert("resolvedBindings", b"[]".to_vec());
    }
    fields.insert("judgeResult", codec::encode(parts.judge, meter, 65536)?);
    let cursor = parts.wire.map(|wire| wire.trace.steps.len());
    let location = parts
        .diagnostics
        .first()
        .map(|d| serde_json::to_value(&d.location).expect("diagnostic location"))
        .or_else(|| {
            parts
                .wire
                .and_then(|wire| wire.trace.steps.last().map(|step| step.location.clone()))
        })
        .unwrap_or_else(|| json!({"kind":"synthetic","reason":"pre-execution"}));
    fields.insert("terminal", codec::encode(&json!({"status":parts.status,"exitCode":parts.exit_code,"cursor":cursor,"location":location,"diagnostics":parts.diagnostics}), meter, 65536)?);
    parts.stats.rust_micros = meter.elapsed_micros();
    let stats = codec::encode(
        &serde_json::to_value(&*parts.stats).expect("stats"),
        meter,
        65536,
    )?;
    let marker = b"\"fuelUsed\":0";
    let fuel_at = stats
        .windows(marker.len())
        .position(|window| window == marker)
        .expect("zero fuel marker")
        + marker.len()
        - 1;
    fields.insert("stats", stats);
    // Canonical keys are sorted once by the bounded static metadata table.
    let mut keys: Vec<_> = fields.keys().copied().chain(["nodeMap", "trace"]).collect();
    meter.charge(keys.len() * keys.len())?;
    keys.sort_unstable();
    let trace_len = parts.wire.map_or(4, |wire| wire.encoded_len());
    let fixed = 2 + keys.len() - 1
        + keys
            .iter()
            .map(|key| {
                key.len()
                    + 3
                    + match *key {
                        "nodeMap" => parts.nodes.len(),
                        "trace" => trace_len,
                        _ => fields[*key].len(),
                    }
            })
            .sum::<usize>()
        - 1;
    let mut final_fuel = meter.used() + 1 + (fixed + 7).div_ceil(64);
    for _ in 0..4 {
        final_fuel = meter.used() + 1 + (fixed + final_fuel.to_string().len()).div_ceil(64);
    }
    let fuel = codec::encode(&json!(final_fuel), meter, 32)?;
    let mut out = Assembly::with_capacity(meter.limits().result_bytes, fixed + fuel.len())?;
    out.append(b"{", meter)?;
    for (index, key) in keys.iter().enumerate() {
        if index > 0 {
            out.append(b",", meter)?;
        }
        out.append(b"\"", meter)?;
        out.append(key.as_bytes(), meter)?;
        out.append(b"\":", meter)?;
        match *key {
            "nodeMap" => out.append(parts.nodes, meter)?,
            "trace" => {
                if let Some(wire) = parts.wire {
                    wire.write(&mut out, meter)?;
                } else {
                    out.append(b"null", meter)?;
                }
            }
            "stats" => {
                let stats = &fields["stats"];
                out.append(&stats[..fuel_at], meter)?;
                out.append(&fuel, meter)?;
                out.append(&stats[fuel_at + 1..], meter)?;
            }
            _ => out.append(&fields[*key], meter)?,
        }
    }
    out.append(b"}", meter)?;
    meter.check_commit()?;
    debug_assert_eq!(meter.used(), final_fuel);
    parts.stats.fuel_used = meter.used();
    Ok(out.finish())
}
