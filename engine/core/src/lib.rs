//! Rust engineering probe, P0-C checking and internal int/array execution.
//!
//! The probe accepts no program or learning data and produces no execution
//! result or Step DSL. `run` provides the bounded, metered core pipeline and
//! real reversible traces; browser EXEC identities/lifecycle remain separate.

pub mod ast;
pub mod budget;
pub mod codec;
pub mod diagnostic;
pub mod edit_analysis;
pub mod exec;
pub mod format;
pub mod input;
pub mod integer;
mod judge;
pub mod lexer;
pub mod parser;
pub mod run;
pub mod runtime;
pub mod runtime_state;
mod runtime_trace;
pub mod semantic;
pub mod source;
pub mod trace;
mod trace_wire;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildProbe {
    kind: &'static str,
    probe_version: &'static str,
    nonce: u32,
    engine_version: &'static str,
    interpreter_ready: bool,
}

/// Serialize build metadata and the caller's non-user-data probe token.
///
/// This is an engineering diagnostic, not an EXEC-01 result. The explicit
/// `interpreterReady: false` prevents a successful WASM call from implying
/// that program execution has been implemented.
pub fn build_probe(nonce: u32) -> Result<String, serde_json::Error> {
    serde_json::to_string(&BuildProbe {
        kind: "build-probe",
        probe_version: "1.0.0",
        nonce,
        engine_version: env!("CARGO_PKG_VERSION"),
        interpreter_ready: false,
    })
}

#[cfg(test)]
mod tests {
    use super::build_probe;
    use serde_json::{Value, json};

    #[test]
    fn probe_is_explicit_build_metadata_without_execution_or_learning_fields() {
        let value: Value = serde_json::from_str(&build_probe(17).unwrap()).unwrap();

        assert_eq!(
            value,
            json!({
                "kind": "build-probe",
                "probeVersion": "1.0.0",
                "nonce": 17,
                "engineVersion": "0.1.0",
                "interpreterReady": false
            })
        );
    }

    #[test]
    fn probe_preserves_unsigned_token_boundaries_as_json_integers() {
        for nonce in [0, u32::MAX] {
            let value: Value = serde_json::from_str(&build_probe(nonce).unwrap()).unwrap();

            assert_eq!(value["nonce"].as_u64(), Some(u64::from(nonce)));
            assert_eq!(value["interpreterReady"], false);
        }
    }
}
