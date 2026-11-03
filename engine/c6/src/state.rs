//! Transactional reversible Step1.4 journal, with one aggregate quota across judge cases.
use crate::{
    budget::Meter,
    codec,
    source::ByteRange,
    syntax::{self, Fault, Id},
    types::{Types, Val},
};
use serde_json::{Value, json};

pub fn nid(id: Id) -> String {
    format!("n{}", id + 1)
}
pub fn initial(main: Id) -> Value {
    json!({"frames":[],"scopes":[],"objects":[],"control":{"activeFrameId":null,"nextNodeId":nid(main),"returnValue":null,"inputCursor":0},
     "allocator":{"nextAddress":4096,"liveBytes":0,"nextObject":1,"nextScope":1,"nextFrame":1},"output":"",
     "counters":{"comparisons":0,"scalarWrites":0,"arrayWrites":0,"swaps":0}})
}
#[derive(Clone, Debug, Default)]
pub struct Totals {
    pub steps: usize,
    pub objects: usize,
    pub output_bytes: usize,
    pub result_bytes: usize,
}
pub struct Journal {
    pub state: Value,
    pub initial: Vec<u8>,
    pub steps: Vec<Vec<u8>>,
    pub checkpoints: Vec<Vec<u8>>,
    pub bytes: usize,
}
pub struct Emission<'a> {
    pub types: &'a Types,
    pub totals: &'a mut Totals,
    pub meter: &'a mut Meter,
    pub range: ByteRange,
}
pub fn codec_error(e: codec::CodecError, r: ByteRange) -> Fault {
    match e {
        codec::CodecError::Budget(e) => syntax::fault(
            match e {
                crate::budget::BudgetError::Cancelled => "E_CANCELLED",
                crate::budget::BudgetError::Deadline { .. } => "E_DEADLINE",
                _ => "E_FUEL_LIMIT",
            },
            r,
        ),
        codec::CodecError::Limit { .. } => syntax::fault("E_RESULT_LIMIT", r),
        _ => syntax::fault("E_ENCODING_FAILURE", r),
    }
}
pub fn cell_default(object: &Value, offset: usize, types: &Types) -> Result<Value, &'static str> {
    let ty = types
        .resolved
        .get(object["typeName"].as_str().ok_or("E_TYPE_INVALID")?)
        .ok_or("E_TYPE_INVALID")?;
    let slot = types.slot(ty, offset).ok_or("E_TYPE_INVALID")?;
    if object["zeroInitialized"] == true {
        Ok(Val::zero(&slot)?.wire())
    } else {
        Ok(Value::Null)
    }
}
pub fn cell(object: &Value, offset: usize, types: &Types) -> Result<Value, &'static str> {
    let cells = object["cells"].as_array().ok_or("E_PROTOCOL_INVALID")?;
    match cells.binary_search_by_key(&offset, |c| {
        c["byteOffset"].as_u64().unwrap_or(u64::MAX) as usize
    }) {
        Ok(i) => Ok(cells[i]["value"].clone()),
        Err(_) => cell_default(object, offset, types),
    }
}
fn set_cell(
    object: &mut Value,
    offset: usize,
    value: Value,
    types: &Types,
) -> Result<(), &'static str> {
    let default = cell_default(object, offset, types)?;
    let cells = object["cells"].as_array_mut().ok_or("E_PROTOCOL_INVALID")?;
    match cells.binary_search_by_key(&offset, |c| {
        c["byteOffset"].as_u64().unwrap_or(u64::MAX) as usize
    }) {
        Ok(i) => {
            if value == default {
                cells.remove(i);
            } else {
                cells[i]["value"] = value
            }
        }
        Err(i) => {
            if value != default {
                cells.insert(i, json!({"byteOffset":offset,"value":value}));
            }
        }
    }
    Ok(())
}
pub fn apply(
    state: &mut Value,
    changes: &[Value],
    types: &Types,
    reverse: bool,
) -> Result<(), &'static str> {
    let indices: Box<dyn Iterator<Item = usize>> = if reverse {
        Box::new((0..changes.len()).rev())
    } else {
        Box::new(0..changes.len())
    };
    let mut applied = vec![];
    for index in indices {
        if let Err(code) = apply_one(state, &changes[index], types, reverse) {
            for &index in applied.iter().rev() {
                apply_one(state, &changes[index], types, !reverse)
                    .expect("restore validated prefix");
            }
            return Err(code);
        }
        applied.push(index);
    }
    Ok(())
}
fn apply_one(
    state: &mut Value,
    c: &Value,
    types: &Types,
    reverse: bool,
) -> Result<(), &'static str> {
    let (before, after) = if reverse {
        (&c["after"], &c["before"])
    } else {
        (&c["before"], &c["after"])
    };
    match c["op"].as_str() {
        Some("record") => {
            let table = c["table"]
                .as_str()
                .filter(|s| ["frames", "scopes", "objects"].contains(s))
                .ok_or("E_PROTOCOL_INVALID")?;
            let at = c["index"].as_u64().ok_or("E_PROTOCOL_INVALID")? as usize;
            let list = state[table].as_array_mut().ok_or("E_PROTOCOL_INVALID")?;
            if before.is_null() {
                if at > list.len() || after.is_null() || after["id"] != c["id"] {
                    return Err("E_PROTOCOL_INVALID");
                }
                list.insert(at, after.clone());
            } else {
                if list.get(at) != Some(before) || before["id"] != c["id"] {
                    return Err("E_PROTOCOL_INVALID");
                }
                if after.is_null() {
                    list.remove(at);
                } else {
                    if after["id"] != c["id"] {
                        return Err("E_PROTOCOL_INVALID");
                    }
                    list[at] = after.clone();
                }
            }
        }
        Some("cell") => {
            let object = c["objectId"].as_str().ok_or("E_PROTOCOL_INVALID")?;
            let at = object
                .strip_prefix('o')
                .and_then(|n| n.parse::<usize>().ok())
                .and_then(|n| n.checked_sub(1))
                .ok_or("E_PROTOCOL_INVALID")?;
            let offset = c["byteOffset"].as_u64().ok_or("E_PROTOCOL_INVALID")? as usize;
            let o = state["objects"]
                .as_array_mut()
                .and_then(|a| a.get_mut(at))
                .ok_or("E_PROTOCOL_INVALID")?;
            if o["id"] != object || cell(o, offset, types)? != *before {
                return Err("E_PROTOCOL_INVALID");
            }
            set_cell(o, offset, after.clone(), types)?;
        }
        Some(op @ ("control" | "allocator" | "counters")) => {
            if state[op] != *before {
                return Err("E_PROTOCOL_INVALID");
            }
            state[op] = after.clone();
        }
        Some("output") => {
            let text = state["output"].as_str().ok_or("E_PROTOCOL_INVALID")?;
            let append = c["append"].as_str().ok_or("E_PROTOCOL_INVALID")?;
            let before = c["beforeBytes"].as_u64().ok_or("E_PROTOCOL_INVALID")? as usize;
            let after = c["afterBytes"].as_u64().ok_or("E_PROTOCOL_INVALID")? as usize;
            if after.checked_sub(before) != Some(append.len()) {
                return Err("E_PROTOCOL_INVALID");
            }
            state["output"] = if reverse {
                if text.len() != after || !text.ends_with(append) {
                    return Err("E_PROTOCOL_INVALID");
                }
                json!(text.get(..before).ok_or("E_PROTOCOL_INVALID")?)
            } else {
                if text.len() != before {
                    return Err("E_PROTOCOL_INVALID");
                }
                json!(format!("{text}{append}"))
            };
        }
        _ => return Err("E_PROTOCOL_INVALID"),
    }
    Ok(())
}
pub fn record(table: &str, index: usize, before: Value, after: Value) -> Value {
    let id = if before.is_null() {
        after["id"].clone()
    } else {
        before["id"].clone()
    };
    json!({"op":"record","table":table,"id":id,"index":index,"before":before,"after":after})
}
pub fn singleton(state: &Value, name: &str, after: Value) -> Value {
    json!({"op":name,"before":state[name],"after":after})
}
impl Journal {
    pub fn new(
        main: Id,
        metadata_bytes: usize,
        types: &Types,
        totals: &mut Totals,
        meter: &mut Meter,
        r: ByteRange,
    ) -> Result<Self, Fault> {
        let state = initial(main);
        let limit = meter.limits().result_bytes;
        let initial = codec::encode(&state, meter, limit).map_err(|e| codec_error(e, r))?;
        let point = codec::encode(&json!({"cursor":0,"state":state}), meter, limit)
            .map_err(|e| codec_error(e, r))?;
        let bytes = metadata_bytes + initial.len() + point.len() + 4096;
        if totals.result_bytes + bytes + 65536 > limit {
            return Err(syntax::fault("E_RESULT_LIMIT", r));
        }
        meter
            .reserve_result(totals.result_bytes + bytes + 65536)
            .map_err(|e| codec_error(codec::CodecError::Budget(e), r))?;
        totals.result_bytes += bytes;
        let _ = types;
        Ok(Self {
            state,
            initial,
            steps: vec![],
            checkpoints: vec![point],
            bytes,
        })
    }
    pub fn emit(
        &mut self,
        node: Id,
        kind: &str,
        mut changes: Vec<Value>,
        context: Emission<'_>,
    ) -> Result<usize, Fault> {
        let Emission {
            types,
            totals,
            meter,
            range: r,
        } = context;
        if totals.steps >= meter.limits().steps {
            return Err(syntax::fault("E_STEP_LIMIT", r));
        }
        meter
            .check_commit()
            .map_err(|e| codec_error(codec::CodecError::Budget(e), r))?;
        let created = changes
            .iter()
            .filter(|c| {
                c["op"] == "record"
                    && c["table"] == "objects"
                    && c["before"].is_null()
                    && !c["after"].is_null()
            })
            .count();
        if totals.objects + created > 4096 {
            return Err(syntax::fault("E_OBJECT_LIMIT", r));
        }
        let appended = changes
            .iter()
            .filter(|c| c["op"] == "output")
            .map(|c| c["append"].as_str().map_or(0, str::len))
            .sum::<usize>();
        if totals.output_bytes + appended > meter.limits().output_bytes {
            return Err(syntax::fault("E_OUTPUT_LIMIT", r));
        }
        if let Some(control) = changes.iter_mut().find(|c| c["op"] == "control") {
            if kind != "program.return" {
                control["after"]["nextNodeId"] = json!(nid(node));
            }
        } else {
            let mut after = self.state["control"].clone();
            after["nextNodeId"] = json!(nid(node));
            if after != self.state["control"] {
                changes.push(singleton(&self.state, "control", after));
            }
        }
        let seq = self.steps.len() + 1;
        let step = json!({"seq":seq,"kind":kind,"nodeId":nid(node),"changes":changes});
        let encoded = codec::encode(&step, meter, meter.limits().result_bytes)
            .map_err(|e| codec_error(e, r))?;
        let prospective = totals.result_bytes + encoded.len() + 2;
        if prospective + 65536 > meter.limits().result_bytes {
            return Err(syntax::fault("E_RESULT_LIMIT", r));
        }
        apply(&mut self.state, &changes, types, false).map_err(|c| syntax::fault(c, r))?;
        let point = if seq.is_multiple_of(128) {
            match codec::encode(
                &json!({"cursor":seq,"state":self.state}),
                meter,
                meter.limits().result_bytes,
            ) {
                Ok(v) => Some(v),
                Err(e) => {
                    apply(&mut self.state, &changes, types, true).expect("journal rollback");
                    return Err(codec_error(e, r));
                }
            }
        } else {
            None
        };
        let extra = encoded.len() + 2 + point.as_ref().map_or(0, |v| v.len() + 2);
        if totals.result_bytes + extra + 65536 > meter.limits().result_bytes {
            apply(&mut self.state, &changes, types, true).expect("journal rollback");
            return Err(syntax::fault("E_RESULT_LIMIT", r));
        }
        if let Err(e) = meter.reserve_result(totals.result_bytes + extra + 65536) {
            apply(&mut self.state, &changes, types, true).expect("journal rollback");
            return Err(codec_error(codec::CodecError::Budget(e), r));
        }
        self.steps.push(encoded);
        if let Some(p) = point {
            self.checkpoints.push(p)
        }
        self.bytes += extra;
        totals.result_bytes += extra;
        totals.objects += created;
        totals.steps += 1;
        totals.output_bytes += appended;
        Ok(seq)
    }
    pub fn trace_bytes(&self, complete: bool) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.bytes);
        self.write_trace(&mut out, complete);
        out
    }
    pub fn trace_length(&self, complete: bool) -> usize {
        let fixed = if complete {
            b"{\"checkpoints\":[],\"completeness\":\"complete\",\"dslVersion\":\"1.4.0\",\"initialState\":,\"steps\":[]}".len()
        } else {
            b"{\"checkpoints\":[],\"completeness\":\"prefix\",\"dslVersion\":\"1.4.0\",\"initialState\":,\"steps\":[]}".len()
        };
        fixed
            + self.initial.len()
            + self.steps.iter().map(Vec::len).sum::<usize>()
            + self.steps.len().saturating_sub(1)
            + self.checkpoints.iter().map(Vec::len).sum::<usize>()
            + self.checkpoints.len().saturating_sub(1)
    }
    pub fn write_trace(&self, out: &mut Vec<u8>, complete: bool) {
        out.extend_from_slice(b"{\"checkpoints\":[");
        join(out, &self.checkpoints);
        out.extend_from_slice(if complete {
            b"],\"completeness\":\"complete\",\"dslVersion\":\"1.4.0\",\"initialState\":"
        } else {
            b"],\"completeness\":\"prefix\",\"dslVersion\":\"1.4.0\",\"initialState\":"
        });
        out.extend_from_slice(&self.initial);
        out.extend_from_slice(b",\"steps\":[");
        join(out, &self.steps);
        out.extend_from_slice(b"]}");
    }
}
fn join(out: &mut Vec<u8>, a: &[Vec<u8>]) {
    for (i, v) in a.iter().enumerate() {
        if i > 0 {
            out.push(b',')
        }
        out.extend_from_slice(v)
    }
}
