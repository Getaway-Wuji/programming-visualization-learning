use super::*;

const VERSION: &str = "1.0.0";
const PROFILES: &str = include_str!("../../../content/cpp/course/exercises-1.0.0.json");

pub(super) fn default_value(value: &Val) -> bool {
    match value {
        Val::Int(n) => *n == 0,
        Val::Pointer(pointer) => pointer.object_id.is_none(),
        _ => false,
    }
}

#[derive(Clone, Copy)]
pub(super) struct CaseLimits {
    pub(super) steps: usize,
    pub(super) bytes: usize,
    pub(super) objects: usize,
    pub(super) output: usize,
}

enum Input {
    Integers(Vec<i32>),
    Lines(Vec<String>),
}

impl Input {
    fn decode(value: &Value) -> Result<Self, &'static str> {
        if !exact(value, &["kind", "values"]) {
            return Err("E_INPUT_INVALID");
        }
        let values = value["values"].as_array().ok_or("E_INPUT_INVALID")?;
        match value["kind"].as_str() {
            Some("integers") if values.len() <= 30 => values
                .iter()
                .map(|v| {
                    v.as_i64()
                        .filter(|n| (-999..=999).contains(n))
                        .map(|n| n as i32)
                        .ok_or("E_INPUT_INVALID")
                })
                .collect::<Result<_, _>>()
                .map(Self::Integers),
            Some("lines") if values.len() <= 2 => values
                .iter()
                .map(|v| {
                    v.as_str()
                        .filter(|s| s.len() <= 30 && s.bytes().all(|b| (32..=126).contains(&b)))
                        .map(str::to_owned)
                        .ok_or("E_INPUT_INVALID")
                })
                .collect::<Result<_, _>>()
                .map(Self::Lines),
            _ => Err("E_INPUT_INVALID"),
        }
    }

    fn check(&self, program: &Program) -> Result<(), Fault> {
        let lines = matches!(self, Self::Lines(_));
        for node in &program.nodes {
            if (lines && matches!(node.kind, Kind::Cin(_) | Kind::Scanf(_)))
                || (!lines && matches!(node.kind, Kind::Getline(_)))
            {
                return Err(fault("E_INPUT_KIND", node.range));
            }
        }
        Ok(())
    }

    fn parts(&self) -> (&[i32], &[String]) {
        match self {
            Self::Integers(values) => (values, &[]),
            Self::Lines(values) => (&[], values),
        }
    }
}

struct TestCase {
    input: Input,
    expected: Option<String>,
}

struct CaseResult {
    returned: Option<Val>,
    error: Option<Fault>,
    record: Option<Recording>,
    consumed: usize,
    output: String,
}

impl CaseResult {
    fn failed(error: Fault) -> Self {
        Self {
            returned: None,
            error: Some(error),
            record: None,
            consumed: 0,
            output: String::new(),
        }
    }
}

fn run_case(
    program: &Program,
    types: &[TypeInfo],
    type_packet: &Value,
    metadata_bytes: usize,
    input: &Input,
    limits: &mut CaseLimits,
    meter: &mut Meter,
) -> CaseResult {
    if let Err(error) = input.check(program) {
        return CaseResult::failed(error);
    }
    let main = program.functions.iter().find(|f| f.name == "main").unwrap();
    let range = program.nodes[main.node].range;
    let state = State::new(main.node);
    if limits.bytes < metadata_bytes.saturating_add(80_000) {
        return CaseResult::failed(fault("E_RESULT_LIMIT", range));
    }
    let mut record = match Recording::new(&state, metadata_bytes, type_packet, meter, range) {
        Ok(record) => record,
        Err(error) => return CaseResult::failed(error),
    };
    record.course_limits = Some(*limits);
    let (integers, lines) = input.parts();
    let mut runtime = Runtime {
        p: program,
        types,
        active_heap: 0,
        meter,
        input: integers,
        lines,
        cpp: true,
        depth: 0,
        state,
        record,
        bug_observations: None,
    };
    let (returned, error) = match runtime.call("main", &[], None) {
        Ok(value) => (value, None),
        Err(error) => (None, Some(error)),
    };
    limits.steps = limits.steps.saturating_sub(runtime.record.steps.len());
    limits.bytes = limits.bytes.saturating_sub(runtime.record.bytes);
    limits.objects = limits.objects.saturating_sub(runtime.state.objects.len());
    limits.output = limits.output.saturating_sub(runtime.state.output.len());
    CaseResult {
        returned,
        error,
        consumed: runtime.state.control.input_cursor,
        output: runtime.state.output,
        record: Some(runtime.record),
    }
}

fn status(error: Option<&Fault>) -> &'static str {
    match error.map(|e| e.code) {
        None => "completed",
        Some(code) if code.ends_with("_LIMIT") => "limited",
        _ => "error",
    }
}

fn diagnostic(error: Option<&Fault>) -> Value {
    error.map_or(
        Value::Null,
        |e| json!({"code":e.code,"byteRange":e.byte_range}),
    )
}

fn codec_error(error: codec::CodecError, bound: &'static str) -> &'static str {
    match error {
        codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
        codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
        codec::CodecError::Budget(_) => "E_FUEL_LIMIT",
        codec::CodecError::Limit { .. } => bound,
        _ => "E_PROTOCOL_INVALID",
    }
}

fn tests(request: &Value, meter: &mut Meter) -> Result<(Vec<TestCase>, usize), &'static str> {
    let profile = request["profile"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    meter
        .charge(PROFILES.len().div_ceil(64))
        .map_err(|e| codec_error(e.into(), "E_REQUEST_LIMIT"))?;
    let registry: Value = serde_json::from_str(PROFILES).map_err(|_| "E_PROTOCOL_INVALID")?;
    let exercise = registry
        .as_array()
        .and_then(|items| items.iter().find(|item| item["id"] == profile))
        .ok_or("E_PROFILE_UNKNOWN")?;
    let cases = exercise["cases"]
        .as_array()
        .filter(|items| items.len() == 4)
        .ok_or("E_PROTOCOL_INVALID")?;
    let selected = request["reviewCase"]
        .as_u64()
        .filter(|n| *n < 4)
        .ok_or("E_PROTOCOL_INVALID")?;
    let mut parsed = Vec::with_capacity(4);
    for case in cases {
        if !exact(case, &["id", "input", "expected"]) {
            return Err("E_PROTOCOL_INVALID");
        }
        let expected = case["expected"]
            .as_str()
            .filter(|s| s.len() <= 4096)
            .ok_or("E_PROTOCOL_INVALID")?;
        parsed.push(TestCase {
            input: Input::decode(&case["input"])?,
            expected: Some(expected.to_owned()),
        });
    }
    Ok((parsed, selected as usize))
}

pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    if build_id.len() != 64
        || !build_id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("E_PROTOCOL_INVALID");
    }
    let request = codec::decode(bytes, meter, meter.limits().request_bytes)
        .map_err(|e| codec_error(e, "E_REQUEST_LIMIT"))?;
    let mut fields = vec![
        "version",
        "operation",
        "language",
        "runId",
        "sourceRevision",
        "source",
    ];
    let operation = request["operation"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    match operation {
        "execute" => fields.push("input"),
        "judge" => fields.extend(["profile", "reviewCase"]),
        "analyze" => {}
        _ => return Err("E_PROTOCOL_INVALID"),
    }
    if !exact(&request, &fields)
        || !valid_id(&request["runId"])
        || !valid_id(&request["sourceRevision"])
    {
        return Err("E_PROTOCOL_INVALID");
    }
    if request["version"] != VERSION || request["language"] != "cpp" {
        return Err("E_UNSUPPORTED_VERSION");
    }
    let (cases, selected) = match operation {
        "judge" => tests(&request, meter)?,
        "execute" => (
            vec![TestCase {
                input: Input::decode(&request["input"])?,
                expected: None,
            }],
            0,
        ),
        _ => (vec![], 0),
    };
    let source = request["source"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    let identity = json!({"runId":request["runId"],"sourceRevision":request["sourceRevision"]});
    let mut reply = json!({"version":VERSION,"operation":operation,"language":"cpp","buildId":build_id,
                          "identity":identity,"status":"completed","diagnostic":null,"nodeMap":[],"judgement":null});
    let mut selected_replay = None;
    let program = syntax::parse_course(source, meter).and_then(|program| {
        let types = make_types(&program, meter)?;
        check(&program, &types, meter)?;
        Ok((program, types))
    });
    match program {
        Err(error) => {
            reply["status"] = json!(status(Some(&error)));
            reply["diagnostic"] = diagnostic(Some(&error));
        }
        Ok((program, types)) => {
            let node_map = json!(
                program
                    .nodes
                    .iter()
                    .enumerate()
                    .map(|(id, node)| {
                        json!({"nodeId":nid(id),"kind":node.kind.tag(),"byteRange":node.range})
                    })
                    .collect::<Vec<_>>()
            );
            if operation == "analyze" {
                reply["nodeMap"] = node_map;
            } else {
                let type_packet = json!(types);
                let metadata_bytes = codec::encode(&node_map, meter, meter.limits().result_bytes)
                    .and_then(|map| {
                        codec::encode(&type_packet, meter, meter.limits().result_bytes)
                            .map(|types| map.len() + types.len())
                    })
                    .map_err(|e| codec_error(e, "E_RESULT_LIMIT"))?;
                let mut limits = CaseLimits {
                    steps: meter.limits().steps,
                    bytes: meter.limits().result_bytes,
                    objects: 4096,
                    output: meter.limits().output_bytes,
                };
                let mut outcomes = Vec::new();
                let mut reviewed = None;
                for (index, case) in cases.iter().enumerate() {
                    let result = run_case(
                        &program,
                        &types,
                        &type_packet,
                        metadata_bytes,
                        &case.input,
                        &mut limits,
                        meter,
                    );
                    let verdict = status(result.error.as_ref());
                    if let Some(expected) = &case.expected {
                        let (integers, lines) = case.input.parts();
                        let passed = verdict == "completed"
                            && &result.output == expected
                            && result.consumed == integers.len() + lines.len()
                            && result.returned == Some(Val::Int(0));
                        outcomes.push(json!({"index":index,"status":verdict,"passed":passed,"diagnostic":diagnostic(result.error.as_ref())}));
                    }
                    if verdict == "limited" || operation == "execute" {
                        reply["status"] = json!(verdict);
                        reply["diagnostic"] = diagnostic(result.error.as_ref());
                    }
                    if index == selected {
                        reviewed = Some(result);
                    }
                    if verdict == "limited" || meter.failure().is_some() {
                        break;
                    }
                }
                if operation == "judge" {
                    let passed =
                        outcomes.len() == 4 && outcomes.iter().all(|row| row["passed"] == true);
                    reply["judgement"] =
                        json!({"passed":passed,"reviewCase":selected,"cases":outcomes});
                }
                selected_replay = reviewed.map(|result| (result, node_map, type_packet));
            }
        }
    }
    meter
        .begin_finalization()
        .map_err(|e| codec_error(e.into(), "E_RESULT_LIMIT"))?;
    let limit = meter.limits().result_bytes;
    let mut output = codec::Assembly::new(limit);
    let assemble = (|| -> Result<(), codec::CodecError> {
        let fields = reply.as_object_mut().expect("course reply object");
        let tail = json!({"status":fields.remove("status").unwrap(),"version":fields.remove("version").unwrap()});
        let header = codec::encode(&reply, meter, limit)?;
        output.append(&header[..header.len() - 1], meter)?;
        output.append(b",\"replay\":", meter)?;
        if let Some((result, node_map, types)) = selected_replay {
            let replay = json!({"execVersion":EXEC_VERSION,"dslVersion":DSL_VERSION,"diagnosticVersion":"1.3.0",
                "integerEncoding":"1.0.0","language":"cpp","engine":{"id":ENGINE_ID,"version":"0.1.0","buildId":build_id},
                "identity":identity,"nodeMap":node_map,"stats":{"fuelUsed":meter.used()},
                "terminal":{"status":status(result.error.as_ref()),"code":result.error.as_ref().map(|e|e.code),
                    "byteRange":result.error.as_ref().map(|e|e.byte_range),"cursor":result.record.as_ref().map_or(0, |r| r.steps.len()),
                    "returnValue":result.returned}});
            let header = codec::encode(&replay, meter, limit)?;
            output.append(&header[..header.len() - 1], meter)?;
            output.append(b",\"trace\":", meter)?;
            if let Some(record) = result.record {
                record.write(result.error.is_none(), &mut output, meter)?;
            } else {
                output.append(b"null", meter)?;
            }
            output.append(b",\"types\":", meter)?;
            output.append(&codec::encode(&types, meter, limit)?, meter)?;
            output.append(b"}", meter)?;
        } else {
            output.append(b"null", meter)?;
        }
        let tail = codec::encode(&tail, meter, limit)?;
        output.append(b",", meter)?;
        output.append(&tail[1..], meter)?;
        meter.check_commit()?;
        Ok(())
    })();
    assemble.map_err(|e| codec_error(e, "E_RESULT_LIMIT"))?;
    Ok(output.finish())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::budget::Limits;

    #[test]
    fn judge_shares_the_step_quota_and_withholds_pass() {
        let registry: Value = serde_json::from_str(PROFILES).unwrap();
        let source = &registry[0]["source"];
        let request = json!({"version":"1.0.0","language":"cpp","operation":"judge",
            "runId":"test","sourceRevision":"revision","profile":registry[0]["id"],
            "reviewCase":1,"source":source});
        let mut meter = Meter::with_limits(Limits {
            steps: 14,
            ..Limits::default()
        });
        meter.set_clock(1000, Box::new(|| 0));
        let output = execute(
            &serde_json::to_vec(&request).unwrap(),
            &"0".repeat(64),
            &mut meter,
        )
        .unwrap();
        let output: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(output["status"], "limited");
        assert_eq!(output["judgement"]["passed"], false);
        assert_eq!(output["judgement"]["cases"][0]["passed"], true);
        assert_eq!(output["replay"]["terminal"]["code"], "E_STEP_LIMIT");
        assert_eq!(output["replay"]["trace"]["completeness"], "prefix");
    }

    #[test]
    fn the_original_entry_rejects_the_three_course_extensions() {
        for source in [
            "int main(){do{}while(0);}",
            "void f(int& n){} int main(){}",
            "class C{public:int x;}; int main(){}",
        ] {
            let mut meter = Meter::new();
            meter.set_clock(1000, Box::new(|| 0));
            assert!(syntax::parse(source, "cpp", &mut meter).is_err());
            assert!(syntax::parse_course(source, &mut meter).is_ok());
        }
    }
}
