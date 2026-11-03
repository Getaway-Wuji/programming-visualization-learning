use c_viz_c6::{
    budget::{Limits, Meter},
    check,
    runtime::Runtime,
    state::Totals,
    syntax,
};
use std::collections::BTreeSet;
fn fail(source: &str, limits: Limits) -> (&'static str, usize) {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024)
            .spawn_scoped(scope, move || fail_inner(source, limits))
            .unwrap()
            .join()
            .unwrap()
    })
}
fn fail_inner(source: &str, limits: Limits) -> (&'static str, usize) {
    let mut meter = Meter::with_limits(limits);
    let p = syntax::parse(source, &mut meter).unwrap();
    let checked = check::check(p, &mut meter).unwrap();
    let mut totals = Totals::default();
    let mut runtime =
        Runtime::new(&checked, b"", BTreeSet::new(), 0, &mut totals, &mut meter).unwrap();
    let fault = runtime.run().unwrap_err();
    if fault.code == "E_STACK_LIMIT" {
        assert_eq!(
            runtime.journal.state["frames"].as_array().unwrap().len(),
            32
        );
    }
    (fault.code, runtime.journal.steps.len())
}
#[test]
fn shared_step_limit_is_exact_and_returns_prefix() {
    let (code, steps) = fail(
        "int main(){int n=0;while(1){n++;}}",
        Limits {
            steps: 40,
            ..Limits::default()
        },
    );
    assert_eq!(code, "E_STEP_LIMIT");
    assert_eq!(steps, 40);
}
#[test]
fn actual_virtual_live_memory_limit_across_global_struct_arrays() {
    let mut source = String::from(
        "struct S{char a[64];char b[64];char c[64];char d[64];char e[64];char f[64];char g[64];char h[64];};",
    );
    for i in 0..69 {
        source.push_str(&format!("struct S x{i}[30];"))
    }
    source.push_str("int main(){return 0;}");
    let (code, _) = fail(&source, Limits::default());
    assert_eq!(code, "E_MEMORY_LIMIT");
}
#[test]
fn exactly_32_frames_and_then_stack_limit() {
    let (code, _) = fail(
        "int recurse(int n){return recurse(n+1);}int main(){return recurse(0);}",
        Limits::default(),
    );
    assert_eq!(code, "E_STACK_LIMIT");
}

#[test]
fn combined_c_evaluation_reaches_256_and_refuses_the_next_level() {
    std::thread::Builder::new().stack_size(8*1024*1024).spawn(||{
        for n in [4,5]{
            let source=format!("int f(int n){{if(n==0)return 0;return {}f(n-1);}}int main(){{return + + f({n});}}","+ ".repeat(57));
            let mut meter=Meter::new();let checked=check::check(syntax::parse(&source,&mut meter).unwrap(),&mut meter).unwrap();let mut totals=Totals::default();
            let mut runtime=Runtime::new(&checked,b"",BTreeSet::new(),0,&mut totals,&mut meter).unwrap();let result=runtime.run();
            assert_eq!(runtime.peak_depth,256,"n={n}");
            if n==4{assert_eq!(result.unwrap().value,c_viz_c6::types::Val::I(0))}else{assert_eq!(result.unwrap_err().code,"E_DEPTH_LIMIT")}
        }
    }).unwrap().join().unwrap();
}
#[test]
fn output_budget_uses_actual_bytes() {
    let (code, _) = fail(
        "#include <stdio.h>\nint main(){while(1)printf(\"0123456789\");}",
        Limits {
            output_bytes: 20,
            ..Limits::default()
        },
    );
    assert_eq!(code, "E_OUTPUT_LIMIT");
}
#[test]
fn lifetime_and_unsequenced_errors_are_runtime_diagnostics() {
    for (source, wanted) in [
        (
            "int main(){int a=1;return a++ + a;}",
            "E_UNSUPPORTED_SYNTAX",
        ),
        (
            "int *p;int f(){int x=1;p=&x;return 0;}int main(){f();return *p;}",
            "E_DANGLING_POINTER",
        ),
        (
            "int main(){int a[2]={1,2};return a[2];}",
            "E_POINTER_BOUNDS",
        ),
    ] {
        let (code, _) = fail(source, Limits::default());
        assert_eq!(code, wanted)
    }
}
