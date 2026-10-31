use c_viz_advanced::{budget::Meter, codec, runtime};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut meter = Meter::new();
    // Native semantic checks deliberately avoid depending on machine speed.
    // The real browser entry point separately verifies its actual deadline.
    meter.set_clock(1000, Box::new(|| 0));
    meter
}
fn run_with(
    source: &str,
    language: &str,
    input: Value,
    meter: &mut Meter,
) -> Result<Value, &'static str> {
    let request = json!({
        "execVersion":"1.4.0", "dslVersion":"1.3.0", "diagnosticVersion":"1.3.0",
        "integerEncoding":"1.0.0", "language":language, "engineId":"engine.rust.advanced",
        "runId":"memory.test", "sourceRevision":"source.1", "source":source, "input":input,
    });
    let bytes = codec::encode(&request, &mut self::meter(), 65536).unwrap();
    runtime::execute(&bytes, &"f".repeat(64), meter)
        .map(|bytes| codec::decode(&bytes, &mut self::meter(), 16_777_216).unwrap())
}
fn run(source: &str, language: &str, input: Value) -> Value {
    run_with(source, language, input, &mut meter()).unwrap()
}
fn apply(state: &mut Value, changes: &Value, reverse: bool, types: &Value) {
    runtime::apply_changes(state, changes.as_array().unwrap(), reverse, types).unwrap();
}
fn replay(result: &Value) -> Value {
    let trace = &result["trace"];
    let mut state = trace["initialState"].clone();
    for step in trace["steps"].as_array().unwrap() {
        apply(&mut state, &step["changes"], false, &result["types"]);
    }
    state
}
fn roundtrip(result: &Value) {
    let trace = &result["trace"];
    let steps = trace["steps"].as_array().unwrap();
    let mut state = trace["initialState"].clone();
    let mut returned = None;
    let mut released = None;
    for step in steps {
        apply(&mut state, &step["changes"], false, &result["types"]);
        if step["kind"] == "function.return" {
            returned = Some((state.clone(), step));
        }
        if step["kind"] == "memory.release" {
            released = Some((state.clone(), step));
        }
        if step["seq"].as_u64().unwrap() % 128 == 0 {
            let point = trace["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|point| point["cursor"] == step["seq"])
                .unwrap();
            assert_eq!(state, point["state"]);
        }
    }
    let end = state.clone();
    for step in steps.iter().rev() {
        apply(&mut state, &step["changes"], true, &result["types"]);
    }
    assert_eq!(state, trace["initialState"]);
    for step in steps {
        apply(&mut state, &step["changes"], false, &result["types"]);
    }
    assert_eq!(state, end);
    if let Some((mut after, step)) = returned {
        let frames = after["frames"].as_array().unwrap().len();
        apply(&mut after, &step["changes"], true, &result["types"]);
        assert_eq!(after["frames"].as_array().unwrap().len(), frames + 1);
    }
    if let Some((mut after, step)) = released {
        let live = after["allocator"]["liveBytes"].as_u64().unwrap();
        apply(&mut after, &step["changes"], true, &result["types"]);
        assert!(after["allocator"]["liveBytes"].as_u64().unwrap() >= live);
    }
}
fn completed(result: &Value) {
    assert_eq!(
        result["terminal"]["status"], "completed",
        "{:?}",
        result["terminal"]
    );
}
fn error(source: &str, language: &str, code: &str) -> Value {
    let result = run(source, language, json!({"kind":"integers","values":[]}));
    assert_eq!(
        result["terminal"]["code"], code,
        "{source}: {:?}",
        result["terminal"]
    );
    assert_ne!(result["terminal"]["status"], "completed");
    if !result["trace"].is_null() {
        assert_eq!(result["trace"]["completeness"], "prefix");
        roundtrip(&result);
    }
    result
}

fn ints(v: &[i32]) -> Value {
    json!({"kind":"integers","values":v})
}
fn lines(v: &[&str]) -> Value {
    json!({"kind":"lines","values":v})
}
fn sample(name: &str) -> String {
    std::fs::read_to_string(format!("../../shared/fixtures/advanced/{name}")).unwrap()
}
#[test]
fn c_input_atomicity_and_strings_are_reversible() {
    let r = run(&sample("input.c"), "c", ints(&[7, -2]));
    completed(&r);
    assert_eq!(replay(&r)["output"], "5");
    roundtrip(&r);
    let r = run(&sample("input.c"), "c", ints(&[7]));
    assert_eq!(r["terminal"]["code"], "E_INPUT_EXHAUSTED");
    assert_eq!(replay(&r)["control"]["inputCursor"], 1);
    roundtrip(&r);
    for v in [
        vec!["aba", "x"],
        vec!["", ""],
        vec!["123456789012345678901234567890", " "],
    ] {
        let r = run(&sample("strings.cpp"), "cpp", lines(&v));
        completed(&r);
        let want = format!(
            "{}{}{}{}",
            v[0],
            v[1],
            v[0].len(),
            v[0].chars()
                .next()
                .map(|c| c.to_string())
                .unwrap_or_default()
        );
        assert_eq!(replay(&r)["output"], want);
        roundtrip(&r);
    }
}
#[test]
fn kmp_covers_empty_repeated_prefix_boundaries_and_source_edits() {
    let src = sample("kmp.cpp");
    for (t, p, want) in [
        ("ababab", "abab", 0),
        ("aaaaab", "aaab", 2),
        ("abc", "d", -1),
        ("", "", 0),
        ("", "a", -1),
        ("abc", "", 0),
        ("abc", "abcd", -1),
        ("ababa", "aba", 0),
        ("123456789012345678901234567890", "0", 9),
    ] {
        let r = run(&src, "cpp", lines(&[t, p]));
        completed(&r);
        assert_eq!(replay(&r)["output"], want.to_string(), "{t}/{p}");
        roundtrip(&r);
    }
    let changed = src.replace("answer=i-m+1", "answer=i-m+2");
    let r = run(&changed, "cpp", lines(&["zabc", "abc"]));
    completed(&r);
    assert_eq!(replay(&r)["output"], "2");
    roundtrip(&r);
}
#[test]
fn numeric_algorithms_use_real_arrays() {
    for n in 0..=30 {
        let mut outputs = vec![];
        for name in ["eratos.cpp", "euler.cpp"] {
            let r = run(&sample(name), "cpp", ints(&[n]));
            completed(&r);
            outputs.push(replay(&r)["output"].clone());
            roundtrip(&r);
        }
        let expected = (2..=n)
            .filter(|p| (2..*p).all(|d| p % d != 0))
            .map(|p| format!("{p} "))
            .collect::<String>();
        assert_eq!(outputs[0], expected);
        assert_eq!(outputs[0], outputs[1]);
    }
    for (a, sum, lis) in [
        (vec![], 0, 0),
        (vec![-5, -2, -8], -2, 2),
        (vec![3, 3, 3], 9, 1),
        (vec![-2, 1, -3, 4, -1, 2, 1, -5, 4], 6, 4),
    ] {
        let input = std::iter::once(a.len() as i32).chain(a).collect::<Vec<_>>();
        for (name, want) in [("kadane.cpp", sum), ("lis.cpp", lis)] {
            let r = run(&sample(name), "cpp", ints(&input));
            completed(&r);
            assert_eq!(replay(&r)["output"], want.to_string());
            roundtrip(&r);
        }
    }
}
#[test]
fn rejection_input_bounds_and_language_isolation() {
    for (source, language, code) in [
        (
            "#include <iostream>\n#include <string>\nint main(){std::string s;std::getline(std::cin,s);std::cout<<s[0];}",
            "cpp",
            "E_INPUT_KIND",
        ),
        ("int main(){return 'a';}", "c", "E_UNSUPPORTED_SYNTAX"),
        (
            "#include <stdio.h>\nint main(){int a;scanf(\"%s\",&a);}",
            "c",
            "E_UNSUPPORTED_SYNTAX",
        ),
    ] {
        error(source, language, code);
    }
    let src = sample("strings.cpp");
    for input in [
        lines(&["é"]),
        lines(&["a\nb"]),
        lines(&["1234567890123456789012345678901"]),
        ints(&[1000]),
    ] {
        assert!(run_with(&src, "cpp", input, &mut meter()).is_err());
    }
    let r = run(&src, "cpp", lines(&["a"]));
    assert_eq!(r["terminal"]["code"], "E_INPUT_EXHAUSTED");
    roundtrip(&r);
    let src = "#include <iostream>\n#include <string>\nint main(){std::string s;std::getline(std::cin,s);std::cout<<s[0];}";
    let r = run(src, "cpp", lines(&[""]));
    assert_eq!(r["terminal"]["code"], "E_STRING_BOUNDS");
    roundtrip(&r);
}

#[test]
fn modified_numeric_sources_change_actual_results() {
    for (name, from, to, input, want) in [
        (
            "eratos.cpp",
            "std::cout<<i<<",
            "std::cout<<i+1<<",
            vec![5],
            "3 4 6 ",
        ),
        (
            "euler.cpp",
            "std::cout<<primes[i]<<",
            "std::cout<<primes[i]+1<<",
            vec![5],
            "3 4 6 ",
        ),
        (
            "kadane.cpp",
            "current=current+a[i]",
            "current=current-a[i]",
            vec![3, 1, 2, 3],
            "3",
        ),
        ("lis.cpp", "a[j]<a[i]", "a[j]<=a[i]", vec![3, 3, 3, 3], "3"),
    ] {
        let source = sample(name);
        assert!(source.contains(from));
        let r = run(&source.replace(from, to), "cpp", ints(&input));
        completed(&r);
        assert_eq!(replay(&r)["output"], want);
        roundtrip(&r);
    }
}
