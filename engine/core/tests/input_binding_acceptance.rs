//! Real input instantiation and execution of public examples. These assertions
//! cover stdout/exit and binding identity, not judge targets or STEP traces.

use c_viz_core::ast::NodeData;
use c_viz_core::diagnostic::{DiagnosticCode, Stage};
use c_viz_core::input::{BindingMapEntry, PreparedProgram, prepare, verify_instance};
use c_viz_core::runtime::{ExecutionOutcome, execute};
use c_viz_core::semantic::analyze;
use c_viz_core::source::ByteRange;
use serde_json::{Value, json};

fn content() -> Value {
    serde_json::from_str(include_str!("../../../shared/contracts/02.1-内容样例.json")).unwrap()
}

fn entities(id: &str) -> (Value, Value) {
    let package = content();
    let program = package["programs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .unwrap()
        .clone();
    let spec = package["inputSpecs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == program["inputRef"]["id"])
        .unwrap()
        .clone();
    (program, spec)
}

fn map(prepared: &PreparedProgram) -> Vec<BindingMapEntry> {
    prepared
        .bindings()
        .iter()
        .map(|binding| BindingMapEntry {
            binding_key: binding.binding_key.clone(),
            byte_range: binding.byte_range,
        })
        .collect()
}

fn map_source(program: &Value, source: &str) -> Vec<BindingMapEntry> {
    let checked = analyze(source).unwrap();
    program["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|binding| {
            let declaration = checked
                .declarations
                .iter()
                .find(|declaration| binding["targetName"] == declaration.name)?;
            Some(BindingMapEntry {
                binding_key: binding["bindingKey"].as_str().unwrap().to_owned(),
                byte_range: checked.parsed.program.nodes[declaration.node_id].byte_range,
            })
        })
        .collect()
}

fn completed(prepared: &PreparedProgram, stdout: &str, exit_code: i32) {
    // Independently parse exactly the displayed string to prove the returned
    // checked object describes that complete instance, not hidden mutations.
    assert_eq!(&analyze(prepared.source()).unwrap(), prepared.checked());
    let execution = execute(prepared.checked());
    assert_eq!(execution.outcome, ExecutionOutcome::Completed { exit_code });
    assert_eq!(execution.state.output, stdout);
    assert!(execution.state.scopes.is_empty());
    assert!(execution.state.variables.is_empty());
    assert!(execution.state.arrays.is_empty());
}

#[test]
fn twenty_four_frozen_course_test_inputs_execute_their_displayed_instances() {
    let package = content();
    let mut count = 0;
    for exercise in package["exercises"].as_array().unwrap() {
        let (program, spec) = entities(exercise["programRef"]["id"].as_str().unwrap());
        for test in exercise["tests"].as_array().unwrap() {
            let prepared = prepare(&program, &spec, &test["input"]).unwrap();
            assert_eq!(
                verify_instance(
                    &program,
                    &spec,
                    &test["input"],
                    prepared.source(),
                    &map(&prepared)
                )
                .unwrap(),
                *prepared.checked()
            );
            completed(
                &prepared,
                test["expectedStdout"].as_str().unwrap(),
                test["expectedExitCode"].as_i64().unwrap() as i32,
            );
            count += 1;
        }
    }
    assert_eq!(count, 24);
}

#[test]
fn all_ten_public_program_examples_really_execute() {
    let package = content();
    let expected = [
        "7\n", "17\n", "0\n", "15\n15\n", "1\n", "4\n", "5\n", "1 2 3\n", "1 2 3\n", "1\n",
    ];
    assert_eq!(
        package["programs"].as_array().unwrap().len(),
        expected.len()
    );
    for (program, expected) in package["programs"].as_array().unwrap().iter().zip(expected) {
        let (_, spec) = entities(program["id"].as_str().unwrap());
        completed(
            &prepare(program, &spec, &program["exampleInput"]).unwrap(),
            expected,
            0,
        );
    }
}

#[test]
fn changed_sort_inputs_cover_empty_singleton_duplicates_negatives_and_maximum_length() {
    for id in ["program.c.bubble-sort", "program.c.selection-sort"] {
        let (program, spec) = entities(id);
        for (input, expected) in [
            (json!({"values": []}), "\n".to_owned()),
            (json!({"values": [-999]}), "-999\n".to_owned()),
            (
                json!({"values": [9, -1, 9, 0, -999, 999]}),
                "-999 -1 0 9 9 999\n".to_owned(),
            ),
            (
                json!({"values": (0..30).rev().collect::<Vec<_>>()}),
                format!(
                    "{}\n",
                    (0..30).map(|n| n.to_string()).collect::<Vec<_>>().join(" ")
                ),
            ),
        ] {
            completed(&prepare(&program, &spec, &input).unwrap(), &expected, 0);
        }
    }
}

#[test]
fn changed_binary_inputs_preserve_first_match_missing_and_empty_semantics() {
    let (program, spec) = entities("program.c.binary-search-first");
    for (input, expected) in [
        (json!({"values": [], "target": 1}), "-1\n"),
        (json!({"values": [4], "target": 4}), "0\n"),
        (json!({"values": [4], "target": -1}), "-1\n"),
        (json!({"values": [-2, 0, 0, 0, 4], "target": 0}), "1\n"),
        (json!({"values": [-2, 0, 0, 4], "target": 4}), "3\n"),
        (json!({"values": vec![999; 30], "target": 999}), "0\n"),
    ] {
        completed(&prepare(&program, &spec, &input).unwrap(), expected, 0);
    }
}

#[test]
fn every_public_input_negative_is_rejected_before_execution() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../shared/contracts/02.4-语义与输入样例.json"
    ))
    .unwrap();
    let mut count = 0;
    for case in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["category"] == "input" && case["source"].is_null())
    {
        let (program, spec) = entities(case["programRef"]["id"].as_str().unwrap());
        let error = prepare(&program, &spec, &case["input"]).unwrap_err();
        assert_eq!(error.stage, Stage::Preflight);
        let error = serde_json::to_value(error).unwrap();
        assert!(
            case["expected"]["allowedCodes"]
                .as_array()
                .unwrap()
                .contains(&error["code"]),
            "{}: {error}",
            case["id"]
        );
        count += 1;
    }
    assert_eq!(count, 10);
}

#[test]
fn all_four_input_07_mapping_setups_are_rejected() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../shared/contracts/02.4-语义与输入样例.json"
    ))
    .unwrap();
    let mut count = 0;
    for case in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["origin"] == "INPUT-07")
    {
        let (program, spec) = entities(case["programRef"]["id"].as_str().unwrap());
        let source = case["source"].as_str().unwrap();
        let mut mapping = map_source(&program, source);
        if case["setup"] == "binding-duplicate" {
            mapping.push(mapping[0].clone());
        }
        assert_eq!(
            verify_instance(&program, &spec, &case["input"], source, &mapping)
                .unwrap_err()
                .code,
            DiagnosticCode::BindingInvalid,
            "{}",
            case["id"]
        );
        count += 1;
    }
    assert_eq!(count, 4);
}

#[test]
fn actual_input_requires_exact_fields_and_integer_json_types() {
    let (program, spec) = entities("program.c.echo");
    for input in [
        json!({}),
        json!({"x":7,"extra":0}),
        json!({"x":null}),
        json!({"x":true}),
        json!({"x":"7"}),
        json!({"x":7.0}),
        json!({"x":[]}),
        json!({"x":-1000}),
        json!({"x":1000}),
        json!({"x":9223372036854775808_u64}),
        json!([]),
    ] {
        assert_eq!(
            prepare(&program, &spec, &input).unwrap_err().code,
            DiagnosticCode::InputInvalid,
            "{input}"
        );
    }
    for input in [json!({"x":-999}), json!({"x":999})] {
        assert!(prepare(&program, &spec, &input).is_ok());
    }
}

#[test]
fn sequences_require_real_arrays_and_forbid_client_supplied_derived_n() {
    let (program, spec) = entities("program.c.array-sum");
    for input in [
        json!({"values":"1,2"}),
        json!({"values":null}),
        json!({"values":[null]}),
        json!({"values":[true]}),
        json!({"values":[1.0]}),
        json!({"values":["1"]}),
        json!({"values":[],"n":0}),
        json!({"values":vec![0;31]}),
    ] {
        assert_eq!(
            prepare(&program, &spec, &input).unwrap_err().code,
            DiagnosticCode::InputInvalid,
            "{input}"
        );
    }
}

#[test]
fn configuration_rejects_unknown_missing_wrong_typed_or_expanded_domains() {
    let (program, spec) = entities("program.c.array-sum");
    let changes: Vec<fn(&mut Value)> = vec![
        |s| {
            s["unknown"] = json!(0);
        },
        |s| {
            s.as_object_mut().unwrap().remove("relations");
        },
        |s| {
            s["fields"][0]["min"] = json!(-1000);
        },
        |s| {
            s["fields"][0]["max"] = json!(1000);
        },
        |s| {
            s["fields"][0]["min"] = json!(0.0);
        },
        |s| {
            s["fields"][0]["maxItems"] = json!(31);
        },
        |s| {
            s["fields"][0]["minItems"] = json!(-1);
        },
        |s| {
            s["fields"][0]["kind"] = json!("text");
        },
        |s| {
            let duplicate = s["fields"][0].clone();
            s["fields"].as_array_mut().unwrap().push(duplicate);
        },
        |s| {
            s["relations"][0]["field"] = json!("missing");
        },
        |s| {
            s["relations"][0]["target"] = json!("values");
        },
        |s| {
            s["relations"][0]["extra"] = json!(true);
        },
        |s| {
            let duplicate = s["relations"][0].clone();
            s["relations"].as_array_mut().unwrap().push(duplicate);
        },
    ];
    for change in changes {
        let mut altered = spec.clone();
        change(&mut altered);
        assert_eq!(
            prepare(&program, &altered, &json!({"values":[]}))
                .unwrap_err()
                .code,
            DiagnosticCode::ContentMismatch
        );
    }
}

#[test]
fn versions_language_subset_and_input_references_match_exactly() {
    let (program, spec) = entities("program.c.echo");
    for (pointer, value) in [
        ("/version", json!("1.0.1")),
        ("/inputRef/id", json!("input.c.other")),
        ("/inputRef/version", json!("1.0.1")),
        ("/languageRef/id", json!("lang.python")),
        ("/languageRef/version", json!("2.0.0")),
        ("/subsetRef/id", json!("subset.c.p1")),
        ("/subsetRef/version", json!("1.1.0")),
    ] {
        let mut altered = program.clone();
        *altered.pointer_mut(pointer).unwrap() = value;
        assert_eq!(
            prepare(&altered, &spec, &json!({"x":7})).unwrap_err().code,
            DiagnosticCode::ContentMismatch
        );
    }
    let mut altered = spec.clone();
    altered["version"] = json!("1.0.1");
    assert_eq!(
        prepare(&program, &altered, &json!({"x":7}))
            .unwrap_err()
            .code,
        DiagnosticCode::ContentMismatch
    );
}

#[test]
fn content_ids_follow_the_exact_frozen_ascii_grammar() {
    let (mut program, mut spec) = entities("program.c.echo");
    program["id"] = json!("program.1-valid");
    program["inputRef"]["id"] = json!("input.1-valid");
    spec["id"] = json!("input.1-valid");
    program["bindings"][0]["bindingKey"] = json!("param.1-valid");
    assert!(prepare(&program, &spec, &json!({"x":7})).is_ok());
    for id in [
        "program",
        "program.",
        "program..x",
        "program.X",
        "program.c--x",
        "a-b.x",
        "1.x",
        ".x",
        "program.中文",
    ] {
        program["id"] = json!(id);
        assert_eq!(
            prepare(&program, &spec, &json!({"x":7})).unwrap_err().code,
            DiagnosticCode::ContentMismatch,
            "{id}"
        );
    }
}

#[test]
fn binding_configuration_rejects_unknown_duplicate_or_uncovered_sources() {
    let (program, spec) = entities("program.c.array-sum");
    let changes: Vec<fn(&mut Value)> = vec![
        |p| {
            p["bindings"][0]["inputKey"] = json!("missing");
        },
        |p| {
            p["bindings"][0]["from"] = json!("field");
        },
        |p| {
            p["bindings"][0]["targetName"] = json!("count");
        },
        |p| {
            p["bindings"][1]["targetName"] = json!("n");
        },
        |p| {
            p["bindings"][1]["bindingKey"] = json!("param.n");
        },
        |p| {
            p["bindings"][1]["inputKey"] = json!("n");
        },
        |p| {
            p["bindings"][1]["emptyStorage"] = json!("zero-length");
        },
        |p| {
            p["bindings"][1]["extra"] = json!(true);
        },
        |p| {
            p["bindings"].as_array_mut().unwrap().pop();
        },
        |p| {
            let duplicate = p["bindings"][1].clone();
            p["bindings"].as_array_mut().unwrap().push(duplicate);
        },
    ];
    for change in changes {
        let mut altered = program.clone();
        change(&mut altered);
        assert_eq!(
            prepare(&altered, &spec, &json!({"values":[]}))
                .unwrap_err()
                .code,
            DiagnosticCode::BindingInvalid
        );
    }
}

#[test]
fn invalid_example_initialization_cannot_be_silently_repaired_by_instantiation() {
    let (program, spec) = entities("program.c.array-sum");
    let original = program["sourceExample"].as_str().unwrap();
    for source in [
        original.replace("int n = 3;", "int n = 2;"),
        original.replace("{3, -1, 2}", "{3, -1, 3}"),
        original.replace("values[3]", "values[4]"),
        original.replace("int n = 3;", "int n = 1+2;"),
        original.replace("int n = 3;", "int n = n;"),
    ] {
        let mut altered = program.clone();
        altered["sourceExample"] = json!(source);
        assert_eq!(
            prepare(&altered, &spec, &json!({"values":[5]}))
                .unwrap_err()
                .code,
            DiagnosticCode::BindingInvalid
        );
    }
}

#[test]
fn source_map_rejects_missing_extra_duplicate_partial_and_stale_ranges() {
    let (program, spec) = entities("program.c.array-sum");
    let input = json!({"values":[-999, 999, 2, 3, 4]});
    let prepared = prepare(&program, &spec, &input).unwrap();
    let original = prepare(&program, &spec, &program["exampleInput"]).unwrap();
    let mapping = map(&prepared);
    let mut cases = vec![vec![], map(&original)];
    let mut missing = mapping.clone();
    missing.pop();
    cases.push(missing);
    let mut duplicate = mapping.clone();
    duplicate.push(mapping[0].clone());
    cases.push(duplicate);
    let mut extra = mapping.clone();
    extra[0].binding_key = "param.unknown".into();
    cases.push(extra);
    let mut partial = mapping.clone();
    partial[0].byte_range.end -= 1;
    cases.push(partial);
    let mut outside = mapping.clone();
    outside[0].byte_range = ByteRange {
        start: usize::MAX,
        end: usize::MAX,
    };
    cases.push(outside);
    for mapping in cases {
        assert_eq!(
            verify_instance(&program, &spec, &input, prepared.source(), &mapping)
                .unwrap_err()
                .code,
            DiagnosticCode::BindingInvalid
        );
    }
}

#[test]
fn a_shadow_declaration_cannot_replace_a_main_input_binding() {
    let (program, spec) = entities("program.c.echo");
    let source = "int main(){int x=7; {int x=7; printf(\"%d\",x);}return 0;}";
    let checked = analyze(source).unwrap();
    let shadow = checked
        .declarations
        .iter()
        .filter(|declaration| declaration.name == "x")
        .nth(1)
        .unwrap();
    let mapping = vec![BindingMapEntry {
        binding_key: "param.x".into(),
        byte_range: checked.parsed.program.nodes[shadow.node_id].byte_range,
    }];
    assert_eq!(
        verify_instance(&program, &spec, &json!({"x":7}), source, &mapping)
            .unwrap_err()
            .code,
        DiagnosticCode::BindingInvalid
    );
    let source = "int main(){{int x=7;printf(\"%d\",x);}return 0;}";
    assert_eq!(
        verify_instance(
            &program,
            &spec,
            &json!({"x":7}),
            source,
            &map_source(&program, source)
        )
        .unwrap_err()
        .code,
        DiagnosticCode::BindingInvalid
    );
}

#[test]
fn logical_n_assignment_is_rejected_on_dead_paths_and_for_headers_by_identity() {
    let (program, spec) = entities("program.c.array-sum");
    for suffix in [
        "n=3;",
        "if(0){n=3;}",
        "return 0;n=3;",
        "for(n=0;n<0;n=n+1){;}",
    ] {
        let source = format!("int main(){{int n=3;int values[3]={{3,-1,2}};{suffix}}}");
        assert_eq!(
            verify_instance(
                &program,
                &spec,
                &program["exampleInput"],
                &source,
                &map_source(&program, &source)
            )
            .unwrap_err()
            .code,
            DiagnosticCode::BindingInvalid
        );
    }
}

#[test]
fn loop_input_n_is_protected_while_unrelated_shadow_n_can_be_assigned() {
    let (program, spec) = entities("program.c.two-loop-sums");
    let source = "int main(){int n=5;n=6;return 0;}";
    assert_eq!(
        verify_instance(
            &program,
            &spec,
            &json!({"n":5}),
            source,
            &map_source(&program, source)
        )
        .unwrap_err()
        .code,
        DiagnosticCode::BindingInvalid
    );
    let source = "int main(){int n=5;{int n=2;n=3;printf(\"%d \",n);}printf(\"%d\",n);return 0;}";
    let checked = verify_instance(
        &program,
        &spec,
        &json!({"n":5}),
        source,
        &map_source(&program, source),
    )
    .unwrap();
    assert_eq!(execute(&checked).state.output, "3 5");
}

#[test]
fn loop_count_write_protection_follows_the_input_declaration_with_any_binding_key() {
    let (mut program, spec) = entities("program.c.two-loop-sums");
    program["bindings"][0]["bindingKey"] = json!("param.count");
    let input = json!({"n":3});
    let prepared = prepare(&program, &spec, &input).unwrap();
    completed(&prepared, "6\n6\n", 0);
    let source = prepared.source().replace("return 0;", "n = 4; return 0;");
    assert_eq!(
        verify_instance(
            &program,
            &spec,
            &input,
            &source,
            &map_source(&program, &source)
        )
        .unwrap_err()
        .code,
        DiagnosticCode::BindingInvalid
    );
}

#[test]
fn ordinary_source_x_and_k_remain_assignable_after_the_input_prefix() {
    let (program, spec) = entities("program.c.echo");
    let source = "int main(){int x=7;x=x+2;printf(\"%d\",x);return 0;}";
    let checked = verify_instance(
        &program,
        &spec,
        &json!({"x":7}),
        source,
        &map_source(&program, source),
    )
    .unwrap();
    assert_eq!(execute(&checked).state.output, "9");
    let (program, spec) = entities("program.c.increment-at-index");
    let source = "int main(){int n=3;int values[3]={4,0,-2};int k=1;k=k+1;printf(\"%d\",values[k]);return 0;}";
    let checked = verify_instance(
        &program,
        &spec,
        &program["exampleInput"],
        source,
        &map_source(&program, source),
    )
    .unwrap();
    assert_eq!(execute(&checked).state.output, "-2");
}

#[test]
fn utf8_crlf_comments_and_non_input_bytes_survive_length_changing_edits() {
    let (mut program, spec) = entities("program.c.array-sum");
    let original = format!(
        "// 中文😀: int n = 3;\r\n{}",
        program["sourceExample"]
            .as_str()
            .unwrap()
            .replace('\n', "\r\n")
    );
    program["sourceExample"] = json!(original);
    let input = json!({"values":[-999, 999, 17, -18, 0, 3]});
    let prepared = prepare(&program, &spec, &input).unwrap();
    let (mut old_cursor, mut new_cursor) = (0, 0);
    for edit in prepared.edits() {
        assert_eq!(
            &original[old_cursor..edit.original_range.start],
            &prepared.source()[new_cursor..edit.generated_range.start]
        );
        old_cursor = edit.original_range.end;
        new_cursor = edit.generated_range.end;
    }
    assert_eq!(&original[old_cursor..], &prepared.source()[new_cursor..]);
    assert!(prepared.source().starts_with("// 中文😀: int n = 3;\r\n"));
    for binding in prepared.bindings() {
        assert!(matches!(
            prepared.checked().parsed.program.nodes[binding.declaration_node].data,
            NodeData::Declaration { .. }
        ));
        assert_eq!(
            prepared.checked().parsed.program.nodes[binding.declaration_node].byte_range,
            binding.byte_range
        );
    }
    completed(&prepared, "2\n", 0);
    assert_eq!(prepare(&program, &spec, &input).unwrap(), prepared);
}

#[test]
fn empty_sequence_has_one_zero_storage_slot_and_zero_logical_length() {
    let (program, spec) = entities("program.c.array-sum");
    let prepared = prepare(&program, &spec, &json!({"values":[]})).unwrap();
    assert!(prepared.source().contains("int n = 0;"));
    assert!(prepared.source().contains("int values[1] = {0};"));
    completed(&prepared, "0\n", 0);
}

#[test]
fn input_prefix_order_and_initialization_cannot_be_rebound_to_other_declarations() {
    let (program, spec) = entities("program.c.increment-at-index");
    for source in [
        "int main(){int n=3;int other[3]={4,0,-2};int k=1;int values[3]={4,0,-2};}",
        "int main(){int n=3;int values[3]={4,0,-2};printf(\"x\");int k=1;}",
        "int main(){int values[3]={4,0,-2};int n=3;int k=1;}",
        "int main(){int n=3;int values[3]={4,0,-2};int k=0;}",
        "int main(){int n=3;int values[3]={4,0};int k=1;}",
    ] {
        assert_eq!(
            verify_instance(
                &program,
                &spec,
                &program["exampleInput"],
                source,
                &map_source(&program, source)
            )
            .unwrap_err()
            .code,
            DiagnosticCode::BindingInvalid
        );
    }
}
