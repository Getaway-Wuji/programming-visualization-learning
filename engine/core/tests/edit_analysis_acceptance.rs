//! Real Rust analysis acceptance. No reverse converter, execution, or learning
//! authority is implemented by these tests.

use c_viz_core::{
    budget::{Limits, Meter},
    codec, edit_analysis,
    exec::{self, ExecFailure},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn meter() -> Meter {
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    meter
}

fn package() -> Value {
    serde_json::from_str(include_str!("../../../content/c/p0/course-1.0.1.json")).unwrap()
}

fn catalog(id: &str) -> Value {
    let package = package();
    let subject = package["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|subject| subject["id"] == id)
        .unwrap();
    let program = package["programs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|program| program["id"] == subject["programRef"]["id"])
        .unwrap();
    let input = package["inputSpecs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|input| input["id"] == program["inputRef"]["id"])
        .unwrap();
    let judge = package["judgeProfiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|judge| judge["id"] == subject["judgeRef"]["id"])
        .unwrap();
    json!({"packageRef":{"id":package["packageId"],"version":package["packageVersion"]},"subject":subject,"program":program,"inputSpec":input,"judgeProfile":judge})
}

fn prepared(catalog: &Value, values: &Value) -> Value {
    serde_json::from_slice::<Value>(&exec::prepare_input(catalog, values, &mut meter()).unwrap())
        .unwrap()["source"]
        .clone()
}

fn request(catalog: &Value, source: &str, values: &Value) -> Value {
    json!({"kind":"analysisRequest","analysisVersion":"1.0.0","identity":{"contextId":"context.analysis","contextRevision":1,"documentRevision":1,"editId":"edit.1","operationId":"analysis.1"},"refs":{"packageRef":catalog["packageRef"],"programRef":{"id":catalog["program"]["id"],"version":catalog["program"]["version"]},"subsetRef":catalog["program"]["subsetRef"]},"sourceText":source,"input":{"specRef":catalog["program"]["inputRef"],"values":values,"random":null}})
}

fn analyze(request: &Value, catalog: &Value, meter: &mut Meter) -> Result<Value, ExecFailure> {
    let bytes = codec::encode(request, &mut self::meter(), 65536).unwrap();
    let bytes = edit_analysis::analyze_code_draft(
        std::str::from_utf8(&bytes).unwrap(),
        &catalog.to_string(),
        meter,
    )?;
    let value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        codec::encode(&value, &mut self::meter(), 16777216).unwrap(),
        bytes,
        "canonical response"
    );
    Ok(value)
}

fn echo(body: &str) -> (Value, Value) {
    let catalog = catalog("exercise.c.echo");
    let values = &catalog["program"]["exampleInput"];
    let prepared = prepared(&catalog, values);
    let text = prepared["text"].as_str().unwrap();
    let end = prepared["bindingMap"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["byteRange"]["end"].as_u64().unwrap() as usize)
        .max()
        .unwrap();
    let source = format!("{}\n{body}\n}}\n", &text[..end]);
    let request = request(&catalog, &source, values);
    (catalog, request)
}

#[test]
fn all_six_exercises_and_24_real_input_instances_analyze_without_execution() {
    let package = package();
    let mut count = 0;
    for exercise in package["exercises"].as_array().unwrap() {
        let catalog = catalog(exercise["id"].as_str().unwrap());
        for test in exercise["tests"].as_array().unwrap() {
            let source = prepared(&catalog, &test["input"]);
            let request = request(&catalog, source["text"].as_str().unwrap(), &test["input"]);
            let result = analyze(&request, &catalog, &mut meter()).unwrap();
            assert_eq!(result["status"], "valid", "{result}");
            assert_eq!(result["identity"], request["identity"]);
            assert_eq!(result["refs"], request["refs"]);
            assert!(result.get("trace").is_none());
            assert!(result.get("judgeResult").is_none());
            assert!(result.get("provenance").is_none());
            assert_eq!(result["bindingMap"], source["bindingMap"]);
            count += 1;
        }
    }
    assert_eq!(count, 24);
}

#[test]
fn all_18_flat_node_kinds_include_resolved_names_and_containing_parent_ranges() {
    let (catalog, request) = echo(
        "int y; y=1; int a[3]={+7,-2,-0}; {int z=1; z=z+1;} if (x>0) {y=a[0];} else {} while(0) {continue;break;} for(int i=0;i<2;i=i+1){a[i]=i;} printf(\"%d %d%%\\n\",!y + (-2*3/2)%2, (y==1)&&(y!=0)||0); ; return 0;",
    );
    let result = analyze(&request, &catalog, &mut meter()).unwrap();
    assert_eq!(result["status"], "valid", "{result}");
    let nodes = result["checkedAst"]["nodes"].as_array().unwrap();
    let kinds: BTreeSet<_> = nodes
        .iter()
        .map(|node| node["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds.len(), 18);
    for (position, node) in nodes.iter().enumerate() {
        assert_eq!(node["nodeId"], format!("n{}", position + 1));
        let range = &node["byteRange"];
        assert!(range["start"].as_u64().unwrap() < range["end"].as_u64().unwrap());
        if position == 0 {
            assert!(node["parentId"].is_null());
        } else {
            let parent = nodes
                .iter()
                .find(|parent| parent["nodeId"] == node["parentId"])
                .unwrap();
            assert!(parent["byteRange"]["start"].as_u64() <= range["start"].as_u64());
            assert!(parent["byteRange"]["end"].as_u64() >= range["end"].as_u64());
        }
        if node["kind"] == "name" {
            assert!(nodes.iter().any(|declaration| declaration["nodeId"]
                == node["resolvedDeclarationId"]
                && declaration["kind"] == "declaration"
                && declaration["name"] == node["name"]));
        }
    }
}

#[test]
fn valid_but_unmapped_syntax_is_not_mislabeled_as_invalid_c() {
    for body in [
        "; return 0;",
        "int _local=1; return _local;",
        "int a[1]={0};for(a[0]=0;a[0]<1;a[0]=a[0]+1){}return 0;",
        "printf(\"原始\t字符\");return 0;",
    ] {
        let (catalog, request) = echo(body);
        let result = analyze(&request, &catalog, &mut meter()).unwrap();
        assert_eq!(result["status"], "valid", "{body}: {result}");
    }
}

#[test]
fn illegal_c_never_returns_a_partial_or_stale_ast() {
    for body in [
        "if(x) return 0;",
        "x++;",
        "printf(\"%s\",x);",
        "int a[2]={1+2};",
        "return -2147483648;",
        "break;",
        "return missing;",
    ] {
        let (catalog, request) = echo(body);
        let result = analyze(&request, &catalog, &mut meter()).unwrap();
        assert_eq!(result["status"], "invalid", "{body}: {result}");
        assert_eq!(result["diagnostics"].as_array().unwrap().len(), 1);
        for absent in ["checkedAst", "nodeMap", "blockMap", "bindingMap", "trivia"] {
            assert!(result.get(absent).is_none());
        }
    }
}

#[test]
fn input_declaration_protection_and_shadow_read_write_rule_are_enforced() {
    for body in [
        "{int x=9; printf(\"%d\",x);}return 0;",
        "{int x=9;x=8;}return 0;",
        "{int x=x+1;}return 0;",
    ] {
        let (catalog, request) = echo(body);
        let result = analyze(&request, &catalog, &mut meter()).unwrap();
        assert_eq!(result["status"], "invalid", "{body}: {result}");
        assert_eq!(result["diagnostics"][0]["code"], "E_BINDING_INVALID");
    }
    for body in [
        "{int x=9;}printf(\"%d\",x);return 0;",
        "x=x+1;printf(\"%d\",x);return 0;",
    ] {
        let (catalog, request) = echo(body);
        assert_eq!(
            analyze(&request, &catalog, &mut meter()).unwrap()["status"],
            "valid"
        );
    }
    let (catalog, mut request) = echo("return 0;");
    let source = request["sourceText"].as_str().unwrap();
    let changed = source.replacen("int x", "int renamed", 1);
    request["sourceText"] = json!(changed);
    assert_eq!(
        analyze(&request, &catalog, &mut meter()).unwrap()["status"],
        "invalid"
    );
}

#[test]
fn empty_array_bindings_keep_physical_placeholder_and_protect_logical_length() {
    let catalog = catalog("exercise.c.array-sum");
    let test = catalog["subject"]["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|test| {
            test["input"]
                .as_object()
                .unwrap()
                .values()
                .any(|value| value.as_array().is_some_and(Vec::is_empty))
        })
        .unwrap();
    let source = prepared(&catalog, &test["input"]);
    let request = request(&catalog, source["text"].as_str().unwrap(), &test["input"]);
    let result = analyze(&request, &catalog, &mut meter()).unwrap();
    assert_eq!(result["status"], "valid");
    assert!(
        result["checkedAst"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["kind"] == "declaration" && node["arrayLength"] == "1")
    );
    let (catalog, mut request) = {
        let catalog = self::catalog("exercise.c.two-loop-sums");
        let source = prepared(&catalog, &catalog["program"]["exampleInput"]);
        let request = self::request(
            &catalog,
            source["text"].as_str().unwrap(),
            &catalog["program"]["exampleInput"],
        );
        (catalog, request)
    };
    request["sourceText"] = json!(request["sourceText"].as_str().unwrap().replacen(
        "return 0;",
        "return 0; n=1;",
        1
    ));
    assert_eq!(
        analyze(&request, &catalog, &mut meter()).unwrap()["diagnostics"][0]["code"],
        "E_BINDING_INVALID"
    );
}

#[test]
fn trivia_comes_from_lexer_gaps_and_preserves_unicode_crlf_comments() {
    let (catalog, mut request) = echo("printf(\"// 文本 /* 😀 */\"); /*保留😀*/ //尾注\nreturn 0;");
    request["sourceText"] = json!(
        request["sourceText"]
            .as_str()
            .unwrap()
            .replace('\n', "\r\n")
    );
    let source = request["sourceText"].as_str().unwrap();
    let result = analyze(&request, &catalog, &mut meter()).unwrap();
    assert_eq!(result["status"], "valid");
    let comments: Vec<_> = result["trivia"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] != "whitespace")
        .map(|item| {
            let start = item["byteRange"]["start"].as_u64().unwrap() as usize;
            let end = item["byteRange"]["end"].as_u64().unwrap() as usize;
            &source[start..end]
        })
        .collect();
    assert_eq!(comments, ["/*保留😀*/", "//尾注"]);
    assert!(result["trivia"].as_array().unwrap().iter().any(|item| {
        let start = item["byteRange"]["start"].as_u64().unwrap() as usize;
        let end = item["byteRange"]["end"].as_u64().unwrap() as usize;
        source[start..end].contains("\r\n")
    }));
}

#[test]
fn unknown_fields_versions_bad_identity_and_noncanonical_wire_are_rejected() {
    let (catalog, base) = echo("return 0;");
    for (key, value) in [
        ("extra", json!(true)),
        ("analysisVersion", json!("2.0.0")),
        ("identity", json!({})),
        ("sourceText", json!(null)),
    ] {
        let mut request = base.clone();
        request[key] = value;
        assert!(analyze(&request, &catalog, &mut meter()).is_err(), "{key}");
    }
    let duplicate = "{\"analysisVersion\":\"1.0.0\",\"analysisVersion\":\"1.0.0\"}";
    assert_eq!(
        edit_analysis::analyze_code_draft(duplicate, &catalog.to_string(), &mut meter()),
        Err(ExecFailure("E_PROTOCOL_INVALID"))
    );
}

#[test]
fn source_and_result_limits_fail_as_analysis_budget_not_c_syntax() {
    let (catalog, mut request) = echo("return 0;");
    let source = request["sourceText"].as_str().unwrap();
    request["sourceText"] = json!(format!("{source}{}", " ".repeat(32768 - source.len())));
    assert_eq!(
        analyze(&request, &catalog, &mut meter()).unwrap()["status"],
        "valid"
    );
    request["sourceText"] = json!(format!("{} ", request["sourceText"].as_str().unwrap()));
    assert_eq!(
        analyze(&request, &catalog, &mut meter()).unwrap()["error"]["code"],
        "budget"
    );
    let (_, request) = echo("int y=1;printf(\"%d\",y);return 0;");
    let mut limited = Meter::with_limits(Limits {
        result_bytes: 1000,
        ..Limits::default()
    });
    limited.set_clock(1000, Box::new(|| 0));
    assert_eq!(
        analyze(&request, &catalog, &mut limited).unwrap()["error"]["code"],
        "budget"
    );
}

#[test]
fn cancellation_and_deadline_never_unlock_a_successful_projection() {
    let (catalog, request) = echo("return 0;");
    let mut cancelled = meter();
    cancelled.set_cancel(Box::new(|| true));
    assert_eq!(
        analyze(&request, &catalog, &mut cancelled),
        Err(ExecFailure("E_CANCELLED"))
    );
    let mut expired = meter();
    expired.set_clock(0, Box::new(|| 0));
    assert_eq!(
        analyze(&request, &catalog, &mut expired),
        Err(ExecFailure("E_DEADLINE"))
    );
}

#[test]
fn candidate_maps_cover_primary_nodes_and_exclude_control_body_wrappers() {
    let (catalog, request) =
        echo("int a[2]={1,2};a[0]=x;if(x){printf(\"%d\",a[0]);}else{}return 0;");
    let result = analyze(&request, &catalog, &mut meter()).unwrap();
    let nodes = result["checkedAst"]["nodes"].as_array().unwrap();
    let maps = result["blockMap"].as_array().unwrap();
    for map in maps {
        let id = map["blockId"]
            .as_str()
            .unwrap()
            .strip_prefix("block.analysis.")
            .unwrap()
            .parse::<usize>()
            .unwrap()
            - 1;
        assert_eq!(map["byteRange"], nodes[id]["byteRange"]);
        assert_ne!(nodes[id]["kind"], "condition");
    }
    for node in nodes.iter().filter(|node| node["kind"] == "if") {
        assert_eq!(
            maps.iter()
                .filter(|map| map["byteRange"] == node["byteRange"])
                .count(),
            1
        );
    }
}

#[test]
fn request_bytes_have_their_own_limit_before_source_analysis() {
    let (catalog, mut request) = echo("return 0;");
    request["sourceText"] = json!(" ".repeat(65536));
    assert_eq!(
        edit_analysis::analyze_code_draft(&request.to_string(), &catalog.to_string(), &mut meter()),
        Err(ExecFailure("E_REQUEST_LIMIT")),
    );
}

#[test]
fn source_limit_counts_utf8_bytes_not_utf16_or_character_count() {
    let (catalog, mut request) = echo("return 0;");
    let prefix = request["sourceText"].as_str().unwrap();
    let padding = 32768 - prefix.len() - 4;
    let source = format!(
        "{prefix}/*{}{}*/",
        "😀".repeat(padding / 4),
        " ".repeat(padding % 4)
    );
    assert_eq!(source.len(), 32768);
    assert!(source.chars().count() < source.len());
    request["sourceText"] = json!(source);
    let result = analyze(&request, &catalog, &mut meter()).unwrap();
    assert_eq!(result["status"], "valid");
    request["sourceText"] = json!(format!("{} ", request["sourceText"].as_str().unwrap()));
    assert_eq!(
        analyze(&request, &catalog, &mut meter()).unwrap()["error"]["code"],
        "budget"
    );
}

#[test]
fn controlled_arrays_use_the_same_reference_identity_rule_as_scalars() {
    let catalog = catalog("exercise.c.array-sum");
    let values = &catalog["program"]["exampleInput"];
    let source = prepared(&catalog, values);
    let end = source["bindingMap"]
        .as_array()
        .unwrap()
        .iter()
        .map(|binding| binding["byteRange"]["end"].as_u64().unwrap() as usize)
        .max()
        .unwrap();
    let prefix = &source["text"].as_str().unwrap()[..end];
    let array_name = catalog["program"]["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|binding| binding["targetKind"] == "array")
        .unwrap()["targetName"]
        .as_str()
        .unwrap();
    for (body, expected) in [
        (
            format!("{{int {array_name}[1]={{5}};printf(\"%d\",{array_name}[0]);}}"),
            "invalid",
        ),
        (
            format!("{{int {array_name}[1]={{5}};{array_name}[0]=6;}}"),
            "invalid",
        ),
        (format!("{{int {array_name}[1]={{5}};}}"), "valid"),
    ] {
        let source = format!("{prefix}\n{body}\nreturn 0;\n}}");
        let request = request(&catalog, &source, values);
        let result = analyze(&request, &catalog, &mut meter()).unwrap();
        assert_eq!(result["status"], expected, "{body}: {result}");
        if expected == "invalid" {
            assert_eq!(result["diagnostics"][0]["code"], "E_BINDING_INVALID");
        }
    }
}

#[test]
fn reordering_existing_input_declarations_does_not_change_their_identity() {
    let catalog = catalog("exercise.c.increment-at-index");
    let values = &catalog["program"]["exampleInput"];
    let source = prepared(&catalog, values);
    let text = source["text"].as_str().unwrap();
    let mut maps: Vec<_> = source["bindingMap"].as_array().unwrap().iter().collect();
    maps.sort_by_key(|binding| binding["byteRange"]["start"].as_u64());
    let range = |binding: &Value| {
        (
            binding["byteRange"]["start"].as_u64().unwrap() as usize,
            binding["byteRange"]["end"].as_u64().unwrap() as usize,
        )
    };
    let (a_start, a_end) = range(maps[0]);
    let (b_start, b_end) = range(maps[1]);
    let reordered = format!(
        "{}{}{}{}{}",
        &text[..a_start],
        &text[b_start..b_end],
        &text[a_end..b_start],
        &text[a_start..a_end],
        &text[b_end..]
    );
    let request = request(&catalog, &reordered, values);
    let result = analyze(&request, &catalog, &mut meter()).unwrap();
    assert_eq!(result["status"], "invalid", "{result}");
    assert_eq!(result["diagnostics"][0]["code"], "E_BINDING_INVALID");
}

#[test]
fn later_cancellation_and_deadline_cannot_return_success_or_a_c_error() {
    use std::cell::Cell;
    use std::rc::Rc;
    let (catalog, request) = echo(&format!("{}return 0;", "printf(\"a\");".repeat(250)));
    for cancel in [true, false] {
        let calls = Rc::new(Cell::new(0));
        let observed = calls.clone();
        let mut bounded = meter();
        if cancel {
            bounded.set_cancel(Box::new(move || {
                observed.set(observed.get() + 1);
                observed.get() > 4
            }));
        } else {
            bounded.set_clock(
                1000,
                Box::new(move || {
                    observed.set(observed.get() + 1);
                    if observed.get() > 4 { 1000 } else { 0 }
                }),
            );
        }
        assert_eq!(
            analyze(&request, &catalog, &mut bounded),
            Err(ExecFailure(if cancel {
                "E_CANCELLED"
            } else {
                "E_DEADLINE"
            }))
        );
        assert!(calls.get() > 4);
    }
}

#[test]
fn fuel_exhaustion_is_bounded_without_a_successful_partial_projection() {
    let (catalog, request) = echo(&format!("{}return 0;", "printf(\"a\");".repeat(250)));
    let mut bounded = Meter::with_limits(Limits {
        fuel: 20000,
        ..Limits::default()
    });
    bounded.set_clock(1000, Box::new(|| 0));
    let result = analyze(&request, &catalog, &mut bounded);
    match result {
        Ok(result) => {
            assert_eq!(result["kind"], "analysisFailure");
            assert_eq!(result["error"]["code"], "budget");
            assert!(result.get("checkedAst").is_none());
        }
        Err(error) => assert_eq!(error, ExecFailure("E_FUEL_LIMIT")),
    }
    assert!(bounded.used() <= 20000);
}
