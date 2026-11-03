use c_viz_c6::{
    api,
    budget::{Limits, Meter},
    check, codec,
    runtime::Runtime,
    state::Totals,
    syntax,
};
use serde_json::{Value, json};

fn request(source: &str, reference: &Value) -> Value {
    json!({"execVersion":"1.5.0","dslVersion":"1.4.0","diagnosticVersion":"1.4.0","integerEncoding":"1.0.0","language":"c","engineId":"engine.rust.c6","engineVersion":"0.1.0","runId":"judge-validation","sourceRevision":"revision-1","sourceSha256":api::source_hash(source),"source":source,"judgeVersion":"2.0.0","profileRef":reference,"packageRef":{"id":"content.c.primer6","version":"1.0.0"}})
}
fn send(source: &str, reference: &Value) -> Result<Value, &'static str> {
    let mut meter = Meter::new();
    let input = codec::encode(&request(source, reference), &mut meter, 65536).unwrap();
    let output = api::execute(&input, &"a".repeat(64), &mut meter)?;
    let value: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(value["aggregate"]["resultBytes"], output.len());
    assert_eq!(value["aggregate"]["fuel"], meter.used());
    let steps: usize = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["packet"]["trace"]["steps"].as_array().unwrap().len())
        .sum();
    assert_eq!(value["aggregate"]["steps"], steps);
    Ok(value)
}
fn programs() -> Value {
    serde_json::from_str(include_str!(
        "../../../shared/fixtures/c6/21.3/judge-programs.json"
    ))
    .unwrap()
}
#[test]
fn all_44_profiles_accept_two_distinct_real_programs() {
    let fixtures = programs();
    let rows = fixtures["programs"].as_array().unwrap();
    assert_eq!(rows.len(), 44);
    let mut failures = vec![];
    for row in rows {
        for variant in ["primary", "alternative"] {
            let source = row[variant].as_str().unwrap();
            let result = send(source, &row["profileRef"]);
            match result {
                Ok(ref result) if result["status"] == "passed" => {},
                Ok(result) => failures.push(format!("{} {variant}: {}",row["profileRef"]["id"],serde_json::to_string(&json!({"status":result["status"],"cases":result["cases"].as_array().unwrap().iter().map(|c|json!({"case":c["caseKey"],"out":c["stdoutMatches"],"return":c["returnMatches"],"obs":c["observationMatches"],"terminal":c["packet"]["terminal"],"proofs":c["observations"]})).collect::<Vec<_>>()})).unwrap())),
                Err(code) => failures.push(format!("{} {variant}: {code}",row["profileRef"]["id"])),
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
#[test]
fn dead_goal_code_and_constant_output_do_not_pass_any_profile() {
    for row in programs()["programs"].as_array().unwrap() {
        let source = row["primary"]
            .as_str()
            .unwrap()
            .replace("int main(void)", "int never_main(void)");
        let source = format!("{source}\nint main(void){{printf(\"0\\n\");return 0;}}");
        let result = send(&source, &row["profileRef"]).unwrap();
        assert_eq!(result["status"], "failed", "{}", row["profileRef"]);
        assert!(
            result["cases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["observationMatches"] == false)
        );
    }
}

#[test]
fn correct_stdout_without_the_required_concept_fails_all_44_profiles() {
    let mut failures = vec![];
    for row in programs()["programs"].as_array().unwrap() {
        // Keep the complete correct implementation in an uncalled function. Text/AST presence is insufficient.
        let mut dead = row["primary"]
            .as_str()
            .unwrap()
            .replace("int main(void)", "int never_main(void)");
        // Avoid a duplicate helper in the independent bypass (which uses no primary helper names).
        dead.push_str(row["bypass"].as_str().unwrap());
        let result = send(&dead, &row["profileRef"]);
        match result {
            Ok(result) if result["status"] == "failed" && result["cases"].as_array().unwrap().iter().all(|c| c["stdoutMatches"] == true && c["returnMatches"] == true) => {},
            other => failures.push(format!("{}: {:?}",row["profileRef"]["id"],other.map(|v|json!({"status":v["status"],"cases":v["cases"].as_array().unwrap().iter().map(|c|json!({"stdout":c["stdoutMatches"],"return":c["returnMatches"],"obs":c["observationMatches"],"terminal":c["packet"]["terminal"]})).collect::<Vec<_>>()})))),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn neutral_and_unentered_operations_do_not_launder_a_goal() {
    let rows = programs();
    for (node, from, to) in [
        ("6.6", "printf", "y+=0;printf"),
        ("5.5.1", "printf", "y=(int)y;printf"),
        ("7.5", "printf", "y=x?y:y;printf"),
        ("6.5.1", "printf", "for(int i=0;i<0;i++){total+=i;}printf"),
    ] {
        let id = format!("judge.c6.s{node}");
        let row = rows["programs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["profileRef"]["id"] == id)
            .unwrap();
        let source = row["bypass"].as_str().unwrap().replace(from, to);
        let result = send(&source, &row["profileRef"]).unwrap();
        assert!(
            result["cases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["stdoutMatches"] == true)
        );
        assert_eq!(
            result["status"], "failed",
            "{node}: neutral operation was counted"
        );
    }
}

#[test]
fn prototype_goal_requires_parameter_to_affect_the_returned_affine_value() {
    let source = "#include <stdio.h>\nint f(int);int main(void){int x;scanf(\"%d\",&x);printf(\"%d\\n\",6*x+f(x));return 0;}int f(int x){return 1;}";
    let result = send(source, &json!({"id":"judge.c6.s9.2.4","version":"1.0.0"})).unwrap();
    assert!(
        result["cases"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["stdoutMatches"] == true)
    );
    assert_eq!(result["status"], "failed");
}

#[test]
fn changing_only_case_four_never_passes_any_of_the_44_profiles() {
    for row in programs()["programs"].as_array().unwrap() {
        let result = send(row["wrongCase4"].as_str().unwrap(), &row["profileRef"]).unwrap();
        assert_eq!(result["status"], "failed", "{}", row["profileRef"]);
        let cases = result["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 4);
        assert!(
            cases[..3].iter().all(|c| c["stdoutMatches"] == true),
            "{}",
            row["profileRef"]
        );
        assert_eq!(cases[3]["stdoutMatches"], false, "{}", row["profileRef"]);
    }
}

#[test]
fn all_44_reject_illegal_code_and_keep_real_limited_prefixes() {
    for row in programs()["programs"].as_array().unwrap() {
        let dead = row["primary"]
            .as_str()
            .unwrap()
            .replace("int main(void)", "int never_main(void)");
        assert_eq!(
            send(
                &format!("{dead}int main(void){{return missing;}}"),
                &row["profileRef"]
            )
            .unwrap_err(),
            "E_UNDECLARED"
        );
        let source = format!("{dead}int main(void){{while(1){{}}}}");
        let bytes = serde_json::to_vec(&request(&source, &row["profileRef"])).unwrap();
        // Native JSON text is canonicalized through the actual integer codec before the API boundary.
        let parsed: Value = serde_json::from_slice(&bytes).unwrap();
        let mut meter = Meter::with_limits(Limits {
            steps: 40,
            ..Limits::default()
        });
        let bytes = codec::encode(&parsed, &mut meter, 65536).unwrap();
        let output = api::execute(&bytes, &"a".repeat(64), &mut meter).unwrap();
        let result: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["status"], "incomplete");
        assert_eq!(result["cases"].as_array().unwrap().len(), 1);
        assert_eq!(result["aggregate"]["steps"], 40);
        assert_eq!(
            result["cases"][0]["packet"]["terminal"]["code"],
            "E_STEP_LIMIT"
        );
        assert_eq!(
            result["cases"][0]["packet"]["trace"]["completeness"],
            "prefix"
        );
    }
}

#[test]
fn each_profile_can_be_cancelled_during_its_actual_c_execution() {
    let catalog: Value =
        serde_json::from_str(include_str!("../resources/judges-1.0.0.json")).unwrap();
    for row in programs()["programs"].as_array().unwrap() {
        let p = catalog["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["ref"] == row["profileRef"])
            .unwrap();
        let source = row["primary"].as_str().unwrap();
        let mut cutoff = usize::MAX;
        for cancel in [false, true] {
            let mut meter = Meter::new();
            let checked =
                check::check(syntax::parse(source, &mut meter).unwrap(), &mut meter).unwrap();
            let calls = std::rc::Rc::new(std::cell::Cell::new(0));
            let count = calls.clone();
            let limit = cutoff;
            meter.set_cancel(Box::new(move || {
                let n = count.get() + 1;
                count.set(n);
                n >= limit
            }));
            let mut totals = Totals::default();
            let mut runtime = Runtime::new(
                &checked,
                p["testDomain"][3]["stdin"].as_str().unwrap().as_bytes(),
                Default::default(),
                0,
                &mut totals,
                &mut meter,
            )
            .unwrap();
            let result = runtime.run();
            if cancel {
                assert_eq!(
                    result.unwrap_err().code,
                    "E_CANCELLED",
                    "{}",
                    row["profileRef"]
                );
                assert!(runtime.journal.steps.len() >= 3);
                assert!(calls.get() >= cutoff);
            } else {
                result.unwrap();
                cutoff = calls.get() - 2;
                assert!(cutoff > 8);
            }
        }
    }
}

#[test]
fn four_fresh_states_share_output_quota_instead_of_four_independent_limits() {
    let reference = json!({"id":"judge.c6.s2.1","version":"1.0.0"});
    for (text, expected, status) in [("12345", 20, "failed"), ("123456", 18, "incomplete")] {
        let source = format!("#include <stdio.h>\nint main(){{printf(\"{text}\");return 0;}}");
        let mut meter = Meter::with_limits(Limits {
            output_bytes: 20,
            ..Limits::default()
        });
        let bytes = codec::encode(&request(&source, &reference), &mut meter, 65536).unwrap();
        let output = api::execute(&bytes, &"a".repeat(64), &mut meter).unwrap();
        let result: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["status"], status);
        assert_eq!(result["aggregate"]["outputBytes"], expected);
        assert!(
            result["cases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["packet"]["trace"]["initialState"]["output"] == "")
        );
    }
}

#[test]
fn formal_16k_output_budget_is_one_total_for_four_real_case_traces() {
    for extra in [false, true] {
        let format = "%16d".repeat(8);
        let source = format!(
            "#include <stdio.h>\nint main(){{for(int i=0;i<32;i++)printf(\"{format}\",0,0,0,0,0,0,0,0);{}return 0;}}",
            if extra { "putchar(33);" } else { "" }
        );
        let result = send(&source, &json!({"id":"judge.c6.s2.1","version":"1.0.0"})).unwrap();
        assert_eq!(result["cases"].as_array().unwrap().len(), 4);
        if extra {
            assert_eq!(result["status"], "incomplete");
            assert_eq!(result["aggregate"]["outputBytes"], 16259);
            assert_eq!(
                result["cases"][3]["packet"]["terminal"]["code"],
                "E_OUTPUT_LIMIT"
            );
        } else {
            assert_eq!(result["status"], "failed");
            assert_eq!(result["aggregate"]["outputBytes"], 16384);
            assert!(
                result["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|c| c["packet"]["terminal"]["status"] == "completed")
            );
        }
    }
}

#[test]
fn noop_target_stores_and_wrong_sizeof_types_are_not_the_specified_learning_operation() {
    let mut variants=vec![
        ("9.7.1","#include <stdio.h>\nint main(){int x;int y;scanf(\"%d\",&x);scanf(\"%d\",&y);int *a=&x;int *b=&y;*a=*a;*b=*b;printf(\"%d %d\\n\",y,x);return 0;}".to_string()),
        ("9.7.3","#include <stdio.h>\nvoid touch(int *a,int *b){*a=*a;*b=*b;}int main(){int x;int y;scanf(\"%d\",&x);scanf(\"%d\",&y);touch(&x,&y);printf(\"%d %d\\n\",y,x);return 0;}".to_string()),
        ("10.5","#include <stdio.h>\nint main(){int v[2]={0};scanf(\"%d\",&v[0]);scanf(\"%d\",&v[1]);int *p=v;int *q=p+1;*p=*p;*q=*q;printf(\"%d %d\\n\",v[1],v[0]);return 0;}".to_string()),
        ("12.1.6","#include <stdio.h>\nint tick(){static int n=0;n+=0;return n+3;}int main(){int n;scanf(\"%d\",&n);int total=0;for(int i=0;i<n;i++)total+=tick();printf(\"%d\\n\",total);return 0;}".to_string()),
    ];
    for (node, k) in [("10.1.3", 3), ("10.1.4", 4)] {
        variants.push((node,format!("#include <stdio.h>\nint main(){{int n;int i;scanf(\"%d\",&n);scanf(\"%d\",&i);int a[30]={{0}};for(int j=0;j<n;j++)scanf(\"%d\",&a[j]);if(i<0||i>=n)printf(\"-1\\n\");else{{a[i]=a[i];printf(\"%d\\n\",a[i]+{k});}}return 0;}}")));
    }
    for node in ["3.4.9", "14.12"] {
        variants.push((node,"#include <stdio.h>\ntypedef char A;typedef int B;typedef double C;typedef int *D;int main(){int x;scanf(\"%d\",&x);unsigned int unit=sizeof(A);unsigned int y=unit;if(x==1||x==3)y=unit+3u;if(x==2)y=unit+7u;printf(\"%u\\n\",y);return 0;}".into()));
    }
    for (node, k, loop_body) in [
        ("5.3.3", 4, "int i=1;while(i<=n){total+=0;i++;}"),
        ("5.3.4", 5, "int i=n;while(i>0){total+=0;i--;}"),
        ("6.5.1", 2, "for(int i=1;i<=n;i++){total+=0;}"),
        ("6.8", 6, "if(n>0){int i=1;do{total+=0;i++;}while(i<=n);}"),
    ] {
        variants.push((node,format!("#include <stdio.h>\nint main(){{int n;scanf(\"%d\",&n);int total=n*(n+1)/2;{loop_body}printf(\"%d\\n\",total*{k});return 0;}}")));
    }
    let mut failures = vec![];
    for (node, source) in variants {
        let result = send(
            &source,
            &json!({"id":format!("judge.c6.s{node}"),"version":"1.0.0"}),
        )
        .unwrap();
        assert!(
            result["cases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["stdoutMatches"] == true),
            "{node}"
        );
        if result["status"] != "failed" {
            failures.push(node)
        }
    }
    assert!(
        failures.is_empty(),
        "Goals accepted harmless or wrong-type operations: {failures:?}"
    );
}
