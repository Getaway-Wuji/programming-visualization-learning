use c_viz_advanced::{
    budget::{Limits, Meter},
    codec, runtime,
};
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
    input: &[i32],
    meter: &mut Meter,
) -> Result<Value, &'static str> {
    let request = json!({
        "execVersion":"1.4.0", "dslVersion":"1.3.0", "diagnosticVersion":"1.3.0",
        "integerEncoding":"1.0.0", "language":language, "engineId":"engine.rust.advanced",
        "runId":"memory.test", "sourceRevision":"source.1", "source":source, "input":{"kind":"integers","values":input},
    });
    let bytes = codec::encode(&request, &mut self::meter(), 65536).unwrap();
    runtime::execute(&bytes, &"f".repeat(64), meter)
        .map(|bytes| codec::decode(&bytes, &mut self::meter(), 16_777_216).unwrap())
}
fn run(source: &str, language: &str, input: &[i32]) -> Value {
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
    let result = run(source, language, &[]);
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

const POINTERS: &str = include_str!("../../../shared/fixtures/memory/pointers.c");
const DANGLING: &str = include_str!("../../../shared/fixtures/memory/dangling.c");
const LIST: &str = include_str!("../../../shared/fixtures/memory/list.cpp");
const TREE: &str = include_str!("../../../shared/fixtures/memory/tree.cpp");
const BUCKETS: &str = include_str!("../../../shared/fixtures/memory/buckets.cpp");

#[test]
fn c_pointer_parameters_offsets_and_source_edits_change_real_objects() {
    let result = run(POINTERS, "c", &[]);
    completed(&result);
    assert_eq!(replay(&result)["output"], "9 6\n");
    roundtrip(&result);
    let edited = run(&POINTERS.replace("set(p, 9)", "set(p, -7)"), "c", &[]);
    completed(&edited);
    assert_eq!(replay(&edited)["output"], "-7 6\n");
    roundtrip(&edited);
}

#[test]
fn c_pointer_return_and_block_exit_leave_dangling_identity_without_reuse() {
    let result = error(DANGLING, "c", "E_DANGLING_POINTER");
    let state = replay(&result);
    assert!(
        state["objects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|object| object["name"] == "local" && object["alive"] == false)
    );
    for language in ["c", "cpp"] {
        error(
            "int main(){int* p=0;{int local=7;p=&local;}int replacement=99;return *p;}",
            language,
            "E_DANGLING_POINTER",
        );
        let good = run(
            "int* same(int* p){return p;}int main(){int n=7;int* p=same(&n);*p=9;return n;}",
            language,
            &[],
        );
        completed(&good);
        assert_eq!(good["terminal"]["returnValue"], 9);
        roundtrip(&good);
    }
}

#[test]
fn null_uninitialized_one_past_and_outside_provenance_are_distinct() {
    for language in ["c", "cpp"] {
        let cancelled_indirection = run(
            "int main(){int* p=0;int* q=&*p;return q==p;}",
            language,
            &[],
        );
        completed(&cancelled_indirection);
        assert_eq!(cancelled_indirection["terminal"]["returnValue"], 1);
        roundtrip(&cancelled_indirection);
        let address_past = run(
            "int main(){int a[2]={3,7};int* p=&a[2];int* q=&*p;q=q-1;return *q;}",
            language,
            &[],
        );
        completed(&address_past);
        assert_eq!(address_past["terminal"]["returnValue"], 7);
        assert!(
            address_past["trace"]["steps"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|step| step["changes"].as_array().unwrap())
                .any(|change| change["op"] == "cell"
                    && change["after"]["byteOffset"] == 8
                    && change["after"]["lowerBound"] == 0
                    && change["after"]["upperBound"] == 8)
        );
        roundtrip(&address_past);
        error("int main(){int* p;return *p;}", language, "E_UNINITIALIZED");
        error(
            "int main(){int* p=0;return *p;}",
            language,
            "E_NULL_POINTER",
        );
        error(
            "int main(){int a[2]={3,7};int* p=a+2;return *p;}",
            language,
            "E_POINTER_BOUNDS",
        );
        error(
            "int main(){int a[2]={3,7};int* p=a+3;return 0;}",
            language,
            "E_POINTER_BOUNDS",
        );
        let one_past = run(
            "int main(){int a[2]={3,7};int* p=a+2;p=p-1;return *p;}",
            language,
            &[],
        );
        completed(&one_past);
        assert_eq!(one_past["terminal"]["returnValue"], 7);
        roundtrip(&one_past);
    }
    error(
        "struct Pair{int first;int second;};int main(){Pair p{};p.second=77;int* q=&p.first;q=q+1;return *q;}",
        "cpp",
        "E_POINTER_BOUNDS",
    );
    let legal = run(
        "struct Pair{int first;int second;};int main(){Pair p{};int* q=&p.second;*q=77;return p.second;}",
        "cpp",
        &[],
    );
    completed(&legal);
    assert_eq!(legal["terminal"]["returnValue"], 77);
    roundtrip(&legal);
}

#[test]
fn cpp_new_default_zero_and_heap_lifetime_differ_from_automatic_storage() {
    error(
        "int main(){int* p=new int;return *p;}",
        "cpp",
        "E_UNINITIALIZED",
    );
    let result = run(
        "int* make(){int* p=new int{};return p;}int main(){int* p=make();int n=*p;*p=8;delete p;return n;}",
        "cpp",
        &[],
    );
    completed(&result);
    assert_eq!(result["terminal"]["returnValue"], 0);
    let end = replay(&result);
    assert_eq!(end["allocator"]["liveBytes"], 0);
    assert!(
        end["objects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|object| object["storage"] == "heap" && object["alive"] == false)
    );
    roundtrip(&result);
    let node = run(
        "struct Node{int value;Node* next;};int main(){Node* p=new Node{};int n=p->value;if(p->next==nullptr){n=n+1;}delete p;return n;}",
        "cpp",
        &[],
    );
    completed(&node);
    assert_eq!(node["terminal"]["returnValue"], 1);
    roundtrip(&node);
}

#[test]
fn cpp_delete_rejects_stale_automatic_interior_and_one_past_references() {
    error(
        "int main(){int* p=new int{};int* alias=p;delete p;return *alias;}",
        "cpp",
        "E_DANGLING_POINTER",
    );
    error(
        "int main(){int* p=new int{};delete p;delete p;return 0;}",
        "cpp",
        "E_DOUBLE_DELETE",
    );
    error(
        "int main(){int n=3;int* p=&n;delete p;return 0;}",
        "cpp",
        "E_INVALID_DELETE",
    );
    error(
        "struct N{int a;int b;};int main(){N* p=new N{};int* q=&p->b;delete q;return 0;}",
        "cpp",
        "E_INVALID_DELETE",
    );
    error(
        "int main(){int* p=new int{};p=p+1;delete p;return 0;}",
        "cpp",
        "E_INVALID_DELETE",
    );
    let null = run("int main(){int* p=nullptr;delete p;return 7;}", "cpp", &[]);
    completed(&null);
    assert_eq!(null["terminal"]["returnValue"], 7);
    roundtrip(&null);
}

#[test]
fn cpp_link_insert_unlink_and_real_release_restore_at_every_cursor() {
    for input in [[1, 2, 3], [-9, 0, -9], [4, 4, 4]] {
        let result = run(LIST, "cpp", &input);
        completed(&result);
        let expected = format!(
            "{} {} {} \n{} {} \n",
            input[0], input[1], input[2], input[0], input[2]
        );
        assert_eq!(replay(&result)["output"], expected);
        assert_eq!(replay(&result)["allocator"]["liveBytes"], 0);
        assert_eq!(
            replay(&result)["objects"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|o| o["storage"] == "heap")
                .count(),
            3
        );
        roundtrip(&result);
    }
    let result = run(
        &LIST.replace("head->next = tail;", "head->next = nullptr;"),
        "cpp",
        &[1, 2, 3],
    );
    completed(&result);
    assert_eq!(replay(&result)["output"], "1 2 3 \n1 \n");
    roundtrip(&result);
}

#[test]
fn cpp_bst_recursive_pointer_returns_and_duplicate_values_are_real() {
    for input in [vec![0], vec![5, 5, 3, 7, 3, 9], vec![5, 9, 7, 5, 3, 1]] {
        let result = run(TREE, "cpp", &input);
        completed(&result);
        let mut values = input[1..].to_vec();
        values.sort();
        let expected = values
            .iter()
            .map(|value| format!("{value} "))
            .collect::<String>()
            + "\n";
        assert_eq!(replay(&result)["output"], expected);
        assert_eq!(replay(&result)["allocator"]["liveBytes"], 0);
        roundtrip(&result);
    }
}

#[test]
fn cpp_bucket_pointer_array_and_recursive_sorted_chains_use_original_input() {
    for input in [vec![0], vec![6, 8, 0, 3, 8, 1, 4], vec![4, 7, 7, 7, 7]] {
        let result = run(BUCKETS, "cpp", &input);
        completed(&result);
        let mut values = input[1..].to_vec();
        values.sort();
        assert_eq!(
            replay(&result)["output"],
            values
                .iter()
                .map(|value| format!("{value} "))
                .collect::<String>()
                + "\n"
        );
        assert_eq!(replay(&result)["allocator"]["liveBytes"], 0);
        roundtrip(&result);
    }
    let result = run(BUCKETS, "cpp", &[1, 9]);
    assert_eq!(result["terminal"]["code"], "E_POINTER_BOUNDS");
    roundtrip(&result);
}

#[test]
fn static_type_and_language_failures_never_produce_a_partial_execution() {
    for (source, language) in [
        ("int main(){int* p=0;if(0){int n=p;}return 0;}", "cpp"),
        (
            "struct N{int value;};int main(){int x=0;N* p=&x;return 0;}",
            "cpp",
        ),
        ("int main(){int* p=nullptr;return 0;}", "c"),
        ("int main(){int* p=new int;return 0;}", "c"),
        ("int main(){int* p=NULL;return 0;}", "c"),
        ("struct N{int value;};int main(){N n;return 0;}", "c"),
        ("int main(){int* p=(int*)1234;return 0;}", "cpp"),
        ("int main(){int** p;return 0;}", "cpp"),
        ("int main(){delete 0;return 0;}", "cpp"),
        ("int main(){delete nullptr;return 0;}", "cpp"),
    ] {
        let result = run(source, language, &[]);
        assert_eq!(result["terminal"]["status"], "error", "{source}");
        assert!(result["trace"].is_null(), "{source}");
    }
    let null = run(
        "#include <stddef.h>\nint main(void){int* p=NULL;return p==0;}",
        "c",
        &[],
    );
    completed(&null);
    assert_eq!(null["terminal"]["returnValue"], 1);
    roundtrip(&null);
}

#[test]
fn object_layout_and_pointer_values_preserve_provenance_and_unicode_source_ranges() {
    let source = "//中😀\r\nstruct Pair{int first;int second;};int main(){Pair pair{};int* a=&pair.first;int* b=&pair.second;return a==b;}";
    let result = run(source, "cpp", &[]);
    completed(&result);
    assert_eq!(result["terminal"]["returnValue"], 0);
    let pair = result["types"]
        .as_array()
        .unwrap()
        .iter()
        .find(|ty| ty["name"] == "Pair")
        .unwrap();
    assert_eq!(pair["byteSize"], 8);
    assert_eq!(pair["fields"][0]["byteOffset"], 0);
    assert_eq!(pair["fields"][1]["byteOffset"], 4);
    for node in result["nodeMap"].as_array().unwrap() {
        let start = node["byteRange"]["start"].as_u64().unwrap() as usize;
        let end = node["byteRange"]["end"].as_u64().unwrap() as usize;
        assert!(source.get(start..end).is_some());
    }
    let pointer_values = result["trace"]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|step| step["changes"].as_array().unwrap())
        .filter(|change| change["op"] == "cell" && change["after"].is_object())
        .map(|change| &change["after"])
        .collect::<Vec<_>>();
    assert!(
        pointer_values
            .iter()
            .any(|pointer| pointer["lowerBound"] == 0 && pointer["upperBound"] == 4)
    );
    assert!(
        pointer_values
            .iter()
            .any(|pointer| pointer["lowerBound"] == 4 && pointer["upperBound"] == 8)
    );
    roundtrip(&result);
}

#[test]
fn heap_and_live_memory_limits_admit_the_boundary_without_relaxing_budgets() {
    let result = run(
        "int main(){for(int i=0;i<128;i=i+1){new int{};}return 0;}",
        "cpp",
        &[],
    );
    completed(&result);
    assert_eq!(
        replay(&result)["objects"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|object| object["storage"] == "heap" && object["alive"] == true)
            .count(),
        128
    );
    roundtrip(&result);
    error(
        "int main(){for(int i=0;i<129;i=i+1){new int{};}return 0;}",
        "cpp",
        "E_HEAP_LIMIT",
    );
    let array = run(
        "struct N{int a;N* next;};int main(){N items[87381]{};return 0;}",
        "cpp",
        &[],
    );
    completed(&array);
    roundtrip(&array);
    error(
        "struct N{int a;N* next;};int main(){N items[87382]{};return 0;}",
        "cpp",
        "E_MEMORY_LIMIT",
    );
}

#[test]
fn recursion_and_combined_host_depth_preserve_reversible_prefixes() {
    let source = "int f(int n){if(n==0){return 7;}return f(n-1);}int main(){return f(30);}";
    let result = run(source, "c", &[]);
    completed(&result);
    assert_eq!(result["terminal"]["returnValue"], 7);
    roundtrip(&result);
    error(&source.replace("f(30)", "f(31)"), "c", "E_STACK_LIMIT");
    let deep = format!(
        "int f(int n){{if(n==0){{return 0;}}{}return f(n-1);{}}}int main(){{return f(30);}}",
        "{".repeat(27),
        "}".repeat(27)
    );
    let result = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || run(&deep, "c", &[]))
        .unwrap()
        .join()
        .unwrap();
    assert_eq!(result["terminal"]["code"], "E_DEPTH_LIMIT");
    roundtrip(&result);
}

#[test]
fn step_cancel_deadline_and_input_failures_are_not_successful_runs() {
    let mut bounded = Meter::with_limits(Limits {
        steps: 10,
        ..Default::default()
    });
    bounded.set_clock(1000, Box::new(|| 0));
    let result = run_with("int main(){while(1){;}}", "c", &[], &mut bounded).unwrap();
    assert_eq!(result["terminal"]["code"], "E_STEP_LIMIT");
    assert_eq!(result["trace"]["steps"].as_array().unwrap().len(), 10);
    roundtrip(&result);
    let mut cancelled = meter();
    cancelled.set_cancel(Box::new(|| true));
    assert_eq!(
        run_with(POINTERS, "c", &[], &mut cancelled).unwrap_err(),
        "E_CANCELLED"
    );
    let mut expired = meter();
    expired.set_clock(0, Box::new(|| 0));
    assert_eq!(
        run_with(POINTERS, "c", &[], &mut expired).unwrap_err(),
        "E_DEADLINE"
    );
    let input = run(LIST, "cpp", &[1]);
    assert_eq!(input["terminal"]["code"], "E_INPUT_EXHAUSTED");
    roundtrip(&input);
    assert!(run_with(LIST, "cpp", &[1000], &mut meter()).is_err());
}

#[test]
fn equivalent_zero_initialization_counts_all_logical_slots_without_dense_expansion() {
    let array_empty = run("int main(){int a[2]={};return a[0]+a[1];}", "cpp", &[]);
    let array_zero = run("int main(){int a[2]={0};return a[0]+a[1];}", "cpp", &[]);
    completed(&array_empty);
    completed(&array_zero);
    assert_eq!(
        replay(&array_empty)["counters"],
        replay(&array_zero)["counters"]
    );
    assert_eq!(replay(&array_empty)["counters"]["arrayWrites"], 2);
    for source in [
        "int main(){int x{};return x;}",
        "int main(){int x=0;return x;}",
    ] {
        let result = run(source, "cpp", &[]);
        completed(&result);
        assert_eq!(replay(&result)["counters"]["scalarWrites"], 1);
        roundtrip(&result);
    }
    for suffix in ["{}", "={0}"] {
        let result = run(
            &format!("struct Pair{{int x;int* p;}};int main(){{Pair pair{suffix};return pair.x;}}"),
            "cpp",
            &[],
        );
        completed(&result);
        assert_eq!(replay(&result)["counters"]["scalarWrites"], 2);
        roundtrip(&result);
    }
    let array = run(
        "struct Pair{int x;int* p;};int main(){Pair pairs[3]{};return pairs[2].x;}",
        "cpp",
        &[],
    );
    completed(&array);
    assert_eq!(replay(&array)["counters"]["arrayWrites"], 6);
    roundtrip(&array);
    let heap = run(
        "struct Pair{int x;int* p;};int main(){new Pair{};return 0;}",
        "cpp",
        &[],
    );
    completed(&heap);
    assert_eq!(replay(&heap)["counters"]["scalarWrites"], 2);
    roundtrip(&heap);
    roundtrip(&array_empty);
    roundtrip(&array_zero);
}
