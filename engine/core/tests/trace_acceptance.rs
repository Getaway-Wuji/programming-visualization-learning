//! Task 06.3 acceptance against real checked C execution and STEP-01 replay.
//! No fixture is used as a substitute for an interpreter-produced trace.

use c_viz_core::diagnostic::DiagnosticCode;
use c_viz_core::runtime::{ExecutionOutcome, TracedExecution, execute, execute_traced};
use c_viz_core::semantic::analyze;
use c_viz_core::trace::{Direction, Step, Trace, apply_step, restore, validate_trace};
use serde_json::{Value, json};

fn run(source: &str) -> TracedExecution {
    let checked = analyze(source)
        .unwrap_or_else(|error| panic!("trace source must pass checking: {source:?}: {error:?}"));
    let traced = execute_traced(&checked);
    validate_trace(&traced.trace, &traced.node_map).unwrap_or_else(|error| {
        panic!("producer emitted an invalid trace for {source:?}: {error:?}")
    });
    traced
}

fn fragment(body: &str) -> TracedExecution {
    run(&format!("int main(void){{{body}}}"))
}

fn state_at(trace: &Trace, cursor: usize) -> Value {
    restore(trace, cursor).expect("every retained cursor must be restorable")
}

fn final_state(traced: &TracedExecution) -> Value {
    state_at(&traced.trace, traced.trace.steps.len())
}

fn step_index(trace: &Trace, kind: &str) -> usize {
    trace
        .steps
        .iter()
        .position(|step| step.kind == kind)
        .unwrap()
}

fn objects(state: &Value) -> &[Value] {
    state["objects"].as_array().unwrap()
}

fn object<'a>(state: &'a Value, name: &str) -> &'a Value {
    let matching = objects(state)
        .iter()
        .filter(|object| object["name"] == name)
        .collect::<Vec<_>>();
    assert_eq!(matching.len(), 1, "expected one live object named {name}");
    matching[0]
}

fn slot(object: &Value, index: usize) -> Option<i64> {
    assert!(index < object["length"].as_u64().unwrap() as usize);
    object["cells"]
        .as_array()
        .unwrap()
        .iter()
        .find(|cell| cell["index"] == index)
        .map_or_else(
            || object["defaultValue"].as_i64(),
            |cell| cell["value"].as_i64(),
        )
}

fn observations<'a>(trace: &'a Trace, kind: &'a str) -> impl Iterator<Item = &'a Value> {
    trace
        .steps
        .iter()
        .flat_map(|step| &step.observations)
        .filter(move |item| item["kind"] == kind)
}

fn source_text<'a>(source: &'a str, traced: &TracedExecution, node_id: &Value) -> &'a str {
    let nodes = serde_json::to_value(&traced.node_map).unwrap();
    let node = nodes
        .as_array()
        .unwrap()
        .iter()
        .find(|node| &node["nodeId"] == node_id)
        .unwrap();
    let start = node["byteRange"]["start"].as_u64().unwrap() as usize;
    let end = node["byteRange"]["end"].as_u64().unwrap() as usize;
    &source[start..end]
}

fn assert_round_trip(trace: &Trace) {
    let mut current = trace.initial_state.clone();
    let mut states = vec![current.clone()];
    for step in &trace.steps {
        let before = current.clone();
        apply_step(&mut current, step, Direction::Forward).unwrap();
        let after = current.clone();
        apply_step(&mut current, step, Direction::Backward).unwrap();
        assert_eq!(current, before, "single-step reverse at seq {}", step.seq);
        apply_step(&mut current, step, Direction::Forward).unwrap();
        assert_eq!(current, after, "repeat forward at seq {}", step.seq);
        states.push(current.clone());
    }
    for (index, step) in trace.steps.iter().enumerate().rev() {
        apply_step(&mut current, step, Direction::Backward).unwrap();
        assert_eq!(current, states[index], "reverse cursor {index}");
    }
    assert_eq!(current, trace.initial_state);
}

fn assert_rejected_without_mutation(state: Value, step: &Step) {
    let mut current = state.clone();
    assert!(apply_step(&mut current, step, Direction::Forward).is_err());
    assert_eq!(
        current, state,
        "a rejected atomic step cannot partially mutate state"
    );
}

#[test]
fn empty_main_has_exactly_enter_and_implicit_return() {
    let traced = run("int main(){}");
    assert_eq!(traced.trace.dsl_version, "1.0.0");
    assert_eq!(traced.trace.completeness, "complete");
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .map(|step| step.kind.as_str())
            .collect::<Vec<_>>(),
        ["program.enter", "program.return"]
    );
    assert_eq!(traced.trace.steps[1].location["kind"], "synthetic");
    assert_eq!(traced.trace.steps[1].location["reason"], "implicit-return");
    assert_eq!(final_state(&traced)["control"]["returnValue"], 0);
}

#[test]
fn initial_state_has_every_required_empty_component_and_exact_allocator() {
    let traced = fragment("int x=9;");
    let initial = &traced.trace.initial_state;
    assert_eq!(initial.as_object().unwrap().len(), 7);
    for table in ["frames", "scopes", "objects"] {
        assert_eq!(initial[table], json!([]));
    }
    assert_eq!(initial["output"], "");
    assert_eq!(initial["control"]["phase"], "ready");
    assert!(initial["control"]["activeFrameId"].is_null());
    assert!(initial["control"]["returnValue"].is_null());
    assert_eq!(initial["control"]["flowStack"], json!([]));
    assert_eq!(
        initial["allocator"],
        json!({"nextAddress":4096,"liveBytes":0,"nextObject":1,"nextScope":1,"nextFrame":1})
    );
    assert_eq!(
        initial["counters"],
        json!({"comparisons":0,"scalarWrites":0,"arrayWrites":0,"swaps":0})
    );
    assert_eq!(traced.trace.checkpoints[0].cursor, 0);
    assert_eq!(traced.trace.checkpoints[0].state, *initial);
}

#[test]
fn program_enter_creates_the_only_main_frame_and_owning_scope_together() {
    let traced = fragment("int x;");
    let state = state_at(&traced.trace, 1);
    assert_eq!(state["frames"].as_array().unwrap().len(), 1);
    assert_eq!(state["scopes"].as_array().unwrap().len(), 1);
    assert_eq!(state["scopes"][0]["kind"], "main");
    assert_eq!(state["scopes"][0]["frameId"], state["frames"][0]["id"]);
    assert_eq!(
        state["frames"][0]["scopeIds"],
        json!([state["scopes"][0]["id"]])
    );
    assert_eq!(state["control"]["activeFrameId"], state["frames"][0]["id"]);
    assert_eq!(state["allocator"]["nextFrame"], 2);
    assert_round_trip(&traced.trace);
}

#[test]
fn declaration_and_initialization_are_distinct_steps_with_null_between_them() {
    let traced = fragment("int x=17;");
    let declare = step_index(&traced.trace, "object.declare");
    let initialize = step_index(&traced.trace, "value.initialize");
    assert_eq!(initialize, declare + 1);
    let declared = state_at(&traced.trace, declare + 1);
    let initialized = state_at(&traced.trace, initialize + 1);
    assert_eq!(slot(object(&declared, "x"), 0), None);
    assert_eq!(slot(object(&initialized, "x"), 0), Some(17));
    assert_eq!(declared["counters"]["scalarWrites"], 0);
    assert_eq!(initialized["counters"]["scalarWrites"], 1);
}

#[test]
fn declaration_without_initializer_adds_no_initialization_step() {
    let traced = fragment("int x;int a[2];");
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .filter(|step| step.kind == "object.declare")
            .count(),
        2
    );
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .filter(|step| step.kind == "value.initialize")
            .count(),
        0
    );
    assert_eq!(final_state(&traced)["counters"]["scalarWrites"], 0);
    assert_eq!(final_state(&traced)["counters"]["arrayWrites"], 0);
}

#[test]
fn array_initializer_is_one_atomic_step_and_counts_zero_filled_slots() {
    let traced = fragment("int a[5]={7,0,-2};return a[4];");
    let initialize = step_index(&traced.trace, "value.initialize");
    let state = state_at(&traced.trace, initialize + 1);
    let a = object(&state, "a");
    assert_eq!(a["defaultValue"], 0);
    assert_eq!(
        a["cells"],
        json!([{"index":0,"value":7},{"index":2,"value":-2}])
    );
    assert_eq!(
        (0..5).map(|index| slot(a, index)).collect::<Vec<_>>(),
        vec![Some(7), Some(0), Some(-2), Some(0), Some(0)]
    );
    assert_eq!(state["counters"]["arrayWrites"], 5);
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .filter(|step| step.kind == "value.initialize")
            .count(),
        1
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn uninitialized_array_cells_restore_individually_after_real_writes() {
    let traced = fragment("int a[3];a[1]=0;a[2]=9;return a[0];");
    let end = final_state(&traced);
    assert_eq!(
        (0..3)
            .map(|index| slot(object(&end, "a"), index))
            .collect::<Vec<_>>(),
        vec![None, Some(0), Some(9)]
    );
    assert_eq!(end["counters"]["arrayWrites"], 2);
    assert_eq!(traced.trace.completeness, "prefix");
    assert_round_trip(&traced.trace);
}

#[test]
fn same_value_assignment_remains_a_real_write_with_reversible_counter() {
    let traced = fragment("int x=4;x=4;int a[2]={3,0};a[0]=3;a[1]=0;");
    let state = final_state(&traced);
    assert_eq!(state["counters"]["scalarWrites"], 2);
    assert_eq!(state["counters"]["arrayWrites"], 4);
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .filter(|step| step.kind == "value.write")
            .count(),
        3
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn nested_shadowed_objects_are_restored_in_their_original_order() {
    let traced = fragment("int x=1;{int x=2;int a[2]={3};}return x;");
    let exit = step_index(&traced.trace, "scope.exit");
    let before = state_at(&traced.trace, exit);
    let after = state_at(&traced.trace, exit + 1);
    assert_eq!(objects(&before).len(), 3);
    assert_eq!(objects(&after).len(), 1);
    assert_eq!(slot(object(&after, "x"), 0), Some(1));
    let mut reversed = after;
    apply_step(
        &mut reversed,
        &traced.trace.steps[exit],
        Direction::Backward,
    )
    .unwrap();
    assert_eq!(reversed, before);
    assert_round_trip(&traced.trace);
}

#[test]
fn explicit_return_removes_all_nested_scopes_and_restores_them_as_one_step() {
    let traced = fragment("int x=4;for(int i=0;i<1;i=i+1){{int a[2]={8};return x+a[0];}}");
    let index = step_index(&traced.trace, "program.return");
    assert_eq!(index + 1, traced.trace.steps.len());
    let before = state_at(&traced.trace, index);
    let after = state_at(&traced.trace, index + 1);
    assert!(before["scopes"].as_array().unwrap().len() >= 4);
    assert_eq!(after["frames"], json!([]));
    assert_eq!(after["scopes"], json!([]));
    assert_eq!(after["objects"], json!([]));
    assert_eq!(after["control"]["phase"], "returned");
    assert_eq!(after["control"]["returnValue"], 12);
    assert_eq!(after["allocator"]["liveBytes"], 0);
    let mut reversed = after;
    apply_step(
        &mut reversed,
        &traced.trace.steps[index],
        Direction::Backward,
    )
    .unwrap();
    assert_eq!(reversed, before);
}

#[test]
fn break_is_one_jump_that_destroys_nested_body_objects_and_skips_update() {
    let traced = fragment("for(int i=0;1;i=1/0){int a[2];{int b[3];break;}}return 7;");
    let jumps = traced
        .trace
        .steps
        .iter()
        .enumerate()
        .filter(|(_, step)| step.kind == "control.jump")
        .collect::<Vec<_>>();
    assert_eq!(jumps.len(), 1);
    let (index, _) = jumps[0];
    let before = state_at(&traced.trace, index);
    let after = state_at(&traced.trace, index + 1);
    assert!(objects(&before).iter().any(|object| object["name"] == "b"));
    assert!(
        !objects(&after)
            .iter()
            .any(|object| object["name"] == "a" || object["name"] == "b")
    );
    assert_eq!(
        traced.execution.outcome,
        ExecutionOutcome::Completed { exit_code: 7 }
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn continue_releases_body_objects_before_for_update_and_can_reverse_the_jump() {
    let traced = fragment(
        "int total=0;for(int i=0;i<2;i=i+1){int a[2];{int b;total=total+1;continue;}}return total;",
    );
    let jumps = traced
        .trace
        .steps
        .iter()
        .enumerate()
        .filter(|(_, step)| step.kind == "control.jump")
        .collect::<Vec<_>>();
    assert_eq!(jumps.len(), 2);
    for (index, step) in jumps {
        let before = state_at(&traced.trace, index);
        let mut after = state_at(&traced.trace, index + 1);
        assert!(
            !objects(&after)
                .iter()
                .any(|object| object["name"] == "a" || object["name"] == "b")
        );
        apply_step(&mut after, step, Direction::Backward).unwrap();
        assert_eq!(after, before);
    }
    assert_eq!(
        traced.execution.outcome,
        ExecutionOutcome::Completed { exit_code: 2 }
    );
}

#[test]
fn repeated_loop_declarations_get_fresh_objects_scopes_and_monotonic_addresses() {
    let traced = fragment("for(int i=0;i<3;i=i+1){int a[2]={4};}");
    let mut seen = Vec::new();
    for (index, _) in traced
        .trace
        .steps
        .iter()
        .enumerate()
        .filter(|(_, step)| step.kind == "object.declare")
    {
        let state = state_at(&traced.trace, index + 1);
        if let Some(a) = objects(&state).iter().find(|object| object["name"] == "a") {
            seen.push((
                a["id"].clone(),
                a["scopeId"].clone(),
                a["baseAddress"].as_u64().unwrap(),
                a["declarationNodeId"].clone(),
            ));
        }
    }
    assert_eq!(seen.len(), 3);
    assert_ne!(seen[0].0, seen[1].0);
    assert_ne!(seen[1].0, seen[2].0);
    assert_ne!(seen[0].1, seen[1].1);
    assert_eq!(seen[0].3, seen[1].3);
    assert!(seen.windows(2).all(|pair| pair[0].2 + 8 == pair[1].2));
    assert_round_trip(&traced.trace);
}

#[test]
fn freed_capacity_does_not_reuse_virtual_addresses_or_object_ids() {
    let traced = fragment("{int a[2];}{int b;}int c[3];");
    let state = state_at(&traced.trace, traced.trace.steps.len() - 1);
    assert_eq!(object(&state, "c")["baseAddress"], 4108);
    assert_eq!(state["allocator"]["nextAddress"], 4120);
    assert_eq!(state["allocator"]["liveBytes"], 12);
    assert_eq!(state["allocator"]["nextObject"], 4);
    assert_eq!(final_state(&traced)["allocator"]["nextAddress"], 4120);
    assert_round_trip(&traced.trace);
}

#[test]
fn chinese_output_appends_once_per_printf_and_undo_uses_utf8_boundaries() {
    let traced = fragment(r#"printf("中文😀");printf("=%d\n",-7);"#);
    let outputs = traced
        .trace
        .steps
        .iter()
        .enumerate()
        .filter(|(_, step)| step.kind == "output.append")
        .collect::<Vec<_>>();
    assert_eq!(outputs.len(), 2);
    let first = outputs[0]
        .1
        .changes
        .iter()
        .find(|change| change["op"] == "output")
        .unwrap();
    assert_eq!(first["beforeBytes"], 0);
    assert_eq!(first["afterBytes"], "中文😀".len());
    assert_eq!(first["append"], "中文😀");
    assert_eq!(final_state(&traced)["output"], "中文😀=-7\n");
    assert_eq!(traced.execution.state.output, "中文😀=-7\n");
    assert_round_trip(&traced.trace);
}

#[test]
fn failed_printf_keeps_earlier_output_and_records_no_partial_output_or_reads() {
    let traced = fragment(r#"int a[1]={3};printf("before");printf("bad %d %d",a[0],a[1]);"#);
    assert_eq!(traced.trace.completeness, "prefix");
    assert_eq!(final_state(&traced)["output"], "before");
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .filter(|step| step.kind == "output.append")
            .count(),
        1
    );
    assert_eq!(observations(&traced.trace, "read").count(), 0);
    assert_round_trip(&traced.trace);
}

#[test]
fn failed_self_initialization_retains_the_declared_uninitialized_object() {
    let traced = fragment("int x=x;");
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .map(|step| step.kind.as_str())
            .collect::<Vec<_>>(),
        ["program.enter", "object.declare"]
    );
    assert_eq!(slot(object(&final_state(&traced), "x"), 0), None);
    assert!(
        matches!(traced.execution.outcome, ExecutionOutcome::ProgramError { ref diagnostic } if diagnostic.code == DiagnosticCode::Uninitialized)
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn failed_assignment_commits_neither_value_comparisons_nor_observations() {
    let traced = fragment("int x=7;x=(x<8)+(1/0);");
    let state = final_state(&traced);
    assert_eq!(slot(object(&state, "x"), 0), Some(7));
    assert_eq!(state["counters"]["comparisons"], 0);
    assert_eq!(state["counters"]["scalarWrites"], 1);
    assert_eq!(observations(&traced.trace, "read").count(), 0);
    assert_eq!(
        traced
            .trace
            .steps
            .iter()
            .filter(|step| step.kind == "value.write")
            .count(),
        0
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn failed_return_does_not_destroy_nested_live_state_or_emit_return_step() {
    let traced = fragment("int x=4;{int a[2]={7};return a[2];}");
    let state = final_state(&traced);
    assert_eq!(state["scopes"].as_array().unwrap().len(), 2);
    assert_eq!(objects(&state).len(), 2);
    assert_eq!(state["allocator"]["liveBytes"], 12);
    assert!(
        !traced
            .trace
            .steps
            .iter()
            .any(|step| step.kind == "program.return")
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn conditions_have_real_decisions_and_only_six_comparison_operators_count() {
    let traced = fragment(
        "int x=0;if(1<2){x=x+1;}if(2<=2){x=x+1;}if(3>2){x=x+1;}if(3>=3){x=x+1;}if(4==4){x=x+1;}if(4!=5){x=x+1;}if(!0&&1||0){x=x+1;}return x;",
    );
    assert_eq!(final_state(&traced)["counters"]["comparisons"], 6);
    assert_eq!(observations(&traced.trace, "decision").count(), 7);
    assert!(observations(&traced.trace, "decision").all(|item| item["branch"] == "true"));
    assert_eq!(
        traced.execution.outcome,
        ExecutionOutcome::Completed { exit_code: 7 }
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn short_circuit_has_one_operand_and_no_read_of_the_skipped_uninitialized_array() {
    let traced = fragment(r#"int a[1];printf("%d %d",0&&a[0],9||a[8]);"#);
    assert_eq!(observations(&traced.trace, "read").count(), 0);
    assert_eq!(observations(&traced.trace, "short-circuit").count(), 2);
    let logical = observations(&traced.trace, "evaluate")
        .filter(|item| item["operator"] == "&&" || item["operator"] == "||")
        .collect::<Vec<_>>();
    assert_eq!(logical.len(), 2);
    assert!(
        logical
            .iter()
            .all(|item| item["operands"].as_array().unwrap().len() == 1)
    );
    for item in logical {
        assert!(
            observations(&traced.trace, "short-circuit")
                .any(|skipped| skipped["nodeId"] == item["nodeId"])
        );
    }
    assert_eq!(traced.execution.state.output, "0 1");
}

#[test]
fn non_short_circuited_logical_rhs_has_actual_read_and_two_operands() {
    let traced = fragment(r#"int a[1]={5};printf("%d %d",1&&a[0],0||a[0]);"#);
    assert_eq!(observations(&traced.trace, "read").count(), 2);
    assert_eq!(observations(&traced.trace, "short-circuit").count(), 0);
    assert!(
        observations(&traced.trace, "evaluate")
            .filter(|item| item["operator"] == "&&" || item["operator"] == "||")
            .all(|item| item["operands"].as_array().unwrap().len() == 2)
    );
    assert_eq!(final_state(&traced)["counters"]["comparisons"], 0);
}

#[test]
fn read_observations_preserve_real_left_to_right_values_and_source_nodes() {
    let source = "int main(){int a[2]={7,3};int x=a[0]-a[1];return x;}";
    let traced = run(source);
    let reads = observations(&traced.trace, "read").collect::<Vec<_>>();
    assert_eq!(
        reads
            .iter()
            .map(|item| item["value"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        [7, 3, 4]
    );
    assert_eq!(source_text(source, &traced, &reads[0]["nodeId"]), "a[0]");
    assert_eq!(source_text(source, &traced, &reads[1]["nodeId"]), "a[1]");
    let subtraction = observations(&traced.trace, "evaluate")
        .find(|item| item["operator"] == "-")
        .unwrap();
    assert_eq!(subtraction["operands"], json!([7, 3]));
    assert_eq!(subtraction["value"], 4);
}

#[test]
fn empty_for_condition_is_a_true_decision_located_at_the_for_node() {
    let source = "int main(){for(;;){break;}}";
    let traced = run(source);
    let step = traced
        .trace
        .steps
        .iter()
        .find(|step| step.kind == "condition")
        .unwrap();
    assert_eq!(step.location["kind"], "source");
    assert!(source_text(source, &traced, &step.location["nodeId"]).starts_with("for"));
    let decision = step
        .observations
        .iter()
        .find(|item| item["kind"] == "decision")
        .unwrap();
    assert_eq!(decision["value"], 1);
    assert_eq!(decision["branch"], "true");
    assert_eq!(final_state(&traced)["counters"]["comparisons"], 0);
}

#[test]
fn one_source_line_can_produce_multiple_distinct_atomic_highlights() {
    let source = "int main(){int x=1;x=x+2;printf(\"%d\",x);return x;}";
    let traced = run(source);
    assert!(traced.trace.steps.len() >= 6);
    for step in &traced.trace.steps {
        if step.location["kind"] == "source" {
            assert!(!source_text(source, &traced, &step.location["nodeId"]).is_empty());
        }
    }
    let declaration = &traced.trace.steps[step_index(&traced.trace, "object.declare")];
    let initialization = &traced.trace.steps[step_index(&traced.trace, "value.initialize")];
    assert_eq!(
        declaration.location["nodeId"],
        initialization.location["nodeId"]
    );
    assert_ne!(declaration.seq, initialization.seq);
}

#[test]
fn scope_exit_highlight_uses_the_block_end_and_return_uses_its_own_source() {
    let source = "int main(){\r\n{int x=3;}\r\nreturn 8;\r\n}";
    let traced = run(source);
    let exit = &traced.trace.steps[step_index(&traced.trace, "scope.exit")];
    assert_eq!(exit.location["kind"], "source");
    assert_eq!(exit.location["edge"], "end");
    assert_eq!(
        source_text(source, &traced, &exit.location["nodeId"]),
        "{int x=3;}"
    );
    let returned = &traced.trace.steps[step_index(&traced.trace, "program.return")];
    assert_eq!(returned.location["kind"], "source");
    assert!(source_text(source, &traced, &returned.location["nodeId"]).starts_with("return 8"));
}

#[test]
fn same_checked_program_produces_byte_identical_trace_and_node_map_twice() {
    let checked = analyze(
        "int main(){int a[3]={3,1,2};for(int i=0;i<3;i=i+1){a[i]=a[i]+i;}printf(\"%d\",a[2]);}",
    )
    .unwrap();
    let original = checked.clone();
    let first = execute_traced(&checked);
    let second = execute_traced(&checked);
    assert_eq!(checked, original);
    assert_eq!(first.execution, second.execution);
    assert_eq!(
        serde_json::to_vec(&first.trace).unwrap(),
        serde_json::to_vec(&second.trace).unwrap()
    );
    assert_eq!(
        serde_json::to_vec(&first.node_map).unwrap(),
        serde_json::to_vec(&second.node_map).unwrap()
    );
    validate_trace(&first.trace, &first.node_map).unwrap();
}

#[test]
fn traced_and_unrecorded_execution_match_for_normal_and_program_error_runs() {
    for body in [
        "",
        "int x=-7/3;return x;",
        "int a[3]={4,1,2};a[1]=a[0]+1;printf(\"%d\",a[1]);",
        "int x=3;{int y=9;return x+y;}",
        "int x=x;",
        "int a[2]={3};a[0]=1/0;",
        "int a[2];return a[1];",
        "for(int i=0;i<2;i=i+1){if(i==0){continue;}break;}return 5;",
    ] {
        let checked = analyze(&format!("int main(){{{body}}}")).unwrap();
        let raw = execute(&checked);
        let traced = execute_traced(&checked);
        assert_eq!(
            traced.execution.state, raw.state,
            "recording must preserve state for {body:?}"
        );
        assert_eq!(
            traced.execution.outcome, raw.outcome,
            "recording must preserve outcome for {body:?}"
        );
        assert!(
            traced.execution.work_used >= raw.work_used,
            "recording includes projection work"
        );
        let final_value = final_state(&traced);
        assert_eq!(final_value["output"], raw.state.output);
        assert_eq!(final_value["allocator"]["liveBytes"], raw.state.live_bytes);
        if let ExecutionOutcome::Completed { exit_code } = raw.outcome {
            assert_eq!(final_value["control"]["returnValue"], exit_code);
            assert_eq!(final_value["control"]["phase"], "returned");
            assert!(objects(&final_value).is_empty());
        }
        validate_trace(&traced.trace, &traced.node_map).unwrap();
        assert_round_trip(&traced.trace);
    }
}

#[test]
fn actual_swap_annotation_references_exactly_two_distinct_real_cell_writes() {
    let traced = fragment("int a[2]={7,3};int t=a[0];a[0]=a[1];a[1]=t;");
    let swaps = observations(&traced.trace, "swap").collect::<Vec<_>>();
    assert_eq!(swaps.len(), 1);
    let swap = swaps[0];
    assert_eq!(swap["indices"], json!([0, 1]));
    assert_eq!(swap["beforeValues"], json!([7, 3]));
    let writes = swap["writeSeqs"].as_array().unwrap();
    assert_ne!(writes[0], writes[1]);
    for seq in writes {
        let seq = seq.as_u64().unwrap() as usize;
        let step = &traced.trace.steps[seq - 1];
        assert_eq!(step.kind, "value.write");
        assert!(
            step.changes
                .iter()
                .any(|change| change["op"] == "cell" && change["objectId"] == swap["objectId"])
        );
    }
    assert_eq!(final_state(&traced)["counters"]["swaps"], 1);
    assert_eq!(final_state(&traced)["counters"]["arrayWrites"], 4);
    assert_round_trip(&traced.trace);
}

#[test]
fn writes_to_the_same_array_slot_cannot_invent_a_swap() {
    for body in [
        "int a[2]={7,3};int t=a[0];a[0]=a[0];a[0]=t;",
        "int a[2]={7,3};a[0]=3;a[0]=7;",
    ] {
        let traced = fragment(body);
        assert_eq!(observations(&traced.trace, "swap").count(), 0, "{body}");
        assert_eq!(final_state(&traced)["counters"]["swaps"], 0);
        assert_eq!(final_state(&traced)["counters"]["arrayWrites"], 4);
    }
}

#[test]
fn distinct_equal_value_slots_can_still_be_a_verified_temp_swap() {
    let traced = fragment("int a[2]={4,4};int t=a[0];a[0]=a[1];a[1]=t;");
    assert_eq!(observations(&traced.trace, "swap").count(), 1);
    assert_eq!(final_state(&traced)["counters"]["swaps"], 1);
    assert_eq!(final_state(&traced)["counters"]["arrayWrites"], 4);
    assert_round_trip(&traced.trace);
}

#[test]
fn unfinished_second_write_does_not_annotate_a_completed_swap() {
    let traced = fragment("int a[2]={7,3};int t=a[0];a[0]=a[1];a[1]=t/0;");
    assert_eq!(traced.trace.completeness, "prefix");
    assert_eq!(observations(&traced.trace, "swap").count(), 0);
    let state = final_state(&traced);
    assert_eq!(state["counters"]["swaps"], 0);
    assert_eq!(state["counters"]["arrayWrites"], 3);
    assert_eq!(
        (0..2)
            .map(|index| slot(object(&state, "a"), index))
            .collect::<Vec<_>>(),
        vec![Some(3), Some(3)]
    );
    assert_round_trip(&traced.trace);
}

#[test]
fn bubble_sort_counters_and_output_come_from_real_array_execution() {
    let traced = fragment(
        "int a[3]={3,1,2};for(int i=0;i<2;i=i+1){for(int j=0;j<2-i;j=j+1){if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}}}printf(\"%d %d %d\",a[0],a[1],a[2]);",
    );
    assert_eq!(traced.execution.state.output, "1 2 3");
    assert_eq!(final_state(&traced)["counters"]["swaps"], 2);
    assert_eq!(observations(&traced.trace, "swap").count(), 2);
    assert_eq!(final_state(&traced)["counters"]["arrayWrites"], 7);
    assert_round_trip(&traced.trace);
}

#[test]
fn checkpoints_cover_exactly_zero_and_each_128th_step_at_127_128_129() {
    for total in [127usize, 128, 129] {
        let traced = fragment(&";".repeat(total - 2));
        assert_eq!(traced.trace.steps.len(), total);
        let cursors = traced
            .trace
            .checkpoints
            .iter()
            .map(|checkpoint| checkpoint.cursor)
            .collect::<Vec<_>>();
        assert_eq!(cursors, if total < 128 { vec![0] } else { vec![0, 128] });
        let mut state = traced.trace.initial_state.clone();
        for cursor in 0..=total {
            assert_eq!(
                state_at(&traced.trace, cursor),
                state,
                "total {total}, cursor {cursor}"
            );
            if cursor < total {
                apply_step(&mut state, &traced.trace.steps[cursor], Direction::Forward).unwrap();
            }
        }
        assert_round_trip(&traced.trace);
    }
}

#[test]
fn checkpoint_restore_matches_full_replay_across_multiple_boundaries() {
    let traced = fragment("int x=0;while(x<55){x=x+1;printf(\"%d\",x);}");
    assert!(traced.trace.steps.len() > 256);
    let mut state = traced.trace.initial_state.clone();
    for cursor in 0..=traced.trace.steps.len() {
        if cursor % 31 == 0 || cursor % 128 <= 1 || cursor == traced.trace.steps.len() {
            assert_eq!(state_at(&traced.trace, cursor), state, "cursor {cursor}");
        }
        if cursor < traced.trace.steps.len() {
            apply_step(&mut state, &traced.trace.steps[cursor], Direction::Forward).unwrap();
        }
    }
    for checkpoint in &traced.trace.checkpoints {
        assert_eq!(checkpoint.state, state_at(&traced.trace, checkpoint.cursor));
    }
}

#[test]
fn restore_refuses_a_cursor_past_the_real_trace_end() {
    let traced = fragment(";");
    assert!(restore(&traced.trace, traced.trace.steps.len() + 1).is_err());
}

#[test]
fn twenty_thousand_step_guard_preserves_a_reversible_prefix_without_terminal_step() {
    // A flat sequence isolates the step cap from the independent encoded-byte
    // cap, which may stop a scope-heavy infinite loop earlier.
    let traced = fragment(&";".repeat(20_000));
    assert_eq!(traced.trace.completeness, "prefix");
    assert_eq!(traced.trace.steps.len(), 20_000);
    assert!(matches!(
        traced.execution.outcome,
        ExecutionOutcome::ResourceLimit { ref diagnostic } if diagnostic.code == DiagnosticCode::StepLimit
    ));
    assert!(
        !traced
            .trace
            .steps
            .iter()
            .any(|step| step.kind == "program.return")
    );
    assert_eq!(traced.trace.checkpoints.last().unwrap().cursor, 19_968);
    let mut state = final_state(&traced);
    assert_eq!(state["control"]["phase"], "running");
    for step in traced.trace.steps.iter().rev() {
        apply_step(&mut state, step, Direction::Backward).unwrap();
    }
    assert_eq!(state, traced.trace.initial_state);
}

#[test]
fn encoded_trace_limit_rejects_the_whole_candidate_and_retains_a_valid_prefix() {
    let traced = fragment("while(1){}");
    assert!(
        matches!(traced.execution.outcome, ExecutionOutcome::ResourceLimit { ref diagnostic } if diagnostic.code == DiagnosticCode::ResultLimit)
    );
    assert_eq!(traced.trace.completeness, "prefix");
    assert!(!traced.trace.steps.is_empty() && traced.trace.steps.len() < 20_000);
    assert!(serde_json::to_vec(&traced.trace).unwrap().len() <= c_viz_core::trace::MAX_TRACE_BYTES);
    let mut state = final_state(&traced);
    assert_eq!(
        state["scopes"].as_array().unwrap().len(),
        traced.execution.state.scopes.len()
    );
    assert_eq!(state["output"], traced.execution.state.output);
    for step in traced.trace.steps.iter().rev() {
        apply_step(&mut state, step, Direction::Backward).unwrap();
    }
    assert_eq!(state, traced.trace.initial_state);
}

#[test]
fn running_frame_cannot_survive_a_scope_exit_that_deletes_the_main_scope() {
    let traced = run("int main(){}");
    let state = state_at(&traced.trace, 1);
    let mut frame = state["frames"][0].clone();
    frame["scopeIds"] = json!([]);
    let bad = Step {
        seq: 2,
        kind: "scope.exit".into(),
        location: json!({"kind":"source","nodeId":state["scopes"][0]["nodeId"],"edge":"end"}),
        changes: vec![
            json!({"op":"record","table":"frames","id":"f1","index":0,"before":state["frames"][0],"after":frame}),
            json!({"op":"record","table":"scopes","id":"s1","index":0,"before":state["scopes"][0],"after":null}),
        ],
        observations: vec![],
    };
    assert_rejected_without_mutation(state, &bad);
    let mut trace = traced.trace;
    trace.completeness = "prefix".into();
    trace.steps[1] = bad;
    assert!(validate_trace(&trace, &traced.node_map).is_err());
}

#[test]
fn memory_failure_before_declaration_leaves_only_real_program_enter() {
    let traced = fragment("int a[2147483647];");
    assert_eq!(traced.trace.completeness, "prefix");
    assert_eq!(traced.trace.steps.len(), 1);
    assert_eq!(traced.trace.steps[0].kind, "program.enter");
    assert!(objects(&final_state(&traced)).is_empty());
    assert_eq!(final_state(&traced)["allocator"]["nextAddress"], 4096);
    assert_round_trip(&traced.trace);
}

#[test]
fn unknown_trace_version_is_rejected_as_a_whole() {
    let mut traced = fragment("int x=3;");
    traced.trace.dsl_version = "9.0.0".to_owned();
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
}

#[test]
fn unknown_step_kind_is_rejected_and_atomic_application_does_not_mutate() {
    let mut traced = fragment("int x=3;");
    traced.trace.steps[0].kind = "invented.action".to_owned();
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    assert_rejected_without_mutation(traced.trace.initial_state.clone(), &traced.trace.steps[0]);
}

#[test]
fn unknown_change_op_is_rejected_after_other_valid_changes_without_partial_commit() {
    let mut traced = fragment("int x=3;");
    traced.trace.steps[0]
        .changes
        .push(json!({"op":"invented","before":null,"after":null}));
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    assert_rejected_without_mutation(traced.trace.initial_state.clone(), &traced.trace.steps[0]);
}

#[test]
fn tampered_before_value_is_rejected_without_applying_the_other_changes() {
    let mut traced = fragment("int x=3;x=4;");
    let index = step_index(&traced.trace, "value.write");
    let before = state_at(&traced.trace, index);
    let change = traced.trace.steps[index]
        .changes
        .iter_mut()
        .find(|change| change["op"] == "cell")
        .unwrap();
    change["before"] = json!(99);
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    assert_rejected_without_mutation(before, &traced.trace.steps[index]);
}

#[test]
fn cell_index_outside_object_capacity_is_rejected_without_mutation() {
    let mut traced = fragment("int a[2]={1,2};a[1]=9;");
    let index = step_index(&traced.trace, "value.write");
    let before = state_at(&traced.trace, index);
    let change = traced.trace.steps[index]
        .changes
        .iter_mut()
        .find(|change| change["op"] == "cell")
        .unwrap();
    change["index"] = json!(2);
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    assert_rejected_without_mutation(before, &traced.trace.steps[index]);
}

#[test]
fn dangling_cell_object_is_rejected_without_mutation() {
    let mut traced = fragment("int a[2]={1,2};a[1]=9;");
    let index = step_index(&traced.trace, "value.write");
    let before = state_at(&traced.trace, index);
    let change = traced.trace.steps[index]
        .changes
        .iter_mut()
        .find(|change| change["op"] == "cell")
        .unwrap();
    change["objectId"] = json!("o999999");
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    assert_rejected_without_mutation(before, &traced.trace.steps[index]);
}

#[test]
fn tampered_checkpoint_is_not_accepted_as_a_source_of_truth() {
    let mut traced = fragment(&";".repeat(127));
    assert_eq!(traced.trace.checkpoints.len(), 2);
    traced.trace.checkpoints[1].state["output"] = json!("fabricated");
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
}

#[test]
fn dangling_read_observation_and_missing_source_node_are_rejected() {
    let mut traced = fragment("int x=3;return x;");
    let index = step_index(&traced.trace, "program.return");
    let observation = traced.trace.steps[index]
        .observations
        .iter_mut()
        .find(|item| item["kind"] == "read")
        .unwrap();
    observation["objectId"] = json!("o999999");
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    let mut traced = fragment("int x=3;");
    traced.trace.steps[0].location["nodeId"] = json!("n999999");
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
}

#[test]
fn tampered_utf8_output_lengths_are_rejected_without_mutation() {
    let mut traced = fragment(r#"printf("中文😀");"#);
    let index = step_index(&traced.trace, "output.append");
    let before = state_at(&traced.trace, index);
    let change = traced.trace.steps[index]
        .changes
        .iter_mut()
        .find(|change| change["op"] == "output")
        .unwrap();
    change["afterBytes"] = json!(3);
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    assert_rejected_without_mutation(before, &traced.trace.steps[index]);
}

#[test]
fn tampered_sequence_and_missing_checkpoint_are_rejected() {
    let mut traced = fragment(";");
    traced.trace.steps[1].seq = 99;
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
    let mut traced = fragment(&";".repeat(127));
    traced.trace.checkpoints.pop();
    assert!(validate_trace(&traced.trace, &traced.node_map).is_err());
}
