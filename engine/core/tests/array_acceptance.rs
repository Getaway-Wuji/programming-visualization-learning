//! Task 06.2: real C array execution through the checked Rust interpreter.
//! Expectations come from P0-C rules and concrete programs, never native C,
//! fixture traces, frontend algorithms, or a second interpreter.

use c_viz_core::diagnostic::{Diagnostic, DiagnosticCode, Location, Stage};
use c_viz_core::runtime::{Execution, ExecutionOutcome, execute};
use c_viz_core::runtime_state::RuntimeArray;
use c_viz_core::semantic::analyze;

fn run(source: &str) -> Execution {
    let checked = analyze(source).unwrap_or_else(|error| {
        panic!("array source must pass static checking: {source:?}: {error:?}")
    });
    execute(&checked)
}

fn fragment(body: &str) -> Execution {
    run(&format!("int main(void){{{body}}}"))
}

fn completed(body: &str, stdout: &str, exit_code: i32) -> Execution {
    let execution = fragment(body);
    assert_eq!(
        execution.outcome,
        ExecutionOutcome::Completed { exit_code },
        "source body: {body}"
    );
    assert_eq!(execution.state.output, stdout);
    assert!(execution.state.scopes.is_empty());
    assert!(execution.state.variables.is_empty());
    assert!(execution.state.arrays.is_empty());
    assert_eq!(execution.state.live_bytes, 0);
    assert!((1..=1_000_000).contains(&execution.work_used));
    execution
}

fn program_error(execution: &Execution, expected: DiagnosticCode) -> &Diagnostic {
    let ExecutionOutcome::ProgramError { diagnostic } = &execution.outcome else {
        panic!("expected {expected:?}, got {:?}", execution.outcome);
    };
    assert_eq!(diagnostic.code, expected);
    assert_eq!(diagnostic.stage, Stage::Execute);
    assert_eq!(diagnostic.origin, "rust");
    assert_eq!(diagnostic.severity, "error");
    assert!(!execution.state.scopes.is_empty());
    diagnostic
}

fn resource_error(execution: &Execution, expected: DiagnosticCode) -> &Diagnostic {
    let ExecutionOutcome::ResourceLimit { diagnostic } = &execution.outcome else {
        panic!(
            "expected resource limit {expected:?}, got {:?}",
            execution.outcome
        );
    };
    assert_eq!(diagnostic.code, expected);
    assert_eq!(diagnostic.stage, Stage::Execute);
    assert_eq!(diagnostic.origin, "rust");
    assert_eq!(diagnostic.severity, "error");
    diagnostic
}

fn array<'a>(execution: &'a Execution, name: &str) -> &'a RuntimeArray {
    let matching = execution
        .state
        .arrays
        .values()
        .filter(|array| array.name == name)
        .collect::<Vec<_>>();
    assert_eq!(matching.len(), 1, "expected one live {name} array");
    matching[0]
}

fn element(array: &RuntimeArray, index: usize) -> Option<i32> {
    assert!(index < array.length);
    array.cells.get(&index).copied().or(array.default_value)
}

fn values(execution: &Execution, name: &str) -> Vec<Option<i32>> {
    let array = array(execution, name);
    (0..array.length)
        .map(|index| element(array, index))
        .collect()
}

fn scalar(execution: &Execution, name: &str) -> Option<i32> {
    let matching = execution
        .state
        .variables
        .values()
        .filter(|variable| variable.name == name)
        .collect::<Vec<_>>();
    assert_eq!(matching.len(), 1, "expected one live {name} scalar");
    matching[0].value
}

fn source_location<'a>(diagnostic: &Diagnostic, source: &'a str) -> &'a str {
    let Location::Source { byte_range } = &diagnostic.location else {
        panic!("array error must identify the actual source");
    };
    assert!(byte_range.start < byte_range.end);
    assert!(byte_range.end <= source.len());
    &source[byte_range.start..byte_range.end]
}

#[test]
fn signed_literal_initializers_and_zero_fill_produce_real_values() {
    completed(
        r#"int a[6]={+7,-8,2147483647,-2147483647};
        printf("%d %d %d %d %d %d",a[0],a[1],a[2],a[3],a[4],a[5]);"#,
        "7 -8 2147483647 -2147483647 0 0",
        0,
    );
}

#[test]
fn every_remaining_slot_of_a_partial_initializer_is_zero() {
    completed(
        r#"int a[37]={4,-1}; int sum=0;
        for(int i=0;i<37;i=i+1){sum=sum+a[i];}
        printf("%d %d %d",sum,a[2],a[36]);"#,
        "3 0 0",
        0,
    );
}

#[test]
fn array_elements_without_an_initializer_are_independently_uninitialized() {
    for index in [0, 1, 4] {
        let execution = fragment(&format!("int a[5];return a[{index}];"));
        program_error(&execution, DiagnosticCode::Uninitialized);
        assert_eq!(values(&execution, "a"), vec![None; 5]);
        assert_eq!(execution.state.live_bytes, 20);
    }
}

#[test]
fn assigning_one_uninitialized_element_does_not_initialize_its_neighbors() {
    let execution = fragment(r#"int a[3];a[1]=9;printf("%d",a[1]);return a[2];"#);
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(execution.state.output, "9");
    assert_eq!(values(&execution, "a"), vec![None, Some(9), None]);
}

#[test]
fn writing_zero_is_a_real_initialization_even_when_other_slots_are_uninitialized() {
    let execution = fragment(r#"int a[2];a[0]=0;printf("%d",a[0]);return a[1];"#);
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(execution.state.output, "0");
    assert_eq!(values(&execution, "a"), vec![Some(0), None]);
}

#[test]
fn writes_and_reads_use_the_full_int32_result_domain() {
    completed(
        r#"int a[3];a[0]=(-2147483647-1);a[1]=2147483647;a[2]=a[0]+a[1];
        printf("%d %d %d",a[0],a[1],a[2]);return a[2];"#,
        "-2147483648 2147483647 -1",
        -1,
    );
}

#[test]
fn valid_computed_first_and_last_indices_are_accepted() {
    completed(
        r#"int a[4]={1,2,3,4};int n=4;a[n-1]=a[1+1]*2;a[n-n]=7;
        printf("%d %d",a[0],a[3]);"#,
        "7 6",
        0,
    );
}

#[test]
fn indices_can_depend_on_reads_from_another_array() {
    completed(
        r#"int positions[2]={3,1};int a[4]={10,20,30,40};
        a[positions[1]+1]=a[positions[0]]+5;
        printf("%d %d",a[2],a[positions[0]-2]);"#,
        "45 20",
        0,
    );
}

#[test]
fn language_capacity_is_not_the_thirty_item_teaching_input_limit() {
    completed(
        r#"int a[31]={1};a[30]=8;printf("%d %d",a[0],a[30]);"#,
        "1 8",
        0,
    );
}

#[test]
fn logical_empty_placeholder_remains_a_valid_language_element() {
    completed(
        r#"int n=0;int values[1]={0};printf("%d %d",n,values[0]);"#,
        "0 0",
        0,
    );
}

#[test]
fn logical_length_does_not_replace_the_declared_capacity_for_bounds_checks() {
    completed(
        r#"int n=1;int values[4]={5};values[3]=9;printf("%d %d",n,values[3]);"#,
        "1 9",
        0,
    );
}

#[test]
fn negative_index_reads_are_bounds_errors_at_a_real_source_location() {
    let source = r#"int main(){int a[3]={7};printf("before");return a[-1];}"#;
    let execution = run(source);
    let diagnostic = program_error(&execution, DiagnosticCode::IndexBounds);
    assert!(source_location(diagnostic, source).contains("-1"));
    assert_eq!(execution.state.output, "before");
    assert_eq!(values(&execution, "a"), vec![Some(7), Some(0), Some(0)]);
}

#[test]
fn an_index_equal_to_capacity_is_rejected() {
    let execution = fragment("int a[3]={1,2,3};return a[3];");
    program_error(&execution, DiagnosticCode::IndexBounds);
    assert_eq!(values(&execution, "a"), vec![Some(1), Some(2), Some(3)]);
}

#[test]
fn extreme_int32_indices_are_rejected_without_unsigned_wraparound() {
    for index in ["2147483647", "(-2147483647-1)"] {
        let execution = fragment(&format!("int a[2]={{4,5}};return a[{index}];"));
        program_error(&execution, DiagnosticCode::IndexBounds);
        assert_eq!(values(&execution, "a"), vec![Some(4), Some(5)]);
    }
}

#[test]
fn failed_out_of_bounds_writes_preserve_all_existing_elements() {
    for index in ["-1", "2", "2147483647"] {
        let execution = fragment(&format!("int a[2]={{4,5}};a[{index}]=99;"));
        program_error(&execution, DiagnosticCode::IndexBounds);
        assert_eq!(values(&execution, "a"), vec![Some(4), Some(5)]);
    }
}

#[test]
fn invalid_assignment_location_fails_before_the_right_hand_expression() {
    for body in [
        "int a[1]={8};a[-1]=1/0;",
        "int a[1]={8};int u;a[1]=u;",
        "int a[1]={8};a[2147483647]=2147483647+1;",
    ] {
        let execution = fragment(body);
        program_error(&execution, DiagnosticCode::IndexBounds);
        assert_eq!(values(&execution, "a"), vec![Some(8)]);
    }
}

#[test]
fn an_uninitialized_lhs_index_fails_before_the_rhs_division() {
    let execution = fragment("int a[2]={4,5};int i;a[i]=1/0;");
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(values(&execution, "a"), vec![Some(4), Some(5)]);
    assert_eq!(scalar(&execution, "i"), None);
}

#[test]
fn a_failing_index_expression_is_evaluated_before_the_rhs_array_read() {
    let execution = fragment("int a[2]={4,5};int b[1];a[1/0]=b[0];");
    program_error(&execution, DiagnosticCode::DivZero);
    assert_eq!(values(&execution, "a"), vec![Some(4), Some(5)]);
    assert_eq!(values(&execution, "b"), vec![None]);
}

#[test]
fn index_expression_overflow_precedes_location_and_rhs_errors() {
    let execution = fragment("int a[2]={4,5};a[2147483647+1]=1/0;");
    program_error(&execution, DiagnosticCode::IntOverflow);
    assert_eq!(values(&execution, "a"), vec![Some(4), Some(5)]);
}

#[test]
fn a_valid_location_with_a_failing_rhs_does_not_write_back() {
    for (expression, code) in [
        ("1/0", DiagnosticCode::DivZero),
        ("2147483647+1", DiagnosticCode::IntOverflow),
        ("a[2]", DiagnosticCode::IndexBounds),
    ] {
        let execution = fragment(&format!("int a[2]={{4,5}};a[0]={expression};"));
        program_error(&execution, code);
        assert_eq!(values(&execution, "a"), vec![Some(4), Some(5)]);
    }
}

#[test]
fn an_uninitialized_rhs_element_does_not_initialize_the_destination() {
    let execution = fragment("int a[3];a[1]=6;a[0]=a[2];");
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(values(&execution, "a"), vec![None, Some(6), None]);
}

#[test]
fn failed_array_read_does_not_overwrite_a_scalar_destination() {
    let execution = fragment("int a[2];int x=19;x=a[1];");
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(scalar(&execution, "x"), Some(19));
}

#[test]
fn short_circuit_skips_uninitialized_and_out_of_bounds_array_reads() {
    completed(
        r#"int a[1];printf("%d %d %d %d",0&&a[-1],7||a[1],0&&a[0],-2||a[0]);"#,
        "0 1 0 1",
        0,
    );
}

#[test]
fn selected_short_circuit_rhs_array_reads_really_execute() {
    for expression in ["1&&a[1]", "0||a[-1]"] {
        let execution = fragment(&format!("int a[1]={{5}};int x={expression};"));
        program_error(&execution, DiagnosticCode::IndexBounds);
        assert_eq!(scalar(&execution, "x"), None);
    }
}

#[test]
fn ordinary_operands_preserve_left_to_right_array_error_order() {
    for (expression, expected) in [
        ("a[2]+(1/0)", DiagnosticCode::IndexBounds),
        ("(1/0)+a[2]", DiagnosticCode::DivZero),
        ("a[0]+a[-1]", DiagnosticCode::Uninitialized),
    ] {
        let execution = fragment(&format!("int a[1];return {expression};"));
        program_error(&execution, expected);
    }
}

#[test]
fn a_printf_with_a_failing_array_parameter_appends_no_partial_text() {
    let execution =
        fragment(r#"int a[2]={7};printf("prefix");printf("half %d %d end",a[0],a[2]);"#);
    program_error(&execution, DiagnosticCode::IndexBounds);
    assert_eq!(execution.state.output, "prefix");
    assert_eq!(values(&execution, "a"), vec![Some(7), Some(0)]);
}

#[test]
fn printf_array_arguments_are_evaluated_from_left_to_right() {
    for (arguments, expected) in [
        ("a[1],1/0", DiagnosticCode::IndexBounds),
        ("1/0,a[1]", DiagnosticCode::DivZero),
        ("a[0],a[1]", DiagnosticCode::Uninitialized),
    ] {
        let execution = fragment(&format!(
            r#"int a[1];printf("prefix");printf("%d %d",{arguments});"#
        ));
        program_error(&execution, expected);
        assert_eq!(execution.state.output, "prefix");
    }
}

#[test]
fn unexecuted_branches_do_not_allocate_or_read_their_arrays() {
    completed(
        r#"int a[1];if(0){int huge[2147483647];printf("%d",a[9]);}
        if(1){printf("ok");}else{int huge[2147483647]={1};return a[0];}"#,
        "ok",
        0,
    );
}

#[test]
fn return_can_read_an_array_then_destroy_all_active_objects() {
    completed(
        r#"int a[2]={7,8};for(int i=0;i<1;i=i+1){{int b[3]={2};
        printf("done");return a[1]+b[0];}}int huge[2147483647];"#,
        "done",
        10,
    );
}

#[test]
fn implicit_return_cleans_arrays_and_uninitialized_scalar_slots() {
    completed("int a[3];{int b[2]={4};}int x;", "", 0);
}

#[test]
fn array_shadowing_restores_the_outer_array_after_block_exit() {
    completed(
        r#"int a[2]={3,4};printf("%d ",a[1]);{int a[1]={9};a[0]=8;printf("%d ",a[0]);}
        printf("%d %d",a[0],a[1]);"#,
        "4 8 3 4",
        0,
    );
}

#[test]
fn scalar_and_array_shadowing_resolve_by_declaration_identity() {
    completed(
        r#"int a=6;{int a[2]={7,8};printf("%d ",a[1]);}printf("%d ",a);
        int b[1]={9};{int b=4;printf("%d ",b);}printf("%d",b[0]);"#,
        "8 6 4 9",
        0,
    );
}

#[test]
fn repeated_loop_body_arrays_have_fresh_values_and_dynamic_identities() {
    let execution = fragment(
        r#"int i=0;while(i<2){int a[2];if(i==0){a[0]=7;}
        if(i==1){printf("%d",a[0]);}i=i+1;}"#,
    );
    program_error(&execution, DiagnosticCode::Uninitialized);
    assert_eq!(scalar(&execution, "i"), Some(1));
    assert_eq!(values(&execution, "a"), vec![None, None]);
    assert_eq!(execution.state.arrays.len(), 1);
    let i = execution
        .state
        .variables
        .values()
        .find(|variable| variable.name == "i")
        .unwrap();
    let a = array(&execution, "a");
    assert!(
        a.id > i.id + 1,
        "the destroyed first array cannot donate its identity"
    );
    assert!(execution.state.next_object_id > a.id);
    assert_eq!(execution.state.live_bytes, 12);
}

#[test]
fn initialized_loop_arrays_reapply_the_initializer_on_each_entry() {
    completed(
        r#"for(int i=0;i<3;i=i+1){int a[2]={4};printf("%d %d ",a[0],a[1]);a[0]=99;a[1]=88;}"#,
        "4 0 4 0 4 0 ",
        0,
    );
}

#[test]
fn continue_destroys_body_arrays_before_a_failing_for_update() {
    let execution =
        fragment("int outer[2]={1};for(int i=0;i<1;i=1/0){int a[4];{int b[5];continue;}}");
    program_error(&execution, DiagnosticCode::DivZero);
    assert_eq!(execution.state.arrays.len(), 1);
    assert_eq!(array(&execution, "outer").length, 2);
    assert_eq!(scalar(&execution, "i"), Some(0));
    assert_eq!(execution.state.live_bytes, 12);
}

#[test]
fn break_destroys_body_arrays_and_skips_the_for_update() {
    let execution =
        fragment("int outer[2]={1};for(int i=0;1;i=1/0){int a[4];break;}return outer[2];");
    program_error(&execution, DiagnosticCode::IndexBounds);
    assert_eq!(execution.state.variables.len(), 0);
    assert_eq!(execution.state.arrays.len(), 1);
    assert_eq!(execution.state.live_bytes, 8);
}

#[test]
fn nested_loop_continue_and_break_preserve_the_enclosing_array() {
    completed(
        r#"int a[2]={0};for(int i=0;i<2;i=i+1){int local[1]={3};
        for(int j=0;j<3;j=j+1){int scratch[2];if(j==0){continue;}a[i]=a[i]+local[0];break;}}
        printf("%d %d",a[0],a[1]);"#,
        "3 3",
        0,
    );
}

#[test]
fn failing_return_retains_nested_arrays_and_the_last_committed_prefix() {
    let execution = fragment(r#"int a[2]={1};{int b[3]={2};printf("before");return b[3];}"#);
    program_error(&execution, DiagnosticCode::IndexBounds);
    assert_eq!(execution.state.scopes.len(), 2);
    assert_eq!(execution.state.arrays.len(), 2);
    assert_eq!(execution.state.live_bytes, 20);
    assert_eq!(execution.state.output, "before");
    assert_eq!(values(&execution, "a"), vec![Some(1), Some(0)]);
    assert_eq!(values(&execution, "b"), vec![Some(2), Some(0), Some(0)]);
}

#[test]
fn executing_a_checked_array_program_twice_is_deterministic_and_read_only() {
    let checked = analyze(
        r#"int main(){int a[3]={3,1,2};for(int i=0;i<3;i=i+1){a[i]=a[i]+i;}
        printf("%d %d %d",a[0],a[1],a[2]);return a[3];}"#,
    )
    .unwrap();
    let original = checked.clone();
    let first = execute(&checked);
    let second = execute(&checked);
    assert_eq!(checked, original);
    assert_eq!(first, second);
    program_error(&first, DiagnosticCode::IndexBounds);
    assert_eq!(values(&first, "a"), vec![Some(3), Some(2), Some(4)]);
    assert_eq!(first.state.output, "3 2 4");
}

#[test]
fn a_huge_legal_declaration_is_rejected_before_allocation_with_exact_u64_bytes() {
    let source = "int main(){int huge[2147483647];}";
    let execution = run(source);
    let diagnostic = resource_error(&execution, DiagnosticCode::MemoryLimit);
    assert!(source_location(diagnostic, source).contains("huge"));
    assert_eq!(diagnostic.details.dimension, Some("liveBytes"));
    assert_eq!(diagnostic.details.limit, Some(1_048_576));
    assert_eq!(diagnostic.details.used, Some(0));
    assert_eq!(diagnostic.details.attempted, Some(8_589_934_588_u64));
    assert!(execution.state.arrays.is_empty());
    assert!(execution.state.variables.is_empty());
    assert_eq!(execution.state.live_bytes, 0);
}

#[test]
fn exactly_one_mib_of_uninitialized_array_slots_is_permitted() {
    completed("int a[262144];", "", 0);
}

#[test]
fn one_slot_over_the_memory_limit_is_rejected_before_object_creation() {
    let execution = fragment("int a[262145];");
    let diagnostic = resource_error(&execution, DiagnosticCode::MemoryLimit);
    assert_eq!(diagnostic.details.used, Some(0));
    assert_eq!(diagnostic.details.attempted, Some(1_048_580));
    assert!(execution.state.arrays.is_empty());
    assert_eq!(execution.state.live_bytes, 0);
}

#[test]
fn scalar_slots_and_array_slots_share_the_same_exact_memory_allowance() {
    completed("int a[262143];int x=7;return x;", "", 7);
    let execution = fragment("int a[262143];int x=7;int y;");
    let diagnostic = resource_error(&execution, DiagnosticCode::MemoryLimit);
    assert_eq!(diagnostic.details.used, Some(1_048_576));
    assert_eq!(diagnostic.details.attempted, Some(1_048_580));
    assert_eq!(execution.state.live_bytes, 1_048_576);
    assert_eq!(execution.state.variables.len(), 1);
    assert_eq!(scalar(&execution, "x"), Some(7));
    assert_eq!(array(&execution, "a").length, 262143);
}

#[test]
fn memory_is_cumulative_across_arrays_and_a_rejected_second_array_is_absent() {
    completed("int a[131072];int b[131072];", "", 0);
    let execution = fragment("int a[131072];int b[131073]={1};");
    let diagnostic = resource_error(&execution, DiagnosticCode::MemoryLimit);
    assert_eq!(diagnostic.details.used, Some(524_288));
    assert_eq!(diagnostic.details.attempted, Some(1_048_580));
    assert_eq!(execution.state.arrays.len(), 1);
    assert_eq!(array(&execution, "a").length, 131072);
    assert_eq!(execution.state.live_bytes, 524_288);
}

#[test]
fn exiting_a_scope_releases_its_capacity_before_the_next_allocation() {
    completed("{int a[262144];}{int b[262144];}int c[262144];", "", 0);
}

#[test]
fn continue_and_break_release_large_body_arrays_on_control_transfer() {
    completed(
        "for(int i=0;i<4;i=i+1){int a[262143];continue;}for(;;){int b[262144];break;}int c[262144];",
        "",
        0,
    );
}

#[test]
fn partial_array_initialization_charges_work_for_every_logical_slot() {
    let small = completed("int a[1]={5};return a[0];", "", 5);
    let large = completed("int a[200001]={5};return a[200000];", "", 0);
    assert!(large.work_used >= small.work_used + 200_000);
}

#[test]
fn failed_initializer_keeps_the_declared_array_wholly_uninitialized() {
    let block = r#"{int a[262144]={5};printf("ok");}"#;
    let execution = fragment(&block.repeat(4));
    resource_error(&execution, DiagnosticCode::FuelLimit);
    assert_eq!(execution.state.output, "okokok");
    assert_eq!(execution.state.arrays.len(), 1);
    let a = array(&execution, "a");
    assert_eq!(a.length, 262144);
    assert_eq!(a.default_value, None);
    assert!(
        a.cells.is_empty(),
        "initializer cannot commit a partial prefix"
    );
    assert_eq!(element(a, 0), None);
    assert_eq!(element(a, 262143), None);
    assert_eq!(execution.state.live_bytes, 1_048_576);
}

#[test]
fn bubble_sort_reads_compares_and_swaps_the_actual_array() {
    completed(
        r#"int a[6]={3,-2,3,0,-5,1};int n=6;
        for(int i=0;i<n-1;i=i+1){for(int j=0;j<n-1-i;j=j+1){
        if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}}}
        for(int i=0;i<n;i=i+1){printf("%d ",a[i]);}"#,
        "-5 -2 0 1 3 3 ",
        0,
    );
}

#[test]
fn binary_search_uses_runtime_indices_for_found_and_missing_values() {
    for (target, expected) in [(-5, "0"), (3, "3"), (9, "4"), (2, "-1")] {
        completed(
            &format!(
                r#"int a[5]={{-5,0,1,3,9}};int low=0;int high=4;int answer=-1;
            while(low<=high){{int mid=(low+high)/2;if(a[mid]=={target}){{answer=mid;break;}}
            else{{if(a[mid]<{target}){{low=mid+1;}}else{{high=mid-1;}}}}}}
            printf("%d",answer);"#
            ),
            expected,
            0,
        );
    }
}
