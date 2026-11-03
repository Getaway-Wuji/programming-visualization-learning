use c_viz_c6::{api, budget::Meter, codec};
use serde_json::{Value, json};
use std::collections::BTreeSet;
fn analyze(source: &str) -> Result<Value, &'static str> {
    let request = json!({"editVersion":"2.0.0","documentId":"edit-test","packageRef":{"id":"content.c.primer6","version":"1.0.0"},"engine":{"id":"engine.rust.c6","version":"0.1.0"},"sourceRevision":"revision-1","sourceSha256":api::source_hash(source),"source":source});
    let mut meter = Meter::new();
    let bytes = codec::encode(&request, &mut meter, 65536).unwrap();
    let result = api::execute(&bytes, &"a".repeat(64), &mut meter)?;
    let result: Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(result["source"], source);
    assert_eq!(result["sourceSha256"], request["sourceSha256"]);
    assert_eq!(result["documentId"], request["documentId"]);
    Ok(result)
}
fn kinds(value: &Value, set: &mut BTreeSet<String>) {
    match value {
        Value::Object(o) => {
            if let Some(k) = o.get("kind").and_then(Value::as_str) {
                set.insert(k.into());
            }
            for v in o.values() {
                kinds(v, set)
            }
        }
        Value::Array(a) => {
            for v in a {
                kinds(v, set)
            }
        }
        _ => {}
    }
}
#[test]
fn whole_checked_twenty_block_document_is_mapped() {
    let source = "#include <stdio.h>\n// original comments remain in source\nint main(void){int x=3;int a[3]={1,-2,3};x=+x+1;a[1]=x*2;if(x>0 && !(x==1)){x=x-1;}else{x=0;}while(x<10){x=x+1;if(x==7)continue;if(x>8)break;}for(int i=0;i<3;i=i+1){x=x+a[i];}{int y=2;x=x+y;}printf(\"%d\\n\",x);return 0;}";
    let result = analyze(source).unwrap();
    assert_eq!(result["status"], "mapped");
    let mut all = BTreeSet::new();
    kinds(&result["program"], &mut all);
    assert_eq!(all.len(), 20, "{all:?}");
    let blocks = result["blockMap"].as_array().unwrap();
    let unique = blocks
        .iter()
        .map(|b| b["blockId"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(blocks.len(), unique.len());
    assert!(blocks.iter().all(|b| {
        result["nodeMap"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["nodeId"] == b["nodeId"] && n["byteRange"] == b["byteRange"])
    }));
}

#[test]
fn all_twenty_block_operators_survive_rust_canonical_reparse() {
    for op in [
        "+", "-", "*", "/", "%", "<", "<=", ">", ">=", "==", "!=", "&&", "||",
    ] {
        let source = format!("int main(){{int a=7;int b=2;return a{op}b;}}");
        let result = analyze(&source).unwrap();
        assert_eq!(result["status"], "mapped", "{op}");
        assert!(
            result["program"]["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["operator"] == op)
        );
    }
    for op in ["+", "-", "!"] {
        let source = format!("int main(){{int a=7;return {op}a;}}");
        assert_eq!(analyze(&source).unwrap()["status"], "mapped", "{op}");
    }
}
#[test]
fn ast_depth_64_mapping_uses_flat_links_inside_json_depth_32() {
    let source = format!("int main(){{return {}1;}}", "+ ".repeat(61));
    let result = analyze(&source).unwrap();
    assert_eq!(result["status"], "mapped");
    assert!(result["program"]["nodes"].as_array().unwrap().len() > 60);
    assert!(result["program"]["rootId"].as_str().is_some());
}
#[test]
fn supported_new_constructs_are_whole_document_code_only() {
    let programs: Value = serde_json::from_str(include_str!(
        "../../../shared/fixtures/c6/21.3/judge-programs.json"
    ))
    .unwrap();
    for row in programs["programs"].as_array().unwrap() {
        for variant in ["primary", "alternative"] {
            let result = analyze(row[variant].as_str().unwrap()).unwrap();
            assert_eq!(
                result["status"], "code-only",
                "{} {variant}",
                row["profileRef"]
            );
            assert!(result["program"].is_null());
            assert_eq!(result["blockMap"], json!([]));
        }
    }
    for source in [
        "#define UNUSED 7\nint main(){return 0;}",
        "int main(){int x=2;x++;return x;}",
        "int main(){int x=2;x+=1;return x;}",
        "int main(){const int x=2;return x;}",
        "int main(){char x=2;return x;}",
        "int main(){int x=2;int *p=&x;return *p;}",
        "int main(){typedef int T;T x=2;return x;}",
        "int helper(){return 1;}int main(){return 0;}",
        "#include <stdio.h>\nint main(){printf(\"%4d\",2);return 0;}",
    ] {
        assert_eq!(analyze(source).unwrap()["status"], "code-only", "{source}");
    }
}
#[test]
fn invalid_and_unsupported_keep_exact_raw_draft_and_utf8_ranges() {
    for (source, status, code) in [
        (
            "// 中文\nint main(){return missing;}",
            "invalid",
            "E_UNDECLARED",
        ),
        (
            "int main(){goto label;}",
            "unsupported",
            "E_UNSUPPORTED_SYNTAX",
        ),
        ("int main(){int x=;return 0;}", "invalid", "E_PARSE_INVALID"),
    ] {
        let result = analyze(source).unwrap();
        assert_eq!(result["status"], status, "{result}");
        assert_eq!(result["diagnostics"][0]["code"], code);
        assert!(result["program"].is_null());
        let range = &result["diagnostics"][0]["byteRange"];
        assert!(source.is_char_boundary(range["start"].as_u64().unwrap() as usize));
        assert!(source.is_char_boundary(range["end"].as_u64().unwrap() as usize));
    }
}
