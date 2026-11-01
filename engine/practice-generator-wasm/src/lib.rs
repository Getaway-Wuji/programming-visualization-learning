//! A single ephemeral browser job. No learning record, storage or network access.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn monotonic_now() -> f64;
}

#[wasm_bindgen]
pub fn practice_job(bytes: &[u8], build_id: &str, remaining_ms: u32) -> Result<Vec<u8>, JsValue> {
    let mut session =
        c_viz_practice_generator::Session::new(remaining_ms, || monotonic_now() as u64)
            .map_err(JsValue::from_str)?;
    c_viz_practice_generator::process(bytes, build_id, &mut session).map_err(JsValue::from_str)
}
