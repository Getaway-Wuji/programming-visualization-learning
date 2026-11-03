//! Closed C6 request/result boundary. Source and inputs remain transient.
use crate::{
    budget::{BudgetError, Meter},
    check, codec,
    runtime::Runtime,
    state::{Journal, Totals},
    syntax::{self, Fault},
    types::Val,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub const ENGINE_ID: &str = "engine.rust.c6";
pub const EXEC_VERSION: &str = "1.5.0";
pub const STEP_VERSION: &str = "1.4.0";
pub const DIAG_VERSION: &str = "1.4.0";
pub fn source_hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}
pub fn opaque(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        (1..=96).contains(&s.len())
            && s.bytes().next().unwrap().is_ascii_alphanumeric()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    })
}
pub fn common(request: &Value) -> Result<(), &'static str> {
    if request["execVersion"] != EXEC_VERSION
        || request["dslVersion"] != STEP_VERSION
        || request["diagnosticVersion"] != DIAG_VERSION
        || request["integerEncoding"] != "1.0.0"
        || request["language"] != "c"
        || request["engineId"] != ENGINE_ID
        || request["engineVersion"] != "0.1.0"
    {
        return Err("E_UNSUPPORTED_VERSION");
    }
    if !opaque(&request["runId"]) || !opaque(&request["sourceRevision"]) {
        return Err("E_PROTOCOL_INVALID");
    }
    let source = request["source"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    let source_sha = request["sourceSha256"]
        .as_str()
        .filter(|s| hash(s))
        .ok_or("E_PROTOCOL_INVALID")?;
    if source_hash(source) != source_sha {
        return Err("E_PROTOCOL_INVALID");
    }
    Ok(())
}
pub fn hash(v: &str) -> bool {
    v.len() == 64
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn codec_code(e: codec::CodecError) -> &'static str {
    match e {
        codec::CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
        codec::CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
        codec::CodecError::Budget(_) => "E_FUEL_LIMIT",
        codec::CodecError::Limit { .. } => "E_RESULT_LIMIT",
        _ => "E_PROTOCOL_INVALID",
    }
}
pub fn status(code: &str) -> &'static str {
    if code == "E_CANCELLED" {
        "cancelled"
    } else if matches!(
        code,
        "E_SOURCE_LIMIT"
            | "E_REQUEST_LIMIT"
            | "E_DEPTH_LIMIT"
            | "E_FUNCTION_LIMIT"
            | "E_PARAMETER_LIMIT"
            | "E_STRUCT_LIMIT"
            | "E_FIELD_LIMIT"
            | "E_STACK_LIMIT"
            | "E_OBJECT_LIMIT"
            | "E_OUTPUT_LIMIT"
            | "E_MEMORY_LIMIT"
            | "E_STEP_LIMIT"
            | "E_RESULT_LIMIT"
            | "E_FUEL_LIMIT"
            | "E_DEADLINE"
    ) {
        "limited"
    } else {
        "error"
    }
}
pub fn metadata(request: &Value, build_id: &str, checked: Option<&check::Checked>) -> Value {
    let (types, nodes) = if let Some(c) = checked {
        (json!(c.types.table.values().collect::<Vec<_>>()),json!(c.program.nodes.iter().enumerate().map(|(id,n)|json!({"nodeId":crate::state::nid(id),"kind":n.kind.tag(),"byteRange":n.range})).collect::<Vec<_>>()))
    } else {
        (json!([]), json!([]))
    };
    json!({"execVersion":EXEC_VERSION,"dslVersion":STEP_VERSION,"diagnosticVersion":DIAG_VERSION,"integerEncoding":"1.0.0","language":"c",
     "engine":{"id":ENGINE_ID,"version":"0.1.0","buildId":build_id},
     "identity":{"runId":request["runId"],"sourceRevision":request["sourceRevision"],"sourceSha256":request["sourceSha256"]},"types":types,"nodeMap":nodes})
}
pub struct Packet {
    pub metadata: BTreeMap<String, Vec<u8>>,
    pub journal: Option<Journal>,
    pub terminal: Value,
    pub fuel_used: usize,
}
pub enum Wire<'a> {
    Raw(&'a [u8]),
    Owned(Vec<u8>),
    Object(BTreeMap<String, Wire<'a>>),
    Array(Vec<Wire<'a>>),
    Trace(&'a Journal, bool),
}
impl Wire<'_> {
    pub fn length(&self) -> usize {
        match self {
            Self::Raw(v) => v.len(),
            Self::Owned(v) => v.len(),
            Self::Object(v) => {
                2 + v.len().saturating_sub(1)
                    + v.iter()
                        .map(|(k, v)| k.len() + 3 + v.length())
                        .sum::<usize>()
            }
            Self::Array(v) => {
                2 + v.len().saturating_sub(1) + v.iter().map(Self::length).sum::<usize>()
            }
            Self::Trace(j, c) => j.trace_length(*c),
        }
    }
    pub fn write(&self, out: &mut Vec<u8>) {
        match self {
            Self::Raw(v) => out.extend_from_slice(v),
            Self::Owned(v) => out.extend_from_slice(v),
            Self::Trace(j, c) => j.write_trace(out, *c),
            Self::Object(v) => {
                out.push(b'{');
                for (i, (k, v)) in v.iter().enumerate() {
                    if i > 0 {
                        out.push(b',')
                    }
                    out.push(b'"');
                    out.extend_from_slice(k.as_bytes());
                    out.extend_from_slice(b"\":");
                    v.write(out)
                }
                out.push(b'}')
            }
            Self::Array(v) => {
                out.push(b'[');
                for (i, v) in v.iter().enumerate() {
                    if i > 0 {
                        out.push(b',')
                    }
                    v.write(out)
                }
                out.push(b']')
            }
        }
    }
}
pub fn encoded<'a>(v: &Value, meter: &mut Meter) -> Result<Wire<'a>, &'static str> {
    Ok(Wire::Owned(
        codec::encode(v, meter, meter.limits().result_bytes).map_err(codec_code)?,
    ))
}
pub fn finish_wire(wire: &Wire<'_>, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    finish_wire_reserved(wire, meter, Vec::new())
}
pub fn finish_wire_reserved(
    wire: &Wire<'_>,
    meter: &mut Meter,
    mut bytes: Vec<u8>,
) -> Result<Vec<u8>, &'static str> {
    let length = wire.length();
    if length > meter.limits().result_bytes {
        return Err("E_RESULT_LIMIT");
    }
    meter
        .charge(length.div_ceil(64))
        .map_err(|e| codec_code(codec::CodecError::Budget(e)))?;
    bytes
        .try_reserve_exact(length)
        .map_err(|_| "E_ENCODING_FAILURE")?;
    wire.write(&mut bytes);
    assert_eq!(bytes.len(), length);
    meter
        .check_commit()
        .map_err(|e| codec_code(codec::CodecError::Budget(e)))?;
    Ok(bytes)
}
pub(crate) fn encode_metadata(
    v: &Value,
    meter: &mut Meter,
) -> Result<BTreeMap<String, Vec<u8>>, &'static str> {
    v.as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            Ok((
                k.clone(),
                codec::encode(v, meter, meter.limits().result_bytes).map_err(codec_code)?,
            ))
        })
        .collect()
}
pub fn metadata_bytes(v: &BTreeMap<String, Vec<u8>>) -> usize {
    v.iter().map(|(k, v)| k.len() + v.len() + 4).sum::<usize>() + 256
}
pub fn terminal(result: Result<Val, Fault>, cursor: usize) -> Value {
    match result {
        Ok(v) => {
            json!({"status":"completed","code":null,"byteRange":null,"cursor":cursor,"returnValue":v.wire()})
        }
        Err(e) => {
            json!({"status":status(e.code),"code":e.code,"byteRange":e.byte_range,"cursor":cursor,"returnValue":null})
        }
    }
}
impl Packet {
    pub(crate) fn wire(&self, meter: &mut Meter, fuel: usize) -> Result<Wire<'_>, &'static str> {
        let mut fields = self
            .metadata
            .iter()
            .map(|(k, v)| (k.clone(), Wire::Raw(v)))
            .collect::<BTreeMap<_, _>>();
        fields.insert("terminal".into(), encoded(&self.terminal, meter)?);
        fields.insert("stats".into(), encoded(&json!({"fuelUsed":fuel}), meter)?);
        fields.insert(
            "trace".into(),
            if let Some(j) = &self.journal {
                Wire::Trace(j, self.terminal["status"] == "completed")
            } else {
                Wire::Raw(b"null")
            },
        );
        Ok(Wire::Object(fields))
    }
}
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    if !hash(build_id) {
        return Err("E_PROTOCOL_INVALID");
    }
    let request = codec::decode(bytes, meter, meter.limits().request_bytes).map_err(|e| {
        if matches!(e, codec::CodecError::Limit { .. }) {
            "E_REQUEST_LIMIT"
        } else {
            codec_code(e)
        }
    })?;
    if request.get("editVersion").is_some() {
        return crate::edit::execute(&request, build_id, meter);
    }
    if request.get("judgeVersion").is_some() {
        return crate::judge::execute(&request, build_id, meter);
    }
    if !exact(
        &request,
        &[
            "execVersion",
            "dslVersion",
            "diagnosticVersion",
            "integerEncoding",
            "language",
            "engineId",
            "engineVersion",
            "runId",
            "sourceRevision",
            "sourceSha256",
            "source",
            "input",
        ],
    ) {
        return Err("E_PROTOCOL_INVALID");
    }
    common(&request)?;
    let source = request["source"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    let input = &request["input"];
    if !exact(input, &["kind", "text"]) || input["kind"] != "stdin-ascii" {
        return Err("E_INPUT_KIND");
    }
    let input = input["text"]
        .as_str()
        .filter(|s| {
            s.len() <= 256
                && s.bytes()
                    .all(|b| (32..=126).contains(&b) || b"\t\n\r".contains(&b))
        })
        .ok_or("E_INPUT_INVALID")?;
    let checked = syntax::parse(source, meter).and_then(|p| check::check(p, meter));

    let packet = match checked {
        Ok(checked) => {
            let encoded = encode_metadata(&metadata(&request, build_id, Some(&checked)), meter)?;
            let mut totals = Totals::default();
            let mut runtime = Runtime::new(
                &checked,
                input.as_bytes(),
                BTreeSet::new(),
                metadata_bytes(&encoded),
                &mut totals,
                meter,
            )
            .map_err(|e| e.code)?;
            let result = runtime.run().map(|v| v.value);
            let cursor = runtime.journal.steps.len();
            let terminal = terminal(result, cursor);
            let journal = runtime.journal;
            let used = meter.used();
            Packet {
                metadata: encoded,
                journal: Some(journal),
                terminal,
                fuel_used: used,
            }
        }
        Err(error) => {
            let encoded = encode_metadata(&metadata(&request, build_id, None), meter)?;
            Packet {
                metadata: encoded,
                journal: None,
                terminal: terminal(Err(error), 0),
                fuel_used: meter.used(),
            }
        }
    };
    meter
        .begin_finalization()
        .map_err(|e| codec_code(codec::CodecError::Budget(e)))?;
    let mut wire = packet.wire(meter, packet.fuel_used)?;
    // Encoding stats itself costs one byte-block; reserve it before recording the final fuel count.
    meter
        .charge(1)
        .map_err(|e| codec_code(codec::CodecError::Budget(e)))?;
    let base = meter.used();
    let mut previous = usize::MAX;
    for _ in 0..4 {
        let fuel = base + wire.length().div_ceil(64);
        if fuel == previous {
            break;
        }
        previous = fuel;
        let Wire::Object(fields) = &mut wire else {
            unreachable!()
        };
        fields.insert(
            "stats".into(),
            Wire::Owned(format!("{{\"fuelUsed\":{fuel}}}").into_bytes()),
        );
    }
    finish_wire(&wire, meter)
}
