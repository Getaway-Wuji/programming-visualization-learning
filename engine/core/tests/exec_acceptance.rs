//! Real EXEC-01 request/response integration over the frozen public examples.
//! No fixtures are accepted as execution results. Task 09.3 adds real finite
//! teaching checks while preserving the earlier execution/trace assertions.

use c_viz_core::{
    budget::{Limits, Meter},
    codec,
    exec::{self, ExecFailure},
    input, trace,
};
use serde_json::{Value, json};
use std::{cell::Cell, rc::Rc};

fn meter() -> Meter {
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    meter
}
fn package() -> Value {
    serde_json::from_str(include_str!("../../../项目文档/契约/02.1-内容样例.json")).unwrap()
}
fn catalog(id: &str) -> Value {
    let package = package();
    let subject = package[if id.starts_with("case.") {
        "cases"
    } else {
        "exercises"
    }]
    .as_array()
    .unwrap()
    .iter()
    .find(|value| value["id"] == id)
    .unwrap();
    let program = package["programs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == subject["programRef"]["id"])
        .unwrap();
    let spec = package["inputSpecs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == program["inputRef"]["id"])
        .unwrap();
    let mut catalog = json!({"packageRef":{"id":package["packageId"],"version":package["packageVersion"]},"subject":subject,"program":program,"inputSpec":spec});
    if !id.starts_with("case.") {
        catalog["judgeProfile"] = package["judgeProfiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|value| value["id"] == subject["judgeRef"]["id"])
            .unwrap()
            .clone();
    }
    catalog
}
fn source(catalog: &Value, values: &Value) -> Value {
    if catalog["subject"]["id"]
        .as_str()
        .unwrap()
        .starts_with("exercise.")
    {
        let bytes = exec::prepare_input(catalog, values, &mut meter()).unwrap();
        return serde_json::from_slice::<Value>(&bytes).unwrap()["source"].clone();
    }
    let prepared = input::prepare(&catalog["program"], &catalog["inputSpec"], values).unwrap();
    let bindings: Vec<_> = prepared
        .bindings()
        .iter()
        .map(|binding| json!({"bindingKey":binding.binding_key,"byteRange":binding.byte_range}))
        .collect();
    json!({"text":prepared.source(),"blockMap":[],"bindingMap":bindings})
}
fn request(catalog: &Value) -> Value {
    let values = &catalog["program"]["exampleInput"];
    json!({
        "kind":"execute","protocolVersion":"1.0.0","traceVersion":"1.0.0","diagnosticVersion":"1.0.0","judgeVersion":"1.0.0","encodingVersion":"1.0.0",
        "identity":{"contextId":"context-1","contextRevision":1,"submissionId":"submission-1","runId":"run-1","sourceRevision":1,"testCaseKey":null},
        "mode":"case","packageRef":catalog["packageRef"],"languageRef":{"id":"lang.c","version":"1.0.0"},"subsetRef":{"id":"subset.c.p0","version":"1.0.0"},
        "programRef":catalog["subject"]["programRef"],"subjectRef":{"id":catalog["subject"]["id"],"version":catalog["subject"]["version"]},"learningRevision":catalog["subject"]["learningRevision"],
        "engineRef":{"id":"engine.c.p0","version":"1.0.0","buildId":"verified-build"},"source":source(catalog,values),
        "input":{"specRef":catalog["program"]["inputRef"],"values":values,"random":null},"judge":null,"budgetRef":{"id":"budget.p0","version":"1.0.0"},"remainingMs":1000
    })
}
fn bytes(value: &Value) -> Vec<u8> {
    codec::encode(value, &mut meter(), 65536).unwrap()
}
fn execute(request: &Value, catalog: &Value, meter: &mut Meter) -> Result<Value, ExecFailure> {
    let result = exec::execute_request(&bytes(request), catalog, "verified-build", meter)?;
    let decoded: Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(
        codec::encode(&decoded, &mut self::meter(), 16777216).unwrap(),
        result
    );
    assert_eq!(
        decoded["stats"]["fuelUsed"].as_u64(),
        Some(meter.used() as u64)
    );
    Ok(decoded)
}
fn terminal(result: &Value, status: &str, code: &str) {
    assert_eq!(result["terminal"]["status"], status, "{result}");
    if !code.is_empty() {
        assert_eq!(result["terminal"]["diagnostics"][0]["code"], code);
    }
}
fn validate_result_trace(result: &Value, request: &Value) {
    let checked =
        c_viz_core::semantic::analyze(request["source"]["text"].as_str().unwrap()).unwrap();
    let nodes = checked.parsed.program.node_map();
    assert_eq!(serde_json::to_value(&nodes).unwrap(), result["nodeMap"]);
    let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
    trace::validate_trace(&trace, &nodes).unwrap();
}

#[test]
fn all_seven_cases_use_real_traces_complete_identity_bindings_and_canonical_wire() {
    for subject in package()["cases"].as_array().unwrap() {
        let catalog = catalog(subject["id"].as_str().unwrap());
        let request = request(&catalog);
        let result = execute(&request, &catalog, &mut meter()).unwrap();
        terminal(&result, "completed", "");
        assert_eq!(result["producer"], "rust");
        assert_eq!(result["identity"], request["identity"]);
        for key in [
            "packageRef",
            "languageRef",
            "subsetRef",
            "programRef",
            "subjectRef",
            "learningRevision",
            "budgetRef",
            "engineRef",
        ] {
            assert_eq!(result[key], request[key]);
        }
        assert_eq!(result["trace"]["completeness"], "complete");
        assert_eq!(
            result["trace"]["steps"].as_array().unwrap().last().unwrap()["kind"],
            "program.return"
        );
        assert!(result["stats"]["rustMicros"].is_u64());
        assert!(result["judgeResult"].is_null());
        assert_eq!(
            result["resolvedBindings"].as_array().unwrap().len(),
            request["source"]["bindingMap"].as_array().unwrap().len()
        );
        validate_result_trace(&result, &request);
    }
}

#[test]
fn preparatory_source_is_exactly_the_later_verified_executed_source() {
    let catalog = catalog("case.c.bubble-sort");
    let prepared = exec::prepare_case(&catalog, &mut meter()).unwrap();
    let prepared: Value = serde_json::from_slice(&prepared).unwrap();
    let mut request = request(&catalog);
    assert_eq!(prepared["source"], request["source"]);
    request["source"] = prepared["source"].clone();
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "completed",
        "",
    );
}

#[test]
fn output_depends_on_actual_bound_input_and_not_a_prebuilt_fixture() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    request["input"]["values"] = json!({"x":-37});
    request["source"] = source(&catalog, &request["input"]["values"]);
    let result = execute(&request, &catalog, &mut meter()).unwrap();
    let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
    let last = trace::restore(&trace, trace.steps.len()).unwrap();
    assert_eq!(last["output"], "-35\n");
}

#[test]
fn all_twenty_four_exercise_tests_have_real_execution_and_teaching_success() {
    let mut count = 0;
    for subject in package()["exercises"].as_array().unwrap() {
        let catalog = catalog(subject["id"].as_str().unwrap());
        for test in subject["tests"].as_array().unwrap() {
            let mut request = request(&catalog);
            request["mode"] = json!("exercise-test");
            request["identity"]["testCaseKey"] = test["caseKey"].clone();
            request["input"]["values"] = test["input"].clone();
            request["source"] = source(&catalog, &test["input"]);
            request["judge"] = json!({"profileRef":subject["judgeRef"],"rule":catalog["judgeProfile"]["rule"],"expectedStdout":test["expectedStdout"],"expectedExitCode":test["expectedExitCode"]});
            if let Some(array) = test.get("expectedArray") {
                request["judge"]["expectedArray"] = array.clone();
            }
            let result = execute(&request, &catalog, &mut meter()).unwrap();
            terminal(&result, "completed", "");
            assert_eq!(
                result["judgeResult"]["status"], "met",
                "{} {}: {}",
                subject["id"], test["caseKey"], result["judgeResult"]
            );
            assert!(
                result["judgeResult"]["checks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|check| check["status"] == "met")
            );
            let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
            assert_eq!(
                trace::restore(&trace, trace.steps.len()).unwrap()["output"],
                test["expectedStdout"]
            );
            count += 1;
        }
    }
    assert_eq!(count, 24);
}

#[test]
fn caller_cannot_change_content_references_or_learning_revision() {
    let catalog = catalog("case.c.assignment");
    for key in ["packageRef", "programRef", "subjectRef"] {
        let mut request = request(&catalog);
        request[key]["version"] = json!("2.0.0");
        terminal(
            &execute(&request, &catalog, &mut meter()).unwrap(),
            "rejected",
            "E_CONTENT_MISMATCH",
        );
    }
    let mut request = request(&catalog);
    request["learningRevision"] = json!(2);
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_CONTENT_MISMATCH",
    );
}

#[test]
fn request_cannot_self_supply_a_program_or_trusted_catalog() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    request["program"] = catalog["program"].clone();
    assert_eq!(
        execute(&request, &catalog, &mut meter()),
        Err(ExecFailure("E_PROTOCOL_INVALID"))
    );
}

#[test]
fn unknown_missing_and_mis_typed_identity_fields_are_rejected() {
    let catalog = catalog("case.c.assignment");
    for key in [
        "contextId",
        "contextRevision",
        "submissionId",
        "runId",
        "sourceRevision",
        "testCaseKey",
    ] {
        let mut request = request(&catalog);
        request["identity"].as_object_mut().unwrap().remove(key);
        assert!(execute(&request, &catalog, &mut meter()).is_err(), "{key}");
    }
    for value in [json!(0), json!(-1), json!("1"), json!(null)] {
        let mut request = request(&catalog);
        request["identity"]["sourceRevision"] = value;
        assert!(execute(&request, &catalog, &mut meter()).is_err());
    }
    let mut request = request(&catalog);
    request["identity"]["runId"] = json!("private text or code");
    assert!(execute(&request, &catalog, &mut meter()).is_err());
}

#[test]
fn current_build_and_all_five_versions_are_verified() {
    let catalog = catalog("case.c.assignment");
    for key in [
        "protocolVersion",
        "traceVersion",
        "diagnosticVersion",
        "judgeVersion",
        "encodingVersion",
    ] {
        let mut request = request(&catalog);
        request[key] = json!("2.0.0");
        assert_eq!(
            execute(&request, &catalog, &mut meter()),
            Err(ExecFailure("E_PROTOCOL_VERSION"))
        );
    }
    let mut request = request(&catalog);
    request["engineRef"]["buildId"] = json!("old-build");
    assert!(execute(&request, &catalog, &mut meter()).is_err());
    request["engineRef"]["buildId"] = json!("verified-build");
    request["engineRef"]["id"] = json!("engine.untrusted");
    assert!(execute(&request, &catalog, &mut meter()).is_err());
}

#[test]
fn probe_mode_never_opens_the_product_boundary_to_arbitrary_code() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    request["mode"] = json!("contract-probe");
    assert!(execute(&request, &catalog, &mut meter()).is_err());
}

#[test]
fn strict_wire_rejects_duplicates_pretty_json_invalid_utf8_and_oversize_before_execution() {
    let catalog = catalog("case.c.assignment");
    for bytes in [
        b"{\"kind\":\"execute\",\"kind\":\"execute\"}".as_slice(),
        b" {\"kind\":\"execute\"}".as_slice(),
        b"\xff".as_slice(),
        &[b'x'; 65537],
    ] {
        assert!(exec::execute_request(bytes, &catalog, "verified-build", &mut meter()).is_err());
    }
    let oversized = vec![255; 65537];
    let mut run_meter = meter();
    assert_eq!(
        exec::execute_request(&oversized, &catalog, "verified-build", &mut run_meter),
        Err(ExecFailure("E_REQUEST_LIMIT"))
    );
    assert_eq!(run_meter.used(), 0);
}

#[test]
fn malformed_mapping_rejects_duplicates_partial_utf8_and_out_of_source_ranges() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    let duplicate = request["source"]["bindingMap"][0].clone();
    request["source"]["bindingMap"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(execute(&request, &catalog, &mut meter()).is_err());
    for range in [
        json!({"start":0,"end":32768}),
        json!({"start":2,"end":1}),
        json!({"start":0,"end":0}),
    ] {
        let mut request = self::request(&catalog);
        request["source"]["blockMap"] = json!([{"blockId":"block-a","byteRange":range}]);
        assert!(execute(&request, &catalog, &mut meter()).is_err());
    }
}

#[test]
fn missing_binding_wrong_initial_value_and_out_of_domain_input_are_rejected_by_rust() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    request["source"]["bindingMap"] = json!([]);
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_BINDING_INVALID",
    );
    let mut request = self::request(&catalog);
    request["input"]["values"] = json!({"x":-37});
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_BINDING_INVALID",
    );
    request["input"]["values"] = json!({"x":1000});
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_INPUT_INVALID",
    );
}

#[test]
fn binary_search_rechecks_order_before_actual_execution() {
    let catalog = catalog("case.c.binary-search-first");
    let mut request = request(&catalog);
    request["input"]["values"]["values"] = json!([2, 1]);
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_INPUT_ORDER",
    );
}

#[test]
fn real_program_error_has_valid_reversible_prefix_and_never_a_success_exit_code() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    let text = request["source"]["text"]
        .as_str()
        .unwrap()
        .replace("x = x + 2;", "x = x / 0;");
    request["source"]["text"] = json!(text);
    let result = execute(&request, &catalog, &mut meter()).unwrap();
    terminal(&result, "program-error", "E_DIV_ZERO");
    assert!(result["terminal"]["exitCode"].is_null());
    let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
    assert_eq!(trace.completeness, "prefix");
    validate_result_trace(&result, &request);
}

#[test]
fn actual_syntax_failure_is_not_reported_as_completed_or_infrastructure_failure() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    request["source"]["text"] = json!(
        request["source"]["text"]
            .as_str()
            .unwrap()
            .replace("return 0;", "return (;")
    );
    let result = execute(&request, &catalog, &mut meter()).unwrap();
    terminal(&result, "program-error", "E_PARSE_INVALID");
    assert!(result["trace"].is_null());
}

#[test]
fn request_remaining_time_only_shortens_the_original_meter_deadline() {
    let catalog = catalog("case.c.assignment");
    let request = request(&catalog);
    let now = Rc::new(Cell::new(0_u64));
    let clock = now.clone();
    let mut run_meter = meter();
    run_meter.set_clock(7, Box::new(move || clock.get()));
    now.set(7);
    assert_eq!(
        execute(&request, &catalog, &mut run_meter),
        Err(ExecFailure("E_DEADLINE"))
    );
}

#[test]
fn already_cancelled_request_never_executes_and_fresh_meter_recovers() {
    let catalog = catalog("case.c.assignment");
    let request = request(&catalog);
    let mut run_meter = meter();
    run_meter.set_cancel(Box::new(|| true));
    assert_eq!(
        execute(&request, &catalog, &mut run_meter),
        Err(ExecFailure("E_CANCELLED"))
    );
    assert_eq!(
        exec::prepare_case(&catalog, &mut run_meter),
        Err(ExecFailure("E_CANCELLED"))
    );
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "completed",
        "",
    );
}

#[test]
fn bounded_fuel_failure_keeps_only_a_real_prefix_with_matching_final_statistics() {
    let catalog = catalog("case.c.assignment");
    let mut request = request(&catalog);
    request["source"]["text"] = json!(
        request["source"]["text"]
            .as_str()
            .unwrap()
            .replace("return 0;", "while (1) {} return 0;")
    );
    let mut run_meter = Meter::with_limits(Limits {
        fuel: 50000,
        ..Default::default()
    });
    run_meter.set_clock(1000, Box::new(|| 0));
    let result = execute(&request, &catalog, &mut run_meter).unwrap();
    terminal(&result, "resource-limit", "E_FUEL_LIMIT");
    let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
    validate_result_trace(&result, &request);
    assert!(trace.steps.len() > 2);
}

#[test]
fn elapsed_rust_time_is_measured_by_the_injected_monotonic_clock() {
    let catalog = catalog("case.c.assignment");
    let request = request(&catalog);
    let tick = Rc::new(Cell::new(0_u64));
    let clock = tick.clone();
    let mut run_meter = meter();
    run_meter.set_clock(
        1000,
        Box::new(move || {
            let n = clock.get();
            clock.set(n + 1);
            n
        }),
    );
    let result = execute(&request, &catalog, &mut run_meter).unwrap();
    assert!(result["stats"]["rustMicros"].as_u64().unwrap() >= 1000);
}

#[test]
fn static_catalog_has_separate_size_and_structure_checks() {
    let catalog = catalog("case.c.assignment");
    assert_eq!(
        exec::parse_catalog(
            &serde_json::to_string_pretty(&catalog).unwrap(),
            &mut meter()
        )
        .unwrap(),
        catalog
    );
    assert!(exec::parse_catalog("{}", &mut meter()).is_err());
    assert!(exec::parse_catalog(&" ".repeat(65537), &mut meter()).is_err());
}

#[test]
fn tampering_public_expected_answer_or_rule_cannot_fake_a_pass() {
    let catalog = catalog("exercise.c.echo");
    let test = &catalog["subject"]["tests"][0];
    let mut request = request(&catalog);
    request["mode"] = json!("exercise-test");
    request["identity"]["testCaseKey"] = test["caseKey"].clone();
    request["input"]["values"] = test["input"].clone();
    request["source"] = source(&catalog, &test["input"]);
    request["judge"] = json!({"profileRef":catalog["subject"]["judgeRef"],"rule":catalog["judgeProfile"]["rule"],"expectedStdout":"fake answer","expectedExitCode":0});
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_CONTENT_MISMATCH",
    );
    request["judge"]["expectedStdout"] = test["expectedStdout"].clone();
    request["judge"]["rule"] = json!("multiply-add-output");
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "rejected",
        "E_CONTENT_MISMATCH",
    );
}

#[test]
fn formal_envelope_and_input_verification_preserve_the_frozen_thirty_item_bubble_budget() {
    let catalog = catalog("case.c.bubble-sort");
    let mut request = request(&catalog);
    request["input"]["values"] = json!({"values":(1..=30).rev().collect::<Vec<i32>>()});
    request["source"] = source(&catalog, &request["input"]["values"]);
    let mut run_meter = meter();
    let result = execute(&request, &catalog, &mut run_meter).unwrap();
    terminal(&result, "completed", "");
    assert!(run_meter.used() < 1_000_000);
    let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
    let expected = format!(
        "{}\n",
        (1..=30)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(" ")
    );
    assert_eq!(
        trace::restore(&trace, trace.steps.len()).unwrap()["output"],
        expected
    );
}

#[test]
fn low_fuel_boundaries_never_emit_unresolved_binding_ids_or_inconsistent_wire_statistics() {
    let catalog = catalog("case.c.assignment");
    let request = request(&catalog);
    let mut count = 0;
    for fuel in (5000..18000).step_by(113) {
        let mut run_meter = Meter::with_limits(Limits {
            fuel,
            ..Default::default()
        });
        run_meter.set_clock(1000, Box::new(|| 0));
        if let Ok(result) = execute(&request, &catalog, &mut run_meter) {
            let nodes = result["nodeMap"].as_array().unwrap();
            for binding in result["resolvedBindings"].as_array().unwrap() {
                assert!(
                    nodes
                        .iter()
                        .any(|node| node["nodeId"] == binding["declarationNodeId"])
                );
            }
            assert_eq!(result["stats"]["fuelUsed"], json!(run_meter.used()));
            count += 1;
        }
    }
    assert!(count > 0);
}

#[test]
fn real_crlf_source_accepts_whole_boundaries_and_rejects_both_crlf_midpoint_endpoints() {
    let mut catalog = catalog("case.c.assignment");
    let text = format!(
        "// 中文😀\r\n{}",
        catalog["program"]["sourceExample"]
            .as_str()
            .unwrap()
            .replace('\n', "\r\n")
    );
    catalog["program"]["sourceExample"] = json!(text);
    let mut request = request(&catalog);
    let text = request["source"]["text"].as_str().unwrap().to_owned();
    let cr = text.find("\r\n").unwrap();
    request["source"]["blockMap"] =
        json!([{"blockId":"main-block","byteRange":{"start":0,"end":text.len()}}]);
    terminal(
        &execute(&request, &catalog, &mut meter()).unwrap(),
        "completed",
        "",
    );
    for byte_range in [
        json!({"start":0,"end":cr+1}),
        json!({"start":cr+1,"end":text.len()}),
    ] {
        let mut invalid = request.clone();
        invalid["source"]["blockMap"][0]["byteRange"] = byte_range;
        assert_eq!(
            execute(&invalid, &catalog, &mut meter()),
            Err(ExecFailure("E_PROTOCOL_INVALID"))
        );
    }
    let declaration_start = request["source"]["bindingMap"][0]["byteRange"]["start"]
        .as_u64()
        .unwrap() as usize;
    let declaration_cr = declaration_start + text[declaration_start..].find("\r\n").unwrap();
    let mut invalid = request.clone();
    invalid["source"]["bindingMap"][0]["byteRange"]["end"] = json!(declaration_cr + 1);
    assert_eq!(
        execute(&invalid, &catalog, &mut meter()),
        Err(ExecFailure("E_PROTOCOL_INVALID"))
    );
    let unicode_at = text.find('中').unwrap();
    for byte_range in [
        json!({"start":0,"end":unicode_at+1}),
        json!({"start":unicode_at+1,"end":text.len()}),
    ] {
        let mut invalid = request.clone();
        invalid["source"]["blockMap"][0]["byteRange"] = byte_range;
        assert_eq!(
            execute(&invalid, &catalog, &mut meter()),
            Err(ExecFailure("E_PROTOCOL_INVALID"))
        );
    }
}
