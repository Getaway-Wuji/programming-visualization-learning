use serde_json::{Value, json};

use super::*;

fn request(source: &str, operation: Value) -> Value {
    json!({
        "language": "java", "engineId": ENGINE, "engineVersion": ENGINE_VERSION,
        "javaReference": "21", "execVersion": EXEC, "dslVersion": STEP,
        "diagnosticVersion": DIAG, "integerEncoding": INTEGER, "runId": "test",
        "sourceRevision": "rev.1", "sourceSha256": format!("{:x}", Sha256::digest(source.as_bytes())),
        "source": source, "operation": operation,
    })
}

fn run_op(input: &str) -> Value {
    json!({"kind":"run", "input":{"kind":"stdin-utf8","text":input}})
}

fn execute_json(value: &Value) -> Value {
    let encoded = serde_json::to_vec(value).unwrap();
    let response = execute(&encoded, &"a".repeat(64), &mut Meter::new()).unwrap();
    let document: Value = serde_json::from_slice(&response).unwrap();
    assert_eq!(document["usage"]["resultBytes"], response.len());
    assert_eq!(
        serde_json::to_vec(&document).unwrap(),
        response,
        "canonical wire order"
    );
    document
}

fn output(packet: &Value) -> String {
    packet["trace"]["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|step| step["changes"].as_array().unwrap())
        .filter(|change| change["op"] == "output")
        .map(|change| change["append"].as_str().unwrap())
        .collect()
}

#[test]
fn frozen_language_vectors() {
    let vectors: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/java-semantics.json"
    ))
    .unwrap();
    for vector in vectors {
        let source = vector["source"].as_str().unwrap();
        let response = execute_json(&request(source, run_op(vector["input"].as_str().unwrap())));
        let packet = &response["result"]["packet"];
        assert_eq!(
            packet["terminal"]["status"], vector["expectedStatus"],
            "{}",
            vector["id"]
        );
        assert_eq!(
            packet["terminal"]["diagnostic"]["code"], vector["expectedDiagnostic"],
            "{}",
            vector["id"]
        );
        assert_eq!(output(packet), vector["expectedStdout"], "{}", vector["id"]);
        if let Some(range) = packet["terminal"]["diagnostic"]["byteRange"].as_object() {
            for key in ["start", "end"] {
                assert!(source.is_char_boundary(range[key].as_u64().unwrap() as usize));
            }
        }
    }
}

#[test]
fn fixed_profiles_execute_all_four_cases() {
    let examples: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/java-reference.json"
    ))
    .unwrap();
    for (id, source) in examples.as_object().unwrap() {
        let response = execute_json(&request(
            source.as_str().unwrap(),
            json!({
                "kind":"judge","judgeVersion":JUDGE,
                "packageRef":{"id":PACKAGE,"version":VERSION},
                "profileRef":{"id":format!("java.practice.{id}"),"version":VERSION}
            }),
        ));
        let result = &response["result"];
        assert_eq!(
            result["status"],
            "passed",
            "{id}: {:?}",
            result["cases"].as_array().map(|cases| {
                cases
                    .iter()
                    .map(|case| {
                        (
                            case["stdoutMatches"].clone(),
                            case["observationMatches"].clone(),
                            case["packet"]["terminal"].clone(),
                        )
                    })
                    .collect::<Vec<_>>()
            })
        );
        assert_eq!(result["cases"].as_array().unwrap().len(), 4);
    }
}

#[test]
fn hardcoded_correct_values_fail_observation() {
    let source =
        "import java.util.Scanner; public class Main { public static void main(String[] args) {
        Scanner scan = new Scanner(System.in); int x = scan.nextInt(); if (x == 7) {
        System.out.println(true); } else { System.out.println(false); } } }";
    let response = execute_json(&request(
        source,
        json!({
            "kind":"judge","judgeVersion":JUDGE, "packageRef":{"id":PACKAGE,"version":VERSION},
            "profileRef":{"id":"java.practice.short-circuit","version":VERSION}
        }),
    ));
    assert_eq!(response["result"]["status"], "failed");
    for case in response["result"]["cases"].as_array().unwrap() {
        assert_eq!(case["stdoutMatches"], true);
        assert_eq!(case["observationMatches"], false);
    }
}

#[test]
fn source_and_protocol_identity_must_match() {
    let source = "public class M { public static void main(String[] a) {} }";
    let mut request = request(source, run_op(""));
    request["sourceSha256"] = json!("b".repeat(64));
    assert_eq!(
        execute(
            &serde_json::to_vec(&request).unwrap(),
            &"a".repeat(64),
            &mut Meter::new()
        ),
        Err("E_SOURCE_IDENTITY")
    );
    request["engineId"] = json!("engine.rust.python3");
    assert_eq!(
        execute(
            &serde_json::to_vec(&request).unwrap(),
            &"a".repeat(64),
            &mut Meter::new()
        ),
        Err("E_PROTOCOL_INVALID")
    );
}

#[test]
fn long_loop_has_budget_prefix() {
    let source = "public class M { public static void main(String[] args) { int i = 0; while (true) { i++; } } }";
    let response = execute_json(&request(source, run_op("")));
    let packet = &response["result"]["packet"];
    assert_eq!(packet["terminal"]["status"], "limited");
    assert_eq!(packet["terminal"]["diagnostic"]["code"], "E_STEP_LIMIT");
    assert_eq!(packet["terminal"]["cursor"], 20000);
    assert_eq!(
        packet["trace"]["checkpoints"].as_array().unwrap().len(),
        20000 / 128
    );
}
