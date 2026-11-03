use c_viz_c6::{state, types::Types};
use serde_json::json;
#[test]
fn malformed_later_atom_rolls_back_entire_step() {
    let mut value = state::initial(0);
    let initial = value.clone();
    let mut after = value["control"].clone();
    after["inputCursor"] = json!(3);
    let changes = vec![
        state::singleton(&value, "control", after),
        json!({"op":"counters","before":{},"after":{}}),
    ];
    assert!(state::apply(&mut value, &changes, &Types::default(), false).is_err());
    assert_eq!(value, initial);
}
#[test]
fn malformed_reverse_atom_rolls_back_reverse_prefix() {
    let mut value = state::initial(0);
    let initial = value.clone();
    let mut before = value["control"].clone();
    before["inputCursor"] = json!(1);
    let changes = vec![
        json!({"op":"counters","before":{},"after":{}}),
        json!({"op":"control","before":before,"after":value["control"]}),
    ];
    assert!(state::apply(&mut value, &changes, &Types::default(), true).is_err());
    assert_eq!(value, initial);
}
