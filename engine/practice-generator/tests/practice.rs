use c_viz_practice_generator::{Session, process};
use serde_json::{Value, json};
const BUILD: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
fn request(knowledge: &str, difficulty: u8, seed: &str) -> Value {
    json!({"generatorVersion":"1.0.0","requestId":"request.19.2","operation":"generate","knowledgeId":knowledge,"difficulty":difficulty,"seed":seed})
}
fn call(value: Value) -> Result<Value, &'static str> {
    let mut session = Session::new(1000, || 0).unwrap();
    let bytes = process(&serde_json::to_vec(&value).unwrap(), BUILD, &mut session)?;
    assert!(session.fuel_used <= 1_000_000);
    assert!(session.steps <= 20_000);
    assert!(session.output_bytes <= 16_384);
    Ok(serde_json::from_slice(&bytes).unwrap())
}
fn answer(mut req: Value, problem: &Value, source: &str) -> Value {
    req["operation"] = json!("grade");
    req["problemId"] = problem["problemId"].clone();
    req["attemptId"] = json!("attempt.1");
    req["sourceRevision"] = json!("document.1");
    req["source"] = json!(source);
    req
}
#[test]
fn thirty_complete_generated_domains_match_independent_closed_form_expectations_and_alternative_c_programs()
 {
    for knowledge in [
        "knowledge.c.expressions",
        "knowledge.c.conditions",
        "knowledge.c.loops",
    ] {
        for difficulty in [1, 2] {
            for seed in ["0", "1", "7", "42", "4294967295"] {
                let req = request(knowledge, difficulty, seed);
                let generated = call(req.clone())
                    .unwrap_or_else(|e| panic!("{knowledge}/{difficulty}/{seed}:{e}"));
                let p = &generated["problem"];
                let cases = p["cases"].as_array().unwrap();
                assert_eq!(p["validation"]["checkedCases"], cases.len());
                let params = &p["parameters"];
                for case in cases {
                    let x = case["inputText"].as_str().unwrap().parse::<i32>().unwrap();
                    let expected = match knowledge {
                        "knowledge.c.expressions" => {
                            params["a"].as_i64().unwrap() * i64::from(x)
                                + params["b"].as_i64().unwrap()
                        }
                        "knowledge.c.conditions" => {
                            let inside = i64::from(x) >= params["lower"].as_i64().unwrap()
                                && params["upper"]
                                    .as_i64()
                                    .is_none_or(|upper| i64::from(x) <= upper);
                            params[if inside { "inside" } else { "outside" }]
                                .as_i64()
                                .unwrap()
                        }
                        _ => {
                            let d = params["divisor"].as_i64().unwrap();
                            let k = i64::from(x) / d;
                            params["a"].as_i64().unwrap() * d * k * (k + 1) / 2
                                + params["b"].as_i64().unwrap() * k
                        }
                    };
                    assert_eq!(case["expectedStdout"], format!("{expected}\n"));
                }
                let source = if knowledge == "knowledge.c.expressions" {
                    format!(
                        "#include <stdio.h>\nint main(){{int x;scanf(\"%d\",&x);printf(\"%d\\n\",({})+x*({}));return 0;}}",
                        params["b"], params["a"]
                    )
                } else if knowledge == "knowledge.c.loops" {
                    format!(
                        "#include <stdio.h>\nint main(){{int x;scanf(\"%d\",&x);int k=x/({});printf(\"%d\\n\",({})*({})*k*(k+1)/2+({})*k);return 0;}}",
                        params["divisor"], params["a"], params["divisor"], params["b"]
                    )
                } else {
                    p["referenceSource"].as_str().unwrap().into()
                };
                let result = call(answer(req, p, &source)).unwrap();
                assert_eq!(result["assessment"]["verdict"], "passed");
                assert_eq!(result["assessment"]["complete"], true);
                assert_eq!(result["assessment"]["checkedCases"], cases.len());
                assert_eq!(result["assessment"]["replay"]["request"]["source"], source);
                assert_eq!(
                    result["assessment"]["replay"]["result"]["engine"]["buildId"],
                    BUILD
                );
            }
        }
    }
}
#[test]
fn normalized_seed_and_alias_knowledge_have_stable_problem_identity_and_substantive_parameter_changes()
 {
    let a = call(request("knowledge.c.expressions", 1, "42")).unwrap();
    let b = call(request("knowledge.c.output", 1, "00042")).unwrap();
    assert_eq!(a["problem"], b["problem"]);
    let c = call(request("knowledge.c.expressions", 1, "43")).unwrap();
    assert_ne!(a["problem"]["parameters"], c["problem"]["parameters"]);
    assert_ne!(
        a["problem"]["referenceSource"],
        c["problem"]["referenceSource"]
    );
    assert_ne!(a["problem"]["cases"], c["problem"]["cases"]);
}
#[test]
fn strict_minimum_request_rejects_unknown_private_context_duplicate_keys_versions_and_bad_parameters()
 {
    for seed in [
        "",
        "-1",
        "+1",
        "1e2",
        " 1",
        "4294967296",
        "00000000000",
        "春",
    ] {
        assert_eq!(
            call(request("knowledge.c.expressions", 1, seed)).unwrap_err(),
            "E_GEN_SEED"
        );
    }
    assert_eq!(
        call(request("knowledge.c.arrays", 1, "0")).unwrap_err(),
        "E_GEN_KNOWLEDGE"
    );
    assert_eq!(
        call(request("knowledge.c.loops", 3, "0")).unwrap_err(),
        "E_GEN_DIFFICULTY"
    );
    for key in ["summary", "history", "profile", "source", "inputText"] {
        let mut r = request("knowledge.c.expressions", 1, "0");
        r[key] = json!([]);
        assert_eq!(call(r).unwrap_err(), "E_PROTOCOL_INVALID");
    }
    let mut r = request("knowledge.c.expressions", 1, "0");
    r["generatorVersion"] = json!("2.0.0");
    assert_eq!(call(r).unwrap_err(), "E_UNSUPPORTED_VERSION");
    let mut s = Session::new(1000, || 0).unwrap();
    assert_eq!(
        process(
            b"{\"operation\":\"generate\",\"operation\":\"generate\"}",
            BUILD,
            &mut s
        )
        .unwrap_err(),
        "E_PROTOCOL_INVALID"
    );
}
#[test]
fn actual_wrong_answer_then_repair_is_transient_and_checks_every_case() {
    let req = request("knowledge.c.expressions", 2, "7");
    let generated = call(req.clone()).unwrap();
    let p = &generated["problem"];
    let wrong = "#include <stdio.h>\nint main(){int x;scanf(\"%d\",&x);printf(\"0\\n\");return 0;}";
    let result = call(answer(req.clone(), p, wrong)).unwrap();
    assert_eq!(result["assessment"]["verdict"], "unmet");
    assert_eq!(result["assessment"]["complete"], true);
    assert_eq!(result["assessment"]["checkedCases"], 25);
    assert!(result["assessment"]["passedCases"].as_u64().unwrap() < 25);
    assert_eq!(result["assessment"]["replay"]["request"]["source"], wrong);
    let repaired = call(answer(req, p, p["referenceSource"].as_str().unwrap())).unwrap();
    assert_eq!(repaired["assessment"]["verdict"], "passed");
}
#[test]
fn program_errors_limits_and_illegal_preview_inputs_never_claim_complete_success() {
    let req = request("knowledge.c.loops", 2, "1");
    let g = call(req.clone()).unwrap();
    let p = &g["problem"];
    let bad = call(answer(req.clone(), p, "int main(){int x;return x;}")).unwrap();
    assert_eq!(bad["assessment"]["verdict"], "rejected");
    assert_eq!(bad["assessment"]["complete"], false);
    let limited = call(answer(req.clone(), p, "int main(){while(1){}return 0;}"));
    match limited {
        Ok(result) => assert_eq!(result["assessment"]["verdict"], "limited"),
        Err(code) => assert!(["E_FUEL_LIMIT", "E_STEP_LIMIT", "E_RESULT_LIMIT"].contains(&code)),
    }
    for input in ["-1", "10", "1 2", "1e0", "+1", "é", "2147483648"] {
        let mut r = answer(req.clone(), p, p["referenceSource"].as_str().unwrap());
        r["operation"] = json!("preview");
        r["inputText"] = json!(input);
        assert_eq!(call(r).unwrap_err(), "E_GEN_INPUT");
    }
    let mut r = answer(req, p, p["referenceSource"].as_str().unwrap());
    r["operation"] = json!("preview");
    r["inputText"] = json!(" 0000\n");
    let valid = call(r).unwrap();
    assert_eq!(valid["assessment"]["complete"], false);
    assert_eq!(valid["assessment"]["checkedCases"], 1);
    assert_eq!(valid["assessment"]["replay"]["inputText"], "0");
}
#[test]
fn request_and_source_identity_clock_cancellation_and_aggregate_fuel_are_enforced() {
    let req = request("knowledge.c.expressions", 1, "0");
    let g = call(req.clone()).unwrap();
    let p = &g["problem"];
    let mut r = answer(req, p, p["referenceSource"].as_str().unwrap());
    r["problemId"] = json!("generated.other");
    assert_eq!(call(r.clone()).unwrap_err(), "E_GEN_IDENTITY");
    r["problemId"] = p["problemId"].clone();
    r["source"] = json!("x".repeat(32_769));
    assert_eq!(call(r).unwrap_err(), "E_SOURCE_LIMIT");
    let mut s = Session::new(1000, || 0).unwrap();
    s.cancel();
    assert_eq!(process(b"{}", BUILD, &mut s).unwrap_err(), "E_CANCELLED");
    let tick = std::rc::Rc::new(std::cell::Cell::new(0));
    let clock = tick.clone();
    let mut s = Session::new(37, move || clock.get()).unwrap();
    tick.set(37);
    assert_eq!(process(b"{}", BUILD, &mut s).unwrap_err(), "E_DEADLINE");
    let mut s = Session::new(1000, || 0).unwrap();
    s.fuel_used = 999_000;
    assert_eq!(process(b"{}", BUILD, &mut s).unwrap_err(), "E_FUEL_LIMIT");
}
