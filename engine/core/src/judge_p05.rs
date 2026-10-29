//! P0.5's finite teaching proofs. Values, reads, writes and control decisions
//! come exclusively from committed Rust STEP observations. The arena below is
//! a temporary provenance graph, never a second C evaluator or a saved trace.
use super::{Result, charge, check, id, node};
use crate::ast::{
    BinaryOp as B, Expression as E, Initializer, NodeData as N, NodeId, UnaryOp as U,
};
use crate::budget::Meter;
use crate::semantic::CheckedProgram;
use crate::trace::Trace;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn profile_for_rule(rule: &str) -> Option<&'static str> {
    Some(match rule {
        "entry-output" => "judge.c.first-output",
        "printf-integer-layout" => "judge.c.printf-layout",
        "ordered-output-dependency" => "judge.c.ordered-updates",
        "scalar-reassignment" => "judge.c.reassign-value",
        "temporary-swap" => "judge.c.swap-with-temp",
        "scope-shadow-output" => "judge.c.shadowed-values",
        "safe-wide-product" => "judge.c.wide-product",
        "integer-quotient-remainder" => "judge.c.quotient-remainder",
        "boolean-classification" => "judge.c.boolean-flags",
        "short-circuit-guard" => "judge.c.guarded-division",
        "if-positive-normalize" => "judge.c.absolute-with-if",
        "nested-sign-branches" => "judge.c.sign-classification",
        "interval-membership" => "judge.c.in-closed-range",
        "while-countdown" => "judge.c.while-countdown",
        "break-continue-odd-sum" => "judge.c.odd-sum-until-stop",
        "nested-grid-count" => "judge.c.grid-count",
        "partial-array-initialization" => "judge.c.partial-array-init",
        "logical-array-print" => "judge.c.print-logical-array",
        "guarded-array-access" => "judge.c.safe-array-access",
        "array-extrema" => "judge.c.array-extrema",
        "array-positive-count" => "judge.c.count-positive",
        "linear-first-index" => "judge.c.linear-search-first",
        "adjacent-order-check" => "judge.c.check-nondecreasing",
        "bubble-ascending" => "judge.c.bubble-sort",
        "selection-ascending" => "judge.c.selection-sort",
        "binary-first-index" => "judge.c.binary-search-first",
        _ => return None,
    })
}

type Affine = (i64, BTreeMap<(String, usize), i64>);
type Normal = (i64, BTreeMap<usize, i64>);
#[derive(Clone)]
enum Kind {
    Constant,
    Input(String, usize),
    Read {
        object: String,
        declaration: NodeId,
        index: usize,
    },
    Store {
        object: String,
        declaration: NodeId,
        index: usize,
        initial: bool,
    },
    Binary(B),
    Unary(U),
    Condition {
        control: NodeId,
        taken: bool,
    },
}
struct Proof {
    kind: Kind,
    value: i64,
    data: Vec<usize>,
    controls: Vec<usize>,
    at: NodeId,
    seq: usize,
    affine: Option<Affine>,
    normal: Option<Normal>,
}
struct Object {
    declaration: NodeId,
    cells: BTreeMap<usize, usize>,
}
struct Event {
    at: NodeId,
    seq: usize,
    proof: usize,
}
struct Evidence<'a> {
    checked: &'a CheckedProgram,
    request: &'a Value,
    meter: &'a mut Meter,
    parents: Vec<Option<NodeId>>,
    binding: BTreeMap<NodeId, String>,
    graph: Vec<Proof>,
    objects: BTreeMap<String, Object>,
    conditions: BTreeMap<NodeId, usize>,
    condition_events: Vec<Event>,
    outputs: Vec<Event>,
    reads: Vec<Event>,
    stores: Vec<Event>,
    jumps: Vec<(NodeId, usize)>,
    destroyed: Vec<Value>,
    stdout: String,
    target_controls: BTreeSet<NodeId>,
    destroyed_objects: BTreeMap<String, usize>,
    symbols: BTreeMap<String, usize>,
}
impl<'a> Evidence<'a> {
    fn new(request: &'a Value, checked: &'a CheckedProgram, meter: &'a mut Meter) -> Result<Self> {
        let count = checked.parsed.program.nodes.len();
        charge(meter, count * 2)?;
        let mut parents = vec![None; count];
        for (i, n) in checked.parsed.program.nodes.iter().enumerate() {
            let children = n.data.children();
            charge(meter, 1 + children.len())?;
            for child in children {
                parents[child] = Some(i);
            }
        }
        let mut binding = BTreeMap::new();
        for b in request["source"]["bindingMap"].as_array().unwrap() {
            for d in &checked.declarations {
                charge(meter, 1)?;
                let r = checked.parsed.program.nodes[d.node_id].byte_range;
                if b["byteRange"]["start"].as_u64() == Some(r.start as u64)
                    && b["byteRange"]["end"].as_u64() == Some(r.end as u64)
                {
                    binding.insert(d.node_id, b["bindingKey"].as_str().unwrap().into());
                }
            }
        }
        Ok(Self {
            checked,
            request,
            meter,
            parents,
            binding,
            graph: vec![],
            objects: BTreeMap::new(),
            conditions: BTreeMap::new(),
            condition_events: vec![],
            outputs: vec![],
            reads: vec![],
            stores: vec![],
            jumps: vec![],
            destroyed: vec![],
            stdout: String::new(),
            target_controls: BTreeSet::new(),
            destroyed_objects: BTreeMap::new(),
            symbols: BTreeMap::new(),
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn push(
        &mut self,
        kind: Kind,
        value: i64,
        data: Vec<usize>,
        controls: Vec<usize>,
        at: NodeId,
        seq: usize,
        affine: Option<Affine>,
    ) -> Result<usize> {
        let normal = self.normal(&kind, value, &data)?;
        charge(
            self.meter,
            1 + data.len() + controls.len() + affine.as_ref().map_or(0, |a| a.1.len()),
        )?;
        let index = self.graph.len();
        self.graph.push(Proof {
            kind,
            value,
            data,
            controls,
            at,
            seq,
            affine,
            normal,
        });
        Ok(index)
    }
    fn normal(&mut self, kind: &Kind, value: i64, data: &[usize]) -> Result<Option<Normal>> {
        let child: Vec<_> = data.iter().map(|p| self.graph[*p].normal.clone()).collect();
        charge(
            self.meter,
            1 + child
                .iter()
                .filter_map(Option::as_ref)
                .map(|n| n.1.len())
                .sum::<usize>(),
        )?;
        let scale = |normal: &Normal, factor: i64| -> Option<Normal> {
            let mut terms = BTreeMap::new();
            for (key, coefficient) in &normal.1 {
                let next = coefficient.checked_mul(factor)?;
                if next != 0 {
                    terms.insert(*key, next);
                }
            }
            Some((normal.0.checked_mul(factor)?, terms))
        };
        let opaque = match kind {
            Kind::Constant => return Ok(Some((value, BTreeMap::new()))),
            Kind::Input(key, index) => format!("input:{key}:{index}"),
            Kind::Read { .. } | Kind::Store { .. } | Kind::Condition { .. } => {
                return Ok(child
                    .first()
                    .cloned()
                    .unwrap_or(Some((value, BTreeMap::new()))));
            }
            Kind::Unary(U::Plus) => return Ok(child.first().cloned().flatten()),
            Kind::Unary(U::Minus) => {
                return Ok(child
                    .first()
                    .and_then(Option::as_ref)
                    .and_then(|n| scale(n, -1)));
            }
            Kind::Binary(B::Add | B::Subtract) => {
                let (Some(Some(a)), Some(Some(b))) = (child.first(), child.get(1)) else {
                    return Ok(None);
                };
                let sign = if matches!(kind, Kind::Binary(B::Add)) {
                    1
                } else {
                    -1
                };
                let Some((constant, right)) = scale(b, sign) else {
                    return Ok(None);
                };
                let Some(constant) = a.0.checked_add(constant) else {
                    return Ok(None);
                };
                let mut terms = a.1.clone();
                for (key, value) in right {
                    let Some(next) = terms.get(&key).copied().unwrap_or(0).checked_add(value)
                    else {
                        return Ok(None);
                    };
                    if next == 0 {
                        terms.remove(&key);
                    } else {
                        terms.insert(key, next);
                    }
                }
                return Ok(Some((constant, terms)));
            }
            Kind::Binary(B::Multiply) if child.len() == 2 => {
                let (Some(a), Some(b)) = (&child[0], &child[1]) else {
                    return Ok(None);
                };
                if a.1.is_empty() {
                    return Ok(scale(b, a.0));
                }
                if b.1.is_empty() {
                    return Ok(scale(a, b.0));
                }
                format!("multiply:{a:?}:{b:?}")
            }
            Kind::Binary(B::Divide) if child.get(1) == Some(&Some((1, BTreeMap::new()))) => {
                return Ok(child.first().cloned().flatten());
            }
            Kind::Binary(op) => {
                let mut op = *op;
                let mut values = child;
                if matches!(op, B::Greater | B::GreaterEqual) {
                    op = if op == B::Greater {
                        B::Less
                    } else {
                        B::LessEqual
                    };
                    values.reverse();
                }
                if matches!(op, B::Equal | B::NotEqual | B::And | B::Or) {
                    values.sort();
                }
                format!("binary:{op:?}:{values:?}")
            }
            Kind::Unary(op) => format!("unary:{op:?}:{child:?}"),
        };
        charge(self.meter, opaque.len().div_ceil(64) + 1)?;
        let next = self.symbols.len();
        let id = *self.symbols.entry(opaque).or_insert(next);
        Ok(Some((0, BTreeMap::from([(id, 1)]))))
    }
    fn constant(&mut self, value: i64, at: NodeId, seq: usize) -> Result<usize> {
        self.push(
            Kind::Constant,
            value,
            vec![],
            vec![],
            at,
            seq,
            Some((value, BTreeMap::new())),
        )
    }
    fn ancestors(&mut self, at: NodeId) -> Result<Vec<NodeId>> {
        let mut result = vec![];
        let mut next = self.parents[at];
        while let Some(p) = next {
            charge(self.meter, 1)?;
            result.push(p);
            next = self.parents[p];
        }
        Ok(result)
    }
    fn active(&mut self, at: NodeId) -> Result<Vec<usize>> {
        let ancestors = self.ancestors(at)?;
        Ok(ancestors
            .iter()
            .filter_map(|p| self.conditions.get(p).copied())
            .collect())
    }
    fn literal(&self, p: usize) -> Option<i64> {
        let g = &self.graph[p];
        g.affine.as_ref().filter(|a| a.1.is_empty()).map(|a| a.0)
    }
    fn eval(
        &mut self,
        at: NodeId,
        observations: &BTreeMap<NodeId, &Value>,
        seq: usize,
    ) -> Result<usize> {
        charge(self.meter, 1)?;
        let N::Expr(e) = self.checked.parsed.program.nodes[at].data.clone() else {
            unreachable!("checked expression")
        };
        match e {
            E::Integer(v) => self.constant(v as i64, at, seq),
            E::Name(_) | E::Index { .. } => {
                let o = observations[&at];
                let object = o["objectId"].as_str().unwrap();
                let index = o["index"].as_u64().unwrap() as usize;
                let current = &self.objects[object];
                let declaration = current.declaration;
                let previous = current.cells.get(&index).copied();
                let affine = previous.and_then(|p| self.graph[p].affine.clone());
                let p = self.push(
                    Kind::Read {
                        object: object.into(),
                        declaration,
                        index,
                    },
                    o["value"].as_i64().unwrap(),
                    previous.into_iter().collect(),
                    vec![],
                    at,
                    seq,
                    affine,
                )?;
                self.reads.push(Event { at, seq, proof: p });
                Ok(p)
            }
            E::Unary { op, operand } => {
                let p = self.eval(operand, observations, seq)?;
                let value = observations[&at]["value"].as_i64().unwrap();
                let affine = match (op, self.graph[p].affine.clone()) {
                    (U::Plus, a) => a,
                    (U::Minus, Some((c, mut m))) => {
                        for x in m.values_mut() {
                            *x = -*x;
                        }
                        Some((-c, m))
                    }
                    _ => None,
                };
                self.push(Kind::Unary(op), value, vec![p], vec![], at, seq, affine)
            }
            E::Binary { op, left, right } => {
                let a = self.eval(left, observations, seq)?;
                let obs = observations[&at];
                let b = if obs["operands"].as_array().unwrap().len() == 2 {
                    Some(self.eval(right, observations, seq)?)
                } else {
                    None
                };
                let value = obs["value"].as_i64().unwrap();
                if let Some(b) = b {
                    if op == B::Multiply
                        && (self.literal(a) == Some(0) || self.literal(b) == Some(0))
                        || op == B::Subtract && self.same_value(a, b)?
                    {
                        return self.constant(0, at, seq);
                    }
                    let alias = match op {
                        B::Add | B::Subtract
                            if matches!(self.graph[b].kind, Kind::Constant)
                                && self.literal(b) == Some(0) =>
                        {
                            Some(a)
                        }
                        B::Add
                            if matches!(self.graph[a].kind, Kind::Constant)
                                && self.literal(a) == Some(0) =>
                        {
                            Some(b)
                        }
                        B::Multiply | B::Divide if self.literal(b) == Some(1) => Some(a),
                        B::Multiply if self.literal(a) == Some(1) => Some(b),
                        _ => None,
                    };
                    if let Some(p) = alias {
                        return Ok(p);
                    }
                }
                let mut affine = None;
                let mut data = vec![a];
                if let Some(b) = b {
                    data.push(b);
                }
                if let Some(b) = b {
                    let x = self.graph[a].affine.clone();
                    let y = self.graph[b].affine.clone();
                    let had_inputs = x.as_ref().is_some_and(|x| !x.1.is_empty())
                        || y.as_ref().is_some_and(|y| !y.1.is_empty());
                    charge(
                        self.meter,
                        x.as_ref().map_or(0, |x| x.1.len()) + y.as_ref().map_or(0, |x| x.1.len()),
                    )?;
                    affine = match (op, x, y) {
                        (B::Add | B::Subtract, Some((c, mut x)), Some((d, y))) => {
                            let sign = if op == B::Add { 1 } else { -1 };
                            let mut valid = true;
                            for (k, v) in y {
                                if let Some(next) = x
                                    .get(&k)
                                    .copied()
                                    .unwrap_or(0)
                                    .checked_add(v.saturating_mul(sign))
                                {
                                    if next == 0 {
                                        x.remove(&k);
                                    } else {
                                        x.insert(k, next);
                                    }
                                } else {
                                    valid = false;
                                }
                            }
                            c.checked_add(d.saturating_mul(sign))
                                .filter(|_| valid)
                                .map(|c| (c, x))
                        }
                        (B::Multiply, Some((c, x)), Some((d, y)))
                            if x.is_empty() || y.is_empty() =>
                        {
                            let (scale, base, map) =
                                if x.is_empty() { (c, d, y) } else { (d, c, x) };
                            let mut out = BTreeMap::new();
                            let mut valid = true;
                            for (k, v) in map {
                                if let Some(v) = v.checked_mul(scale) {
                                    if v != 0 {
                                        out.insert(k, v);
                                    }
                                } else {
                                    valid = false;
                                }
                            }
                            base.checked_mul(scale).filter(|_| valid).map(|c| (c, out))
                        }
                        (B::Divide, Some(x), Some((1, y))) if y.is_empty() => Some(x),
                        _ => None,
                    };
                    // Algebraically dead provenance must never survive as a read target.
                    if affine.as_ref().is_some_and(|a| a.1.is_empty())
                        && matches!(op, B::Add | B::Subtract | B::Multiply)
                        && (had_inputs
                            || op == B::Multiply
                                && (self.literal(a) == Some(0) || self.literal(b) == Some(0)))
                    {
                        data.clear();
                    }
                }
                self.push(Kind::Binary(op), value, data, vec![], at, seq, affine)
            }
        }
    }
    fn step(&mut self, step: &crate::trace::Step) -> Result<()> {
        charge(self.meter, 1 + step.observations.len() + step.changes.len())?;
        let at = id(&step.location["nodeId"]);
        let mut obs = BTreeMap::new();
        for o in &step.observations {
            if let Some(n) = id(&o["nodeId"])
                && matches!(o["kind"].as_str(), Some("read" | "evaluate"))
            {
                obs.insert(n, o);
            }
        }
        let mut assigned = None;
        if let Some(at) = at {
            match self.checked.parsed.program.nodes[at].data.clone() {
                N::Declaration {
                    initializer: Initializer::Scalar(p),
                    ..
                } if step.kind == "value.initialize" => {
                    assigned = Some(self.eval(p, &obs, step.seq)?)
                }
                N::Assignment { value, .. } if step.kind == "value.write" => {
                    assigned = Some(self.eval(value, &obs, step.seq)?)
                }
                N::Condition { expression } if step.kind == "condition" => {
                    let p = self.eval(expression, &obs, step.seq)?;
                    let control = self.parents[at].unwrap();
                    let value = self.graph[p].value;
                    let p = self.push(
                        Kind::Condition {
                            control,
                            taken: value != 0,
                        },
                        value,
                        vec![p],
                        vec![],
                        at,
                        step.seq,
                        None,
                    )?;
                    self.conditions.insert(control, p);
                    self.condition_events.push(Event {
                        at,
                        seq: step.seq,
                        proof: p,
                    });
                }
                N::Output { arguments, .. } if step.kind == "output.append" => {
                    if arguments.is_empty() {
                        let p = self.constant(0, at, step.seq)?;
                        self.outputs.push(Event {
                            at,
                            seq: step.seq,
                            proof: p,
                        });
                    }
                    for arg in arguments {
                        let p = self.eval(arg, &obs, step.seq)?;
                        self.outputs.push(Event {
                            at,
                            seq: step.seq,
                            proof: p,
                        });
                    }
                }
                N::Break | N::Continue => self.jumps.push((at, step.seq)),
                _ => {}
            }
        }
        for change in &step.changes {
            if change["op"] == "output" {
                let text = change["append"].as_str().unwrap();
                charge(self.meter, text.len().div_ceil(64))?;
                self.stdout.push_str(text);
            }
            if change["op"] == "record" && change["table"] == "objects" {
                let object = change["id"].as_str().unwrap().to_owned();
                let after = &change["after"];
                if after.is_null() {
                    self.destroyed_objects.insert(object.clone(), step.seq);
                    if let Some(o) = self.objects.get(&object)
                        && self
                            .binding
                            .get(&o.declaration)
                            .is_some_and(|b| b == "param.values")
                    {
                        let length = self.request["input"]["values"]["values"]
                            .as_array()
                            .unwrap()
                            .len();
                        charge(self.meter, length + 1)?;
                        let values: Vec<_> =
                            (0..length).map(|i| self.graph[o.cells[&i]].value).collect();
                        self.destroyed.push(json!({"kind":"array-before-destroy","bindingKey":"param.values","objectId":object,"declarationNodeId":node(o.declaration),"beforeCursor":step.seq-1,"location":step.location,"values":values}));
                    }
                    self.objects.remove(&object);
                    continue;
                }
                let declaration = id(&after["declarationNodeId"]).unwrap();
                self.objects.entry(object.clone()).or_insert(Object {
                    declaration,
                    cells: BTreeMap::new(),
                });
                if step.kind == "value.initialize" {
                    let len = after["length"].as_u64().unwrap() as usize;
                    charge(self.meter, len)?;
                    for i in 0..len {
                        let raw = after["cells"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|c| c["index"].as_u64() == Some(i as u64))
                            .map(|c| &c["value"])
                            .unwrap_or(&after["defaultValue"]);
                        if let Some(v) = raw.as_i64() {
                            self.store(
                                object.clone(),
                                declaration,
                                i,
                                v,
                                assigned,
                                at.unwrap(),
                                step.seq,
                                true,
                            )?;
                        }
                    }
                }
            }
            if change["op"] == "cell" {
                let object = change["objectId"].as_str().unwrap().to_owned();
                let declaration = self.objects[&object].declaration;
                let i = change["index"].as_u64().unwrap() as usize;
                let v = change["after"].as_i64().unwrap();
                self.store(
                    object,
                    declaration,
                    i,
                    v,
                    assigned,
                    at.unwrap(),
                    step.seq,
                    step.kind == "value.initialize",
                )?;
            }
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn store(
        &mut self,
        object: String,
        declaration: NodeId,
        index: usize,
        value: i64,
        assigned: Option<usize>,
        at: NodeId,
        seq: usize,
        initial: bool,
    ) -> Result<()> {
        let origin = if initial {
            if let Some(binding) = self.binding.get(&declaration).cloned() {
                let leaf = self.push(
                    Kind::Input(binding.clone(), index),
                    value,
                    vec![],
                    vec![],
                    at,
                    seq,
                    Some((0, BTreeMap::from([((binding, index), 1)]))),
                )?;
                Some(leaf)
            } else {
                assigned
            }
        } else {
            assigned
        };
        let origin = match origin {
            Some(p) => p,
            None => self.constant(value, at, seq)?,
        };
        let affine = self.graph[origin].affine.clone();
        let controls = self.active(at)?;
        let p = self.push(
            Kind::Store {
                object: object.clone(),
                declaration,
                index,
                initial,
            },
            value,
            vec![origin],
            controls,
            at,
            seq,
            affine,
        )?;
        self.objects
            .get_mut(&object)
            .unwrap()
            .cells
            .insert(index, p);
        self.stores.push(Event { at, seq, proof: p });
        Ok(())
    }
    fn walk(&mut self, roots: &[usize], controls: bool) -> Result<BTreeSet<usize>> {
        let mut result = BTreeSet::new();
        let mut visited: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
        let mut todo: Vec<(usize, BTreeSet<usize>)> = vec![];
        for root in roots {
            let allowed = self.graph[*root]
                .normal
                .as_ref()
                .map(|n| n.1.keys().copied().collect())
                .unwrap_or_default();
            todo.push((*root, allowed));
        }
        while let Some((p, allowed)) = todo.pop() {
            charge(self.meter, 1 + allowed.len())?;
            let g = &self.graph[p];
            let Some(normal) = &g.normal else {
                continue;
            };
            if !normal.1.is_empty() && !normal.1.keys().any(|key| allowed.contains(key)) {
                continue;
            }
            let known = visited.entry(p).or_default();
            let fresh = !result.contains(&p) || !allowed.is_subset(known);
            known.extend(&allowed);
            if !fresh {
                continue;
            }
            result.insert(p);
            let linear = match g.kind {
                Kind::Constant
                | Kind::Input(..)
                | Kind::Read { .. }
                | Kind::Store { .. }
                | Kind::Binary(B::Add | B::Subtract)
                | Kind::Unary(U::Plus | U::Minus) => true,
                Kind::Binary(B::Multiply) => g.data.iter().any(|q| {
                    self.graph[*q]
                        .normal
                        .as_ref()
                        .is_some_and(|n| n.1.is_empty())
                }),
                Kind::Binary(B::Divide) => g
                    .data
                    .get(1)
                    .is_some_and(|q| self.graph[*q].normal == Some((1, BTreeMap::new()))),
                _ => false,
            };
            for q in &g.data {
                let next = if linear {
                    allowed.clone()
                } else {
                    self.graph[*q]
                        .normal
                        .as_ref()
                        .map(|n| n.1.keys().copied().collect())
                        .unwrap_or_default()
                };
                todo.push((*q, next));
            }
            if controls {
                for q in &g.controls {
                    let next = self.graph[*q]
                        .normal
                        .as_ref()
                        .map(|n| n.1.keys().copied().collect())
                        .unwrap_or_default();
                    todo.push((*q, next));
                }
            }
        }
        Ok(result)
    }

    fn same_value(&mut self, mut a: usize, mut b: usize) -> Result<bool> {
        for p in [&mut a, &mut b] {
            loop {
                charge(self.meter, 1)?;
                let g = &self.graph[*p];
                if matches!(g.kind, Kind::Read { .. } | Kind::Store { .. }) && g.data.len() == 1 {
                    *p = g.data[0];
                } else {
                    break;
                }
            }
        }
        if a == b {
            return Ok(true);
        }
        let x = &self.graph[a];
        let y = &self.graph[b];
        let comparable = match (&x.kind, &y.kind) {
            (Kind::Constant, Kind::Constant) => x.value == y.value,
            (Kind::Binary(a), Kind::Binary(b)) => a == b,
            (Kind::Unary(a), Kind::Unary(b)) => a == b,
            _ => false,
        };
        if !comparable || x.data.len() != y.data.len() {
            return Ok(false);
        }
        let pairs: Vec<_> = x.data.iter().copied().zip(y.data.iter().copied()).collect();
        for (x, y) in pairs {
            if !self.same_value(x, y)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
    fn reference(&mut self, at: NodeId) -> Result<Option<NodeId>> {
        charge(self.meter, self.checked.references.len() + 1)?;
        Ok(self
            .checked
            .references
            .iter()
            .find(|r| r.expression_node == at)
            .map(|r| r.declaration_node))
    }
    fn condition_expression(&self, control: NodeId) -> Option<NodeId> {
        let condition = match self.checked.parsed.program.nodes[control].data {
            N::If { condition, .. } | N::While { condition, .. } => condition,
            N::For {
                condition: Some(condition),
                ..
            } => condition,
            _ => return None,
        };
        match self.checked.parsed.program.nodes[condition].data {
            N::Condition { expression } => Some(expression),
            _ => None,
        }
    }
    fn statement_writes(&mut self, at: NodeId, declaration: NodeId) -> Result<bool> {
        let mut todo = vec![at];
        while let Some(p) = todo.pop() {
            charge(self.meter, 1)?;
            let n = self.checked.parsed.program.nodes[p].data.clone();
            if let N::Assignment { target, .. } = n
                && self.reference(target)? == Some(declaration)
            {
                return Ok(true);
            }
            todo.extend(n.children());
        }
        Ok(false)
    }
    fn condition_set(&mut self, control: NodeId) -> Result<BTreeSet<usize>> {
        let roots: Vec<_> = self.condition_events.iter().filter(|event| matches!(self.graph[event.proof].kind, Kind::Condition { control: p, .. } if p == control)).map(|event| event.proof).collect();
        self.walk(&roots, false)
    }
    fn ast_nodes(&mut self, at: NodeId) -> Result<BTreeSet<NodeId>> {
        let mut result = BTreeSet::new();
        let mut todo = vec![at];
        while let Some(p) = todo.pop() {
            charge(self.meter, 1)?;
            if result.insert(p) {
                todo.extend(self.checked.parsed.program.nodes[p].data.children());
            }
        }
        Ok(result)
    }
    fn references_in(&mut self, at: NodeId) -> Result<BTreeSet<NodeId>> {
        let nodes = self.ast_nodes(at)?;
        charge(self.meter, self.checked.references.len())?;
        Ok(self
            .checked
            .references
            .iter()
            .filter(|r| nodes.contains(&r.expression_node))
            .map(|r| r.declaration_node)
            .collect())
    }
    fn coverage(&mut self) -> Result<Vec<Value>> {
        let mut coverage = vec![];
        // Structural order is stable across rebound input literals and AST node offsets.
        let mut ordinal = 0;
        for control in 0..self.checked.parsed.program.nodes.len() {
            if !matches!(
                self.checked.parsed.program.nodes[control].data,
                N::If { .. }
            ) {
                continue;
            }
            let site = format!("if.{ordinal}");
            ordinal += 1;
            if !self.target_controls.contains(&control) {
                continue;
            }
            let mut visits = [0usize; 2];
            for event in &self.condition_events {
                charge(self.meter, 1)?;
                if let Kind::Condition { control: p, taken } = self.graph[event.proof].kind
                    && p == control
                {
                    visits[usize::from(taken)] += 1;
                }
            }
            for (branch, count) in [("then", visits[1]), ("else", visits[0])] {
                coverage.push(
                    json!({"siteKey":site,"nodeId":node(control),"branch":branch,"visits":count}),
                );
            }
        }
        Ok(coverage)
    }
    fn roots(&self) -> Vec<usize> {
        let arguments: Vec<_> = self.outputs.iter().filter(|event|matches!(&self.checked.parsed.program.nodes[event.at].data,N::Output{arguments,..}if !arguments.is_empty())).map(|event|event.proof).collect();
        if arguments.is_empty() {
            self.outputs.iter().map(|event| event.proof).collect()
        } else {
            arguments
        }
    }
    fn affine_is(&self, p: usize, key: &str, coefficient: i64, constant: i64) -> bool {
        self.graph[p].affine.as_ref().is_some_and(|(c, t)| {
            *c == constant
                && t.len() == 1
                && t.get(&(format!("param.{key}"), 0)) == Some(&coefficient)
        })
    }
    fn has_input(&self, set: &BTreeSet<usize>, key: &str) -> bool {
        set.iter()
            .any(|p| matches!(&self.graph[*p].kind,Kind::Input(k,_)if k==&format!("param.{key}")))
    }
    fn has_op(&self, set: &BTreeSet<usize>, op: B) -> bool {
        set.iter()
            .any(|p| matches!(self.graph[*p].kind,Kind::Binary(o)if o==op))
    }
    fn loops_at(&mut self, at: NodeId) -> Result<Vec<NodeId>> {
        Ok(self
            .ancestors(at)?
            .into_iter()
            .filter(|p| {
                matches!(
                    self.checked.parsed.program.nodes[*p].data,
                    N::For { .. } | N::While { .. }
                )
            })
            .collect())
    }
    fn source_reads(&mut self, roots: &[usize]) -> Result<Vec<(usize, NodeId, usize)>> {
        let effective = self.walk(roots, false)?;
        let mut seen = BTreeSet::new();
        let mut todo = roots.to_vec();
        let mut result = vec![];
        while let Some(p) = todo.pop() {
            charge(self.meter, 1)?;
            if !effective.contains(&p) || !seen.insert(p) {
                continue;
            }
            match &self.graph[p].kind {
                Kind::Read {
                    declaration, index, ..
                } if self
                    .binding
                    .get(declaration)
                    .is_some_and(|b| b == "param.values") =>
                {
                    result.push((*index, self.graph[p].at, self.graph[p].seq));
                }
                _ => todo.extend(&self.graph[p].data),
            }
        }
        Ok(result)
    }
    fn target(&mut self) -> Result<bool> {
        charge(
            self.meter,
            self.checked.parsed.program.nodes.len().saturating_mul(24)
                + self.graph.len().saturating_mul(4),
        )?;
        let roots = self.roots();
        let data = self.walk(&roots, false)?;
        let all = self.walk(&roots, true)?;
        let rule = self.request["judge"]["rule"].as_str().unwrap();
        let values: Vec<i64> = self.request["input"]["values"]["values"]
            .as_array()
            .map_or_else(Vec::new, |a| {
                a.iter().map(|v| v.as_i64().unwrap()).collect()
            });
        let n = values.len();
        match rule {
            "entry-output" => Ok(!self.outputs.is_empty()),
            "printf-integer-layout" => Ok(roots.len() == 2
                && self.affine_is(roots[0], "x", 1, 0)
                && self.affine_is(roots[1], "y", 1, 0)),
            "safe-wide-product" => Ok(roots.len() == 1
                && self.affine_is(roots[0], "x", 1_000_000, 0)
                && self.has_op(&data, B::Multiply)),
            "ordered-output-dependency" | "scalar-reassignment" => {
                let offsets: Vec<i64> = if rule == "scalar-reassignment" {
                    vec![0, 3]
                } else {
                    vec![0, 1, 3]
                };
                if roots.len() != offsets.len()
                    || !roots
                        .iter()
                        .zip(offsets)
                        .all(|(p, c)| self.affine_is(*p, "x", 1, c))
                {
                    return Ok(false);
                }
                let mut objects: Vec<BTreeMap<String, NodeId>> = vec![];
                for root in &roots {
                    let s = self.walk(&[*root], false)?;
                    let reads: BTreeMap<_, _> = s
                        .iter()
                        .filter_map(|p| {
                            if let Kind::Read {
                                object,
                                declaration,
                                ..
                            } = &self.graph[*p].kind
                            {
                                Some((object.clone(), *declaration))
                            } else {
                                None
                            }
                        })
                        .collect();
                    objects.push(reads);
                }
                Ok(objects[0].iter().any(|(object,declaration)|objects.iter().all(|set|set.contains_key(object))
                    && data.iter().filter(|p|matches!(&self.graph[**p].kind,Kind::Store{object:o,initial:false,..}if o==object)).count()>=roots.len()-1
                    && (rule!="scalar-reassignment"||!self.binding.contains_key(declaration))))
            }
            "temporary-swap" => {
                if roots.len() != 2
                    || !self.affine_is(roots[0], "y", 1, 0)
                    || !self.affine_is(roots[1], "x", 1, 0)
                {
                    return Ok(false);
                }
                let mut writes = BTreeSet::new();
                let mut temporary = false;
                for p in &data {
                    if let Kind::Store {
                        declaration,
                        initial,
                        ..
                    } = &self.graph[*p].kind
                    {
                        if !initial {
                            if let Some(b) = self.binding.get(declaration) {
                                writes.insert(b.as_str());
                            }
                        } else if !self.binding.contains_key(declaration) {
                            temporary = true;
                        }
                    }
                }
                Ok(temporary && writes.contains("param.x") && writes.contains("param.y"))
            }
            "scope-shadow-output" => {
                if roots.len() != 2
                    || !self.affine_is(roots[0], "x", 1, 1)
                    || !self.affine_is(roots[1], "x", 1, 0)
                {
                    return Ok(false);
                }
                let mut locals = vec![];
                for root in roots {
                    let set = self.walk(&[root], false)?;
                    locals.push(
                        set.iter()
                            .filter_map(|p| match self.graph[*p].kind {
                                Kind::Read { declaration, .. }
                                    if !self.binding.contains_key(&declaration) =>
                                {
                                    Some(declaration)
                                }
                                _ => None,
                            })
                            .collect::<BTreeSet<_>>(),
                    );
                }
                for a in &locals[0] {
                    for b in &locals[1] {
                        charge(self.meter, 1)?;
                        if a != b
                            && let (N::Declaration { name: x, .. }, N::Declaration { name: y, .. }) = (
                                &self.checked.parsed.program.nodes[*a].data,
                                &self.checked.parsed.program.nodes[*b].data,
                            )
                            && x == y
                            && self.ancestors(*a)?.contains(&self.parents[*b].unwrap())
                        {
                            let inner = self
                                .graph
                                .iter()
                                .filter_map(|g| match &g.kind {
                                    Kind::Read {
                                        object,
                                        declaration,
                                        ..
                                    } if declaration == a => Some(object),
                                    _ => None,
                                })
                                .find(|object| {
                                    self.destroyed_objects.get(*object).is_some_and(|seq| {
                                        *seq > self.outputs[0].seq && *seq < self.outputs[1].seq
                                    })
                                });
                            let outer_read = self.graph.iter().any(|g| {
                                matches!(&g.kind,Kind::Read{declaration,..}if declaration==b)
                                    && g.seq == self.outputs[1].seq
                            });
                            if inner.is_some() && outer_read {
                                return Ok(true);
                            }
                        }
                    }
                }
                Ok(false)
            }
            "integer-quotient-remainder" => {
                if roots.len() != 2 {
                    return Ok(false);
                }
                for (p, op) in roots.iter().zip([B::Divide, B::Remainder]) {
                    let set = self.walk(&[*p], false)?;
                    if !self.has_input(&set, "a")
                        || !self.has_input(&set, "b")
                        || !self.has_op(&set, op)
                    {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            "boolean-classification" => {
                if roots.len() != 2 {
                    return Ok(false);
                }
                let first = self.walk(&[roots[0]], false)?;
                let second = self.walk(&[roots[1]], false)?;
                Ok(self.has_input(&first, "x")
                    && self.has_op(&first, B::And)
                    && self.has_input(&second, "x")
                    && (self.has_op(&second, B::Equal)
                        || self.has_op(&second, B::NotEqual)
                        || second
                            .iter()
                            .any(|p| matches!(self.graph[*p].kind, Kind::Unary(U::Not)))))
            }
            "short-circuit-guard" => self.short_circuit(&roots),

            "if-positive-normalize" | "nested-sign-branches" | "interval-membership" => {
                self.branch_target(rule, &roots, &all)
            }
            "while-countdown" => self.countdown(&roots),

            "partial-array-initialization" => {
                let mut declarations = BTreeSet::new();
                for p in &data {
                    if let Kind::Read {
                        declaration, index, ..
                    } = self.graph[*p].kind
                        && let N::Declaration {
                            array_length: Some(5),
                            initializer: Initializer::Array(ref items),
                            ..
                        } = self.checked.parsed.program.nodes[declaration].data
                        && items.len() == 2
                        && self.literal_ast(items[0])? == Some(7)
                        && self.literal_ast(items[1])? == Some(-2)
                    {
                        let initialized = self.graph[*p].data.first().is_some_and(|q| {
                            matches!(self.graph[*q].kind, Kind::Store { initial: true, .. })
                        });
                        if !initialized {
                            return Ok(false);
                        }
                        declarations.insert((declaration, index));
                    }
                }
                Ok(declarations
                    .iter()
                    .any(|(d, _)| (0..5).all(|i| declarations.contains(&(*d, i)))))
            }
            "logical-array-print" => {
                let reads = self.source_reads(&roots)?;
                let mut seen = vec![];
                for (i, at, seq) in reads {
                    if self.loops_at(at)?.is_empty() {
                        return Ok(false);
                    }
                    seen.push((seq, i));
                }
                seen.sort_unstable();
                Ok(seen.into_iter().map(|(_, i)| i).collect::<Vec<_>>()
                    == (0..n).collect::<Vec<_>>()
                    && self.has_loop_structure())
            }
            "guarded-array-access" => self.guarded_access(&roots, n),

            "break-continue-odd-sum" => self.odd_sum(&roots, &data),
            "nested-grid-count" => self.grid(&roots, &data),
            "array-extrema" => self.extrema(&roots, &all, n),
            "array-positive-count" => self.positive_count(&roots, &all, &values),
            "linear-first-index" => self.linear_search(&roots, &all, &values),
            "adjacent-order-check" => self.adjacent_order(&roots, &all, &values),
            "bubble-ascending" | "selection-ascending" => {
                self.sort_target(rule, &roots, &all, &values)
            }
            "binary-first-index" => self.binary_search(&roots, &all, &values),
            _ => Ok(false),
        }
    }
    fn has_loop_structure(&self) -> bool {
        self.checked
            .parsed
            .program
            .nodes
            .iter()
            .any(|n| matches!(n.data, N::While { .. } | N::For { .. }))
    }
    fn static_inputs(&mut self, at: NodeId) -> Result<BTreeSet<String>> {
        let mut todo = vec![at];
        let mut seen = BTreeSet::new();
        let mut set = BTreeSet::new();
        while let Some(p) = todo.pop() {
            charge(self.meter, 1 + self.checked.references.len())?;
            if !seen.insert(p) {
                continue;
            }
            for r in &self.checked.references {
                if r.expression_node != p {
                    continue;
                }
                if let Some(binding) = self.binding.get(&r.declaration_node) {
                    set.insert(binding.clone());
                } else if let N::Declaration {
                    initializer: Initializer::Scalar(value),
                    ..
                } = self.checked.parsed.program.nodes[r.declaration_node].data
                {
                    todo.push(value);
                }
            }
            todo.extend(self.checked.parsed.program.nodes[p].data.children());
        }
        Ok(set)
    }

    fn literal_ast(&mut self, at: NodeId) -> Result<Option<i64>> {
        charge(self.meter, 1)?;
        match self.checked.parsed.program.nodes[at].data {
            N::Expr(E::Integer(v)) => Ok(Some(v as i64)),
            N::Expr(E::Unary {
                op: U::Plus | U::Minus,
                operand,
            }) => {
                let value = self.literal_ast(operand)?;
                Ok(
                    if matches!(
                        self.checked.parsed.program.nodes[at].data,
                        N::Expr(E::Unary { op: U::Minus, .. })
                    ) {
                        value.map(|v| -v)
                    } else {
                        value
                    },
                )
            }
            _ => Ok(None),
        }
    }
    fn short_circuit(&mut self, roots: &[usize]) -> Result<bool> {
        if roots.len() != 1 {
            return Ok(false);
        }
        let data = self.walk(roots, false)?;
        let x = self.request["input"]["values"]["x"].as_i64().unwrap();
        for p in &data {
            if !matches!(self.graph[*p].kind, Kind::Binary(B::And)) {
                continue;
            }
            let at = self.graph[*p].at;
            let N::Expr(E::Binary { left: _, right, .. }) =
                self.checked.parsed.program.nodes[at].data
            else {
                continue;
            };
            let children = self.graph[*p].data.clone();
            if children.is_empty() {
                continue;
            }
            let guard = self.walk(&[children[0]], false)?;
            if !self.has_input(&guard, "x")
                || !(self.has_op(&guard, B::NotEqual)
                    || guard
                        .iter()
                        .any(|q| matches!(self.graph[*q].kind, Kind::Unary(U::Not)))
                    || self.has_op(&guard, B::Equal))
                || ((self.graph[children[0]].value != 0) != (x != 0))
            {
                continue;
            }
            let mut division = false;
            for at in self.ast_nodes(right)? {
                if let N::Expr(E::Binary {
                    op: B::Divide,
                    left,
                    right,
                }) = self.checked.parsed.program.nodes[at].data
                {
                    division |= self.literal_ast(left)? == Some(12)
                        && self.static_inputs(right)?.contains("param.x");
                }
            }
            if !division {
                continue;
            }
            if x == 0 {
                if children.len() == 1 {
                    return Ok(true);
                }
                continue;
            }
            if children.len() != 2 {
                continue;
            }
            let rhs = self.walk(&[children[1]], false)?;
            if rhs.iter().any(|q| {
                matches!(self.graph[*q].kind, Kind::Binary(B::Divide))
                    && self.is_descendant(self.graph[*q].at, right)
            }) {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn countdown(&mut self, roots: &[usize]) -> Result<bool> {
        let count = self.request["input"]["values"]["n"].as_i64().unwrap() as usize;
        let numeric: Vec<_> = roots
            .iter()
            .copied()
            .filter(|p| !matches!(self.graph[*p].kind, Kind::Constant))
            .collect();
        if numeric.len() != count {
            return Ok(false);
        }
        let mut loop_site = None;
        for (i, p) in numeric.iter().enumerate() {
            if !self.affine_is(*p, "n", 1, -(i as i64))
                || self.graph[*p].value != (count - i) as i64
            {
                return Ok(false);
            }
            let Some(control) = self.loops_at(self.graph[*p].at)?.first().copied() else {
                return Ok(false);
            };
            if !matches!(
                self.checked.parsed.program.nodes[control].data,
                N::While { .. }
            ) || loop_site.is_some_and(|old| old != control)
            {
                return Ok(false);
            }
            loop_site = Some(control);
        }
        if let Some(control) = loop_site {
            let visits:Vec<_>=self.condition_events.iter().filter(|e|matches!(self.graph[e.proof].kind,Kind::Condition{control:p,taken:true}if p==control)).map(|e|e.proof).collect();
            return Ok(visits.len() == count);
        }
        for control in 0..self.checked.parsed.program.nodes.len() {
            if matches!(
                self.checked.parsed.program.nodes[control].data,
                N::While { .. }
            ) && let Some(expression) = self.condition_expression(control)
                && self.static_inputs(expression)?.contains("param.n")
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn guarded_access(&mut self, roots: &[usize], n: usize) -> Result<bool> {
        let k = self.request["input"]["values"]["k"].as_i64().unwrap();
        let legal = k >= 0 && (k as usize) < n;
        let reads = self.source_reads(roots)?;
        if legal && (reads.len() != 1 || reads[0].0 != k as usize) {
            return Ok(false);
        }
        if !legal&&self.reads.iter().any(|r|matches!(self.graph[r.proof].kind,Kind::Read{declaration,..}if self.binding.get(&declaration).is_some_and(|b|b=="param.values"))){return Ok(false);}
        let locations: Vec<_> = if legal {
            reads.iter().map(|r| r.1).collect()
        } else {
            self.outputs.iter().map(|e| e.at).collect()
        };
        let mut lower = false;
        let mut upper = false;
        for at in locations {
            for control in self.ancestors(at)? {
                if !matches!(
                    self.checked.parsed.program.nodes[control].data,
                    N::If { .. }
                ) {
                    continue;
                }
                let Some(expression) = self.condition_expression(control) else {
                    continue;
                };
                for p in self.ast_nodes(expression)? {
                    if let N::Expr(E::Binary {
                        op: B::Less | B::LessEqual | B::Greater | B::GreaterEqual,
                        left,
                        right,
                    }) = self.checked.parsed.program.nodes[p].data
                    {
                        let a = self.static_inputs(left)?;
                        let b = self.static_inputs(right)?;
                        lower |= (a.contains("param.k") && self.literal_ast(right)? == Some(0))
                            || (b.contains("param.k") && self.literal_ast(left)? == Some(0));
                        upper |= (a.contains("param.k") && b.contains("param.n"))
                            || (b.contains("param.k") && a.contains("param.n"));
                    }
                }
            }
        }
        Ok(if legal {
            lower && upper
        } else if k < 0 {
            lower
        } else {
            upper
        })
    }

    fn branch_target(
        &mut self,
        rule: &str,
        roots: &[usize],
        all: &BTreeSet<usize>,
    ) -> Result<bool> {
        if roots.len() != 1 {
            return Ok(false);
        }
        let mut relevant = BTreeSet::new();
        for proof in all {
            if let Kind::Condition { control, .. } = self.graph[*proof].kind {
                let set = self.walk(&[*proof], false)?;
                if self.has_input(&set, "x") {
                    relevant.insert(control);
                }
            }
        }
        let output_nodes: Vec<_> = self.outputs.iter().map(|event| event.at).collect();
        for output in output_nodes {
            for control in self.ancestors(output)? {
                if let Some(proof) = self.conditions.get(&control).copied() {
                    let set = self.walk(&[proof], false)?;
                    if self.has_input(&set, "x") {
                        relevant.insert(control);
                    }
                }
            }
        }
        let x = self.request["input"]["values"]["x"].as_i64().unwrap();
        match rule {
            "if-positive-normalize" => {
                if !self.affine_is(roots[0], "x", if x < 0 { -1 } else { 1 }, 0) {
                    return Ok(false);
                }
                let events: Vec<_> = self.condition_events.iter().map(|e| e.proof).collect();
                for proof in events {
                    if let Kind::Condition { control, taken } = self.graph[proof].kind {
                        if !matches!(
                            self.checked.parsed.program.nodes[control].data,
                            N::If {
                                else_block: None,
                                ..
                            }
                        ) || taken != (x < 0)
                        {
                            continue;
                        }
                        let set = self.walk(&[proof], false)?;
                        if self.has_input(&set, "x") && (x >= 0 || relevant.contains(&control)) {
                            self.target_controls.insert(control);
                            return Ok(true);
                        }
                    }
                }
                Ok(false)
            }
            "nested-sign-branches" => {
                // Value expressions may copy branch-assigned constants, but cannot
                // compute a sign independently and decorate it with unused branches.
                let data = self.walk(roots, false)?;
                if self.has_input(&data, "x") {
                    return Ok(false);
                }
                for outer in relevant {
                    if !matches!(
                        self.checked.parsed.program.nodes[outer].data,
                        N::If {
                            else_block: Some(_),
                            ..
                        }
                    ) {
                        continue;
                    }
                    for inner in 0..self.checked.parsed.program.nodes.len() {
                        charge(self.meter, 1)?;
                        if !matches!(
                            self.checked.parsed.program.nodes[inner].data,
                            N::If {
                                else_block: Some(_),
                                ..
                            }
                        ) || !self.is_descendant(inner, outer)
                        {
                            continue;
                        }
                        let Some(expression) = self.condition_expression(inner) else {
                            continue;
                        };
                        if !self.static_inputs(expression)?.contains("param.x") {
                            continue;
                        }
                        self.target_controls.extend([outer, inner]);
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            "interval-membership" => {
                for control in relevant {
                    if !matches!(
                        self.checked.parsed.program.nodes[control].data,
                        N::If {
                            else_block: Some(_),
                            ..
                        }
                    ) {
                        continue;
                    }
                    let set = self.condition_set(control)?;
                    if !(self.has_op(&set, B::And) || self.has_op(&set, B::Or)) {
                        continue;
                    }
                    let Some(expression) = self.condition_expression(control) else {
                        continue;
                    };
                    let mut todo = vec![expression];
                    let mut bounds = BTreeSet::new();
                    let mut comparisons = 0;
                    while let Some(at) = todo.pop() {
                        charge(self.meter, 1)?;
                        let n = self.checked.parsed.program.nodes[at].data.clone();
                        if let N::Expr(E::Binary {
                            op: B::Less | B::LessEqual | B::Greater | B::GreaterEqual,
                            left,
                            right,
                        }) = n
                        {
                            comparisons += 1;
                            for p in [left, right] {
                                if let Some(value) = self.literal_ast(p)? {
                                    bounds.insert(value);
                                }
                            }
                        }
                        todo.extend(n.children());
                    }
                    if comparisons >= 2 && bounds.contains(&-3) && bounds.contains(&7) {
                        self.target_controls.insert(control);
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            _ => Ok(false),
        }
    }

    fn is_descendant(&self, mut at: NodeId, parent: NodeId) -> bool {
        while let Some(p) = self.parents[at] {
            if p == parent {
                return true;
            }
            at = p;
        }
        false
    }
    fn odd_sum(&mut self, roots: &[usize], data: &BTreeSet<usize>) -> Result<bool> {
        if roots.len() != 1 {
            return Ok(false);
        }
        let n = self.request["input"]["values"]["n"].as_i64().unwrap();
        let stop = self.request["input"]["values"]["stop"].as_i64().unwrap();
        let expected: Vec<_> = (1..=n.min(stop)).filter(|i| i % 2 == 1).collect();
        for loop_at in 0..self.checked.parsed.program.nodes.len() {
            let Some(condition) = self.condition_expression(loop_at) else {
                continue;
            };
            if !matches!(
                self.checked.parsed.program.nodes[loop_at].data,
                N::While { .. } | N::For { .. }
            ) || !self.static_inputs(condition)?.contains("param.n")
            {
                continue;
            }
            let refs = self.references_in(condition)?;
            for counter in refs {
                if self.binding.contains_key(&counter) {
                    continue;
                }
                let N::Declaration {
                    initializer: Initializer::Scalar(initial),
                    ..
                } = self.checked.parsed.program.nodes[counter].data
                else {
                    continue;
                };
                if self.literal_ast(initial)? != Some(1) {
                    continue;
                }
                let mut break_if = None;
                let mut continue_if = None;
                let mut break_nodes = BTreeSet::new();
                let mut continue_nodes = BTreeSet::new();
                for at in 0..self.checked.parsed.program.nodes.len() {
                    let is_break = matches!(self.checked.parsed.program.nodes[at].data, N::Break);
                    let is_continue =
                        matches!(self.checked.parsed.program.nodes[at].data, N::Continue);
                    if !(is_break || is_continue) || self.loops_at(at)?.first() != Some(&loop_at) {
                        continue;
                    }
                    for control in self.ancestors(at)? {
                        if !matches!(
                            self.checked.parsed.program.nodes[control].data,
                            N::If { .. }
                        ) {
                            continue;
                        }
                        let expression = self.condition_expression(control).unwrap();
                        let names = self.references_in(expression)?;
                        if !names.contains(&counter) {
                            continue;
                        }
                        if is_break && self.static_inputs(expression)?.contains("param.stop") {
                            break_if = Some(control);
                            break_nodes.insert(at);
                            break;
                        }
                        if is_continue {
                            let mut modulo_two = false;
                            for p in self.ast_nodes(expression)? {
                                if let N::Expr(E::Binary {
                                    op: B::Remainder,
                                    right,
                                    ..
                                }) = self.checked.parsed.program.nodes[p].data
                                {
                                    modulo_two |= self.literal_ast(right)? == Some(2);
                                }
                            }
                            if modulo_two {
                                continue_if = Some(control);
                                continue_nodes.insert(at);
                                break;
                            }
                        }
                    }
                }
                let (Some(break_if), Some(continue_if)) = (break_if, continue_if) else {
                    continue;
                };
                let mut increments: BTreeMap<String, Vec<i64>> = BTreeMap::new();
                for p in data {
                    let Kind::Store {
                        object,
                        initial: false,
                        ..
                    } = self.graph[*p].kind.clone()
                    else {
                        continue;
                    };
                    if self.loops_at(self.graph[*p].at)?.first() != Some(&loop_at) {
                        continue;
                    }
                    let origin = self.graph[*p].data[0];
                    if !matches!(self.graph[origin].kind, Kind::Binary(B::Add))
                        || self.graph[origin].data.len() != 2
                    {
                        continue;
                    }
                    let children = self.graph[origin].data.clone();
                    for (a, b) in [(children[0], children[1]), (children[1], children[0])] {
                        let previous = self.walk(&[a], false)?;
                        let term = self.walk(&[b], false)?;
                        if previous.iter().any(|q|matches!(&self.graph[*q].kind,Kind::Read{object:o,..}if o==&object)) && term.iter().any(|q|matches!(self.graph[*q].kind,Kind::Read{declaration,..}if declaration==counter)) {
                            increments.entry(object.clone()).or_default().push(self.graph[b].value); break;
                        }
                    }
                }
                let broke = self.jumps.iter().any(|(at, _)| break_nodes.contains(at));
                let continued = self.jumps.iter().any(|(at, _)| continue_nodes.contains(at));
                if (increments.values().any(|items| items == &expected)
                    || expected.is_empty() && increments.is_empty())
                    && broke == (n > stop)
                    && continued == (n.min(stop) >= 2)
                {
                    self.target_controls.extend([break_if, continue_if]);
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn grid(&mut self, roots: &[usize], data: &BTreeSet<usize>) -> Result<bool> {
        if roots.len() != 1 {
            return Ok(false);
        }
        let rows = self.request["input"]["values"]["rows"].as_u64().unwrap() as usize;
        let cols = self.request["input"]["values"]["cols"].as_u64().unwrap() as usize;
        for inner in 0..self.checked.parsed.program.nodes.len() {
            if !matches!(
                self.checked.parsed.program.nodes[inner].data,
                N::While { .. } | N::For { .. }
            ) {
                continue;
            }
            let Some(inner_expression) = self.condition_expression(inner) else {
                continue;
            };
            let inner_inputs = self.static_inputs(inner_expression)?;
            for outer in self.loops_at(inner)? {
                let Some(outer_expression) = self.condition_expression(outer) else {
                    continue;
                };
                let outer_inputs = self.static_inputs(outer_expression)?;
                let outer_count = if inner_inputs.contains("param.cols")
                    && outer_inputs.contains("param.rows")
                {
                    rows
                } else if inner_inputs.contains("param.rows") && outer_inputs.contains("param.cols")
                {
                    cols
                } else {
                    continue;
                };
                let true_visits = |control| {
                    self.condition_events.iter().filter(|e|matches!(self.graph[e.proof].kind,Kind::Condition{control:p,taken:true}if p==control)).map(|e|e.proof).collect::<BTreeSet<_>>()
                };
                let inner_visits = true_visits(inner);
                let outer_visits = true_visits(outer);
                if inner_visits.len() != rows * cols || outer_visits.len() != outer_count {
                    continue;
                }
                let mut counts: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
                let mut wrong = BTreeSet::new();
                for p in data {
                    let Kind::Store {
                        object,
                        initial: false,
                        ..
                    } = self.graph[*p].kind.clone()
                    else {
                        continue;
                    };
                    if self.loops_at(self.graph[*p].at)?.first() != Some(&inner) {
                        continue;
                    }
                    let origin = self.graph[*p].data[0];
                    let children = self.graph[origin].data.clone();
                    if !matches!(self.graph[origin].kind, Kind::Binary(B::Add))
                        || children.len() != 2
                    {
                        continue;
                    }
                    let mut incremental = false;
                    for (a, b) in [(children[0], children[1]), (children[1], children[0])] {
                        let set = self.walk(&[a], false)?;
                        incremental|=self.literal(b)==Some(1)&&set.iter().any(|q|matches!(&self.graph[*q].kind,Kind::Read{object:o,..}if o==&object));
                    }
                    if !incremental {
                        continue;
                    }
                    if let Some(control) = self.graph[*p]
                        .controls
                        .iter()
                        .find(|q| inner_visits.contains(q))
                        && !counts.entry(object.clone()).or_default().insert(*control)
                    {
                        wrong.insert(object.clone());
                    }
                }
                if counts
                    .iter()
                    .any(|(object, visits)| !wrong.contains(object) && visits == &inner_visits)
                    || rows * cols == 0 && counts.is_empty()
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn extrema(&mut self, roots: &[usize], _all: &BTreeSet<usize>, n: usize) -> Result<bool> {
        if roots.len() != 2 || n == 0 || !self.has_loop_structure() {
            return Ok(false);
        }
        for root in roots {
            let data = self.walk(&[*root], false)?;
            let path = self.walk(&[*root], true)?;
            let mut proved = false;
            for initial in &path {
                let Kind::Store {
                    object,
                    declaration,
                    initial: true,
                    ..
                } = self.graph[*initial].kind.clone()
                else {
                    continue;
                };
                if self.binding.contains_key(&declaration) {
                    continue;
                }
                let first = self.source_reads(&self.graph[*initial].data.clone())?;
                if first.len() != 1 || first[0].0 != 0 {
                    continue;
                }
                let mut compared = BTreeSet::new();
                let mut controls = BTreeSet::new();
                let events: Vec<_> = self
                    .condition_events
                    .iter()
                    .map(|event| event.proof)
                    .collect();
                for proof in events {
                    let set = self.walk(&[proof], false)?;
                    if ![B::Less, B::Greater, B::LessEqual, B::GreaterEqual]
                        .iter()
                        .any(|op| self.has_op(&set, *op))
                        || !set.iter().any(
                            |p| matches!(&self.graph[*p].kind,Kind::Read{object:o,..}if o==&object),
                        )
                    {
                        continue;
                    }
                    let Kind::Condition { control, .. } = self.graph[proof].kind else {
                        unreachable!()
                    };
                    let body_writes = match self.checked.parsed.program.nodes[control].data {
                        N::If {
                            then_block,
                            else_block,
                            ..
                        } => {
                            self.statement_writes(then_block, declaration)?
                                || if let Some(body) = else_block {
                                    self.statement_writes(body, declaration)?
                                } else {
                                    false
                                }
                        }
                        N::For { body, .. } | N::While { body, .. } => {
                            self.statement_writes(body, declaration)?
                        }
                        _ => false,
                    };
                    if !body_writes {
                        continue;
                    }
                    let reads = self.source_reads(&[proof])?;
                    if !reads.is_empty() {
                        compared.extend(reads.iter().map(|read| read.0));
                        controls.insert(proof);
                    }
                }
                if n > 1 && !(1..n).all(|index| compared.contains(&index)) {
                    continue;
                }
                let mut valid = true;
                for p in &data {
                    let Kind::Store {
                        object: o,
                        initial: false,
                        ..
                    } = self.graph[*p].kind.clone()
                    else {
                        continue;
                    };
                    if o != object {
                        continue;
                    }
                    let origin = self.graph[*p].data[0];
                    let reads = self.source_reads(&[origin])?;
                    if reads.len() != 1
                        || !self.affine_is(origin, "values", 1, 0)
                            && !self.graph[origin].affine.as_ref().is_some_and(
                                |(constant, terms)| {
                                    *constant == 0
                                        && terms.len() == 1
                                        && terms.get(&("param.values".to_owned(), reads[0].0))
                                            == Some(&1)
                                },
                            )
                        || !self.graph[*p]
                            .controls
                            .iter()
                            .any(|proof| controls.contains(proof))
                    {
                        valid = false;
                        break;
                    }
                }
                if valid {
                    proved = true;
                    break;
                }
            }
            if !proved {
                return Ok(false);
            }
        }
        Ok(true)
    }
    fn positive_count(
        &mut self,
        roots: &[usize],
        _all: &BTreeSet<usize>,
        values: &[i64],
    ) -> Result<bool> {
        if roots.len() != 1 || !self.has_loop_structure() {
            return Ok(false);
        }
        let data = self.walk(roots, false)?;
        let declarations: BTreeSet<_> = data
            .iter()
            .filter_map(|p| match self.graph[*p].kind {
                Kind::Read { declaration, .. } => Some(declaration),
                _ => None,
            })
            .collect();
        for declaration in declarations {
            if self.binding.contains_key(&declaration) {
                continue;
            }
            let N::Declaration {
                initializer: Initializer::Scalar(initial),
                ..
            } = self.checked.parsed.program.nodes[declaration].data
            else {
                continue;
            };
            if self.literal_ast(initial)? != Some(0) {
                continue;
            }
            for control in 0..self.checked.parsed.program.nodes.len() {
                let N::If { then_block, .. } = self.checked.parsed.program.nodes[control].data
                else {
                    continue;
                };
                if self.loops_at(control)?.is_empty()
                    || !self.statement_writes(then_block, declaration)?
                {
                    continue;
                }
                let events:Vec<_>=self.condition_events.iter().filter(|e|matches!(self.graph[e.proof].kind,Kind::Condition{control:p,..}if p==control)).map(|e|e.proof).collect();
                let mut indices = vec![];
                let mut positive_proofs = BTreeSet::new();
                let mut valid = true;
                for proof in events {
                    let set = self.walk(&[proof], false)?;
                    let reads = self.source_reads(&[proof])?;
                    if reads.len() != 1
                        || !(self.has_op(&set, B::Greater) || self.has_op(&set, B::Less))
                    {
                        valid = false;
                        break;
                    }
                    let index = reads[0].0;
                    if index >= values.len() {
                        valid = false;
                        break;
                    }
                    indices.push(index);
                    let Kind::Condition { taken, .. } = self.graph[proof].kind else {
                        unreachable!()
                    };
                    if taken != (values[index] > 0) {
                        valid = false;
                        break;
                    }
                    if taken {
                        positive_proofs.insert(proof);
                    }
                }
                if !valid || indices != (0..values.len()).collect::<Vec<_>>() {
                    continue;
                }
                let mut contributions = BTreeSet::new();
                let mut wrong = false;
                for p in &data {
                    let Kind::Store {
                        declaration: d,
                        initial: false,
                        object,
                        ..
                    } = self.graph[*p].kind.clone()
                    else {
                        continue;
                    };
                    if d != declaration {
                        continue;
                    }
                    let origin = self.graph[*p].data[0];
                    let children = self.graph[origin].data.clone();
                    if !matches!(self.graph[origin].kind, Kind::Binary(B::Add))
                        || children.len() != 2
                    {
                        wrong = true;
                        break;
                    }
                    let mut self_increment = false;
                    for (a, b) in [(children[0], children[1]), (children[1], children[0])] {
                        let set = self.walk(&[a], false)?;
                        self_increment|=self.literal(b)==Some(1)&&set.iter().any(|q|matches!(&self.graph[*q].kind,Kind::Read{object:o,..}if o==&object));
                    }
                    let proof = self.graph[*p]
                        .controls
                        .iter()
                        .find(|q| positive_proofs.contains(q))
                        .copied();
                    if !self_increment || proof.is_none() || !contributions.insert(proof.unwrap()) {
                        wrong = true;
                        break;
                    }
                }
                if !wrong && contributions == positive_proofs {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn linear_search(
        &mut self,
        roots: &[usize],
        all: &BTreeSet<usize>,
        values: &[i64],
    ) -> Result<bool> {
        if roots.len() != 1 || !self.has_loop_structure() {
            return Ok(false);
        }
        let target = self.request["input"]["values"]["target"].as_i64().unwrap();
        let expected = values.iter().position(|v| *v == target);
        let data = self.walk(roots, false)?;
        let outputs: BTreeSet<_> = data
            .iter()
            .filter_map(|p| match self.graph[*p].kind {
                Kind::Read { declaration, .. } => Some(declaration),
                _ => None,
            })
            .collect();
        for control in 0..self.checked.parsed.program.nodes.len() {
            let N::If {
                then_block,
                else_block,
                ..
            } = self.checked.parsed.program.nodes[control].data
            else {
                continue;
            };
            let Some(expression) = self.condition_expression(control) else {
                continue;
            };
            let static_inputs = self.static_inputs(expression)?;
            if !static_inputs.contains("param.values") || !static_inputs.contains("param.target") {
                continue;
            }
            let nodes = self.ast_nodes(expression)?;
            if !nodes.iter().any(|p| {
                matches!(
                    self.checked.parsed.program.nodes[*p].data,
                    N::Expr(E::Binary { op: B::Equal, .. })
                )
            }) {
                continue;
            }
            let mut assigned_output = false;
            for declaration in &outputs {
                assigned_output |= self.statement_writes(then_block, *declaration)?
                    || else_block.is_some_and(|body| {
                        self.statement_writes(body, *declaration).unwrap_or(false)
                    });
            }
            if !assigned_output {
                continue;
            }
            let events:Vec<_>=self.condition_events.iter().filter(|e|matches!(self.graph[e.proof].kind,Kind::Condition{control:p,..}if p==control)).map(|e|e.proof).collect();
            let mut indices = vec![];
            let mut valid = true;
            let mut counter_declarations = BTreeSet::new();
            for proof in events {
                let mut reads = self.source_reads(&[proof])?;
                reads.sort_by_key(|r| r.2);
                for (index, at, _) in reads {
                    indices.push(index);
                    if let N::Expr(E::Index { index: operand, .. }) =
                        self.checked.parsed.program.nodes[at].data
                    {
                        if let Some(declaration) = self.reference(operand)? {
                            counter_declarations.insert(declaration);
                        } else {
                            valid = false;
                        }
                    } else {
                        valid = false;
                    }
                }
            }
            let prefix: Vec<_> = (0..expected.map_or(values.len(), |i| i + 1)).collect();
            if !valid || !(indices == prefix || indices == (0..values.len()).collect::<Vec<_>>()) {
                continue;
            }
            if let Some(index) = expected {
                let effective = all.iter().any(
                    |p| matches!(self.graph[*p].kind,Kind::Condition{control:p,..}if p==control),
                );
                let counter_read=data.iter().any(|p|matches!(self.graph[*p].kind,Kind::Read{declaration,..}if counter_declarations.contains(&declaration)) && self.graph[*p].value==index as i64);
                if !effective || !counter_read {
                    continue;
                }
            } else {
                let initial = data.iter().any(|p| {
                    matches!(self.graph[*p].kind, Kind::Store { initial: true, .. })
                        && self.graph[*p].value == -1
                });
                if !initial {
                    continue;
                }
            }
            return Ok(true);
        }
        Ok(false)
    }

    fn adjacent_order(
        &mut self,
        roots: &[usize],
        all: &BTreeSet<usize>,
        values: &[i64],
    ) -> Result<bool> {
        if roots.len() != 1 || !self.has_loop_structure() {
            return Ok(false);
        }
        let data = self.walk(roots, false)?;
        let declarations: BTreeSet<_> = data
            .iter()
            .filter_map(|p| match self.graph[*p].kind {
                Kind::Read { declaration, .. } => Some(declaration),
                _ => None,
            })
            .collect();
        let first_bad = values.windows(2).position(|w| w[0] > w[1]);
        for declaration in declarations {
            let N::Declaration {
                initializer: Initializer::Scalar(initial),
                ..
            } = self.checked.parsed.program.nodes[declaration].data
            else {
                continue;
            };
            if self.literal_ast(initial)? != Some(1) {
                continue;
            }
            for control in 0..self.checked.parsed.program.nodes.len() {
                let N::If {
                    then_block,
                    else_block,
                    ..
                } = self.checked.parsed.program.nodes[control].data
                else {
                    continue;
                };
                if self.loops_at(control)?.is_empty() {
                    continue;
                }
                let writes_then = self.statement_writes(then_block, declaration)?;
                let writes_else = if let Some(body) = else_block {
                    self.statement_writes(body, declaration)?
                } else {
                    false
                };
                if !(writes_then || writes_else) {
                    continue;
                }
                let events:Vec<_>=self.condition_events.iter().filter(|e|matches!(self.graph[e.proof].kind,Kind::Condition{control:p,..}if p==control)).map(|e|e.proof).collect();
                let mut pairs = vec![];
                let mut valid = true;
                for proof in events {
                    let set = self.walk(&[proof], false)?;
                    let mut reads = self.source_reads(&[proof])?;
                    reads.sort_by_key(|r| (r.2, r.1));
                    if reads.len() != 2
                        || ![B::Greater, B::Less, B::LessEqual, B::GreaterEqual]
                            .iter()
                            .any(|op| self.has_op(&set, *op))
                    {
                        valid = false;
                        break;
                    }
                    let mut pair = [reads[0].0, reads[1].0];
                    pair.sort_unstable();
                    pairs.push((pair[0], pair[1]));
                }
                let prefix = (0..first_bad.map_or(values.len().saturating_sub(1), |i| i + 1))
                    .map(|i| (i, i + 1))
                    .collect::<Vec<_>>();
                let complete = (0..values.len().saturating_sub(1))
                    .map(|i| (i, i + 1))
                    .collect::<Vec<_>>();
                if !valid || !(pairs == prefix || pairs == complete) {
                    continue;
                }
                if first_bad.is_some()&&!all.iter().any(|p|matches!(self.graph[*p].kind,Kind::Condition{control:p,..}if p==control)){continue;}
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn comparison_reads(&mut self, p: usize) -> Result<Option<(usize, usize)>> {
        let data = self.graph[p].data.clone();
        if data.len() != 2 {
            return Ok(None);
        }
        let a = self.source_reads(&[data[0]])?;
        let b = self.source_reads(&[data[1]])?;
        Ok(if a.len() == 1 && b.len() == 1 {
            Some((a[0].0, b[0].0))
        } else {
            None
        })
    }
    fn sort_target(
        &mut self,
        rule: &str,
        _roots: &[usize],
        _all: &BTreeSet<usize>,
        values: &[i64],
    ) -> Result<bool> {
        let n = values.len();
        if self.destroyed.len() != 1
            || self.destroyed[0]["values"] != self.request["judge"]["expectedArray"]
        {
            return Ok(false);
        }
        let loops: Vec<_> = self
            .checked
            .parsed
            .program
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| matches!(n.data, N::While { .. } | N::For { .. }))
            .map(|(i, _)| i)
            .collect();
        if !loops
            .iter()
            .any(|a| loops.iter().any(|b| a != b && self.is_descendant(*b, *a)))
        {
            return Ok(false);
        }
        let mut comps = vec![];
        for p in 0..self.graph.len() {
            if matches!(self.graph[p].kind, Kind::Binary(B::Greater | B::Less))
                && let Some((a, b)) = self.comparison_reads(p)?
            {
                comps.push((self.graph[p].seq, a, b, self.graph[p].value != 0));
            }
        }
        let writes: Vec<_> = self
            .stores
            .iter()
            .filter_map(|s| match &self.graph[s.proof].kind {
                Kind::Store {
                    declaration,
                    index,
                    initial: false,
                    ..
                } if self
                    .binding
                    .get(declaration)
                    .is_some_and(|k| k == "param.values") =>
                {
                    Some((s.seq, *index, self.graph[s.proof].value))
                }
                _ => None,
            })
            .collect();
        let mut at = 0;
        let mut expected_writes = vec![];
        let mut current = values.to_vec();
        if rule == "bubble-ascending" {
            for end in (1..n).rev() {
                for j in 0..end {
                    charge(self.meter, 1)?;
                    let Some(&(seq, a, b, take)) = comps.get(at) else {
                        return Ok(false);
                    };
                    if (a, b) != (j, j + 1) || take != (current[j] > current[j + 1]) {
                        return Ok(false);
                    }
                    if take {
                        expected_writes.push((seq, j, current[j + 1]));
                        expected_writes.push((seq, j + 1, current[j]));
                        current.swap(j, j + 1);
                    }
                    at += 1;
                }
            }
            if self
                .jumps
                .iter()
                .any(|(p, _)| matches!(self.checked.parsed.program.nodes[*p].data, N::Break))
            {
                return Ok(false);
            }
        } else {
            for i in 0..n.saturating_sub(1) {
                let mut min = i;
                let mut seq = 0;
                for j in i + 1..n {
                    charge(self.meter, 1)?;
                    let Some(&(s, a, b, take)) = comps.get(at) else {
                        return Ok(false);
                    };
                    if (a, b) != (j, min) || take != (current[j] < current[min]) {
                        return Ok(false);
                    }
                    if take {
                        min = j;
                    }
                    at += 1;
                    seq = s;
                }
                if min != i {
                    expected_writes.push((seq, i, current[min]));
                    expected_writes.push((seq, min, current[i]));
                    current.swap(i, min);
                }
            }
        }
        if at != comps.len() || writes.len() != expected_writes.len() {
            return Ok(false);
        }
        Ok(writes
            .iter()
            .zip(expected_writes)
            .all(|((seq, index, value), (after, i, v))| *seq > after && *index == i && *value == v))
    }
    fn safe_midpoint(&mut self, declaration: NodeId) -> Result<Option<(NodeId, NodeId)>> {
        let N::Declaration {
            initializer: Initializer::Scalar(at),
            ..
        } = self.checked.parsed.program.nodes[declaration].data
        else {
            return Ok(None);
        };
        let N::Expr(E::Binary {
            op: B::Add,
            left: a,
            right: b,
        }) = self.checked.parsed.program.nodes[at].data
        else {
            return Ok(None);
        };
        for (left, quotient) in [(a, b), (b, a)] {
            let Some(left_decl) = self.reference(left)? else {
                continue;
            };
            let N::Expr(E::Binary {
                op: B::Divide,
                left: difference,
                right: two,
            }) = self.checked.parsed.program.nodes[quotient].data
            else {
                continue;
            };
            if self.literal_ast(two)? != Some(2) {
                continue;
            }
            let N::Expr(E::Binary {
                op: B::Subtract,
                left: right,
                right: left_again,
            }) = self.checked.parsed.program.nodes[difference].data
            else {
                continue;
            };
            if self.reference(left_again)? != Some(left_decl) {
                continue;
            }
            if let Some(right_decl) = self.reference(right)? {
                return Ok(Some((left_decl, right_decl)));
            }
        }
        Ok(None)
    }
    fn binary_search(
        &mut self,
        roots: &[usize],
        all: &BTreeSet<usize>,
        values: &[i64],
    ) -> Result<bool> {
        if roots.len() != 1 || !self.has_loop_structure() {
            return Ok(false);
        }
        let target = self.request["input"]["values"]["target"].as_i64().unwrap();
        let mut left = 0i64;
        let mut right = values.len() as i64 - 1;
        let mut expected = vec![];
        while left <= right {
            charge(self.meter, 1)?;
            let mid = left + (right - left) / 2;
            expected.push(mid as usize);
            if values[mid as usize] >= target {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        let mut actual = vec![];
        let mut midpoint = None;
        let mut loop_site = None;
        let source_reads:Vec<_>=self.reads.iter().filter(|event|matches!(self.graph[event.proof].kind,Kind::Read{declaration,..}if self.binding.get(&declaration).is_some_and(|binding|binding=="param.values"))).map(|event|(event.at,event.proof)).collect();
        for (at, proof) in source_reads {
            let Kind::Read { index, .. } = self.graph[proof].kind else {
                unreachable!()
            };
            actual.push(index);
            let N::Expr(E::Index { index: operand, .. }) =
                self.checked.parsed.program.nodes[at].data
            else {
                return Ok(false);
            };
            let Some(declaration) = self.reference(operand)? else {
                return Ok(false);
            };
            if midpoint.is_some_and(|old| old != declaration) {
                return Ok(false);
            }
            midpoint = Some(declaration);
            let Some(control) = self.loops_at(at)?.first().copied() else {
                return Ok(false);
            };
            if loop_site.is_some_and(|old| old != control) {
                return Ok(false);
            }
            loop_site = Some(control);
        }
        actual.dedup();
        if actual != expected {
            return Ok(false);
        }
        let midpoints: Vec<_> = if let Some(at) = midpoint {
            vec![at]
        } else {
            self.checked
                .declarations
                .iter()
                .map(|d| d.node_id)
                .collect()
        };
        let mut valid_structure = false;
        for mid in midpoints {
            let Some((left, right)) = self.safe_midpoint(mid)? else {
                continue;
            };
            let N::Declaration {
                initializer: Initializer::Scalar(initial),
                ..
            } = self.checked.parsed.program.nodes[left].data
            else {
                continue;
            };
            if self.literal_ast(initial)? != Some(0) {
                continue;
            }
            let N::Declaration {
                initializer: Initializer::Scalar(initial),
                ..
            } = self.checked.parsed.program.nodes[right].data
            else {
                continue;
            };
            let N::Expr(E::Binary {
                op: B::Subtract,
                left: n,
                right: one,
            }) = self.checked.parsed.program.nodes[initial].data
            else {
                continue;
            };
            if self.literal_ast(one)? != Some(1) || !self.static_inputs(n)?.contains("param.n") {
                continue;
            }
            let controls: Vec<_> = if let Some(control) = loop_site {
                vec![control]
            } else {
                self.loops_at(mid)?
            };
            for control in controls {
                let Some(expression) = self.condition_expression(control) else {
                    continue;
                };
                let closed = match self.checked.parsed.program.nodes[expression].data {
                    N::Expr(E::Binary {
                        op: B::LessEqual,
                        left: a,
                        right: b,
                    }) => self.reference(a)? == Some(left) && self.reference(b)? == Some(right),
                    N::Expr(E::Binary {
                        op: B::GreaterEqual,
                        left: a,
                        right: b,
                    }) => self.reference(a)? == Some(right) && self.reference(b)? == Some(left),
                    _ => false,
                };
                if !closed {
                    continue;
                }
                let visits=self.condition_events.iter().filter(|event|matches!(self.graph[event.proof].kind,Kind::Condition{control:p,taken:true}if p==control)).count();
                if visits != expected.len() {
                    continue;
                }
                let mut left_update = false;
                let mut right_update = false;
                for at in self.ast_nodes(control)? {
                    let N::Assignment { target, value } =
                        self.checked.parsed.program.nodes[at].data
                    else {
                        continue;
                    };
                    let target = self.reference(target)?;
                    match self.checked.parsed.program.nodes[value].data {
                        N::Expr(E::Binary {
                            op: B::Add,
                            left: a,
                            right: b,
                        }) => {
                            left_update |= target == Some(left)
                                && ((self.reference(a)? == Some(mid)
                                    && self.literal_ast(b)? == Some(1))
                                    || (self.reference(b)? == Some(mid)
                                        && self.literal_ast(a)? == Some(1)));
                        }
                        N::Expr(E::Binary {
                            op: B::Subtract,
                            left: a,
                            right: b,
                        }) => {
                            right_update |= target == Some(right)
                                && self.reference(a)? == Some(mid)
                                && self.literal_ast(b)? == Some(1);
                        }
                        _ => {}
                    }
                }
                if left_update && right_update {
                    valid_structure = true;
                }
            }
        }
        if !valid_structure {
            return Ok(false);
        }
        let data = self.walk(roots, false)?;
        if let Some(index) = values.iter().position(|v| *v == target) {
            if !self.has_op(&data, B::Divide) {
                return Ok(false);
            }
            for p in all {
                if !matches!(self.graph[*p].kind, Kind::Condition { .. }) {
                    continue;
                }
                let set = self.walk(&[*p], false)?;
                if self.has_op(&set, B::Equal)
                    && self.has_input(&set, "target")
                    && self.source_reads(&[*p])?.iter().any(|r| r.0 == index)
                {
                    return Ok(true);
                }
            }
            Ok(false)
        } else {
            let mut initial = false;
            for p in data {
                if let Kind::Store {
                    initial: is_initial,
                    ..
                } = self.graph[p].kind
                {
                    if is_initial && self.literal(p) == Some(-1) {
                        initial = true;
                    }
                    if !is_initial
                        && !self.graph[p]
                            .data
                            .iter()
                            .any(|q| matches!(self.graph[*q].kind, Kind::Read { .. }))
                    {
                        return Ok(false);
                    }
                }
            }
            Ok(initial)
        }
    }
}

pub(super) fn evaluate(
    request: &Value,
    checked: &CheckedProgram,
    trace: &Trace,
    exit: Option<i32>,
    meter: &mut Meter,
) -> Result<Value> {
    if matches!(
        request["judge"]["rule"].as_str(),
        Some("bubble-ascending" | "selection-ascending")
    ) {
        return sorting_evaluate(request, checked, trace, exit, meter);
    }
    let mut model = Evidence::new(request, checked, meter)?;
    for step in &trace.steps {
        model.step(step)?;
    }
    let target = model.target()?;
    let coverage = model.coverage()?;
    let stdout = model.stdout == request["judge"]["expectedStdout"];
    let exit = exit == Some(0);
    let mut nodes = BTreeSet::new();
    let mut seqs = BTreeSet::new();
    for o in &model.outputs {
        nodes.insert(o.at);
        seqs.insert(o.seq);
    }
    let nodes: Vec<_> = nodes.into_iter().collect();
    let seqs: Vec<_> = seqs.into_iter().collect();
    let checks: Vec<_> = [
        ("input-bindings", true, "J_BINDING_MISMATCH"),
        ("stdout-exact", stdout, "J_STDOUT_MISMATCH"),
        ("exit-zero", exit, "J_EXIT_NONZERO"),
        ("teaching-target", target, "J_TEACHING_TARGET"),
    ]
    .into_iter()
    .map(|(key, met, code)| {
        check(
            key,
            if met { "met" } else { "unmet" },
            &nodes,
            &seqs,
            (!met).then_some(code),
        )
    })
    .collect();
    Ok(
        json!({"profileRef":request["judge"]["profileRef"],"caseKey":request["identity"]["testCaseKey"],"status":if target&&stdout&&exit{"met"}else{"unmet"},"checks":checks,"coverage":coverage,"observations":model.destroyed}),
    )
}

/// Sorting has a long mutation chain at n=30. Its frozen comparison and swap
/// schedule can be checked in one streaming pass instead of expanding that
/// chain into the general scalar provenance arena.
fn sorting_evaluate(
    request: &Value,
    checked: &CheckedProgram,
    trace: &Trace,
    exit: Option<i32>,
    meter: &mut Meter,
) -> Result<Value> {
    let nodes = &checked.parsed.program.nodes;
    let mut references = vec![None; nodes.len()];
    charge(meter, nodes.len() + checked.references.len())?;
    for r in &checked.references {
        references[r.expression_node] = Some(r.declaration_node);
    }
    let mut parents = vec![None; nodes.len()];
    for (p, n) in nodes.iter().enumerate() {
        let children = n.data.children();
        charge(meter, 1 + children.len())?;
        for c in children {
            parents[c] = Some(p);
        }
    }
    let mut declaration = None;
    for b in request["source"]["bindingMap"].as_array().unwrap() {
        if b["bindingKey"] == "param.values" {
            for d in &checked.declarations {
                charge(meter, 1)?;
                let range = nodes[d.node_id].byte_range;
                if b["byteRange"]["start"].as_u64() == Some(range.start as u64)
                    && b["byteRange"]["end"].as_u64() == Some(range.end as u64)
                {
                    declaration = Some(d.node_id);
                }
            }
        }
    }
    let mut nested = false;
    for (p, n) in nodes.iter().enumerate() {
        if matches!(n.data, N::While { .. } | N::For { .. }) {
            let mut next = parents[p];
            while let Some(a) = next {
                charge(meter, 1)?;
                nested |= matches!(nodes[a].data, N::While { .. } | N::For { .. });
                next = parents[a];
            }
        }
    }
    let input: Vec<i64> = request["input"]["values"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let len = input.len();
    let mut source_object = None;
    let mut source_cells = BTreeMap::new();
    let mut origins: BTreeMap<NodeId, usize> = BTreeMap::new();
    let mut comparisons = vec![];
    let mut writes = vec![];
    let mut observations = vec![];
    let mut stdout = String::new();
    let mut outputs = vec![];
    let mut broken = false;
    charge(meter, nodes.len())?;
    let mut observation_index = vec![None; nodes.len()];
    for step in &trace.steps {
        charge(meter, 1)?;
        if !matches!(
            step.kind.as_str(),
            "condition"
                | "value.initialize"
                | "value.write"
                | "output.append"
                | "scope.exit"
                | "program.return"
        ) {
            continue;
        }
        let at = id(&step.location["nodeId"]);
        let mut step_observations = SortingObservations {
            observations: &step.observations,
            index: &mut observation_index,
            sequence: step.seq,
            indexed: step.kind == "condition",
            ready: false,
        };
        let assigned = at.and_then(|at| match nodes[at].data {
            N::Assignment { value, .. }
            | N::Declaration {
                initializer: Initializer::Scalar(value),
                ..
            } => Some(value),
            _ => None,
        });
        let scalar_target = at.and_then(|p| match nodes[p].data {
            N::Declaration {
                array_length: None, ..
            } => Some(p),
            N::Assignment { target, .. } if matches!(nodes[target].data, N::Expr(E::Name(_))) => {
                references[target]
            }
            _ => None,
        });
        if let Some(target) = scalar_target {
            // Array writes are proved below from their committed cell changes.
            // Only scalar copies need a temporary-value origin. Computing an
            // unused origin for both writes of every swap repeatedly scanned
            // observations without contributing to any teaching check.
            let origin = if let (Some(value), Some(source)) = (assigned, source_object.as_deref()) {
                sorting_origin(
                    value,
                    checked,
                    &references,
                    &mut step_observations,
                    &origins,
                    source,
                    meter,
                )?
            } else {
                None
            };
            charge(meter, 1)?;
            if let Some((i, _)) = origin {
                origins.insert(target, i);
            } else {
                origins.remove(&target);
            }
            continue;
        }
        if step.kind == "condition"
            && let Some(at) = at
            && let N::Condition { expression: p } = nodes[at].data
            && let N::Expr(E::Binary { op, left, right }) = nodes[p].data
            && matches!(op, B::Less | B::Greater)
            && let Some(source) = source_object.as_deref()
        {
            let a = sorting_origin(
                left,
                checked,
                &references,
                &mut step_observations,
                &origins,
                source,
                meter,
            )?;
            let b = sorting_origin(
                right,
                checked,
                &references,
                &mut step_observations,
                &origins,
                source,
                meter,
            )?;
            if let (Some((a, av)), Some((b, bv))) = (a, b) {
                let o = step_observations.get(p, meter)?.unwrap();
                comparisons.push((
                    step.seq,
                    p,
                    op,
                    a,
                    b,
                    av,
                    bv,
                    o["value"].as_i64().unwrap() != 0,
                ));
            }
        }
        if at.is_some_and(|p| matches!(nodes[p].data, N::Break | N::Continue)) {
            broken = true;
        }
        if step.kind == "output.append"
            && let Some(p) = at
        {
            outputs.push((p, step.seq));
        }
        for change in &step.changes {
            charge(meter, 1)?;
            if change["op"] == "output" {
                let text = change["append"].as_str().unwrap();
                charge(meter, text.len().div_ceil(64))?;
                stdout.push_str(text);
            }
            if change["op"] == "record" && change["table"] == "objects" {
                let object = change["id"].as_str().unwrap();
                let after = &change["after"];
                if after.is_null() {
                    if source_object.as_deref() == Some(object) {
                        let values: Vec<_> = (0..len).map(|i| source_cells[&i]).collect();
                        charge(meter, len + 1)?;
                        observations.push(json!({"kind":"array-before-destroy","bindingKey":"param.values","objectId":object,"declarationNodeId":node(declaration.unwrap()),"beforeCursor":step.seq-1,"location":step.location,"values":values}));
                    }
                    continue;
                }
                if id(&after["declarationNodeId"]) == declaration {
                    source_object = Some(object.to_owned());
                    if step.kind == "value.initialize" {
                        for i in 0..after["length"].as_u64().unwrap() as usize {
                            charge(meter, 1)?;
                            let value = after["cells"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .find(|c| c["index"].as_u64() == Some(i as u64))
                                .map(|c| &c["value"])
                                .unwrap_or(&after["defaultValue"])
                                .as_i64()
                                .unwrap();
                            source_cells.insert(i, value);
                        }
                    }
                }
            }
            if change["op"] == "cell" {
                let object = change["objectId"].as_str().unwrap();
                let index = change["index"].as_u64().unwrap() as usize;
                let value = change["after"].as_i64().unwrap();
                if source_object.as_deref() == Some(object) {
                    source_cells.insert(index, value);
                    if step.kind == "value.write" {
                        writes.push((step.seq, index, value));
                    }
                }
            }
        }
    }
    let bubble = request["judge"]["rule"] == "bubble-ascending";
    let mut current = input.clone();
    let mut position = 0;
    let mut wanted_writes = vec![];
    let mut schedule = true;
    if bubble {
        for end in (1..len).rev() {
            for j in 0..end {
                charge(meter, 1)?;
                if let Some(&(seq, _, op, a, b, av, bv, take)) = comparisons.get(position) {
                    let (a, b, av, bv) = if op == B::Greater {
                        (a, b, av, bv)
                    } else {
                        (b, a, bv, av)
                    };
                    schedule &= (a, b) == (j, j + 1)
                        && (av, bv) == (current[j], current[j + 1])
                        && take == (av > bv);
                    if take {
                        wanted_writes.push((seq, j, current[j + 1]));
                        wanted_writes.push((seq, j + 1, current[j]));
                        current.swap(j, j + 1);
                    }
                } else {
                    schedule = false;
                }
                position += 1;
            }
        }
    } else {
        for i in 0..len.saturating_sub(1) {
            let mut min = i;
            let mut seq = 0;
            for j in i + 1..len {
                charge(meter, 1)?;
                if let Some(&(s, _, op, a, b, av, bv, take)) = comparisons.get(position) {
                    seq = s;
                    let (a, b, av, bv) = if op == B::Less {
                        (a, b, av, bv)
                    } else {
                        (b, a, bv, av)
                    };
                    schedule &= (a, b) == (j, min)
                        && (av, bv) == (current[j], current[min])
                        && take == (av < bv);
                    if take {
                        min = j;
                    }
                } else {
                    schedule = false;
                }
                position += 1;
            }
            if min != i {
                wanted_writes.push((seq, i, current[min]));
                wanted_writes.push((seq, min, current[i]));
                current.swap(i, min);
            }
        }
    }
    schedule &= position == comparisons.len() && writes.len() == wanted_writes.len();
    for ((seq, index, value), (after, i, v)) in writes.iter().zip(wanted_writes) {
        charge(meter, 1)?;
        schedule &= *seq > after && *index == i && *value == v;
    }
    let target = nested
        && !broken
        && schedule
        && observations.len() == 1
        && observations[0]["values"] == request["judge"]["expectedArray"];
    let out = stdout == request["judge"]["expectedStdout"];
    let zero = exit == Some(0);
    let mut output_nodes = BTreeSet::new();
    let mut output_steps = BTreeSet::new();
    for (n, s) in outputs {
        output_nodes.insert(n);
        output_steps.insert(s);
    }
    let ns: Vec<_> = output_nodes.into_iter().collect();
    let ss: Vec<_> = output_steps.into_iter().collect();
    let checks: Vec<_> = [
        ("input-bindings", true, "J_BINDING_MISMATCH"),
        ("stdout-exact", out, "J_STDOUT_MISMATCH"),
        ("exit-zero", zero, "J_EXIT_NONZERO"),
        ("teaching-target", target, "J_TEACHING_TARGET"),
    ]
    .into_iter()
    .map(|(key, met, code)| {
        check(
            key,
            if met { "met" } else { "unmet" },
            &ns,
            &ss,
            (!met).then_some(code),
        )
    })
    .collect();
    Ok(
        json!({"profileRef":request["judge"]["profileRef"],"caseKey":request["identity"]["testCaseKey"],"status":if target&&out&&zero{"met"}else{"unmet"},"checks":checks,"coverage":[],"observations":observations}),
    )
}
fn sorting_origin(
    at: NodeId,
    checked: &CheckedProgram,
    references: &[Option<NodeId>],
    obs: &mut SortingObservations<'_, '_>,
    origins: &BTreeMap<NodeId, usize>,
    source: &str,
    meter: &mut Meter,
) -> Result<Option<(usize, i64)>> {
    charge(meter, 1)?;
    match checked.parsed.program.nodes[at].data {
        N::Expr(E::Name(_)) => {
            let declaration = references[at];
            if let Some(index) = declaration.and_then(|d| origins.get(&d)) {
                let o = obs.get(at, meter)?.unwrap();
                Ok(Some((*index, o["value"].as_i64().unwrap())))
            } else {
                Ok(None)
            }
        }
        N::Expr(E::Index { .. }) => {
            let Some(o) = obs.get(at, meter)? else {
                return Ok(None);
            };
            let object = o["objectId"].as_str().unwrap();
            let value = o["value"].as_i64().unwrap();
            Ok(if object == source {
                Some((o["index"].as_u64().unwrap() as usize, value))
            } else {
                None
            })
        }
        N::Expr(E::Unary {
            op: U::Plus,
            operand,
        }) => sorting_origin(operand, checked, references, obs, origins, source, meter),
        N::Expr(E::Binary {
            op: B::Add | B::Subtract,
            left,
            right,
        }) if matches!(
            checked.parsed.program.nodes[right].data,
            N::Expr(E::Integer(0))
        ) =>
        {
            sorting_origin(left, checked, references, obs, origins, source, meter)
        }
        _ => Ok(None),
    }
}
/// A comparison asks for both operands and its decision. Index those real
/// observations once instead of repeatedly scanning the same expression list.
/// Sequence tags reuse the bounded AST-sized table without clearing it on each
/// trace step. Single-read assignments keep the cheaper linear path.
struct SortingObservations<'a, 'b> {
    observations: &'a [Value],
    index: &'b mut [Option<(usize, &'a Value)>],
    sequence: usize,
    indexed: bool,
    ready: bool,
}
impl<'a> SortingObservations<'a, '_> {
    fn get(&mut self, at: NodeId, meter: &mut Meter) -> Result<Option<&'a Value>> {
        if !self.indexed {
            for o in self.observations {
                charge(meter, 1)?;
                if id(&o["nodeId"]) == Some(at)
                    && matches!(o["kind"].as_str(), Some("read" | "evaluate"))
                {
                    return Ok(Some(o));
                }
            }
            return Ok(None);
        }
        if !self.ready {
            for o in self.observations {
                charge(meter, 1)?;
                if matches!(o["kind"].as_str(), Some("read" | "evaluate"))
                    && let Some(node) = id(&o["nodeId"])
                    && self.index[node].is_none_or(|(sequence, _)| sequence != self.sequence)
                {
                    self.index[node] = Some((self.sequence, o));
                }
            }
            self.ready = true;
        }
        charge(meter, 1)?;
        Ok(self.index[at].and_then(|(sequence, o)| (sequence == self.sequence).then_some(o)))
    }
}
