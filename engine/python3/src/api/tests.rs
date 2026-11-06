use std::cell::Cell;
use std::rc::Rc;

use crate::budget::Limits;
use serde_json::{Value as Json, json};

use super::*;
use crate::trace::State;

const BUILD: &str = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const VECTORS: &str = include_str!("../../../../tests/fixtures/python3-semantics.json");

fn request(source: &str, operation: Json) -> Json {
    json!({
        "language":"python", "engineId": ENGINE, "engineVersion": ENGINE_VERSION,
        "pythonReference":"3.13", "execVersion":EXEC, "dslVersion":STEP, "diagnosticVersion":DIAG,
        "integerEncoding":VERSION, "runId":"test-run", "sourceRevision":"rev-1",
        "sourceSha256":format!("{:x}", Sha256::digest(source)), "source":source, "operation":operation,
    })
}

fn evaluate(source: &str, operation: Json) -> Json {
    let bytes = serde_json::to_vec(&request(source, operation)).unwrap();
    let result = execute(&bytes, BUILD, &mut Meter::new()).unwrap();
    let packet =
        codec::decode(&result, &mut Meter::new(), 16_777_216).expect("canonical Python response");
    assert_eq!(packet["usage"]["resultBytes"], result.len());
    packet
}

fn stdout(packet: &Json) -> String {
    let mut output = String::new();
    if let Some(steps) = packet["trace"]["steps"].as_array() {
        for step in steps {
            for change in step["changes"].as_array().unwrap() {
                if change["op"] == "output" {
                    assert_eq!(change["beforeBytes"], output.len());
                    output.push_str(change["append"].as_str().unwrap());
                    assert_eq!(change["afterBytes"], output.len());
                }
            }
        }
    }
    output
}

fn run_request(source: &str, input: &str) -> Json {
    evaluate(
        source,
        json!({"kind":"run","input":{"kind":"stdin-utf8","text":input}}),
    )
}

fn judge_request(id: &str, source: &str) -> Json {
    evaluate(
        source,
        json!({
            "kind":"judge","judgeVersion":JUDGE,
            "packageRef":{"id":PACKAGE,"version":VERSION},
            "profileRef":{"id":id,"version":VERSION},
        }),
    )
}

#[test]
fn frozen_semantic_vectors() {
    let vectors: Vec<Json> = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(vectors.len(), 34);
    for vector in vectors {
        let source = vector["source"].as_str().unwrap();
        let response = run_request(source, vector["input"].as_str().unwrap());
        let packet = &response["result"]["packet"];
        assert_eq!(
            packet["terminal"]["status"], vector["status"],
            "{}",
            vector["id"]
        );
        assert_eq!(
            packet["terminal"]["diagnostic"]["code"], vector["diagnostic"],
            "{}",
            vector["id"]
        );
        assert_eq!(
            stdout(packet),
            vector["stdout"].as_str().unwrap(),
            "{}",
            vector["id"]
        );
    }
}

#[test]
fn list_representation_uses_python_313_printable_categories() {
    let result = run_request(
        "print(['e\\u0301', '\\u0378', '\\U000f0000', '\\u00a0', '🐍'])",
        "",
    );
    assert_eq!(
        stdout(&result["result"]["packet"]),
        "['e\u{0301}', '\\u0378', '\\U000f0000', '\\xa0', '🐍']\n"
    );
}

const PROGRAMS: &[(&str, &str)] = &[
    ("greeting", "name = input()\nprint('你好，' + name)"),
    (
        "floor-pair",
        "a = int(input())\nb = int(input())\nprint(a//b, a%b, sep='\\n')",
    ),
    (
        "short-circuit",
        "a = int(input())\nb = int(input())\nprint(b and a // b)",
    ),
    (
        "true-division",
        "a = int(input())\nb = int(input())\nprint((a+b)/2)",
    ),
    (
        "code-point",
        "line = input()\ni = int(input())\nprint(line[i])",
    ),
    (
        "list-alias",
        "a = int(input())\nb = int(input())\nx = [a]\ny = x\ny[0] = b\nprint(x[0])",
    ),
    (
        "slice-copy",
        "a = int(input())\nb = int(input())\nx = [a,b]\ny = x[:]\nx[0] = b\nprint(x[0],y[0],sep='\\n')",
    ),
    (
        "nested-if",
        "n=int(input())\nr=int(input())\nif n == 0:\n    print('empty')\nelse:\n    if r:\n        print('reserved')\n    else:\n        print('available')",
    ),
    (
        "while-odd-sum",
        "n = int(input())\ns = 0\ni = 1\nwhile i <= n:\n    s += i\n    i += 2\nprint(s)",
    ),
    (
        "range-sum",
        "a=int(input())\nb=int(input())\nc=int(input())\ns=0\nfor i in range(a,b,c):\n    s += i\nprint(s)",
    ),
    (
        "function-return",
        "def gap(x,y):\n    return abs(x-y)\na=int(input())\nb=int(input())\nprint(gap(a,b),gap(a+1,b),sep='\\n')",
    ),
    ("stdin-lines", "a=int(input())\nb=int(input())\nprint(a-b)"),
];

#[test]
fn real_judging_executes_all_48_cases() {
    for (name, source) in PROGRAMS {
        let result = judge_request(&format!("py3.practice.{name}"), source);
        assert_eq!(
            result["result"]["status"],
            "passed",
            "{name}: {}",
            result["result"]["cases"]
                .as_array()
                .unwrap()
                .iter()
                .map(|case| format!(
                    "{:?}/{:?}/{:?}",
                    case["stdoutMatches"], case["observationMatches"], case["packet"]["terminal"]
                ))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let cases = result["result"]["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 4);
        for (index, case) in cases.iter().enumerate() {
            assert_eq!(case["caseKey"], index + 1);
            assert_eq!(case["stdoutMatches"], true);
            assert_eq!(case["observationMatches"], true);
            let steps = case["packet"]["trace"]["steps"].as_array().unwrap();
            for fact in case["observations"].as_array().unwrap() {
                let step = &steps[fact["seq"].as_u64().unwrap() as usize - 1];
                assert_eq!(fact["nodeId"], step["nodeId"]);
                assert_eq!(fact["tag"], step["kind"]);
            }
        }
    }
}

#[test]
fn judges_reject_dead_and_non_contributing_operations() {
    for source in [
        "a = input()\nif False:\n    print('你好，' + a)\nprint('你好，',a,sep='')",
        "a = input()\nb = '你好，' + a\nprint('你好，',a,sep='')",
        "a = input()\nprint('你好，',a,sep='')",
    ] {
        let response = judge_request("py3.practice.greeting", source);
        assert_eq!(response["result"]["status"], "failed");
        assert!(
            response["result"]["cases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|case| case["stdoutMatches"] == true && case["observationMatches"] == false)
        );
    }
    let response = judge_request(
        "py3.practice.floor-pair",
        "a=int(input())\nb=int(input())\nprint(a//b)\nif a==7 and b==-3:\n    print(0)\nelse:\n    print(a%b)",
    );
    assert_eq!(response["result"]["status"], "failed");
    assert_eq!(response["result"]["cases"][2]["stdoutMatches"], false);
}

#[test]
fn replay_recovers_frames_lists_aliases_input_output_and_checkpoints() {
    let source = "a=[]\na.append(a)\nb=a\nb.append(int(input()))\ndef f(x):\n    return x.pop()\nn=0\nwhile n<50:\n    n+=1\nprint(f(a), b)";
    let mut meter = Meter::new();
    let program = parser::parse(source, &mut meter).unwrap();
    let run = runtime::run(&program, "8\n", &mut meter, &mut Usage::default());
    assert!(run.diagnostic.is_none());
    let mut state = run.trace.initial_state.clone();
    for step in &run.trace.steps {
        let before = state.clone();
        state.apply(step, true);
        state.apply(step, false);
        assert_eq!(state, before);
        state.apply(step, true);
        if let Some(checkpoint) = run
            .trace
            .checkpoints
            .iter()
            .find(|entry| entry.cursor == step.seq)
        {
            assert_eq!(checkpoint.state, state);
        }
    }
    assert!(!run.trace.checkpoints.is_empty());
    assert_eq!(state, run.state);
    assert_eq!(state.output, "8 [[...]]\n");
    for step in run.trace.steps.iter().rev() {
        state.apply(step, false);
    }
    assert_eq!(state, State::default());
}

#[test]
fn hard_limits_and_cancellation_keep_a_reversible_prefix_and_recover() {
    let mut meter = Meter::with_limits(Limits {
        steps: 30,
        ..Limits::default()
    });
    let program = parser::parse("n=0\nwhile True:\n    n+=1", &mut meter).unwrap();
    let run = runtime::run(&program, "", &mut meter, &mut Usage::default());
    assert_eq!(run.diagnostic.unwrap().code, "E_STEP_LIMIT");
    assert_eq!(run.trace.steps.len(), 30);
    let mut state = run.state;
    for step in run.trace.steps.iter().rev() {
        state.apply(step, false);
    }
    assert_eq!(state, State::default());
    let counter = Rc::new(Cell::new(0));
    let mut meter = Meter::new();
    meter.set_cancel(Box::new(move || {
        counter.set(counter.get() + 1);
        counter.get() > 8
    }));
    let run = runtime::run(&program, "", &mut meter, &mut Usage::default());
    assert_eq!(run.diagnostic.unwrap().code, "E_CANCELLED");
    assert!(!run.trace.steps.is_empty());
    assert_eq!(
        stdout(&run_request("print(2+3)", "")["result"]["packet"]),
        "5\n"
    );
}

#[test]
fn four_cases_share_one_budget_and_cannot_pass_after_partial_execution() {
    let source = "name = input()\nprint('你好，' + name)";
    let bytes = serde_json::to_vec(&request(
        source,
        json!({
            "kind":"judge","judgeVersion":JUDGE,"packageRef":{"id":PACKAGE,"version":VERSION},
            "profileRef":{"id":"py3.practice.greeting","version":VERSION}
        }),
    ))
    .unwrap();
    let mut meter = Meter::with_limits(Limits {
        steps: 8,
        ..Limits::default()
    });
    let response: Json =
        serde_json::from_slice(&execute(&bytes, BUILD, &mut meter).unwrap()).unwrap();
    assert_eq!(response["usage"]["steps"], 8);
    assert_eq!(response["result"]["status"], "incomplete");
    let cases = response["result"]["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2);
    assert_eq!(cases[0]["packet"]["terminal"]["status"], "completed");
    assert_eq!(
        cases[1]["packet"]["terminal"]["diagnostic"]["code"],
        "E_STEP_LIMIT"
    );
}

#[test]
fn unreachable_list_cycles_are_collected_without_losing_reversibility() {
    let source = "i=0\nwhile i<70:\n    a=[]\n    a.append(a)\n    i+=1\nprint(a)";
    let mut meter = Meter::new();
    let program = parser::parse(source, &mut meter).unwrap();
    let run = runtime::run(&program, "", &mut meter, &mut Usage::default());
    assert!(run.diagnostic.is_none());
    assert!(
        run.trace
            .steps
            .iter()
            .any(|step| step.kind == "list-collect")
    );
    assert_eq!(run.state.output, "[[...]]\n");
    assert!(run.state.objects.len() < 70);
    let mut state = run.state;
    for step in run.trace.steps.iter().rev() {
        state.apply(step, false);
    }
    assert_eq!(state, State::default());
}

#[test]
fn request_identity_and_unknown_operations_fail_closed() {
    let mut value = request(
        "print('Hi')",
        json!({"kind":"run","input":{"kind":"stdin-utf8","text":""}}),
    );
    let try_request = |value: &Json| {
        execute(
            &serde_json::to_vec(value).unwrap(),
            BUILD,
            &mut Meter::new(),
        )
    };
    value["source"] = json!("print('Other')");
    assert_eq!(try_request(&value), Err("E_SOURCE_IDENTITY"));
    value["language"] = json!("c");
    assert_eq!(try_request(&value), Err("E_PROTOCOL_INVALID"));
    value["language"] = json!("python");
    value["operation"]["input"]["extra"] = json!(1);
    assert_eq!(try_request(&value), Err("E_PROTOCOL_INVALID"));
    assert_eq!(
        execute(
            b"{\"source\":\"a\",\"source\":\"b\"}",
            BUILD,
            &mut Meter::new()
        ),
        Err("E_PROTOCOL_INVALID")
    );
}

#[test]
fn mapping_is_full_document_or_code_only_and_preserves_original_ranges() {
    let edit = json!({"kind":"edit","editVersion":JUDGE,"packageRef":{"id":PACKAGE,"version":VERSION},"documentId":"doc-1"});
    let source = "\u{feff}a = '🐍'\r\nprint(a)";
    let response = evaluate(source, edit.clone());
    assert_eq!(response["result"]["status"], "mapped");
    assert_eq!(
        response["result"]["blockMap"].as_array().unwrap().len(),
        response["nodeMap"].as_array().unwrap().len()
    );
    let string = response["nodeMap"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["kind"] == "string")
        .unwrap();
    let from = string["byteRange"]["start"].as_u64().unwrap() as usize;
    let to = string["byteRange"]["end"].as_u64().unwrap() as usize;
    assert_eq!(&source[from..to], "'🐍'");
    assert_eq!(
        evaluate("a=[]\na.append(1)", edit.clone())["result"]["status"],
        "code-only"
    );
    assert_eq!(
        evaluate("# keep me\nprint(1)", edit.clone())["result"]["status"],
        "code-only"
    );
    assert_eq!(
        evaluate("import os", edit)["result"]["status"],
        "unsupported"
    );
}
