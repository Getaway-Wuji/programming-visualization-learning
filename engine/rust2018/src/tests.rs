use crate::{
    budget::{Limits, Meter},
    execute,
};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    meter
}
fn request(source: &str, input: &str) -> Value {
    json!({"version":"1.0.0","language":"rust","edition":"2018","runId":"native-test","sourceRevision":"native-revision","source":source,"operation":"execute","input":input})
}
fn run(request: Value) -> Value {
    let bytes = execute(
        &serde_json::to_vec(&request).unwrap(),
        &"a".repeat(64),
        &mut meter(),
    )
    .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        bytes,
        serde_json::to_vec(&value).unwrap(),
        "Response keys must remain canonical through every nested typed record"
    );
    let selected_bytes = trace_bytes(&value);
    if request["operation"] == "execute" {
        assert_eq!(value["usage"]["resultBytes"], selected_bytes);
    } else {
        assert!(value["usage"]["resultBytes"].as_u64().unwrap() >= selected_bytes as u64);
    }
    value
}

fn trace_bytes(response: &Value) -> usize {
    let trace = &response["replay"]["trace"];
    if trace.is_null() {
        return 0;
    }
    trace["steps"]
        .as_array()
        .unwrap()
        .iter()
        .chain(trace["checkpoints"].as_array().unwrap().iter().skip(1))
        .map(|value| serde_json::to_vec(value).unwrap().len())
        .sum()
}
fn trace_output(response: &Value) -> String {
    let trace = &response["replay"]["trace"];
    if trace.is_null() {
        return String::new();
    }
    let mut state = trace["initialState"].clone();
    validate_ownership(&state);
    let checkpoints = trace["checkpoints"].as_array().unwrap();
    assert_eq!(checkpoints[0]["cursor"], 0);
    assert_eq!(checkpoints[0]["state"], state);
    for step in trace["steps"].as_array().unwrap() {
        apply(&mut state, step, true);
        validate_ownership(&state);
        assert_eq!(state["control"]["nodeId"], step["nodeId"]);
        if step["seq"].as_u64().unwrap().is_multiple_of(128) {
            let checkpoint = &checkpoints[step["seq"].as_u64().unwrap() as usize / 128];
            assert_eq!(checkpoint["cursor"], step["seq"]);
            assert_eq!(checkpoint["state"], state);
        }
    }
    assert_eq!(
        checkpoints.len(),
        trace["steps"].as_array().unwrap().len() / 128 + 1
    );
    let output = state["output"].as_str().unwrap().to_owned();
    for step in trace["steps"].as_array().unwrap().iter().rev() {
        apply(&mut state, step, false);
    }
    assert_eq!(state, trace["initialState"]);
    output
}

fn validate_ownership(state: &Value) {
    let bindings = state["bindings"].as_array().unwrap();
    let objects = state["objects"].as_array().unwrap();
    let loans = state["loans"].as_array().unwrap();
    let frames = state["frames"].as_array().unwrap();
    let mut owners = std::collections::BTreeMap::<u64, usize>::new();
    for binding in bindings {
        let frame = frames
            .iter()
            .find(|frame| frame["id"] == binding["frameId"])
            .unwrap();
        assert!(
            frame["scopeIds"]
                .as_array()
                .unwrap()
                .contains(&binding["scopeId"])
        );
        if binding["status"] == "moved" {
            assert_eq!(binding["type"], "String");
            continue;
        }
        if let Some(id) = binding["value"]["objectId"].as_u64() {
            *owners.entry(id).or_default() += 1;
        }
    }
    for temporary in state["temporaries"].as_array().unwrap() {
        let id = temporary["value"]["objectId"].as_u64().unwrap();
        *owners.entry(id).or_default() += 1;
    }
    let mut live_bytes = 0;
    for object in objects {
        let id = object["id"].as_u64().unwrap();
        let count = owners.remove(&id).unwrap_or(0);
        let live = object["alive"].as_bool().unwrap();
        assert_eq!(count, usize::from(live), "{state}");
        if live {
            live_bytes += if object["kind"] == "string" {
                object["text"].as_str().unwrap().len()
            } else {
                4 * object["items"].as_array().unwrap().len()
            };
        }
    }
    assert!(owners.is_empty());
    assert_eq!(state["allocator"]["liveBytes"], live_bytes);
    for loan in loans {
        let target = bindings
            .iter()
            .find(|binding| binding["id"] == loan["targetBindingId"])
            .unwrap();
        let parameter = bindings
            .iter()
            .find(|binding| binding["id"] == loan["parameterBindingId"])
            .unwrap();
        assert_eq!(target["status"], "live");
        assert_ne!(target["value"]["kind"], "reference");
        assert_eq!(parameter["value"]["kind"], "reference");
        assert_eq!(parameter["value"]["loanId"], loan["id"]);
        let target_frame = frames
            .iter()
            .position(|frame| frame["id"] == target["frameId"])
            .unwrap();
        let parameter_frame = frames
            .iter()
            .position(|frame| frame["id"] == parameter["frameId"])
            .unwrap();
        assert!(target_frame < parameter_frame);
        if loan["mutable"] == true {
            assert_eq!(target["mutable"], true);
        }
    }
}
fn apply(state: &mut Value, step: &Value, forward: bool) {
    let changes = step["changes"].as_array().unwrap();
    let mut next = state.clone();
    for change in changes {
        let component = change["component"].as_str().unwrap();
        let (before, after) = if forward {
            (&change["before"], &change["after"])
        } else {
            (&change["after"], &change["before"])
        };
        if let Some(id) = change.get("id") {
            let records = next[component].as_array_mut().unwrap();
            let position = records.iter().position(|record| &record["id"] == id);
            assert_eq!(
                position.map(|i| &records[i]).unwrap_or(&Value::Null),
                before
            );
            if after.is_null() {
                records.remove(position.unwrap());
            } else if let Some(position) = position {
                records[position] = after.clone();
            } else {
                records.push(after.clone());
                records.sort_by_key(|record| record["id"].as_u64().unwrap());
            }
        } else {
            assert_eq!(&next[component], before);
            next[component] = after.clone();
        }
    }
    *state = next;
}

#[test]
fn independent_semantic_vectors_and_full_reverse() {
    let vectors: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/rust2018-semantic-vectors.json"
    ))
    .unwrap();
    assert_eq!(vectors.len(), 44);
    for vector in vectors {
        let response = run(request(
            vector["source"].as_str().unwrap(),
            vector["input"].as_str().unwrap(),
        ));
        let code = &response["diagnostic"]["code"];
        assert_eq!(code, &vector["diagnostic"], "{} {}", vector["id"], response);
        let output = trace_output(&response);
        if let Some(expected) = vector["output"].as_str() {
            assert_eq!(output, expected, "{}", vector["id"]);
        }
        if response["status"] == "completed" {
            let trace = &response["replay"]["trace"];
            assert_eq!(trace["completeness"], "complete");
        }
    }
}

#[test]
fn all_frozen_profiles_execute_current_source_and_select_real_replay() {
    let profiles: Vec<Value> = serde_json::from_str(include_str!(
        "../../../shared/contracts/rust2018-profiles-1.0.0.json"
    ))
    .unwrap();
    assert_eq!(profiles.len(), 12);
    for profile in profiles {
        for review_case in 0..4 {
            let mut req = request(profile["source"].as_str().unwrap(), "");
            req.as_object_mut().unwrap().remove("input");
            req["operation"] = json!("judge");
            req["profile"] = profile["id"].clone();
            req["reviewCase"] = json!(review_case);
            let response = run(req);
            assert_eq!(
                response["judgement"]["passed"], true,
                "{} {}",
                profile["id"], response
            );
            assert_eq!(response["judgement"]["cases"].as_array().unwrap().len(), 4);
            assert_eq!(
                trace_output(&response),
                profile["cases"][review_case]["expected"].as_str().unwrap()
            );
        }
    }
}

#[test]
fn closed_request_and_version_validation() {
    let mut req = request("fn main(){}", "");
    req["extra"] = json!(1);
    assert_eq!(
        execute(
            &serde_json::to_vec(&req).unwrap(),
            &"a".repeat(64),
            &mut meter()
        )
        .unwrap_err(),
        "E_REQUEST_INVALID"
    );
    let mut req = request("fn main(){}", "");
    req["edition"] = json!("2024");
    assert_eq!(
        execute(
            &serde_json::to_vec(&req).unwrap(),
            &"a".repeat(64),
            &mut meter()
        )
        .unwrap_err(),
        "E_VERSION_UNSUPPORTED"
    );
    let duplicate = br#"{"version":"1.0.0","version":"1.0.0"}"#;
    assert_eq!(
        execute(duplicate, &"a".repeat(64), &mut meter()).unwrap_err(),
        "E_REQUEST_INVALID"
    );
}

#[test]
fn owned_parameter_mutability_and_nested_borrow_calls_keep_identities() {
    let source = "fn edit(mut text:String)->String{text.push_str(\"!\");text} fn helper()->i32{1} fn bump(value:&mut i32){*value=*value+helper();} fn main(){let result=edit(String::from(\"Rust\"));let mut n=2;bump(&mut n);println!(\"{} {}\",result,n);}";
    let response = run(request(source, ""));
    assert_eq!(response["status"], "completed", "{response}");
    assert_eq!(trace_output(&response), "Rust! 3\n");
    let steps = response["replay"]["trace"]["steps"].as_array().unwrap();
    assert!(
        steps
            .iter()
            .flat_map(|step| step["changes"].as_array().unwrap())
            .any(|change| change["component"] == "bindings"
                && change["after"]["name"] == "text"
                && change["after"]["type"] == "String"
                && change["after"]["mutable"] == true)
    );
}

#[test]
fn cumulative_judge_budget_retains_atomic_prefix() {
    let profiles: Vec<Value> = serde_json::from_str(include_str!(
        "../../../shared/contracts/rust2018-profiles-1.0.0.json"
    ))
    .unwrap();
    let profile = &profiles[0];
    let mut req = request(profile["source"].as_str().unwrap(), "");
    req.as_object_mut().unwrap().remove("input");
    req["operation"] = json!("judge");
    req["profile"] = profile["id"].clone();
    req["reviewCase"] = json!(0);
    let mut budget = Meter::with_limits(Limits {
        steps: 35,
        ..Limits::default()
    });
    budget.set_clock(1000, Box::new(|| 0));
    let bytes = execute(
        &serde_json::to_vec(&req).unwrap(),
        &"a".repeat(64),
        &mut budget,
    )
    .unwrap();
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["status"], "limited");
    assert_eq!(response["judgement"]["passed"], false);
    assert!(response["judgement"]["cases"].as_array().unwrap().len() < 4);
    assert_eq!(response["usage"]["steps"], 35);
    trace_output(&response);
}

#[test]
fn judge_output_and_result_accounting_are_shared_across_cases() {
    let profiles: Vec<Value> = serde_json::from_str(include_str!(
        "../../../shared/contracts/rust2018-profiles-1.0.0.json"
    ))
    .unwrap();
    let profile = &profiles[0];
    let source = profile["source"].as_str().unwrap();
    let mut expected_bytes = 0;
    let mut expected_steps = 0;
    for case in profile["cases"].as_array().unwrap() {
        let response = run(request(source, case["input"].as_str().unwrap()));
        expected_bytes += response["usage"]["resultBytes"].as_u64().unwrap();
        expected_steps += response["usage"]["steps"].as_u64().unwrap();
    }
    let mut req = request(source, "");
    req.as_object_mut().unwrap().remove("input");
    req["operation"] = json!("judge");
    req["profile"] = profile["id"].clone();
    req["reviewCase"] = json!(1);
    let response = run(req.clone());
    assert_eq!(response["usage"]["resultBytes"], expected_bytes);
    assert_eq!(response["usage"]["steps"], expected_steps);
    let mut budget = Meter::with_limits(Limits {
        output_bytes: 10,
        ..Limits::default()
    });
    budget.set_clock(1000, Box::new(|| 0));
    let bytes = execute(
        &serde_json::to_vec(&req).unwrap(),
        &"a".repeat(64),
        &mut budget,
    )
    .unwrap();
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["diagnostic"]["code"], "E_OUTPUT_LIMIT");
    assert_eq!(response["judgement"]["cases"].as_array().unwrap().len(), 2);
    assert_eq!(response["usage"]["outputBytes"], 7);
    assert_eq!(trace_output(&response), "");
}

#[test]
fn unused_language_features_do_not_satisfy_judging() {
    let profiles: Vec<Value> = serde_json::from_str(include_str!(
        "../../../shared/contracts/rust2018-profiles-1.0.0.json"
    ))
    .unwrap();
    let source = "fn main(){let mut line=String::new();std::io::stdin().read_line(&mut line).unwrap();let n:i32=line.trim().parse().unwrap();let unused=String::from(\"Rust\");println!(\"Rust {}\",n);println!(\"Rust\");}";
    let mut req = request(source, "");
    req.as_object_mut().unwrap().remove("input");
    req["operation"] = json!("judge");
    req["profile"] = profiles[8]["id"].clone();
    req["reviewCase"] = json!(0);
    let response = run(req);
    assert_eq!(response["status"], "completed");
    assert_eq!(response["judgement"]["passed"], false);
    assert_eq!(trace_output(&response), "Rust 0\nRust\n");
}

#[test]
fn unrelated_operations_cannot_forge_pedagogic_goals() {
    let profiles: Vec<Value> = serde_json::from_str(include_str!(
        "../../../shared/contracts/rust2018-profiles-1.0.0.json"
    ))
    .unwrap();
    let input = "let mut line=String::new();std::io::stdin().read_line(&mut line).unwrap();let n:i32=line.trim().parse().unwrap();";
    let examples = [
        (
            3,
            "",
            "let values=[n,3,5];let mut copied=values;copied[0]=copied[0]+1;println!(\"{} {}\",n,n+1);",
        ),
        (4, "fn unused(){}", "unused();println!(\"{}\",n*2);"),
        (7, "", "for unused in 0..1 {} println!(\"{}\",n*(n+1)/2);"),
        (
            9,
            "",
            "let first=String::from(\"Rust\");let copied=first.clone();let moved=first;println!(\"Rust Rust {}\",n);",
        ),
        (
            10,
            "fn unused(text:String){}",
            "unused(String::from(\"Rust\"));println!(\"Rust {}\",n);",
        ),
        (
            11,
            "fn bump(value:&mut i32){*value=*value+2;}",
            "let mut unrelated=0;bump(&mut unrelated);println!(\"{}\",n+2);",
        ),
    ];
    for (index, functions, body) in examples {
        let source = format!("{functions}fn main(){{{input}{body}}}");
        let mut req = request(&source, "");
        req.as_object_mut().unwrap().remove("input");
        req["operation"] = json!("judge");
        req["profile"] = profiles[index]["id"].clone();
        req["reviewCase"] = json!(0);
        let response = run(req);
        assert_eq!(response["status"], "completed", "{index}: {response}");
        assert_eq!(
            trace_output(&response),
            profiles[index]["cases"][0]["expected"].as_str().unwrap()
        );
        assert_eq!(
            response["judgement"]["passed"], false,
            "{index}: {response}"
        );
    }
}

#[test]
fn conditional_join_and_return_guard_accept_legitimate_alternatives() {
    let profiles: Vec<Value> = serde_json::from_str(include_str!(
        "../../../shared/contracts/rust2018-profiles-1.0.0.json"
    ))
    .unwrap();
    let input = "let mut line=String::new();std::io::stdin().read_line(&mut line).unwrap();let n:i32=line.trim().parse().unwrap();";
    let alternatives = [
        "let mut magnitude=n;if n<0 {magnitude=-n;}println!(\"{}\",magnitude);",
        "if n<0 {println!(\"{}\",-n);return;}println!(\"{}\",n);",
    ];
    for body in alternatives {
        let mut req = request(&format!("fn main(){{{input}{body}}}"), "");
        req.as_object_mut().unwrap().remove("input");
        req["operation"] = json!("judge");
        req["profile"] = profiles[6]["id"].clone();
        req["reviewCase"] = json!(2);
        let response = run(req);
        assert_eq!(response["judgement"]["passed"], true, "{response}");
        trace_output(&response);
    }
    for body in [
        "let magnitude=if false {-n}else{n};println!(\"{}\",magnitude);",
        "let mut unused=0;if n<0 {unused=1;}println!(\"{}\",n);",
        "let mut values=[n,0];if n<0 {values[1]=1;}println!(\"{}\",values[0]);",
        "let mut magnitude=n;if n<0 {if false {magnitude=0;}}println!(\"{}\",magnitude);",
        "if n<0 {if false {return;}}println!(\"{}\",n);",
        "line.clear();line.push_str(\"1\");let fixed:i32=line.trim().parse().unwrap();let mut magnitude=n;if fixed>0 {magnitude=n;}println!(\"{}\",magnitude);",
    ] {
        let mut req = request(&format!("fn main(){{{input}{body}}}"), "");
        req.as_object_mut().unwrap().remove("input");
        req["operation"] = json!("judge");
        req["profile"] = profiles[6]["id"].clone();
        req["reviewCase"] = json!(2);
        let response = run(req);
        assert_eq!(response["status"], "completed", "{response}");
        assert_eq!(
            response["judgement"]["cases"][2]["passed"], false,
            "{response}"
        );
        trace_output(&response);
    }
}

#[test]
fn fuel_reserve_preserves_a_decodable_reversible_terminal() {
    let mut budget = Meter::with_limits(Limits {
        fuel: 16000,
        ..Limits::default()
    });
    budget.set_clock(1000, Box::new(|| 0));
    let bytes = execute(
        &serde_json::to_vec(&request("fn main(){let mut n=0;loop{n=n+1;}}", "")).unwrap(),
        &"a".repeat(64),
        &mut budget,
    )
    .unwrap();
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["diagnostic"]["code"], "E_FUEL_LIMIT");
    assert_eq!(response["status"], "limited");
    assert!(
        response["replay"]["trace"]["steps"]
            .as_array()
            .unwrap()
            .len()
            > 10
    );
    trace_output(&response);
}

#[test]
fn errors_and_step_limits_keep_reversible_committed_state() {
    let response = run(request("fn main(){let mut n=0;loop{n=n+1;}}", ""));
    assert_eq!(response["diagnostic"]["code"], "E_STEP_LIMIT");
    assert_eq!(
        response["replay"]["trace"]["steps"]
            .as_array()
            .unwrap()
            .len(),
        20000
    );
    trace_output(&response);
    let response = run(request(
        "fn main(){let a=[1];println!(\"before\");println!(\"{}\",a[2]);}",
        "",
    ));
    assert_eq!(response["diagnostic"]["code"], "E_ARRAY_BOUNDS");
    assert_eq!(trace_output(&response), "before\n");
}

#[test]
fn empty_loop_commits_exactly_twenty_thousand_steps() {
    let response = run(request("fn main(){loop{}}", ""));
    assert_eq!(response["status"], "limited");
    assert_eq!(response["diagnostic"]["code"], "E_STEP_LIMIT");
    assert_eq!(response["usage"]["steps"], 20000);
    assert!(response["usage"]["resultBytes"].as_u64().unwrap() < 16_777_216);
    trace_output(&response);
}
