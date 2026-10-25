//! 09.3 real AST/STEP teaching evidence, including numerically correct cheats.
use c_viz_core::{
    ast::NodeData,
    budget::{Limits, Meter},
    codec, exec, semantic, trace,
};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut m = Meter::new();
    m.set_clock(1000, Box::new(|| 0));
    m
}
fn catalog(index: usize) -> Value {
    let p: Value =
        serde_json::from_str(include_str!("../../../content/c/p0/course-1.0.1.json")).unwrap();
    let s = &p["exercises"][index];
    let find = |table: &str, id: &Value| {
        p[table]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == *id)
            .unwrap()
            .clone()
    };
    let program = find("programs", &s["programRef"]["id"]);
    json!({"packageRef":{"id":p["packageId"],"version":p["packageVersion"]},"subject":s,"inputSpec":find("inputSpecs",&program["inputRef"]["id"]),"program":program,"judgeProfile":find("judgeProfiles",&s["judgeRef"]["id"])})
}
fn request(c: &Value, index: usize, body: Option<&str>) -> Value {
    let t = &c["subject"]["tests"][index];
    let mut source: Value = serde_json::from_slice::<Value>(
        &exec::prepare_input(c, &t["input"], &mut meter()).unwrap(),
    )
    .unwrap()["source"]
        .clone();
    if let Some(body) = body {
        let end = source["bindingMap"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["byteRange"]["end"].as_u64().unwrap() as usize)
            .max()
            .unwrap();
        let text = format!("{}\n{body}\n}}\n", &source["text"].as_str().unwrap()[..end]);
        let controls:Vec<_>=semantic::analyze(&text).unwrap().parsed.program.nodes.iter().filter(|n|matches!(n.data,NodeData::If{..}|NodeData::While{..}|NodeData::For{..})).enumerate().map(|(i,n)|json!({"blockId":format!("answer.control-{}",i+1),"byteRange":n.byte_range})).collect();
        source["text"] = json!(text);
        source["blockMap"] = json!(controls);
    }
    let mut judge = json!({"profileRef":c["subject"]["judgeRef"],"rule":c["judgeProfile"]["rule"],"expectedStdout":t["expectedStdout"],"expectedExitCode":t["expectedExitCode"]});
    if let Some(a) = t.get("expectedArray") {
        judge["expectedArray"] = a.clone();
    }
    json!({"kind":"execute","protocolVersion":"1.0.0","traceVersion":"1.0.0","diagnosticVersion":"1.0.0","judgeVersion":"1.0.0","encodingVersion":"1.0.0","identity":{"contextId":"judge-context","contextRevision":1,"submissionId":"judge-submission","runId":"judge-run","sourceRevision":1,"testCaseKey":t["caseKey"]},"mode":"exercise-test","packageRef":c["packageRef"],"languageRef":{"id":"lang.c","version":"1.0.0"},"subsetRef":{"id":"subset.c.p0","version":"1.0.0"},"programRef":c["subject"]["programRef"],"subjectRef":{"id":c["subject"]["id"],"version":c["subject"]["version"]},"learningRevision":c["subject"]["learningRevision"],"engineRef":{"id":"engine.c.p0","version":"1.0.0","buildId":"judge-test"},"source":source,"input":{"specRef":c["program"]["inputRef"],"values":t["input"],"random":null},"judge":judge,"budgetRef":{"id":"budget.p0","version":"1.0.0"},"remainingMs":1000})
}
fn execute(c: &Value, r: &Value, m: &mut Meter) -> Value {
    let b = codec::encode(r, &mut meter(), 65536).unwrap();
    let result: Value =
        serde_json::from_slice(&exec::execute_request(&b, c, "judge-test", m).unwrap()).unwrap();
    if !result["stats"].is_null() {
        assert_eq!(result["stats"]["fuelUsed"], json!(m.used()));
    }
    result
}
fn result(exercise: usize, test: usize, body: &str) -> Value {
    let c = catalog(exercise);
    execute(&c, &request(&c, test, Some(body)), &mut meter())
}
fn status(r: &Value, expected: &str) {
    assert_eq!(r["terminal"]["status"], "completed", "{r}");
    assert_eq!(r["judgeResult"]["status"], expected, "{}", r["judgeResult"]);
    assert!(r["terminal"]["diagnostics"].as_array().unwrap().is_empty());
}
fn target_unmet(r: &Value) {
    status(r, "unmet");
    assert!(
        r["judgeResult"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["key"] == "teaching-target" && x["status"] == "unmet")
    );
}

#[test]
fn frozen_candidate_all_twenty_four_references_met_with_reversible_real_traces() {
    let mut count = 0;
    for i in 0..6 {
        let c = catalog(i);
        for j in 0..c["subject"]["tests"].as_array().unwrap().len() {
            let r = request(&c, j, None);
            let v = execute(&c, &r, &mut meter());
            status(&v, "met");
            let t: trace::Trace = serde_json::from_value(v["trace"].clone()).unwrap();
            assert_eq!(
                trace::restore(&t, t.steps.len()).unwrap()["output"],
                r["judge"]["expectedStdout"]
            );
            assert_eq!(trace::restore(&t, 0).unwrap(), t.initial_state);
            count += 1;
        }
    }
    assert_eq!(count, 24);
}

#[test]
fn input_copies_and_add_zero_remain_effective_but_cancelled_dead_or_overwritten_reads_do_not() {
    for j in 0..3 {
        status(
            &result(0, j, "int copy = x + 0; printf(\"%d\\n\", copy); return 0;"),
            "met",
        );
    }
    for body in [
        "int copy=x; printf(\"%d\\n\", 0); return 0;",
        "printf(\"%d\\n\", x*0); return 0;",
        "printf(\"%d\\n\", x-x); return 0;",
        "int copy=x; copy=0; printf(\"%d\\n\",copy); return 0;",
    ] {
        target_unmet(&result(0, 1, body));
    }
}

#[test]
fn multiplication_allows_operand_order_and_negative_constant_subtraction() {
    for j in 0..3 {
        for body in [
            "int t=x*2; int answer=t- -3; printf(\"%d\\n\",answer); return 0;",
            "int t=2*x; int answer=3+t; printf(\"%d\\n\",answer); return 0;",
        ] {
            status(&result(1, j, body), "met");
        }
    }
    for body in [
        "int a=2*x+3; a=3; printf(\"%d\\n\",a); return 0;",
        "int a=2*x+3; printf(\"%d\\n\",a-a+3); return 0;",
        "printf(\"%d\\n\",x*0+3); return 0;",
    ] {
        target_unmet(&result(1, 1, body));
    }
}

#[test]
fn branch_requires_effective_input_condition_and_output_path() {
    for j in 0..3 {
        status(
            &result(
                2,
                j,
                "int answer; if(x>=0){answer=1;}else{answer=0;} printf(\"%d\\n\",answer); return 0;",
            ),
            "met",
        );
    }
    for body in [
        "if(x-x>=0){printf(\"1\\n\");}else{printf(\"0\\n\");} return 0;",
        "if(x>=x){printf(\"1\\n\");}else{printf(\"0\\n\");} return 0;",
        "if(x>=0 || 1){printf(\"1\\n\");}else{printf(\"0\\n\");} return 0;",
        "if(x*0>=0){printf(\"1\\n\");}else{printf(\"0\\n\");} return 0;",
        "if(x>=0){}else{} printf(\"1\\n\"); return 0;",
        "int answer=1; if(x>=0){answer=0;}else{answer=0;} answer=1; printf(\"%d\\n\",answer); return 0;",
    ] {
        target_unmet(&result(2, 0, body));
    }
}

const LOOPS: &str = "int s=0; int i=n; while(i>=1){s=i+s; i=i-1;} int t=0; for(int j=n;j>=1;j=j-1){int old=t+0;t=j+old;} printf(\"%d\\n%d\\n\",s,t); return 0;";
#[test]
fn reverse_loops_and_transparent_accumulator_copies_are_supported() {
    for j in 0..4 {
        status(&result(3, j, LOOPS), "met");
    }
}

#[test]
fn decorated_loops_formula_overwrites_zero_additions_and_partial_targets_fail() {
    let formula = "n*(n+1)/2";
    for body in [
        format!(
            "int s=0;int i=1;while(i<=n){{s=s+i;i=i+1;}}int t=0;for(int j=1;j<=n;j=j+1){{t=t+j;}}s=s*0+{formula};printf(\"%d\\n%d\\n\",s,t);return 0;"
        ),
        format!(
            "int s=0;int i=1;while(i<=n){{s=s+i;i=i+1;}}int t=0;for(int j=1;j<=n;j=j+1){{t=t+j;}}s=s-s+{formula};printf(\"%d\\n%d\\n\",s,t);return 0;"
        ),
        format!(
            "int s=0;int i=1;while(i<=n){{s=s+i;i=i+1;}}int t=0;for(int j=1;j<=n;j=j+1){{t=t+j;}}t={formula};printf(\"%d\\n%d\\n\",s,t);return 0;"
        ),
        format!(
            "int i=1;while(i<=n){{i=i+1;}}for(int j=1;j<=n;j=j+1){{}}printf(\"%d\\n%d\\n\",{formula},{formula});return 0;"
        ),
    ] {
        target_unmet(&result(3, 2, &body));
    }
    target_unmet(&result(
        3,
        0,
        "int s=0;int i=1;while(i<=n){s=s+i*0;i=i+1;}int t=0;for(int j=1;j<=n;j=j+1){t=t+j*0;}printf(\"%d\\n%d\\n\",s,t);return 0;",
    ));
}

#[test]
fn array_increment_requires_real_correct_cell_write_and_its_output() {
    for j in 0..5 {
        status(
            &result(
                4,
                j,
                "int original=values[k];values[k]=1+original;int after=values[k]+0;printf(\"%d\\n\",after);return 0;",
            ),
            "met",
        );
    }
    target_unmet(&result(
        4,
        0,
        "int old=values[k];printf(\"%d\\n\",old+1);return 0;",
    ));
    target_unmet(&result(
        4,
        1,
        "values[0]=values[0]+1;printf(\"%d\\n\",values[k]+1);return 0;",
    ));
    target_unmet(&result(
        4,
        0,
        "int old=values[k]; values[k]=values[k]+1;printf(\"%d\\n\",old+1);return 0;",
    ));
    let r = result(
        4,
        0,
        "values[k]=values[k]+1;printf(\"%d\\n\",values[k]);return 0;",
    );
    let o = &r["judgeResult"]["observations"];
    assert_eq!(o.as_array().unwrap().len(), 1);
    assert_eq!(
        o[0]["values"],
        catalog(4)["subject"]["tests"][0]["expectedArray"]
    );
}

#[test]
fn reverse_array_sum_keeps_each_zero_valued_input_symbol_through_copies() {
    for j in 0..6 {
        status(
            &result(
                5,
                j,
                "int s=0;for(int i=n-1;i>=0;i=i-1){int item=values[i]+0;s=item+s;}printf(\"%d\\n\",s);return 0;",
            ),
            "met",
        );
    }
}

#[test]
fn array_sum_rejects_cancelled_overwritten_missing_elements_and_empty_placeholder_read() {
    for body in [
        "int s=0;for(int i=0;i<n;i=i+1){s=s+values[i]*0;}printf(\"%d\\n\",s);return 0;",
        "int s=0;for(int i=0;i<n;i=i+1){s=s+values[i]-values[i];}printf(\"%d\\n\",s);return 0;",
        "int s=0;for(int i=0;i<n;i=i+1){s=s+values[i];}s=0;printf(\"%d\\n\",s);return 0;",
        "int s=0;for(int i=1;i<n;i=i+1){s=s+values[i];}printf(\"%d\\n\",s);return 0;",
    ] {
        target_unmet(&result(5, 3, body));
    }
    let r = result(
        5,
        1,
        "int ignored=values[0];int s=0;for(int i=0;i<n;i=i+1){s=s+values[i];}printf(\"%d\\n\",s);return 0;",
    );
    assert_ne!(r["judgeResult"]["status"], "met");
    for body in [
        "int s=0;for(int i=0;i<n;i=i+1){s=s+values[i]*0;}printf(\"%d\\n\",s);return 0;",
        "int s=0;for(int i=0;i<n;i=i+1){s=s+values[i]-values[i+0];}printf(\"%d\\n\",s);return 0;",
    ] {
        target_unmet(&result(5, 1, body));
    }
}

#[test]
fn control_sites_are_stable_across_inputs_and_parent_or_ambiguous_ranges_cannot_supply_coverage() {
    let c = catalog(2);
    let mut sites = Vec::new();
    for j in 0..3 {
        let v = execute(&c, &request(&c, j, None), &mut meter());
        status(&v, "met");
        sites.push(v["judgeResult"]["coverage"][0]["siteKey"].clone());
    }
    assert!(sites.iter().all(|s| s == &sites[0]));
    for ambiguous in [false, true] {
        let mut r = request(&c, 0, None);
        let text_len = r["source"]["text"].as_str().unwrap().len();
        if ambiguous {
            let mut duplicate = r["source"]["blockMap"][0].clone();
            duplicate["blockId"] = json!("second-site");
            r["source"]["blockMap"]
                .as_array_mut()
                .unwrap()
                .push(duplicate);
        } else {
            r["source"]["blockMap"] =
                json!([{"blockId":"parent","byteRange":{"start":0,"end":text_len}}]);
        }
        let v = execute(&c, &r, &mut meter());
        target_unmet(&v);
        assert!(
            v["judgeResult"]["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["diagnosticCodes"] == json!(["J_BINDING_MISMATCH"]))
        );
    }
}

#[test]
fn nonzero_exit_program_errors_and_resource_exhaustion_never_report_met() {
    status(&result(0, 0, "printf(\"%d\\n\",x);return 1;"), "unmet");
    let v = result(0, 0, "printf(\"%d\\n\",x);int bad=1/0;return 0;");
    assert_eq!(v["terminal"]["status"], "program-error");
    assert_eq!(v["judgeResult"]["status"], "not-evaluated");
    let c = catalog(0);
    let r = request(&c, 0, Some("while(1){}return 0;"));
    let mut m = Meter::with_limits(Limits {
        fuel: 50000,
        ..Default::default()
    });
    m.set_clock(1000, Box::new(|| 0));
    let v = execute(&c, &r, &mut m);
    assert_eq!(v["terminal"]["status"], "resource-limit");
    assert_eq!(v["judgeResult"]["status"], "not-evaluated");
    let mut m = meter();
    m.set_cancel(Box::new(|| true));
    assert_eq!(
        exec::execute_request(
            &codec::encode(&r, &mut meter(), 65536).unwrap(),
            &c,
            "judge-test",
            &mut m
        ),
        Err(exec::ExecFailure("E_CANCELLED"))
    );
}

#[test]
fn missing_input_bindings_and_changed_expected_answers_never_reach_teaching_success() {
    let c = catalog(0);
    let mut r = request(&c, 0, None);
    r["source"]["bindingMap"] = json!([]);
    let v = execute(&c, &r, &mut meter());
    assert_eq!(v["terminal"]["status"], "rejected");
    assert_eq!(v["judgeResult"]["status"], "not-evaluated");
    let mut r = request(&c, 0, None);
    r["judge"]["expectedStdout"] = json!("forged");
    let v = execute(&c, &r, &mut meter());
    assert_eq!(
        v["terminal"]["diagnostics"][0]["code"],
        "E_CONTENT_MISMATCH"
    );
    assert_eq!(v["judgeResult"]["status"], "not-evaluated");
}

#[test]
fn teaching_graph_fuel_exhaustion_is_metered_and_never_leaves_a_met_result() {
    let c = catalog(0);
    let r = request(&c, 0, None);
    let bytes = codec::encode(&r, &mut meter(), 65536).unwrap();
    let success = execute(&c, &r, &mut meter());
    let ceiling = success["stats"]["fuelUsed"].as_u64().unwrap() as usize;
    let mut graph_failure = false;
    // The mandatory final-result reserve can exceed the bytes ultimately used;
    // include that reserved margin when locating the pre-finalization cutoff.
    for fuel in (4096..ceiling + 8192).step_by(31) {
        let mut m = Meter::with_limits(Limits {
            fuel,
            ..Default::default()
        });
        m.set_clock(1000, Box::new(|| 0));
        if let Ok(bytes) = exec::execute_request(&bytes, &c, "judge-test", &mut m) {
            let v: Value = serde_json::from_slice(&bytes).unwrap();
            if v["terminal"]["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["stage"] == "judge" && d["code"] == "E_FUEL_LIMIT")
            {
                graph_failure = true;
                assert_eq!(v["terminal"]["status"], "resource-limit");
                assert_eq!(v["judgeResult"]["status"], "not-evaluated");
                assert_eq!(v["stats"]["fuelUsed"], json!(m.used()));
            }
        }
    }
    assert!(
        graph_failure,
        "a charged teaching graph must encounter its own bounded fuel cutoff"
    );
}

#[test]
fn large_symbolic_coefficients_at_zero_input_are_conservative_without_host_integer_panics() {
    for operation in ["a=a*999;", "a=999*a;", "a=a*2;"] {
        let body = format!(
            "int a=x;{}a=-a;printf(\"%d\\n\",a);return 0;",
            operation.repeat(96)
        );
        let r = result(0, 1, &body);
        target_unmet(&r);
        assert!(
            r["judgeResult"]["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["key"] == "stdout-exact" && c["status"] == "met")
        );
    }
    let r = result(
        0,
        1,
        "int a=x; a=((((((((x*999)*999)*999)*999)*999)*999)*999)*999);printf(\"%d\\n\",a);return 0;",
    );
    target_unmet(&r);
}
