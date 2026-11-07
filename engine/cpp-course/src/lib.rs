use c_viz_advanced::{budget::Meter, runtime::course};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn monotonic_now() -> f64;
}

#[wasm_bindgen]
pub fn execute_cpp_course(
    bytes: &[u8],
    build_id: &str,
    remaining_ms: u32,
) -> Result<Vec<u8>, JsValue> {
    let mut meter = Meter::new();
    meter.set_clock(
        u64::from(remaining_ms.min(1000)),
        Box::new(|| monotonic_now() as u64),
    );
    course::execute(bytes, build_id, &mut meter).map_err(JsValue::from_str)
}
