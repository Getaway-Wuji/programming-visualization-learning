use c_viz_c6::{api, budget::Meter, codec};
use serde_json::{Value, json};
fn request(source: &str, input: &str) -> Value {
    json!({"execVersion":"1.5.0","dslVersion":"1.4.0","diagnosticVersion":"1.4.0","integerEncoding":"1.0.0","language":"c","engineId":"engine.rust.c6","engineVersion":"0.1.0","runId":"native-test","sourceRevision":"revision-1","sourceSha256":api::source_hash(source),"source":source,"input":{"kind":"stdin-ascii","text":input}})
}
fn send(request: &Value) -> Result<Value, &'static str> {
    let mut m = Meter::new();
    let bytes = codec::encode(request, &mut m, 65536).unwrap();
    let bytes = api::execute(&bytes, &"a".repeat(64), &mut m)?;
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    Ok(value)
}
#[test]
fn real_protocol_executes_changed_source_and_input() {
    let source =
        "#include <stdio.h>\nint main(){int n;scanf(\"%d\",&n);printf(\"%d\\n\",n*3+1);return 0;}";
    let a = send(&request(source, "4")).unwrap();
    let b = send(&request(source, "-2")).unwrap();
    assert_eq!(a["terminal"]["status"], "completed");
    assert_eq!(b["terminal"]["status"], "completed");
    assert!(a["trace"]["steps"].as_array().unwrap().iter().any(|s| {
        s["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["op"] == "output" && c["append"] == "13\n")
    }));
    assert!(b["trace"]["steps"].as_array().unwrap().iter().any(|s| {
        s["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["op"] == "output" && c["append"] == "-5\n")
    }));
    let c = send(&request(&source.replace("n*3+1", "n*5+1"), "4")).unwrap();
    assert_ne!(a["identity"]["sourceSha256"], c["identity"]["sourceSha256"]);
}
#[test]
fn exact_versions_language_source_hash_and_closed_shape_reject() {
    let base = request("int main(){return 0;}", "");
    for (key, value) in [
        ("language", json!("cpp")),
        ("execVersion", json!("1.4.0")),
        ("engineId", json!("engine.rust.advanced")),
        ("sourceSha256", json!("0".repeat(64))),
        ("unknown", json!(true)),
    ] {
        let mut r = base.clone();
        r[key] = value;
        assert!(send(&r).is_err(), "{key}")
    }
}
#[test]
fn malformed_input_never_executes() {
    for text in ["中文", "\0", "\u{1b}", &"x".repeat(257)] {
        assert_eq!(
            send(&request("int main(){return 0;}", text)).unwrap_err(),
            "E_INPUT_INVALID"
        );
    }
}
#[test]
fn compiler_error_is_not_a_trace() {
    let p = send(&request("int main(){if(0)unknown=1;return 0;}", "")).unwrap();
    assert_eq!(p["terminal"]["code"], "E_UNDECLARED");
    assert!(p["trace"].is_null());
    assert_eq!(p["terminal"]["cursor"], 0);
}
#[test]
fn runtime_error_retains_real_prefix() {
    let p = send(&request(
        "#include <stdio.h>\nint main(){printf(\"before\");int x=0;return 1/x;}",
        "",
    ))
    .unwrap();
    assert_eq!(p["terminal"]["code"], "E_DIV_ZERO");
    assert_eq!(p["trace"]["completeness"], "prefix");
    assert!(p["trace"]["steps"].as_array().unwrap().iter().any(|s| {
        s["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["op"] == "output" && c["append"] == "before")
    }));
}
#[test]
fn sha256_known_answer() {
    assert_eq!(
        api::source_hash("hello world"),
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
}
