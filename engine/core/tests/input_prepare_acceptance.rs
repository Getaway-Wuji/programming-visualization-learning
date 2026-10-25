//! Explicit browser preparation never rewrites the trusted public example.
use c_viz_core::{budget::Meter, codec, exec, input, run};
use serde_json::{Value, json};

fn meter() -> Meter {
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    meter
}
fn catalog(id: &str) -> Value {
    let package: Value =
        serde_json::from_str(include_str!("../../../项目文档/契约/02.1-内容样例.json")).unwrap();
    let subject = package["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap();
    let program = package["programs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == subject["programRef"]["id"])
        .unwrap();
    let spec = package["inputSpecs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == program["inputRef"]["id"])
        .unwrap();
    json!({"packageRef":{"id":package["packageId"],"version":package["packageVersion"]},"subject":subject,"program":program,"inputSpec":spec})
}
fn prepare(catalog: &Value, values: &Value) -> Value {
    let input_bytes = codec::encode(values, &mut meter(), 65536).unwrap();
    let prepared = exec::prepare_input_bytes(catalog, &input_bytes, &mut meter()).unwrap();
    serde_json::from_slice::<Value>(&prepared).unwrap()["source"].clone()
}
fn verify(catalog: &Value, values: &Value, source: &Value) {
    let maps: Vec<_> = source["bindingMap"]
        .as_array()
        .unwrap()
        .iter()
        .map(|map| input::BindingMapEntry {
            binding_key: map["bindingKey"].as_str().unwrap().to_owned(),
            byte_range: c_viz_core::source::ByteRange {
                start: map["byteRange"]["start"].as_u64().unwrap() as usize,
                end: map["byteRange"]["end"].as_u64().unwrap() as usize,
            },
        })
        .collect();
    input::verify_instance_metered(
        &catalog["program"],
        &catalog["inputSpec"],
        values,
        source["text"].as_str().unwrap(),
        &maps,
        &mut meter(),
    )
    .unwrap();
}

#[test]
fn explicit_values_prepare_against_the_unchanged_original_program() {
    for (id, values) in [
        ("case.c.assignment", json!({"x":-999})),
        ("case.c.branch", json!({"x":999})),
        ("case.c.loops", json!({"n":30})),
        ("case.c.array-traversal", json!({"values":[-999,0,999]})),
        ("case.c.bubble-sort", json!({"values":[9,-5,9,0]})),
        ("case.c.selection-sort", json!({"values":[999,-999]})),
        (
            "case.c.binary-search-first",
            json!({"values":[-999,0,0,999],"target":0}),
        ),
    ] {
        let catalog = catalog(id);
        let original = catalog.clone();
        let source = prepare(&catalog, &values);
        verify(&catalog, &values, &source);
        assert_eq!(catalog, original);
        assert!(run::run(source["text"].as_str().unwrap(), &mut meter()).exit_code == Some(0));
    }
}

#[test]
fn empty_and_thirty_item_sources_use_the_actual_logical_input() {
    let catalog = catalog("case.c.array-traversal");
    let empty = prepare(&catalog, &json!({"values":[]}));
    let text = empty["text"].as_str().unwrap();
    assert!(text.contains("int n = 0;") && text.contains("int values[1] = {0};"));
    verify(&catalog, &json!({"values":[]}), &empty);
    let values = json!({"values":(0..30).collect::<Vec<i32>>()});
    let full = prepare(&catalog, &values);
    assert!(full["text"].as_str().unwrap().contains("int n = 30;"));
    verify(&catalog, &values, &full);
}

#[test]
fn invalid_or_unsorted_inputs_never_produce_a_source() {
    for values in [
        json!({"values":[3,1],"target":1}),
        json!({"values":[0],"target":1000}),
        json!({"values":[0.5],"target":0}),
        json!({"values":vec![0;31],"target":0}),
        json!({"values":[],"target":0,"n":0}),
    ] {
        let result = exec::prepare_input(
            &catalog("case.c.binary-search-first"),
            &values,
            &mut meter(),
        );
        assert!(result.is_err());
    }
    let result = exec::prepare_input(
        &catalog("case.c.binary-search-first"),
        &json!({"values":[3,1],"target":1}),
        &mut meter(),
    );
    assert_eq!(result.unwrap_err().0, "E_INPUT_ORDER");
}

#[test]
fn preparation_bytes_reject_bad_canonical_data_and_keep_the_deadline() {
    let catalog = catalog("case.c.assignment");
    for bytes in [
        b"{\"x\":3,\"x\":4}".as_slice(),
        b"{\"x\":1e0}",
        b"{\"x\":-0}",
        &[0xff],
    ] {
        assert_eq!(
            exec::prepare_input_bytes(&catalog, bytes, &mut meter())
                .unwrap_err()
                .0,
            "E_INPUT_INVALID"
        );
    }
    let mut expired = meter();
    expired.set_clock(0, Box::new(|| 0));
    assert_eq!(
        exec::prepare_input_bytes(&catalog, b"{\"x\":3}", &mut expired)
            .unwrap_err()
            .0,
        "E_DEADLINE"
    );
}
