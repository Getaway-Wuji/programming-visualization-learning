use c_viz_c6::{
    budget::Meter,
    check,
    runtime::Runtime,
    state::{self, Totals},
    syntax,
    types::{Ty, Val},
};
use std::collections::BTreeSet;

fn run(source: &str) -> (Val, usize) {
    let mut meter = Meter::new();
    let program = syntax::parse(source, &mut meter).expect("parse");
    let checked = check::check(program, &mut meter).expect("check");
    let mut totals = Totals::default();
    let mut runtime =
        Runtime::new(&checked, b"", BTreeSet::new(), 0, &mut totals, &mut meter).expect("runtime");
    let value = runtime.run().expect("execute");
    let initial: serde_json::Value = serde_json::from_slice(&runtime.journal.initial).unwrap();
    let mut state = initial.clone();
    for step in &runtime.journal.steps {
        let step: serde_json::Value = serde_json::from_slice(step).unwrap();
        state::apply(
            &mut state,
            step["changes"].as_array().unwrap(),
            &checked.types,
            false,
        )
        .unwrap();
    }
    assert_eq!(state, runtime.journal.state, "all forward atoms");
    for step in runtime.journal.steps.iter().rev() {
        let step: serde_json::Value = serde_json::from_slice(step).unwrap();
        state::apply(
            &mut state,
            step["changes"].as_array().unwrap(),
            &checked.types,
            true,
        )
        .unwrap();
    }
    assert_eq!(state, initial, "all reverse atoms");
    (value.value, runtime.journal.steps.len())
}
#[test]
fn actual_integer_assignment_and_order() {
    assert_eq!(
        run("int main(void){int x=3; x*=5; x+=2; return x;}").0,
        Val::I(17)
    );
}
#[test]
fn actual_if_and_short_circuit() {
    assert_eq!(
        run("int main(void){int x=3; if(x>0 && 1) x+=4; else x=0; return x;}").0,
        Val::I(7)
    );
    assert_eq!(
        run("int main(void){int x=0; if(x && 1/x) return 9; return 2;}").0,
        Val::I(2)
    );
}
#[test]
fn actual_three_loops_and_control() {
    assert_eq!(run("int main(){int s=0;for(int i=0;i<5;i++){if(i==2)continue;s+=i;}int n=2;while(n>0){s+=n;--n;}do{s++;}while(s<12);return s;}").0,Val::I(12));
}
#[test]
fn actual_array_and_pointer_stride() {
    assert_eq!(
        run("int main(){int a[3]={2,4,8};int *p=a;p++;*p+=3;return a[0]+a[1]+a[2];}").0,
        Val::I(17)
    );
}
#[test]
fn actual_forward_prototype_and_parameters() {
    assert_eq!(
        run("int twice(int); int main(){return twice(9);} int twice(int n){return n*2;}").0,
        Val::I(18)
    );
}
#[test]
fn actual_self_recursion() {
    assert_eq!(
        run("int sum(int n){if(n==0)return 0;return n+sum(n-1);}int main(){return sum(6);}").0,
        Val::I(21)
    );
}
#[test]
fn actual_static_and_new_run_reset() {
    let s = "int next(){static int n=0;n+=3;return n;}int main(){next();return next();}";
    assert_eq!(run(s).0, Val::I(6));
    assert_eq!(run(s).0, Val::I(6));
}
#[test]
fn actual_globals_and_shadowing() {
    assert_eq!(
        run("int x=2;int f(){return x;}int main(){int x=7;{int x=4;x++;}return x+f();}").0,
        Val::I(9)
    );
}
#[test]
fn actual_flat_struct_fields_and_virtual_abi() {
    assert_eq!(run("struct S{char a;double b;int c;};int main(){struct S s={1,2.5,3};struct S *p=&s;p->c=9;return s.c+(int)sizeof(struct S);}").0,Val::I(33));
}
#[test]
fn actual_const_struct_and_char_array() {
    assert_eq!(run("struct S{char text[4];int n;};int main(){const struct S s={\"abc\",7};return s.text[1]+s.n;}").0,Val::I(105));
}
#[test]
fn actual_unsigned_wrap_shift() {
    assert_eq!(
        run("int main(){unsigned x=4294967295u; x+=1u; return (int)(x|3u);}").0,
        Val::I(3)
    );
    assert_eq!(
        run("int main(){unsigned x=1u<<31;return x==2147483648u;}").0,
        Val::I(1)
    );
}
#[test]
fn actual_finite_typed_float_and_cast() {
    assert_eq!(
        run("int main(){float x=0.125f;double y=x*4.0;return (int)(y*10.0);}").0,
        Val::I(5)
    );
}
#[test]
fn actual_conditional_only_evaluates_chosen_arm() {
    assert_eq!(run("int main(){int x=0;return x?1/x:7;}").0, Val::I(7));
}
#[test]
fn actual_switch_fallthrough_break() {
    assert_eq!(run("int main(){int x=2;int y=0;switch(x){case 1:y+=1;case 2:y+=2;case 3:y+=3;break;default:y=99;}return y;}").0,Val::I(5));
}
#[test]
fn actual_enum_typedef_macro_and_sizeof_unevaluated() {
    assert_eq!(run("#define K 4\ntypedef int Number;enum Color{RED=2,BLUE};int main(){Number n=K;return BLUE+n+(int)sizeof(n++);}").0,Val::I(11));
}
#[test]
fn actual_char_literal_has_c_int_type() {
    assert_eq!(run("int main(){return (int)sizeof('a');}").0, Val::I(4));
}
#[test]
fn actual_negative_minimum() {
    assert_eq!(
        run("int main(){int n=-2147483648;return n<0;}").0,
        Val::I(1)
    );
}
#[test]
fn type_wire_preserves_negative_zero_and_subnormal() {
    assert_eq!(Val::D(-0.0).wire()["bits"], "8000000000000000");
    assert_eq!(Val::F(f32::from_bits(1)).wire()["bits"], "00000001");
    assert_eq!(Val::zero(&Ty::F32).unwrap().wire()["kind"], "f32");
}
#[test]
fn static_rejects_unreachable_bad_types_and_names() {
    for source in [
        "int main(){if(0)missing=1;return 0;}",
        "int main(){const int x=2;if(0)x=4;return 0;}",
        "int main(){if(0){int a[31];}return 0;}",
        "int f(int x){return x;}int main(){if(0)f();return 0;}",
    ] {
        let mut m = Meter::new();
        let rejected =
            syntax::parse(source, &mut m).and_then(|p| check::check(p, &mut m).map(|_| ()));
        assert!(rejected.is_err(), "{source}");
    }
}
#[test]
fn static_rejects_banned_and_mutual_recursion() {
    for source in [
        "long main(){return 0;}",
        "int main(){int a[2][2];return 0;}",
        "int main(){int **p;return 0;}",
        "int a(int);int b(int);int a(int n){return b(n);}int b(int n){return a(n);}int main(){return a(1);}",
    ] {
        let mut m = Meter::new();
        assert!(
            syntax::parse(source, &mut m)
                .and_then(|p| check::check(p, &mut m).map(|_| ()))
                .is_err(),
            "{source}"
        );
    }
}
#[test]
fn unicode_comment_keeps_original_byte_ranges() {
    let source = "/* 中文🙂 */ int main(){return 3;}";
    let mut m = Meter::new();
    let p = syntax::parse(source, &mut m).unwrap();
    for n in &p.nodes {
        assert!(source.is_char_boundary(n.range.start) && source.is_char_boundary(n.range.end));
    }
    assert_eq!(run(source).0, Val::I(3));
}
