//! Real scalar P0-C execution: no native compiler and no fixture-produced trace.
//! Scalar regressions from 06.1 plus public int/array execution checks in 06.2.
//! STEP and full run budgets remain follow-up tasks; fixtures supply expectations.

use c_viz_core::diagnostic::{Diagnostic, DiagnosticCode, Location, Stage};
use c_viz_core::runtime::{Execution, ExecutionOutcome, execute};
use c_viz_core::semantic::analyze;
use serde_json::Value;

fn run(source: &str) -> Execution {
    let checked = analyze(source)
        .unwrap_or_else(|error| panic!("source must pass static checking: {source:?}: {error:?}"));
    execute(&checked)
}

fn fragment(body: &str) -> Execution {
    run(&format!("int main(void){{{body}}}"))
}

fn completed(body: &str, stdout: &str, exit_code: i32) -> Execution {
    let execution = fragment(body);
    assert!(
        matches!(execution.outcome, ExecutionOutcome::Completed { exit_code: actual } if actual == exit_code),
        "unexpected outcome: {:?}",
        execution.outcome
    );
    assert_eq!(execution.state.output, stdout);
    assert!(
        execution.state.scopes.is_empty(),
        "main must exit all scopes"
    );
    assert!(
        execution.state.variables.is_empty(),
        "main must destroy all variables"
    );
    assert!(execution.state.arrays.is_empty());
    assert_eq!(execution.state.live_bytes, 0);
    assert!((1..=1_000_000).contains(&execution.work_used));
    execution
}

fn program_error(execution: &Execution, code: DiagnosticCode) -> &Diagnostic {
    let ExecutionOutcome::ProgramError { diagnostic } = &execution.outcome else {
        panic!(
            "expected program error {code:?}, got {:?}",
            execution.outcome
        );
    };
    assert_eq!(diagnostic.code, code);
    assert_eq!(diagnostic.stage, Stage::Execute);
    assert_eq!(diagnostic.origin, "rust");
    assert_eq!(diagnostic.severity, "error");
    assert!(
        !execution.state.scopes.is_empty(),
        "error must retain active scopes"
    );
    diagnostic
}

fn resource_error(execution: &Execution, code: DiagnosticCode) -> &Diagnostic {
    let ExecutionOutcome::ResourceLimit { diagnostic } = &execution.outcome else {
        panic!(
            "expected resource limit {code:?}, got {:?}",
            execution.outcome
        );
    };
    assert_eq!(diagnostic.code, code);
    assert_eq!(diagnostic.stage, Stage::Execute);
    assert_eq!(diagnostic.origin, "rust");
    assert_eq!(diagnostic.severity, "error");
    diagnostic
}

fn live_values(execution: &Execution, name: &str) -> Vec<Option<i32>> {
    execution
        .state
        .variables
        .values()
        .filter(|variable| variable.name == name)
        .map(|variable| variable.value)
        .collect()
}

fn source_location<'a>(diagnostic: &Diagnostic, source: &'a str) -> &'a str {
    let Location::Source { byte_range } = &diagnostic.location else {
        panic!("runtime failure must have an actual source location");
    };
    assert!(byte_range.start < byte_range.end);
    assert!(byte_range.end <= source.len());
    &source[byte_range.start..byte_range.end]
}

#[test]
fn integer_arithmetic_uses_the_parsed_precedence_and_associativity() {
    completed(
        r#"printf("%d %d %d %d %d",2+3*4,(2+3)*4,20/3*2,20-3-2,2*(3+(4-1)));"#,
        "14 20 12 15 12",
        0,
    );
}

#[test]
fn the_full_int32_domain_is_available_beyond_the_teaching_input_domain() {
    completed(
        r#"int low=(-2147483647-1); int high=2147483647;
        printf("%d %d %d %d",low,high,low+1,high-1); return low;"#,
        "-2147483648 2147483647 -2147483647 2147483646",
        i32::MIN,
    );
}

#[test]
fn negative_division_truncates_toward_zero_and_remainder_follows_the_dividend() {
    completed(
        r#"printf("%d %d %d %d %d %d",-7/3,-7%3,7/-3,7%-3,-7/-3,-7%-3);"#,
        "-2 -1 -2 1 2 -1",
        0,
    );
}

#[test]
fn unary_comparison_and_logical_results_are_int_zero_or_one() {
    completed(
        r#"printf("%d %d %d %d %d %d %d %d %d %d %d %d",
        +7,-(-7),!0,!-3,2<3,3<=3,3>2,2>=3,4==4,4!=4,-7&&2,0||-7);"#,
        "7 7 1 0 1 1 1 0 1 0 1 1",
        0,
    );
}

#[test]
fn conditions_use_zero_false_and_any_nonzero_true() {
    completed(
        r#"if(0){printf("bad");}else{printf("zero ");}
        if(-7){printf("negative ");}else{printf("bad");}
        if(9){printf("positive");}"#,
        "zero negative positive",
        0,
    );
}

#[test]
fn short_circuit_skips_both_uninitialized_reads_and_arithmetic_failures() {
    completed(
        r#"int u; printf("%d %d %d %d",0&&(u/0),-1||(u/0),0&&(1/0),7||u);"#,
        "0 1 0 1",
        0,
    );
}

#[test]
fn selected_short_circuit_rhs_is_really_evaluated() {
    for body in ["int u; int x=1&&u;", "int u; int x=0||u;"] {
        let execution = fragment(body);
        program_error(&execution, DiagnosticCode::Uninitialized);
        assert_eq!(live_values(&execution, "x"), vec![None]);
    }
}

#[test]
fn untaken_if_branches_do_not_produce_runtime_errors() {
    completed(
        r#"int u; if(0){printf("%d",u);}else{printf("ok");}
        if(1){;}else{int bad=1/0;}"#,
        "ok",
        0,
    );
}

#[test]
fn ordinary_binary_operands_report_the_left_error_before_the_right_error() {
    for (expression, expected) in [
        ("u + (1/0)", DiagnosticCode::Uninitialized),
        ("(1/0) + u", DiagnosticCode::DivZero),
    ] {
        let source = format!("int main(){{int u; int answer={expression};}}");
        let execution = run(&source);
        let diagnostic = program_error(&execution, expected);
        assert!(!source_location(diagnostic, &source).is_empty());
        assert_eq!(live_values(&execution, "answer"), vec![None]);
    }
}

#[test]
fn assignment_to_uninitialized_storage_does_not_read_its_old_value() {
    completed(r#"int x; x=37; printf("%d",x); return x;"#, "37", 37);
}

#[test]
fn shadowing_initializer_reads_the_new_uninitialized_object_and_keeps_both_objects() {
    let source = "int main(){int x=5; {int x=x;}}";
    let checked = analyze(source).unwrap();
    let execution = execute(&checked);
    let diagnostic = program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(source_location(diagnostic, source), "x");
    assert_eq!(execution.state.scopes.len(), 2);
    assert_eq!(execution.state.variables.len(), 2);
    for (declaration, expected) in checked.declarations.iter().zip([Some(5), None]) {
        let variable = execution
            .state
            .variables
            .get(&declaration.node_id)
            .expect("each actual declaration must retain its own dynamic object");
        assert_eq!(variable.declaration_node, declaration.node_id);
        assert_eq!(variable.value, expected);
    }
    let variables = execution.state.variables.values().collect::<Vec<_>>();
    assert_ne!(variables[0].id, variables[1].id);
    assert_ne!(variables[0].scope_id, variables[1].scope_id);
}

#[test]
fn leaving_an_inner_block_restores_the_outer_binding() {
    completed(
        r#"int x=7; printf("%d ",x); {int x=8;printf("%d ",x);} printf("%d",x);"#,
        "7 8 7",
        0,
    );
}

#[test]
fn a_failed_declaration_initializer_preserves_the_new_uninitialized_variable() {
    let execution = fragment(r#"int z=0; printf("prefix"); int answer=10/z;"#);
    program_error(&execution, DiagnosticCode::DivZero);
    assert_eq!(execution.state.output, "prefix");
    assert_eq!(live_values(&execution, "z"), vec![Some(0)]);
    assert_eq!(live_values(&execution, "answer"), vec![None]);
}

#[test]
fn a_failed_assignment_keeps_the_previous_value_and_the_committed_output() {
    let execution = fragment(r#"int x=17; printf("before "); x=100/0; printf("after");"#);
    program_error(&execution, DiagnosticCode::DivZero);
    assert_eq!(execution.state.output, "before ");
    assert_eq!(live_values(&execution, "x"), vec![Some(17)]);
}

#[test]
fn division_and_remainder_by_zero_are_execute_program_errors() {
    for expression in ["1/0", "1%0"] {
        let source = format!("int main(){{int x=9;x={expression};}}");
        let execution = run(&source);
        let diagnostic = program_error(&execution, DiagnosticCode::DivZero);
        assert_eq!(source_location(diagnostic, &source), expression);
        assert_eq!(live_values(&execution, "x"), vec![Some(9)]);
    }
}

#[test]
fn every_unrepresentable_integer_operation_is_diagnosed_before_writeback() {
    for expression in [
        "2147483647+1",
        "(-2147483647-1)-1",
        "50000*50000",
        "-(-2147483647-1)",
        "(-2147483647-1)/-1",
        "(-2147483647-1)%-1",
    ] {
        let execution = fragment(&format!("int x=13;x={expression};"));
        program_error(&execution, DiagnosticCode::IntOverflow);
        assert_eq!(live_values(&execution, "x"), vec![Some(13)]);
        assert!(execution.state.output.is_empty());
    }
}

#[test]
fn failing_if_condition_does_not_enter_either_body() {
    let execution =
        fragment(r#"int u; printf("start"); if(u){printf("then");}else{printf("else");}"#);
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(execution.state.output, "start");
    assert_eq!(execution.state.scopes.len(), 1);
}

#[test]
fn while_rechecks_its_condition_against_real_updated_values() {
    completed(
        r#"int i=1; int sum=0; while(i<=5){sum=sum+i;i=i+1;} printf("%d %d",sum,i);"#,
        "15 6",
        0,
    );
}

#[test]
fn for_supports_declaration_assignment_and_empty_header_parts() {
    completed(
        r#"int total=0; for(int i=1;i<=3;i=i+1){total=total+i;}
        int j; for(j=0;j<2;j=j+1){total=total+10;}
        for(;;){total=total+100;break;}
        for(;j<4;){j=j+1;}
        printf("%d %d",total,j);"#,
        "126 4",
        0,
    );
}

#[test]
fn while_continue_returns_to_the_condition_and_skips_remaining_body() {
    completed(
        r#"int i=0; int sum=0; while(i<5){i=i+1;if(i<3){continue;}sum=sum+i;}
        printf("%d %d",sum,i);"#,
        "12 5",
        0,
    );
}

#[test]
fn for_continue_executes_update_before_the_next_condition() {
    completed(
        r#"int sum=0; for(int i=0;i<5;i=i+1){if(i<3){continue;}sum=sum+i;}
        printf("%d",sum);"#,
        "7",
        0,
    );
}

#[test]
fn break_skips_a_failing_for_update_and_restores_the_outer_name() {
    completed(
        r#"int i=90; for(int i=0;1;i=1/0){int body=2;break;}printf("%d",i);"#,
        "90",
        0,
    );
}

#[test]
fn nested_break_and_continue_affect_only_the_innermost_loop() {
    completed(
        r#"int sum=0;for(int i=0;i<3;i=i+1){for(int j=0;j<5;j=j+1){
        if(j==1){continue;}if(j==3){break;}sum=sum+10*i+j;}}printf("%d",sum);"#,
        "66",
        0,
    );
}

#[test]
fn a_reentered_loop_body_creates_fresh_uninitialized_storage() {
    let execution =
        fragment(r#"int i=0; while(i<2){int x;if(i==0){x=7;}if(i==1){printf("%d",x);}i=i+1;}"#);
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(live_values(&execution, "i"), vec![Some(1)]);
    assert_eq!(live_values(&execution, "x"), vec![None]);
    assert_eq!(
        execution.state.variables.len(),
        2,
        "first iteration's x must be destroyed"
    );
    let variables = &execution.state.variables;
    let i = variables
        .values()
        .find(|variable| variable.name == "i")
        .unwrap();
    let x = variables
        .values()
        .find(|variable| variable.name == "x")
        .unwrap();
    assert!(
        x.id > i.id + 1,
        "the destroyed first x must not donate its identity"
    );
    assert!(execution.state.next_object_id > x.id);
}

#[test]
fn continue_exits_body_scopes_before_a_failing_for_update() {
    let execution = fragment("for(int i=0;i<1;i=1/0){int body=3;{int nested=4;continue;}}");
    program_error(&execution, DiagnosticCode::DivZero);
    assert_eq!(live_values(&execution, "i"), vec![Some(0)]);
    assert!(live_values(&execution, "body").is_empty());
    assert!(live_values(&execution, "nested").is_empty());
    assert_eq!(execution.state.variables.len(), 1);
}

#[test]
fn for_initializer_shadowing_creates_the_new_binding_before_evaluation() {
    let execution = fragment("int x=8;for(int x=x;0;){;}");
    program_error(&execution, DiagnosticCode::Uninitialized);
    let mut values = live_values(&execution, "x");
    values.sort();
    assert_eq!(values, vec![None, Some(8)]);
    assert_eq!(execution.state.scopes.len(), 2);
}

#[test]
fn return_evaluates_once_exits_all_blocks_and_skips_following_faults() {
    completed(
        r#"int outer=7; for(int i=0;i<2;i=i+1){{int inner=5;printf("ok");return outer+inner;}}
        int bad=1/0;"#,
        "ok",
        12,
    );
}

#[test]
fn a_failing_return_expression_retains_all_current_scopes_and_variables() {
    let execution = fragment("int outer=7;{int inner=5;return inner/0;}");
    program_error(&execution, DiagnosticCode::DivZero);
    assert_eq!(live_values(&execution, "outer"), vec![Some(7)]);
    assert_eq!(live_values(&execution, "inner"), vec![Some(5)]);
    assert_eq!(execution.state.scopes.len(), 2);
}

#[test]
fn reaching_main_end_returns_zero_and_cleans_empty_and_populated_blocks() {
    completed(";{}{{int x=4;};}int uninitialized;", "", 0);
}

#[test]
fn printf_uses_compiled_percent_escape_and_unicode_text_parts() {
    completed(
        r#"printf("中文: %d%% \\\"\n",50);printf("%d",(-2147483647-1));"#,
        "中文: 50% \\\"\n-2147483648",
        0,
    );
}

#[test]
fn printf_parameters_are_left_to_right_and_the_whole_call_is_atomic() {
    for (arguments, expected) in [
        ("u,1/0", DiagnosticCode::Uninitialized),
        ("1/0,u", DiagnosticCode::DivZero),
        ("7,u", DiagnosticCode::Uninitialized),
    ] {
        let execution = fragment(&format!(
            r#"int u;printf("prefix");printf("partial %d %d suffix",{arguments});"#
        ));
        program_error(&execution, expected);
        assert_eq!(execution.state.output, "prefix");
    }
}

#[test]
fn printf_evaluates_all_parameters_before_checking_its_output_budget() {
    let prefix = "a".repeat(16_384);
    let execution = fragment(&format!(r#"int u;printf("{prefix}");printf("%d",u);"#));
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(execution.state.output, prefix);
}

#[test]
fn utf8_output_just_below_and_exactly_at_16384_bytes_is_accepted() {
    let below = "中".repeat(5_461);
    assert_eq!(below.len(), 16_383);
    completed(&format!(r#"printf("{below}");"#), &below, 0);
    completed(
        &format!(r#"printf("{below}");printf("a");"#),
        &format!("{below}a"),
        0,
    );
}

#[test]
fn utf8_output_one_byte_over_the_limit_rejects_the_whole_candidate_printf() {
    let candidate = format!("{}ab", "中".repeat(5_461));
    assert_eq!(candidate.len(), 16_385);
    let execution = fragment(&format!(r#"printf("ok");printf("{candidate}");"#));
    let diagnostic = resource_error(&execution, DiagnosticCode::OutputLimit);
    assert_eq!(execution.state.output, "ok");
    assert_eq!(diagnostic.details.dimension, Some("outputBytes"));
    assert_eq!(diagnostic.details.limit, Some(16_384));
    assert_eq!(diagnostic.details.used, Some(2));
    assert_eq!(diagnostic.details.attempted, Some(16_387));
}

#[test]
fn appending_after_exact_output_capacity_retains_the_complete_accepted_prefix() {
    let prefix = format!("{}a", "中".repeat(5_461));
    let execution = fragment(&format!(r#"printf("{prefix}");printf("b");"#));
    let diagnostic = resource_error(&execution, DiagnosticCode::OutputLimit);
    assert_eq!(execution.state.output, prefix);
    assert_eq!(diagnostic.details.used, Some(16_384));
    assert_eq!(diagnostic.details.attempted, Some(16_385));
}

#[test]
fn empty_infinite_loops_consume_bounded_work_even_without_visible_mutation() {
    for loop_source in ["while(1){}", "while(1){;}", "for(;;){}", "for(;;){;}"] {
        let execution = fragment(&format!(r#"printf("prefix");{loop_source}"#));
        let diagnostic = resource_error(&execution, DiagnosticCode::FuelLimit);
        assert_eq!(execution.state.output, "prefix");
        assert!(execution.work_used <= 1_000_000);
        assert_eq!(diagnostic.details.dimension, Some("fuel"));
        assert_eq!(diagnostic.details.limit, Some(1_000_000));
        assert_eq!(diagnostic.details.used, Some(execution.work_used));
        assert!(diagnostic.details.attempted.unwrap() > 1_000_000);
    }
}

#[test]
fn executing_the_same_checked_program_is_deterministic_and_does_not_mutate_it() {
    let checked =
        analyze(r#"int main(){int i=0;while(i<3){int x=i*2;printf("%d ",x);i=i+1;}int bad=1/0;}"#)
            .unwrap();
    let original = checked.clone();
    let first = execute(&checked);
    let second = execute(&checked);
    assert_eq!(checked, original);
    assert_eq!(first.outcome, second.outcome);
    assert_eq!(first.state, second.state);
    assert_eq!(first.work_used, second.work_used);
    assert_eq!(first.state.output, "0 2 4 ");
    program_error(&first, DiagnosticCode::DivZero);
}

#[test]
fn arrays_execute_and_unreachable_arrays_do_not_prevent_scalar_completion() {
    for source in [
        ("int main(){int a[1];}", ""),
        ("int main(){if(0){int a[2147483647];}}", ""),
        (
            r#"int main(){printf("would otherwise run");return 0;int a[2147483647];}"#,
            "would otherwise run",
        ),
    ] {
        let execution = run(source.0);
        assert_eq!(
            execution.outcome,
            ExecutionOutcome::Completed { exit_code: 0 }
        );
        assert_eq!(execution.state.output, source.1);
        assert!(execution.state.arrays.is_empty());
        assert_eq!(execution.state.live_bytes, 0);
    }
}

#[test]
fn static_failures_in_dead_branches_and_after_return_never_enter_runtime() {
    for source in [
        "int main(){if(0){missing=1;}}",
        "int main(){int x=0&&missing;}",
        "int main(){return 0;int x=missing;}",
    ] {
        let diagnostic =
            analyze(source).expect_err("whole-source static checks must precede runtime");
        assert_eq!(diagnostic.code, DiagnosticCode::NameInvalid);
        assert_eq!(diagnostic.stage, Stage::Semantic);
    }
}

#[test]
fn maximum_legal_expression_and_block_depths_execute_and_return_safely() {
    let source = format!(
        "int main(){{return {}{}1{};}}",
        "(".repeat(63),
        "+ ".repeat(63),
        ")".repeat(63)
    );
    let checked = analyze(&source).unwrap();
    assert_eq!(checked.parsed.max_syntax_depth, 64);
    assert_eq!(checked.parsed.max_ast_depth, 64);
    let execution = execute(&checked);
    assert_eq!(
        execution.outcome,
        ExecutionOutcome::Completed { exit_code: 1 }
    );
    let nested = format!("{}return 7;{}", "{".repeat(63), "}".repeat(63));
    completed(&nested, "", 7);
}

#[test]
fn work_exhaustion_before_return_cleanup_keeps_every_active_scope_and_object() {
    // This developer program deliberately approaches the fixed basic work
    // guard. It reaches return's bulk cleanup with too little work remaining;
    // resource failure must preserve both scopes, rather than half a return.
    let source = "int main(){int i=0;while(i<66665){i=i+1;};;;;;{int marker;return 0;}}";
    let execution = run(source);
    let diagnostic = resource_error(&execution, DiagnosticCode::FuelLimit);
    assert_eq!(source_location(diagnostic, source), "return 0;");
    assert_eq!(execution.state.scopes.len(), 2);
    assert_eq!(execution.state.variables.len(), 2);
    assert_eq!(live_values(&execution, "i"), vec![Some(66_665)]);
    assert_eq!(live_values(&execution, "marker"), vec![None]);
}

#[test]
fn runtime_diagnostics_serialize_stable_codes_and_exact_utf8_failure_locations() {
    for (source, code, serialized_code, failing_text) in [
        (
            "int main(){/*中文*/int secret_label;return secret_label;}",
            DiagnosticCode::Uninitialized,
            "E_UNINITIALIZED",
            "secret_label",
        ),
        (
            "int main(){/*中文*/int secret_label=8;secret_label=7/0;}",
            DiagnosticCode::DivZero,
            "E_DIV_ZERO",
            "7/0",
        ),
        (
            "int main(){/*中文*/int secret_label=8;secret_label=2147483647+1;}",
            DiagnosticCode::IntOverflow,
            "E_INT_OVERFLOW",
            "2147483647+1",
        ),
    ] {
        let execution = run(source);
        let diagnostic = program_error(&execution, code);
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["code"], serialized_code);
        assert_eq!(value["stage"], "execute");
        assert_eq!(value["origin"], "rust");
        assert_eq!(value["severity"], "error");
        assert_eq!(value["location"]["kind"], "source");
        let start = source.rfind(failing_text).unwrap();
        assert_eq!(value["location"]["byteRange"]["start"], start);
        assert_eq!(
            value["location"]["byteRange"]["end"],
            start + failing_text.len()
        );
        assert_eq!(source_location(diagnostic, source), failing_text);
        let encoded = serde_json::to_string(&value).unwrap();
        assert!(!encoded.contains("secret_label"));
        assert!(!encoded.contains("中文"));
        assert!(!encoded.contains("stack"));
        assert!(!encoded.contains("exception"));
    }
}

#[test]
fn all_public_machine_sources_execute_with_binding_setup_cases_left_to_the_adapter() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../项目文档/契约/02.4-语义与输入样例.json"
    ))
    .unwrap();
    assert_eq!(fixture["purpose"], "contract-fixture");
    let (mut no_source, mut static_error, mut binding_setup, mut success, mut runtime_error) =
        (0, 0, 0, 0, 0);
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let Some(source) = case["source"].as_str() else {
            no_source += 1;
            continue;
        };
        let checked = match analyze(source) {
            Ok(checked) => checked,
            Err(diagnostic) => {
                let diagnostic = serde_json::to_value(diagnostic).unwrap();
                assert!(
                    case["expected"]["allowedStages"]
                        .as_array()
                        .unwrap()
                        .contains(&diagnostic["stage"]),
                    "{id}: {diagnostic}"
                );
                assert!(
                    case["expected"]["allowedCodes"]
                        .as_array()
                        .unwrap()
                        .contains(&diagnostic["code"]),
                    "{id}: {diagnostic}"
                );
                static_error += 1;
                continue;
            }
        };
        if case["origin"] == "INPUT-07" {
            binding_setup += 1;
            continue;
        }
        let execution = execute(&checked);
        assert_eq!(
            execution.state.output,
            case["expected"]["stdout"].as_str().unwrap(),
            "{id}"
        );
        match &execution.outcome {
            ExecutionOutcome::Completed { exit_code } => {
                assert_eq!(case["expected"]["terminalStatus"], "completed", "{id}");
                assert_eq!(
                    i64::from(*exit_code),
                    case["expected"]["exitCode"].as_i64().unwrap(),
                    "{id}"
                );
                assert!(execution.state.scopes.is_empty(), "{id}");
                assert!(execution.state.variables.is_empty(), "{id}");
                assert!(execution.state.arrays.is_empty(), "{id}");
                assert_eq!(execution.state.live_bytes, 0, "{id}");
                success += 1;
            }
            ExecutionOutcome::ProgramError { diagnostic } => {
                assert_eq!(case["expected"]["terminalStatus"], "program-error", "{id}");
                let diagnostic = serde_json::to_value(diagnostic).unwrap();
                assert_eq!(diagnostic["stage"], "execute", "{id}");
                assert!(
                    case["expected"]["allowedCodes"]
                        .as_array()
                        .unwrap()
                        .contains(&diagnostic["code"]),
                    "{id}: {diagnostic}"
                );
                runtime_error += 1;
            }
            ExecutionOutcome::ResourceLimit { diagnostic } => {
                panic!(
                    "public runtime fixture unexpectedly exhausted resources: {id}: {diagnostic:?}"
                );
            }
        }
    }
    assert_eq!(
        (
            no_source,
            static_error,
            binding_setup,
            success,
            runtime_error
        ),
        (10, 34, 4, 62, 12)
    );
    // The ten null-source input cases and four mapping-setup cases are
    // independently exercised by the input adapter. No judgeStatus is inferred.
}
