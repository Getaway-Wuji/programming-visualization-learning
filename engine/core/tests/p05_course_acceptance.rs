//! P0.5-09 real EXEC 1.1 results. No native C or synthetic execution traces.
use c_viz_core::{budget::Meter, codec, exec};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut m = Meter::new();
    m.set_clock(1000, Box::new(|| 0));
    m
}
fn reference(id: &str) -> Value {
    json!({"id":id,"version":"1.0.0"})
}
fn custom(
    rule: &str,
    suffix: &str,
    input: Value,
    body: &str,
    stdout: &str,
    array: Option<Value>,
) -> Value {
    let old: Value =
        serde_json::from_str(include_str!("../../../content/c/p0/course-1.0.1.json")).unwrap();
    let mut program = old["programs"][0].clone();
    let mut subject = old["exercises"][0].clone();
    let mut fields = vec![];
    let mut bindings = vec![];
    let mut relations = vec![];
    let mut prefix = String::from("#include <stdio.h>\nint main(void) {\n");
    for (key, value) in input.as_object().unwrap() {
        if let Some(values) = value.as_array() {
            fields.push(json!({"key":key,"kind":"sequence","min":-999,"max":999,"minItems":0,"maxItems":30}));
            relations.push(json!({"kind":"length-of","field":key,"target":"n"}));
            bindings.push(json!({"bindingKey":format!("param.{key}"),"inputKey":key,"targetName":key,"targetKind":"array","from":"field","emptyStorage":"one-zero-placeholder"}));
            bindings.push(json!({"bindingKey":"param.n","inputKey":key,"targetName":"n","targetKind":"logical-length","from":"length-of"}));
            let initial = if values.is_empty() {
                "0".into()
            } else {
                values
                    .iter()
                    .map(Value::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            };
            prefix.push_str(&format!(
                "int {key}[{}] = {{{initial}}};\nint n = {};\n",
                values.len().max(1),
                values.len()
            ));
        } else {
            fields.push(json!({"key":key,"kind":"integer","min":-999,"max":999}));
            bindings.push(json!({"bindingKey":format!("param.{key}"),"inputKey":key,"targetName":key,"targetKind":"scalar","from":"field"}));
            prefix.push_str(&format!("int {key} = {value};\n"));
        }
    }
    let input_id = format!("input.c.{suffix}");
    let program_id = format!("program.c.practice-{suffix}");
    let judge_id = format!("judge.c.{suffix}");
    program["id"] = json!(program_id);
    program["inputRef"] = reference(&input_id);
    program["sourceExample"] = json!(format!("{prefix}{body}\nreturn 0;\n}}\n"));
    program["exampleInput"] = input.clone();
    program["bindings"] = json!(bindings);
    subject["id"] = json!(format!("exercise.c.{suffix}"));
    subject["version"] = json!("1.0.0");
    subject["programRef"] = reference(&program_id);
    subject["judgeRef"] = reference(&judge_id);
    let mut test =
        json!({"caseKey":"test","input":input,"expectedStdout":stdout,"expectedExitCode":0});
    if let Some(a) = array {
        test["expectedArray"] = a;
    }
    subject["tests"] = json!([test]);
    json!({"packageRef":reference("content.c.p05"),"subject":subject,"program":program,"inputSpec":{"id":input_id,"version":"1.0.0","title":"P05 test input","fields":fields,"relations":relations},"judgeProfile":{"id":judge_id,"version":"1.0.0","title":"P05 test judge","rule":rule,"targetDescription":"real teaching proof"}})
}
fn execute(c: &Value) -> Value {
    execute_test(c, 0)
}
fn request(c: &Value, index: usize) -> Value {
    let test = &c["subject"]["tests"][index];
    let prepared: Value =
        serde_json::from_slice(&exec::prepare_input(c, &test["input"], &mut meter()).unwrap())
            .unwrap();
    let mut judge = json!({"profileRef":c["subject"]["judgeRef"],"rule":c["judgeProfile"]["rule"],"expectedStdout":test["expectedStdout"],"expectedExitCode":0});
    if let Some(a) = test.get("expectedArray") {
        judge["expectedArray"] = a.clone();
    }
    let old = [
        "input-read-output",
        "multiply-add-output",
        "if-else-paths",
        "while-for-accumulations",
        "single-index-increment",
        "logical-array-accumulation",
    ]
    .iter()
    .any(|r| c["judgeProfile"]["rule"] == *r);
    let version = if old { "1.0.0" } else { "1.1.0" };
    let r = json!({"kind":"execute","protocolVersion":version,"traceVersion":"1.0.0","diagnosticVersion":"1.0.0","judgeVersion":version,"encodingVersion":"1.0.0","identity":{"contextId":"p05-context","contextRevision":1,"submissionId":"p05-submission","runId":"p05-run","sourceRevision":1,"testCaseKey":test["caseKey"]},"mode":"exercise-test","packageRef":c["packageRef"],"languageRef":reference("lang.c"),"subsetRef":reference("subset.c.p0"),"programRef":c["subject"]["programRef"],"subjectRef":{"id":c["subject"]["id"],"version":c["subject"]["version"]},"learningRevision":1,"engineRef":{"id":"engine.c.p0","version":"1.0.0","buildId":"p05-test"},"source":prepared["source"],"input":{"specRef":c["program"]["inputRef"],"values":test["input"],"random":null},"judge":judge,"budgetRef":reference("budget.p0"),"remainingMs":1000});
    r
}
fn execute_test(c: &Value, index: usize) -> Value {
    let bytes = codec::encode(&request(c, index), &mut meter(), 65536).unwrap();
    serde_json::from_slice(&exec::execute_request(&bytes, c, "p05-test", &mut meter()).unwrap())
        .unwrap()
}

fn course_catalogs() -> Vec<Value> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let package: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("content/c/p05/course-1.0.0.json")).unwrap(),
    )
    .unwrap();
    let answers: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("tests/fixtures/p05-reference-solutions.json")).unwrap(),
    )
    .unwrap();
    let find = |table: &str, id: &Value| {
        package[table]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == *id)
            .unwrap()
            .clone()
    };
    package["exercises"].as_array().unwrap().iter().map(|subject|{
        let mut program=find("programs",&subject["programRef"]["id"]);
        program["sourceExample"]=answers["solutions"].as_array().unwrap().iter().find(|s|s["exerciseRef"]["id"]==subject["id"]).unwrap()["source"].clone();
        json!({"packageRef":{"id":package["packageId"],"version":package["packageVersion"]},"subject":subject,"inputSpec":find("inputSpecs",&program["inputRef"]["id"]),"program":program,"judgeProfile":find("judgeProfiles",&subject["judgeRef"]["id"])})
    }).collect()
}

#[test]
fn all_thirty_two_frozen_course_answers_pass_every_real_test() {
    let catalogs = course_catalogs();
    assert_eq!(catalogs.len(), 32);
    let mut records = vec![];
    for c in catalogs {
        for i in 0..c["subject"]["tests"].as_array().unwrap().len() {
            let r = execute_test(&c, i);
            records.push(json!({"exerciseRef":{"id":c["subject"]["id"],"version":c["subject"]["version"]},"caseKey":c["subject"]["tests"][i]["caseKey"],"status":r["terminal"]["status"],"judgeStatus":r["judgeResult"]["status"],"fuelUsed":r["stats"]["fuelUsed"],"steps":r["trace"]["steps"].as_array().map_or(0,Vec::len),"coverage":r["judgeResult"]["coverage"]}));
            if r["judgeResult"]["status"] != "met" {
                eprintln!(
                    "FAILED {} {}: {} {}",
                    c["subject"]["id"],
                    c["subject"]["tests"][i]["caseKey"],
                    r["terminal"],
                    r["judgeResult"]
                );
            }
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::create_dir_all(root.join(".artifacts/P0.5-09")).unwrap();
    let report = std::env::var("P05_RUST_ANSWERS_REPORT")
        .unwrap_or_else(|_| ".artifacts/P0.5-09/rust-course-answers.json".into());
    assert!(report.starts_with(".artifacts/P0.5-09/"));
    std::fs::write(
        root.join(report),
        serde_json::to_vec_pretty(&json!({"task":"P0.5-09","records":records})).unwrap(),
    )
    .unwrap();
    assert!(
        records
            .iter()
            .all(|r| r["status"] == "completed" && r["judgeStatus"] == "met")
    );
    assert_eq!(records.len(), 140);
    for (id, required) in [
        ("absolute-with-if", 1),
        ("sign-classification", 2),
        ("in-closed-range", 1),
        ("odd-sum-until-stop", 2),
    ] {
        let mut sites: std::collections::BTreeMap<String, std::collections::BTreeSet<String>> =
            std::collections::BTreeMap::new();
        for record in records
            .iter()
            .filter(|record| record["exerciseRef"]["id"] == format!("exercise.c.{id}"))
        {
            for entry in record["coverage"].as_array().unwrap() {
                if entry["visits"].as_u64().unwrap() > 0 {
                    sites
                        .entry(entry["siteKey"].as_str().unwrap().into())
                        .or_default()
                        .insert(entry["branch"].as_str().unwrap().into());
                }
            }
        }
        assert!(
            sites
                .values()
                .filter(|branches| branches.contains("then") && branches.contains("else"))
                .count()
                >= required,
            "{id}: missing cross-group real target branches {sites:?}"
        );
    }
}
fn assert_met(c: Value) {
    let r = execute(&c);
    assert_eq!(r["terminal"]["status"], "completed", "{r}");
    assert_eq!(r["protocolVersion"], "1.1.0");
    assert_eq!(
        r["judgeResult"]["status"], "met",
        "{}: {}",
        c["judgeProfile"]["rule"], r["judgeResult"]
    );
}

#[test]
fn first_output_really_accepts_zero_input_without_dummy_binding() {
    assert_met(custom(
        "entry-output",
        "first-output",
        json!({}),
        "printf(\"Hello, C!\\n\");",
        "Hello, C!\n",
        None,
    ));
}
#[test]
fn scalar_output_layout_and_wide_multiplication_use_input_provenance() {
    assert_met(custom(
        "printf-integer-layout",
        "printf-layout",
        json!({"x":7,"y":-2}),
        "printf(\"x=%d,y=%d\\n100%%\\n\",x,y);",
        "x=7,y=-2\n100%\n",
        None,
    ));
    assert_met(custom(
        "safe-wide-product",
        "wide-product",
        json!({"x":999}),
        "int result = 1000000*x; printf(\"%d\\n\",result);",
        "999000000\n",
        None,
    ));
}
#[test]
fn dynamic_scalar_versions_swaps_and_shadowing() {
    assert_met(custom(
        "ordered-output-dependency",
        "ordered-updates",
        json!({"x":4}),
        "printf(\"%d\\n\",x); x=x+1; printf(\"%d\\n\",x); x=x+2; printf(\"%d\\n\",x);",
        "4\n5\n7\n",
        None,
    ));
    assert_met(custom(
        "scalar-reassignment",
        "reassign-value",
        json!({"x":-2}),
        "int result=x; printf(\"%d\\n\",result); result=x+3; printf(\"%d\\n\",result);",
        "-2\n1\n",
        None,
    ));
    assert_met(custom(
        "temporary-swap",
        "swap-with-temp",
        json!({"x":3,"y":-2}),
        "int temporary=x; x=y; y=temporary; printf(\"%d %d\\n\",x,y);",
        "-2 3\n",
        None,
    ));
    assert_met(custom(
        "scope-shadow-output",
        "shadowed-values",
        json!({"x":7}),
        "int value=x; { int value=x+1; printf(\"%d\\n\",value); } printf(\"%d\\n\",value);",
        "8\n7\n",
        None,
    ));
}
#[test]
fn arithmetic_logic_and_short_circuit() {
    assert_met(custom(
        "integer-quotient-remainder",
        "quotient-remainder",
        json!({"a":-7,"b":3}),
        "printf(\"%d %d\\n\",a/b,a%b);",
        "-2 -1\n",
        None,
    ));
    assert_met(custom(
        "boolean-classification",
        "boolean-flags",
        json!({"x":5}),
        "printf(\"%d %d\\n\", x>=0 && x<=10, x!=0);",
        "1 1\n",
        None,
    ));
    for (x, out) in [(0, "0\n"), (-3, "0\n"), (3, "1\n")] {
        assert_met(custom(
            "short-circuit-guard",
            "guarded-division",
            json!({"x":x}),
            "printf(\"%d\\n\",x!=0 && 12/x>0);",
            out,
            None,
        ));
    }
}
#[test]
fn real_single_nested_and_interval_branches() {
    for (x, out) in [(-7, "7\n"), (0, "0\n"), (9, "9\n")] {
        assert_met(custom(
            "if-positive-normalize",
            "absolute-with-if",
            json!({"x":x}),
            "if(x<0){x=-x;} printf(\"%d\\n\",x);",
            out,
            None,
        ));
    }
    for (x, out) in [(-7, "-1\n"), (0, "0\n"), (9, "1\n")] {
        assert_met(custom(
            "nested-sign-branches",
            "sign-classification",
            json!({"x":x}),
            "if(x<0){printf(\"-1\\n\");}else{if(x==0){printf(\"0\\n\");}else{printf(\"1\\n\");}}",
            out,
            None,
        ));
    }
    assert_met(custom(
        "interval-membership",
        "in-closed-range",
        json!({"x":7}),
        "if(x>=-3 && x<=7){printf(\"1\\n\");}else{printf(\"0\\n\");}",
        "1\n",
        None,
    ));
}
#[test]
fn countdown_break_continue_and_nested_grid() {
    assert_met(custom(
        "while-countdown",
        "while-countdown",
        json!({"n":4}),
        "int i=n; while(i>0){printf(\"%d\",i);if(i>1){printf(\" \");}i=i-1;}printf(\"\\n\");",
        "4 3 2 1\n",
        None,
    ));
    assert_met(custom(
        "break-continue-odd-sum",
        "odd-sum-until-stop",
        json!({"n":7,"stop":3}),
        "int sum=0;for(int i=1;i<=n;i=i+1){if(i>stop){break;}if(i%2==0){continue;}sum=sum+i;}printf(\"%d\\n\",sum);",
        "4\n",
        None,
    ));
    assert_met(custom(
        "nested-grid-count",
        "grid-count",
        json!({"rows":3,"cols":4}),
        "int count=0;for(int r=0;r<rows;r=r+1){for(int c=0;c<cols;c=c+1){count=count+1;}}printf(\"%d\\n\",count);",
        "12\n",
        None,
    ));
}
#[test]
fn arrays_use_real_initialized_or_bound_objects() {
    assert_met(custom(
        "partial-array-initialization",
        "partial-array-init",
        json!({}),
        "int values[5]={7,-2};for(int i=0;i<5;i=i+1){printf(\"%d\",values[i]);if(i<4){printf(\" \");}}printf(\"\\n\");",
        "7 -2 0 0 0\n",
        None,
    ));
    assert_met(custom(
        "logical-array-print",
        "print-logical-array",
        json!({"values":[3,0,-2,3]}),
        "for(int i=0;i<n;i=i+1){printf(\"%d\",values[i]);if(i+1<n){printf(\" \");}}printf(\"\\n\");",
        "3 0 -2 3\n",
        None,
    ));
    for (k, out) in [(1, "8\n"), (2, "invalid\n")] {
        assert_met(custom(
            "guarded-array-access",
            "safe-array-access",
            json!({"values":[3,8],"k":k}),
            "if(k>=0 && k<n){printf(\"%d\\n\",values[k]);}else{printf(\"invalid\\n\");}",
            out,
            None,
        ));
    }
}
#[test]
fn array_extrema_count_and_linear_search() {
    assert_met(custom(
        "array-extrema",
        "array-extrema",
        json!({"values":[3,-2,8,0]}),
        "int min=values[0];int max=values[0];for(int i=1;i<n;i=i+1){if(values[i]<min){min=values[i];}if(values[i]>max){max=values[i];}}printf(\"%d %d\\n\",min,max);",
        "-2 8\n",
        None,
    ));
    assert_met(custom(
        "array-positive-count",
        "count-positive",
        json!({"values":[-1,0,3,3]}),
        "int count=0;for(int i=0;i<n;i=i+1){if(values[i]>0){count=count+1;}}printf(\"%d\\n\",count);",
        "2\n",
        None,
    ));
    assert_met(custom(
        "linear-first-index",
        "linear-search-first",
        json!({"values":[4,2,2,9],"target":2}),
        "int found=-1;for(int i=0;i<n;i=i+1){if(values[i]==target){found=i;break;}}printf(\"%d\\n\",found);",
        "1\n",
        None,
    ));
}
#[test]
fn adjacent_order_and_binary_first_search() {
    assert_met(custom(
        "adjacent-order-check",
        "check-nondecreasing",
        json!({"values":[1,3,2,4]}),
        "int ordered=1;for(int i=0;i+1<n;i=i+1){if(values[i]>values[i+1]){ordered=0;break;}}printf(\"%d\\n\",ordered);",
        "0\n",
        None,
    ));
    assert_met(custom(
        "binary-first-index",
        "binary-search-first",
        json!({"values":[-2,0,0,0,3],"target":0}),
        "int left=0;int right=n-1;int found=-1;while(left<=right){int mid=left+(right-left)/2;if(values[mid]<target){left=mid+1;}else{if(values[mid]==target){found=mid;}right=mid-1;}}printf(\"%d\\n\",found);",
        "1\n",
        None,
    ));
}
#[test]
fn real_bubble_and_selection_sort_writes_match_source_object() {
    let print = "for(int k=0;k<n;k=k+1){printf(\"%d\",values[k]);if(k+1<n){printf(\" \");}}printf(\"\\n\");";
    let bubble = format!(
        "for(int i=0;i<n-1;i=i+1){{for(int j=0;j<n-1-i;j=j+1){{if(values[j]>values[j+1]){{int t=values[j];values[j]=values[j+1];values[j+1]=t;}}}}}}{print}"
    );
    let selection = format!(
        "for(int i=0;i<n-1;i=i+1){{int minIndex=i;for(int j=i+1;j<n;j=j+1){{if(values[j]<values[minIndex]){{minIndex=j;}}}}if(minIndex!=i){{int t=values[i];values[i]=values[minIndex];values[minIndex]=t;}}}}{print}"
    );
    assert_met(custom(
        "bubble-ascending",
        "bubble-sort",
        json!({"values":[3,-1,3,0]}),
        &bubble,
        "-1 0 3 3\n",
        Some(json!([-1, 0, 3, 3])),
    ));
    assert_met(custom(
        "selection-ascending",
        "selection-sort",
        json!({"values":[2,1,1,3]}),
        &selection,
        "1 1 2 3\n",
        Some(json!([1, 1, 2, 3])),
    ));
}

#[test]
fn maximum_sorting_with_real_analysis_maps_stays_within_original_fuel() {
    let mut records = Vec::new();
    for suffix in ["bubble-sort", "selection-sort"] {
        let c = course(suffix);
        let index = c["subject"]["tests"].as_array().unwrap().len() - 1;
        let mut r = request(&c, index);
        let analysis = json!({"kind":"analysisRequest","analysisVersion":"1.0.0","identity":{"contextId":"context.p05-budget","contextRevision":1,"documentRevision":1,"editId":"edit.1","operationId":"analysis.1"},"refs":{"packageRef":c["packageRef"],"programRef":c["subject"]["programRef"],"subsetRef":c["program"]["subsetRef"]},"sourceText":r["source"]["text"],"input":r["input"]});
        let analysis_bytes = codec::encode(&analysis, &mut meter(), 65536).unwrap();
        let analysis: Value = serde_json::from_slice(
            &c_viz_core::edit_analysis::analyze_code_draft(
                std::str::from_utf8(&analysis_bytes).unwrap(),
                &c.to_string(),
                &mut meter(),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(analysis["status"], "valid");
        let mut map = analysis["blockMap"].clone();
        for (index, entry) in map.as_array_mut().unwrap().iter_mut().enumerate() {
            entry["blockId"] = json!(format!("block.code.{}", index + 100));
        }
        assert!(map.as_array().unwrap().len() > 60);
        let block_map_count = map.as_array().unwrap().len();
        r["source"]["blockMap"] = map;
        let bytes = codec::encode(&r, &mut meter(), 65536).unwrap();
        let result: Value = serde_json::from_slice(
            &exec::execute_request(&bytes, &c, "p05-test", &mut meter()).unwrap(),
        )
        .unwrap();
        assert_eq!(result["terminal"]["status"], "completed");
        assert_eq!(result["judgeResult"]["status"], "met");
        assert!(result["stats"]["fuelUsed"].as_u64().unwrap() <= 1_000_000);
        records.push(json!({"exerciseRef":{"id":c["subject"]["id"],"version":c["subject"]["version"]},"caseKey":c["subject"]["tests"][index]["caseKey"],"blockMapCount":block_map_count,"analysisStatus":analysis["status"],"terminal":result["terminal"]["status"],"judgeStatus":result["judgeResult"]["status"],"stats":result["stats"],"steps":result["trace"]["steps"].as_array().unwrap().len()}));
    }
    let path = std::env::var("P05_RUST_MAPS_REPORT")
        .unwrap_or_else(|_| ".artifacts/P0.5-09/rust-full-map-budget-current.json".into());
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::write(root.join(path), serde_json::to_string_pretty(&json!({"producer":"actual-rust-native","clock":"deterministic-native; not browser wall-time acceptance","records":records})).unwrap()+"\n").unwrap();
}

fn course(id: &str) -> Value {
    course_catalogs()
        .into_iter()
        .find(|catalog| catalog["subject"]["id"] == format!("exercise.c.{id}"))
        .unwrap()
}
fn with_body(mut catalog: Value, body: &str) -> Value {
    let prepared: Value = serde_json::from_slice(
        &exec::prepare_input(&catalog, &catalog["program"]["exampleInput"], &mut meter()).unwrap(),
    )
    .unwrap();
    let text = prepared["source"]["text"].as_str().unwrap();
    let mut source = String::from("#include <stdio.h>\nint main(void) {\n");
    for mapping in prepared["source"]["bindingMap"].as_array().unwrap() {
        let start = mapping["byteRange"]["start"].as_u64().unwrap() as usize;
        let end = mapping["byteRange"]["end"].as_u64().unwrap() as usize;
        source.push_str(&text[start..end]);
        source.push('\n');
    }
    source.push_str(body);
    source.push_str("\nreturn 0;\n}\n");
    catalog["program"]["sourceExample"] = json!(source);
    catalog
}
fn reject_decoration(id: &str, body: &str) {
    let catalog = with_body(course(id), body);
    let mut rejected = 0;
    for index in 0..catalog["subject"]["tests"].as_array().unwrap().len() {
        let result = execute_test(&catalog, index);
        assert_eq!(result["terminal"]["status"], "completed", "{id}: {result}");
        assert_eq!(
            result["judgeResult"]["checks"][1]["status"], "met",
            "{id}: adversary must really produce the fixed expected output"
        );
        if result["judgeResult"]["status"] != "met" {
            rejected += 1;
        }
    }
    assert!(
        rejected > 0,
        "{id}: decoration was incorrectly accepted by the complete fixed test set"
    );
}
#[test]
fn non_affine_cancellation_cannot_keep_dead_operators() {
    reject_decoration(
        "boolean-flags",
        r#"int first=0;if(x>=0){if(x<=10){first=1;}}int second=1;if(x==0){second=0;}int fake=x>=0&&x<=10;first=first+fake-fake;printf("%d %d\n",first,second);"#,
    );
    reject_decoration(
        "quotient-remainder",
        r#"int quotient=a/b;int remainder=a-b*quotient;int fake=a%b;printf("%d %d\n",quotient,remainder+fake-fake);"#,
    );
}
#[test]
fn literal_array_initialization_cannot_be_repaired_after_the_fact() {
    reject_decoration(
        "partial-array-init",
        r#"int values[5]={7,9};values[1]=-2;for(int i=0;i<5;i=i+1){if(i>0){printf(" ");}printf("%d",values[i]);}printf("\n");"#,
    );
}
#[test]
fn branches_and_short_circuit_must_control_the_actual_target() {
    reject_decoration(
        "sign-classification",
        r#"if(x!=42){if(x<0){}else{}printf("%d\n",(x>0)-(x<0));}else{printf("0\n");}"#,
    );
    reject_decoration(
        "guarded-division",
        r#"int safe=0;if(x!=0){safe=12/x>0;}printf("%d\n",(x!=0)&&safe);"#,
    );
    reject_decoration(
        "while-countdown",
        r#"int once=0;while(once<1){for(int i=n;i>0;i=i-1){if(i<n){printf(" ");}printf("%d",i);}once=once+1;}printf("\n");"#,
    );
}
#[test]
fn unrelated_jumps_and_different_grid_shape_cannot_decorate_a_sum() {
    reject_decoration(
        "odd-sum-until-stop",
        r#"int sum=0;for(int i=1;i<=n;i=i+1){if(i<=stop&&i%2!=0){sum=sum+i;}}if(n>stop){while(1){break;}}if(n>=2&&stop>=2){for(int j=0;j<2;j=j+1){if(j==0){continue;}}}printf("%d\n",sum);"#,
    );
    reject_decoration(
        "grid-count",
        r#"int count=0;for(int r=0;r<1;r=r+1){for(int c=0;c<rows*cols;c=c+1){count=count+1;}}printf("%d\n",count);"#,
    );
}
#[test]
fn array_conditions_must_reach_count_flag_and_access() {
    reject_decoration(
        "check-nondecreasing",
        r#"for(int i=0;i<n-1;i=i+1){if(values[i]>values[i+1]){}}int ok=1;if(n==4){ok=0;}printf("%d\n",ok);"#,
    );
    reject_decoration(
        "count-positive",
        r#"for(int i=0;i<n;i=i+1){if(values[i]>0){}}int wanted=0;if(n==4){wanted=2;}if(n==2){if(values[0]==1){wanted=2;}}if(n==30){wanted=30;}int count=0;for(int j=0;j<wanted;j=j+1){count=count+1;}printf("%d\n",count);"#,
    );
    reject_decoration(
        "safe-array-access",
        r#"if(k>=0&&k<n){}if(n==2&&k!=2){printf("%d\n",values[k]);}else{printf("invalid\n");}"#,
    );
}
#[test]
fn search_schedule_cannot_be_unrelated_to_the_printed_index() {
    reject_decoration(
        "linear-search-first",
        r#"for(int i=0;i<n;i=i+1){if(values[i]==target){}}int found=-1;for(int i=n-1;i>=0;i=i-1){if(values[i]!=target){}else{found=i;}}printf("%d\n",found);"#,
    );
    reject_decoration(
        "binary-search-first",
        r#"int left=0;int right=n-1;int found=-1;while(left<=right){int mid=left+(right-left)/2;if(values[mid]<target){left=mid+1;}else{if(values[mid]==target){found=mid;}right=mid-1;}}found=-1;if(n==1){if(target==2){found=0;}}if(n==3){if(target==-2){found=0;}if(target==3){found=2;}}if(n==5){found=1;}printf("%d\n",found);"#,
    );
}

fn all_met(id: &str, body: &str) {
    let catalog = with_body(course(id), body);
    for index in 0..catalog["subject"]["tests"].as_array().unwrap().len() {
        let result = execute_test(&catalog, index);
        assert_eq!(
            result["judgeResult"]["status"], "met",
            "{id}/{}: {}",
            catalog["subject"]["tests"][index]["caseKey"], result["judgeResult"]
        );
    }
}
#[test]
fn finite_equivalent_forms_keep_names_copies_order_and_split_output() {
    all_met(
        "printf-layout",
        r#"int first=x;int second=y;printf("x=%d",first);printf(",y=%d",second);printf("\n100%%\n");"#,
    );
    all_met(
        "wide-product",
        r#"int temporary=(1000000*(x));printf("%d",temporary);printf("\n");"#,
    );
    all_met(
        "reassign-value",
        r#"int answer=x;printf("%d",answer);printf("\n");answer=3+x;int copied=answer;printf("%d\n",copied);"#,
    );
    all_met(
        "shadowed-values",
        r#"int anyName=x;{int anyName=1+x;int copy=anyName;printf("%d\n",copy);}printf("%d\n",anyName);"#,
    );
    all_met("absolute-with-if", r#"if(0>x){x=0-x;}printf("%d\n",x);"#);
    all_met(
        "sign-classification",
        r#"if(0<x){printf("1\n");}else{if(0==x){printf("0\n");}else{printf("-1\n");}}"#,
    );
    all_met(
        "in-closed-range",
        r#"if(x < -3 || 7 < x){printf("0\n");}else{printf("1\n");}"#,
    );
    all_met("guarded-division", r#"printf("%d\n",!(0==x)&&(0<12/x));"#);
    all_met(
        "linear-search-first",
        r#"int position=-1;for(int index=0;index<n;index=index+1){if(position==-1&&target==values[index]){position=index;}}printf("%d\n",position);"#,
    );
    all_met(
        "array-extrema",
        r#"int smallest=values[0];int largest=values[0];for(int i=1;i<n;i=i+1){if(smallest>values[i]){smallest=values[i];}}for(int j=1;j<n;j=j+1){if(values[j]>largest){largest=values[j];}}printf("%d %d\n",smallest,largest);"#,
    );
}
#[test]
fn every_independent_correction_draft_fails_the_complete_submission() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let guidance: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("content/c/p05/practice-guidance-1.0.0.json")).unwrap(),
    )
    .unwrap();
    let mut records = vec![];
    for mut catalog in course_catalogs() {
        let guide = guidance["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["exerciseRef"]["id"] == catalog["subject"]["id"])
            .unwrap();
        catalog["program"]["sourceExample"] = guide["correctionSource"].clone();
        let mut passed = 0;
        let total = catalog["subject"]["tests"].as_array().unwrap().len();
        for index in 0..total {
            let result = execute_test(&catalog, index);
            passed += usize::from(result["judgeResult"]["status"] == "met");
        }
        records.push(
            json!({"exerciseRef":guide["exerciseRef"],"passedGroups":passed,"totalGroups":total}),
        );
        assert!(
            passed < total,
            "{}: correction draft unexpectedly passed",
            catalog["subject"]["id"]
        );
    }
    std::fs::create_dir_all(root.join(".artifacts/P0.5-09")).unwrap();
    let report = std::env::var("P05_RUST_CORRECTION_REPORT")
        .unwrap_or_else(|_| ".artifacts/P0.5-09/rust-correction-drafts.json".into());
    assert!(report.starts_with(".artifacts/P0.5-09/"));
    std::fs::write(
        root.join(report),
        serde_json::to_vec_pretty(&records).unwrap(),
    )
    .unwrap();
    assert_eq!(records.len(), 32);
}
#[test]
fn new_version_vector_and_zero_input_authority_are_exact() {
    let catalog = custom(
        "entry-output",
        "first-output",
        json!({}),
        "printf(\"Hello, C!\\n\");",
        "Hello, C!\n",
        None,
    );
    let good = request(&catalog, 0);
    for (pointer, value) in [
        ("/protocolVersion", json!("1.0.0")),
        ("/judgeVersion", json!("1.0.0")),
        ("/traceVersion", json!("1.1.0")),
        ("/judge/profileRef/id", json!("judge.c.fake")),
        ("/judge/profileRef/version", json!("1.0.1")),
        ("/programRef/id", json!("program.c.practice-fake")),
        ("/input/specRef/id", json!("input.c.fake")),
        (
            "/input/random",
            json!({"generatorRef":{"id":"generator.c.p0-input","version":"1.0.0"},"seed":"p05-seed"}),
        ),
    ] {
        let mut request = good.clone();
        *request.pointer_mut(pointer).unwrap() = value;
        let bytes = codec::encode(&request, &mut meter(), 65536).unwrap();
        assert!(
            exec::execute_request(&bytes, &catalog, "p05-test", &mut meter()).is_err(),
            "accepted forged {pointer}"
        );
    }
}

#[test]
fn every_complete_lecture_fence_runs_with_its_stated_result_or_diagnostic() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let content: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("content/c/p05/course-1.0.0.json")).unwrap(),
    )
    .unwrap();
    let aid: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("tests/fixtures/p05-authoring-examples.json")).unwrap(),
    )
    .unwrap();
    let mut records = vec![];
    for lesson in content["lessons"].as_array().unwrap() {
        let id = lesson["id"].as_str().unwrap();
        let author = aid["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["lessonRef"]["id"] == id)
            .unwrap();
        for (index, part) in lesson["teaching"]["explanation"]
            .as_str()
            .unwrap()
            .split("```c\n")
            .skip(1)
            .enumerate()
        {
            let code = part.split("\n```").next().unwrap();
            let mut expected_stdout = None;
            let mut expected_diagnostic = None;
            if let Some(extra) = author["extraExamples"]
                .as_array()
                .unwrap()
                .iter()
                .find(|extra| extra["code"].as_str().unwrap().trim() == code.trim())
            {
                expected_stdout = extra["stdout"].as_str();
                expected_diagnostic = extra["diagnostic"].as_str();
            } else if author["source"].as_str().unwrap().trim() == code.trim() {
                let exercise = content["exercises"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|entry| entry["id"] == author["exerciseRef"]["id"])
                    .unwrap();
                let program = content["programs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|entry| entry["id"] == exercise["programRef"]["id"])
                    .unwrap();
                expected_stdout = exercise["tests"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|test| test["input"] == program["exampleInput"])
                    .and_then(|test| test["expectedStdout"].as_str());
                if expected_stdout.is_none() {
                    expected_stdout = match id {
                        "lesson.c.bubble-sort" | "lesson.c.selection-sort" => {
                            assert_eq!(
                                program["exampleInput"],
                                json!({"values":[7,-3,0,5,-3,2,9]})
                            );
                            Some("-3 -3 0 2 5 7 9\n")
                        }
                        "lesson.c.binary-search-first" => {
                            assert_eq!(
                                program["exampleInput"],
                                json!({"values":[-2,0,0,4,8],"target":0})
                            );
                            Some("1\n")
                        }
                        _ => None,
                    };
                }
                assert!(
                    expected_stdout.is_some(),
                    "missing independent configured example output {id}"
                );
            } else {
                match (id, index) {
                    ("lesson.c.variables-output", 0) => expected_stdout = Some("9\n7\n"),
                    ("lesson.c.variables-output", 1) => {
                        expected_diagnostic = Some("E_UNINITIALIZED")
                    }
                    ("lesson.c.expressions", 0) => expected_stdout = Some("17\n20\n-2\n-1\n1\n"),
                    ("lesson.c.expressions", 1) => expected_stdout = Some("0\n1\n"),
                    ("lesson.c.expressions", 2) => expected_diagnostic = Some("E_DIV_ZERO"),
                    ("lesson.c.expressions", 3) => expected_diagnostic = Some("E_INT_OVERFLOW"),
                    ("lesson.c.conditions", 0) => expected_stdout = Some("1\n"),
                    ("lesson.c.loops", 0) => expected_stdout = Some("4\n"),
                    ("lesson.c.array-update", 0) => expected_stdout = Some("0\n"),
                    ("lesson.c.array-update", 1) => expected_diagnostic = Some("E_INDEX_BOUNDS"),
                    ("lesson.c.array-sum", 0) => expected_stdout = Some("0\n"),
                    _ => panic!("unreviewed lecture fence {id}/{index}"),
                }
            }
            let result = c_viz_core::run::run(code, &mut meter());
            let stdout = result
                .trace
                .as_ref()
                .map(|trace| {
                    trace
                        .steps
                        .iter()
                        .flat_map(|step| step.changes.iter())
                        .filter_map(|change| {
                            if change["op"] == "output" {
                                change["append"].as_str()
                            } else {
                                None
                            }
                        })
                        .collect::<String>()
                })
                .unwrap_or_default();
            let diagnostics = serde_json::to_value(&result.diagnostics).unwrap();
            if let Some(expected) = expected_diagnostic {
                assert!(
                    diagnostics
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|d| d["code"] == expected),
                    "{id}/{index}: {diagnostics}"
                );
                assert!(stdout.is_empty());
            } else {
                assert_eq!(
                    result.status,
                    c_viz_core::run::RunStatus::Completed,
                    "{id}/{index}: {diagnostics}"
                );
                assert_eq!(stdout, expected_stdout.unwrap(), "{id}/{index}");
            }
            records.push(json!({"lessonRef":{"id":id,"version":lesson["version"]},"fenceIndex":index,"status":result.status,"expectedStdout":expected_stdout,"expectedDiagnostic":expected_diagnostic,"actualStdout":stdout,"diagnostics":diagnostics}));
        }
    }
    assert_eq!(records.len(), 46);
    std::fs::create_dir_all(root.join(".artifacts/P0.5-09")).unwrap();
    let report = std::env::var("P05_RUST_LECTURE_REPORT")
        .unwrap_or_else(|_| ".artifacts/P0.5-09/rust-lecture-examples.json".into());
    assert!(report.starts_with(".artifacts/P0.5-09/"));
    std::fs::write(
        root.join(report),
        serde_json::to_vec_pretty(&records).unwrap(),
    )
    .unwrap();
}
