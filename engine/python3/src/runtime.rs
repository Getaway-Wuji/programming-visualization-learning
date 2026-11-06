use std::collections::{BTreeMap, BTreeSet};

use crate::parser::{Arguments, Expr, ExprKind, Node, Program, Stmt, StmtKind};
use crate::trace::{
    Binding, Change, Control, Datum, Frame, Iteration, Proof, State, Step, Trace, Usage, Value,
};
use crate::values::{self, fail};
use crate::{
    Fault, MAX_BINDINGS, MAX_DEPTH, MAX_FRAMES, MAX_INPUT, MAX_LIST, Meter, PyResult, charge,
};

pub(crate) const CONCAT: u32 = 1 << 0;
pub(crate) const FLOOR: u32 = 1 << 1;
pub(crate) const REM: u32 = 1 << 2;
pub(crate) const DIVIDE: u32 = 1 << 3;
pub(crate) const AND_SHORT: u32 = 1 << 4;
pub(crate) const AND_RIGHT: u32 = 1 << 5;
pub(crate) const STR_INDEX: u32 = 1 << 6;
pub(crate) const ALIAS: u32 = 1 << 7;
pub(crate) const MUTATED: u32 = 1 << 8;
pub(crate) const SLICE: u32 = 1 << 9;
pub(crate) const BRANCH: u32 = 1 << 10;
pub(crate) const NESTED: u32 = 1 << 11;
pub(crate) const WHILE: u32 = 1 << 12;
pub(crate) const RANGE: u32 = 1 << 13;
pub(crate) const CONVERT: u32 = 1 << 14;
pub(crate) const SUBTRACT: u32 = 1 << 15;

const BUILTINS: &[&str] = &[
    "print", "input", "len", "bool", "abs", "str", "int", "float", "range",
];
const DENIED: &[&str] = &[
    "open",
    "eval",
    "exec",
    "compile",
    "__import__",
    "globals",
    "locals",
    "getattr",
    "setattr",
    "type",
];

#[derive(Debug)]
pub(crate) struct Printed {
    pub seq: usize,
    pub node_id: u32,
    pub proof: Proof,
}

#[derive(Debug, Default)]
pub(crate) struct Facts {
    pub reads: u16,
    pub prints: Vec<Printed>,
    pub while_tests: usize,
    pub while_entries: usize,
    pub while_test_inputs: u16,
    pub range_tests: usize,
    pub range_entries: usize,
    pub range_inputs: u16,
}

#[derive(Debug)]
pub(crate) struct Run {
    pub trace: Trace,
    pub state: State,
    pub diagnostic: Option<Fault>,
    pub facts: Facts,
}

type Defs<'a> = BTreeMap<u32, &'a Stmt>;

fn definitions<'a>(statements: &'a [Stmt], defs: &mut Defs<'a>) {
    for stmt in statements {
        match &stmt.kind {
            StmtKind::Def { .. } => {
                defs.insert(stmt.node.node_id, stmt);
            }
            StmtKind::If(arms, other) => {
                for (_, body) in arms {
                    definitions(body, defs);
                }
                definitions(other, defs);
            }
            StmtKind::For(_, _, body) | StmtKind::While(_, body) => definitions(body, defs),
            _ => {}
        }
    }
}

pub(crate) fn run(program: &Program, input: &str, meter: &mut Meter, usage: &mut Usage) -> Run {
    let mut defs = BTreeMap::new();
    definitions(&program.statements, &mut defs);
    let mut runtime = Runtime {
        meter,
        usage,
        input,
        defs,
        state: State::default(),
        trace: Trace::default(),
        pending: Vec::new(),
        temps: Vec::new(),
        temp_bytes: 0,
        context: Proof::default(),
        branches: 0,
        facts: Facts::default(),
    };
    let diagnostic = runtime.block(&program.statements).err();
    if diagnostic.is_some() {
        runtime.trace.completeness = "prefix";
    }
    Run {
        trace: runtime.trace,
        state: runtime.state,
        diagnostic,
        facts: runtime.facts,
    }
}

struct Runtime<'p, 'r> {
    meter: &'r mut Meter,
    usage: &'r mut Usage,
    input: &'r str,
    defs: Defs<'p>,
    state: State,
    trace: Trace,
    pending: Vec<u32>,
    temps: Vec<Datum>,
    temp_bytes: usize,
    context: Proof,
    branches: usize,
    facts: Facts,
}

enum Flow {
    Next,
    Break,
    Continue,
    Return(Datum),
}

impl Runtime<'_, '_> {
    fn spend(&mut self, units: usize, node: Node) -> PyResult<()> {
        charge(self.meter, units, node.byte_range, "runtime")
    }
    fn frame(&self) -> u32 {
        self.state.frames.last().map_or(0, |frame| frame.id)
    }
    fn control(&self, node: Node) -> Control {
        Control {
            node_id: Some(node.node_id),
            pending: self.pending.clone(),
            ..self.state.control.clone()
        }
    }
    fn record(
        &mut self,
        node: Node,
        kind: &'static str,
        value: Option<Value>,
        changes: Vec<Change>,
    ) -> PyResult<usize> {
        self.commit(node, kind, value, changes, self.control(node))
    }
    fn commit(
        &mut self,
        node: Node,
        kind: &'static str,
        value: Option<Value>,
        mut changes: Vec<Change>,
        control: Control,
    ) -> PyResult<usize> {
        if control != self.state.control {
            changes.push(Change::Control {
                before: self.state.control.clone(),
                after: control,
            });
        }
        self.trace.commit(
            &mut self.state,
            self.meter,
            self.usage,
            node,
            Step {
                seq: 0,
                kind,
                node_id: node.node_id,
                value,
                changes,
            },
            self.temp_bytes,
        )
    }
    fn value_event(&mut self, node: Node, kind: &'static str, datum: Datum) -> PyResult<Datum> {
        self.record(node, kind, Some(datum.value.clone()), vec![])?;
        Ok(datum)
    }
    fn enter(&mut self, node: Node) -> PyResult<usize> {
        if self.pending.len() >= MAX_DEPTH {
            return Err(fail(node, "E_DEPTH_LIMIT"));
        }
        self.spend(1, node)?;
        self.pending.push(node.node_id);
        Ok(self.temps.len())
    }
    fn leave(&mut self, mark: usize) {
        self.pending.pop();
        self.truncate_temps(mark);
    }
    fn truncate_temps(&mut self, mark: usize) {
        self.temp_bytes -= self.temps[mark..].iter().map(Datum::size).sum::<usize>();
        self.temps.truncate(mark);
    }
    fn block(&mut self, body: &[Stmt]) -> PyResult<Flow> {
        for statement in body {
            let mark = self.enter(statement.node)?;
            let result = self.statement(statement);
            self.leave(mark);
            let result = result?;
            if !matches!(result, Flow::Next) {
                return Ok(result);
            }
        }
        Ok(Flow::Next)
    }
    fn scoped_block(&mut self, body: &[Stmt], proof: Proof, branch: bool) -> PyResult<Flow> {
        let saved = self.context;
        self.context = saved | proof;
        self.branches += usize::from(branch);
        let result = self.block(body);
        self.branches -= usize::from(branch);
        self.context = saved;
        result
    }
    fn block_condition(&mut self, expr: &Expr) -> PyResult<(Datum, bool)> {
        let size = self.temps.len();
        let datum = self.eval(expr)?;
        let truth = self.truth(&datum);
        self.truncate_temps(size);
        Ok((datum, truth))
    }
    fn statement(&mut self, statement: &Stmt) -> PyResult<Flow> {
        let node = statement.node;
        match &statement.kind {
            StmtKind::Assign(lhs, op, rhs) => self.assign(lhs, op, rhs, node)?,
            StmtKind::Eval(expr) => {
                self.eval(expr)?;
                self.record(node, "expression-end", None, vec![])?;
            }
            StmtKind::Def { name, .. } => {
                self.bind(
                    name,
                    Datum::new(Value::FunctionRef {
                        node_id: node.node_id,
                    }),
                    node,
                    0,
                )?;
            }
            StmtKind::If(arms, otherwise) => {
                let flag = if self.branches > 0 {
                    BRANCH | NESTED
                } else {
                    BRANCH
                };
                let mut proof = Proof::default().with(flag);
                for (expr, body) in arms {
                    let (condition, truth) = self.block_condition(expr)?;
                    proof = proof | condition.proof;
                    self.record(
                        expr.node,
                        "if-test",
                        Some(Value::Bool { value: truth }),
                        vec![],
                    )?;
                    if truth {
                        return self.scoped_block(body, proof, true);
                    }
                }
                return self.scoped_block(otherwise, proof, true);
            }
            StmtKind::While(cond, body) => return self.while_loop(cond, body, node),
            StmtKind::For(name, range, body) => return self.for_loop(name, range, body, node),
            StmtKind::Return(expr) => {
                let mut value = if let Some(expr) = expr {
                    self.eval(expr)?
                } else {
                    Datum::new(Value::None)
                };
                value.proof = value.proof | self.context;
                self.record(node, "return", Some(value.value.clone()), vec![])?;
                return Ok(Flow::Return(value));
            }
            StmtKind::Break | StmtKind::Continue | StmtKind::Pass => {
                self.record(node, node.kind, None, vec![])?;
                if matches!(statement.kind, StmtKind::Break) {
                    return Ok(Flow::Break);
                }
                if matches!(statement.kind, StmtKind::Continue) {
                    return Ok(Flow::Continue);
                }
            }
        }
        Ok(Flow::Next)
    }
    fn loop_step(
        &mut self,
        node: Node,
        kind: &'static str,
        iteration: Option<Iteration>,
        value: Value,
    ) -> PyResult<()> {
        let frame = self.frame();
        let mut control = self.control(node);
        control
            .iterations
            .retain(|entry| entry.node_id != node.node_id || entry.frame_id != frame);
        if let Some(iteration) = iteration {
            control.iterations.push(iteration);
        }
        self.commit(node, kind, Some(value), vec![], control)?;
        Ok(())
    }
    fn while_loop(&mut self, cond: &Expr, body: &[Stmt], node: Node) -> PyResult<Flow> {
        for index in 0.. {
            let (value, truth) = self.block_condition(cond)?;
            let current = truth.then_some(Iteration {
                node_id: node.node_id,
                frame_id: self.frame(),
                index,
                current: None,
                stop: None,
                stride: None,
            });
            self.loop_step(node, "while-test", current, Value::Bool { value: truth })?;
            self.facts.while_tests += 1;
            self.facts.while_test_inputs |= value.proof.inputs;
            if !truth {
                return Ok(Flow::Next);
            }
            self.facts.while_entries += 1;
            let flow = self.scoped_block(body, value.proof.with(WHILE), false)?;
            if !matches!(flow, Flow::Next | Flow::Continue) {
                self.loop_step(node, "loop-exit", None, Value::None)?;
                return Ok(if matches!(flow, Flow::Break) {
                    Flow::Next
                } else {
                    flow
                });
            }
        }
        unreachable!("budgeted while")
    }
    fn for_loop(&mut self, name: &str, range: &Expr, body: &[Stmt], node: Node) -> PyResult<Flow> {
        let ExprKind::Call(callee, arguments) = &range.kind else {
            unreachable!("parsed range");
        };
        let target = self.resolve("range", callee.node)?;
        if !matches!(target.value, Value::BuiltinRef { ref name } if name == "range") {
            return Err(fail(range.node, "E_PY_UNSUPPORTED"));
        }
        let items = self.arguments(arguments)?.0;
        let proof = items
            .iter()
            .fold(Proof::default(), |acc, value| acc | value.proof)
            .with(RANGE);
        let numbers = items
            .iter()
            .map(|value| values::integer(&value.value).ok_or_else(|| fail(range.node, "E_PY_TYPE")))
            .collect::<PyResult<Vec<_>>>()?;
        let (start, stop, stride) = match numbers.as_slice() {
            [stop] => (0, *stop, 1),
            [start, stop] => (*start, *stop, 1),
            [start, stop, stride] => (*start, *stop, *stride),
            _ => return Err(fail(range.node, "E_PY_TYPE")),
        };
        if stride == 0 {
            return Err(fail(range.node, "E_PY_VALUE"));
        }
        let mut cursor = start;
        for index in 0.. {
            let active = if stride > 0 {
                cursor < stop
            } else {
                cursor > stop
            };
            let current = active.then_some(Iteration {
                node_id: node.node_id,
                frame_id: self.frame(),
                index,
                current: Some(cursor),
                stop: Some(stop),
                stride: Some(stride),
            });
            self.loop_step(node, "range-test", current, Value::Bool { value: active })?;
            self.facts.range_tests += 1;
            self.facts.range_inputs |= proof.inputs;
            if !active {
                return Ok(Flow::Next);
            }
            self.facts.range_entries += 1;
            self.bind(
                name,
                Datum::observed(Value::Int { value: cursor }, proof),
                node,
                self.frame(),
            )?;
            let flow = self.scoped_block(body, proof, false)?;
            if !matches!(flow, Flow::Next | Flow::Continue) {
                self.loop_step(node, "loop-exit", None, Value::None)?;
                return Ok(if matches!(flow, Flow::Break) {
                    Flow::Next
                } else {
                    flow
                });
            }
            // Two bounded safe integers cannot overflow i64. An out-of-domain
            // next value has crossed stop and never becomes a Python integer.
            cursor += stride;
        }
        unreachable!("budgeted range")
    }
    fn resolve(&self, name: &str, node: Node) -> PyResult<Datum> {
        if let Some(frame) = self.state.frames.last() {
            let StmtKind::Def { locals, .. } = &self.defs[&frame.function_node_id].kind else {
                unreachable!()
            };
            if locals.contains(name) {
                return frame
                    .bindings
                    .get(name)
                    .cloned()
                    .map(|mut datum| {
                        datum.binding = Some(Binding {
                            frame: frame.id,
                            name: name.to_owned(),
                        });
                        datum
                    })
                    .ok_or_else(|| fail(node, "E_PY_UNBOUND_LOCAL"));
            }
        }
        if let Some(datum) = self.state.globals.get(name) {
            let mut datum = datum.clone();
            datum.binding = Some(Binding {
                frame: 0,
                name: name.to_owned(),
            });
            Ok(datum)
        } else if BUILTINS.contains(&name) {
            Ok(Datum::new(Value::BuiltinRef {
                name: name.to_owned(),
            }))
        } else {
            Err(fail(
                node,
                if DENIED.contains(&name) {
                    "E_PY_UNSUPPORTED"
                } else {
                    "E_PY_NAME"
                },
            ))
        }
    }
    fn bind(&mut self, name: &str, mut value: Datum, node: Node, frame_id: u32) -> PyResult<()> {
        let bindings = self.state.bindings(frame_id);
        let before = bindings.get(name).cloned();
        if before.is_none() && bindings.len() >= MAX_BINDINGS {
            return Err(fail(node, "E_MEMORY_LIMIT"));
        }
        value.proof = value.proof | self.context;
        value.binding = None;
        self.record(
            node,
            "bind",
            Some(value.value.clone()),
            vec![Change::Binding {
                frame_id,
                name: name.to_owned(),
                before,
                after: Some(value),
            }],
        )?;
        Ok(())
    }
    fn assign(&mut self, lhs: &Expr, op: &str, rhs: &Expr, node: Node) -> PyResult<()> {
        let first = if op != "=" {
            Some(self.eval(lhs)?)
        } else {
            None
        };
        let mut value = self.eval(rhs)?;
        if let Some(first) = first {
            value = self.arithmetic(&op[..op.len() - 1], first, value, node)?;
        }
        match &lhs.kind {
            ExprKind::Name(name) => self.bind(name, value, node, self.frame()),
            ExprKind::Index(base, index) => {
                let receiver = self.eval(base)?;
                let position = self.eval(index)?;
                let object_id = receiver
                    .list_id()
                    .ok_or_else(|| fail(lhs.node, "E_PY_TYPE"))?;
                let items = &self.state.objects[&object_id];
                let index = values::index(&position, items.len(), lhs.node)?;
                value.proof = (value.proof | position.proof | self.context).with(MUTATED);
                value.last_writer = self.aliased_writer(&receiver, object_id, node)?;
                let items = &self.state.objects[&object_id];
                self.record(
                    node,
                    "list-write",
                    Some(Value::ListRef { object_id }),
                    vec![Change::Slot {
                        object_id,
                        index,
                        before_len: items.len(),
                        after_len: items.len(),
                        before: Some(items[index].clone()),
                        after: Some(value),
                    }],
                )?;
                Ok(())
            }
            _ => unreachable!("parsed assignment target"),
        }
    }
    fn aliased_writer(
        &mut self,
        receiver: &Datum,
        object_id: u32,
        node: Node,
    ) -> PyResult<Option<Binding>> {
        let Some(writer) = &receiver.binding else {
            return Ok(None);
        };
        let groups = std::iter::once((0, &self.state.globals)).chain(
            self.state
                .frames
                .iter()
                .map(|frame| (frame.id, &frame.bindings)),
        );
        let mut examined = 0;
        let alias = groups
            .flat_map(|(frame, bindings)| {
                bindings
                    .iter()
                    .map(move |(name, value)| (frame, name, value))
            })
            .any(|(frame, name, value)| {
                examined += 1;
                (frame != writer.frame || name != &writer.name)
                    && value.list_id() == Some(object_id)
            });
        self.spend(examined, node)?;
        Ok(alias.then(|| writer.clone()))
    }
    fn eval(&mut self, expr: &Expr) -> PyResult<Datum> {
        let mark = self.enter(expr.node)?;
        let result = self.eval_expression(expr);
        self.leave(mark);
        let datum = result?;
        if matches!(
            datum.value,
            Value::FunctionRef { .. } | Value::BuiltinRef { .. }
        ) {
            return Err(fail(expr.node, "E_PY_UNSUPPORTED"));
        }
        let bytes = self.temp_bytes + datum.size();
        if bytes + self.state.allocator.live_bytes > self.meter.limits().live_bytes {
            return Err(fail(expr.node, "E_MEMORY_LIMIT"));
        }
        self.temp_bytes = bytes;
        self.temps.push(datum.clone());
        Ok(datum)
    }
    fn eval_expression(&mut self, expr: &Expr) -> PyResult<Datum> {
        let node = expr.node;
        match &expr.kind {
            ExprKind::None => Ok(Datum::new(Value::None)),
            ExprKind::Bool(value) => Ok(Datum::new(Value::Bool { value: *value })),
            ExprKind::Int(text) => {
                self.spend(text.len(), node)?;
                Ok(Datum::new(values::decimal(text, node)?))
            }
            ExprKind::Float(value) => Ok(Datum::new(values::float(*value, node)?)),
            ExprKind::Text(value) => {
                self.spend(value.len(), node)?;
                Ok(Datum::new(Value::Str {
                    value: value.clone(),
                }))
            }
            ExprKind::Name(name) => self.resolve(name, node),
            ExprKind::Group(value) => self.eval(value),
            ExprKind::List(expressions) => {
                if expressions.len() > MAX_LIST {
                    return Err(fail(node, "E_MEMORY_LIMIT"));
                }
                let items = expressions
                    .iter()
                    .map(|expr| self.eval(expr))
                    .collect::<PyResult<Vec<_>>>()?;
                self.allocate(items, Proof::default(), node, "list-create")
            }
            ExprKind::Unary(op, expr) => {
                let operand = self.eval(expr)?;
                let value = if *op == "not" {
                    Value::Bool {
                        value: !self.truth(&operand),
                    }
                } else {
                    values::unary(op, &operand.value, node)?
                };
                self.value_event(node, "unary", Datum::observed(value, operand.proof))
            }
            ExprKind::Binary(op, lhs, rhs) => {
                let left = self.eval(lhs)?;
                if matches!(*op, "and" | "or") {
                    let take = self.truth(&left) == (*op == "and");
                    self.record(
                        node,
                        if take {
                            "boolean-right"
                        } else {
                            "boolean-short"
                        },
                        Some(Value::Bool { value: take }),
                        vec![],
                    )?;
                    let mut value = if take { self.eval(rhs)? } else { left.clone() };
                    value.proof = value.proof | left.proof;
                    if *op == "and" {
                        value.proof = value.proof.with(if take { AND_RIGHT } else { AND_SHORT });
                    }
                    Ok(value)
                } else {
                    let right = self.eval(rhs)?;
                    self.arithmetic(op, left, right, node)
                }
            }
            ExprKind::Compare(first, chain) => {
                let mut left = self.eval(first)?;
                let mut proof = left.proof;
                for (op, expr) in chain {
                    let right = self.eval(expr)?;
                    self.spend((left.size() + right.size()).div_ceil(16), node)?;
                    let value = values::compare(op, &left.value, &right.value, expr.node)?;
                    self.record(expr.node, "compare", Some(Value::Bool { value }), vec![])?;
                    proof = proof | right.proof;
                    if !value {
                        return Ok(Datum::observed(Value::Bool { value: false }, proof));
                    }
                    left = right;
                }
                Ok(Datum::observed(Value::Bool { value: true }, proof))
            }
            ExprKind::Index(base, index) => {
                let base = self.eval(base)?;
                let index = self.eval(index)?;
                self.read_index(base, index, node)
            }
            ExprKind::Slice(base, parts) => {
                let base = self.eval(base)?;
                let mut resolved: [Option<Datum>; 3] = [None, None, None];
                for (dest, part) in resolved.iter_mut().zip(parts) {
                    if let Some(expr) = part {
                        *dest = Some(self.eval(expr)?);
                    }
                }
                self.read_slice(base, resolved, node)
            }
            ExprKind::Call(callee, arguments) => {
                let ExprKind::Name(name) = &callee.kind else {
                    unreachable!("parsed call");
                };
                let target = self.resolve(name, callee.node)?;
                let (args, keywords) = self.arguments(arguments)?;
                match target.value {
                    Value::FunctionRef { node_id } if keywords.is_empty() => {
                        self.call(node_id, args, node)
                    }
                    Value::BuiltinRef { name } => self.builtin(&name, args, keywords, node),
                    _ => Err(fail(node, "E_PY_TYPE")),
                }
            }
            ExprKind::Method(receiver, name, args) => {
                let receiver = self.eval(receiver)?;
                let (args, _) = self.arguments(args)?;
                self.method(receiver, name, args, node)
            }
        }
    }
    fn arguments(&mut self, args: &Arguments) -> PyResult<(Vec<Datum>, BTreeMap<String, Datum>)> {
        let positional = args
            .positional
            .iter()
            .map(|expr| self.eval(expr))
            .collect::<PyResult<Vec<_>>>()?;
        let mut keywords = BTreeMap::new();
        for (name, expr) in &args.keywords {
            keywords.insert(name.clone(), self.eval(expr)?);
        }
        Ok((positional, keywords))
    }
    fn truth(&self, datum: &Datum) -> bool {
        match &datum.value {
            Value::None => false,
            Value::Bool { value } => *value,
            Value::Int { value } => *value != 0,
            Value::F64 { bits } => f64::from_bits(*bits) != 0.0,
            Value::Str { value } => !value.is_empty(),
            Value::ListRef { object_id } => !self.state.objects[object_id].is_empty(),
            _ => true,
        }
    }
    fn arithmetic(&mut self, op: &str, left: Datum, right: Datum, node: Node) -> PyResult<Datum> {
        self.spend((left.size() + right.size()).div_ceil(16), node)?;
        let value = values::arithmetic(op, &left.value, &right.value, node)?;
        let (kind, flag) = match op {
            "//" => ("integer-floor", FLOOR),
            "%" => ("integer-remainder", REM),
            "/" => ("true-division", DIVIDE),
            "-" => ("subtract", SUBTRACT),
            "+" if matches!(value, Value::Str { .. }) => ("string-concat", CONCAT),
            _ => ("binary", 0),
        };
        let proof = if op == "*" && values::zero(&left.value) {
            left.proof
        } else if op == "*" && values::zero(&right.value) {
            right.proof
        } else {
            left.proof | right.proof
        };
        self.value_event(node, kind, Datum::observed(value, proof.with(flag)))
    }
    fn allocate(
        &mut self,
        mut items: Vec<Datum>,
        proof: Proof,
        node: Node,
        kind: &'static str,
    ) -> PyResult<Datum> {
        let bytes = items.iter().map(Datum::size).sum::<usize>();
        if self.state.allocator.live_bytes + bytes + 32 > self.meter.limits().live_bytes
            || (self.state.objects.len() >= 64
                && self.state.allocator.next_object.is_multiple_of(64))
        {
            self.collect(node)?;
        }
        for datum in &mut items {
            datum.binding = None;
        }
        self.spend(bytes.div_ceil(16), node)?;
        let object_id = self.state.allocator.next_object + 1;
        let value = Value::ListRef { object_id };
        self.record(
            node,
            kind,
            Some(value.clone()),
            vec![Change::Object {
                object_id,
                before: None,
                after: Some(items),
            }],
        )?;
        Ok(Datum::observed(value, proof))
    }
    fn collect(&mut self, node: Node) -> PyResult<()> {
        let roots = self.state.globals.values().chain(self.temps.iter()).chain(
            self.state
                .frames
                .iter()
                .flat_map(|frame| frame.bindings.values()),
        );
        let mut stack = roots.filter_map(Datum::list_id).collect::<Vec<_>>();
        let mut live = BTreeSet::new();
        let mut units = self.state.objects.len() + self.temps.len();
        while let Some(id) = stack.pop() {
            if live.insert(id) {
                let items = &self.state.objects[&id];
                units += items.len();
                stack.extend(items.iter().filter_map(Datum::list_id));
            }
        }
        self.spend(units, node)?;
        let changes = self
            .state
            .objects
            .iter()
            .filter(|(id, _)| !live.contains(id))
            .map(|(&object_id, items)| Change::Object {
                object_id,
                before: Some(items.clone()),
                after: None,
            })
            .collect::<Vec<_>>();
        if !changes.is_empty() {
            self.record(node, "list-collect", None, changes)?;
        }
        Ok(())
    }
    fn read_index(&mut self, base: Datum, position: Datum, node: Node) -> PyResult<Datum> {
        let proof = base.proof | position.proof;
        match &base.value {
            Value::ListRef { object_id } => {
                let list = &self.state.objects[object_id];
                let index = values::index(&position, list.len(), node)?;
                let mut datum = list[index].clone();
                datum.proof = datum.proof | proof;
                datum.proof.observed_list = *object_id;
                if let (Some(writer), Some(reader)) = (&datum.last_writer, &base.binding)
                    && writer != reader
                {
                    datum.proof = datum.proof.with(ALIAS);
                }
                datum.binding = None;
                self.record(node, "list-index", Some(base.value.clone()), vec![])?;
                Ok(datum)
            }
            Value::Str { value } => {
                self.spend(value.len(), node)?;
                let index = values::index(&position, value.chars().count(), node)?;
                let value = value
                    .chars()
                    .nth(index)
                    .expect("checked code point")
                    .to_string();
                self.value_event(
                    node,
                    "string-index",
                    Datum::observed(Value::Str { value }, proof.with(STR_INDEX)),
                )
            }
            _ => Err(fail(node, "E_PY_TYPE")),
        }
    }
    fn read_slice(
        &mut self,
        base: Datum,
        parts: [Option<Datum>; 3],
        node: Node,
    ) -> PyResult<Datum> {
        let proof = parts
            .iter()
            .flatten()
            .fold(base.proof, |acc, datum| acc | datum.proof);
        match &base.value {
            Value::ListRef { object_id } => {
                let list = &self.state.objects[object_id];
                let selected = values::slice(&parts, list.len(), node)?;
                let items = selected
                    .into_iter()
                    .map(|index| list[index].clone())
                    .collect();
                self.allocate(items, proof.with(SLICE), node, "list-slice")
            }
            Value::Str { value } => {
                self.spend(value.len(), node)?;
                let points = value.chars().collect::<Vec<_>>();
                let value = values::slice(&parts, points.len(), node)?
                    .into_iter()
                    .map(|index| points[index])
                    .collect();
                self.value_event(
                    node,
                    "string-slice",
                    Datum::observed(values::string(value, node)?, proof),
                )
            }
            _ => Err(fail(node, "E_PY_TYPE")),
        }
    }
    fn method(
        &mut self,
        receiver: Datum,
        name: &str,
        args: Vec<Datum>,
        node: Node,
    ) -> PyResult<Datum> {
        let object_id = receiver.list_id().ok_or_else(|| fail(node, "E_PY_TYPE"))?;
        let items = &self.state.objects[&object_id];
        let len = items.len();
        let (kind, change, result) = match (name, args.as_slice()) {
            ("append", [value]) => {
                if len >= MAX_LIST {
                    return Err(fail(node, "E_MEMORY_LIMIT"));
                }
                let mut value = value.clone();
                value.binding = None;
                value.proof = (value.proof | self.context).with(MUTATED);
                value.last_writer = self.aliased_writer(&receiver, object_id, node)?;
                (
                    "list-append",
                    Change::Slot {
                        object_id,
                        index: len,
                        before_len: len,
                        after_len: len + 1,
                        before: None,
                        after: Some(value),
                    },
                    Datum::new(Value::None),
                )
            }
            ("pop", [] | [_]) => {
                let position = args.first().cloned().unwrap_or_else(|| Datum::int(-1));
                let index = values::index(&position, len, node)?;
                let mut result = items[index].clone();
                result.proof = result.proof | position.proof | receiver.proof;
                result.binding = None;
                (
                    "list-pop",
                    Change::Slot {
                        object_id,
                        index,
                        before_len: len,
                        after_len: len - 1,
                        before: Some(items[index].clone()),
                        after: None,
                    },
                    result,
                )
            }
            _ => return Err(fail(node, "E_PY_TYPE")),
        };
        self.record(node, kind, Some(Value::ListRef { object_id }), vec![change])?;
        Ok(result)
    }
    fn call(&mut self, function: u32, args: Vec<Datum>, call: Node) -> PyResult<Datum> {
        let StmtKind::Def { params, body, .. } = &self.defs[&function].kind else {
            unreachable!()
        };
        if params.len() != args.len() {
            return Err(fail(call, "E_PY_TYPE"));
        }
        if self.state.frames.len() >= MAX_FRAMES {
            return Err(fail(call, "E_STACK_LIMIT"));
        }
        let id = self.state.allocator.next_frame + 1;
        let bindings = params
            .iter()
            .cloned()
            .zip(args.into_iter().map(|mut item| {
                item.binding = None;
                item
            }))
            .collect();
        self.record(
            call,
            "frame-enter",
            None,
            vec![Change::Frame {
                before: None,
                after: Some(Frame {
                    id,
                    function_node_id: function,
                    call_node_id: call.node_id,
                    bindings,
                }),
            }],
        )?;
        let mut value = match self.block(body)? {
            Flow::Return(value) => value,
            Flow::Next => Datum::new(Value::None),
            _ => unreachable!("loop control cannot leave function"),
        };
        let frame = self.state.frames.last().expect("entered frame").clone();
        self.record(
            call,
            "frame-exit",
            Some(value.value.clone()),
            vec![Change::Frame {
                before: Some(frame),
                after: None,
            }],
        )?;
        value.proof.returned_from = id;
        value.proof.function_node = function;
        value.binding = None;
        Ok(value)
    }
    fn builtin(
        &mut self,
        name: &str,
        args: Vec<Datum>,
        keys: BTreeMap<String, Datum>,
        node: Node,
    ) -> PyResult<Datum> {
        if name == "print" {
            return self.print(args, keys, node);
        }
        if !keys.is_empty() {
            return Err(fail(node, "E_PY_UNSUPPORTED"));
        }
        if name == "input" {
            return self.read_input(&args, node);
        }
        if name == "range" {
            return Err(fail(node, "E_PY_UNSUPPORTED"));
        }
        let [arg] = args.as_slice() else {
            return Err(fail(node, "E_PY_TYPE"));
        };
        self.spend(arg.size(), node)?;
        let (kind, value, flag) = match name {
            "len" => {
                let len = match &arg.value {
                    Value::ListRef { object_id } => self.state.objects[object_id].len(),
                    Value::Str { value } => value.chars().count(),
                    _ => return Err(fail(node, "E_PY_TYPE")),
                };
                ("length", Value::Int { value: len as i64 }, 0)
            }
            "bool" => (
                "truth",
                Value::Bool {
                    value: self.truth(arg),
                },
                0,
            ),
            "abs" => ("absolute", values::unary("abs", &arg.value, node)?, 0),
            "str" => (
                "string-convert",
                values::string(values::format_scalar(&arg.value, node)?, node)?,
                0,
            ),
            "int" => (
                "integer-convert",
                values::as_int(&arg.value, node)?,
                CONVERT,
            ),
            "float" => ("float-convert", values::as_float(&arg.value, node)?, 0),
            _ => unreachable!("resolved builtin"),
        };
        let mut proof = arg.proof.with(flag);
        if flag == CONVERT {
            proof.converted_inputs |= arg.proof.inputs;
        }
        self.value_event(node, kind, Datum::observed(value, proof))
    }
    fn output_change(&self, append: String) -> Change {
        let before_bytes = self.state.output.len();
        Change::Output {
            before_bytes,
            after_bytes: before_bytes + append.len(),
            append,
        }
    }
    fn print(
        &mut self,
        args: Vec<Datum>,
        keys: BTreeMap<String, Datum>,
        node: Node,
    ) -> PyResult<Datum> {
        let option = |key, default| match keys.get(key) {
            Some(Datum {
                value: Value::Str { value },
                ..
            }) => Ok(value.as_str()),
            Some(_) => Err(fail(node, "E_PY_TYPE")),
            None => Ok(default),
        };
        let sep = option("sep", " ")?;
        let end = option("end", "\n")?;
        let mut out = String::new();
        let mut proofs = Vec::new();
        let mut ancestors = BTreeSet::new();
        for (index, arg) in args.iter().enumerate() {
            if index > 0 {
                self.append_text(&mut out, sep, node)?;
            }
            let proof = self.render(arg, node, &mut ancestors, &mut out, false)?;
            proofs.push(proof | self.context);
        }
        self.append_text(&mut out, end, node)?;
        let seq = self.record(node, "print", None, vec![self.output_change(out)])?;
        self.facts
            .prints
            .extend(proofs.into_iter().map(|proof| Printed {
                seq,
                node_id: node.node_id,
                proof,
            }));
        Ok(Datum::new(Value::None))
    }
    fn append_text(&mut self, out: &mut String, text: &str, node: Node) -> PyResult<()> {
        if self.usage.output_bytes + out.len() + text.len() > self.meter.limits().output_bytes {
            return Err(fail(node, "E_OUTPUT_LIMIT"));
        }
        self.spend(text.len().div_ceil(16) + 1, node)?;
        out.push_str(text);
        Ok(())
    }
    fn render(
        &mut self,
        datum: &Datum,
        node: Node,
        ancestors: &mut BTreeSet<u32>,
        out: &mut String,
        nested: bool,
    ) -> PyResult<Proof> {
        let mut proof = datum.proof;
        if let Some(id) = datum.list_id() {
            if ancestors.contains(&id) {
                self.append_text(out, "[...]", node)?;
                return Ok(proof);
            }
            if ancestors.len() + self.pending.len() >= MAX_DEPTH {
                return Err(fail(node, "E_DEPTH_LIMIT"));
            }
            ancestors.insert(id);
            self.append_text(out, "[", node)?;
            for index in 0..self.state.objects[&id].len() {
                if index > 0 {
                    self.append_text(out, ", ", node)?;
                }
                let value = self.state.objects[&id][index].clone();
                proof = proof | self.render(&value, node, ancestors, out, true)?;
            }
            self.append_text(out, "]", node)?;
            ancestors.remove(&id);
        } else {
            self.spend(datum.size().div_ceil(8), node)?;
            let rendered = if let Value::Str { value } = &datum.value
                && nested
            {
                values::repr_string(value)
            } else {
                values::format_scalar(&datum.value, node)?
            };
            self.append_text(out, &rendered, node)?;
        }
        Ok(proof)
    }
    fn read_input(&mut self, args: &[Datum], node: Node) -> PyResult<Datum> {
        match args {
            [] => {}
            [
                Datum {
                    value: Value::Str { value },
                    ..
                },
            ] => {
                self.record(
                    node,
                    "input-prompt",
                    None,
                    vec![self.output_change(value.clone())],
                )?;
            }
            _ => return Err(fail(node, "E_PY_TYPE")),
        }
        let before = self.state.control.input_cursor;
        let rest = &self.input[before..];
        if rest.is_empty() {
            return Err(fail(node, "E_PY_EOF"));
        }
        let end = rest.find(['\n', '\r']).unwrap_or(rest.len());
        let mut control = self.control(node);
        let width = if rest[end..].starts_with("\r\n") {
            2
        } else {
            usize::from(end < rest.len())
        };
        control.input_cursor = before + end + width;
        self.spend(end + width, node)?;
        let value = Value::Str {
            value: rest[..end].to_owned(),
        };
        self.commit(node, "input-read", Some(value.clone()), vec![], control)?;
        let inputs = 1 << self.facts.reads.min(15);
        self.facts.reads += 1;
        Ok(Datum::observed(
            value,
            Proof {
                inputs,
                ..Proof::default()
            },
        ))
    }
}

pub(crate) fn valid_input(text: &str) -> bool {
    text.len() <= MAX_INPUT
}
