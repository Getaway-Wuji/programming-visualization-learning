//! Fixed-profile JUDGE2. Four fresh C states share one meter/deadline and total quotas.
use crate::{
    api::{self, Packet, Wire},
    budget::Meter,
    check, codec,
    runtime::{Proof, Runtime, UserWrite},
    state::{self, Totals},
    syntax::{self, Kind},
    types::{Ty, Val},
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
const CATALOG: &str = include_str!("../resources/judges-1.0.0.json");
pub fn profile(reference: &Value, meter: &mut Meter) -> Result<Value, &'static str> {
    if !api::exact(reference, &["id", "version"]) || reference["version"] != "1.0.0" {
        return Err("E_PROTOCOL_INVALID");
    }
    meter
        .charge(CATALOG.len().div_ceil(64))
        .map_err(|e| api::codec_code(codec::CodecError::Budget(e)))?;
    let catalog: Value = serde_json::from_str(CATALOG).map_err(|_| "E_PROTOCOL_INVALID")?;
    catalog["profiles"]
        .as_array()
        .filter(|p| p.len() == 44)
        .and_then(|p| p.iter().find(|p| p["ref"] == *reference))
        .cloned()
        .ok_or("E_PROTOCOL_INVALID")
}
fn tagged<'a>(r: &'a Runtime<'_, '_>, tag: &str) -> Vec<&'a Proof> {
    r.output_deps.values().filter(|p| p.tag == tag).collect()
}
fn input(deps: &crate::runtime::Deps) -> bool {
    deps.values().any(|p| p.tag == "input.source")
}
fn write_for_proof<'a>(r: &'a Runtime<'_, '_>, p: &Proof) -> Option<&'a UserWrite> {
    r.user_writes.iter().find(|w| {
        w.seq == p.seq
            && state::nid(w.node) == p.node_id
            && p.object_ids
                .iter()
                .any(|id| *id == format!("o{}", w.object + 1))
            && w.after == p.value
    })
}
fn observation_cost(r: &Runtime<'_, '_>, profile: &Value) -> usize {
    let proofs = r.output_deps.len();
    let writes = r.user_writes.len();
    let mut cost = 256usize
        .saturating_add(proofs.saturating_mul(12))
        .saturating_add(r.accesses.len().saturating_mul(4));
    if profile["family"] == "pointer-swap" {
        let n = tagged(r, "pointer.write-contribution").len();
        cost = cost.saturating_add(
            n.saturating_mul(n)
                .saturating_mul(writes + 1)
                .saturating_mul(8),
        );
    }
    if profile["family"] == "scope" {
        let n = tagged(r, "scope.lifetime").len();
        cost = cost.saturating_add(n.saturating_mul(n).saturating_mul(16));
    }
    if profile["family"] == "static-counter" {
        cost = cost.saturating_add(
            tagged(r, "storage.static-local")
                .len()
                .saturating_mul(r.checked.program.functions.len())
                .saturating_mul(r.calls.len().saturating_add(writes.saturating_mul(4)))
                .saturating_mul(8),
        );
    }
    cost.saturating_add(writes.saturating_mul(proofs + 1).saturating_mul(4))
}
fn proof(tag: &str, node: usize, seq: usize, value: Val) -> Proof {
    Proof {
        tag: tag.into(),
        node_id: state::nid(node),
        seq,
        object_ids: vec![],
        value: value.wire(),
    }
}
fn guard(r: &Runtime<'_, '_>, profile: &Value, case: &Value) -> Option<Vec<Proof>> {
    let rule = case["observationRule"].as_str()?;
    if rule == "actual-target-and-output-contribution" {
        return None;
    }
    let branch = r.branches.iter().rev().find(|b| input(&b.deps));
    if rule.starts_with("actual-getchar-EOF") {
        let io =
            r.io.iter()
                .find(|io| io.name == "getchar" && io.result == Val::I(-1))?;
        return Some(vec![proof("guard.eof", io.node, io.seq, io.result.clone())]);
    }
    if rule.starts_with("actual-scanf-return") {
        let io = r.io.iter().find(|io| {
            io.name == "scanf"
                && matches!(io.result, Val::I(0) | Val::I(-1))
                && io.written.is_empty()
        })?;
        if !input(&r.output_deps) || tagged(r, "library.scanf-return").is_empty() {
            return None;
        }
        return Some(vec![proof(
            "guard.scan-failure",
            io.node,
            io.seq,
            io.result.clone(),
        )]);
    }
    let branch = branch?;
    if rule.starts_with("actual-invalid-index") {
        let values = case["stdin"]
            .as_str()?
            .split_whitespace()
            .take(2)
            .map(str::parse::<i64>)
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        if values.len() != 2 {
            return None;
        }
        let index = values[1];
        let forbidden = r
            .accesses
            .iter()
            .filter(|a| {
                !a.initialization
                    && matches!(r.objects[a.object].ty.bare(),Ty::Array(t,_)if t.bare()==&Ty::Int)
                    && index >= 0
                    && a.offset == index as usize * 4
            })
            .count();
        if forbidden > 0 {
            return None;
        }
        return Some(vec![proof(
            "guard.invalid-index",
            branch.node,
            branch.seq,
            Val::I(0),
        )]);
    }
    if rule.starts_with("actual-base-case") {
        if r.recursion_entries != 0
            || r.call_counts
                .iter()
                .filter(|(name, _)| name.as_str() != "main")
                .map(|(_, n)| n)
                .sum::<usize>()
                == 0
        {
            return None;
        }
        return Some(vec![proof(
            "guard.recursion-base",
            branch.node,
            branch.seq,
            Val::I(0),
        )]);
    }
    if rule.starts_with("actual-zero-guard") {
        if profile["family"] == "array-sum"
            && r.accesses.iter().any(|a| {
                !a.initialization
                    && !a.write
                    && matches!(r.objects[a.object].ty.bare(),Ty::Array(t,_)if t.bare()==&Ty::Int)
            })
        {
            return None;
        }
        if profile["family"] == "static-counter" {
            let functions = r
                .checked
                .program
                .functions
                .iter()
                .filter(|f| {
                    r.checked.program.nodes.iter().any(|n| {
                        matches!(&n.kind,Kind::Declare(d)if d.static_storage&&!d.global)
                            && n.range.start >= r.checked.program.nodes[f.body].range.start
                            && n.range.end <= r.checked.program.nodes[f.body].range.end
                    })
                })
                .collect::<Vec<_>>();
            if functions.is_empty()
                || functions
                    .iter()
                    .any(|f| r.call_counts.get(&f.name).copied().unwrap_or(0) != 0)
            {
                return None;
            }
        }
        return Some(vec![proof(
            "guard.zero",
            branch.node,
            branch.seq,
            Val::I(0),
        )]);
    }
    None
}
fn normal_targets(r: &Runtime<'_, '_>, profile: &Value, case: &Value) -> bool {
    if !profile["semanticTargets"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| !tagged(r, t.as_str().unwrap()).is_empty())
    {
        return false;
    }
    let eof_attempt = case["stdin"] == ""
        && r.io.iter().any(|e| {
            e.before == e.after
                && (e.result == Val::I(-1) || matches!(&e.result,Val::P(p)if p.object_id.is_none()))
        });
    if !input(&r.output_deps) && !eof_attempt {
        return false;
    }
    let targets = profile["semanticTargets"].as_array().unwrap();
    if profile["family"] == "sizeof" {
        let selector = case["stdin"].as_str().unwrap().parse::<usize>().unwrap();
        if !tagged(r, "type.sizeof").iter().any(|p| {
            let Some(id) = p
                .node_id
                .strip_prefix('n')
                .and_then(|n| n.parse::<usize>().ok())
                .and_then(|n| n.checked_sub(1))
            else {
                return false;
            };
            let ty = match &r.checked.program.nodes[id].kind {
                Kind::Expression(crate::syntax::Expr::SizeType(t)) => Some(t),
                Kind::Expression(crate::syntax::Expr::SizeExpr(a)) => {
                    r.checked.expr_types[*a].as_ref()
                }
                _ => None,
            };
            let Some(ty) = ty else { return false };
            let expected = match selector {
                0 => ty.bare() == &Ty::Char,
                1 => ty.bare() == &Ty::Int,
                2 => ty.bare() == &Ty::F64,
                3 => matches!(ty.bare(),Ty::Pointer(t)if t.bare()==&Ty::Int),
                _ => false,
            };
            expected
                && (!targets.iter().any(|t| t == "type.typedef")
                    || tagged(r, "type.typedef")
                        .iter()
                        .any(|a| a.node_id == p.node_id))
        }) {
            return false;
        }
    }
    if targets.iter().any(|t| t == "loop.contribution")
        && !tagged(r, "loop.contribution").iter().any(|p| {
            r.branches
                .iter()
                .any(|b| b.truth && state::nid(b.node) == p.node_id)
        })
    {
        return false;
    }
    if profile["family"] == "loop-sum" {
        let n = case["stdin"].as_str().unwrap().parse::<i64>().unwrap();
        let sum = n * (n + 1) / 2;
        let k = profile["parameterK"].as_i64().unwrap();
        let loops = tagged(r, "loop.contribution");
        if !tagged(r, "goal.write")
            .iter()
            .filter_map(|p| write_for_proof(r, p))
            .any(|last| {
                loops.iter().any(|l| {
                    let events = r
                        .user_writes
                        .iter()
                        .filter(|w| {
                            w.object == last.object
                                && w.offset == last.offset
                                && w.seq <= last.seq
                                && w.loop_node.as_ref() == Some(&l.node_id)
                                && w.before != w.after
                        })
                        .collect::<Vec<_>>();
                    !events.is_empty()
                        && events.len() <= n as usize
                        && events.first().is_some_and(|w| w.before == json!(0))
                        && events
                            .last()
                            .is_some_and(|w| w.after == json!(sum) || w.after == json!(sum * k))
                })
            })
        {
            return false;
        }
    }
    if profile["family"] == "function-affine" || profile["family"] == "recursion-sum" {
        let Some(expected) = case["expectedStdout"]
            .as_str()
            .and_then(|s| s.trim().parse::<i32>().ok())
        else {
            return false;
        };
        let Some(argument) = case["stdin"].as_str().and_then(|s| s.parse::<i32>().ok()) else {
            return false;
        };
        let k = profile["parameterK"].as_i64().unwrap() as i32;
        let recursive = profile["family"] == "recursion-sum";
        if !r.calls.iter().any(|c| {
            !c.recursive
                && c.arguments.first() == Some(&Val::I(argument))
                && (c.result.value == Val::I(expected)
                    || recursive && c.result.value == Val::I(expected / k))
                && input(&c.result.deps)
                && c.result
                    .deps
                    .values()
                    .any(|p| p.tag == "function.parameter")
                && (!recursive
                    || c.result
                        .deps
                        .values()
                        .any(|p| p.tag == "function.recursion"))
                && tagged(r, "call.contribution")
                    .iter()
                    .any(|p| p.node_id == state::nid(c.node) && p.seq == c.entry_seq)
        }) {
            return false;
        }
    }
    if profile["family"]=="cast-trunc" && !tagged(r,"operator.cast").iter().any(|p|{
        let id=p.node_id.strip_prefix('n').and_then(|n|n.parse::<usize>().ok()).map(|n|n-1);
        id.is_some_and(|id|matches!(&r.checked.program.nodes[id].kind,Kind::Expression(crate::syntax::Expr::Cast(t,a))if t.bare()==&Ty::Int && matches!(r.checked.expr_types[*a].as_ref().map(Ty::bare),Some(Ty::F32|Ty::F64))))
    }){return false}
    if targets.iter().any(|t| t == "type.f32-f64") {
        let p = tagged(r, "type.f32-f64");
        if !p.iter().any(|p| p.value["kind"] == "f32")
            || !p.iter().any(|p| p.value["kind"] == "f64")
        {
            return false;
        }
    }
    if targets.iter().any(|t| t == "value.variable-constant")
        && (!r
            .output_deps
            .keys()
            .any(|k| k == "value.variable-constant:constant")
            || !r
                .output_deps
                .keys()
                .any(|k| k == "value.variable-constant:variable"))
    {
        return false;
    }
    if profile["family"] == "pointer-swap" {
        let written = tagged(r, "pointer.write-contribution");
        let objects = written
            .iter()
            .flat_map(|p| &p.object_ids)
            .collect::<BTreeSet<_>>();
        if written.len() < 2 || profile["ref"]["id"] != "judge.c6.s10.5" && objects.len() < 2 {
            return false;
        }
        let candidates = written
            .iter()
            .filter_map(|p| write_for_proof(r, p))
            .filter(|w| w.pointer)
            .collect::<Vec<_>>();
        let input_values = case["stdin"]
            .as_str()
            .unwrap()
            .split_whitespace()
            .map(|s| s.parse::<i32>().unwrap())
            .collect::<Vec<_>>();
        if !candidates.iter().any(|a|candidates.iter().any(|b|{
            if (a.object,a.offset)==(b.object,b.offset){return false}
            let domain=if profile["ref"]["id"]=="judge.c6.s10.5"{a.object==b.object&&matches!(r.objects[a.object].ty.bare(),Ty::Array(t,2)if t.bare()==&Ty::Int)}else{a.object!=b.object&&r.objects[a.object].ty.scalar()&&r.objects[b.object].ty.scalar()};
            let parameter=profile["ref"]["id"]!="judge.c6.s9.7.3"||(a.frame_id.as_deref()!=r.journal.state["objects"][a.object]["frameId"].as_str()&&b.frame_id.as_deref()!=r.journal.state["objects"][b.object]["frameId"].as_str());
            let values=(a.after==json!(input_values[0])&&b.after==json!(input_values[1]))||(a.after==json!(input_values[1])&&b.after==json!(input_values[0]));
            domain&&parameter&&values&&r.user_writes.iter().any(|w|w.pointer&&w.object==a.object&&w.offset==a.offset&&w.seq<=a.seq&&w.before==b.after)&&r.user_writes.iter().any(|w|w.pointer&&w.object==b.object&&w.offset==b.offset&&w.seq<=b.seq&&w.before==a.after)
        })){return false}
    }
    if profile["family"] == "array-access" {
        let values = case["stdin"]
            .as_str()
            .unwrap()
            .split_whitespace()
            .map(|s| s.parse::<i32>().unwrap())
            .collect::<Vec<_>>();
        let index = values[1] as usize;
        let old = json!(values[2 + index]);
        let expected = json!(
            case["expectedStdout"]
                .as_str()
                .unwrap()
                .trim()
                .parse::<i32>()
                .unwrap()
        );
        if !tagged(r,"array.write-contribution").iter().filter_map(|p|write_for_proof(r,p)).any(|w|{
            w.offset==index*4&&w.after==expected&&matches!(r.objects[w.object].ty.bare(),Ty::Array(t,n)if t.bare()==&Ty::Int&&*n>=values[0]as usize)&&r.user_writes.iter().any(|a|a.object==w.object&&a.offset==w.offset&&a.seq<=w.seq&&a.before==old)
        }){return false}
    }
    if profile["family"] == "struct-total" {
        let fields = tagged(r, "struct.field-contribution");
        let same_object = fields.iter().any(|a| {
            fields
                .iter()
                .any(|b| a.object_ids == b.object_ids && a.value != b.value)
        });
        if !same_object {
            return false;
        }
    }
    if profile["family"] == "scope" {
        let p = tagged(r, "scope.lifetime");
        let mut valid = false;
        for a in &p {
            for b in &p {
                let Some(ao) = a
                    .object_ids
                    .first()
                    .and_then(|s| s.strip_prefix('o'))
                    .and_then(|n| n.parse::<usize>().ok())
                    .map(|n| n - 1)
                else {
                    continue;
                };
                let Some(bo) = b
                    .object_ids
                    .first()
                    .and_then(|s| s.strip_prefix('o'))
                    .and_then(|n| n.parse::<usize>().ok())
                    .map(|n| n - 1)
                else {
                    continue;
                };
                if ao == bo
                    || r.journal.state["objects"][ao]["name"]
                        != r.journal.state["objects"][bo]["name"]
                {
                    continue;
                }
                let global = matches!(&r.checked.program.nodes[r.objects[ao].declaration].kind,Kind::Declare(d)if d.global);
                let same_frame = r.journal.state["objects"][ao]["frameId"]
                    == r.journal.state["objects"][bo]["frameId"];
                if (global || same_frame)
                    && r.objects[bo]
                        .ended_at
                        .is_some_and(|end| b.seq < end && end < a.seq)
                {
                    valid = true
                }
            }
        }
        if !valid {
            return false;
        }
    }
    if profile["family"] == "static-counter" {
        let n = case["stdin"]
            .as_str()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let p = tagged(r, "storage.static-local");
        if !p.iter().any(|p| {
            p.object_ids
                .first()
                .and_then(|s| s[1..].parse::<usize>().ok())
                .map(|n| n - 1)
                .is_some_and(|object| {
                    let declaration = r.checked.program.nodes[r.objects[object].declaration].range;
                    r.checked.program.functions.iter().any(|f| {
                        f.name != "main"
                            && declaration.start >= r.checked.program.nodes[f.body].range.start
                            && declaration.end <= r.checked.program.nodes[f.body].range.end
                            && r.call_counts.get(&f.name) == Some(&n)
                            && {
                                let k = profile["parameterK"].as_i64().unwrap();
                                let calls = r
                                    .calls
                                    .iter()
                                    .filter(|c| c.function == f.name)
                                    .collect::<Vec<_>>();
                                calls.len() == n
                                    && calls.iter().enumerate().all(|(i, c)| {
                                        let writes = r
                                            .user_writes
                                            .iter()
                                            .filter(|w| {
                                                w.object == object
                                                    && w.seq > c.entry_seq
                                                    && w.seq <= c.exit_seq
                                            })
                                            .collect::<Vec<_>>();
                                        writes
                                            .first()
                                            .is_some_and(|w| w.before == json!(i as i64 * k))
                                            && writes.last().is_some_and(|w| {
                                                w.after == json!((i + 1) as i64 * k)
                                            })
                                            && c.result.value == Val::I(((i + 1) as i64 * k) as i32)
                                    })
                            }
                    })
                })
        }) {
            return false;
        }
    }
    true
}
pub fn observe(r: &Runtime<'_, '_>, profile: &Value, case: &Value) -> (bool, Vec<Proof>) {
    let guarded = case["observationRule"] != "actual-target-and-output-contribution";
    if guarded {
        return guard(r, profile, case).map_or((false, vec![]), |p| (true, p));
    }
    let valid = normal_targets(r, profile, case);
    let tags = profile["semanticTargets"].as_array().unwrap();
    let mut selected = vec![];
    for tag in tags {
        if let Some(p) = r.output_deps.values().find(|p| tag == &p.tag)
            && !selected.iter().any(|a: &Proof| {
                a.tag == p.tag
                    && a.node_id == p.node_id
                    && a.seq == p.seq
                    && a.object_ids == p.object_ids
            })
        {
            selected.push(p.clone())
        }
    }
    for p in r
        .output_deps
        .values()
        .filter(|p| tags.iter().any(|t| t == &p.tag))
    {
        if selected.len() >= 32 {
            break;
        }
        if !selected.iter().any(|a| {
            a.tag == p.tag
                && a.node_id == p.node_id
                && a.seq == p.seq
                && a.object_ids == p.object_ids
        }) {
            selected.push(p.clone())
        }
    }
    if selected.len() < 32
        && let Some(p) = r.output_deps.values().find(|p| p.tag == "input.source")
    {
        selected.push(p.clone())
    }
    (valid, selected)
}
struct Case {
    key: String,
    packet: Packet,
    stdout: bool,
    returned: bool,
    observed: bool,
    proofs: Vec<Proof>,
}
pub fn execute(
    request: &Value,
    build_id: &str,
    meter: &mut Meter,
) -> Result<Vec<u8>, &'static str> {
    if !api::exact(
        request,
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
            "judgeVersion",
            "profileRef",
            "packageRef",
        ],
    ) {
        return Err("E_PROTOCOL_INVALID");
    }
    api::common(request)?;
    if request["judgeVersion"] != "2.0.0"
        || request["packageRef"] != json!({"id":"content.c.primer6","version":"1.0.0"})
    {
        return Err("E_UNSUPPORTED_VERSION");
    }
    let profile = profile(&request["profileRef"], meter)?;
    let source = request["source"].as_str().unwrap();
    let program = syntax::parse(source, meter)
        .and_then(|p| check::check(p, meter))
        .map_err(|e| e.code)?;
    let meta = api::encode_metadata(&api::metadata(request, build_id, Some(&program)), meter)?;
    let mut totals = Totals::default();
    let mut cases = vec![];
    let mut watch = profile["semanticTargets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t.as_str().unwrap().into())
        .collect::<BTreeSet<String>>();
    watch.extend(
        [
            "condition.contribution",
            "control.if",
            "loop.contribution",
            "control.for",
            "control.while",
            "control.do-while",
        ]
        .map(str::to_string),
    );
    if watch.contains("string.copy") {
        watch.insert("string.char-source".into());
    }
    if profile["family"] == "loop-sum" {
        watch.insert("goal.write".into());
    }
    if profile["family"] == "function-affine" || profile["family"] == "recursion-sum" {
        watch.extend(["call.contribution".into(), "function.parameter".into()]);
    }
    for case in profile["testDomain"].as_array().unwrap() {
        let start = meter.used();
        let input = case["stdin"].as_str().unwrap();
        let mut runtime = Runtime::new(
            &program,
            input.as_bytes(),
            watch.clone(),
            api::metadata_bytes(&meta),
            &mut totals,
            meter,
        )
        .map_err(|e| e.code)?;
        let mut result = runtime.run().map(|v| v.value);
        let stdout = runtime.journal.state["output"] == case["expectedStdout"];
        if result.is_ok() {
            let units = observation_cost(&runtime, &profile);
            if let Err(e) = runtime.tick(program.program.root, units) {
                result = Err(e);
            }
        }
        let returned = result.as_ref().is_ok_and(|v| v == &Val::I(0));
        let (observed, proofs) = if result.is_ok() {
            observe(&runtime, &profile, case)
        } else {
            (false, vec![])
        };
        let terminal = api::terminal(result, runtime.journal.steps.len());
        let stop = terminal["status"] == "limited" || terminal["status"] == "cancelled";
        let journal = runtime.journal;
        let packet = Packet {
            metadata: meta.clone(),
            journal: Some(journal),
            terminal,
            fuel_used: meter.used() - start,
        };
        cases.push(Case {
            key: case["caseKey"].as_str().unwrap().into(),
            packet,
            stdout,
            returned,
            observed,
            proofs,
        });
        if stop {
            break;
        }
    }
    let completed = cases.len() == 4
        && cases.iter().all(|c| {
            c.packet.terminal["status"] != "limited" && c.packet.terminal["status"] != "cancelled"
        });
    let passed = completed
        && cases.iter().all(|c| {
            c.stdout && c.returned && c.observed && c.packet.terminal["status"] == "completed"
        });
    meter
        .begin_finalization()
        .map_err(|e| api::codec_code(codec::CodecError::Budget(e)))?;
    let mut rows = vec![];
    for c in &cases {
        let mut fields = BTreeMap::new();
        fields.insert("caseKey".into(), api::encoded(&json!(c.key), meter)?);
        fields.insert("packet".into(), c.packet.wire(meter, c.packet.fuel_used)?);
        fields.insert(
            "stdoutMatches".into(),
            api::encoded(&json!(c.stdout), meter)?,
        );
        fields.insert(
            "returnMatches".into(),
            api::encoded(&json!(c.returned), meter)?,
        );
        fields.insert(
            "observationMatches".into(),
            api::encoded(&json!(c.observed), meter)?,
        );
        fields.insert(
            "observations".into(),
            api::encoded(&json!(c.proofs), meter)?,
        );
        rows.push(Wire::Object(fields));
    }
    let mut root = BTreeMap::new();
    root.insert("judgeVersion".into(), api::encoded(&json!("2.0.0"), meter)?);
    root.insert(
        "packageRef".into(),
        api::encoded(&request["packageRef"], meter)?,
    );
    root.insert(
        "profileRef".into(),
        api::encoded(&request["profileRef"], meter)?,
    );
    root.insert(
        "sourceSha256".into(),
        api::encoded(&request["sourceSha256"], meter)?,
    );
    root.insert(
        "status".into(),
        api::encoded(
            &json!(if passed {
                "passed"
            } else if completed {
                "failed"
            } else {
                "incomplete"
            }),
            meter,
        )?,
    );
    root.insert("cases".into(), Wire::Array(rows));
    root.insert("aggregate".into(),api::encoded(&json!({"elapsedMs":0,"fuel":0,"steps":totals.steps,"objects":totals.objects,"outputBytes":totals.output_bytes,"resultBytes":0,"wasmPeakBytes":0}),meter)?);
    let mut wire = Wire::Object(root);
    if wire.length() > meter.limits().result_bytes {
        return Err("E_RESULT_LIMIT");
    }
    // Include the actual final output allocation in the WASM high-water measurement.
    // The buffer stays alive while the aggregate is sealed, then receives the one final copy.
    let mut output = Vec::new();
    output
        .try_reserve_exact(wire.length() + 4096)
        .map_err(|_| "E_ENCODING_FAILURE")?;
    let elapsed = meter.elapsed_micros().unwrap_or(0) / 1000;
    let mut sealed = false;
    for _ in 0..16 {
        // A fixed, admitted cost for the small seven-field aggregate, including its length pass.
        meter
            .charge(512)
            .map_err(|e| api::codec_code(codec::CodecError::Budget(e)))?;
        let bytes = wire.length();
        let peak = wasm_bytes();
        let aggregate = json!({"elapsedMs":elapsed,"fuel":meter.used()+bytes.div_ceil(64),"steps":totals.steps,"objects":totals.objects,"outputBytes":totals.output_bytes,"resultBytes":bytes,"wasmPeakBytes":peak});
        let Wire::Object(root) = &mut wire else {
            unreachable!()
        };
        root.insert(
            "aggregate".into(),
            Wire::Owned(serde_json::to_vec(&aggregate).map_err(|_| "E_ENCODING_FAILURE")?),
        );
        if wire.length() == bytes && wasm_bytes() == peak {
            sealed = true;
            break;
        }
    }
    if !sealed {
        return Err("E_ENCODING_FAILURE");
    }
    api::finish_wire_reserved(&wire, meter, output)
}
pub fn wasm_bytes() -> usize {
    #[cfg(target_arch = "wasm32")]
    {
        std::arch::wasm32::memory_size(0) * 65536
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        0
    }
}
