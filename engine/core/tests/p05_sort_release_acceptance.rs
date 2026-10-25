//! P0.5-05's reviewed sorting patch is exercised from its real release source.
//! Preparation, submitted-instance verification and execution all use Rust;
//! the test oracle's sorting never supplies product output or a product trace.

use std::collections::{BTreeMap, BTreeSet};

use c_viz_core::{
    budget::{Limits, Meter},
    codec,
    diagnostic::DiagnosticCode,
    exec, input,
    source::ByteRange,
    trace,
};
use serde_json::{Value, json};

const SORT_CASES: [&str; 2] = ["case.c.bubble-sort", "case.c.selection-sort"];

fn meter() -> Meter {
    let mut meter = Meter::new();
    // Match the existing deterministic core tests: retain the production
    // 1000-ms deadline and all default resource limits, without a wall-clock race.
    meter.set_clock(1000, Box::new(|| 0));
    meter
}

fn catalogs() -> Vec<Value> {
    let source: Value =
        serde_json::from_str(include_str!("../../../content/c/p0/case-source-1.0.1.json")).unwrap();
    source["catalogs"].as_array().unwrap().clone()
}

fn catalog(id: &str) -> Value {
    catalogs()
        .into_iter()
        .find(|catalog| catalog["subject"]["id"] == id)
        .unwrap()
}

fn prepare(catalog: &Value, values: &Value) -> Value {
    let bytes = codec::encode(values, &mut meter(), Limits::default().request_bytes).unwrap();
    let result = exec::prepare_input_bytes(catalog, &bytes, &mut meter()).unwrap();
    serde_json::from_slice::<Value>(&result).unwrap()["source"].clone()
}

fn binding_map(source: &Value) -> Vec<input::BindingMapEntry> {
    source["bindingMap"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| input::BindingMapEntry {
            binding_key: entry["bindingKey"].as_str().unwrap().to_owned(),
            byte_range: ByteRange {
                start: entry["byteRange"]["start"].as_u64().unwrap() as usize,
                end: entry["byteRange"]["end"].as_u64().unwrap() as usize,
            },
        })
        .collect()
}

fn verify(catalog: &Value, values: &Value, source: &Value) {
    input::verify_instance_metered(
        &catalog["program"],
        &catalog["inputSpec"],
        values,
        source["text"].as_str().unwrap(),
        &binding_map(source),
        &mut meter(),
    )
    .unwrap();
}

fn request(catalog: &Value, values: &Value, source: &Value) -> Value {
    json!({
        "kind":"execute", "protocolVersion":"1.0.0", "traceVersion":"1.0.0",
        "diagnosticVersion":"1.0.0", "judgeVersion":"1.0.0", "encodingVersion":"1.0.0",
        "identity":{"contextId":"p05-sort","contextRevision":1,"submissionId":"submission-1","runId":"run-1","sourceRevision":1,"testCaseKey":null},
        "mode":"case", "packageRef":catalog["packageRef"],
        "languageRef":catalog["program"]["languageRef"], "subsetRef":catalog["program"]["subsetRef"],
        "programRef":catalog["subject"]["programRef"],
        "subjectRef":{"id":catalog["subject"]["id"],"version":catalog["subject"]["version"]},
        "learningRevision":catalog["subject"]["learningRevision"],
        "engineRef":{"id":"engine.c.p0","version":"1.0.0","buildId":"verified-build"},
        "source":source, "input":{"specRef":catalog["program"]["inputRef"],"values":values,"random":null},
        "judge":null,"budgetRef":{"id":"budget.p0","version":"1.0.0"},"remainingMs":1000
    })
}

fn execute(catalog: &Value, values: &Value, source: &Value) -> String {
    verify(catalog, values, source);
    let request = request(catalog, values, source);
    let limits = Limits::default();
    let request_bytes = codec::encode(&request, &mut meter(), limits.request_bytes).unwrap();
    let result =
        exec::execute_request(&request_bytes, catalog, "verified-build", &mut meter()).unwrap();
    assert!(result.len() <= limits.result_bytes);
    let result: Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(result["terminal"]["status"], "completed", "{result}");
    assert_eq!(result["terminal"]["exitCode"], 0);
    let trace: trace::Trace = serde_json::from_value(result["trace"].clone()).unwrap();
    assert!(trace.steps.len() <= limits.steps);
    let state = trace::restore(&trace, trace.steps.len()).unwrap();
    state["output"].as_str().unwrap().to_owned()
}

fn multiset(values: &[i32]) -> BTreeMap<i32, usize> {
    let mut counts = BTreeMap::new();
    for value in values {
        *counts.entry(*value).or_insert(0) += 1;
    }
    counts
}

fn assert_sorted_output(stdout: &str, values: &[i32]) {
    let actual: Vec<i32> = stdout
        .split_whitespace()
        .map(|value| value.parse().unwrap())
        .collect();
    assert_eq!(actual.len(), values.len());
    assert!(actual.windows(2).all(|pair| pair[0] <= pair[1]));
    assert_eq!(multiset(&actual), multiset(values));
    let mut expected = values.to_vec();
    expected.sort();
    assert_eq!(
        stdout,
        format!(
            "{}\n",
            expected
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join(" ")
        )
    );
}

#[test]
fn seven_real_catalogs_only_upgrade_the_two_reviewed_sort_programs() {
    let catalogs = catalogs();
    assert_eq!(catalogs.len(), 7);
    let ids: BTreeSet<_> = catalogs
        .iter()
        .map(|catalog| catalog["subject"]["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 7);
    for catalog in catalogs {
        let is_sort = SORT_CASES.contains(&catalog["subject"]["id"].as_str().unwrap());
        assert_eq!(
            catalog["packageRef"],
            json!({"id":"content.c.p0","version":"1.0.2"})
        );
        assert_eq!(
            catalog["program"]["version"],
            if is_sort { "1.0.1" } else { "1.0.0" }
        );
        assert_eq!(
            catalog["subject"]["version"],
            if is_sort { "1.0.2" } else { "1.0.1" }
        );
        assert_eq!(catalog["subject"]["learningRevision"], 1);
        assert_eq!(catalog["inputSpec"]["version"], "1.0.0");
        assert_eq!(
            catalog["subject"]["programRef"],
            json!({"id":catalog["program"]["id"],"version":catalog["program"]["version"]})
        );
        if is_sort {
            assert_eq!(
                catalog["program"]["exampleInput"],
                json!({"values":[7,-3,0,5,-3,2,9]})
            );
        }
    }
}

#[test]
fn all_seven_released_defaults_prepare_verify_and_really_execute() {
    for (id, expected) in [
        ("case.c.assignment", "5\n"),
        ("case.c.branch", "0\n"),
        ("case.c.loops", "15\n15\n"),
        ("case.c.array-traversal", "4\n"),
        ("case.c.bubble-sort", "-3 -3 0 2 5 7 9\n"),
        ("case.c.selection-sort", "-3 -3 0 2 5 7 9\n"),
        ("case.c.binary-search-first", "1\n"),
    ] {
        let catalog = catalog(id);
        let unchanged = catalog.clone();
        let values = &catalog["program"]["exampleInput"];
        let source = prepare(&catalog, values);
        let default = exec::prepare_case(&catalog, &mut meter()).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&default).unwrap()["source"],
            source
        );
        assert_eq!(execute(&catalog, values, &source), expected, "{id}");
        assert_eq!(catalog, unchanged);
        if SORT_CASES.contains(&id) {
            let input: Vec<i32> = serde_json::from_value(values["values"].clone()).unwrap();
            assert_eq!(input.len(), 7);
            assert!(source["text"].as_str().unwrap().contains("int n = 7;"));
            assert!(source["text"].as_str().unwrap().contains("int values[7]"));
            assert_sorted_output(expected, &input);
        }
    }
}

#[test]
fn both_sort_patches_execute_empty_singleton_fifteen_and_thirty_item_instances() {
    let thirty = (-15..15)
        .rev()
        .map(|value| match value {
            -15 => -999,
            14 => 999,
            value => value,
        })
        .collect::<Vec<i32>>();
    for id in SORT_CASES {
        let catalog = catalog(id);
        for values in [
            vec![],
            vec![-999],
            vec![999, -999, 0, 5, -3, 2, 5, 0, -3, 9, 8, 7, 6, 4, 1],
            thirty.clone(),
        ] {
            let input = json!({"values":values});
            let source = prepare(&catalog, &input);
            let text = source["text"].as_str().unwrap();
            assert!(text.contains(&format!("int n = {};", values.len())));
            if values.is_empty() {
                assert!(text.contains("int values[1] = {0};"));
            } else {
                assert!(text.contains(&format!("int values[{}]", values.len())));
            }
            assert_sorted_output(&execute(&catalog, &input, &source), &values);
        }
    }
}

#[test]
fn frozen_sort_programs_at_one_zero_zero_remain_accepted() {
    let previous: Value =
        serde_json::from_str(include_str!("../../../content/c/p0/case-view-1.0.0.json")).unwrap();
    for id in SORT_CASES {
        let catalog = previous["catalogs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|catalog| catalog["subject"]["id"] == id)
            .unwrap();
        assert_eq!(catalog["program"]["version"], "1.0.0");
        let values = &catalog["program"]["exampleInput"];
        let source = prepare(catalog, values);
        let input: Vec<i32> = serde_json::from_value(values["values"].clone()).unwrap();
        assert_sorted_output(&execute(catalog, values, &source), &input);
    }
}

fn assert_configuration_rejected(catalog: &Value, values: &Value, source: &Value) {
    assert_eq!(
        exec::prepare_input(catalog, values, &mut meter())
            .unwrap_err()
            .0,
        "E_CONTENT_MISMATCH"
    );
    assert_eq!(
        input::verify_instance_metered(
            &catalog["program"],
            &catalog["inputSpec"],
            values,
            source["text"].as_str().unwrap(),
            &binding_map(source),
            &mut meter(),
        )
        .unwrap_err()
        .code,
        DiagnosticCode::ContentMismatch
    );
}

#[test]
fn the_sort_patch_allowlist_rejects_future_unknown_and_other_program_patches() {
    for catalog in catalogs() {
        let values = &catalog["program"]["exampleInput"];
        let source = prepare(&catalog, values);
        let is_sort = SORT_CASES.contains(&catalog["subject"]["id"].as_str().unwrap());
        for version in if is_sort {
            vec!["1.0.2", "1.1.0", "2.0.0"]
        } else {
            vec!["1.0.1", "1.0.2", "1.1.0", "2.0.0"]
        } {
            let mut altered = catalog.clone();
            altered["program"]["version"] = json!(version);
            assert_configuration_rejected(&altered, values, &source);
        }
        if is_sort {
            let mut altered = catalog.clone();
            altered["program"]["id"] = json!("program.c.unknown-sort");
            assert_configuration_rejected(&altered, values, &source);
        }
    }
}

#[test]
fn sorting_patches_keep_exact_input_language_and_subset_references() {
    for id in SORT_CASES {
        let catalog = catalog(id);
        let values = &catalog["program"]["exampleInput"];
        let source = prepare(&catalog, values);
        for (pointer, value) in [
            ("/program/inputRef/id", json!("input.c.unknown")),
            ("/program/inputRef/version", json!("1.0.1")),
            ("/inputSpec/version", json!("1.0.1")),
            ("/program/languageRef/version", json!("1.0.1")),
            ("/program/subsetRef/version", json!("1.0.1")),
        ] {
            let mut altered = catalog.clone();
            *altered.pointer_mut(pointer).unwrap() = value;
            assert_configuration_rejected(&altered, values, &source);
        }
        let mut altered = catalog.clone();
        altered["program"]["inputRef"]["version"] = json!("1.0.1");
        altered["inputSpec"]["version"] = json!("1.0.1");
        assert_configuration_rejected(&altered, values, &source);
    }
}

#[test]
fn new_sort_instances_reject_stale_values_lengths_and_binding_ranges() {
    for id in SORT_CASES {
        let catalog = catalog(id);
        let values = &catalog["program"]["exampleInput"];
        let source = prepare(&catalog, values);
        let text = source["text"].as_str().unwrap();
        let maps = binding_map(&source);
        let mut stale_maps = maps.clone();
        stale_maps[0].byte_range.end += 1;
        let altered_length = text.replace("int n = 7;", "int n = 6;");
        assert_ne!(altered_length, text);
        for (values, text, maps) in [
            (json!({"values":[8,-3,0,5,-3,2,9]}), text, &maps),
            (values.clone(), altered_length.as_str(), &maps),
            (values.clone(), text, &stale_maps),
        ] {
            assert_eq!(
                input::verify_instance_metered(
                    &catalog["program"],
                    &catalog["inputSpec"],
                    &values,
                    text,
                    maps,
                    &mut meter(),
                )
                .unwrap_err()
                .code,
                DiagnosticCode::BindingInvalid
            );
        }
    }
}
