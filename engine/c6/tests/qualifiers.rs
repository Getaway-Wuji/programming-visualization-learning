//! Regression for the course-authoring failures: pointer operand qualifiers,
//! without weakening assignment compatibility or pointer object bounds.
use c_viz_c6::{
    budget::Meter,
    check,
    runtime::Runtime,
    state::{self, Totals},
    syntax,
    types::Val,
};
use std::collections::BTreeSet;

#[test]
fn pointer_object_const_and_target_const_have_distinct_wire_identities() {
    use c_viz_c6::types::{Ty, Types};
    let target_const = Ty::Pointer(Box::new(Ty::Const(Box::new(Ty::Int))));
    let pointer_const = Ty::Const(Box::new(Ty::Pointer(Box::new(Ty::Int))));
    let both_const = Ty::Const(Box::new(target_const.clone()));
    for order in [
        [
            target_const.clone(),
            pointer_const.clone(),
            both_const.clone(),
        ],
        [
            pointer_const.clone(),
            both_const.clone(),
            target_const.clone(),
        ],
    ] {
        let mut types = Types::default();
        for ty in order {
            types.describe(&ty).unwrap();
        }
        let read = types.describe(&target_const).unwrap();
        let fixed = types.describe(&pointer_const).unwrap();
        let both = types.describe(&both_const).unwrap();
        assert_ne!(read.name, fixed.name);
        assert_ne!(read.name, both.name);
        assert_ne!(fixed.name, both.name);
        assert_eq!(read.pointee_type.as_deref(), Some("const int"));
        assert_eq!(fixed.pointee_type.as_deref(), Some("int"));
        assert_eq!(both.pointee_type.as_deref(), Some("const int"));
        assert_eq!(types.resolved[&read.name], target_const);
        assert_eq!(types.resolved[&fixed.name], pointer_const);
        assert_eq!(types.resolved[&both.name], both_const);
    }
}

#[test]
fn mixed_pointer_qualifiers_execute_in_either_declaration_order() {
    for declarations in [
        "const int *reader=data;int *const fixed=data;const int *const both=data;",
        "int *const fixed=data;const int *const both=data;const int *reader=data;",
    ] {
        let source = format!(
            "#include <stdio.h>\nint main(void){{int data[2]={{2,4}};{declarations}reader++;*fixed=3;printf(\"%d %d %d\\n\",*reader,*fixed,*both);return 0;}}"
        );
        assert_program(&source, "4 3 3\n", None);
    }
}

#[test]
fn pointer_alias_qualification_and_const_structure_fields_remain_distinct() {
    assert_program(
        "#include <stdio.h>\ntypedef int *Link;int value=2;struct Views{int *const fixed;const int *reader;};int main(void){Link const fixed=&value;const int *reader=&value;struct Views views={&value,&value};*fixed=7;printf(\"%d %d %d\\n\",*reader,*views.fixed,*views.reader);return 0;}",
        "7 7 7\n",
        None,
    );
    for source in [
        "int main(void){int value=2;const int *reader=&value;int *const fixed=&value;fixed=0;return 0;}",
        "int main(void){int value=2;int *const fixed=&value;const int *reader=&value;*reader=7;return 0;}",
        "int main(void){int value=2;const int *const both=&value;*both=7;return 0;}",
    ] {
        assert_program(source, "", Some("E_CONST_WRITE"));
    }
}

fn assert_program(source: &str, output: &str, error: Option<&str>) {
    let mut meter = Meter::new();
    let program = syntax::parse(source, &mut meter).expect("parse");
    let checked = match check::check(program, &mut meter) {
        Ok(value) => value,
        Err(fault) => {
            assert_eq!(Some(fault.code), error, "static diagnostic: {source}");
            assert_eq!(output, "");
            return;
        }
    };
    let mut totals = Totals::default();
    let mut runtime =
        Runtime::new(&checked, b"", BTreeSet::new(), 0, &mut totals, &mut meter).unwrap();
    match error {
        Some(code) => assert_eq!(runtime.run().unwrap_err().code, code),
        None => assert_eq!(runtime.run().unwrap().value, Val::I(0)),
    }
    assert_eq!(runtime.journal.state["output"], output);
    let initial: serde_json::Value = serde_json::from_slice(&runtime.journal.initial).unwrap();
    let mut actual = initial.clone();
    for step in &runtime.journal.steps {
        let step: serde_json::Value = serde_json::from_slice(step).unwrap();
        state::apply(
            &mut actual,
            step["changes"].as_array().unwrap(),
            &checked.types,
            false,
        )
        .unwrap();
    }
    assert_eq!(actual, runtime.journal.state);
    for step in runtime.journal.steps.iter().rev() {
        let step: serde_json::Value = serde_json::from_slice(step).unwrap();
        state::apply(
            &mut actual,
            step["changes"].as_array().unwrap(),
            &checked.types,
            true,
        )
        .unwrap();
    }
    assert_eq!(
        actual, initial,
        "full reverse after success or runtime refusal"
    );
}

#[test]
fn original_char_array_equality_failure_in_both_directions() {
    assert_program(
        "#include <stdio.h>\nint main(void){char data[]=\"elm\";const char *view=data;printf(\"%d %d %d %d\\n\",data==view,view==data,data!=view,view!=data);return 0;}",
        "1 1 0 0\n",
        None,
    );
}

#[test]
fn all_relational_operators_ignore_only_target_top_const() {
    assert_program(
        "#include <stdio.h>\nint main(void){int data[3]={2,4,6};int *first=data;const int *last=data+2;printf(\"%d %d %d %d\\n\",first<last,first<=last,last>first,last>=first);return 0;}",
        "1 1 1 1\n",
        None,
    );
}

#[test]
fn qualified_pointer_differences_and_one_past_are_real() {
    assert_program(
        "#include <stdio.h>\nint main(void){int data[3]={2,4,6};int *first=data;const int *last=data+3;printf(\"%d %d\\n\",last-first,first-last);return 0;}",
        "3 -3\n",
        None,
    );
}

#[test]
fn aliases_and_pointer_top_const_preserve_compatible_target_identity() {
    assert_program(
        "#include <stdio.h>\ntypedef int Element;int main(void){int data[2]={4,8};int *const first=data;const Element *last=data+1;printf(\"%d %d %d\\n\",first<last,last-first,first==last);return 0;}",
        "1 1 0\n",
        None,
    );
}

#[test]
fn same_structure_tag_can_differ_in_target_qualification() {
    assert_program(
        "#include <stdio.h>\nstruct Box{int value;};int main(void){struct Box boxes[2]={{3},{8}};struct Box *first=boxes;const struct Box *last=boxes+1;printf(\"%d %d %d\\n\",first<last,last-first,first==last);return 0;}",
        "1 1 0\n",
        None,
    );
}

#[test]
fn conditional_join_still_allows_read_and_refuses_const_write() {
    assert_program(
        "#include <stdio.h>\nint main(void){int value=4;int *w=&value;const int *r=&value;const int *p=1?w:r;printf(\"%d\\n\",*p);return 0;}",
        "4\n",
        None,
    );
    assert_program(
        "int main(void){int value=4;int *w=&value;const int *r=&value;*(0?w:r)=9;return 0;}",
        "",
        Some("E_CONST_WRITE"),
    );
}

#[test]
fn scalar_and_structure_members_remain_read_only_through_const() {
    for source in [
        "int main(void){int value=4;const int *p=&value;*p=9;return 0;}",
        "struct Box{int value;};int main(void){struct Box box={4};const struct Box *p=&box;p->value=9;return 0;}",
        "struct Label{char text[8];};int main(void){struct Label item={\"elm\"};const struct Label *p=&item;p->text[0]='X';return 0;}",
    ] {
        assert_program(source, "", Some("E_CONST_WRITE"));
    }
}

#[test]
fn assignment_and_parameter_const_discard_are_not_comparisons() {
    for source in [
        "int main(void){int value=4;const int *r=&value;int *w=r;return 0;}",
        "void write(int *p);int main(void){int value=4;const int *r=&value;write(r);return 0;}void write(int *p){*p=9;}",
    ] {
        assert_program(source, "", Some("E_TYPE_INVALID"));
    }
}

#[test]
fn different_numeric_targets_and_structure_tags_remain_incompatible() {
    for expression in ["a==b", "a!=b", "a<b", "a<=b", "a>b", "a>=b", "a-b"] {
        let source = format!(
            "int main(void){{int left=4;unsigned int right=4u;int *a=&left;const unsigned int *b=&right;int result={expression};return 0;}}"
        );
        assert_program(&source, "", Some("E_TYPE_INVALID"));
    }
    assert_program(
        "struct A{int x;};struct B{int x;};int main(void){struct A a={4};struct B b={4};struct A *p=&a;const struct B *q=&b;int result=p==q;return 0;}",
        "",
        Some("E_TYPE_INVALID"),
    );
}

#[test]
fn mixed_qualification_does_not_legalize_cross_object_order_or_difference() {
    for expression in ["a<b", "a-b"] {
        let source = format!(
            "int main(void){{int left=4,right=5;int *a=&left;const int *b=&right;int result={expression};return 0;}}"
        );
        assert_program(&source, "", Some("E_POINTER_BOUNDS"));
    }
}
