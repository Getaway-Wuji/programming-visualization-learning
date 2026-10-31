use c_viz_advanced::{
    budget::{Limits, Meter},
    codec, runtime,
};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut meter = Meter::new();
    // Deterministic semantic/resource tests; browser tests use the real deadline.
    meter.set_clock(1000, Box::new(|| 0));
    meter
}
fn request(source: &str) -> Value {
    json!({"execVersion":"1.4.0","dslVersion":"1.3.0","diagnosticVersion":"1.3.0","integerEncoding":"1.0.0","language":"c","engineId":"engine.rust.advanced","runId":"adversarial.test","sourceRevision":"source.1","source":source,"input":{"kind":"integers","values":[]}})
}
fn run(source: &str) -> Value {
    let bytes = codec::encode(&request(source), &mut meter(), 65536).unwrap();
    let bytes = runtime::execute(&bytes, &"f".repeat(64), &mut meter()).unwrap();
    assert!(bytes.len() <= 16777216);
    // Independent test reader: it must not charge the producer's execution fuel
    // again while inspecting a large valid prefix.
    serde_json::from_slice(&bytes).unwrap()
}
fn replay_and_reverse(result: &Value) -> Value {
    let trace = &result["trace"];
    let mut state = trace["initialState"].clone();
    let mut before_each = Vec::new();
    let steps = trace["steps"].as_array().unwrap();
    for step in steps {
        before_each.push(state.clone());
        runtime::apply_changes(
            &mut state,
            step["changes"].as_array().unwrap(),
            false,
            &result["types"],
        )
        .unwrap();
    }
    let last = state.clone();
    for (step, before) in steps.iter().zip(before_each.iter()).rev() {
        runtime::apply_changes(
            &mut state,
            step["changes"].as_array().unwrap(),
            true,
            &result["types"],
        )
        .unwrap();
        assert_eq!(
            &state, before,
            "every atomic inverse must restore the complete previous state"
        );
    }
    assert_eq!(state, trace["initialState"]);
    last
}
#[test]
fn frozen_limits_are_unchanged() {
    let l = Limits::default();
    assert_eq!(
        (
            l.source_bytes,
            l.request_bytes,
            l.fuel,
            l.steps,
            l.live_bytes,
            l.output_bytes,
            l.result_bytes,
            l.max_syntax_depth,
            l.max_ast_depth
        ),
        (
            32768, 65536, 1000000, 20000, 1048576, 16384, 16777216, 64, 64
        )
    );
}
#[test]
fn actual_output_boundary_refuses_the_whole_failing_append_and_inverse_removes_output() {
    let output = "q".repeat(16384);
    let base = format!("#include <stdio.h>\nint main(){{printf(\"{output}\");");
    let good = run(&(base.clone() + "return 0;}"));
    assert_eq!(good["terminal"]["status"], "completed");
    assert_eq!(replay_and_reverse(&good)["output"], output);
    let bad = run(&(base + "printf(\"x\");return 0;}"));
    assert_eq!(bad["terminal"]["code"], "E_OUTPUT_LIMIT");
    assert_eq!(bad["trace"]["completeness"], "prefix");
    assert_eq!(replay_and_reverse(&bad)["output"], output);
}
#[test]
fn actual_live_memory_boundary_is_sparse_and_never_admits_the_next_int() {
    let good = run("int main(){int a[262144];return 0;}");
    assert_eq!(good["terminal"]["status"], "completed");
    replay_and_reverse(&good);
    let bad = run("int main(){int a[262145];return 0;}");
    assert_eq!(bad["terminal"]["code"], "E_MEMORY_LIMIT");
    let end = replay_and_reverse(&bad);
    assert_eq!(end["allocator"]["liveBytes"], 0);
}
#[test]
fn recursive_stack_boundary_and_each_failed_prefix_are_atomic() {
    let good = run("int f(int n){if(n==0){return 7;}return f(n-1);}int main(){return f(30);}");
    assert_eq!(good["terminal"]["status"], "completed");
    replay_and_reverse(&good);
    for (source, code) in [
        (
            "int f(int n){return f(n+1);}int main(){return f(0);}",
            "E_STACK_LIMIT",
        ),
        ("int main(){int* p=0;return *p;}", "E_NULL_POINTER"),
        ("int main(){int* p;return *p;}", "E_UNINITIALIZED"),
        (
            "int main(){int* p=0;{int n=7;p=&n;}return *p;}",
            "E_DANGLING_POINTER",
        ),
        (
            "int main(){int a[2]={3,7};int* p=a+2;return *p;}",
            "E_POINTER_BOUNDS",
        ),
        ("int main(){while(1){}}", "E_STEP_LIMIT"),
    ] {
        let bad = run(source);
        assert_eq!(bad["terminal"]["code"], code);
        assert_eq!(bad["trace"]["completeness"], "prefix");
        replay_and_reverse(&bad);
        assert_eq!(run("int main(){return 19;}")["terminal"]["returnValue"], 19);
    }
}
#[test]
fn source_and_encoded_request_limits_are_independent() {
    let tail = "\nint main(){return 0;}";
    let source = "//".to_owned() + &"a".repeat(32768 - 2 - tail.len()) + tail;
    assert_eq!(source.len(), 32768);
    assert_eq!(run(&source)["terminal"]["status"], "completed");
    // Calling the Rust entry point bypasses the UI guard deliberately.
    let bad = run(&(source + "x"));
    assert_eq!(bad["terminal"]["code"], "E_SOURCE_LIMIT");
    assert!(bad["trace"].is_null());
    let oversized = vec![b' '; 65537];
    assert_eq!(
        runtime::execute(&oversized, &"f".repeat(64), &mut meter()).unwrap_err(),
        "E_REQUEST_LIMIT"
    );
}
