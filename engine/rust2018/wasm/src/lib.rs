use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn monotonic_now() -> f64;
}

#[wasm_bindgen]
pub fn execute_rust2018(
    bytes: &[u8],
    build_id: &str,
    remaining_ms: u32,
) -> Result<Vec<u8>, JsValue> {
    let mut meter = c_viz_rust2018::budget::Meter::new();
    meter.set_clock(
        u64::from(remaining_ms.min(1000)),
        Box::new(|| monotonic_now() as u64),
    );
    c_viz_rust2018::execute(bytes, build_id, &mut meter).map_err(JsValue::from_str)
}
