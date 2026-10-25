//! Independent 06.4 boundaries over the real metered Rust pipeline.

use std::{cell::Cell, rc::Rc};

use c_viz_core::budget::{BudgetError, FINALIZATION_RESERVE, Limits, Meter};
use c_viz_core::codec::{self, Assembly, CodecError};
use c_viz_core::diagnostic::{DiagnosticCode, Stage};
use c_viz_core::run::{RunResult, RunStatus, run};
use c_viz_core::semantic::analyze_metered;
use c_viz_core::trace::{Direction, apply_step, validate_trace};
use serde_json::{Value, json};

fn meter(limits: Limits) -> Meter {
    let mut meter = Meter::with_limits(limits);
    meter.set_clock(1000, Box::new(|| 0));
    meter
}

fn execute(source: &str) -> RunResult {
    run(source, &mut meter(Limits::default()))
}

fn fragment(body: &str) -> RunResult {
    execute(&format!("int main(void){{{body}}}"))
}

fn code(result: &RunResult, expected: DiagnosticCode) {
    assert_eq!(result.diagnostics.len(), 1, "{result:?}");
    assert_eq!(result.diagnostics[0].code, expected, "{result:?}");
}

fn state(result: &RunResult) -> Value {
    let trace = result.trace.as_ref().expect("real executed prefix");
    validate_trace(trace, &result.node_map).unwrap();
    let mut state = trace.initial_state.clone();
    for step in &trace.steps {
        apply_step(&mut state, step, Direction::Forward).unwrap();
    }
    state
}

fn complete(result: &RunResult, stdout: &str, exit: i32) {
    assert_eq!(result.status, RunStatus::Completed, "{result:?}");
    assert_eq!(result.exit_code, Some(exit));
    assert!(result.diagnostics.is_empty());
    let trace = result.trace.as_ref().unwrap();
    assert_eq!(trace.completeness, "complete");
    assert_eq!(trace.steps.last().unwrap().kind, "program.return");
    let final_state = state(result);
    assert_eq!(final_state["output"], stdout);
    assert_eq!(final_state["control"]["phase"], "returned");
    assert_eq!(final_state["allocator"]["liveBytes"], 0);
    assert!(result.bytes.len() <= Limits::default().result_bytes);
    let stats = result.stats.as_ref().unwrap();
    assert!(stats.fuel_used > 0 && stats.fuel_used <= 1_000_000);
}

#[test]
fn limits_match_the_frozen_p0_budget() {
    let limits = Limits::default();
    assert_eq!(
        (limits.source_bytes, limits.request_bytes),
        (32_768, 65_536)
    );
    assert_eq!((limits.fuel, limits.steps), (1_000_000, 20_000));
    assert_eq!(
        (limits.live_bytes, limits.output_bytes),
        (1_048_576, 16_384)
    );
    assert_eq!(limits.result_bytes, 16_777_216);
    assert_eq!((limits.max_syntax_depth, limits.max_ast_depth), (64, 64));
}

#[test]
fn a_real_completed_and_nonzero_return_are_both_completed() {
    complete(&fragment("int x=7;printf(\"%d\",x*3);return 5;"), "21", 5);
}

#[test]
fn utf8_source_at_32768_bytes_succeeds_and_one_more_is_rejected_before_lexing() {
    let base = "int main(){return 0;}/*";
    let mut source = base.to_owned();
    source.push_str(&"中".repeat((32_768 - base.len() - 2) / 3));
    source.push_str(&" ".repeat(32_768 - source.len() - 2));
    source.push_str("*/");
    assert_eq!(source.len(), 32_768);
    complete(&execute(&source), "", 0);
    source.push(' ');
    let result = execute(&source);
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::SourceLimit);
    assert!(result.trace.is_none());
}

#[test]
fn syntax_depth_64_executes_65_never_enters_the_program() {
    let source = |depth| format!("int main(){{{};{}}}", "{".repeat(depth), "}".repeat(depth));
    let allowed = execute(&source(63));
    complete(&allowed, "", 0);
    assert_eq!(allowed.stats.as_ref().unwrap().max_syntax_depth, 64);
    let rejected = execute(&source(64));
    assert_eq!(rejected.status, RunStatus::ResourceLimit);
    code(&rejected, DiagnosticCode::DepthLimit);
    assert!(rejected.trace.is_none());
}

#[test]
fn independent_ast_depth_64_and_65_flat_chains_have_bounded_behavior() {
    let allowed = fragment(&format!("return {}1;", "1+".repeat(63)));
    complete(&allowed, "", 64);
    assert_eq!(allowed.stats.as_ref().unwrap().max_ast_depth, 64);
    let rejected = fragment(&format!("return {}1;", "1+".repeat(64)));
    assert_eq!(rejected.status, RunStatus::ResourceLimit);
    code(&rejected, DiagnosticCode::DepthLimit);
    assert!(rejected.trace.is_none());
}

#[test]
fn long_flat_malicious_expression_stops_at_the_first_overdeep_ast() {
    let result = fragment(&format!("return {}1;", "1+".repeat(16_000)));
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::DepthLimit);
    assert!(result.trace.is_none());
}

#[test]
fn the_previously_1215920_static_scope_scan_cannot_bypass_the_run_meter() {
    let mut source = String::from("int main(){int x;");
    source.push_str(&"{".repeat(63));
    let count = (32_768 - source.len() - 64) / 4;
    source.push_str(&"x=x;".repeat(count));
    source.push_str(&"}".repeat(64));
    let mut meter = meter(Limits::default());
    let error = analyze_metered(&source, &mut meter).unwrap_err();
    assert_eq!(error.code, DiagnosticCode::FuelLimit);
    assert!(meter.used() <= 1_000_000);
    assert!(meter.used() > 900_000);
    assert!(matches!(meter.failure(), Some(BudgetError::Fuel { .. })));
}

#[test]
fn static_errors_charge_real_work_instead_of_resetting_the_meter() {
    for source in ["@", "int main(){return", "int main(){return missing;}"] {
        let mut meter = meter(Limits::default());
        assert!(analyze_metered(source, &mut meter).is_err());
        assert!(meter.used() > 0, "{source}");
    }
}

#[test]
fn static_fuel_failure_is_not_misreported_as_invalid_c() {
    let mut meter = meter(Limits {
        fuel: 4200,
        ..Default::default()
    });
    let result = run(&format!("int main(){{{}}}", ";".repeat(2000)), &mut meter);
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::FuelLimit);
    assert!(result.trace.is_none());
    assert!(meter.used() <= 4200);
}

#[test]
fn actual_array_capacity_31_is_not_the_teaching_input_length_limit() {
    complete(&fragment("int a[31];a[30]=9;printf(\"%d\",a[30]);"), "9", 0);
}

#[test]
fn the_maximum_uninitialized_array_allocation_and_release_are_legal() {
    let result = fragment("int a[262144];");
    complete(&result, "", 0);
    assert_eq!(result.stats.as_ref().unwrap().peak_virtual_bytes, 1_048_576);
}

#[test]
fn one_slot_above_virtual_memory_fails_before_object_declaration() {
    let result = fragment("int a[262145];");
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::MemoryLimit);
    let trace = result.trace.as_ref().unwrap();
    assert_eq!(trace.steps.len(), 1);
    assert_eq!(state(&result)["objects"], json!([]));
    assert_eq!(state(&result)["allocator"]["nextAddress"], 4096);
}

#[test]
fn an_unreached_oversize_allocation_never_causes_a_resource_failure() {
    complete(&fragment("if(0){int a[2147483647];}return 9;"), "", 9);
}

#[test]
fn simultaneous_objects_accumulate_but_released_scope_capacity_is_reusable() {
    let result = fragment("int x;int a[262144];");
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::MemoryLimit);
    assert_eq!(state(&result)["allocator"]["liveBytes"], 4);
    let result = fragment("{int a[262144];}{int b[262144];}");
    complete(&result, "", 0);
    assert_eq!(result.stats.as_ref().unwrap().peak_virtual_bytes, 1_048_576);
    assert!(state(&result)["allocator"]["nextAddress"].as_u64().unwrap() > 1_048_576);
}

#[test]
fn exact_output_bytes_are_legal_and_a_whole_overflowing_printf_is_rolled_back() {
    let output = "x".repeat(16_384);
    complete(&fragment(&format!("printf(\"{output}\");")), &output, 0);
    let result = fragment(&format!(
        "printf(\"a\");printf(\"{}\");printf(\"late\");",
        "b".repeat(16_384)
    ));
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::OutputLimit);
    assert_eq!(state(&result)["output"], "a");
    assert_eq!(
        result
            .trace
            .as_ref()
            .unwrap()
            .steps
            .iter()
            .filter(|step| step.kind == "output.append")
            .count(),
        1
    );
}

#[test]
fn multibyte_output_is_counted_as_utf8_and_never_partially_appended() {
    let prefix = "中".repeat(5461);
    let result = fragment(&format!("printf(\"{prefix}a\");printf(\"中\");"));
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::OutputLimit);
    assert_eq!(state(&result)["output"], format!("{prefix}a"));
    assert_eq!(state(&result)["output"].as_str().unwrap().len(), 16_384);
}

#[test]
fn a_failed_expression_has_a_restorable_real_prefix_and_no_failure_step() {
    let result = fragment("int x=1;x=2;printf(\"before\");x=1/0;printf(\"late\");");
    assert_eq!(result.status, RunStatus::ProgramError);
    code(&result, DiagnosticCode::DivZero);
    assert_eq!(state(&result)["output"], "before");
    let trace = result.trace.as_ref().unwrap();
    assert_eq!(trace.completeness, "prefix");
    assert_eq!(
        trace
            .steps
            .iter()
            .filter(|step| step.kind == "value.write")
            .count(),
        1
    );
    let mut final_state = state(&result);
    for step in trace.steps.iter().rev() {
        apply_step(&mut final_state, step, Direction::Backward).unwrap();
    }
    assert_eq!(final_state, trace.initial_state);
}

#[test]
fn a_small_step_quota_accepts_exactly_the_limit_and_rejects_before_the_next() {
    let limits = Limits {
        steps: 4,
        ..Default::default()
    };
    complete(&run("int main(){;;}", &mut meter(limits)), "", 0);
    let result = run("int main(){;;;printf(\"late\");}", &mut meter(limits));
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::StepLimit);
    assert_eq!(result.trace.as_ref().unwrap().steps.len(), 4);
    assert_eq!(state(&result)["output"], "");
    assert_eq!(result.trace.as_ref().unwrap().completeness, "prefix");
}

#[test]
fn a_dead_loop_has_bounded_work_and_cannot_execute_its_late_output() {
    let result = fragment("while(1){}printf(\"late\");");
    assert_eq!(result.status, RunStatus::ResourceLimit, "{result:?}");
    assert!(matches!(
        result.diagnostics[0].code,
        DiagnosticCode::FuelLimit | DiagnosticCode::StepLimit | DiagnosticCode::ResultLimit
    ));
    assert_eq!(state(&result)["output"], "");
    assert!(result.trace.as_ref().unwrap().steps.len() <= 20_000);
}

#[test]
fn cancellation_before_work_has_no_invented_trace_or_statistics() {
    let mut meter = meter(Limits::default());
    meter.set_cancel(Box::new(|| true));
    let result = run("int main(){printf(\"late\");}", &mut meter);
    assert_eq!(result.status, RunStatus::Cancelled);
    code(&result, DiagnosticCode::Cancelled);
    assert!(result.trace.is_none());
    assert!(result.stats.is_none());
    assert_eq!(meter.charge(0), Err(BudgetError::Cancelled));
}

#[test]
fn cancellation_during_a_static_scan_remains_distinct_from_resource_exhaustion() {
    let checks = Rc::new(Cell::new(0));
    let seen = checks.clone();
    let mut meter = meter(Limits::default());
    meter.set_cancel(Box::new(move || {
        seen.set(seen.get() + 1);
        seen.get() >= 4
    }));
    let result = run(
        &format!("int main(){{}}/*{}*/", "x".repeat(20_000)),
        &mut meter,
    );
    assert_eq!(result.status, RunStatus::Cancelled);
    code(&result, DiagnosticCode::Cancelled);
    assert!(result.trace.is_none());
    assert!(result.stats.is_none());
    assert!(meter.used() <= 3072);
}

#[test]
fn cancellation_during_execution_discards_the_prefix_and_prevents_late_output() {
    let checks = Rc::new(Cell::new(0));
    let seen = checks.clone();
    let mut meter = meter(Limits::default());
    meter.set_cancel(Box::new(move || {
        seen.set(seen.get() + 1);
        seen.get() >= 100
    }));
    let result = run("int main(){while(1){}printf(\"late\");}", &mut meter);
    assert_eq!(result.status, RunStatus::Cancelled);
    code(&result, DiagnosticCode::Cancelled);
    assert_eq!(checks.get(), 100);
    assert!(result.trace.is_none());
    assert!(result.stats.is_none());
    let used = meter.used();
    assert_eq!(meter.check_commit(), Err(BudgetError::Cancelled));
    assert_eq!(meter.used(), used);
}

#[test]
fn a_run_expiring_exactly_at_its_inherited_deadline_cannot_complete() {
    let calls = Rc::new(Cell::new(0));
    let seen = calls.clone();
    let mut meter = meter(Limits::default());
    meter.set_clock(
        37,
        Box::new(move || {
            seen.set(seen.get() + 1);
            if seen.get() == 1 { 0 } else { 37 }
        }),
    );
    let result = run("int main(){return 0;}", &mut meter);
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::Deadline);
    assert!(result.trace.is_none());
    assert!(result.stats.is_none());
    assert!(meter.begin_finalization().is_err());
}

#[test]
fn a_past_deadline_during_static_work_never_emits_a_late_success() {
    let calls = Rc::new(Cell::new(0));
    let seen = calls.clone();
    let mut meter = meter(Limits::default());
    meter.set_clock(
        50,
        Box::new(move || {
            seen.set(seen.get() + 1);
            if seen.get() >= 4 { 50 } else { 0 }
        }),
    );
    let result = run(
        &format!("int main(){{}}/*{}*/", "x".repeat(20_000)),
        &mut meter,
    );
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::Deadline);
    assert!(result.trace.is_none());
    assert!(result.stats.is_none());
    assert!(meter.used() <= 2048);
}

#[test]
fn deadline_during_execution_cannot_encode_or_return_the_running_prefix() {
    let checks = Rc::new(Cell::new(0));
    let seen = checks.clone();
    let mut meter = meter(Limits::default());
    meter.set_clock(
        1000,
        Box::new(move || {
            seen.set(seen.get() + 1);
            if seen.get() >= 100 { 1000 } else { 0 }
        }),
    );
    let result = run("int main(){while(1){}printf(\"late\");}", &mut meter);
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::Deadline);
    assert!(result.trace.is_none());
    assert!(result.stats.is_none());
    assert_eq!(checks.get(), 100);
    assert!(meter.begin_finalization().is_err());
}

#[test]
fn bounded_result_exhaustion_retains_only_admitted_complete_atomic_steps() {
    let result = run(
        "int main(){while(1){;}printf(\"late\");}",
        &mut meter(Limits {
            result_bytes: 80_000,
            ..Default::default()
        }),
    );
    assert_eq!(result.status, RunStatus::ResourceLimit);
    code(&result, DiagnosticCode::ResultLimit);
    assert!(result.bytes.len() <= 80_000);
    let trace = result.trace.as_ref().unwrap();
    assert_eq!(trace.completeness, "prefix");
    assert!(!trace.steps.is_empty());
    assert_eq!(state(&result)["output"], "");
    assert_eq!(
        trace
            .steps
            .iter()
            .filter(|step| step.kind == "output.append")
            .count(),
        0
    );
}

#[test]
fn the_terminal_and_final_assembly_reserve_are_inside_the_fuel_limit() {
    let mut meter = meter(Limits {
        fuel: 5000,
        ..Default::default()
    });
    meter.reserve_result(128).unwrap();
    assert_eq!(meter.reserved(), FINALIZATION_RESERVE + 2);
    meter.charge(902).unwrap();
    assert!(matches!(
        meter.charge(1),
        Err(BudgetError::Fuel { limit: 5000, .. })
    ));
    assert_eq!(meter.used(), 902);
    meter.begin_finalization().unwrap();
    meter.charge(4098).unwrap();
    assert_eq!(meter.used(), 5000);
    assert!(meter.charge(1).is_err());
}

#[test]
fn rejecting_a_larger_result_reservation_does_not_spend_the_previous_tail() {
    let mut meter = meter(Limits {
        fuel: 5000,
        ..Default::default()
    });
    meter.reserve_result(64).unwrap();
    meter.charge(900).unwrap();
    assert!(meter.reserve_result(320).is_err());
    assert_eq!(meter.reserved(), 4097);
    meter.begin_finalization().unwrap();
    meter.charge(4097).unwrap();
    assert_eq!(meter.used(), 4997);
}

#[test]
fn controls_are_checked_during_a_large_charge_at_most_every_1024_units() {
    let calls = Rc::new(Cell::new(0));
    let seen = calls.clone();
    let mut meter = meter(Limits::default());
    meter.set_clock(
        1000,
        Box::new(move || {
            seen.set(seen.get() + 1);
            if seen.get() >= 4 { 1000 } else { 0 }
        }),
    );
    assert!(matches!(
        meter.charge(10_000),
        Err(BudgetError::Deadline { .. })
    ));
    assert_eq!(meter.used(), 2048);
}

#[test]
fn request_65536_byte_boundary_is_checked_before_utf8_or_fuel_work() {
    let good = format!("\"{}\"", "x".repeat(65_534));
    assert_eq!(good.len(), 65_536);
    assert!(codec::decode(good.as_bytes(), &mut meter(Limits::default()), 65_536).is_ok());
    let mut no_fuel = meter(Limits {
        fuel: 1,
        ..Default::default()
    });
    assert!(matches!(
        codec::decode(&[255; 65_537], &mut no_fuel, 65_536),
        Err(CodecError::Limit {
            limit: 65_536,
            attempted: 65_537,
            ..
        })
    ));
    assert_eq!(no_fuel.used(), 0);
}

#[test]
fn canonical_codec_handles_escape_expansion_and_exact_utf8_boundaries() {
    let value = json!({"a":"\u{0}中文\n\\\"/","z":9007199254740991_i64});
    let expected = "{\"a\":\"\\u0000中文\\n\\\\\\\"/\",\"z\":9007199254740991}".as_bytes();
    let encoded = codec::encode(&value, &mut meter(Limits::default()), expected.len()).unwrap();
    assert_eq!(encoded, expected);
    assert_eq!(
        codec::decode(&encoded, &mut meter(Limits::default()), encoded.len()).unwrap(),
        value
    );
    assert!(matches!(
        codec::encode(&value, &mut meter(Limits::default()), expected.len() - 1),
        Err(CodecError::Limit { .. })
    ));
}

#[test]
fn duplicate_keys_noncanonical_numbers_unicode_and_trailing_data_are_rejected() {
    let invalid: &[&[u8]] = &[
        b"{\"a\":1,\"a\":2}",
        b"{\"z\":1,\"a\":2}",
        b"-0",
        b"1.0",
        b"1e0",
        b"01",
        b"9007199254740992",
        b"\"\\ud800\"",
        b"\"\\u0061\"",
        b"\"\\/\"",
        b"\"\xff\"",
        b"null\n",
        b"\xef\xbb\xbfnull",
    ];
    for value in invalid {
        assert!(
            codec::decode(value, &mut meter(Limits::default()), 65536).is_err(),
            "{value:?}"
        );
    }
}

#[test]
fn json_container_depth_32_is_available_33_is_rejected_independently_of_c_depth() {
    let good = format!("{}0{}", "[".repeat(32), "]".repeat(32));
    let value = codec::decode(good.as_bytes(), &mut meter(Limits::default()), 1000).unwrap();
    assert_eq!(
        codec::encode(&value, &mut meter(Limits::default()), 1000).unwrap(),
        good.as_bytes()
    );
    let bad = format!("[{good}]");
    assert!(matches!(
        codec::decode(bad.as_bytes(), &mut meter(Limits::default()), 1000),
        Err(CodecError::Depth {
            limit: 32,
            attempted: 33
        })
    ));
}

#[test]
fn the_result_buffer_accepts_16mib_and_rejects_the_next_byte_without_retaining_it() {
    let mut meter = meter(Limits::default());
    meter.begin_finalization().unwrap();
    let mut assembly = Assembly::new(16_777_216);
    let part = vec![b'x'; 65_536];
    for _ in 0..256 {
        assembly.append(&part, &mut meter).unwrap();
    }
    assert_eq!(assembly.len(), 16_777_216);
    assert!(matches!(
        assembly.append(b"x", &mut meter),
        Err(CodecError::Limit {
            limit: 16_777_216,
            used: 16_777_216,
            attempted: 16_777_217
        })
    ));
    assert_eq!(assembly.len(), 16_777_216);
    assert_eq!(meter.used(), 262_144);
}

#[test]
fn unsafe_or_float_numbers_and_nonascii_protocol_keys_cannot_be_encoded() {
    for value in [json!(1.25), json!(9007199254740992_u64), json!({"中":1})] {
        assert!(codec::encode(&value, &mut meter(Limits::default()), 1000).is_err());
    }
}

#[test]
fn unsupported_library_process_file_and_network_calls_have_no_runtime_channel() {
    for body in [
        "system(0);",
        "fopen(0);",
        "fork();",
        "execve(0);",
        "socket(0);",
        "fetch(0);",
        "malloc(4);",
    ] {
        let result = fragment(body);
        assert_eq!(result.status, RunStatus::ProgramError, "{body}: {result:?}");
        assert!(result.trace.is_none(), "{body}");
    }
}

fn sorting_source(values: &[i32], selection: bool) -> String {
    let values = values
        .iter()
        .map(i32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let algorithm = if selection {
        "for(int i=0;i<30;i=i+1){int m=i;for(int j=i+1;j<30;j=j+1){if(a[j]<a[m]){m=j;}}if(m!=i){int t=a[i];a[i]=a[m];a[m]=t;}}"
    } else {
        "for(int i=0;i<29;i=i+1){for(int j=0;j<29-i;j=j+1){if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}}}"
    };
    format!(
        "int main(){{int a[30]={{{values}}};{algorithm}for(int k=0;k<30;k=k+1){{printf(\"%d \",a[k]);}}}}"
    )
}

#[test]
fn all_30_reverse_bubble_elements_sort_with_a_complete_real_trace_in_budget() {
    let values = (1..=30).rev().collect::<Vec<_>>();
    let expected = (1..=30)
        .map(|value| format!("{value} "))
        .collect::<String>();
    complete(&execute(&sorting_source(&values, false)), &expected, 0);
}

#[test]
fn all_30_selection_elements_sort_with_a_complete_real_trace_in_budget() {
    let values = (1..=30).rev().map(|value| value - 15).collect::<Vec<_>>();
    let expected = (-14..=15)
        .map(|value| format!("{value} "))
        .collect::<String>();
    complete(&execute(&sorting_source(&values, true)), &expected, 0);
}

#[test]
fn equal_duplicate_and_negative_30_item_sort_inputs_are_still_legal() {
    for selection in [false, true] {
        let values = (0..30).map(|index| (index % 7) - 3).collect::<Vec<_>>();
        let mut sorted = values.clone();
        sorted.sort();
        let expected = sorted
            .iter()
            .map(|value| format!("{value} "))
            .collect::<String>();
        complete(&execute(&sorting_source(&values, selection)), &expected, 0);
    }
}

#[test]
fn binary_search_30_items_first_duplicate_and_missing_values_complete_in_budget() {
    let values = (0..30)
        .map(|index| (index / 2).to_string())
        .collect::<Vec<_>>()
        .join(",");
    for (target, expected) in [(0, 0), (7, 14), (14, 28), (-1, -1), (15, -1)] {
        let body = format!(
            "int a[30]={{{values}}};int l=0;int r=29;int found=-1;while(l<=r){{int m=l+(r-l)/2;if(a[m]>= {target}){{if(a[m]=={target}){{found=m;}}r=m-1;}}else{{l=m+1;}}}}printf(\"%d\",found);"
        );
        complete(&fragment(&body), &expected.to_string(), 0);
    }
}

#[test]
fn a_real_result_buffer_is_canonical_and_contains_no_raw_source_copy() {
    let source = "int main(){/*sensitive_unique_source_marker*/printf(\"中文\");}";
    let result = execute(source);
    complete(&result, "中文", 0);
    let parsed = codec::decode(&result.bytes, &mut meter(Limits::default()), 16_777_216).unwrap();
    assert_eq!(
        codec::encode(&parsed, &mut meter(Limits::default()), 16_777_216).unwrap(),
        result.bytes
    );
    assert!(!String::from_utf8_lossy(&result.bytes).contains("sensitive_unique_source_marker"));
}

#[test]
fn cancelled_diagnostic_uses_the_frozen_adapter_code_and_synthetic_location() {
    let diagnostic = BudgetError::Cancelled.diagnostic(
        Stage::Preflight,
        c_viz_core::diagnostic::Location::Synthetic {
            reason: "internal-preflight",
        },
    );
    let value = serde_json::to_value(diagnostic).unwrap();
    assert_eq!(value["code"], "E_CANCELLED");
    assert_eq!(value["origin"], "adapter");
    assert_eq!(
        value["location"],
        json!({"kind":"synthetic","reason":"adapter-cancel"})
    );
}

#[test]
fn encoded_report_fields_and_final_fuel_equal_the_returned_core_result() {
    for source in [
        "int main(){printf(\"中\");return 7;}",
        "int main(){int a[2];a[0]=3;return a[1];}",
        "int main(){int a[262145];}",
        "int main(){int missing=;}",
    ] {
        let mut meter = meter(Limits::default());
        let result = run(source, &mut meter);
        let encoded: Value =
            serde_json::from_slice(&result.bytes).expect("bounded terminal buffer");
        assert_eq!(encoded["stats"]["fuelUsed"], meter.used());
        assert_eq!(result.stats.as_ref().unwrap().fuel_used, meter.used());
        assert_eq!(
            encoded["nodeMap"],
            serde_json::to_value(&result.node_map).unwrap()
        );
        assert_eq!(
            encoded["trace"],
            serde_json::to_value(&result.trace).unwrap()
        );
        assert_eq!(
            encoded["diagnostics"],
            serde_json::to_value(&result.diagnostics).unwrap()
        );
        assert_eq!(
            encoded["exitCode"],
            serde_json::to_value(result.exit_code).unwrap()
        );
    }
}

#[test]
fn public_input_instantiation_binding_and_execution_share_the_same_run_meter() {
    let package: Value =
        serde_json::from_str(include_str!("../../../项目文档/契约/02.1-内容样例.json")).unwrap();
    for id in ["program.c.bubble-sort", "program.c.selection-sort"] {
        let program = package["programs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap();
        let spec = package["inputSpecs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == program["inputRef"]["id"])
            .unwrap();
        let mut meter = meter(Limits::default());
        let input = json!({"values":(1..=30).rev().collect::<Vec<_>>()});
        let prepared =
            c_viz_core::input::prepare_metered(program, spec, &input, &mut meter).unwrap();
        let preparation_fuel = meter.used();
        assert!(preparation_fuel > 0);
        let result = run(prepared.source(), &mut meter);
        assert_eq!(result.status, RunStatus::Completed, "{id}: {result:?}");
        assert!(result.stats.as_ref().unwrap().fuel_used > preparation_fuel);
        assert_eq!(result.stats.as_ref().unwrap().fuel_used, meter.used());
        validate_trace(result.trace.as_ref().unwrap(), &result.node_map).unwrap();
    }
}

#[test]
fn fuel_exhaustion_at_preexecution_boundaries_never_disagrees_with_encoded_node_map() {
    let source = format!("int main(){{{}}}", ";".repeat(80));
    for fuel in (5000..9000).step_by(7) {
        let mut meter = meter(Limits {
            fuel,
            ..Default::default()
        });
        let result = run(&source, &mut meter);
        if result.bytes.is_empty() {
            assert!(result.trace.is_none() && result.stats.is_none());
            continue;
        }
        let encoded: Value = serde_json::from_slice(&result.bytes).unwrap();
        assert_eq!(
            encoded["nodeMap"],
            serde_json::to_value(&result.node_map).unwrap(),
            "fuel={fuel}"
        );
        assert_eq!(encoded["stats"]["fuelUsed"], meter.used(), "fuel={fuel}");
    }
}

#[test]
fn unavailable_terminal_buffer_is_an_encode_infrastructure_failure_without_fake_prefix() {
    let mut meter = meter(Limits {
        result_bytes: 64,
        ..Default::default()
    });
    let result = run("int main(){}", &mut meter);
    assert_eq!(result.status, RunStatus::InfrastructureFailure);
    code(&result, DiagnosticCode::EncodingFailure);
    assert_eq!(result.diagnostics[0].stage, Stage::Encode);
    assert_eq!(result.diagnostics[0].origin, "adapter");
    assert_eq!(
        serde_json::to_value(&result.diagnostics[0].location).unwrap(),
        json!({"kind":"synthetic","reason":"encoding-failure"})
    );
    assert!(result.trace.is_none() && result.stats.is_none() && result.bytes.is_empty());
}
