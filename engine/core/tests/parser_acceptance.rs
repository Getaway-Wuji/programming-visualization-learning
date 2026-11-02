//! Structural P0-C acceptance. Parsing does not execute or validate bindings.

use c_viz_core::ast::{Expression, Initializer, NodeData, NodeId, Program};
use c_viz_core::lexer::{lex, lex_bytes};
use c_viz_core::parser::{Parsed, parse, parse_bytes};
use c_viz_core::source::{ByteRange, SourceMap};
use serde_json::{Value, json};

fn body(program: &Program) -> &[NodeId] {
    let NodeData::Function { body } = &program.nodes[program.root].data else {
        panic!("root must be the only main function");
    };
    let NodeData::Block { statements } = &program.nodes[*body].data else {
        panic!("main must own a real block");
    };
    statements
}

fn shape(program: &Program, node: NodeId) -> String {
    match &program.nodes[node].data {
        NodeData::Condition { expression } => shape(program, *expression),
        NodeData::Expr(expression) => match expression {
            Expression::Integer(value) => value.to_string(),
            Expression::Name(name) => name.clone(),
            Expression::Index { array, index } => {
                format!(
                    "Index({},{})",
                    shape(program, *array),
                    shape(program, *index)
                )
            }
            Expression::Unary { op, operand } => format!("{op:?}({})", shape(program, *operand)),
            Expression::Binary { op, left, right } => {
                format!(
                    "{op:?}({},{})",
                    shape(program, *left),
                    shape(program, *right)
                )
            }
        },
        other => panic!("expected expression, got {other:?}"),
    }
}

fn return_shape(expression: &str) -> String {
    let source = format!("int main(void) {{ return {expression}; }}");
    let parsed = parse(&source).unwrap_or_else(|error| panic!("{expression}: {error:?}"));
    let NodeData::Return { value } = parsed.program.nodes[body(&parsed.program)[0]].data else {
        panic!("expected explicit return");
    };
    shape(&parsed.program, value)
}

fn error(source: &str, code: &str, stage: &str) -> Value {
    let value =
        serde_json::to_value(parse(source).expect_err("must reject the entire source")).unwrap();
    assert_eq!(value["code"], code, "source: {source:?}");
    assert_eq!(value["stage"], stage, "source: {source:?}");
    assert_eq!(value["origin"], "rust");
    assert_eq!(value["severity"], "error");
    if value["location"]["kind"] == "source" {
        let range = ByteRange {
            start: value["location"]["byteRange"]["start"].as_u64().unwrap() as usize,
            end: value["location"]["byteRange"]["end"].as_u64().unwrap() as usize,
        };
        assert!(SourceMap::new(source).is_valid_range(range));
    }
    value
}

fn rejects_structure(source: &str) -> Value {
    let value =
        serde_json::to_value(parse(source).expect_err("unsupported structure must fail")).unwrap();
    assert_eq!(value["stage"], "parse", "source: {source:?}");
    assert!(
        matches!(
            value["code"].as_str(),
            Some("E_PARSE_INVALID" | "E_UNSUPPORTED_SYNTAX")
        ),
        "source: {source:?}; diagnostic: {value}"
    );
    assert_eq!(value["location"]["kind"], "source");
    let range = ByteRange {
        start: value["location"]["byteRange"]["start"].as_u64().unwrap() as usize,
        end: value["location"]["byteRange"]["end"].as_u64().unwrap() as usize,
    };
    assert!(SourceMap::new(source).is_valid_range(range));
    value
}

fn assert_mapping(source: &str, parsed: &Parsed) {
    let program = &parsed.program;
    let map = program.node_map();
    assert_eq!(map.len(), program.nodes.len());
    assert_eq!(program.root, 0);
    assert_eq!(map[0].node_id, "n1");
    assert!(map[0].parent_id.is_none());
    let source_map = SourceMap::new(source);
    let mut seen = vec![false; program.nodes.len()];
    let mut pending = vec![program.root];
    let mut preorder = Vec::new();
    while let Some(node_id) = pending.pop() {
        assert!(
            !seen[node_id],
            "AST must be a tree without shared or cyclic nodes"
        );
        seen[node_id] = true;
        preorder.push(node_id);
        let children = program.nodes[node_id].data.children();
        for child in &children {
            assert!(*child < program.nodes.len());
            assert_eq!(
                map[*child].parent_id.as_deref(),
                Some(map[node_id].node_id.as_str())
            );
        }
        pending.extend(children.into_iter().rev());
    }
    assert_eq!(preorder, (0..program.nodes.len()).collect::<Vec<_>>());
    assert!(
        seen.into_iter().all(|value| value),
        "no construction leftovers are public"
    );
    for (index, entry) in map.iter().enumerate() {
        assert_eq!(entry.node_id, format!("n{}", index + 1));
        assert_eq!(entry.byte_range, program.nodes[index].byte_range);
        assert!(source_map.is_valid_range(entry.byte_range));
        assert!(entry.byte_range.start < entry.byte_range.end);
        if let Some(parent) = &entry.parent_id {
            let parent_index = parent[1..].parse::<usize>().unwrap() - 1;
            assert!(parent_index < index);
            let parent_range = map[parent_index].byte_range;
            assert!(parent_range.start <= entry.byte_range.start);
            assert!(entry.byte_range.end <= parent_range.end);
        }
    }
    assert!(parsed.fuel_used >= lex(source).unwrap().fuel_used + program.nodes.len());
    assert!(parsed.fuel_used <= 1_000_000);
    assert!(parsed.max_syntax_depth <= 64);
    assert!(parsed.max_ast_depth <= 64);
}

#[test]
fn precedence_is_preserved_as_a_real_expression_tree() {
    assert_eq!(return_shape("2 + 3 * 4"), "Add(2,Multiply(3,4))");
    assert_eq!(
        return_shape("a + b * c < d - e / f == g && h || i"),
        "Or(And(Equal(Less(Add(a,Multiply(b,c)),Subtract(d,Divide(e,f))),g),h),i)"
    );
    assert_eq!(
        return_shape("!a[1 + 2] * -b"),
        "Multiply(Not(Index(a,Add(1,2))),Minus(b))"
    );
    assert_eq!(
        return_shape("a % b * c / d"),
        "Divide(Multiply(Remainder(a,b),c),d)"
    );
    assert_eq!(
        return_shape("a <= b != c >= d"),
        "NotEqual(LessEqual(a,b),GreaterEqual(c,d))"
    );
}

#[test]
fn binary_operators_are_left_associative_and_unary_operators_are_right_associative() {
    for (expression, expected) in [
        ("8 / 4 / 2", "Divide(Divide(8,4),2)"),
        ("8 - 4 - 2", "Subtract(Subtract(8,4),2)"),
        ("3 < 2 < 1", "Less(Less(3,2),1)"),
        ("a == b != c", "NotEqual(Equal(a,b),c)"),
        ("a && b && c", "And(And(a,b),c)"),
        ("a || b || c", "Or(Or(a,b),c)"),
        ("!- +1", "Not(Minus(Plus(1)))"),
    ] {
        assert_eq!(return_shape(expression), expected);
    }
}

#[test]
fn parentheses_override_precedence_without_becoming_a_fake_operation() {
    assert_eq!(return_shape("(2 + 3) * 4"), "Multiply(Add(2,3),4)");
    assert_eq!(return_shape("8 / (4 / 2)"), "Divide(8,Divide(4,2))");
    let source = "int main() { return ((1 + 2)); }";
    let parsed = parse(source).unwrap();
    let NodeData::Return { value } = parsed.program.nodes[body(&parsed.program)[0]].data else {
        panic!("expected return");
    };
    let range = parsed.program.nodes[value].byte_range;
    assert_eq!(&source[range.start..range.end], "((1 + 2))");
    assert_eq!(parsed.max_ast_depth, 2);
    assert_mapping(source, &parsed);
}

#[test]
fn short_circuit_operands_remain_present_without_being_executed() {
    assert_eq!(
        return_shape("0 && (1 / 0) || missing"),
        "Or(And(0,Divide(1,0)),missing)"
    );
    assert_eq!(return_shape("1 || a[-1]"), "Or(1,Index(a,Minus(1)))");
}

#[test]
fn both_main_signatures_have_one_function_and_a_block_without_invented_return() {
    for source in ["int main() {}", "int main(void) {}"] {
        let parsed = parse(source).unwrap();
        assert!(body(&parsed.program).is_empty());
        assert_eq!(parsed.program.nodes.len(), 2);
        assert_eq!(parsed.max_syntax_depth, 1);
        assert!(parsed.program.header_range.is_none());
        assert_mapping(source, &parsed);
        assert_eq!(
            serde_json::to_value(parsed.program.node_map()).unwrap(),
            json!([
                {"nodeId":"n1","kind":"function","parentId":null,"byteRange":{"start":0,"end":source.len()}},
                {"nodeId":"n2","kind":"block","parentId":"n1","byteRange":{"start":source.find('{').unwrap(),"end":source.len()}}
            ])
        );
    }
}

#[test]
fn nested_control_flow_and_for_slots_preserve_source_order() {
    let source = "int main(){for(int i=0;i<3;i=i+1){while(i){if(i==1){continue;}else{break;}}}for(;;){}for(i=0;;i=i+1){};}";
    let parsed = parse(source).unwrap();
    let statements = body(&parsed.program);
    assert_eq!(statements.len(), 4);
    let NodeData::For {
        init,
        condition,
        update,
        body: loop_body,
    } = &parsed.program.nodes[statements[0]].data
    else {
        panic!("expected for");
    };
    assert!(matches!(
        parsed.program.nodes[init.unwrap()].data,
        NodeData::Declaration { .. }
    ));
    assert_eq!(shape(&parsed.program, condition.unwrap()), "Less(i,3)");
    assert!(matches!(
        parsed.program.nodes[update.unwrap()].data,
        NodeData::Assignment { .. }
    ));
    assert!(matches!(
        parsed.program.nodes[*loop_body].data,
        NodeData::Block { .. }
    ));
    let NodeData::For {
        init,
        condition,
        update,
        ..
    } = &parsed.program.nodes[statements[1]].data
    else {
        panic!("expected empty for");
    };
    assert!(init.is_none() && condition.is_none() && update.is_none());
    let NodeData::For {
        init,
        condition,
        update,
        ..
    } = &parsed.program.nodes[statements[2]].data
    else {
        panic!("expected assignment for");
    };
    assert!(matches!(
        parsed.program.nodes[init.unwrap()].data,
        NodeData::Assignment { .. }
    ));
    assert!(condition.is_none() && update.is_some());
    assert!(matches!(
        parsed.program.nodes[statements[3]].data,
        NodeData::Empty
    ));
    let kinds: Vec<_> = parsed
        .program
        .node_map()
        .into_iter()
        .map(|entry| serde_json::to_value(entry.kind).unwrap())
        .collect();
    for expected in [
        "condition",
        "if",
        "while",
        "for",
        "continue",
        "break",
        "empty",
    ] {
        assert!(kinds.contains(&json!(expected)));
    }
    assert_mapping(source, &parsed);
}

#[test]
fn declarations_array_literals_index_writes_and_output_have_structured_children() {
    let source = "#include <stdio.h>\nint main(void){int a[3]={+5,-2};int b[31];int x;a[1+0]=a[0]+1;printf(\"中文😀 %d\\n\",a[1]);return 0;}";
    let parsed = parse(source).unwrap();
    let statements = body(&parsed.program);
    let NodeData::Declaration {
        name,
        name_range,
        array_length,
        initializer,
    } = &parsed.program.nodes[statements[0]].data
    else {
        panic!("expected array");
    };
    assert_eq!(name, "a");
    assert_eq!(&source[name_range.start..name_range.end], "a");
    assert_eq!(*array_length, Some(3));
    let Initializer::Array(values) = initializer else {
        panic!("expected initializer list");
    };
    assert_eq!(
        values
            .iter()
            .map(|value| shape(&parsed.program, *value))
            .collect::<Vec<_>>(),
        ["Plus(5)", "Minus(2)"]
    );
    let NodeData::Declaration {
        array_length,
        initializer,
        ..
    } = &parsed.program.nodes[statements[1]].data
    else {
        panic!("expected declaration");
    };
    assert_eq!(*array_length, Some(31));
    assert!(matches!(initializer, Initializer::None));
    let NodeData::Assignment { target, value } = parsed.program.nodes[statements[3]].data else {
        panic!("expected indexed write");
    };
    assert_eq!(shape(&parsed.program, target), "Index(a,Add(1,0))");
    assert_eq!(shape(&parsed.program, value), "Add(Index(a,0),1)");
    let NodeData::Output {
        format,
        format_range,
        arguments,
    } = &parsed.program.nodes[statements[4]].data
    else {
        panic!("expected output");
    };
    assert_eq!(format, "中文😀 %d\n");
    assert_eq!(
        &source[format_range.start..format_range.end],
        "\"中文😀 %d\\n\""
    );
    assert_eq!(arguments.len(), 1);
    assert_eq!(shape(&parsed.program, arguments[0]), "Index(a,1)");
    let header = parsed.program.header_range.unwrap();
    assert_eq!(&source[header.start..header.end], "#include <stdio.h>");
    assert_mapping(source, &parsed);
}

#[test]
fn node_ids_are_deterministic_preorder_with_containing_parents() {
    let source = "int main(){int x=1;x=x+2;return x;}";
    let first = parse(source).unwrap();
    let second = parse(source).unwrap();
    assert_mapping(source, &first);
    assert_mapping(source, &second);
    assert_eq!(
        serde_json::to_value(first.program.node_map()).unwrap(),
        serde_json::to_value(second.program.node_map()).unwrap()
    );
    assert_eq!(first.fuel_used, second.fuel_used);
    let kinds = first
        .program
        .node_map()
        .into_iter()
        .map(|entry| serde_json::to_value(entry.kind).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        json!([
            "function",
            "block",
            "declaration",
            "expression",
            "assignment",
            "expression",
            "expression",
            "expression",
            "expression",
            "return",
            "expression"
        ])
        .as_array()
        .unwrap()
        .clone()
    );
}

#[test]
fn chinese_comments_and_three_line_endings_keep_original_node_locations() {
    for newline in ["\n", "\r\n", "\r"] {
        let source = format!(
            "// 😀中{newline}int main(void) {{{newline}\t/* 中😀 */ int x=1;{newline}\treturn x;{newline}}}{newline}"
        );
        let parsed = parse(&source).unwrap();
        let statements = body(&parsed.program);
        let declaration = parsed.program.nodes[statements[0]].byte_range;
        assert_eq!(&source[declaration.start..declaration.end], "int x=1;");
        let position = SourceMap::new(&source).position(declaration.start).unwrap();
        assert_eq!((position.line, position.column), (3, 11));
        assert_eq!(
            position.utf16_offset,
            source[..declaration.start].encode_utf16().count()
        );
        let returned = parsed.program.nodes[statements[1]].byte_range;
        let position = SourceMap::new(&source).position(returned.start).unwrap();
        assert_eq!((position.line, position.column), (4, 2));
        assert_mapping(&source, &parsed);
    }
}

#[test]
fn missing_tokens_at_eof_are_zero_length_positions_on_the_original_source() {
    for source in [
        "",
        "int main(",
        "int main(){",
        "int main(){return 1",
        "int main(){int a[2",
        "int",
        "int main(){int",
        "int main(){int a[",
        "int main(){int a[1]={",
        "int main(){for(",
    ] {
        let value = error(source, "E_PARSE_INVALID", "parse");
        assert_eq!(
            value["location"],
            json!({"kind":"source","byteRange":{"start":source.len(),"end":source.len()}})
        );
    }
    let source = "// 中文😀\r\nint main(){\r\nreturn 1\r\n";
    let value = error(source, "E_PARSE_INVALID", "parse");
    assert_eq!(
        value["location"]["byteRange"],
        json!({"start":source.len(),"end":source.len()})
    );
}

#[test]
fn a_missing_separator_points_at_the_next_token_without_repair_or_truncation() {
    let source = "int main(){int x=1 printf(\"%d\",x);}";
    let value = error(source, "E_PARSE_INVALID", "parse");
    let start = source.find("printf").unwrap();
    assert_eq!(
        value["location"]["byteRange"],
        json!({"start":start,"end":start+6})
    );
    for source in [
        "int main(){return 0;} ;",
        "int main(){return 0;} extra",
        "int main(){} int x;",
        "int main(){return 0; 1+2;}",
    ] {
        rejects_structure(source);
    }
}

#[test]
fn main_is_unique_parameterless_and_contains_every_supported_declaration() {
    for source in [
        "int f(void){return 1;} int main(void){return 0;}",
        "int main(){} int main(void){}",
        "int x; int main(){}",
        "int main(int x){}",
        "int main(void x){}",
        "int main();",
        "void main(){}",
        "int other(){}",
        "int main(){int f(){return 1;}}",
        "int main(){f();}",
        "int main(){return main();}",
        "int main(){int x=f();}",
        "int main(){void x;}",
        "int main(){int *p;}",
    ] {
        rejects_structure(source);
    }
}

#[test]
fn teaching_header_has_one_position_before_main_and_is_not_an_ast_function() {
    let parsed = parse("// 中😀\n#include <stdio.h>\nint main(){}").unwrap();
    assert_eq!(parsed.program.nodes.len(), 2);
    assert!(parsed.program.header_range.is_some());
    for source in [
        "#include <stdio.h>\n#include <stdio.h>\nint main(){}",
        "int main(){}\n#include <stdio.h>\n",
        "int main(){\n#include <stdio.h>\n}",
    ] {
        rejects_structure(source);
    }
}

#[test]
fn controls_require_braced_bodies_and_for_has_only_its_three_restricted_slots() {
    for fragment in [
        "if(1) return 0;",
        "if(1){}else return 0;",
        "if(1){}else if(0){}",
        "while(1);",
        "for(;;);",
        "for(int a[1];;){}",
        "for(int i=0,j=1;;){}",
        "for(i=0;i=1;i=i+1){}",
        "for(;;int i=0){}",
        "for(;;i=i+1,j=j+1){}",
        "for(printf(\"x\");;){}",
        "for(;1;printf(\"x\")){}",
    ] {
        rejects_structure(&format!("int main(){{{fragment}}}"));
    }
    let source = "int main(){if(1){}else{if(0){}}for(i=0;i<2;i=i+1){}while(0){}}";
    assert_mapping(source, &parse(source).unwrap());
}

#[test]
fn assignment_and_printf_are_statements_with_pure_integer_expressions() {
    for fragment in [
        "if((x=1)){}",
        "x=y=1;",
        "int x=(y=1);",
        "1+2;",
        "x;",
        "(x)=1;",
        "int x=(int)1;",
        "int x=*p;",
        "int x=(1,2);",
        "int x=printf(\"x\");",
        "printf(\"%d\",printf(\"x\"));",
        "return;",
    ] {
        rejects_structure(&format!("int main(){{{fragment}}}"));
    }
}

#[test]
fn arrays_require_fixed_one_dimension_and_signed_literal_initializer_elements() {
    for fragment in [
        "int a[n];",
        "int a[1+1];",
        "int a[-1];",
        "int a[];",
        "int a[1][1];",
        "int a[2]={};",
        "int a[2]={1,2,};",
        "int a[2]={1+1};",
        "int a[2]={x};",
        "int a[2]={- -1};",
        "int a[2]={1,[1]=2};",
        "int a[2]=1;",
        "int x={1};",
        "int x,y;",
        "int a[2]; a[0][0]=1;",
    ] {
        rejects_structure(&format!("int main(){{{fragment}}}"));
    }
}

#[test]
fn strings_only_appear_as_one_printf_format_literal() {
    for fragment in [
        "int x=\"text\";",
        "x=\"text\";",
        "return \"text\";",
        "if(\"text\"){}",
        "\"text\";",
        "printf(fmt,1);",
        "printf(\"a\" \"b\");",
        "printf(\"%d\",\"text\");",
        "printf();",
        "printf(\"x\",);",
    ] {
        rejects_structure(&format!("int main(){{{fragment}}}"));
    }
}

#[test]
fn semantic_errors_remain_structural_programs_for_the_next_task() {
    for fragment in [
        "x=1;int x;",
        "int x=1;int x=2;",
        "int __reserved;int _Upper;",
        "break;continue;",
        "int a[0];",
        "int a[1]={1,2};",
        "int a[2];int b[2];a=b;",
        "int x=x;",
        "printf(\"%f\",1);",
        "printf(\"%d\");",
        "printf(\"literal\",1);",
        "printf(\"%02d %\",1);",
        "for(int i=0;i<1;i=i+1){}return i;",
        "return 1/0;",
    ] {
        let source = format!("int main(){{{fragment}}}");
        let parsed = parse(&source).unwrap_or_else(|error| {
            panic!("05.3/06 check was applied early: {fragment}: {error:?}")
        });
        assert_mapping(&source, &parsed);
    }
}

#[test]
fn lexer_failures_are_forwarded_with_their_original_stage_and_location() {
    for source in [
        "int main(){int x=010;}",
        "int main(){x++;}",
        "int main(){\"a\\t\";}",
        "int main(){}😀",
    ] {
        assert_eq!(
            serde_json::to_value(parse(source).unwrap_err()).unwrap(),
            serde_json::to_value(lex(source).unwrap_err()).unwrap()
        );
    }
    for bytes in [&[0xff][..], &[0xed, 0xa0, 0x80][..], &[b'i', 0xc0][..]] {
        assert_eq!(
            serde_json::to_value(parse_bytes(bytes).unwrap_err()).unwrap(),
            serde_json::to_value(lex_bytes(bytes).unwrap_err()).unwrap()
        );
    }
    let bytes = vec![b' '; 32_769];
    assert_eq!(
        serde_json::to_value(parse_bytes(&bytes).unwrap_err()).unwrap(),
        serde_json::to_value(lex_bytes(&bytes).unwrap_err()).unwrap()
    );
    let source = "int main(){return 0;}";
    assert_eq!(
        serde_json::to_value(parse_bytes(source.as_bytes()).unwrap().program.node_map()).unwrap(),
        serde_json::to_value(parse(source).unwrap().program.node_map()).unwrap()
    );
}

fn depth_failure(source: &str, dimension: &str) {
    let value = error(source, "E_DEPTH_LIMIT", "parse");
    assert_eq!(value["details"]["dimension"], dimension);
    assert_eq!(value["details"]["limit"], 64);
    assert_eq!(value["details"]["attempted"], 65);
}

#[test]
fn syntax_depth_allows_64_block_levels_and_rejects_65() {
    for (nested, succeeds) in [(63, true), (64, false)] {
        let source = format!(
            "int main(){{{};{}}}",
            "{".repeat(nested),
            "}".repeat(nested)
        );
        if succeeds {
            let parsed = parse(&source).unwrap();
            assert_eq!(parsed.max_syntax_depth, 64);
            assert_mapping(&source, &parsed);
        } else {
            depth_failure(&source, "syntaxDepth");
        }
    }
}

#[test]
fn parenthesis_depth_is_bounded_separately_from_expression_ast_depth() {
    let source = format!(
        "int main(){{return {}1{};}}",
        "(".repeat(63),
        ")".repeat(63)
    );
    let parsed = parse(&source).unwrap();
    assert_eq!(parsed.max_syntax_depth, 64);
    assert_eq!(parsed.max_ast_depth, 1);
    assert_mapping(&source, &parsed);
    let source = format!(
        "int main(){{return {}1{};}}",
        "(".repeat(64),
        ")".repeat(64)
    );
    depth_failure(&source, "syntaxDepth");
}

#[test]
fn mixed_blocks_controls_and_parentheses_share_the_current_syntax_path() {
    let source = format!(
        "int main(){{{{return {}1{};}}}}",
        "(".repeat(62),
        ")".repeat(62)
    );
    let parsed = parse(&source).unwrap();
    assert_eq!(parsed.max_syntax_depth, 64);
    assert_mapping(&source, &parsed);
    let source = format!(
        "int main(){{{{return {}1{};}}}}",
        "(".repeat(63),
        ")".repeat(63)
    );
    depth_failure(&source, "syntaxDepth");
    let source = format!(
        "int main(){{if({}1{}){{}}}}",
        "(".repeat(61),
        ")".repeat(61)
    );
    let parsed = parse(&source).unwrap();
    assert_eq!(parsed.max_syntax_depth, 64);
    assert_mapping(&source, &parsed);
    let source = format!(
        "int main(){{if({}1{}){{}}}}",
        "(".repeat(62),
        ")".repeat(62)
    );
    depth_failure(&source, "syntaxDepth");
}

#[test]
fn ast_depth_bounds_left_associative_flat_chains_and_right_associative_unary_chains() {
    // The two independent limits must both remain available when combined.
    for (groups, unary, dimension) in [
        (63, 63, None),
        (64, 63, Some("syntaxDepth")),
        (63, 64, Some("astDepth")),
    ] {
        let expression = format!(
            "{}{}1{}",
            "(".repeat(groups),
            "!".repeat(unary),
            ")".repeat(groups)
        );
        let source = format!("int main(){{return {expression};}}");
        if let Some(dimension) = dimension {
            depth_failure(&source, dimension);
        } else {
            let parsed = parse(&source).unwrap();
            assert_eq!(parsed.max_syntax_depth, 64);
            assert_eq!(parsed.max_ast_depth, 64);
            assert_mapping(&source, &parsed);
        }
    }
    for expression in [
        format!("{}1", "1+".repeat(63)),
        format!("{}1", "!".repeat(63)),
    ] {
        let source = format!("int main(){{return {expression};}}");
        let parsed = parse(&source).unwrap();
        assert_eq!(parsed.max_ast_depth, 64);
        assert_mapping(&source, &parsed);
    }
    for expression in [
        format!("{}1", "1+".repeat(64)),
        format!("{}1", "!".repeat(64)),
    ] {
        let source = format!("int main(){{return {expression};}}");
        depth_failure(&source, "astDepth");
    }
}

#[test]
fn overdeep_flat_input_is_rejected_and_dropped_without_building_a_recursive_tree() {
    for expression in [
        format!("{}1", "1+".repeat(16_000)),
        format!("{}1", "!".repeat(16_000)),
    ] {
        let source = format!("int main(){{return {expression};}}");
        assert!(source.len() < 32_768);
        depth_failure(&source, "astDepth");
    }
    let source = format!("int main(){{{};{}}}", "{".repeat(8_000), "}".repeat(8_000));
    depth_failure(&source, "syntaxDepth");
}

#[test]
fn broad_programs_do_not_spend_nesting_budget_per_statement() {
    let source = format!("int main(){{{}}}", ";".repeat(8_000));
    let parsed = parse(&source).unwrap();
    assert_eq!(body(&parsed.program).len(), 8_000);
    assert_eq!(parsed.max_syntax_depth, 1);
    assert_mapping(&source, &parsed);
}

#[test]
fn original_shared_sources_are_consumed_without_claiming_execution_results() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../shared/contracts/02.4-语义与输入样例.json"
    ))
    .unwrap();
    assert_eq!(fixture["purpose"], "contract-fixture");
    let mut accepted = 0;
    let mut rejected = 0;
    let mut no_source = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let Some(source) = case["source"].as_str() else {
            assert!(case["source"].is_null(), "{id}");
            no_source += 1;
            continue;
        };
        let must_reject = matches!(
            case["origin"].as_str(),
            Some(
                "NEG-01"
                    | "NEG-02"
                    | "NEG-03"
                    | "NEG-04"
                    | "NEG-05"
                    | "NEG-06"
                    | "NEG-07"
                    | "NEG-08"
                    | "NEG-09"
                    | "NEG-10"
                    | "NEG-16"
                    | "NEG-18"
                    | "NEG-19"
                    | "NEG-23"
                    | "NEG-24"
                    | "NEG-25"
                    | "NEG-26"
                    | "NEG-40"
                    | "NEG-41"
                    | "NEG-42"
                    | "NEG-43"
                    | "NEG-45"
                    | "NEG-46"
            )
        );
        if !must_reject {
            let parsed = parse(source).unwrap_or_else(|error| panic!("{id}: {error:?}"));
            assert_mapping(source, &parsed);
            accepted += 1;
            continue;
        }
        let value = serde_json::to_value(parse(source).expect_err(id)).unwrap();
        assert!(
            matches!(value["stage"].as_str(), Some("lex" | "parse")),
            "{id}"
        );
        assert!(
            case["expected"]["allowedStages"]
                .as_array()
                .unwrap()
                .contains(&value["stage"]),
            "{id}"
        );
        assert!(
            case["expected"]["allowedCodes"]
                .as_array()
                .unwrap()
                .contains(&value["code"]),
            "{id}"
        );
        rejected += 1;
    }
    assert_eq!((accepted, rejected, no_source), (89, 23, 10));
    // No stdout/exitCode/judgeStatus/terminalStatus assertion: 05.2 only parses.
}

#[test]
fn all_ten_markdown_reference_programs_are_parsed_from_the_frozen_document() {
    let markdown = include_str!("../../../shared/fixtures/reference-programs.md");
    let mut lines = markdown.lines();
    let mut references = 0;
    while let Some(line) = lines.next() {
        if line != "```c" {
            continue;
        }
        let mut source = String::new();
        for line in lines.by_ref() {
            if line == "```" {
                break;
            }
            source.push_str(line);
            source.push('\n');
        }
        let parsed =
            parse(&source).unwrap_or_else(|error| panic!("REF-{:02}: {error:?}", references + 1));
        assert_mapping(&source, &parsed);
        references += 1;
    }
    assert_eq!(references, 10);
}
