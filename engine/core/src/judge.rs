//! JUDGE-OBS-01 finite contribution checks over this run's checked AST and
//! committed observations. This module never evaluates C or invents a trace.
//! Dynamic value identities survive copies; cancellation and zero multiplication
//! remove coefficients. Unknown algebra is deliberately not teaching success.

use std::collections::{BTreeMap, BTreeSet};

use crate::ast::{BinaryOp, Expression, Initializer, NodeData, NodeId, UnaryOp};
use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, Location, Stage};
use crate::semantic::CheckedProgram;
use crate::trace::{Step, Trace};
use serde_json::{Value, json};

#[path = "judge_p05.rs"]
mod p05;

pub(crate) use p05::profile_for_rule as p05_profile_for_rule;

type Result<T> = std::result::Result<T, Diagnostic>;

fn charge(meter: &mut Meter, units: usize) -> Result<()> {
    meter.charge(units).map_err(|error| {
        error.diagnostic(
            Stage::Judge,
            Location::Synthetic {
                reason: "pre-execution",
            },
        )
    })
}
fn node(id: NodeId) -> String {
    format!("n{}", id + 1)
}
fn id(value: &Value) -> Option<NodeId> {
    value
        .as_str()?
        .strip_prefix('n')?
        .parse::<usize>()
        .ok()?
        .checked_sub(1)
}
fn keys(request: &Value) -> Vec<&'static str> {
    let mut keys = vec![
        "input-bindings",
        "stdout-exact",
        "exit-zero",
        "teaching-target",
    ];
    if request["judge"]["rule"] == "while-for-accumulations" {
        keys.extend(["while-accumulation", "for-accumulation"]);
    }
    keys
}
pub(crate) fn unevaluated(request: &Value) -> Value {
    if request["mode"] != "exercise-test" {
        return Value::Null;
    }
    let checks: Vec<_> = keys(request)
        .into_iter()
        .map(|key| check(key, "not-evaluated", &[], &[], None))
        .collect();
    json!({"profileRef":request["judge"]["profileRef"],"caseKey":request["identity"]["testCaseKey"],"status":"not-evaluated","checks":checks,"coverage":[],"observations":[]})
}
fn check(key: &str, status: &str, nodes: &[NodeId], steps: &[usize], code: Option<&str>) -> Value {
    json!({"key":key,"status":status,"nodeIds":nodes.iter().map(|n|node(*n)).collect::<Vec<_>>(),"stepSeqs":steps,"diagnosticCodes":code.into_iter().collect::<Vec<_>>()})
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Atom {
    Input(String, usize),
    StaticIndex(NodeId, i64, Vec<(NodeId, i64)>),
    LoopInput(usize, NodeId),
    Contribution(NodeId, usize, i64),
    Branch(NodeId, bool, usize),
}
#[derive(Clone, Default)]
struct Term {
    coefficient: i64,
    multiply: bool,
    add: bool,
    writes: BTreeSet<usize>,
}
#[derive(Clone)]
struct Poly {
    valid: bool,
    constant: i64,
    terms: BTreeMap<Atom, Term>,
    // Only an actual initialized zero value supplies an accumulation origin.
    zeros: BTreeSet<NodeId>,
    // Effective affine input operands of a supported comparison/logical test.
    condition_inputs: BTreeSet<String>,
}
impl Poly {
    fn constant(value: i64) -> Self {
        Self {
            valid: true,
            constant: value,
            terms: BTreeMap::new(),
            zeros: BTreeSet::new(),
            condition_inputs: BTreeSet::new(),
        }
    }
    fn unknown() -> Self {
        Self {
            valid: false,
            ..Self::constant(0)
        }
    }
    fn atom(atom: Atom) -> Self {
        let mut poly = Self::constant(0);
        poly.terms.insert(
            atom,
            Term {
                coefficient: 1,
                ..Term::default()
            },
        );
        poly
    }
    fn weight(&self) -> usize {
        1 + self.terms.len()
            + self.zeros.len()
            + self.condition_inputs.len()
            + self.terms.values().map(|t| t.writes.len()).sum::<usize>()
    }
    fn is_constant(&self, value: i64) -> bool {
        self.valid && self.terms.is_empty() && self.constant == value
    }
    fn scalar_inputs(&self) -> BTreeSet<String> {
        self.terms
            .keys()
            .filter_map(|a| match a {
                Atom::Input(key, _) => Some(key.clone()),
                _ => None,
            })
            .chain(self.condition_inputs.iter().cloned())
            .collect()
    }
    fn scale(mut self, factor: i64) -> Self {
        if factor == 0 {
            return Self::constant(0);
        }
        let Some(value) = self.constant.checked_mul(factor) else {
            return Self::unknown();
        };
        self.constant = value;
        for term in self.terms.values_mut() {
            let Some(value) = term.coefficient.checked_mul(factor) else {
                return Self::unknown();
            };
            term.coefficient = value;
        }
        if factor != 1 {
            self.zeros.clear();
        }
        self
    }
    fn combine(mut self, other: Self, sign: i64) -> Self {
        if !self.valid || !other.valid {
            return Self::unknown();
        }
        let Some(value) = other
            .constant
            .checked_mul(sign)
            .and_then(|v| self.constant.checked_add(v))
        else {
            return Self::unknown();
        };
        self.constant = value;
        for (atom, incoming) in other.terms {
            let term = self.terms.entry(atom.clone()).or_default();
            let Some(value) = incoming
                .coefficient
                .checked_mul(sign)
                .and_then(|v| term.coefficient.checked_add(v))
            else {
                return Self::unknown();
            };
            term.coefficient = value;
            term.multiply |= incoming.multiply;
            term.add |= incoming.add;
            term.writes.extend(incoming.writes);
            if value == 0 {
                self.terms.remove(&atom);
            }
        }
        self.zeros.extend(other.zeros);
        self
    }
}

// A local expression is also affine in the exact dynamic versions read by this
// atomic action. This identifies a recurrence's old accumulator, including
// transparent temporary copies, without treating taint as a contribution.
#[derive(Clone)]
struct Relative {
    valid: bool,
    constant: i64,
    terms: BTreeMap<usize, i64>,
}
impl Relative {
    fn constant(value: i64) -> Self {
        Self {
            valid: true,
            constant: value,
            terms: BTreeMap::new(),
        }
    }
    fn atom(value: usize) -> Self {
        Self {
            valid: true,
            constant: 0,
            terms: BTreeMap::from([(value, 1)]),
        }
    }
    fn unknown() -> Self {
        Self {
            valid: false,
            ..Self::constant(0)
        }
    }
    fn scale(mut self, factor: i64) -> Self {
        if factor == 0 {
            return Self::constant(0);
        }
        let Some(value) = self.constant.checked_mul(factor) else {
            return Self::unknown();
        };
        self.constant = value;
        for value in self.terms.values_mut() {
            let Some(next) = value.checked_mul(factor) else {
                return Self::unknown();
            };
            *value = next;
        }
        self
    }
    fn combine(mut self, other: Self, sign: i64) -> Self {
        if !self.valid || !other.valid {
            return Self::unknown();
        }
        let Some(value) = other
            .constant
            .checked_mul(sign)
            .and_then(|v| self.constant.checked_add(v))
        else {
            return Self::unknown();
        };
        self.constant = value;
        for (key, value) in other.terms {
            let current = self.terms.entry(key).or_default();
            let Some(next) = value.checked_mul(sign).and_then(|v| current.checked_add(v)) else {
                return Self::unknown();
            };
            *current = next;
            if next == 0 {
                self.terms.remove(&key);
            }
        }
        self
    }
}
struct Version {
    value: i64,
    poly: Poly,
}
struct Evaluated {
    version: usize,
    relative: Relative,
}
struct Object {
    declaration: NodeId,
    array: bool,
    default: Option<i32>,
    cells: BTreeMap<usize, i32>,
    versions: BTreeMap<usize, usize>,
}
struct Output {
    version: Option<usize>,
    node: NodeId,
    seq: usize,
}
struct Model<'a> {
    checked: &'a CheckedProgram,
    request: &'a Value,
    meter: &'a mut Meter,
    parents: Vec<Option<NodeId>>,
    references: Vec<Option<NodeId>>,
    bindings: BTreeMap<NodeId, String>,
    objects: BTreeMap<String, Object>,
    versions: Vec<Version>,
    outputs: Vec<Output>,
    visits: BTreeMap<(NodeId, bool), usize>,
    condition_related: BTreeSet<NodeId>,
    sites: BTreeMap<NodeId, String>,
    observations: Vec<Value>,
    array_reads: Vec<(usize, Vec<NodeId>)>,
    target_writes: BTreeSet<usize>,
    stdout: String,
}
impl<'a> Model<'a> {
    fn new(request: &'a Value, checked: &'a CheckedProgram, meter: &'a mut Meter) -> Result<Self> {
        let count = checked.parsed.program.nodes.len();
        charge(meter, count * 3 + checked.references.len())?;
        let mut parents = vec![None; count];
        let mut references = vec![None; count];
        for reference in &checked.references {
            references[reference.expression_node] = Some(reference.declaration_node);
        }
        for (parent, node) in checked.parsed.program.nodes.iter().enumerate() {
            let children = node.data.children();
            charge(meter, children.len() + 1)?;
            for child in children {
                parents[child] = Some(parent);
            }
        }
        let mut bindings = BTreeMap::new();
        for entry in request["source"]["bindingMap"].as_array().unwrap() {
            let start = entry["byteRange"]["start"].as_u64().unwrap() as usize;
            let end = entry["byteRange"]["end"].as_u64().unwrap() as usize;
            for declaration in &checked.declarations {
                charge(meter, 1)?;
                let range = checked.parsed.program.nodes[declaration.node_id].byte_range;
                if range.start == start && range.end == end {
                    bindings.insert(
                        declaration.node_id,
                        entry["bindingKey"].as_str().unwrap().to_owned(),
                    );
                }
            }
        }
        let mut sites = BTreeMap::new();
        let source = request["source"]["text"].as_str().unwrap();
        for (control, node) in checked.parsed.program.nodes.iter().enumerate() {
            charge(meter, 1)?;
            if !matches!(
                node.data,
                NodeData::If { .. } | NodeData::While { .. } | NodeData::For { .. }
            ) {
                continue;
            }
            let mut candidates = Vec::new();
            for entry in request["source"]["blockMap"].as_array().unwrap() {
                charge(meter, 1)?;
                let start = entry["byteRange"]["start"].as_u64().unwrap() as usize;
                let end = entry["byteRange"]["end"].as_u64().unwrap() as usize;
                let range = node.byte_range;
                if start <= range.start && end >= range.end {
                    charge(meter, (end - start).div_ceil(64))?;
                    if source[start..range.start].trim().is_empty()
                        && source[range.end..end].trim().is_empty()
                    {
                        candidates.push(entry["blockId"].as_str().unwrap().to_owned());
                    }
                }
            }
            if candidates.len() == 1 {
                sites.insert(control, candidates.remove(0));
            }
        }
        Ok(Self {
            checked,
            request,
            meter,
            parents,
            references,
            bindings,
            objects: BTreeMap::new(),
            versions: Vec::new(),
            outputs: Vec::new(),
            visits: BTreeMap::new(),
            condition_related: BTreeSet::new(),
            sites,
            observations: Vec::new(),
            array_reads: Vec::new(),
            target_writes: BTreeSet::new(),
            stdout: String::new(),
        })
    }
    fn push(&mut self, value: i64, poly: Poly) -> Result<usize> {
        charge(self.meter, 1 + poly.weight())?;
        let version = self.versions.len();
        self.versions.push(Version { value, poly });
        Ok(version)
    }
    fn ancestors(&mut self, at: NodeId) -> Result<Vec<NodeId>> {
        let mut out = Vec::new();
        let mut at = self.parents[at];
        while let Some(parent) = at {
            charge(self.meter, 1)?;
            out.push(parent);
            at = self.parents[parent];
        }
        Ok(out)
    }
    fn loops(&mut self, at: NodeId) -> Result<Vec<NodeId>> {
        Ok(self
            .ancestors(at)?
            .into_iter()
            .filter(|n| {
                matches!(
                    self.checked.parsed.program.nodes[*n].data,
                    NodeData::While { .. } | NodeData::For { .. }
                )
            })
            .collect())
    }
    fn branches(&mut self, at: NodeId) -> Result<Vec<(NodeId, bool)>> {
        let mut out = Vec::new();
        let mut child = at;
        while let Some(parent) = self.parents[child] {
            charge(self.meter, 1)?;
            if let NodeData::If {
                then_block,
                else_block,
                ..
            } = self.checked.parsed.program.nodes[parent].data
            {
                if child == then_block {
                    out.push((parent, true));
                } else if Some(child) == else_block {
                    out.push((parent, false));
                }
            }
            child = parent;
        }
        Ok(out)
    }
    fn eval(&mut self, at: NodeId, observations: &BTreeMap<NodeId, &Value>) -> Result<Evaluated> {
        charge(self.meter, 1)?;
        let data = &self.checked.parsed.program.nodes[at].data;
        let NodeData::Expr(expression) = data else {
            unreachable!("checked expression")
        };
        match expression {
            Expression::Integer(value) => Ok(Evaluated {
                version: self.push(i64::from(*value), Poly::constant(i64::from(*value)))?,
                relative: Relative::constant(i64::from(*value)),
            }),
            Expression::Name(_) | Expression::Index { .. } => {
                let observation = observations.get(&at).expect("real committed read");
                let object_id = observation["objectId"].as_str().unwrap();
                let index = observation["index"].as_u64().unwrap() as usize;
                let object = &self.objects[object_id];
                let version = object.versions.get(&index).copied();
                let value = observation["value"].as_i64().unwrap();
                let version = match version {
                    Some(version) => version,
                    None => self.push(value, Poly::unknown())?,
                };
                if matches!(expression, Expression::Index { .. })
                    && self
                        .bindings
                        .get(&self.objects[object_id].declaration)
                        .is_some_and(|key| key == "param.values")
                {
                    let loops = self.loops(at)?;
                    self.array_reads.push((index, loops.clone()));
                    if self.request["judge"]["rule"] == "logical-array-accumulation" {
                        let mut poly = self.versions[version].poly.clone();
                        charge(self.meter, poly.weight())?;
                        if let Some(term) = poly
                            .terms
                            .remove(&Atom::Input("param.values".into(), index))
                        {
                            if let Some(&loop_node) = loops.first() {
                                poly.terms.insert(Atom::LoopInput(index, loop_node), term);
                            } else {
                                poly.valid = false;
                            }
                        }
                        return Ok(Evaluated {
                            version: self.push(value, poly)?,
                            relative: Relative::atom(version),
                        });
                    }
                }
                Ok(Evaluated {
                    version,
                    relative: Relative::atom(version),
                })
            }
            Expression::Unary { op, operand } => {
                let operand = self.eval(*operand, observations)?;
                let value = observations[&at]["value"].as_i64().unwrap();
                charge(
                    self.meter,
                    self.versions[operand.version].poly.weight() + operand.relative.terms.len() + 1,
                )?;
                let poly = self.versions[operand.version].poly.clone();
                let (poly, relative) = match op {
                    UnaryOp::Plus => (poly, operand.relative),
                    UnaryOp::Minus => (poly.scale(-1), operand.relative.scale(-1)),
                    UnaryOp::Not => {
                        let inputs = poly.scalar_inputs();
                        let mut result = Poly::unknown();
                        result.condition_inputs = inputs;
                        (result, Relative::unknown())
                    }
                };
                Ok(Evaluated {
                    version: self.push(value, poly)?,
                    relative,
                })
            }
            Expression::Binary { op, left, right } => {
                let left = self.eval(*left, observations)?;
                let logical_constant = if matches!(op, BinaryOp::And | BinaryOp::Or) {
                    let proof = self.static_affine(*right, usize::MAX, 0)?;
                    (proof.valid && proof.terms.is_empty()).then_some(proof.constant)
                } else {
                    None
                };
                let observation = observations[&at];
                let value = observation["value"].as_i64().unwrap();
                let right = if observation["operands"].as_array().unwrap().len() == 2 {
                    Some(self.eval(*right, observations)?)
                } else {
                    None
                };
                charge(
                    self.meter,
                    self.versions[left.version].poly.weight()
                        + left.relative.terms.len()
                        + right.as_ref().map_or(0, |r| {
                            self.versions[r.version].poly.weight() + r.relative.terms.len()
                        })
                        + 2,
                )?;
                let a = self.versions[left.version].poly.clone();
                let b = right
                    .as_ref()
                    .map(|r| self.versions[r.version].poly.clone());
                let relative = match (op, right.as_ref()) {
                    (BinaryOp::Add, Some(r)) => {
                        left.relative.clone().combine(r.relative.clone(), 1)
                    }
                    (BinaryOp::Subtract, Some(r)) => {
                        left.relative.clone().combine(r.relative.clone(), -1)
                    }
                    (BinaryOp::Multiply, Some(r))
                        if left.relative.terms.is_empty() && left.relative.valid =>
                    {
                        r.relative.clone().scale(left.relative.constant)
                    }
                    (BinaryOp::Multiply, Some(r))
                        if r.relative.terms.is_empty() && r.relative.valid =>
                    {
                        left.relative.clone().scale(r.relative.constant)
                    }
                    (BinaryOp::Divide, Some(r))
                        if r.relative.terms.is_empty()
                            && r.relative.valid
                            && r.relative.constant == 1 =>
                    {
                        left.relative.clone()
                    }
                    _ => Relative::unknown(),
                };
                let mut poly = match (op, b) {
                    (BinaryOp::And, _) if logical_constant == Some(0) => Poly::constant(0),
                    (BinaryOp::Or, _) if logical_constant.is_some_and(|v| v != 0) => {
                        Poly::constant(1)
                    }
                    (BinaryOp::Add, Some(b)) => a.combine(b, 1),
                    (BinaryOp::Subtract, Some(b)) => a.combine(b, -1),
                    (BinaryOp::Multiply, Some(b)) if a.is_constant(0) || b.is_constant(0) => {
                        Poly::constant(0)
                    }
                    (BinaryOp::Multiply, Some(b)) if a.valid && a.terms.is_empty() => {
                        b.scale(a.constant)
                    }
                    (BinaryOp::Multiply, Some(b)) if b.valid && b.terms.is_empty() => {
                        a.scale(b.constant)
                    }
                    (BinaryOp::Divide, Some(b)) if b.is_constant(1) => a,
                    (BinaryOp::Divide, Some(b))
                        if a.valid && b.valid && a.terms.is_empty() && b.terms.is_empty() =>
                    {
                        Poly::constant(value)
                    }
                    (
                        BinaryOp::Less
                        | BinaryOp::LessEqual
                        | BinaryOp::Greater
                        | BinaryOp::GreaterEqual
                        | BinaryOp::Equal
                        | BinaryOp::NotEqual,
                        Some(b),
                    ) if a.valid && b.valid => {
                        let mut p = Poly::unknown();
                        p.condition_inputs = a.combine(b, -1).scalar_inputs();
                        p
                    }
                    (BinaryOp::And, Some(b)) if a.is_constant(0) || b.is_constant(0) => {
                        Poly::constant(0)
                    }
                    (BinaryOp::Or, Some(b))
                        if (a.valid && a.terms.is_empty() && a.constant != 0)
                            || (b.valid && b.terms.is_empty() && b.constant != 0) =>
                    {
                        Poly::constant(1)
                    }
                    (BinaryOp::And | BinaryOp::Or, b) => {
                        let mut p = Poly::unknown();
                        p.condition_inputs = a.scalar_inputs();
                        if let Some(b) = b {
                            p.condition_inputs.extend(b.scalar_inputs());
                        }
                        p
                    }
                    _ => Poly::unknown(),
                };
                if matches!(op, BinaryOp::Add | BinaryOp::Subtract | BinaryOp::Multiply) {
                    for (atom, term) in &mut poly.terms {
                        if matches!(atom,Atom::Input(key,_) if key=="param.x") {
                            term.add |= matches!(op, BinaryOp::Add | BinaryOp::Subtract);
                            term.multiply |= *op == BinaryOp::Multiply;
                        }
                    }
                }
                if self.request["judge"]["rule"] == "while-for-accumulations" {
                    let alias = match (op, right.as_ref()) {
                        (BinaryOp::Add | BinaryOp::Subtract, Some(r))
                            if self.versions[r.version].poly.is_constant(0) =>
                        {
                            Some(left.version)
                        }
                        (BinaryOp::Add, Some(r))
                            if self.versions[left.version].poly.is_constant(0) =>
                        {
                            Some(r.version)
                        }
                        (BinaryOp::Multiply | BinaryOp::Divide, Some(r))
                            if self.versions[r.version].poly.is_constant(1) =>
                        {
                            Some(left.version)
                        }
                        (BinaryOp::Multiply, Some(r))
                            if self.versions[left.version].poly.is_constant(1) =>
                        {
                            Some(r.version)
                        }
                        _ => None,
                    };
                    if let Some(version) = alias {
                        return Ok(Evaluated { version, relative });
                    }
                }
                Ok(Evaluated {
                    version: self.push(value, poly)?,
                    relative,
                })
            }
        }
    }
    fn step(&mut self, step: &Step) -> Result<()> {
        charge(self.meter, 1 + step.observations.len() + step.changes.len())?;
        let at = id(&step.location["nodeId"]);
        let mut observations = BTreeMap::new();
        for observation in &step.observations {
            charge(self.meter, 1)?;
            if let Some(at) = id(&observation["nodeId"])
                && matches!(observation["kind"].as_str(), Some("read" | "evaluate"))
            {
                observations.insert(at, observation);
            }
        }
        let mut assigned = None;
        if let Some(at) = at {
            match &self.checked.parsed.program.nodes[at].data {
                NodeData::Declaration {
                    initializer: Initializer::Scalar(expression),
                    ..
                } if step.kind == "value.initialize" => {
                    assigned = Some(self.eval(*expression, &observations)?)
                }
                NodeData::Assignment { value, .. } if step.kind == "value.write" => {
                    assigned = Some(self.eval(*value, &observations)?)
                }
                NodeData::Condition { expression } if step.kind == "condition" => {
                    let result = self.eval(*expression, &observations)?;
                    let take = self.versions[result.version].value != 0;
                    if let Some(control) = self.parents[at] {
                        *self.visits.entry((control, take)).or_default() += 1;
                        if self.versions[result.version]
                            .poly
                            .scalar_inputs()
                            .contains("param.x")
                        {
                            self.condition_related.insert(control);
                        }
                    }
                }
                NodeData::For {
                    condition: None, ..
                } if step.kind == "condition" => {
                    *self.visits.entry((at, true)).or_default() += 1;
                }
                NodeData::Output { arguments, .. } if step.kind == "output.append" => {
                    if arguments.is_empty() {
                        self.outputs.push(Output {
                            version: None,
                            node: at,
                            seq: step.seq,
                        });
                    }
                    for argument in arguments {
                        let result = self.eval(*argument, &observations)?;
                        self.outputs.push(Output {
                            version: Some(result.version),
                            node: at,
                            seq: step.seq,
                        });
                    }
                }
                _ => {}
            }
        }
        // Record/cell changes are the executor's committed writes, including
        // same-value writes. Before-destroy records are the exact sample point.
        for change in &step.changes {
            charge(self.meter, 1)?;
            if change["op"] == "output" {
                let text = change["append"].as_str().unwrap();
                charge(self.meter, text.len().div_ceil(64))?;
                self.stdout.push_str(text);
            }
            if change["op"] == "record" && change["table"] == "objects" {
                let object_id = change["id"].as_str().unwrap();
                let after = &change["after"];
                if after.is_null() {
                    if let Some(object) = self.objects.get(object_id)
                        && self
                            .bindings
                            .get(&object.declaration)
                            .is_some_and(|key| key == "param.values")
                    {
                        let length = self.request["input"]["values"]["values"]
                            .as_array()
                            .unwrap()
                            .len();
                        charge(self.meter, length + 1)?;
                        let values: Vec<_> = (0..length)
                            .map(|index| {
                                object
                                    .cells
                                    .get(&index)
                                    .copied()
                                    .or(object.default)
                                    .unwrap()
                            })
                            .collect();
                        self.observations.push(json!({"kind":"array-before-destroy","bindingKey":"param.values","objectId":object_id,"declarationNodeId":node(object.declaration),"beforeCursor":step.seq-1,"location":step.location,"values":values}));
                    }
                    self.objects.remove(object_id);
                    continue;
                }
                let declaration = id(&after["declarationNodeId"]).unwrap();
                let mut cells = BTreeMap::new();
                for cell in after["cells"].as_array().unwrap() {
                    charge(self.meter, 1)?;
                    cells.insert(
                        cell["index"].as_u64().unwrap() as usize,
                        cell["value"].as_i64().unwrap() as i32,
                    );
                }
                let previous = self.objects.remove(object_id);
                self.objects.insert(
                    object_id.into(),
                    Object {
                        declaration,
                        array: after["kind"] == "int-array",
                        default: after["defaultValue"].as_i64().map(|v| v as i32),
                        cells,
                        versions: previous.map_or_else(BTreeMap::new, |o| o.versions),
                    },
                );
                if self.bindings.contains_key(&declaration) && step.kind == "value.initialize" {
                    let key = self.bindings[&declaration].clone();
                    let length = if key == "param.values" {
                        self.request["input"]["values"]["values"]
                            .as_array()
                            .unwrap()
                            .len()
                    } else {
                        1
                    };
                    for index in 0..length {
                        let object = &self.objects[object_id];
                        let value = object
                            .cells
                            .get(&index)
                            .copied()
                            .or(object.default)
                            .unwrap();
                        let version = self.push(
                            i64::from(value),
                            Poly::atom(Atom::Input(key.clone(), index)),
                        )?;
                        self.objects
                            .get_mut(object_id)
                            .unwrap()
                            .versions
                            .insert(index, version);
                    }
                }
            }
            if change["op"] == "cell" {
                let object_id = change["objectId"].as_str().unwrap();
                let index = change["index"].as_u64().unwrap() as usize;
                let value = change["after"].as_i64().unwrap() as i32;
                let declaration = self.objects[object_id].declaration;
                let binding = self.bindings.get(&declaration).cloned();
                let mut version =
                    if let Some(binding) = binding.filter(|_| step.kind == "value.initialize") {
                        self.push(i64::from(value), Poly::atom(Atom::Input(binding, index)))?
                    } else if let Some(result) = assigned.as_ref() {
                        let mut poly = self.versions[result.version].poly.clone();
                        charge(self.meter, poly.weight() + result.relative.terms.len())?;
                        let mut changed = false;
                        if step.kind == "value.initialize"
                            && poly.is_constant(0)
                            && poly.zeros.is_empty()
                        {
                            poly.zeros.insert(declaration);
                            changed = true;
                        }
                        let loops = self.loops(at.unwrap())?;
                        if self.request["judge"]["rule"] == "while-for-accumulations"
                            && !self.objects[object_id].array
                            && let (Some(&previous), Some(&loop_node)) =
                                (self.objects[object_id].versions.get(&index), loops.first())
                            && result.relative.valid
                            && result.relative.terms.get(&previous) == Some(&1)
                        {
                            let mut contribution = result.relative.constant;
                            for (&read, &coefficient) in &result.relative.terms {
                                charge(self.meter, 1)?;
                                if read != previous {
                                    contribution = contribution.saturating_add(
                                        self.versions[read].value.saturating_mul(coefficient),
                                    );
                                }
                            }
                            let old = self.versions[previous].poly.clone();
                            charge(self.meter, old.weight())?;
                            poly = old.combine(
                                Poly::atom(Atom::Contribution(loop_node, step.seq, contribution)),
                                1,
                            );
                            changed = true;
                        }
                        if self.request["judge"]["rule"] == "if-else-paths" {
                            for (branch, take) in self.branches(at.unwrap())? {
                                if self.condition_related.contains(&branch) {
                                    poly = Poly::atom(Atom::Branch(branch, take, step.seq));
                                    changed = true;
                                }
                            }
                        }
                        if changed {
                            self.push(i64::from(value), poly)?
                        } else {
                            result.version
                        }
                    } else {
                        self.push(i64::from(value), Poly::unknown())?
                    };
                if self.objects[object_id].array
                    && step.kind == "value.write"
                    && self
                        .bindings
                        .get(&declaration)
                        .is_some_and(|key| key == "param.values")
                {
                    let mut poly = self.versions[version].poly.clone();
                    charge(self.meter, poly.weight())?;
                    for term in poly.terms.values_mut() {
                        term.writes.insert(step.seq);
                    }
                    let k = self.request["input"]["values"]["k"]
                        .as_u64()
                        .map(|n| n as usize);
                    if k == Some(index)
                        && poly.valid
                        && poly.constant == 1
                        && poly.terms.len() == 1
                        && poly
                            .terms
                            .get(&Atom::Input("param.values".into(), index))
                            .is_some_and(|t| t.coefficient == 1)
                    {
                        self.target_writes.insert(step.seq);
                    }
                    version = self.push(i64::from(value), poly)?;
                }
                let object = self.objects.get_mut(object_id).unwrap();
                object.cells.insert(index, value);
                object.versions.insert(index, version);
            }
        }
        Ok(())
    }
    fn static_accumulators(&mut self, loop_node: NodeId, array: bool) -> Result<BTreeSet<NodeId>> {
        let mut targets = BTreeSet::new();
        let bound = self
            .bindings
            .iter()
            .find_map(|(&node, key)| (key == "param.n").then_some(node));
        let Some(bound) = bound else {
            return Ok(targets);
        };
        let condition = match self.checked.parsed.program.nodes[loop_node].data {
            NodeData::While { condition, .. } => Some(condition),
            NodeData::For { condition, .. } => condition,
            _ => None,
        };
        let Some(condition) = condition else {
            return Ok(targets);
        };
        if !self.static_bound_dependency(condition, bound)? {
            return Ok(targets);
        }
        for at in 0..self.checked.parsed.program.nodes.len() {
            charge(self.meter, 1)?;
            let NodeData::Assignment { target, value } = self.checked.parsed.program.nodes[at].data
            else {
                continue;
            };
            let Some(declaration) = self.references[target] else {
                continue;
            };
            if !self.loops(at)?.contains(&loop_node) {
                continue;
            }
            let expression = self.static_affine(value, declaration, 0)?;
            charge(self.meter, expression.weight())?;
            let target = Atom::Input("local".into(), declaration);
            let contribution = expression.terms.iter().any(|(atom, term)| match atom {
                Atom::StaticIndex(..) if array => term.coefficient == 1,
                Atom::Input(key, id) if !array => {
                    key == "local" && *id != declaration && *id != bound && term.coefficient != 0
                }
                _ => false,
            });
            if expression.valid
                && expression
                    .terms
                    .get(&target)
                    .is_some_and(|t| t.coefficient == 1)
                && contribution
            {
                targets.insert(declaration);
            }
        }
        Ok(targets)
    }
    fn static_bound_dependency(&mut self, root: NodeId, bound: NodeId) -> Result<bool> {
        let mut pending = vec![root];
        let mut visited = BTreeSet::new();
        while let Some(at) = pending.pop() {
            charge(self.meter, 1)?;
            if !visited.insert(at) {
                continue;
            }
            if self.references[at] == Some(bound) {
                return Ok(true);
            }
            if let Some(declaration) = self.references[at]
                && let NodeData::Declaration {
                    initializer: Initializer::Scalar(value),
                    ..
                } = self.checked.parsed.program.nodes[declaration].data
            {
                pending.push(value);
            }
            let children = self.checked.parsed.program.nodes[at].data.children();
            charge(self.meter, children.len())?;
            pending.extend(children);
        }
        Ok(false)
    }
    // A bounded affine proof of the recurrence remains necessary when n=0,
    // where there is no executed body. Expand immutable temporary aliases, but
    // keep assigned induction variables and the accumulator as independent
    // symbols. Algebraic cancellation therefore also applies to the static path.
    fn static_affine(&mut self, at: NodeId, target: NodeId, depth: usize) -> Result<Poly> {
        charge(self.meter, 1)?;
        if depth >= 64 {
            return Ok(Poly::unknown());
        }
        Ok(match self.checked.parsed.program.nodes[at].data {
            NodeData::Expr(Expression::Name(_)) => {
                let declaration = self.references[at].unwrap();
                let mut assigned = false;
                for candidate in &self.checked.parsed.program.nodes {
                    charge(self.meter, 1)?;
                    if let NodeData::Assignment { target, .. } = candidate.data {
                        assigned |= self.references[target] == Some(declaration);
                    }
                }
                if declaration != target
                    && !assigned
                    && !self.bindings.contains_key(&declaration)
                    && let NodeData::Declaration {
                        initializer: Initializer::Scalar(value),
                        ..
                    } = self.checked.parsed.program.nodes[declaration].data
                {
                    self.static_affine(value, target, depth + 1)?
                } else {
                    Poly::atom(Atom::Input("local".into(), declaration))
                }
            }
            NodeData::Expr(Expression::Integer(value)) => Poly::constant(i64::from(value)),
            NodeData::Expr(Expression::Index { array, index }) => {
                let base = self.references[array].unwrap();
                if self
                    .bindings
                    .get(&base)
                    .is_some_and(|key| key == "param.values")
                {
                    let p = self.static_affine(index, target, depth + 1)?;
                    charge(self.meter, p.weight())?;
                    let mut terms = Vec::new();
                    let mut valid = p.valid;
                    for (atom, term) in p.terms {
                        if let Atom::Input(key, id) = atom
                            && key == "local"
                        {
                            terms.push((id, term.coefficient));
                        } else {
                            valid = false;
                        }
                    }
                    if valid {
                        Poly::atom(Atom::StaticIndex(base, p.constant, terms))
                    } else {
                        Poly::unknown()
                    }
                } else {
                    Poly::unknown()
                }
            }
            NodeData::Expr(Expression::Unary {
                op: UnaryOp::Plus,
                operand,
            }) => self.static_affine(operand, target, depth + 1)?,
            NodeData::Expr(Expression::Unary {
                op: UnaryOp::Minus,
                operand,
            }) => self.static_affine(operand, target, depth + 1)?.scale(-1),
            NodeData::Expr(Expression::Binary { op, left, right }) => {
                let a = self.static_affine(left, target, depth + 1)?;
                let b = self.static_affine(right, target, depth + 1)?;
                charge(self.meter, a.weight() + b.weight())?;
                match op {
                    BinaryOp::Add => a.combine(b, 1),
                    BinaryOp::Subtract => a.combine(b, -1),
                    BinaryOp::Multiply if a.is_constant(0) || b.is_constant(0) => Poly::constant(0),
                    BinaryOp::Multiply if a.valid && a.terms.is_empty() => b.scale(a.constant),
                    BinaryOp::Multiply if b.valid && b.terms.is_empty() => a.scale(b.constant),
                    BinaryOp::Divide if b.is_constant(1) => a,
                    _ => Poly::unknown(),
                }
            }
            _ => Poly::unknown(),
        })
    }
    fn loop_target(&mut self, index: usize, kind: &str, n: usize) -> Result<bool> {
        let Some(output) = self.outputs.get(index) else {
            return Ok(false);
        };
        let Some(version) = output.version else {
            return Ok(false);
        };
        let poly = self.versions[version].poly.clone();
        charge(self.meter, poly.weight())?;
        if !poly.valid || poly.constant != 0 {
            return Ok(false);
        }
        for loop_node in 0..self.checked.parsed.program.nodes.len() {
            charge(self.meter, 1)?;
            if !matches!(
                (&self.checked.parsed.program.nodes[loop_node].data, kind),
                (NodeData::While { .. }, "while") | (NodeData::For { .. }, "for")
            ) {
                continue;
            }
            if self.visits.get(&(loop_node, true)).copied().unwrap_or(0) != n {
                continue;
            }
            let targets = self.static_accumulators(loop_node, false)?;
            if !targets.iter().any(|target| poly.zeros.contains(target)) {
                continue;
            }
            let mut values = Vec::new();
            let mut valid = true;
            for (atom, term) in &poly.terms {
                charge(self.meter, 1)?;
                match atom {
                    Atom::Contribution(loop_id, _, value)
                        if *loop_id == loop_node && term.coefficient == 1 =>
                    {
                        values.push(*value)
                    }
                    _ => valid = false,
                }
            }
            charge(self.meter, values.len() * values.len())?;
            values.sort_unstable();
            if valid && values == (1..=n).map(|v| v as i64).collect::<Vec<_>>() {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn targets(&mut self) -> Result<(bool, bool, bool)> {
        let rule = self.request["judge"]["rule"].as_str().unwrap();
        match rule {
            "input-read-output" | "multiply-add-output" => {
                for output in &self.outputs {
                    if let Some(version) = output.version {
                        charge(self.meter, self.versions[version].poly.weight())?;
                    }
                }
                let met = if self.outputs.len() == 1 {
                    self.outputs[0].version.is_some_and(|version| {
                        let p = &self.versions[version].poly;
                        p.valid
                            && p.terms.len() == 1
                            && p.terms
                                .get(&Atom::Input("param.x".into(), 0))
                                .is_some_and(|t| {
                                    if rule == "input-read-output" {
                                        t.coefficient == 1 && p.constant == 0
                                    } else {
                                        t.coefficient == 2 && p.constant == 3 && t.multiply && t.add
                                    }
                                })
                    })
                } else {
                    false
                };
                Ok((met, true, true))
            }
            "if-else-paths" => {
                let mut met = false;
                for index in 0..self.outputs.len() {
                    let at = self.outputs[index].node;
                    let paths = self.branches(at)?;
                    for (control, _) in paths {
                        met |= self.condition_related.contains(&control)
                            && matches!(
                                self.checked.parsed.program.nodes[control].data,
                                NodeData::If {
                                    else_block: Some(_),
                                    ..
                                }
                            );
                    }
                    if let Some(version) = self.outputs[index].version {
                        for (atom, term) in &self.versions[version].poly.terms {
                            charge(self.meter, 1)?;
                            if let Atom::Branch(control, _, _) = atom {
                                met |= term.coefficient != 0
                                    && self.condition_related.contains(control)
                                    && matches!(
                                        self.checked.parsed.program.nodes[*control].data,
                                        NodeData::If {
                                            else_block: Some(_),
                                            ..
                                        }
                                    );
                            }
                        }
                    }
                }
                Ok((met, true, true))
            }
            "while-for-accumulations" => {
                let n = self.request["input"]["values"]["n"].as_u64().unwrap() as usize;
                let a = self.loop_target(0, "while", n)?;
                let b = self.loop_target(1, "for", n)?;
                Ok((self.outputs.len() == 2 && a && b, a, b))
            }
            "single-index-increment" => {
                let k = self.request["input"]["values"]["k"].as_u64().unwrap() as usize;
                let array = self.observations.len() == 1
                    && self.observations[0]["values"] == self.request["judge"]["expectedArray"];
                let output = self.outputs.len() == 1
                    && self.outputs[0].version.is_some_and(|version| {
                        let p = &self.versions[version].poly;
                        p.valid
                            && p.constant == 1
                            && p.terms.len() == 1
                            && p.terms
                                .get(&Atom::Input("param.values".into(), k))
                                .is_some_and(|t| {
                                    t.coefficient == 1
                                        && t.writes.iter().any(|seq| {
                                            self.target_writes.contains(seq)
                                                && *seq < self.outputs[0].seq
                                        })
                                })
                    });
                Ok((array && output, true, true))
            }
            "logical-array-accumulation" => {
                let n = self.request["input"]["values"]["values"]
                    .as_array()
                    .unwrap()
                    .len();
                if self.outputs.len() != 1 {
                    return Ok((false, true, true));
                }
                let Some(version) = self.outputs[0].version else {
                    return Ok((false, true, true));
                };
                let p = self.versions[version].poly.clone();
                charge(self.meter, p.weight())?;
                charge(self.meter, self.array_reads.len())?;
                if !p.valid
                    || p.constant != 0
                    || p.terms.len() != n
                    || self.array_reads.iter().any(|(index, _)| *index >= n)
                {
                    return Ok((false, true, true));
                }
                let mut indices = BTreeSet::new();
                let mut loops = BTreeSet::new();
                for (atom, term) in p.terms {
                    charge(self.meter, 1)?;
                    if let Atom::LoopInput(index, loop_node) = atom
                        && term.coefficient == 1
                    {
                        indices.insert(index);
                        loops.insert(loop_node);
                    } else {
                        return Ok((false, true, true));
                    }
                }
                if n == 0 {
                    for (at, node) in self.checked.parsed.program.nodes.iter().enumerate() {
                        charge(self.meter, 1)?;
                        if matches!(node.data, NodeData::While { .. } | NodeData::For { .. }) {
                            loops.insert(at);
                        }
                    }
                }
                let mut structure = false;
                for loop_node in loops {
                    let targets = self.static_accumulators(loop_node, true)?;
                    structure |= targets.iter().any(|target| p.zeros.contains(target));
                }
                Ok((structure && indices == (0..n).collect(), true, true))
            }
            _ => Ok((false, false, false)),
        }
    }
}

pub(crate) fn evaluate(
    request: &Value,
    checked: &CheckedProgram,
    trace: &Trace,
    exit: Option<i32>,
    meter: &mut Meter,
) -> Result<Value> {
    if p05::profile_for_rule(request["judge"]["rule"].as_str().unwrap()).is_some() {
        return p05::evaluate(request, checked, trace, exit, meter);
    }
    let mut model = Model::new(request, checked, meter)?;
    for step in &trace.steps {
        model.step(step)?;
    }
    let (target, while_met, for_met) = model.targets()?;
    let rule = request["judge"]["rule"].as_str().unwrap();
    let mut mapping = true;
    let mut coverage = Vec::new();
    for (at, ast) in checked.parsed.program.nodes.iter().enumerate() {
        charge(model.meter, 1)?;
        let branches: &[(&str, bool)] = match ast.data {
            NodeData::If { .. } if rule == "if-else-paths" => &[("then", true), ("else", false)],
            NodeData::While { .. }
                if rule == "while-for-accumulations" || rule == "logical-array-accumulation" =>
            {
                &[("while", true)]
            }
            NodeData::For { .. }
                if rule == "while-for-accumulations" || rule == "logical-array-accumulation" =>
            {
                &[("for", true)]
            }
            _ => &[],
        };
        if branches.is_empty() {
            continue;
        }
        if let Some(site) = model.sites.get(&at) {
            for (branch, take) in branches {
                coverage.push(json!({"siteKey":site,"nodeId":node(at),"branch":branch,"visits":model.visits.get(&(at,*take)).copied().unwrap_or(0)}));
            }
        } else {
            mapping = false;
        }
    }
    let stdout = model.stdout == request["judge"]["expectedStdout"];
    let exit = exit == Some(0);
    let target = target && mapping;
    let mut nodes = BTreeSet::new();
    let mut steps = BTreeSet::new();
    for output in &model.outputs {
        charge(model.meter, 1)?;
        nodes.insert(output.node);
        steps.insert(output.seq);
    }
    let nodes: Vec<_> = nodes.into_iter().collect();
    let steps: Vec<_> = steps.into_iter().collect();
    let mut checks = Vec::new();
    for key in keys(request) {
        let (met, code) = match key {
            "input-bindings" => (true, "J_BINDING_MISMATCH"),
            "stdout-exact" => (stdout, "J_STDOUT_MISMATCH"),
            "exit-zero" => (exit, "J_EXIT_NONZERO"),
            "while-accumulation" => (while_met && mapping, "J_TEACHING_TARGET"),
            "for-accumulation" => (for_met && mapping, "J_TEACHING_TARGET"),
            _ => (
                target,
                if mapping {
                    "J_TEACHING_TARGET"
                } else {
                    "J_BINDING_MISMATCH"
                },
            ),
        };
        checks.push(check(
            key,
            if met { "met" } else { "unmet" },
            &nodes,
            &steps,
            (!met).then_some(code),
        ));
    }
    Ok(
        json!({"profileRef":request["judge"]["profileRef"],"caseKey":request["identity"]["testCaseKey"],"status":if stdout&&exit&&target&&while_met&&for_met {"met"} else {"unmet"},"checks":checks,"coverage":coverage,"observations":model.observations}),
    )
}
