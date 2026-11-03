use c_viz_c6::{
    budget::Meter,
    check,
    runtime::Runtime,
    state::{self, Totals},
    syntax,
    types::Val,
};
use std::collections::BTreeSet;
fn run(source: &str, input: &str, expected: Option<&str>, code: Option<&str>) {
    let mut meter = Meter::new();
    let program = syntax::parse(source, &mut meter).expect("parse");
    let checked = check::check(program, &mut meter).expect("check");
    let mut totals = Totals::default();
    let mut runtime = Runtime::new(
        &checked,
        input.as_bytes(),
        BTreeSet::new(),
        0,
        &mut totals,
        &mut meter,
    )
    .unwrap();
    let result = runtime.run();
    if let Some(code) = code {
        assert_eq!(result.unwrap_err().code, code);
    } else {
        assert_eq!(result.unwrap().value, Val::I(0));
    }
    if let Some(expected) = expected {
        assert_eq!(runtime.journal.state["output"], expected);
    }
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
    assert_eq!(state, runtime.journal.state);
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
    assert_eq!(
        state, initial,
        "complete reverse includes stdin cursor/objects/output and error prefix"
    );
}
#[test]
fn scanf_integer_success_matching_failure_and_eof() {
    let s = "#include <stdio.h>\nint main(){int x=9;int n=scanf(\"%d\",&x);printf(\"%d %d\\n\",n,x);return 0;}";
    for (i, o) in [
        ("7", "1 7\n"),
        ("-9", "1 -9\n"),
        ("x", "0 9\n"),
        ("", "-1 9\n"),
        ("   ", "-1 9\n"),
    ] {
        run(s, i, Some(o), None)
    }
}
#[test]
fn scanf_unsigned_negative_and_maximum() {
    let s = "#include <stdio.h>\nint main(){unsigned n=0;int r=scanf(\"%u\",&n);printf(\"%d %u\\n\",r,n);return 0;}";
    run(s, "-1", Some("1 4294967295\n"), None);
    run(s, "4294967295", Some("1 4294967295\n"), None);
}
#[test]
fn scanf_float_incomplete_exponent_consumes_prefix() {
    run(
        "#include <stdio.h>\nint main(){double x=9.0;int r=scanf(\"%lf\",&x);int c=getchar();printf(\"%d %d %.1f\\n\",r,c,x);return 0;}",
        "100er",
        Some("0 114 9.0\n"),
        None,
    );
}
#[test]
fn scanf_typed_float_and_negative_zero() {
    run(
        "#include <stdio.h>\nint main(){float x;double y;scanf(\"%f\",&x);scanf(\"%lf\",&y);printf(\"%.3f %.1f\\n\",x,y);return 0;}",
        ".125 -0",
        Some("0.125 -0.0\n"),
        None,
    );
}
#[test]
fn getchar_and_scanf_character_whitespace() {
    run(
        "#include <stdio.h>\nint main(){char a,b;scanf(\"%c\",&a);scanf(\" %c\",&b);printf(\"%d %d\\n\",a,b);return 0;}",
        " \nA",
        Some("32 65\n"),
        None,
    );
    run(
        "#include <stdio.h>\nint main(){printf(\"%d\\n\",getchar());return 0;}",
        "",
        Some("-1\n"),
        None,
    );
}
#[test]
fn bounded_scanf_string_leaves_excess_input() {
    run(
        "#include <stdio.h>\nint main(){char a[3];scanf(\"%2s\",a);printf(\"%s %d\\n\",a,getchar());return 0;}",
        "abc",
        Some("ab 99\n"),
        None,
    );
}
#[test]
fn scanf_failure_is_atomic_before_destination_or_cursor_changes() {
    run(
        "#include <stdio.h>\nint main(){int x=9;printf(\"ok\");scanf(\"%d\",&x);return 0;}",
        "2147483648",
        Some("ok"),
        Some("E_OVERFLOW"),
    );
    run(
        "#include <stdio.h>\nint main(){char a[2]=\"x\";scanf(\"%2s\",a);return 0;}",
        "a",
        Some(""),
        Some("E_STRING_BOUNDS"),
    );
}
#[test]
fn fgets_preserves_newline_and_cursor() {
    run(
        "#include <stdio.h>\nint main(){char a[4];fgets(a,4,stdin);printf(\"%s%d\\n\",a,getchar());return 0;}",
        "ab\nrest",
        Some("ab\n114\n"),
        None,
    );
}
#[test]
fn fgets_immediate_eof_preserves_target() {
    run(
        "#include <stdio.h>\nint main(){char a[4]=\"old\";char *p=fgets(a,4,stdin);printf(\"%d %s\\n\",p==0,a);return 0;}",
        "",
        Some("1 old\n"),
        None,
    );
}
#[test]
fn fgets_maximum_capacity() {
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char a[64];fgets(a,64,stdin);printf(\"%u\\n\",strlen(a));return 0;}",
        &"x".repeat(63),
        Some("63\n"),
        None,
    );
}
#[test]
fn strlen_strcmp_and_strncmp() {
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){int a=strcmp(\"a\",\"b\");int b=strncmp(\"abcd\",\"abce\",3);printf(\"%u %d %d\\n\",strlen(\"abc\"),a<0,b);return 0;}",
        "",
        Some("3 1 0\n"),
        None,
    );
}
#[test]
fn strcpy_preserves_independent_source_object() {
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char a[4]=\"abc\";char b[4];strcpy(b,a);b[0]='x';printf(\"%s %s\\n\",a,b);return 0;}",
        "",
        Some("abc xbc\n"),
        None,
    );
}
#[test]
fn strncpy_fills_nuls_and_can_leave_unterminated() {
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char a[5];strncpy(a,\"x\",5);printf(\"%u\\n\",strlen(a));return 0;}",
        "",
        Some("1\n"),
        None,
    );
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char a[3];strncpy(a,\"abcd\",3);printf(\"%u\\n\",strlen(a));return 0;}",
        "",
        Some(""),
        Some("E_STRING_UNTERMINATED"),
    );
}
#[test]
fn strcat_and_strncat_exact_capacity() {
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char a[6]=\"ab\";strcat(a,\"c\");strncat(a,\"def\",2);printf(\"%s\\n\",a);return 0;}",
        "",
        Some("abcde\n"),
        None,
    );
}
#[test]
fn string_copy_overlap_and_capacity_rejected() {
    run(
        "#include <string.h>\nint main(){char a[4]=\"abc\";strcpy(a,a);return 0;}",
        "",
        Some(""),
        Some("E_STRING_BOUNDS"),
    );
    run(
        "#include <string.h>\nint main(){char a[4]=\"abc\";strcat(a,\"d\");return 0;}",
        "",
        Some(""),
        Some("E_STRING_BOUNDS"),
    );
}
#[test]
fn string_literal_readonly_write_rejected() {
    run(
        "int main(){char *p=\"abc\";p[0]='x';return 0;}",
        "",
        Some(""),
        Some("E_READONLY"),
    );
}
#[test]
fn struct_char_array_cannot_read_into_adjacent_field() {
    run(
        "#include <stdio.h>\nstruct S{char a[3];int n;};int main(){struct S s={\"abc\",0};printf(\"%s\",s.a);return 0;}",
        "",
        Some(""),
        Some("E_STRING_UNTERMINATED"),
    );
}
#[test]
fn strchr_returns_real_subobject_pointer_and_null() {
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char a[4]=\"abc\";char *p=strchr(a,'b');printf(\"%d %d\\n\",*p,strchr(a,'x')==0);return 0;}",
        "",
        Some("98 1\n"),
        None,
    );
}
#[test]
fn ascii_ctype_includes_vertical_tab_and_eof() {
    run(
        "#include <stdio.h>\n#include <ctype.h>\nint main(){printf(\"%d %d %d %d %d\\n\",isalpha('A'),isdigit('0'),isspace(11),toupper('z'),tolower(-1));return 0;}",
        "",
        Some("1 1 1 90 -1\n"),
        None,
    );
}
#[test]
fn finite_math_and_float_formats() {
    run(
        "#include <stdio.h>\n#include <math.h>\nint main(){printf(\"%.1f %.1f\\n\",sqrt(9.0),fabs(-2.5));printf(\"%.0f %.0f %.2e %g\\n\",2.5,3.5,12.5,1234000.0);return 0;}",
        "",
        Some("3.0 2.5\n2 4 1.25e+01 1.234e+06\n"),
        None,
    );
}
#[test]
fn float_general_format_small_values_and_negative_zero() {
    run(
        "#include <stdio.h>\nint main(){printf(\"%g %g %g\\n\",0.000001234,0.0,-0.0);return 0;}",
        "",
        Some("1.234e-06 0 -0\n"),
        None,
    );
}
#[test]
fn printf_width_precision_radices_and_virtual_null() {
    run(
        "#include <stdio.h>\nint main(){int *p=0;printf(\"%4d %.2s %o %x %X %p %%\\n\",3,\"abcd\",15u,31u,31u,p);return 0;}",
        "",
        Some("   3 ab 17 1f 1F vaddr:null %\n"),
        None,
    );
}
#[test]
fn putchar_and_puts_are_actual_output() {
    run(
        "#include <stdio.h>\nint main(){putchar('A');puts(\"bc\");return 0;}",
        "",
        Some("Abc\n"),
        None,
    );
}
#[test]
fn fixed_character_parameters_convert_unsigned_values_before_use() {
    run(
        "#include <stdio.h>\nint main(){unsigned value=13u;for(int bit=7;bit>=0;--bit)putchar('0'+((value>>bit)&1u));putchar(10u);return 0;}",
        "",
        Some("00001101\n"),
        None,
    );
    run(
        "#include <stdio.h>\nint main(){putchar(0u);putchar(127u);return 0;}",
        "",
        Some("\0\u{7f}"),
        None,
    );
    run(
        "#include <stdio.h>\n#include <ctype.h>\nint main(){printf(\"%d %d %d %d %d\\n\",isalpha(65u),isdigit(57u),isspace(10u),toupper(122u),tolower(65u));return 0;}",
        "",
        Some("1 1 1 90 97\n"),
        None,
    );
    run(
        "#include <stdio.h>\n#include <string.h>\nint main(){char text[4]=\"abc\";printf(\"%d %d %d\\n\",strchr(text,98u)==text+1,strchr(text,0u)==text+3,strchr(text,120u)==0);return 0;}",
        "",
        Some("1 1 1\n"),
        None,
    );
}
#[test]
fn fixed_character_parameters_preserve_domain_and_conversion_errors() {
    for name in [
        "putchar", "isalpha", "isdigit", "isspace", "toupper", "tolower", "strchr",
    ] {
        for (argument, code) in [
            ("128u", "E_CHAR_DOMAIN"),
            ("2147483647u", "E_CHAR_DOMAIN"),
            ("2147483648u", "E_OVERFLOW"),
            ("4294967295u", "E_OVERFLOW"),
        ] {
            let arguments = if name == "strchr" {
                format!("\"abc\",{argument}")
            } else {
                argument.to_string()
            };
            let source = format!(
                "#include <stdio.h>\n#include <ctype.h>\n#include <string.h>\nint main(){{puts(\"prefix\");{name}({arguments});return 0;}}"
            );
            run(&source, "", Some("prefix\n"), Some(code));
        }
    }
}
#[test]
fn fixed_parameter_conversion_does_not_widen_static_or_variadic_types() {
    for source in [
        "#include <stdio.h>\nint main(){putchar(65.0);return 0;}",
        "#include <ctype.h>\nint main(){isalpha(65.0);return 0;}",
        "#include <string.h>\nint main(){strchr(\"abc\",98.0);return 0;}",
        "#include <stdio.h>\nint main(){printf(\"%c\",65u);return 0;}",
        "#include <stdio.h>\nint main(){printf(\"%d\",65u);return 0;}",
    ] {
        let mut meter = Meter::new();
        let parsed = syntax::parse(source, &mut meter).unwrap();
        let error = match check::check(parsed, &mut meter) {
            Ok(_) => panic!("unexpectedly accepted {source}"),
            Err(error) => error,
        };
        assert_eq!(error.code, "E_TYPE_INVALID", "{source}");
    }
}
#[test]
fn invalid_math_float_input_and_pointer_fail() {
    run(
        "#include <math.h>\nint main(){sqrt(-1.0);return 0;}",
        "",
        Some(""),
        Some("E_FLOAT_NONFINITE"),
    );
    run(
        "#include <stdio.h>\nint main(){double n;scanf(\"%lf\",&n);return 0;}",
        "INF",
        Some(""),
        Some("E_FLOAT_NONFINITE"),
    );
    run(
        "#include <stdio.h>\nint main(){scanf(\"%d\",(int*)0);return 0;}",
        "7",
        Some(""),
        Some("E_NULL_POINTER"),
    );
}
#[test]
fn static_format_grammar_rejects_unknown_or_dynamic_formats() {
    for format in ["%*d", "%ld", "%n", "%17d", "%.7f", "%+d"] {
        let source = format!("#include <stdio.h>\nint main(){{printf(\"{format}\",1);return 0;}}");
        let mut m = Meter::new();
        assert!(
            syntax::parse(&source, &mut m)
                .and_then(|p| check::check(p, &mut m).map(|_| ()))
                .is_err(),
            "{format}"
        )
    }
}
