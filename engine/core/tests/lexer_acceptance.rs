//! Real P0-C lexical acceptance, without parsing or executing a C program.

use c_viz_core::lexer::{Keyword, Lexed, Symbol, TokenKind, lex, lex_bytes};
use c_viz_core::source::{ByteRange, SourceMap};
use serde_json::{Value, json};

fn kinds(source: &str) -> Vec<TokenKind> {
    lex(source)
        .unwrap_or_else(|error| panic!("lexical acceptance failed: {error:?}"))
        .tokens
        .into_iter()
        .filter_map(|token| (token.kind != TokenKind::Eof).then_some(token.kind))
        .collect()
}

fn failure(source: &str, code: &str) -> Value {
    let error = lex(source).expect_err("invalid input must not yield a token prefix");
    let value = serde_json::to_value(error).unwrap();
    assert_eq!(value["code"], code, "source: {source:?}");
    assert_eq!(value["severity"], "error");
    assert_eq!(value["origin"], "rust");
    assert_eq!(value["stage"], "lex");
    assert_eq!(value["location"]["kind"], "source");
    let range = ByteRange {
        start: value["location"]["byteRange"]["start"].as_u64().unwrap() as usize,
        end: value["location"]["byteRange"]["end"].as_u64().unwrap() as usize,
    };
    assert!(SourceMap::new(source).is_valid_range(range));
    assert!(range.start < range.end, "error must identify source text");
    value
}

fn failure_range(source: &str, code: &str, start: usize, end: usize) -> Value {
    let value = failure(source, code);
    assert_eq!(
        value["location"]["byteRange"],
        json!({ "start": start, "end": end }),
        "source: {source:?}"
    );
    value
}

fn assert_complete_spans(source: &str, lexed: &Lexed) {
    let map = SourceMap::new(source);
    let eof = lexed.tokens.last().expect("EOF must always exist");
    assert_eq!(eof.kind, TokenKind::Eof);
    assert_eq!(
        eof.byte_range,
        ByteRange {
            start: source.len(),
            end: source.len(),
        }
    );
    let mut previous_end = 0;
    for token in &lexed.tokens {
        assert!(map.is_valid_range(token.byte_range));
        assert!(previous_end <= token.byte_range.start);
        if token.kind != TokenKind::Eof {
            assert!(token.byte_range.start < token.byte_range.end);
        }
        previous_end = token.byte_range.end;
    }
    assert_eq!(lexed.fuel_used, source.len() + lexed.tokens.len());
}

#[test]
fn every_supported_keyword_is_distinct_and_identifiers_are_case_sensitive() {
    let source = "int void main printf if else while for break continue return";
    let expected = [
        Keyword::Int,
        Keyword::Void,
        Keyword::Main,
        Keyword::Printf,
        Keyword::If,
        Keyword::Else,
        Keyword::While,
        Keyword::For,
        Keyword::Break,
        Keyword::Continue,
        Keyword::Return,
    ]
    .into_iter()
    .map(TokenKind::Keyword)
    .collect::<Vec<_>>();
    assert_eq!(kinds(source), expected);
    assert_eq!(
        kinds("i int1 INT If _ abc_09 __private _Upper main1 printf1"),
        [
            "i",
            "int1",
            "INT",
            "If",
            "_",
            "abc_09",
            "__private",
            "_Upper",
            "main1",
            "printf1",
        ]
        .into_iter()
        .map(|name| TokenKind::Identifier(name.to_owned()))
        .collect::<Vec<_>>()
    );
    // Reserved-name bindings are a semantic check in 05.3, after tokenization.
    assert_complete_spans(source, &lex(source).unwrap());
}

#[test]
fn every_supported_punctuator_is_recognized_with_maximal_matching() {
    let source = "( ) { } [ ] ; , = + - * / % < <= > >= == != ! && ||";
    let expected = [
        Symbol::LeftParen,
        Symbol::RightParen,
        Symbol::LeftBrace,
        Symbol::RightBrace,
        Symbol::LeftBracket,
        Symbol::RightBracket,
        Symbol::Semicolon,
        Symbol::Comma,
        Symbol::Assign,
        Symbol::Plus,
        Symbol::Minus,
        Symbol::Star,
        Symbol::Slash,
        Symbol::Percent,
        Symbol::Less,
        Symbol::LessEqual,
        Symbol::Greater,
        Symbol::GreaterEqual,
        Symbol::Equal,
        Symbol::NotEqual,
        Symbol::Not,
        Symbol::AndAnd,
        Symbol::OrOr,
    ]
    .into_iter()
    .map(TokenKind::Symbol)
    .collect::<Vec<_>>();
    assert_eq!(kinds(source), expected);
    assert_eq!(
        kinds("a<=b&&c!=d||!e==f>=g"),
        vec![
            TokenKind::Identifier("a".into()),
            TokenKind::Symbol(Symbol::LessEqual),
            TokenKind::Identifier("b".into()),
            TokenKind::Symbol(Symbol::AndAnd),
            TokenKind::Identifier("c".into()),
            TokenKind::Symbol(Symbol::NotEqual),
            TokenKind::Identifier("d".into()),
            TokenKind::Symbol(Symbol::OrOr),
            TokenKind::Symbol(Symbol::Not),
            TokenKind::Identifier("e".into()),
            TokenKind::Symbol(Symbol::Equal),
            TokenKind::Identifier("f".into()),
            TokenKind::Symbol(Symbol::GreaterEqual),
            TokenKind::Identifier("g".into()),
        ]
    );
    assert_complete_spans(source, &lex(source).unwrap());
}

#[test]
fn decimal_bounds_and_separate_unary_signs_keep_their_original_spans() {
    assert_eq!(
        kinds("0 1 999 2147483647 -2147483647 (-2147483647 - 1) + +1 - -1"),
        vec![
            TokenKind::Integer(0),
            TokenKind::Integer(1),
            TokenKind::Integer(999),
            TokenKind::Integer(i32::MAX),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Integer(i32::MAX),
            TokenKind::Symbol(Symbol::LeftParen),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Integer(i32::MAX),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Integer(1),
            TokenKind::Symbol(Symbol::RightParen),
            TokenKind::Symbol(Symbol::Plus),
            TokenKind::Symbol(Symbol::Plus),
            TokenKind::Integer(1),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Integer(1),
        ]
    );
    let source = "-2147483647";
    let lexed = lex(source).unwrap();
    assert_eq!(lexed.tokens[0].byte_range, ByteRange { start: 0, end: 1 });
    assert_eq!(lexed.tokens[1].byte_range, ByteRange { start: 1, end: 11 });
}

#[test]
fn invalid_number_candidates_are_rejected_whole_without_accepting_a_prefix() {
    for candidate in [
        "00",
        "010",
        "09",
        "0x10",
        "0Xf",
        "0b10",
        "1u",
        "1UL",
        "1f",
        "123abc",
        "1_000",
        "1.0",
        "1.",
        "1e2",
        "1e-2",
        "1E+2",
        "0x1p-2",
        "2147483648",
        "9999999999999999999999999999999999999999",
    ] {
        let source = format!("int x = {candidate};");
        failure_range(&source, "E_LEX_INVALID", 8, 8 + candidate.len());
    }
    // A signed value does not allow the out-of-range positive decimal token.
    failure_range("-2147483648", "E_LEX_INVALID", 1, 11);
    failure_range(".5", "E_UNSUPPORTED_SYNTAX", 0, 1);
}

#[test]
fn finite_output_strings_decode_only_the_three_supported_escapes() {
    let source = r#""中文😀 %d %%\n\\\"""#;
    let lexed = lex(source).unwrap();
    assert_eq!(
        lexed.tokens[0].kind,
        TokenKind::StringLiteral("中文😀 %d %%\n\\\"".into())
    );
    assert_eq!(
        lexed.tokens[0].byte_range,
        ByteRange {
            start: 0,
            end: source.len(),
        }
    );
    assert_eq!(kinds(r#""" "/* comment */ // text" "%f %02d %""#).len(), 3);
    // Format validity, string placement and concatenation belong to 05.3/05.2.
    assert_complete_spans(source, &lexed);
}

#[test]
fn unsupported_escapes_cannot_silently_drop_the_backslash() {
    for escaped in [
        "t", "r", "0", "a", "b", "v", "f", "?", "x41", "123", "u4E2D",
    ] {
        let source = format!("\"a\\{escaped}b\"");
        let value = failure(&source, "E_LEX_INVALID");
        assert_eq!(value["location"]["byteRange"]["start"], 2);
    }
    for source in ["\"a\n\"", "\"a\r\"", "\"a\0\""] {
        failure_range(source, "E_LEX_INVALID", 2, 3);
    }
    failure_range("\"a\r\n\"", "E_LEX_INVALID", 2, 4);
    failure_range("\"a\\\r\n\"", "E_LEX_INVALID", 2, 5);
}

#[test]
fn unterminated_strings_and_comments_report_the_original_source_extent() {
    for source in ["\"", "\"中😀", "\"abc\\", "/*", "/* 中😀\r\n still open"] {
        failure_range(source, "E_LEX_INVALID", 0, source.len());
    }
}

#[test]
fn chinese_emoji_comments_and_each_line_ending_preserve_token_coordinates() {
    for newline in ["\n", "\r\n", "\r"] {
        let source = format!("// 😀中文{newline}/* 注释😀 */{newline}\tint x = 1;");
        let lexed = lex(&source).unwrap();
        assert_eq!(lexed.tokens[0].kind, TokenKind::Keyword(Keyword::Int));
        let start = source.find("int").unwrap();
        assert_eq!(
            lexed.tokens[0].byte_range,
            ByteRange {
                start,
                end: start + 3
            }
        );
        let position = SourceMap::new(&source).position(start).unwrap();
        assert_eq!((position.line, position.column), (3, 2));
        assert_eq!(
            position.utf16_offset,
            source[..start].encode_utf16().count()
        );
        assert_eq!(
            kinds(&source),
            vec![
                TokenKind::Keyword(Keyword::Int),
                TokenKind::Identifier("x".into()),
                TokenKind::Symbol(Symbol::Assign),
                TokenKind::Integer(1),
                TokenKind::Symbol(Symbol::Semicolon),
            ]
        );
        assert_complete_spans(&source, &lexed);
    }
    let source = "//😀中\r\nint x;\r/*注😀*/\nreturn 0;";
    let lexed = lex(source).unwrap();
    let token = lexed
        .tokens
        .iter()
        .find(|token| token.kind == TokenKind::Keyword(Keyword::Return))
        .unwrap();
    let position = SourceMap::new(source)
        .position(token.byte_range.start)
        .unwrap();
    assert_eq!((position.line, position.column), (4, 1));
    assert_complete_spans(source, &lexed);
}

#[test]
fn comments_are_non_nested_and_do_not_merge_adjacent_identifiers() {
    assert_eq!(
        kinds("a/* 中文😀 */b// to EOF"),
        vec![
            TokenKind::Identifier("a".into()),
            TokenKind::Identifier("b".into())
        ]
    );
    assert_eq!(
        kinds("/* outer /* inner */int"),
        vec![TokenKind::Keyword(Keyword::Int)]
    );
    assert_eq!(
        kinds("/* outer /* inner */ tail */"),
        vec![
            TokenKind::Identifier("tail".into()),
            TokenKind::Symbol(Symbol::Star),
            TokenKind::Symbol(Symbol::Slash),
        ]
    );
    for source in ["", "//😀 EOF", "/* 中文😀 */", " \t\u{b}\u{c}\r\n"] {
        let lexed = lex(source).unwrap();
        assert_eq!(lexed.tokens.len(), 1);
        assert_complete_spans(source, &lexed);
    }
}

#[test]
fn invalid_characters_cannot_be_discarded_even_after_a_valid_prefix() {
    for invalid in [
        '@', '$', '`', '\\', '\0', '\u{7f}', '中', '😀', '\u{a0}', '\u{feff}',
    ] {
        let source = format!("int x;{invalid}return 0;");
        failure_range(&source, "E_LEX_INVALID", 6, 6 + invalid.len_utf8());
    }
    for scalar in 1..=31 {
        let invalid = char::from_u32(scalar).unwrap();
        if matches!(invalid, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r') {
            continue;
        }
        let source = format!("int x;{invalid}return 0;");
        failure_range(&source, "E_LEX_INVALID", 6, 7);
    }
    failure_range("// a\0b\nint x;", "E_LEX_INVALID", 4, 5);
    failure_range("/* a\0b */ int x;", "E_LEX_INVALID", 4, 5);
}

#[test]
fn forbidden_operators_use_the_longest_token_instead_of_legal_fragments() {
    for operator in [
        "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "<<=", ">>=", "->",
        "...", "<:", ":>", "<%", "%>", "%:", "%:%:", "&", "|", "^", "~", "?", ":", "'",
    ] {
        let source = format!("x {operator} 1;");
        failure_range(&source, "E_UNSUPPORTED_SYNTAX", 2, 2 + operator.len());
    }
    failure_range("1--1", "E_UNSUPPORTED_SYNTAX", 1, 3);
    failure_range("1++1", "E_UNSUPPORTED_SYNTAX", 1, 3);
    assert_eq!(
        kinds("1 - (-1)"),
        vec![
            TokenKind::Integer(1),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Symbol(Symbol::LeftParen),
            TokenKind::Symbol(Symbol::Minus),
            TokenKind::Integer(1),
            TokenKind::Symbol(Symbol::RightParen),
        ]
    );
}

#[test]
fn unsupported_c_keywords_are_rejected_as_whole_words() {
    // The frozen NEG-08 diagnosis belongs to parsing, so this reserved word
    // has an explicit token rather than becoming a name or a lexical error.
    assert_eq!(kinds("sizeof"), vec![TokenKind::Keyword(Keyword::Sizeof)]);
    for keyword in [
        "auto",
        "char",
        "const",
        "do",
        "double",
        "enum",
        "extern",
        "float",
        "goto",
        "long",
        "register",
        "short",
        "signed",
        "static",
        "struct",
        "switch",
        "typedef",
        "union",
        "unsigned",
        "volatile",
        "case",
        "default",
        "inline",
        "restrict",
        "_Alignas",
        "_Alignof",
        "_Atomic",
        "_Bool",
        "_Complex",
        "_Generic",
        "_Imaginary",
        "_Noreturn",
        "_Static_assert",
        "_Thread_local",
    ] {
        failure_range(keyword, "E_UNSUPPORTED_SYNTAX", 0, keyword.len());
    }
}

#[test]
fn teaching_header_accepts_only_the_fixed_single_line_shape() {
    for newline in ["\n", "\r\n", "\r", ""] {
        let source = format!(" \t# \tinclude\t<stdio.h> \t{newline}");
        let lexed = lex(&source).unwrap();
        assert_eq!(lexed.tokens[0].kind, TokenKind::IncludeStdio);
        assert_eq!(
            &source[lexed.tokens[0].byte_range.start..lexed.tokens[0].byte_range.end],
            "# \tinclude\t<stdio.h>"
        );
        assert_complete_spans(&source, &lexed);
    }
    assert_eq!(kinds("#include<stdio.h>"), vec![TokenKind::IncludeStdio]);
    // Count and placement require syntax structure and remain 05.2 checks.
    assert_eq!(
        kinds("#include <stdio.h>\nint main() {}\n#include <stdio.h>"),
        vec![
            TokenKind::IncludeStdio,
            TokenKind::Keyword(Keyword::Int),
            TokenKind::Keyword(Keyword::Main),
            TokenKind::Symbol(Symbol::LeftParen),
            TokenKind::Symbol(Symbol::RightParen),
            TokenKind::Symbol(Symbol::LeftBrace),
            TokenKind::Symbol(Symbol::RightBrace),
            TokenKind::IncludeStdio,
        ]
    );
}

#[test]
fn other_preprocessing_or_trailing_characters_cannot_hide_in_a_header() {
    for source in [
        "#define X 1",
        "#include <stdlib.h>",
        "#include \"stdio.h\"",
        "#include <stdio.h> int x;",
        "#include <stdio.h> // comment",
        "#include <stdio.h> /* comment */",
        "#include <stdio.h>@",
        "#include <stdio.h>\0",
        "#include <stdio.h>\\\nint main() {}",
        "#include <stdio.h>\u{a0}",
        "#include < stdio.h >",
        "#includee <stdio.h>",
        "int x; #include <stdio.h>",
        "/*prefix*/#include <stdio.h>",
    ] {
        failure(source, "E_UNSUPPORTED_SYNTAX");
    }
}

#[test]
fn utf8_source_limit_uses_bytes_including_comments_and_whitespace() {
    let mut source = String::from("/*");
    source.push_str(&"中😀".repeat(4_680));
    source.push_str("    */");
    assert_eq!(source.len(), 32_768);
    let lexed = lex(&source).unwrap();
    assert_eq!(lexed.tokens.len(), 1);
    assert_complete_spans(&source, &lexed);
    assert_eq!(lex_bytes(source.as_bytes()).unwrap(), lexed);
    source.push(' ');
    let value = serde_json::to_value(lex(&source).unwrap_err()).unwrap();
    assert_eq!(
        value,
        json!({
            "code": "E_SOURCE_LIMIT",
            "severity": "error",
            "origin": "rust",
            "stage": "preflight",
            "location": { "kind": "synthetic", "reason": "pre-execution" },
            "details": {
                "dimension": "sourceBytes",
                "limit": 32768,
                "used": 0,
                "attempted": 32769
            }
        })
    );
    assert_eq!(
        serde_json::to_value(lex_bytes(source.as_bytes()).unwrap_err()).unwrap(),
        value
    );
}

#[test]
fn ascii_source_boundary_accepts_every_token_and_accounts_for_eof_fuel() {
    let source = ";".repeat(32_768);
    let lexed = lex(&source).unwrap();
    assert_eq!(lexed.tokens.len(), 32_769);
    assert!(
        lexed.tokens[..32_768]
            .iter()
            .all(|token| token.kind == TokenKind::Symbol(Symbol::Semicolon))
    );
    assert_eq!(lexed.fuel_used, 65_537);
    assert_complete_spans(&source, &lexed);
    let invalid = format!("{source};");
    let value = serde_json::to_value(lex(&invalid).unwrap_err()).unwrap();
    assert_eq!(value["code"], "E_SOURCE_LIMIT");
    assert_eq!(value["details"]["attempted"], 32_769);
}

#[test]
fn invalid_utf8_is_explicitly_rejected_without_fabricating_source_coordinates() {
    for invalid in [
        &[0x80][..],
        &[0xc0, 0xaf][..],
        &[0xe4, 0xb8][..],
        &[0xed, 0xa0, 0x80][..],
        &[0xf4, 0x90, 0x80, 0x80][..],
        &[b'i', b'n', b't', b' ', 0xff, b';'][..],
    ] {
        let value = serde_json::to_value(lex_bytes(invalid).unwrap_err()).unwrap();
        assert_eq!(value["code"], "E_LEX_INVALID");
        assert_eq!(value["origin"], "rust");
        assert_eq!(value["stage"], "lex");
        assert_eq!(
            value["location"],
            json!({ "kind": "synthetic", "reason": "pre-execution" })
        );
    }
    let oversized_invalid = vec![0xff; 32_769];
    let value = serde_json::to_value(lex_bytes(&oversized_invalid).unwrap_err()).unwrap();
    assert_eq!(value["code"], "E_SOURCE_LIMIT");
    assert_eq!(value["stage"], "preflight");
}

#[test]
fn deeply_repeated_punctuation_is_scanned_without_recursive_syntax_work() {
    // Lexing owns no AST or syntax-depth verdict; 05.2 must reject this structure.
    let source = format!("{}{}", "(".repeat(16_384), ")".repeat(16_384));
    let lexed = lex(&source).unwrap();
    assert_eq!(lexed.tokens.len(), 32_769);
    assert_complete_spans(&source, &lexed);
}

#[test]
fn all_ten_frozen_reference_programs_are_lexed_from_the_original_markdown() {
    let markdown = include_str!("../../../shared/fixtures/reference-programs.md");
    let mut references = Vec::new();
    let mut lines = markdown.lines();
    while let Some(line) = lines.next() {
        if line == "```c" {
            let mut source = String::new();
            for line in lines.by_ref() {
                if line == "```" {
                    break;
                }
                source.push_str(line);
                source.push('\n');
            }
            references.push(source);
        }
    }
    assert_eq!(
        references.len(),
        10,
        "all frozen reference programs must be covered"
    );
    for (index, source) in references.iter().enumerate() {
        let lexed = lex(source).unwrap_or_else(|error| panic!("REF-{:02}: {error:?}", index + 1));
        assert_complete_spans(source, &lexed);
        assert_eq!(lexed.tokens[0].kind, TokenKind::IncludeStdio);
        assert!(
            lexed
                .tokens
                .iter()
                .any(|token| token.kind == TokenKind::Keyword(Keyword::Main))
        );
        assert!(
            lexed
                .tokens
                .iter()
                .any(|token| token.kind == TokenKind::Keyword(Keyword::Printf))
        );
    }
}

#[test]
fn shared_machine_sources_pass_or_fail_only_their_selected_lexical_checks() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../shared/contracts/02.4-语义与输入样例.json"
    ))
    .unwrap();
    assert_eq!(fixture["fixtureContractVersion"], "1.0.0");
    assert_eq!(fixture["purpose"], "contract-fixture");
    let mut reference_count = 0;
    let mut positive_count = 0;
    let mut rejection_count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let category = case["category"].as_str().unwrap();
        let origin = case["origin"].as_str().unwrap();
        if matches!(category, "reference" | "positive") {
            let source = case["source"].as_str().expect("selected source is public");
            let lexed = lex(source).unwrap_or_else(|error| panic!("{id}: {error:?}"));
            assert_complete_spans(source, &lexed);
            if category == "reference" {
                reference_count += 1;
            } else {
                positive_count += 1;
            }
            continue;
        }
        let code = match origin {
            "NEG-02" | "NEG-03" | "NEG-09" | "NEG-10" | "NEG-45" => "E_UNSUPPORTED_SYNTAX",
            "NEG-24" | "NEG-26" | "NEG-41" | "NEG-42" => "E_LEX_INVALID",
            _ => continue,
        };
        assert_eq!(category, "negative", "{id}");
        let source = case["source"].as_str().expect("selected source is public");
        let value = failure(source, code);
        assert!(
            case["expected"]["allowedStages"]
                .as_array()
                .unwrap()
                .contains(&value["stage"]),
            "{id} must allow its real lexical stage"
        );
        assert!(
            case["expected"]["allowedCodes"]
                .as_array()
                .unwrap()
                .contains(&value["code"]),
            "{id} must allow its real lexical diagnostic"
        );
        rejection_count += 1;
    }
    assert_eq!(
        (reference_count, positive_count, rejection_count),
        (10, 23, 9)
    );
    // No stdout, exitCode, judgeStatus or terminalStatus is validated here:
    // contract-fixture execution expectations are not evidence of C execution.
}
