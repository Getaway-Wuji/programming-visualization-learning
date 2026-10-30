//! Separate bounded memory protocol; pointers never address host memory.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn monotonic_now() -> f64;
}

#[wasm_bindgen]
pub fn execute_memory(bytes: &[u8], build_id: &str, remaining_ms: u32) -> Result<Vec<u8>, JsValue> {
    let mut meter = c_viz_memory::budget::Meter::new();
    meter.set_clock(
        u64::from(remaining_ms.min(1000)),
        Box::new(|| monotonic_now() as u64),
    );
    c_viz_memory::runtime::execute(bytes, build_id, &mut meter).map_err(JsValue::from_str)
}
