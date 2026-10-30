use c_viz_algorithm::{
    budget::{Limits, Meter},
    codec, p1,
};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut m = Meter::new();
    m.set_clock(1000, Box::new(|| 0));
    m
}
fn run_with(
    source: &str,
    language: &str,
    input: &[i32],
    m: &mut Meter,
) -> Result<Value, &'static str> {
    let request = json!({"execVersion":"1.2.0","dslVersion":"1.1.0","diagnosticVersion":"1.1.0","integerEncoding":"1.0.0","language":language,"engineId":"engine.rust.p1","runId":"run.test","sourceRevision":"source.1","source":source,"input":input});
    let bytes = codec::encode(&request, &mut meter(), 65536).unwrap();
    p1::execute(&bytes, &"f".repeat(64), m).map(|b| serde_json::from_slice(&b).unwrap())
}
fn run(source: &str, language: &str, input: &[i32]) -> Value {
    run_with(source, language, input, &mut meter()).unwrap()
}
fn replay(result: &Value) -> Value {
    let trace = &result["trace"];
    let mut state = trace["initialState"].clone();
    for step in trace["steps"].as_array().unwrap() {
        p1::apply_changes(&mut state, step["changes"].as_array().unwrap(), false).unwrap();
    }
    state
}
fn roundtrip(result: &Value) {
    let trace = &result["trace"];
    let mut state = trace["initialState"].clone();
    let mut returned_frame = None;
    for step in trace["steps"].as_array().unwrap() {
        p1::apply_changes(&mut state, step["changes"].as_array().unwrap(), false).unwrap();
        if step["kind"] == "function.return" {
            returned_frame = Some((state.clone(), step.clone()));
        }
        if step["seq"].as_u64().unwrap() % 128 == 0 {
            assert_eq!(
                state,
                trace["checkpoints"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["cursor"] == step["seq"])
                    .unwrap()["state"]
            );
        }
    }
    let end = state.clone();
    for step in trace["steps"].as_array().unwrap().iter().rev() {
        p1::apply_changes(&mut state, step["changes"].as_array().unwrap(), true).unwrap();
    }
    assert_eq!(state, trace["initialState"]);
    for step in trace["steps"].as_array().unwrap() {
        p1::apply_changes(&mut state, step["changes"].as_array().unwrap(), false).unwrap();
    }
    assert_eq!(state, end);
    if let Some((mut after, step)) = returned_frame {
        let count = after["frames"].as_array().unwrap().len();
        p1::apply_changes(&mut after, step["changes"].as_array().unwrap(), true).unwrap();
        assert_eq!(after["frames"].as_array().unwrap().len(), count + 1);
    }
}

const C: &str = "#include <stdio.h>\nint fact(int n) { if(n<2){return 1;} int x=n; return x*fact(n-1); } int main(void){int x=5; printf(\"%d %d\\n\",fact(x),x); return 0;}";
const HANOI: &str = "#include <iostream>\nvoid hanoi(int n,int a,int b,int c){if(n==0){return;} hanoi(n-1,a,c,b); std::cout << a << \"->\" << c << \"\\n\"; hanoi(n-1,b,a,c);} int main(){int n; std::cin >> n; hanoi(n,1,2,3); return 0;}";
const QUICK: &str = "#include <iostream>\nvoid quick(int a[],int lo,int hi){if(lo>=hi){return;} int i=lo;int j=hi;int p=a[(lo+hi)/2];while(i<=j){while(a[i]<p){i=i+1;}while(a[j]>p){j=j-1;}if(i<=j){int t=a[i];a[i]=a[j];a[j]=t;i=i+1;j=j-1;}}if(lo<j){quick(a,lo,j);}if(i<hi){quick(a,i,hi);}}int main(){int a[7];for(int i=0;i<7;i=i+1){std::cin>>a[i];}quick(a,0,6);for(int i=0;i<7;i=i+1){std::cout<<a[i]<<\" \";}return 0;}";

#[test]
fn c_parameters_locals_recursion_and_returned_frame_are_real() {
    let r = run(C, "c", &[]);
    assert_eq!(r["terminal"]["status"], "completed");
    assert_eq!(replay(&r)["output"], "120 5\n");
    roundtrip(&r);
    let changed = run(&C.replace("int x=5", "int x=6"), "c", &[]);
    assert_eq!(replay(&changed)["output"], "720 6\n");
}
#[test]
fn cpp_hanoi_uses_real_input_and_source_edits() {
    for n in [0, 1, 3, 5] {
        let r = run(HANOI, "cpp", &[n]);
        assert_eq!(r["terminal"]["status"], "completed", "{r}");
        assert_eq!(
            replay(&r)["output"].as_str().unwrap().lines().count(),
            (1usize << n) - 1
        );
        roundtrip(&r);
    }
    let r = run(
        &HANOI.replace("hanoi(n,1,2,3)", "hanoi(n,3,2,1)"),
        "cpp",
        &[1],
    );
    assert_eq!(replay(&r)["output"], "3->1\n");
}
#[test]
fn cpp_quick_sort_array_aliases_all_equal_reverse_and_negatives() {
    for input in [
        [7, 6, 5, 4, 3, 2, 1],
        [3, 3, 3, 3, 3, 3, 3],
        [-9, 4, -1, 0, 4, 7, -9],
    ] {
        let r = run(QUICK, "cpp", &input);
        assert_eq!(r["terminal"]["status"], "completed", "{:?}", r["terminal"]);
        let mut expected = input.to_vec();
        expected.sort();
        assert_eq!(
            replay(&r)["output"].as_str().unwrap(),
            expected.iter().map(|n| format!("{n} ")).collect::<String>()
        );
        roundtrip(&r);
    }
}
#[test]
fn stack_32_is_allowed_33_is_limited_with_reversible_prefix() {
    let source = "int f(int n){if(n==0){return 7;}return f(n-1);}int main(){return f(30);}";
    let r = run(source, "c", &[]);
    assert_eq!(r["terminal"]["status"], "completed");
    assert_eq!(r["terminal"]["returnValue"], 7);
    let r = run(&source.replace("f(30)", "f(31)"), "c", &[]);
    assert_eq!(r["terminal"]["code"], "E_STACK_LIMIT");
    assert_eq!(r["trace"]["completeness"], "prefix");
    roundtrip(&r);
}
#[test]
fn errors_check_dead_code_and_do_not_partially_write_or_output() {
    for (source, code) in [
        ("int main(){int a[1]={3};a[1]=4;return 0;}", "E_BOUNDS"),
        ("int main(){int x;return x;}", "E_UNINITIALIZED"),
        ("int main(){return 4/0;}", "E_DIV_ZERO"),
        ("int main(){return 2147483647+1;}", "E_OVERFLOW"),
        (
            "int f(int n){return n;}int main(){if(0){return f();}return 0;}",
            "E_ARGUMENTS",
        ),
        (
            "int main(){if(0){return missing;}return 0;}",
            "E_UNDECLARED",
        ),
        ("void f(){return 1;}int main(){return 0;}", "E_TYPE_INVALID"),
    ] {
        let r = run(source, "c", &[]);
        assert_eq!(r["terminal"]["code"], code, "{source}");
        if !r["trace"].is_null() {
            roundtrip(&r);
        }
    }
}
#[test]
fn budgets_cancel_deadline_and_input_are_separate() {
    let source = "int main(){while(1){;}return 0;}";
    let mut m = Meter::with_limits(Limits {
        steps: 10,
        ..Default::default()
    });
    m.set_clock(1000, Box::new(|| 0));
    let r = run_with(source, "c", &[], &mut m).unwrap();
    assert_eq!(r["terminal"]["code"], "E_STEP_LIMIT");
    assert_eq!(r["trace"]["steps"].as_array().unwrap().len(), 10);
    roundtrip(&r);
    let mut m = meter();
    m.set_cancel(Box::new(|| true));
    assert_eq!(
        run_with(source, "c", &[], &mut m).unwrap_err(),
        "E_CANCELLED"
    );
    let mut m = meter();
    m.set_clock(0, Box::new(|| 0));
    assert_eq!(
        run_with(source, "c", &[], &mut m).unwrap_err(),
        "E_DEADLINE"
    );
    let r = run(
        "#include <iostream>\nint main(){int x;std::cin>>x;return x;}",
        "cpp",
        &[],
    );
    assert_eq!(r["terminal"]["code"], "E_INPUT_EXHAUSTED");
    assert!(run_with("int main(){return 0;}", "c", &[1000], &mut meter()).is_err());
}
#[test]
fn original_utf8_crlf_nodes_and_language_dispatch_stay_distinct() {
    let source = "#include <iostream>\r\n//中😀\r\nint main(){std::cout<<\"中😀\";return 0;}";
    let r = run(source, "cpp", &[]);
    assert_eq!(r["terminal"]["status"], "completed");
    assert_eq!(replay(&r)["output"], "中😀");
    for n in r["nodeMap"].as_array().unwrap() {
        let start = n["byteRange"]["start"].as_u64().unwrap() as usize;
        let end = n["byteRange"]["end"].as_u64().unwrap() as usize;
        assert!(source.get(start..end).is_some());
    }
    let c = run(source, "c", &[]);
    assert_eq!(c["terminal"]["status"], "error");
    assert!(c["trace"].is_null());
}

#[test]
fn public_fixtures_are_executed_and_fully_reversible() {
    let c = run(
        include_str!("../../../shared/fixtures/p1/functions.c"),
        "c",
        &[],
    );
    assert_eq!(c["terminal"]["status"], "completed");
    assert_eq!(replay(&c)["output"], "5 99 120\n");
    roundtrip(&c);
    let hanoi = run(
        include_str!("../../../shared/fixtures/p1/hanoi.cpp"),
        "cpp",
        &[3],
    );
    assert_eq!(hanoi["terminal"]["status"], "completed");
    assert_eq!(
        replay(&hanoi)["output"].as_str().unwrap().lines().count(),
        7
    );
    roundtrip(&hanoi);
    let sort = run(
        include_str!("../../../shared/fixtures/p1/quicksort.cpp"),
        "cpp",
        &[5, -1, 2, 2, 0],
    );
    assert_eq!(sort["terminal"]["status"], "completed");
    assert_eq!(replay(&sort)["output"], "-1 0 2 2 5 \n");
    roundtrip(&sort);
}

#[test]
fn function_names_obey_lexical_bindings_and_return_steps_point_at_return_source() {
    let r = run(
        "int f(){return 7;}int main(){int f=0;return f();}",
        "c",
        &[],
    );
    assert_eq!(r["terminal"]["code"], "E_TYPE_INVALID");
    assert!(r["trace"].is_null());
    let r = run(C, "c", &[]);
    for step in r["trace"]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["kind"] == "function.return")
    {
        let node = r["nodeMap"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["nodeId"] == step["nodeId"])
            .unwrap();
        assert_eq!(node["kind"], "return");
    }
}

#[test]
fn cpp_assignment_rhs_is_sequenced_before_lhs_and_array_initializers_are_explicitly_narrowed() {
    let source =
        "int f(int a[]){a[0]=1;return 7;}int main(){int a[3]={0,0,0};a[a[0]]=f(a);return a[1];}";
    let r = run(source, "cpp", &[]);
    assert_eq!(r["terminal"]["status"], "completed");
    assert_eq!(r["terminal"]["returnValue"], 7);
    roundtrip(&r);
    let r = run("int main(){int a[2]={1,a[0]};return a[1];}", "cpp", &[]);
    assert_eq!(r["terminal"]["code"], "E_UNSUPPORTED_SYNTAX");
    assert!(r["trace"].is_null());
}

#[test]
fn combination_of_source_nesting_and_recursion_is_limited_before_host_stack_overflows() {
    let source = format!(
        "int f(int n){{if(n==0){{return 0;}}{}return f(n-1);{}}}int main(){{return f(30);}}",
        "{".repeat(27),
        "}".repeat(27)
    );
    let r = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || run(&source, "c", &[]))
        .unwrap()
        .join()
        .unwrap();
    assert_eq!(r["terminal"]["code"], "E_DEPTH_LIMIT");
    assert_eq!(r["trace"]["completeness"], "prefix");
    roundtrip(&r);
}

#[test]
fn public_quick_sort_supports_full_thirty_items_without_relaxing_budgets() {
    let source = include_str!("../../../shared/fixtures/p1/quicksort.cpp")
        .replace("a[5]", "a[30]")
        .replace("i < 5", "i < 30")
        .replace("0, 4", "0, 29");
    for input in [(0..30).rev().collect::<Vec<i32>>(), vec![4; 30]] {
        let r = run(&source, "cpp", &input);
        assert_eq!(r["terminal"]["status"], "completed", "{:?}", r["terminal"]);
        let mut expected = input;
        expected.sort();
        let expected = format!(
            "{}\n",
            expected.iter().map(|n| format!("{n} ")).collect::<String>()
        );
        assert_eq!(replay(&r)["output"], expected);
        roundtrip(&r);
    }
}

#[test]
fn released_large_arrays_keep_virtual_addresses_above_the_wasm_pointer_width() {
    let r = run("int main(){while(1){int a[262144];}}", "cpp", &[]);
    assert_eq!(r["terminal"]["code"], "E_STEP_LIMIT");
    let mut maximum = 0;
    for step in r["trace"]["steps"].as_array().unwrap() {
        for change in step["changes"].as_array().unwrap() {
            if change["op"] == "allocator" {
                let before = change["before"]["nextAddress"].as_u64().unwrap();
                let after = change["after"]["nextAddress"].as_u64().unwrap();
                assert!(after >= before);
                maximum = maximum.max(after);
                assert!(change["after"]["liveBytes"].as_u64().unwrap() <= 1_048_576);
            }
        }
    }
    assert!(maximum > u32::MAX as u64);
    roundtrip(&r);
}
