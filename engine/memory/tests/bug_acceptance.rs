use c_viz_memory::{budget::Meter, codec, runtime};
use serde_json::{Value, json};
fn meter() -> Meter {
    let mut m = Meter::new();
    m.set_clock(1000, Box::new(|| 0));
    m
}
fn registry() -> Value {
    serde_json::from_str(include_str!(
        "../../../content/cpp/bugs/questions-1.0.0.json"
    ))
    .unwrap()
}
fn request(q: &Value, source: &str, index: usize) -> Value {
    json!({"execVersion":"1.3.0","dslVersion":"1.2.0","diagnosticVersion":"1.2.0","integerEncoding":"1.0.0","engineId":"engine.rust.memory","language":"cpp","source":source,"input":q["tests"][index]["input"],"runId":"bug.test","sourceRevision":"source.1","bug":{"version":"1.0.0","exerciseId":q["exerciseRef"]["id"],"caseKey":q["tests"][index]["caseKey"]}})
}
fn run(request: &Value) -> Value {
    let bytes = codec::encode(request, &mut meter(), 65536).unwrap();
    let bytes = runtime::execute_bug(&bytes, &"f".repeat(64), &mut meter()).unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
fn roundtrip(r: &Value) {
    let trace = &r["trace"];
    let mut state = trace["initialState"].clone();
    let steps = trace["steps"].as_array().unwrap();
    for s in steps {
        runtime::apply_changes(
            &mut state,
            s["changes"].as_array().unwrap(),
            false,
            &r["types"],
        )
        .unwrap();
    }
    let end = state.clone();
    for s in steps.iter().rev() {
        runtime::apply_changes(
            &mut state,
            s["changes"].as_array().unwrap(),
            true,
            &r["types"],
        )
        .unwrap();
    }
    assert_eq!(state, trace["initialState"]);
    for s in steps {
        runtime::apply_changes(
            &mut state,
            s["changes"].as_array().unwrap(),
            false,
            &r["types"],
        )
        .unwrap();
    }
    assert_eq!(state, end);
}
#[test]
fn reference_and_different_repairs_pass_all_32_real_groups() {
    for q in registry()["questions"].as_array().unwrap() {
        for field in ["solutionSource", "alternativeSource"] {
            for i in 0..4 {
                let result = run(&request(q, q[field].as_str().unwrap(), i));
                assert_eq!(
                    result["bugJudgement"]["status"], "met",
                    "{} {field} {i}: {}",
                    q["exerciseRef"]["id"], result["terminal"]
                );
                assert_eq!(result["terminal"]["status"], "completed");
                roundtrip(&result);
            }
        }
    }
}
#[test]
fn broken_sources_really_fail_with_exact_pointer_or_full_budget_prefix() {
    let codes = [
        "E_UNINITIALIZED",
        "E_DANGLING_POINTER",
        "E_STEP_LIMIT",
        "E_STEP_LIMIT",
    ];
    for (i, q) in registry()["questions"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        let result = run(&request(q, q["brokenSource"].as_str().unwrap(), 0));
        assert_eq!(result["terminal"]["code"], codes[i]);
        assert_eq!(result["bugJudgement"]["status"], "unmet");
        assert_eq!(result["trace"]["completeness"], "prefix");
        if i >= 2 {
            assert_eq!(result["trace"]["steps"].as_array().unwrap().len(), 20000);
            assert!(result["stats"]["fuelUsed"].as_u64().unwrap() <= 1_000_000);
        }
        roundtrip(&result);
    }
}
#[test]
fn forged_input_or_unknown_identity_is_rejected_before_execution() {
    let q = &registry()["questions"][0];
    let base = request(q, q["solutionSource"].as_str().unwrap(), 0);
    for field in ["input", "case", "id", "version", "extra", "language"] {
        let mut req = base.clone();
        match field {
            "input" => req["input"] = json!([2]),
            "case" => req["bug"]["caseKey"] = json!("unknown"),
            "id" => req["bug"]["exerciseId"] = json!("unknown"),
            "version" => req["bug"]["version"] = json!("9.0.0"),
            "extra" => req["bug"]["extra"] = json!(true),
            _ => req["language"] = json!("c"),
        };
        let bytes = codec::encode(&req, &mut meter(), 65536).unwrap();
        assert!(runtime::execute_bug(&bytes, &"f".repeat(64), &mut meter()).is_err());
    }
}
#[test]
fn old_closed_entry_does_not_accept_bug_companion() {
    let q = &registry()["questions"][0];
    let req = request(q, q["solutionSource"].as_str().unwrap(), 0);
    let bytes = codec::encode(&req, &mut meter(), 65536).unwrap();
    assert_eq!(
        runtime::execute(&bytes, &"f".repeat(64), &mut meter()),
        Err("E_PROTOCOL_INVALID")
    );
}
#[test]
fn output_without_required_real_access_or_loop_is_not_a_pass() {
    for i in [0, 2] {
        let q = &registry()["questions"][i];
        let expression = if i == 0 { "x" } else { "x*(x-1)/2" };
        let source = format!(
            "#include <iostream>\nint main(){{int x;std::cin>>x;std::cout<<{expression}<<\"\\n\";return 0;}}"
        );
        let result = run(&request(q, &source, 0));
        let checks = result["bugJudgement"]["checks"].as_array().unwrap();
        assert!(checks[..3].iter().all(|c| c["met"] == true));
        assert_eq!(checks[3]["met"], false);
        assert_eq!(result["bugJudgement"]["status"], "unmet");
    }
}
#[test]
fn deadline_is_not_a_budget_prefix_or_success() {
    let q = &registry()["questions"][2];
    let req = request(q, q["brokenSource"].as_str().unwrap(), 0);
    let bytes = codec::encode(&req, &mut meter(), 65536).unwrap();
    let mut m = Meter::new();
    m.set_clock(0, Box::new(|| 1));
    assert_eq!(
        runtime::execute_bug(&bytes, &"f".repeat(64), &mut m),
        Err("E_DEADLINE")
    );
}
