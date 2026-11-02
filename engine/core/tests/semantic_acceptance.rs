//! Real static P0-C checks. No source in this suite is executed as a C program.

use std::collections::BTreeSet;

use c_viz_core::ast::{Expression, NodeData, NodeId};
use c_viz_core::format::FormatPart;
use c_viz_core::parser::{parse, parse_bytes};
use c_viz_core::semantic::{CheckedProgram, ObjectType, analyze, analyze_bytes};
use c_viz_core::source::{ByteRange, SourceMap};
use serde_json::{Value, json};

fn checked(source: &str) -> CheckedProgram {
    let checked = analyze(source)
        .unwrap_or_else(|error| panic!("static acceptance failed: {source:?}: {error:?}"));
    let program = &checked.parsed.program;
    let mut declaration_nodes = BTreeSet::new();
    for declaration in &checked.declarations {
        assert!(declaration_nodes.insert(declaration.node_id));
        let NodeData::Declaration {
            name, array_length, ..
        } = &program.nodes[declaration.node_id].data
        else {
            panic!("declaration metadata must point to a real declaration");
        };
        assert_eq!(name, &declaration.name);
        assert_eq!(
            declaration.object_type,
            array_length.map_or(ObjectType::Int, |length| ObjectType::IntArray { length })
        );
        assert!(matches!(
            program.nodes[declaration.scope_node].data,
            NodeData::Block { .. } | NodeData::For { .. }
        ));
    }
    let expected_declarations = program
        .nodes
        .iter()
        .filter(|node| matches!(node.data, NodeData::Declaration { .. }))
        .count();
    assert_eq!(checked.declarations.len(), expected_declarations);
    let mut reference_nodes = BTreeSet::new();
    for reference in &checked.references {
        assert!(reference_nodes.insert(reference.expression_node));
        let NodeData::Expr(Expression::Name(name)) = &program.nodes[reference.expression_node].data
        else {
            panic!("reference must point to a real name expression");
        };
        let declaration = checked
            .declarations
            .iter()
            .find(|declaration| declaration.node_id == reference.declaration_node)
            .expect("reference must resolve to a concrete declaration identity");
        assert_eq!(name, &declaration.name);
    }
    let expected_references = program
        .nodes
        .iter()
        .filter(|node| matches!(node.data, NodeData::Expr(Expression::Name(_))))
        .count();
    assert_eq!(checked.references.len(), expected_references);
    let mut output_nodes = BTreeSet::new();
    for output in &checked.outputs {
        assert!(output_nodes.insert(output.output_node));
        let NodeData::Output { arguments, .. } = &program.nodes[output.output_node].data else {
            panic!("compiled output must refer to its real output statement");
        };
        assert_eq!(output.format.argument_count, arguments.len());
    }
    assert_eq!(
        checked.outputs.len(),
        program
            .nodes
            .iter()
            .filter(|node| matches!(node.data, NodeData::Output { .. }))
            .count()
    );
    assert_eq!(
        program.node_map(),
        parse(source).unwrap().program.node_map()
    );
    assert!(checked.fuel_used >= checked.parsed.fuel_used);
    assert!(checked.fuel_used <= 1_000_000);
    checked
}

fn fragment(source: &str) -> CheckedProgram {
    checked(&format!("int main(void){{{source}}}"))
}

fn semantic_error(source: &str, code: &str) -> Value {
    let value = serde_json::to_value(
        analyze(source).expect_err("static error must reject the whole program"),
    )
    .unwrap();
    assert_eq!(value["code"], code, "source: {source:?}");
    assert_eq!(value["stage"], "semantic");
    assert_eq!(value["origin"], "rust");
    assert_eq!(value["severity"], "error");
    assert_eq!(value["location"]["kind"], "source");
    let range = ByteRange {
        start: value["location"]["byteRange"]["start"].as_u64().unwrap() as usize,
        end: value["location"]["byteRange"]["end"].as_u64().unwrap() as usize,
    };
    assert!(SourceMap::new(source).is_valid_range(range));
    assert!(range.start < range.end);
    value
}

fn fragment_error(fragment: &str, code: &str) -> Value {
    semantic_error(&format!("int main(void){{{fragment}}}"), code)
}

fn reference_bindings(checked: &CheckedProgram) -> Vec<(String, NodeId)> {
    checked
        .references
        .iter()
        .map(|reference| {
            let NodeData::Expr(Expression::Name(name)) =
                &checked.parsed.program.nodes[reference.expression_node].data
            else {
                panic!("name required");
            };
            (name.clone(), reference.declaration_node)
        })
        .collect()
}

#[test]
fn duplicate_names_in_one_scope_are_rejected_for_scalars_and_arrays() {
    for source in [
        "int x;int x;",
        "int x=1;int x=x;",
        "int a[1];int a[2];",
        "int x;int x[1];",
        "{int y;int y;}",
        "for(int i=0;i<1;i=i+1){int j;int j;}",
    ] {
        fragment_error(source, "E_NAME_INVALID");
    }
}

#[test]
fn use_before_declaration_and_missing_names_are_rejected_in_every_position() {
    for source in [
        "x=1;int x;",
        "int y=x;int x=1;",
        "return missing;",
        "if(missing){}",
        "while(missing){}",
        "for(;missing;){}",
        "for(;;missing=1){}",
        "int a[1];return a[missing];",
        "missing[0]=1;",
        "printf(\"%d\",missing);",
    ] {
        fragment_error(source, "E_NAME_INVALID");
    }
}

#[test]
fn declaration_self_initialization_resolves_to_the_new_shadowing_object() {
    let checked = fragment("int x=5;{int x=x;printf(\"%d\",x);}return x;");
    assert_eq!(checked.declarations.len(), 2);
    let outer = checked.declarations[0].node_id;
    let inner = checked.declarations[1].node_id;
    assert_ne!(outer, inner);
    assert_eq!(
        reference_bindings(&checked),
        vec![
            ("x".into(), inner),
            ("x".into(), inner),
            ("x".into(), outer)
        ]
    );
    // Reading this new, uninitialized inner object is a runtime error in 06.
    assert_ne!(
        checked.declarations[0].scope_node,
        checked.declarations[1].scope_node
    );
}

#[test]
fn leaving_a_block_restores_outer_binding_and_siblings_have_independent_scopes() {
    let checked = fragment("int x=1;{int x=2;x=x+1;}{int x=3;printf(\"%d\",x);}return x;");
    let declarations = &checked.declarations;
    assert_eq!(declarations.len(), 3);
    assert_eq!(
        reference_bindings(&checked),
        vec![
            ("x".into(), declarations[1].node_id),
            ("x".into(), declarations[1].node_id),
            ("x".into(), declarations[2].node_id),
            ("x".into(), declarations[0].node_id),
        ]
    );
    fragment_error("{int hidden=1;}return hidden;", "E_NAME_INVALID");
    fragment_error("if(1){int hidden=1;}else{return hidden;}", "E_NAME_INVALID");
}

#[test]
fn lexical_shadowing_also_selects_the_actual_object_type() {
    fragment("int x[1]={1};{int x=2;x=x+1;}return x[0];");
    fragment("int x=1;{int x[1]={2};x[0]=3;}return x;");
    fragment_error("int x[1];{int x=2;return x[0];}", "E_TYPE_INVALID");
    fragment_error("int x=1;{int x[1];return x;}", "E_TYPE_INVALID");
}

#[test]
fn for_initializer_binding_lives_through_the_header_and_body_only() {
    let checked = fragment("int i=7;for(int i=i;i<2;i=i+1){int local=i;}return i;");
    let outer = checked
        .declarations
        .iter()
        .find(|declaration| declaration.name == "i")
        .unwrap();
    let loop_variable = checked
        .declarations
        .iter()
        .filter(|declaration| declaration.name == "i")
        .nth(1)
        .unwrap();
    assert!(matches!(
        checked.parsed.program.nodes[loop_variable.scope_node].data,
        NodeData::For { .. }
    ));
    let bindings = reference_bindings(&checked);
    assert_eq!(
        bindings,
        vec![
            ("i".into(), loop_variable.node_id),
            ("i".into(), loop_variable.node_id),
            ("i".into(), loop_variable.node_id),
            ("i".into(), loop_variable.node_id),
            ("i".into(), loop_variable.node_id),
            ("i".into(), outer.node_id),
        ]
    );
    fragment_error("for(int i=0;i<1;i=i+1){}return i;", "E_NAME_INVALID");
    fragment_error("for(;;bodyLocal=1){int bodyLocal;}", "E_NAME_INVALID");
    fragment_error("for(;;){int bodyLocal;}return bodyLocal;", "E_NAME_INVALID");
}

#[test]
fn for_update_resolves_outer_names_before_the_separate_body_scope() {
    let checked = fragment("int x=0;for(int i=0;i<2;x=x+1){int x=2;printf(\"%d\",x);}return x;");
    let outer = checked.declarations[0].node_id;
    let i = checked.declarations[1].node_id;
    let inner = checked.declarations[2].node_id;
    assert_eq!(
        reference_bindings(&checked),
        vec![
            ("i".into(), i),
            ("x".into(), outer),
            ("x".into(), outer),
            ("x".into(), inner),
            ("x".into(), outer)
        ]
    );
    fragment("for(int i=0;i<1;i=i+1){}for(int i=0;i<1;i=i+1){}");
}

#[test]
fn reserved_names_are_rejected_without_rejecting_all_underscore_identifiers() {
    for name in ["__", "__x", "_A", "_Z99", "main", "printf"] {
        fragment_error(&format!("int {name};"), "E_NAME_INVALID");
        fragment_error(&format!("int {name}[1];"), "E_NAME_INVALID");
        fragment_error(&format!("for(int {name}=0;;){{}}"), "E_NAME_INVALID");
    }
    fragment("int _;int _lower=1;int _9=2;int MAIN=3;int printf1=4;return _lower+_9+MAIN+printf1;");
}

#[test]
fn arrays_require_positive_capacity_and_no_more_initializers_than_capacity() {
    for source in [
        "int a[0];",
        "int a[0]={1};",
        "int a[1]={1,2};",
        "int a[2]={1,2,3};",
    ] {
        fragment_error(source, "E_TYPE_INVALID");
    }
    let checked = fragment("int a[31];int b[3]={+1,-2};int huge[2147483647]={1};");
    assert_eq!(
        checked
            .declarations
            .iter()
            .map(|declaration| declaration.object_type)
            .collect::<Vec<_>>(),
        vec![
            ObjectType::IntArray { length: 31 },
            ObjectType::IntArray { length: 3 },
            ObjectType::IntArray { length: i32::MAX },
        ]
    );
    // This allocates syntax metadata only, never i32::MAX virtual object slots.
}

#[test]
fn arrays_cannot_decay_to_integer_values_or_be_assigned_as_whole_objects() {
    for source in [
        "int a[1];int x=a;",
        "int a[1];int b[1];a=b;",
        "int a[1];a=1;",
        "int a[1];return a;",
        "int a[1];return a+1;",
        "int a[1];return !a;",
        "int a[1];if(a){}",
        "int a[1];while(a){}",
        "int a[1];for(;a;){}",
        "int a[1];printf(\"%d\",a);",
        "int a[1];int x; x=a;",
    ] {
        fragment_error(source, "E_TYPE_INVALID");
    }
}

#[test]
fn indexing_requires_a_real_array_and_an_integer_index() {
    for source in [
        "int x;return x[0];",
        "int x;x[0]=1;",
        "int a[1];int b[1];return a[b];",
        "int a[1];int b[1];a[b]=1;",
    ] {
        fragment_error(source, "E_TYPE_INVALID");
    }
    let checked = fragment("int a[1];int i=0;a[i]=a[i]+1;return a[i];");
    let a = checked.declarations[0].node_id;
    let i = checked.declarations[1].node_id;
    assert_eq!(
        reference_bindings(&checked),
        vec![
            ("a".into(), a),
            ("i".into(), i),
            ("a".into(), a),
            ("i".into(), i),
            ("a".into(), a),
            ("i".into(), i)
        ]
    );
}

#[test]
fn loop_jumps_require_a_lexically_enclosing_loop() {
    for jump in ["break;", "continue;"] {
        let source = format!("int main(){{{jump}}}");
        let value = serde_json::to_value(analyze(&source).unwrap_err()).unwrap();
        assert_eq!(value["stage"], "semantic");
        assert!(matches!(
            value["code"].as_str(),
            Some("E_TYPE_INVALID" | "E_UNSUPPORTED_SYNTAX")
        ));
        for fragment in [
            format!("if(0){{{jump}}}"),
            format!("while(0){{}}{jump}"),
            format!("return 0;{jump}"),
        ] {
            assert!(analyze(&format!("int main(){{{fragment}}}")).is_err());
        }
        fragment(&format!("while(0){{if(1){{{jump}}}}}"));
        fragment(&format!("for(;;){{{{{jump}}}}}"));
    }
    fragment("while(1){for(;;){break;}continue;}");
}

#[test]
fn every_branch_short_circuit_operand_and_post_return_statement_is_checked() {
    for source in [
        "if(0){missing=1;}",
        "if(1){}else{missing=1;}",
        "while(0){missing=1;}",
        "for(;0;){missing=1;}",
        "return 1||missing;",
        "return 0&&missing;",
        "return 0;missing=1;",
        "return 0;int x=1;int x=2;",
    ] {
        fragment_error(source, "E_NAME_INVALID");
    }
    fragment_error("if(0){int a[0];}", "E_TYPE_INVALID");
    fragment_error("return 0;printf(\"%f\",1);", "E_FORMAT_INVALID");
    fragment_error("int a[1];return 1||a;", "E_TYPE_INVALID");
}

#[test]
fn finite_printf_formats_are_compiled_from_the_parser_decoded_literal() {
    let checked =
        fragment(r#"printf("中文😀 %d%%\n\\\"",7);printf("%%");printf("");printf("%d%d",1,2);"#);
    assert_eq!(checked.outputs.len(), 4);
    assert_eq!(checked.outputs[0].format.argument_count, 1);
    assert_eq!(
        checked.outputs[0].format.parts,
        vec![
            FormatPart::Text("中文😀 ".into()),
            FormatPart::Decimal,
            FormatPart::Text("%\n\\\"".into())
        ]
    );
    assert_eq!(checked.outputs[1].format.argument_count, 0);
    assert_eq!(
        checked.outputs[1].format.parts,
        vec![FormatPart::Text("%".into())]
    );
    assert!(checked.outputs[2].format.parts.is_empty());
    assert_eq!(
        checked.outputs[3].format.parts,
        vec![FormatPart::Decimal, FormatPart::Decimal]
    );
}

#[test]
fn unsupported_specifiers_width_precision_modifiers_and_isolated_percent_are_rejected() {
    for format in [
        "%f",
        "%s",
        "%c",
        "%u",
        "%x",
        "%p",
        "%n",
        "%D",
        "%02d",
        "%-d",
        "%+d",
        "% d",
        "%.2d",
        "%ld",
        "%lld",
        "%zu",
        "%",
        "trailing %",
        "%中",
        "%😀",
    ] {
        fragment_error(&format!("printf(\"{format}\",1);"), "E_FORMAT_INVALID");
    }
}

#[test]
fn printf_argument_count_is_exact_and_literal_percent_consumes_no_argument() {
    for source in [
        "printf(\"%d\");",
        "printf(\"%d%d\",1);",
        "printf(\"%d\",1,2);",
        "printf(\"text\",1);",
        "printf(\"%%\",1);",
        "printf(\"%%%d\");",
    ] {
        fragment_error(source, "E_FORMAT_INVALID");
    }
    fragment("printf(\"%d%% %d\",1,2);");
    fragment("printf(\"%%%%\");");
}

#[test]
fn runtime_errors_are_not_evaluated_or_reclassified_as_static_failures() {
    for source in [
        "int x;return x;",
        "int x=x;",
        "int a[2];return a[0];",
        "int a[1]={0};return a[-1];",
        "int a[1]={0};a[1]=1;",
        "return 1/0;",
        "return 1%0;",
        "int x=2147483647+1;",
        "int x=50000*50000;",
        "int x=(-2147483647-1);return -x;",
        "int x=(-2147483647-1);return x/-1;",
        "int x=(-2147483647-1);return x%-1;",
        "printf(\"%d\",1/0);",
        "if(0){int huge[2147483647];}",
    ] {
        fragment(source);
    }
}

#[test]
fn names_in_diagnostics_keep_exact_original_unicode_and_crlf_coordinates() {
    for newline in ["\n", "\r\n", "\r"] {
        let source = format!("// 中😀{newline}int main(){{{newline}\treturn missing;{newline}}}");
        let value = semantic_error(&source, "E_NAME_INVALID");
        let start = source.find("missing").unwrap();
        assert_eq!(
            value["location"]["byteRange"],
            json!({"start":start,"end":start+7})
        );
        let position = SourceMap::new(&source).position(start).unwrap();
        assert_eq!((position.line, position.column), (3, 9));
        assert!(
            !serde_json::to_string(&value["details"])
                .unwrap()
                .contains("missing")
        );
    }
}

#[test]
fn preceding_lex_parse_encoding_size_and_depth_errors_keep_their_identity() {
    let mut sources = vec![
        "int main(){x++;}".to_owned(),
        "int main(){return 0".to_owned(),
        "int main(){int *p;}".to_owned(),
        "int main(){int x=sizeof(int);}".to_owned(),
        " ".repeat(32_769),
    ];
    sources.push(format!("int main(){{return {}1;}}", "1+".repeat(64)));
    for source in sources {
        assert_eq!(
            serde_json::to_value(analyze(&source).unwrap_err()).unwrap(),
            serde_json::to_value(parse(&source).unwrap_err()).unwrap()
        );
    }
    for bytes in [
        &[0xff][..],
        &[0xed, 0xa0, 0x80][..],
        &[0xf4, 0x90, 0x80, 0x80][..],
    ] {
        assert_eq!(
            serde_json::to_value(analyze_bytes(bytes).unwrap_err()).unwrap(),
            serde_json::to_value(parse_bytes(bytes).unwrap_err()).unwrap()
        );
    }
    let source = "int main(){int x=1;return x;}";
    let string_result = checked(source);
    let bytes_result = analyze_bytes(source.as_bytes()).unwrap();
    assert_eq!(
        reference_bindings(&string_result),
        reference_bindings(&bytes_result)
    );
    assert_eq!(string_result.fuel_used, bytes_result.fuel_used);
}

#[test]
fn all_112_public_machine_sources_are_checked_with_their_original_allowed_diagnostics() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../shared/contracts/02.4-语义与输入样例.json"
    ))
    .unwrap();
    assert_eq!(fixture["purpose"], "contract-fixture");
    let mut accepted = 0;
    let mut rejected = 0;
    let mut without_source = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let Some(source) = case["source"].as_str() else {
            assert!(case["source"].is_null());
            without_source += 1;
            continue;
        };
        let runtime_negative = matches!(
            case["origin"].as_str(),
            Some(
                "NEG-27"
                    | "NEG-28"
                    | "NEG-29"
                    | "NEG-30"
                    | "NEG-31"
                    | "NEG-32"
                    | "NEG-33"
                    | "NEG-34"
                    | "NEG-35"
                    | "NEG-36"
                    | "NEG-37"
                    | "NEG-38"
            )
        );
        if case["category"] != "negative" || runtime_negative {
            checked(source);
            accepted += 1;
        } else {
            let diagnostic = serde_json::to_value(analyze(source).expect_err(id)).unwrap();
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
            rejected += 1;
        }
    }
    assert_eq!((accepted, rejected, without_source), (78, 34, 10));
    // Source setup/input mappings, stdout, judging and runtime outcomes are not
    // checked here. A wrong answer or invalid input may still have valid C.
}

fn instantiate_public_inputs(program: &Value, input: &Value) -> String {
    let source = program["sourceExample"].as_str().unwrap();
    let parsed = parse(source).unwrap();
    let mut replacements = Vec::new();
    for binding in program["bindings"].as_array().unwrap() {
        let target = binding["targetName"].as_str().unwrap();
        let input_value = &input[binding["inputKey"].as_str().unwrap()];
        let declarations = parsed
            .program
            .nodes
            .iter()
            .filter(|node| matches!(&node.data,NodeData::Declaration{name,..} if name == target))
            .collect::<Vec<_>>();
        assert_eq!(declarations.len(), 1, "public input target must be unique");
        let declaration = declarations[0];
        let replacement = match binding["targetKind"].as_str().unwrap() {
            "logical-length" => {
                format!("int {target} = {};", input_value.as_array().unwrap().len())
            }
            "scalar" => format!("int {target} = {};", input_value.as_i64().unwrap()),
            "array" => {
                let values = input_value.as_array().unwrap();
                let mut literals = values
                    .iter()
                    .map(|value| value.as_i64().unwrap().to_string())
                    .collect::<Vec<_>>();
                if literals.is_empty() {
                    literals.push("0".into());
                }
                format!(
                    "int {target}[{}] = {{{}}};",
                    literals.len(),
                    literals.join(", ")
                )
            }
            other => panic!("unsupported public binding kind: {other}"),
        };
        replacements.push((declaration.byte_range, replacement));
    }
    replacements.sort_by_key(|(range, _)| range.start);
    for pair in replacements.windows(2) {
        assert!(pair[0].0.end <= pair[1].0.start);
    }
    let mut instantiated = source.to_owned();
    for (range, replacement) in replacements.into_iter().rev() {
        instantiated.replace_range(range.start..range.end, &replacement);
    }
    instantiated
}

#[test]
fn all_24_frozen_exercise_inputs_are_visible_static_program_instances() {
    let content: Value =
        serde_json::from_str(include_str!("../../../shared/contracts/02.1-内容样例.json")).unwrap();
    assert_eq!(content["purpose"], "contract-fixture");
    let mut count = 0;
    let mut empty_arrays = 0;
    for exercise in content["exercises"].as_array().unwrap() {
        let program = content["programs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|program| {
                program["id"] == exercise["programRef"]["id"]
                    && program["version"] == exercise["programRef"]["version"]
            })
            .unwrap();
        for case in exercise["tests"].as_array().unwrap() {
            let source = instantiate_public_inputs(program, &case["input"]);
            let checked = checked(&source);
            for binding in program["bindings"].as_array().unwrap() {
                let target = binding["targetName"].as_str().unwrap();
                let declaration = checked
                    .declarations
                    .iter()
                    .find(|declaration| declaration.name == target)
                    .unwrap();
                if binding["targetKind"] == "array" {
                    let logical_length = case["input"][binding["inputKey"].as_str().unwrap()]
                        .as_array()
                        .unwrap()
                        .len();
                    assert_eq!(
                        declaration.object_type,
                        ObjectType::IntArray {
                            length: logical_length.max(1) as i32
                        }
                    );
                    if logical_length == 0 {
                        empty_arrays += 1;
                        assert!(source.contains("int values[1] = {0};"));
                        assert!(source.contains("int n = 0;"));
                    }
                } else {
                    assert_eq!(declaration.object_type, ObjectType::Int);
                }
            }
            count += 1;
        }
    }
    assert_eq!((count, empty_arrays), (24, 1));
    // Public initialization substitution is only a test helper, not a shipped
    // Blockly generator, input adapter or exercise grader.
}

#[test]
fn the_20_declared_block_kinds_and_their_operators_have_supported_static_examples() {
    let content: Value =
        serde_json::from_str(include_str!("../../../shared/contracts/02.1-内容样例.json")).unwrap();
    let mut blocks = 0;
    let mut probes = 0;
    for block in content["blocks"].as_array().unwrap() {
        let id = block["id"].as_str().unwrap();
        let examples: Vec<String> = match id {
            "block.c.main" => vec![String::new()],
            "block.c.integer" => vec!["return 2147483647;".into()],
            "block.c.declare-int" => vec!["int x=1;".into()],
            "block.c.read-variable" => vec!["int x;return x;".into()],
            "block.c.assign-variable" => vec!["int x;x=2;".into()],
            "block.c.unary" => block["operators"]
                .as_array()
                .unwrap()
                .iter()
                .map(|operator| format!("return {}1;", operator.as_str().unwrap()))
                .collect(),
            "block.c.arithmetic" | "block.c.comparison" | "block.c.logical" => block["operators"]
                .as_array()
                .unwrap()
                .iter()
                .map(|operator| format!("return 2 {} 1;", operator.as_str().unwrap()))
                .collect(),
            "block.c.if" => vec!["if(1){}else{}".into()],
            "block.c.while" => vec!["while(0){}".into()],
            "block.c.for" => vec!["for(int i=0;i<1;i=i+1){}".into()],
            "block.c.break" => vec!["while(1){break;}".into()],
            "block.c.continue" => vec!["for(;;){continue;}".into()],
            "block.c.declare-array" => vec!["int a[1]={0};".into()],
            "block.c.read-array" => vec!["int a[1]={0};return a[0];".into()],
            "block.c.write-array" => vec!["int a[1];a[0]=1;".into()],
            "block.c.printf" => vec!["printf(\"%d %%\\n\",1);".into()],
            "block.c.return" => vec!["return 0;".into()],
            "block.c.scope" => vec!["int x=1;{int x=2;}return x;".into()],
            _ => panic!("new block requires a static support example: {id}"),
        };
        assert!(!examples.is_empty());
        for example in examples {
            fragment(&example);
            probes += 1;
        }
        blocks += 1;
    }
    assert_eq!((blocks, probes), (20, 32));
}

#[test]
fn shared_source_with_authored_block_ranges_is_checked_without_using_fixture_execution() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../shared/contracts/02.2-正常轨迹样例.json"
    ))
    .unwrap();
    let mut programs = 0;
    let mut blocks = 0;
    for case in fixture["fixtures"].as_array().unwrap() {
        let source = &case["request"]["source"];
        let mappings = source["blockMap"].as_array().unwrap();
        if mappings.is_empty() {
            continue;
        }
        let text = source["text"].as_str().unwrap();
        checked(text);
        let source_map = SourceMap::new(text);
        for mapping in mappings {
            let range = ByteRange {
                start: mapping["byteRange"]["start"].as_u64().unwrap() as usize,
                end: mapping["byteRange"]["end"].as_u64().unwrap() as usize,
            };
            assert!(source_map.is_valid_range(range));
            blocks += 1;
        }
        programs += 1;
    }
    assert_eq!((programs, blocks), (1, 7));
    // This does not validate request bindingMap, emit real steps, consume the
    // authored result or claim that Blockly has generated these mappings.
}
