//! Thin WASM boundary. Execution only accepts a bounded EXEC-01 request and
//! an independently selected trusted static catalog from its controlled Worker.

use c_viz_core::budget::{TIMING_VECTOR_LEN, TimingPhase};
use std::cell::Cell;
use wasm_bindgen::prelude::*;

thread_local! {
    // Fixed numeric technical metadata only. Each execute replaces the prior
    // observation; no user source, input, output, identity or trace is stored.
    static LAST_EXECUTION_TIMINGS: Cell<[f64; TIMING_VECTOR_LEN]> = const {
        Cell::new([0.0; TIMING_VECTOR_LEN])
    };
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn monotonic_now() -> f64;
}

fn meter(remaining_ms: u32) -> c_viz_core::budget::Meter {
    let mut meter = c_viz_core::budget::Meter::new();
    meter.set_clock(
        u64::from(remaining_ms.min(1000)),
        Box::new(|| monotonic_now() as u64),
    );
    meter
}

/// Return canonical bytes containing the complete example source and real
/// declaration binding ranges. This preparatory call produces no run result.
#[wasm_bindgen]
pub fn prepare_case(catalog_json: &str) -> Result<Vec<u8>, JsValue> {
    let mut meter = meter(1000);
    let catalog = c_viz_core::exec::parse_catalog(catalog_json, &mut meter)
        .map_err(|e| JsValue::from_str(e.0))?;
    c_viz_core::exec::prepare_case(&catalog, &mut meter).map_err(|e| JsValue::from_str(e.0))
}

/// Explicit input uses a separate bounded canonical buffer, never a changed
/// example template or hidden execution input.
#[wasm_bindgen]
pub fn prepare_input(
    catalog_json: &str,
    values_bytes: &[u8],
    remaining_ms: u32,
) -> Result<Vec<u8>, JsValue> {
    let mut meter = meter(remaining_ms);
    let catalog = c_viz_core::exec::parse_catalog(catalog_json, &mut meter)
        .map_err(|e| JsValue::from_str(e.0))?;
    c_viz_core::exec::prepare_input_bytes(&catalog, values_bytes, &mut meter)
        .map_err(|e| JsValue::from_str(e.0))
}

/// Independently checked, bounded editing projection; never executes C or
/// issues a learning fact. The caller's remaining deadline can only shorten.
#[wasm_bindgen]
pub fn analyze_code_draft(
    request_json: &str,
    catalog_json: &str,
    remaining_ms: u32,
) -> Result<Vec<u8>, JsValue> {
    let mut meter = meter(remaining_ms);
    c_viz_core::edit_analysis::analyze_code_draft(request_json, catalog_json, &mut meter)
        .map_err(|error| JsValue::from_str(error.0))
}

/// The inherited remaining time includes module loading in this Worker;
/// parsing the request may only shorten it and never renews the deadline.
#[wasm_bindgen]
pub fn execute_request(
    bytes: &[u8],
    catalog_json: &str,
    build_id: &str,
    remaining_ms: u32,
) -> Result<Vec<u8>, JsValue> {
    LAST_EXECUTION_TIMINGS.with(|slot| slot.set([0.0; TIMING_VECTOR_LEN]));
    let mut meter = meter(remaining_ms);
    meter.set_observer_clock(Box::new(|| monotonic_now() * 1000.0));
    // The inclusive total starts at the Rust catalog parsing boundary and
    // ends after all canonical Assembly and retained Trace-model destruction.
    // Worker-side whole-call timing additionally covers bindgen input/output
    // copies, meter setup and this bounded metric snapshot.
    let result = meter.measure(TimingPhase::RustTotal, |meter| {
        let catalog = meter.measure(TimingPhase::CatalogDecode, |meter| {
            c_viz_core::exec::parse_catalog(catalog_json, meter)
        })?;
        c_viz_core::exec::execute_request(bytes, &catalog, build_id, meter)
    });
    LAST_EXECUTION_TIMINGS.with(|slot| slot.set(meter.timing_vector()));
    result.map_err(|e| JsValue::from_str(e.0))
}

/// Readonly, bounded technical data from the last execute call. Version and
/// phase/call-count layout are defined by budget::TIMING_VECTOR_LEN. This is a
/// private Worker observation, never a field in canonical EXEC-01 bytes.
#[wasm_bindgen]
pub fn last_execution_timings() -> Vec<f64> {
    LAST_EXECUTION_TIMINGS.with(|slot| slot.get().to_vec())
}

/// Call the real Rust core and return its build-probe JSON to JavaScript.
#[wasm_bindgen]
pub fn build_probe(nonce: u32) -> Result<String, JsValue> {
    c_viz_core::build_probe(nonce)
        .map_err(|error| JsValue::from_str(&format!("Build probe serialization failed: {error}")))
}
