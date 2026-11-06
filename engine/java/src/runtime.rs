use crate::trace::Step;
use std::collections::BTreeMap;

use crate::syntax::{Block, Expr, Expression, Method, Node, Program, Statement, Stmt, Type};
use crate::trace::{
    BindingKey, Change, Datum, Evidence, Frame, MAX_ARRAY, MAX_FRAMES, Object, Recorder, Trace,
    Usage, Value,
};
use crate::types::{self, Typed};
use crate::{Fault, JavaResult, MAX_STRING_BYTES, Meter, charge};

pub(crate) const LENGTH: u32 = 1 << 0;
pub(crate) const DIV: u32 = 1 << 1;
pub(crate) const REM: u32 = 1 << 2;
pub(crate) const WIDE_ADD: u32 = 1 << 3;
pub(crate) const NARROW: u32 = 1 << 4;
pub(crate) const AND_SHORT: u32 = 1 << 5;
pub(crate) const AND_RIGHT: u32 = 1 << 6;
pub(crate) const BRANCH: u32 = 1 << 7;
pub(crate) const WHILE_UPDATE: u32 = 1 << 8;
pub(crate) const FOR_UPDATE: u32 = 1 << 9;
pub(crate) const SLOT_0: u32 = 1 << 10;
pub(crate) const SLOT_1: u32 = 1 << 11;
pub(crate) const SUB: u32 = 1 << 12;
pub(crate) const FIELD_DEFAULT: u32 = 1 << 13;
pub(crate) const FIELD_ALIAS: u32 = 1 << 14;
pub(crate) const METHOD_RETURN: u32 = 1 << 15;
pub(crate) const REFERENCE_PARAMETER: u32 = 1 << 16;
const ADD: u32 = 1 << 17;
const MULTIPLY: u32 = 1 << 18;
const MAX_DEPTH: usize = 256;
const PARAMETER: u32 = 1 << 31;
const FIELD_WRITTEN: u32 = 1 << 19;

macro_rules! arithmetic {
    ($left:expr, $right:expr, $op:expr) => {{
        let (left, right) = ($left, $right);
        match $op {
            "+" => left.wrapping_add(right),
            "-" => left.wrapping_sub(right),
            "*" => left.wrapping_mul(right),
            "/" => left.wrapping_div(right),
            "%" => left.wrapping_rem(right),
            _ => unreachable!("checked arithmetic"),
        }
    }};
}

pub(crate) struct Run {
    pub stdout: String,
    pub trace: Trace,
    pub fault: Option<Fault>,
    pub printed: Vec<Print>,
    pub while_test_inputs: u64,
    pub for_test_inputs: u64,
}

pub(crate) struct Print {
    pub seq: usize,
    pub node_id: u32,
    pub evidence: Evidence,
    pub value: Value,
}

#[derive(Default)]
struct ParameterWrite {
    original: Option<u32>,
    rebound: Option<u32>,
    evidence: Evidence,
    confirmed: bool,
}

struct Runtime<'a, 'p> {
    program: &'p Program,
    typed: &'p Typed,
    input: &'a str,
    meter: &'a mut Meter,
    usage: &'a mut Usage,
    record: Recorder,
    scopes: Vec<Vec<BTreeMap<String, u32>>>,
    path: Vec<u32>,
    controls: Vec<Evidence>,
    loops: Vec<(u32, u32, Evidence)>,
    scanner: bool,
    reads: u32,
    temp_bytes: usize,
    printed: Vec<Print>,
    while_test_inputs: u64,
    for_test_inputs: u64,
    parameters: BTreeMap<(u32, u32), ParameterWrite>,
}

enum Flow {
    Normal,
    Return(Option<Datum>),
    Break,
    Continue,
}

pub(crate) fn run(
    program: &Program,
    typed: &Typed,
    input: &str,
    meter: &mut Meter,
    usage: &mut Usage,
) -> Run {
    let mut rt = Runtime {
        program,
        typed,
        input,
        meter,
        usage,
        record: Recorder::default(),
        scopes: Vec::new(),
        path: Vec::new(),
        controls: Vec::new(),
        loops: Vec::new(),
        scanner: false,
        reads: 0,
        temp_bytes: 0,
        printed: Vec::new(),
        while_test_inputs: 0,
        for_test_inputs: 0,
        parameters: BTreeMap::new(),
    };
    let method = &program.methods["main"];
    let result = rt
        .allocate(&method.node, Object::StringArray { slots: Vec::new() })
        .and_then(|args| rt.call(method, vec![args], &method.node));
    if result.is_err() {
        rt.record.trace.completeness = "prefix";
    }
    Run {
        stdout: rt.record.state.output,
        trace: rt.record.trace,
        fault: result.err(),
        printed: rt.printed,
        while_test_inputs: rt.while_test_inputs,
        for_test_inputs: rt.for_test_inputs,
    }
}

fn fault(code: &'static str, node: &Node) -> Fault {
    Fault::new(code, node.byte_range, "runtime")
}

fn converted(datum: Datum, target: &Type) -> Datum {
    let mut next = datum;
    match (target, &next.value) {
        (Type::Long, Value::Int { value }) => {
            next.value = Value::Long {
                value: i64::from(*value),
            }
        }
        (Type::Int, Value::Long { value }) => {
            next.value = Value::Int {
                value: *value as i32,
            };
            next.evidence = next.evidence.tag(NARROW);
        }
        _ => {}
    }
    next
}

impl<'p> Runtime<'_, 'p> {
    fn at<T>(
        &mut self,
        node: &Node,
        work: impl FnOnce(&mut Self) -> JavaResult<T>,
    ) -> JavaResult<T> {
        if self.path.len() >= MAX_DEPTH {
            return Err(fault("E_DEPTH_LIMIT", node));
        }
        charge(self.meter, 1, node.byte_range, "runtime")?;
        self.path.push(node.node_id);
        let result = work(self);
        self.path.pop();
        result
    }

    fn temporary<T>(
        &mut self,
        held: usize,
        node: &Node,
        work: impl FnOnce(&mut Self) -> JavaResult<T>,
    ) -> JavaResult<T> {
        if self.record.state.allocator.live_bytes + self.temp_bytes + held
            > self.meter.limits().live_bytes
        {
            return Err(fault("E_MEMORY_LIMIT", node));
        }
        self.temp_bytes += held;
        let result = work(self);
        self.temp_bytes -= held;
        result
    }

    fn event(
        &mut self,
        node: &Node,
        kind: &'static str,
        value: Option<&Datum>,
        changes: Vec<Change>,
    ) -> JavaResult<usize> {
        self.record_event(
            node,
            kind,
            value,
            changes,
            self.record.state.control.input_cursor,
        )
    }

    fn record_event(
        &mut self,
        node: &Node,
        kind: &'static str,
        value: Option<&Datum>,
        mut changes: Vec<Change>,
        input_cursor: usize,
    ) -> JavaResult<usize> {
        let before = &self.record.state.control;
        let mut after = before.clone();
        after.node_id = Some(node.node_id);
        after.path.clone_from(&self.path);
        after.input_cursor = input_cursor;
        if *before != after {
            changes.push(Change::Control {
                before: before.clone(),
                after,
            });
        }
        self.record.commit(
            self.meter,
            self.usage,
            node,
            Step {
                seq: 0,
                kind,
                node_id: node.node_id,
                value: value.map(|value| value.value.clone()),
                changes,
            },
            self.temp_bytes,
        )
    }

    fn allocate(&mut self, node: &Node, object: Object) -> JavaResult<Datum> {
        let object_id = self.record.state.allocator.objects + 1;
        let value = Datum::new(Value::Ref { object_id });
        self.event(
            node,
            "allocate",
            Some(&value),
            vec![Change::Object {
                object_id,
                before: None,
                after: Some(object),
            }],
        )?;
        Ok(value)
    }

    fn frame(&self) -> &Frame {
        self.record
            .state
            .frames
            .last()
            .expect("active method frame")
    }

    fn control_proof(&self) -> Evidence {
        self.controls
            .iter()
            .copied()
            .fold(Evidence::default(), |a, b| a | b)
    }

    fn call(
        &mut self,
        method: &'p Method,
        values: Vec<Datum>,
        call: &Node,
    ) -> JavaResult<Option<Datum>> {
        if self.record.state.frames.len() >= MAX_FRAMES {
            return Err(fault("E_STACK_LIMIT", call));
        }
        let frame_id = self.record.state.allocator.frames + 1;
        let mut names = BTreeMap::new();
        let bindings = method
            .params
            .iter()
            .zip(values)
            .enumerate()
            .map(|(index, ((ty, name), value))| {
                names.insert(name.clone(), PARAMETER | index as u32);
                (name.clone(), converted(value, ty))
            })
            .collect();
        let frame = Frame {
            id: frame_id,
            method_node_id: method.node.node_id,
            call_node_id: call.node_id,
            bindings,
        };
        let before = self.record.state.counters;
        let mut after = before;
        after.calls += 1;
        self.event(
            call,
            "frame-enter",
            None,
            vec![
                Change::Frame {
                    before: None,
                    after: Some(frame),
                },
                Change::Counters { before, after },
            ],
        )?;
        self.scopes.push(vec![names]);
        let flow = self.block(&method.body)?;
        self.scopes.pop();
        let result = match flow {
            Flow::Return(result) => result.map(|value| {
                let mut value = converted(value, &method.result);
                value.evidence = value.evidence.tag(METHOD_RETURN);
                value.origin = None;
                value
            }),
            Flow::Normal => None,
            _ => unreachable!("unhandled loop transfer after type check"),
        };
        self.event(
            call,
            "frame-exit",
            result.as_ref(),
            vec![Change::Frame {
                before: Some(self.frame().clone()),
                after: None,
            }],
        )?;
        Ok(result)
    }

    fn in_scope(
        &mut self,
        node: &Node,
        work: impl FnOnce(&mut Self) -> JavaResult<Flow>,
    ) -> JavaResult<Flow> {
        self.scopes.last_mut().unwrap().push(BTreeMap::new());
        let result = work(self)?;
        let scope = self.scopes.last_mut().unwrap().pop().unwrap();
        if !scope.is_empty() {
            let frame = self.frame();
            let changes = scope
                .into_keys()
                .map(|name| Change::Binding {
                    frame_id: frame.id,
                    before: frame.bindings.get(&name).cloned(),
                    name,
                    after: None,
                })
                .collect();
            self.event(node, "scope-exit", None, changes)?;
        }
        Ok(result)
    }

    fn block(&mut self, block: &'p Block) -> JavaResult<Flow> {
        self.at(&block.node, |rt| {
            rt.in_scope(&block.node, |rt| {
                for stmt in &block.item {
                    let flow = rt.statement(stmt)?;
                    if !matches!(flow, Flow::Normal) {
                        return Ok(flow);
                    }
                }
                Ok(Flow::Normal)
            })
        })
    }

    fn lookup_key(&self, name: &str) -> BindingKey {
        let declaration = self
            .scopes
            .last()
            .unwrap()
            .iter()
            .rev()
            .find_map(|scope| scope.get(name))
            .copied()
            .expect("checked local binding");
        BindingKey {
            frame: self.frame().id,
            declaration,
        }
    }

    fn binding(
        &mut self,
        node: &Node,
        name: &str,
        mut value: Datum,
        declaration: bool,
    ) -> JavaResult<()> {
        let frame = self.frame();
        let before = frame.bindings.get(name).cloned();
        let key = (!declaration).then(|| self.lookup_key(name));
        if !declaration
            && let Some((frame_id, flag, proof)) = self.loops.last().copied()
            && frame_id == frame.id
            && (value.evidence.flags & if flag == WHILE_UPDATE { ADD } else { MULTIPLY }) != 0
        {
            value.evidence = (value.evidence | proof).tag(flag);
        }
        value.evidence = value.evidence | self.control_proof();
        value.origin = None;
        let counters = self.record.state.counters;
        let mut after_counters = counters;
        after_counters.writes += 1;
        self.event(
            node,
            if declaration { "declare" } else { "assign" },
            Some(&value),
            vec![
                Change::Binding {
                    frame_id: frame.id,
                    name: name.to_owned(),
                    before: before.clone(),
                    after: Some(value.clone()),
                },
                Change::Counters {
                    before: counters,
                    after: after_counters,
                },
            ],
        )?;
        if declaration {
            self.scopes
                .last_mut()
                .unwrap()
                .last_mut()
                .unwrap()
                .insert(name.to_owned(), node.node_id);
        } else if let Some(key) = key
            && let Value::Ref { object_id } = value.value
        {
            let previous = before.and_then(|v| match v.value {
                Value::Ref { object_id } => Some(object_id),
                _ => None,
            });
            if let Some(record) = self.parameters.get_mut(&(key.frame, key.declaration))
                && previous == record.original
                && previous != Some(object_id)
            {
                record.rebound = Some(object_id);
            }
        }
        Ok(())
    }

    fn statement(&mut self, stmt: &'p Stmt) -> JavaResult<Flow> {
        self.at(&stmt.node, |rt| {
            let node = &stmt.node;
            match &stmt.item {
                Statement::Block(block) => return rt.block(block),
                Statement::Let(ty, name, value) => {
                    let value = converted(rt.value(value)?, ty);
                    rt.binding(node, name, value, true)?;
                }
                Statement::Assign(target, value) => rt.assign(node, target, value)?,
                Statement::Increment(name, plus) => {
                    let mut value = rt.frame().bindings[name].clone();
                    let change = if *plus { 1 } else { -1 };
                    value.value = match value.value {
                        Value::Int { value } => Value::Int {
                            value: value.wrapping_add(change),
                        },
                        Value::Long { value } => Value::Long {
                            value: value.wrapping_add(i64::from(change)),
                        },
                        _ => unreachable!("checked update type"),
                    };
                    rt.binding(node, name, value, false)?;
                }
                Statement::Call(expr) => {
                    rt.expression(expr)?;
                }
                Statement::If(test, yes, no) => {
                    let choice = rt.value(test)?;
                    rt.event(node, "branch", Some(&choice), vec![])?;
                    rt.controls.push(choice.evidence.tag(BRANCH));
                    let flow = if choice.value.as_bool() {
                        rt.block(yes)
                    } else if let Some(no) = no {
                        rt.statement(no)
                    } else {
                        Ok(Flow::Normal)
                    };
                    rt.controls.pop();
                    return flow;
                }
                Statement::While(test, body) => {
                    return rt.loop_body(node, Some(test), None, body, WHILE_UPDATE);
                }
                Statement::For {
                    init,
                    test,
                    update,
                    body,
                } => {
                    return rt.in_scope(node, |rt| {
                        if let Some(init) = init {
                            rt.statement(init)?;
                        }
                        rt.loop_body(node, test.as_ref(), update.as_deref(), body, FOR_UPDATE)
                    });
                }
                Statement::Return(expr) => {
                    let mut result = expr.as_ref().map(|expr| rt.value(expr)).transpose()?;
                    if let Some(value) = &mut result {
                        value.evidence = value.evidence | rt.control_proof();
                    }
                    rt.event(node, "return", result.as_ref(), vec![])?;
                    return Ok(Flow::Return(result));
                }
                Statement::Break => {
                    rt.event(node, "break", None, vec![])?;
                    return Ok(Flow::Break);
                }
                Statement::Continue => {
                    rt.event(node, "continue", None, vec![])?;
                    return Ok(Flow::Continue);
                }
            }
            Ok(Flow::Normal)
        })
    }

    fn loop_body(
        &mut self,
        node: &Node,
        test: Option<&'p Expr>,
        update: Option<&'p Stmt>,
        body: &'p Block,
        flag: u32,
    ) -> JavaResult<Flow> {
        loop {
            let condition = match test {
                Some(expr) => self.value(expr)?,
                None => Datum::new(Value::Bool { value: true }),
            };
            self.event(
                node,
                if flag == WHILE_UPDATE {
                    "while-test"
                } else {
                    "for-test"
                },
                Some(&condition),
                vec![],
            )?;
            if flag == WHILE_UPDATE {
                self.while_test_inputs |= condition.evidence.inputs;
            } else {
                self.for_test_inputs |= condition.evidence.inputs;
            }
            if !condition.value.as_bool() {
                return Ok(Flow::Normal);
            }
            self.loops.push((self.frame().id, flag, condition.evidence));
            let flow = self.block(body)?;
            self.loops.pop();
            match flow {
                Flow::Break => return Ok(Flow::Normal),
                Flow::Return(_) => return Ok(flow),
                _ => {}
            }
            if let Some(update) = update {
                self.statement(update)?;
            }
        }
    }

    fn assign(&mut self, node: &Node, target: &'p Expr, value: &'p Expr) -> JavaResult<()> {
        let ty = self.typed.of(target);
        match &target.item {
            Expression::Name(name) => {
                let value = converted(self.value(value)?, ty);
                self.binding(node, name, value, false)
            }
            Expression::Index(receiver, index) => {
                let receiver = self.value(receiver)?;
                let index = self.value(index)?.value.as_int();
                let mut value = converted(self.value(value)?, ty);
                value.evidence = value.evidence | self.control_proof();
                let (object_id, slot) = self.slot(&receiver, index, &target.node)?;
                let before = slot.clone();
                value.writer = receiver.origin;
                self.write(
                    node,
                    &value,
                    Change::Slot {
                        object_id,
                        index: index as usize,
                        before,
                        after: value.clone(),
                    },
                )?;
                if let Some(key) = receiver.origin
                    && key.declaration & PARAMETER != 0
                    && index == 0
                {
                    let record = self
                        .parameters
                        .entry((key.frame, key.declaration))
                        .or_default();
                    if record.original.is_none() && value.evidence.inputs != 0 {
                        record.original = Some(object_id);
                        record.evidence = value.evidence;
                    } else if record.rebound == Some(object_id)
                        && matches!(value.value, Value::Int { value: 99 })
                    {
                        record.confirmed = true;
                    }
                }
                Ok(())
            }
            Expression::Field(receiver, name) => {
                let receiver = self.value(receiver)?;
                let mut value = converted(self.value(value)?, ty);
                value.evidence = value.evidence | self.control_proof();
                let object_id = self.reference(&receiver, &target.node)?;
                let Object::Instance { fields, .. } = &self.record.state.objects[&object_id] else {
                    unreachable!()
                };
                value.writer = receiver.origin;
                value.evidence = value.evidence.tag(FIELD_WRITTEN);
                self.write(
                    node,
                    &value,
                    Change::Field {
                        object_id,
                        name: name.clone(),
                        before: fields[name].clone(),
                        after: value.clone(),
                    },
                )
            }
            _ => unreachable!("checked assignment target"),
        }
    }

    fn write(&mut self, node: &Node, value: &Datum, change: Change) -> JavaResult<()> {
        let before = self.record.state.counters;
        let mut after = before;
        after.writes += 1;
        self.event(
            node,
            "object-write",
            Some(value),
            vec![change, Change::Counters { before, after }],
        )?;
        Ok(())
    }

    fn reference(&self, value: &Datum, node: &Node) -> JavaResult<u32> {
        match value.value {
            Value::Ref { object_id } => Ok(object_id),
            Value::Null => Err(fault("E_JAVA_NULL", node)),
            _ => unreachable!("checked object reference"),
        }
    }

    fn slot(&self, receiver: &Datum, index: i32, node: &Node) -> JavaResult<(u32, &Datum)> {
        let object_id = self.reference(receiver, node)?;
        let value = self.record.state.objects[&object_id]
            .slots()
            .get(index as usize)
            .ok_or_else(|| fault("E_JAVA_INDEX", node))?;
        Ok((object_id, value))
    }

    fn value(&mut self, expr: &'p Expr) -> JavaResult<Datum> {
        Ok(self.expression(expr)?.expect("checked value expression"))
    }

    fn expression(&mut self, expr: &'p Expr) -> JavaResult<Option<Datum>> {
        use Expression::*;
        self.at(&expr.node, |rt| {
            let node = &expr.node;
            let result = match &expr.item {
                Int(value) => Datum::int(*value),
                Long(value) => Datum::new(Value::Long { value: *value }),
                Bool(value) => Datum::new(Value::Bool { value: *value }),
                String(value) => Datum::new(Value::String {
                    value: value.clone(),
                }),
                Null => Datum::new(Value::Null),
                Name(name) => {
                    let mut value = rt.frame().bindings[name].clone();
                    value.origin = Some(rt.lookup_key(name));
                    value
                }
                Group(expr) => return rt.expression(expr),
                Unary(op, value) => {
                    let value = rt.value(value)?;
                    let next = match (*op, &value.value) {
                        ("+", value) => value.clone(),
                        ("-", Value::Int { value }) => Value::Int {
                            value: value.wrapping_neg(),
                        },
                        ("-", Value::Long { value }) => Value::Long {
                            value: value.wrapping_neg(),
                        },
                        ("!", Value::Bool { value }) => Value::Bool { value: !value },
                        _ => unreachable!("checked unary operator"),
                    };
                    let result = Datum::observed(next, value.evidence);
                    rt.event(node, "unary", Some(&result), vec![])?;
                    result
                }
                Cast(ty, value) => {
                    let result = converted(rt.value(value)?, ty);
                    rt.event(node, "convert", Some(&result), vec![])?;
                    result
                }
                Binary(op, lhs, rhs) => rt.binary(expr, op, lhs, rhs)?,
                Index(value, index) => {
                    let owner = rt.value(value)?;
                    let index = rt.value(index)?.value.as_int();
                    let (object, item) = rt.slot(&owner, index, node)?;
                    let mut result = item.clone();
                    result.origin = None;
                    if item.evidence.inputs != 0 {
                        let flag = match index {
                            0 => SLOT_0,
                            1 => SLOT_1,
                            _ => 0,
                        };
                        result.evidence = result.evidence.tag(flag);
                        result.evidence.storage_object = object;
                    }
                    if index == 0
                        && rt.parameters.iter().any(|((frame, _), record)| {
                            record.confirmed
                                && *frame != rt.frame().id
                                && record.original == Some(object)
                                && record.evidence.inputs == result.evidence.inputs
                        })
                    {
                        result.evidence = result.evidence.tag(REFERENCE_PARAMETER);
                    }
                    rt.event(node, "array-read", Some(&result), vec![])?;
                    result
                }
                Field(owner, name) => {
                    let owner = rt.value(owner)?;
                    let object = rt.reference(&owner, node)?;
                    let result = match &rt.record.state.objects[&object] {
                        Object::Instance { fields, .. } => {
                            let mut result = fields[name].clone();
                            result.origin = None;
                            if result.evidence.flags & FIELD_WRITTEN == 0 {
                                result.evidence = result.evidence.tag(FIELD_DEFAULT);
                                result.evidence.storage_object = object;
                            } else if owner.origin.is_some()
                                && result.writer.is_some()
                                && owner.origin != result.writer
                            {
                                result.evidence = result.evidence.tag(FIELD_ALIAS);
                                result.evidence.storage_object = object;
                            }
                            result
                        }
                        array => Datum::int(array.slots().len() as i32),
                    };
                    rt.event(node, "field-read", Some(&result), vec![])?;
                    result
                }
                Call(name, args) => {
                    let method = &rt.program.methods[name];
                    let values = rt.arguments(node, args)?;
                    return rt.call(method, values, node);
                }
                ReceiverCall(receiver, name, args) => {
                    return rt.receiver(node, receiver, name, args);
                }
                NewArray(ty, length) => {
                    let length = rt.value(length)?.value.as_int();
                    if length < 0 {
                        return Err(fault("E_JAVA_NEGATIVE_ARRAY", node));
                    }
                    let length = length as usize;
                    if length > MAX_ARRAY {
                        return Err(fault("E_MEMORY_LIMIT", node));
                    }
                    charge(rt.meter, length.max(1), node.byte_range, "runtime")?;
                    let object = if *ty == Type::IntArray {
                        Object::IntArray {
                            slots: vec![Datum::int(0); length],
                        }
                    } else {
                        Object::StringArray {
                            slots: vec![Datum::new(Value::Null); length],
                        }
                    };
                    rt.allocate(node, object)?
                }
                NewClass(name) => {
                    let class = &rt.program.classes[name];
                    charge(
                        rt.meter,
                        class.fields.len().max(1),
                        node.byte_range,
                        "runtime",
                    )?;
                    let fields = class
                        .fields
                        .iter()
                        .map(|(name, ty)| (name.clone(), Datum::new(Value::default_for(ty))))
                        .collect();
                    rt.allocate(
                        node,
                        Object::Instance {
                            class_name: name.clone(),
                            fields,
                        },
                    )?
                }
                NewScanner => {
                    if rt.scanner {
                        return Err(fault("E_JAVA_SCANNER_LIMIT", node));
                    }
                    let scanner = rt.allocate(node, Object::Scanner)?;
                    rt.scanner = true;
                    scanner
                }
            };
            rt.temporary(result.size(), node, |_| Ok(Some(result)))
        })
    }

    fn arguments(&mut self, node: &Node, args: &'p [Expr]) -> JavaResult<Vec<Datum>> {
        let mut values = Vec::with_capacity(args.len());
        let mut total = 0;
        for expr in args {
            let value = self.temporary(total, node, |rt| rt.value(expr))?;
            total += value.size();
            values.push(value);
        }
        Ok(values)
    }

    fn receiver(
        &mut self,
        node: &Node,
        receiver: &'p Expr,
        name: &str,
        args: &'p [Expr],
    ) -> JavaResult<Option<Datum>> {
        if !self.typed.contains(receiver) {
            if types::is_system_out(receiver) {
                self.print(node, name, args)?;
                return Ok(None);
            }
            let values = self.arguments(node, args)?;
            return self.call(&self.program.methods[name], values, node);
        }
        let receiver = self.value(receiver)?;
        let args = self.temporary(receiver.size(), node, |rt| rt.arguments(node, args))?;
        match (&receiver.value, name) {
            (Value::Null, _) => Err(fault("E_JAVA_NULL", node)),
            (Value::String { value }, "length") => {
                charge(self.meter, value.len().max(1), node.byte_range, "runtime")?;
                let result = Datum::observed(
                    Value::Int {
                        value: value.encode_utf16().count() as i32,
                    },
                    receiver.evidence.tag(LENGTH),
                );
                self.event(node, "string-length", Some(&result), vec![])?;
                Ok(Some(result))
            }
            (Value::String { value }, "equals") => {
                charge(self.meter, value.len().max(1), node.byte_range, "runtime")?;
                let equal =
                    matches!(&args[0].value, Value::String { value: other } if value == other);
                let result = Datum::observed(
                    Value::Bool { value: equal },
                    receiver.evidence | args[0].evidence,
                );
                self.compare(node, &result)?;
                Ok(Some(result))
            }
            (Value::Ref { .. }, _) => self.read(node, name).map(Some),
            _ => unreachable!("checked receiver method"),
        }
    }

    fn print(&mut self, node: &Node, name: &str, args: &'p [Expr]) -> JavaResult<()> {
        let value = args.first().map(|expr| self.value(expr)).transpose()?;
        let mut append = value
            .as_ref()
            .map_or_else(String::new, |v| v.value.display());
        if name == "println" {
            append.push('\n');
        }
        charge(self.meter, append.len().max(1), node.byte_range, "runtime")?;
        let before_bytes = self.record.state.output.len();
        let after_bytes = before_bytes + append.len();
        let seq = self.event(
            node,
            "print",
            value.as_ref(),
            vec![Change::Output {
                before_bytes,
                after_bytes,
                append,
            }],
        )?;
        if let Some(value) = value
            && self.printed.len() < 17
        {
            self.printed.push(Print {
                seq,
                node_id: node.node_id,
                evidence: value.evidence | self.control_proof(),
                value: value.value,
            });
        }
        Ok(())
    }

    fn read(&mut self, node: &Node, name: &str) -> JavaResult<Datum> {
        let cursor = self.record.state.control.input_cursor;
        let tail = &self.input[cursor..];
        let (value, end) = if name == "nextLine" {
            if tail.is_empty() {
                return Err(fault("E_JAVA_EOF", node));
            }
            let length = tail.find(['\r', '\n']).unwrap_or(tail.len());
            let newline = &tail[length..];
            let skip = if newline.starts_with("\r\n") {
                2
            } else {
                usize::from(!newline.is_empty())
            };
            (
                Value::String {
                    value: tail[..length].to_owned(),
                },
                cursor + length + skip,
            )
        } else {
            fn space(c: char) -> bool {
                c.is_ascii_whitespace() || c == '\u{000b}'
            }
            let token_start = tail
                .find(|c| !space(c))
                .ok_or_else(|| fault("E_JAVA_EOF", node))?;
            let rest = &tail[token_start..];
            let length = rest.find(space).unwrap_or(rest.len());
            let token = &rest[..length];
            let value = if name == "nextInt" {
                Value::Int {
                    value: token.parse().map_err(|_| fault("E_JAVA_INPUT", node))?,
                }
            } else {
                Value::Long {
                    value: token.parse().map_err(|_| fault("E_JAVA_INPUT", node))?,
                }
            };
            (value, cursor + token_start + length)
        };
        charge(
            self.meter,
            (end - cursor).max(1),
            node.byte_range,
            "runtime",
        )?;
        let proof = Evidence {
            flags: 0,
            inputs: 1u64.checked_shl(self.reads).unwrap_or(0),
            ..Evidence::default()
        };
        let result = Datum::observed(value, proof);
        self.record_event(node, "input-read", Some(&result), vec![], end)?;
        self.reads += 1;
        Ok(result)
    }

    fn binary(
        &mut self,
        expr: &'p Expr,
        op: &str,
        lhs: &'p Expr,
        rhs: &'p Expr,
    ) -> JavaResult<Datum> {
        let node = &expr.node;
        let left = self.value(lhs)?;
        if matches!(op, "&&" | "||") {
            let decision = left.value.as_bool();
            let short = op == "&&" && !decision || op == "||" && decision;
            if short {
                let result = Datum::observed(
                    Value::Bool { value: decision },
                    left.evidence.tag(if op == "&&" { AND_SHORT } else { 0 }),
                );
                self.event(node, "short-circuit", Some(&result), vec![])?;
                return Ok(result);
            }
            let right = self.value(rhs)?;
            let result = Datum::observed(
                right.value,
                (left.evidence | right.evidence).tag(if op == "&&" { AND_RIGHT } else { 0 }),
            );
            self.event(node, "boolean-right", Some(&result), vec![])?;
            return Ok(result);
        }
        let right = self.temporary(left.size(), node, |rt| rt.value(rhs))?;
        let mut evidence = left.evidence | right.evidence;
        let ty = self.typed.of(expr);
        if *ty == Type::String {
            let mut text = left.value.display();
            text.push_str(&right.value.display());
            if text.len() > MAX_STRING_BYTES {
                return Err(fault("E_MEMORY_LIMIT", node));
            }
            charge(self.meter, text.len().max(1), node.byte_range, "runtime")?;
            let result = Datum::observed(Value::String { value: text }, evidence);
            self.event(node, "string-concat", Some(&result), vec![])?;
            return Ok(result);
        }
        if *ty == Type::Bool {
            let numeric = matches!(left.value, Value::Int { .. } | Value::Long { .. });
            let value = if numeric {
                let (a, b) = (left.value.as_number(), right.value.as_number());
                match op {
                    "==" => a == b,
                    "!=" => a != b,
                    "<" => a < b,
                    "<=" => a <= b,
                    ">" => a > b,
                    ">=" => a >= b,
                    _ => unreachable!("checked comparison"),
                }
            } else {
                (left.value == right.value) == (op == "==")
            };
            let result = Datum::observed(Value::Bool { value }, evidence);
            self.compare(node, &result)?;
            return Ok(result);
        }
        let a = left.value.as_number();
        let b = right.value.as_number();
        if matches!(op, "/" | "%") && b == 0 {
            return Err(fault("E_JAVA_ZERO_DIVISION", node));
        }
        if op == "*" && (a == 0 || b == 0) {
            if a == 0 && left.evidence.inputs == 0 {
                evidence = left.evidence;
            }
            if b == 0 && right.evidence.inputs == 0 {
                evidence = right.evidence;
            }
        }
        let (kind, flag) = match op {
            "+" => ("add", ADD | if *ty == Type::Long { WIDE_ADD } else { 0 }),
            "-" => ("subtract", SUB),
            "*" => ("multiply", MULTIPLY),
            "/" => ("divide", DIV),
            "%" => ("remainder", REM),
            _ => unreachable!("checked arithmetic"),
        };
        let value = match ty {
            Type::Long => Value::Long {
                value: arithmetic!(a, b, op),
            },
            Type::Int => Value::Int {
                value: arithmetic!(a as i32, b as i32, op),
            },
            _ => unreachable!("checked result type"),
        };
        let result = Datum::observed(value, evidence.tag(flag));
        self.event(node, kind, Some(&result), vec![])?;
        Ok(result)
    }

    fn compare(&mut self, node: &Node, result: &Datum) -> JavaResult<()> {
        let before = self.record.state.counters;
        let mut after = before;
        after.comparisons += 1;
        self.event(
            node,
            "compare",
            Some(result),
            vec![Change::Counters { before, after }],
        )?;
        Ok(())
    }
}
