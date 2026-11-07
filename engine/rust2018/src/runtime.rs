use crate::{
    Fault, Meter, charge, flow,
    model::*,
    source::ByteRange,
    syntax::*,
    trace::{Trace, TracePoint, Usage},
};
use std::collections::BTreeMap;

pub(crate) const OUTPUT: u32 = 1;
pub(crate) const SHADOW: u32 = 1 << 1;
pub(crate) const ARITHMETIC: u32 = 1 << 2;
pub(crate) const CALL: u32 = 1 << 3;
pub(crate) const CONDITION: u32 = 1 << 4;
pub(crate) const LOOP: u32 = 1 << 5;
pub(crate) const STRING_CREATE: u32 = 1 << 6;
pub(crate) const CLONE: u32 = 1 << 7;
pub(crate) const MOVE: u32 = 1 << 8;
pub(crate) const OWNERSHIP_CALL: u32 = 1 << 9;
pub(crate) const MUTABLE_BORROW: u32 = 1 << 10;
pub(crate) const ARRAY_COPY: u32 = 1 << 11;
pub(crate) const ARRAY_WRITE: u32 = 1 << 12;
pub(crate) const RECURSION: u32 = 1 << 13;
const INPUT: u32 = 1 << 14;

pub(crate) fn feature(name: &str) -> u32 {
    match name {
        "output" => OUTPUT,
        "shadow" => SHADOW,
        "arithmetic" => ARITHMETIC,
        "call" => CALL,
        "condition" => CONDITION,
        "loop" => LOOP,
        "string-create" => STRING_CREATE,
        "clone" => CLONE,
        "move" => MOVE,
        "ownership-call" => OWNERSHIP_CALL,
        "user-mutable-borrow" => MUTABLE_BORROW,
        "array-copy" => ARRAY_COPY,
        "array-write" => ARRAY_WRITE,
        "recursion" => RECURSION,
        _ => 0,
    }
}

#[derive(Clone, Debug)]
struct Datum {
    value: Value,
    flags: u32,
    temp: Option<u32>,
}

enum ObjectContent {
    String(String),
    Array(Vec<i32>),
}

enum JoinWrite {
    Binding(u32),
    Element(u32, usize),
}
impl Datum {
    fn unit() -> Self {
        Self {
            value: Value::Unit,
            flags: 0,
            temp: None,
        }
    }
    fn int(value: i32) -> Self {
        Self {
            value: Value::I32 { value },
            flags: 0,
            temp: None,
        }
    }
    fn boolean(value: bool) -> Self {
        Self {
            value: Value::Bool { value },
            flags: 0,
            temp: None,
        }
    }
}

#[derive(Debug)]
enum Signal {
    Fault(Fault),
    Return(Datum),
    Break,
    Continue,
}
impl From<Fault> for Signal {
    fn from(value: Fault) -> Self {
        Self::Fault(value)
    }
}
type Eval<T> = Result<T, Signal>;

pub(crate) struct Run {
    pub state: State,
    pub trace: Trace,
    pub fault: Option<Fault>,
    pub features: u32,
}

struct Runtime<'a, 'b> {
    program: &'a Program,
    input: &'a str,
    meter: &'b mut Meter,
    usage: &'b mut Usage,
    state: State,
    trace: Trace,
    flags: BTreeMap<u32, u32>,
    object_flags: BTreeMap<u32, u32>,
    slots: BTreeMap<(u32, usize), u32>,
    temp_flags: BTreeMap<u32, u32>,
    context: u32,
    features: u32,
    functions: Vec<String>,
    depth: usize,
    conditional_effects: BTreeMap<u32, flow::Effects>,
}

pub(crate) fn run(program: &Program, input: &str, meter: &mut Meter, usage: &mut Usage) -> Run {
    let mut vm = Runtime {
        program,
        input,
        meter,
        usage,
        state: State::default(),
        trace: Trace::new(),
        flags: BTreeMap::new(),
        object_flags: BTreeMap::new(),
        slots: BTreeMap::new(),
        temp_flags: BTreeMap::new(),
        context: 0,
        features: 0,
        functions: Vec::new(),
        depth: 0,
        conditional_effects: BTreeMap::new(),
    };
    let result = vm.call("main", Vec::new(), None);
    let fault = match result {
        Ok(value) => {
            let _ = vm.discard(
                value,
                program.functions["main"].id,
                program.functions["main"].range,
            );
            None
        }
        Err(Signal::Fault(fault)) => Some(fault),
        Err(_) => Some(Fault::new("E_RETURN", program.functions["main"].range)),
    };
    if fault.is_none() {
        vm.trace.completeness = "complete";
    }
    vm.usage.output_bytes += vm.state.output.len();
    Run {
        state: vm.state,
        trace: vm.trace,
        fault,
        features: vm.features,
    }
}

impl Runtime<'_, '_> {
    fn fault(&self, code: &'static str, range: ByteRange) -> Signal {
        Signal::Fault(Fault::new(code, range))
    }
    fn commit(
        &mut self,
        before: State,
        node: u32,
        event: &'static str,
        range: ByteRange,
    ) -> Eval<()> {
        self.state.control.node_id = Some(node);
        self.state.recount();
        if let Err(error) = self.trace.commit(
            &before,
            &self.state,
            TracePoint { node, event, range },
            self.meter,
            self.usage,
        ) {
            self.state = before;
            return Err(error.into());
        }
        Ok(())
    }
    fn mark(&mut self, node: u32, event: &'static str, range: ByteRange) -> Eval<()> {
        let old = self.state.clone();
        self.commit(old, node, event, range)
    }
    fn frame(&self) -> u32 {
        self.state.frames.last().map_or(0, |f| f.id)
    }
    fn scope(&self) -> u32 {
        self.state
            .frames
            .last()
            .and_then(|f| f.scope_ids.last())
            .copied()
            .unwrap_or(0)
    }
    fn binding_index(&self, name: &str, range: ByteRange) -> Eval<usize> {
        self.state
            .bindings
            .iter()
            .rposition(|b| b.frame_id == self.frame() && b.name == name)
            .ok_or_else(|| self.fault("E_NAME", range))
    }
    fn binding_id_index(&self, id: u32, range: ByteRange) -> Eval<usize> {
        self.state
            .bindings
            .iter()
            .position(|b| b.id == id)
            .ok_or_else(|| self.fault("E_BORROW_CONFLICT", range))
    }
    fn object_index(&self, id: u32, range: ByteRange) -> Eval<usize> {
        self.state
            .objects
            .iter()
            .position(|o| o.id == id && o.alive)
            .ok_or_else(|| self.fault("E_MOVED", range))
    }
    fn dereference(&self, index: usize, range: ByteRange) -> Eval<usize> {
        match self.state.bindings[index].value {
            Value::Reference { loan_id } => {
                let loan = self
                    .state
                    .loans
                    .iter()
                    .find(|l| l.id == loan_id)
                    .ok_or_else(|| self.fault("E_BORROW_CONFLICT", range))?;
                self.binding_id_index(loan.target_binding_id, range)
            }
            _ => Ok(index),
        }
    }
    fn datum(&self, index: usize, range: ByteRange) -> Eval<Datum> {
        let b = &self.state.bindings[index];
        if b.status != "live" {
            return Err(self.fault("E_MOVED", range));
        }
        let mut flags = *self.flags.get(&b.id).unwrap_or(&0);
        if let Some(id) = b.value.object_id() {
            flags |= *self.object_flags.get(&id).unwrap_or(&0);
        }
        Ok(Datum {
            value: b.value.clone(),
            flags,
            temp: None,
        })
    }
    fn make_temp(&mut self, value: Value, ty: String, flags: u32) -> Datum {
        let id = self.state.allocator.next_temporary;
        self.state.allocator.next_temporary += 1;
        self.state.temporaries.push(Temporary {
            id,
            r#type: ty,
            value: value.clone(),
        });
        self.temp_flags.insert(id, flags);
        Datum {
            value,
            flags,
            temp: Some(id),
        }
    }
    fn consume_temp(&mut self, datum: &Datum) {
        if let Some(id) = datum.temp {
            self.state.temporaries.retain(|t| t.id != id);
            self.temp_flags.remove(&id);
        }
    }
    fn new_object(
        &mut self,
        content: ObjectContent,
        flags: u32,
        node: u32,
        range: ByteRange,
        event: &'static str,
    ) -> Eval<Datum> {
        if self.usage.objects >= 4096 {
            return Err(self.fault("E_OBJECT_LIMIT", range));
        }
        if matches!(&content, ObjectContent::String(text) if text.len() > 4096) {
            return Err(self.fault("E_MEMORY_LIMIT", range));
        }
        let (kind, text, items) = match content {
            ObjectContent::String(text) => ("string", Some(text), None),
            ObjectContent::Array(items) => ("array", None, Some(items)),
        };
        let before = self.state.clone();
        let id = self.state.allocator.next_object;
        self.state.allocator.next_object += 1;
        let ty = if kind == "string" {
            "String".to_owned()
        } else {
            format!("[i32;{}]", items.as_ref().map_or(0, Vec::len))
        };
        self.state.objects.push(Object {
            id,
            kind,
            text,
            items,
            alive: true,
        });
        self.object_flags.insert(id, flags);
        let value = if kind == "string" {
            Value::StringObject { object_id: id }
        } else {
            Value::ArrayObject { object_id: id }
        };
        let result = self.make_temp(value, ty, flags);
        self.commit(before, node, event, range)?;
        self.usage.objects += 1;
        Ok(result)
    }
    fn copy_array(&mut self, datum: Datum, node: u32, range: ByteRange) -> Eval<Datum> {
        let Value::ArrayObject { object_id } = datum.value else {
            return Ok(datum);
        };
        let object = self.object_index(object_id, range)?;
        let items = self.state.objects[object]
            .items
            .clone()
            .ok_or_else(|| self.fault("E_TYPE", range))?;
        let result = self.new_object(
            ObjectContent::Array(items),
            datum.flags | ARRAY_COPY,
            node,
            range,
            "declare",
        )?;
        if let Value::ArrayObject { object_id: new_id } = result.value {
            let old_slots = self
                .slots
                .iter()
                .filter(|((id, _), _)| *id == object_id)
                .map(|((_, index), flags)| (*index, *flags))
                .collect::<Vec<_>>();
            for (index, flags) in old_slots {
                self.slots.insert((new_id, index), flags);
            }
        }
        Ok(result)
    }
    fn read_name(&mut self, name: &str, node: u32, range: ByteRange, consume: bool) -> Eval<Datum> {
        let index = self.binding_index(name, range)?;
        let datum = self.datum(index, range)?;
        if !consume {
            return Ok(datum);
        }
        match datum.value {
            Value::StringObject { .. } => {
                let before = self.state.clone();
                self.state.bindings[index].status = "moved";
                let out = self.make_temp(datum.value, "String".to_owned(), datum.flags | MOVE);
                self.commit(before, node, "move", range)?;
                Ok(out)
            }
            Value::ArrayObject { .. } => self.copy_array(datum, node, range),
            _ => Ok(datum),
        }
    }
    fn declare(
        &mut self,
        node: u32,
        name: &str,
        mutable: bool,
        ty: Option<&Type>,
        datum: Datum,
        range: ByteRange,
    ) -> Eval<()> {
        if self
            .state
            .bindings
            .iter()
            .filter(|b| b.frame_id == self.frame())
            .count()
            >= 128
        {
            return Err(self.fault("E_MEMORY_LIMIT", range));
        }
        let shadow = self.binding_index(name, range).is_ok();
        let before = self.state.clone();
        let id = self.state.allocator.next_binding;
        self.state.allocator.next_binding += 1;
        let inferred = ty.map_or_else(|| self.value_type(&datum.value), Type::wire);
        self.consume_temp(&datum);
        self.state.bindings.push(Binding {
            id,
            declaration_node: node,
            frame_id: self.frame(),
            scope_id: self.scope(),
            name: name.to_owned(),
            r#type: inferred,
            mutable,
            status: "live",
            value: datum.value,
        });
        self.flags.insert(
            id,
            datum.flags | self.context | if shadow { SHADOW } else { 0 },
        );
        self.commit(before, node, "declare", range)
    }
    fn value_type(&self, value: &Value) -> String {
        match value {
            Value::Unit => "unit".to_owned(),
            Value::I32 { .. } => "i32".to_owned(),
            Value::Bool { .. } => "bool".to_owned(),
            Value::StringObject { .. } => "String".to_owned(),
            Value::ArrayObject { object_id } => format!(
                "[i32;{}]",
                self.state
                    .objects
                    .iter()
                    .find(|o| o.id == *object_id)
                    .and_then(|o| o.items.as_ref())
                    .map_or(0, Vec::len)
            ),
            Value::Reference { loan_id } => self
                .state
                .loans
                .iter()
                .find(|l| l.id == *loan_id)
                .and_then(|l| {
                    self.state
                        .bindings
                        .iter()
                        .find(|b| b.id == l.target_binding_id)
                        .map(|b| format!("&{}{}", if l.mutable { "mut " } else { "" }, b.r#type))
                })
                .unwrap_or_default(),
        }
    }
    fn discard(&mut self, datum: Datum, node: u32, range: ByteRange) -> Eval<()> {
        if datum.temp.is_none() {
            return Ok(());
        }
        let before = self.state.clone();
        self.consume_temp(&datum);
        if let Some(id) = datum.value.object_id() {
            let index = self.object_index(id, range)?;
            self.state.objects[index].alive = false;
        }
        self.commit(before, node, "drop", range)
    }
    fn block(&mut self, block: &Block) -> Eval<Datum> {
        let before = self.state.clone();
        let id = self.state.allocator.next_scope;
        self.state.allocator.next_scope += 1;
        self.state
            .frames
            .last_mut()
            .ok_or_else(|| Signal::Fault(Fault::new("E_ENTRY", block.range)))?
            .scope_ids
            .push(id);
        self.commit(before, block.id, "scope-enter", block.range)?;
        let mut result = Ok(Datum::unit());
        for statement in &block.statements {
            if let Err(signal) = self.statement(statement) {
                result = Err(signal);
                break;
            }
        }
        if result.is_ok()
            && let Some(tail) = &block.tail
        {
            result = self.eval(tail, true);
        }
        if !matches!(result, Err(Signal::Fault(_))) {
            self.exit_scope(block.id, block.range)?;
        }
        result
    }
    fn exit_scope(&mut self, node: u32, range: ByteRange) -> Eval<()> {
        let before = self.state.clone();
        let scope = self.scope();
        let ids = self
            .state
            .bindings
            .iter()
            .filter(|b| b.scope_id == scope)
            .map(|b| b.id)
            .collect::<Vec<_>>();
        for id in &ids {
            if let Some(binding) = self.state.bindings.iter().find(|b| b.id == *id)
                && binding.status == "live"
                && let Some(object) = binding.value.object_id()
                && let Some(item) = self.state.objects.iter_mut().find(|o| o.id == object)
            {
                item.alive = false;
            }
            self.flags.remove(id);
        }
        self.state
            .loans
            .retain(|loan| !ids.contains(&loan.parameter_binding_id));
        self.state.bindings.retain(|b| b.scope_id != scope);
        if let Some(frame) = self.state.frames.last_mut() {
            frame.scope_ids.pop();
        }
        self.commit(before, node, "scope-exit", range)
    }
    fn call(
        &mut self,
        name: &str,
        args: Vec<(Datum, Option<(u32, bool)>)>,
        call: Option<(u32, ByteRange)>,
    ) -> Eval<Datum> {
        let function = self
            .program
            .functions
            .get(name)
            .ok_or_else(|| self.fault("E_NAME", call.map_or(crate::span(0, 0), |x| x.1)))?;
        let node = call.map_or(function.id, |x| x.0);
        let range = call.map_or(function.range, |x| x.1);
        if self.state.frames.len() >= 32 {
            return Err(self.fault("E_STACK_LIMIT", range));
        }
        let previous_context = self.context;
        let recursive = self.functions.iter().any(|f| f == name);
        let owned = args
            .iter()
            .any(|(d, _)| matches!(d.value, Value::StringObject { .. }));
        if name != "main" {
            self.context |= CALL;
            if recursive {
                self.context |= RECURSION;
            }
            if owned {
                self.context |= OWNERSHIP_CALL;
            }
        }
        let before = self.state.clone();
        let frame = self.state.allocator.next_frame;
        self.state.allocator.next_frame += 1;
        let scope = self.state.allocator.next_scope;
        self.state.allocator.next_scope += 1;
        self.state.frames.push(Frame {
            id: frame,
            function_node: function.id,
            call_node: call.map(|x| x.0),
            scope_ids: vec![scope],
        });
        for (parameter, (datum, borrow)) in function.params.iter().zip(args) {
            let id = self.state.allocator.next_binding;
            self.state.allocator.next_binding += 1;
            self.consume_temp(&datum);
            let value = if let Some((target, mutable)) = borrow {
                let loan = self.state.allocator.next_loan;
                self.state.allocator.next_loan += 1;
                self.state.loans.push(Loan {
                    id: loan,
                    target_binding_id: target,
                    mutable,
                    parameter_binding_id: id,
                });
                Value::Reference { loan_id: loan }
            } else {
                datum.value
            };
            self.flags.insert(id, datum.flags | self.context);
            self.state.bindings.push(Binding {
                id,
                declaration_node: parameter.id,
                frame_id: frame,
                scope_id: scope,
                name: parameter.name.clone(),
                r#type: parameter.ty.wire(),
                mutable: parameter.mutable,
                status: "live",
                value,
            });
        }
        self.commit(before, node, "call", range)?;
        self.functions.push(name.to_owned());
        let result = self.block(&function.body);
        let mut value = match result {
            Ok(value) | Err(Signal::Return(value)) => value,
            Err(signal) => return Err(signal),
        };
        value.flags |= self.context;
        if value.temp.is_some()
            && let Some(object) = value.value.object_id()
        {
            *self.object_flags.entry(object).or_default() |= value.flags;
        }
        let before = self.state.clone();
        self.state.control.return_value = Some(value.value.clone());
        self.commit(before, node, "return", range)?;
        self.exit_scope(node, range)?;
        let before = self.state.clone();
        self.state.frames.pop();
        self.state.control.return_value = None;
        self.commit(before, node, "return", range)?;
        self.functions.pop();
        self.context = previous_context;
        Ok(value)
    }
    fn eval(&mut self, expr: &Expr, consume: bool) -> Eval<Datum> {
        self.depth += 1;
        if self.depth > 256 {
            self.depth -= 1;
            return Err(self.fault("E_DEPTH_LIMIT", expr.range));
        }
        charge(self.meter, 1, expr.range)?;
        let result = self.expression(expr, consume);
        self.depth -= 1;
        result
    }
    fn expression(&mut self, expr: &Expr, consume: bool) -> Eval<Datum> {
        let node = expr.id;
        let range = expr.range;
        match &expr.kind {
            ExprKind::Int(value) => Ok(Datum::int(*value)),
            ExprKind::Bool(value) => Ok(Datum::boolean(*value)),
            ExprKind::Name(name) => self.read_name(name, node, range, consume),
            ExprKind::StringNew => self.new_object(
                ObjectContent::String(String::new()),
                0,
                node,
                range,
                "string-create",
            ),
            ExprKind::StringFrom(text) => self.new_object(
                ObjectContent::String(text.clone()),
                STRING_CREATE,
                node,
                range,
                "string-create",
            ),
            ExprKind::Text(_) => Err(self.fault("E_UNSUPPORTED", range)),
            ExprKind::Array(values) => {
                let mut items = Vec::new();
                let mut item_flags = Vec::new();
                for item in values {
                    let d = self.eval(item, true)?;
                    let Value::I32 { value } = d.value else {
                        return Err(self.fault("E_TYPE", range));
                    };
                    items.push(value);
                    item_flags.push(d.flags);
                }
                let value =
                    self.new_object(ObjectContent::Array(items), 0, node, range, "declare")?;
                if let Some(id) = value.value.object_id() {
                    for (index, flags) in item_flags.into_iter().enumerate() {
                        self.slots.insert((id, index), flags);
                    }
                }
                Ok(value)
            }
            ExprKind::Repeat(value, count) => {
                let datum = self.eval(value, true)?;
                let Value::I32 { value } = datum.value else {
                    return Err(self.fault("E_TYPE", range));
                };
                {
                    let result = self.new_object(
                        ObjectContent::Array(vec![value; *count]),
                        0,
                        node,
                        range,
                        "declare",
                    )?;
                    if let Some(id) = result.value.object_id() {
                        for index in 0..*count {
                            self.slots.insert((id, index), datum.flags);
                        }
                    }
                    Ok(result)
                }
            }
            ExprKind::Index(array, index) => {
                let value = self.eval(array, false)?;
                let Value::ArrayObject { object_id } = value.value else {
                    return Err(self.fault("E_TYPE", range));
                };
                let object = self.object_index(object_id, range)?;
                let result = self.state.objects[object]
                    .items
                    .as_ref()
                    .and_then(|items| items.get(*index))
                    .copied()
                    .ok_or_else(|| self.fault("E_ARRAY_BOUNDS", range))?;
                let flags =
                    value.flags | self.slots.get(&(object_id, *index)).copied().unwrap_or(0);
                if value.temp.is_some() {
                    self.discard(value, node, range)?;
                }
                Ok(Datum {
                    value: Value::I32 { value: result },
                    flags,
                    temp: None,
                })
            }
            ExprKind::Unary(operator, value) => {
                if operator == "*" {
                    let ExprKind::Name(name) = &value.kind else {
                        return Err(self.fault("E_UNSUPPORTED", range));
                    };
                    let i = self.binding_index(name, range)?;
                    let target = self.dereference(i, range)?;
                    return self.datum(target, range);
                }
                let datum = self.eval(value, true)?;
                let flags = datum.flags;
                let result = match (operator.as_str(), datum.value) {
                    ("-", Value::I32 { value }) => Value::I32 {
                        value: value
                            .checked_neg()
                            .ok_or_else(|| self.fault("E_OVERFLOW", range))?,
                    },
                    ("!", Value::Bool { value }) => Value::Bool { value: !value },
                    _ => return Err(self.fault("E_TYPE", range)),
                };
                self.mark(node, "arithmetic", range)?;
                Ok(Datum {
                    value: result,
                    flags: flags | if operator == "-" { ARITHMETIC } else { 0 } | self.context,
                    temp: None,
                })
            }
            ExprKind::Binary(operator, left, right) => {
                let left = self.eval(left, true)?;
                if operator == "&&" || operator == "||" {
                    let Value::Bool { value } = left.value else {
                        return Err(self.fault("E_TYPE", range));
                    };
                    if (operator == "&&" && !value) || (operator == "||" && value) {
                        return Ok(Datum {
                            value: Value::Bool { value },
                            flags: left.flags,
                            temp: None,
                        });
                    }
                    let right = self.eval(right, true)?;
                    return Ok(Datum {
                        value: right.value,
                        flags: left.flags | right.flags,
                        temp: None,
                    });
                }
                let right = self.eval(right, true)?;
                let result = match (&left.value, &right.value) {
                    (Value::I32 { value: a }, Value::I32 { value: b }) => match operator.as_str() {
                        "+" => Value::I32 {
                            value: a
                                .checked_add(*b)
                                .ok_or_else(|| self.fault("E_OVERFLOW", range))?,
                        },
                        "-" => Value::I32 {
                            value: a
                                .checked_sub(*b)
                                .ok_or_else(|| self.fault("E_OVERFLOW", range))?,
                        },
                        "*" => Value::I32 {
                            value: a
                                .checked_mul(*b)
                                .ok_or_else(|| self.fault("E_OVERFLOW", range))?,
                        },
                        "/" | "%" => {
                            if *b == 0 {
                                return Err(self.fault("E_DIV_ZERO", range));
                            }
                            let value = if operator == "/" {
                                a.checked_div(*b)
                            } else {
                                a.checked_rem(*b)
                            }
                            .ok_or_else(|| self.fault("E_OVERFLOW", range))?;
                            Value::I32 { value }
                        }
                        "<" => Value::Bool { value: a < b },
                        "<=" => Value::Bool { value: a <= b },
                        ">" => Value::Bool { value: a > b },
                        ">=" => Value::Bool { value: a >= b },
                        "==" => Value::Bool { value: a == b },
                        "!=" => Value::Bool { value: a != b },
                        _ => return Err(self.fault("E_TYPE", range)),
                    },
                    (Value::Bool { value: a }, Value::Bool { value: b }) => match operator.as_str()
                    {
                        "==" => Value::Bool { value: a == b },
                        "!=" => Value::Bool { value: a != b },
                        _ => return Err(self.fault("E_TYPE", range)),
                    },
                    _ => return Err(self.fault("E_TYPE", range)),
                };
                self.mark(node, "arithmetic", range)?;
                Ok(Datum {
                    value: result,
                    flags: left.flags
                        | right.flags
                        | if matches!(operator.as_str(), "+" | "-" | "*" | "/" | "%") {
                            ARITHMETIC
                        } else {
                            0
                        }
                        | self.context,
                    temp: None,
                })
            }
            ExprKind::If(test, yes, no) => {
                let datum = self.eval(test, true)?;
                let Value::Bool { value } = datum.value else {
                    return Err(self.fault("E_TYPE", range));
                };
                self.mark(node, "condition", range)?;
                if !self.conditional_effects.contains_key(&node) {
                    let effects = flow::conditional(self.program, yes, no.as_deref());
                    charge(self.meter, effects.visited, range)?;
                    self.conditional_effects.insert(node, effects);
                }
                let effects = &self.conditional_effects[&node];
                let writes = self.join_writes(&effects.writes, range);
                let may_return = effects.may_return;
                let predicate = datum.flags
                    | if datum.flags & INPUT != 0 {
                        CONDITION
                    } else {
                        0
                    };
                let previous = self.context;
                self.context |= predicate;
                let result = if value {
                    self.block(yes)
                } else if let Some(no) = no {
                    self.eval(no, consume)
                } else {
                    Ok(Datum::unit())
                };
                self.context = previous | if may_return { predicate } else { 0 };
                self.apply_join_writes(writes, predicate);
                let mut result = result?;
                result.flags |= predicate;
                Ok(result)
            }
            ExprKind::Block(block) => self.block(block),
            ExprKind::Call(name, args) => {
                let mut values = Vec::new();
                for arg in args {
                    if let ExprKind::Borrow(mutable, name) = &arg.kind {
                        let index = self.binding_index(name, arg.range)?;
                        let datum = self.datum(index, arg.range)?;
                        values.push((datum, Some((self.state.bindings[index].id, *mutable))));
                    } else {
                        values.push((self.eval(arg, true)?, None));
                    }
                }
                self.call(name, values, Some((node, range)))
            }
            ExprKind::Method(receiver, method, args) => {
                self.method(receiver, method, args, node, range)
            }
            ExprKind::Parse(name) => {
                let i = self.binding_index(name, range)?;
                let d = self.datum(i, range)?;
                let Value::StringObject { object_id } = d.value else {
                    return Err(self.fault("E_TYPE", range));
                };
                let index = self.object_index(object_id, range)?;
                let text = self.state.objects[index]
                    .text
                    .as_ref()
                    .ok_or_else(|| self.fault("E_TYPE", range))?;
                let value = text
                    .trim()
                    .parse::<i32>()
                    .map_err(|_| self.fault("E_PARSE_INT", range))?;
                self.mark(node, "arithmetic", range)?;
                Ok(Datum {
                    value: Value::I32 { value },
                    flags: d.flags & INPUT,
                    temp: None,
                })
            }
            ExprKind::Borrow(_, _) => Err(self.fault("E_UNSUPPORTED", range)),
        }
    }
    fn join_writes(
        &self,
        writes: &std::collections::BTreeSet<flow::Write>,
        range: ByteRange,
    ) -> Vec<JoinWrite> {
        writes
            .iter()
            .filter_map(|write| {
                let index = self.binding_index(&write.name, range).ok()?;
                match write.access {
                    flow::Access::Binding => {
                        Some(JoinWrite::Binding(self.state.bindings[index].id))
                    }
                    flow::Access::Referent => self
                        .dereference(index, range)
                        .ok()
                        .map(|target| JoinWrite::Binding(self.state.bindings[target].id)),
                    flow::Access::Element(slot) => self.state.bindings[index]
                        .value
                        .object_id()
                        .map(|object| JoinWrite::Element(object, slot)),
                }
            })
            .collect()
    }

    fn apply_join_writes(&mut self, writes: Vec<JoinWrite>, predicate: u32) {
        for write in writes {
            match write {
                JoinWrite::Binding(id) => *self.flags.entry(id).or_default() |= predicate,
                JoinWrite::Element(object, index) => {
                    *self.slots.entry((object, index)).or_default() |= predicate
                }
            }
        }
    }

    fn method(
        &mut self,
        receiver: &Expr,
        method: &str,
        args: &[Expr],
        node: u32,
        range: ByteRange,
    ) -> Eval<Datum> {
        let ExprKind::Name(name) = &receiver.kind else {
            return Err(self.fault("E_UNSUPPORTED", range));
        };
        let index = self.binding_index(name, range)?;
        let target = self.dereference(index, range)?;
        let datum = self.datum(target, range)?;
        let Value::StringObject { object_id } = datum.value else {
            return Err(self.fault("E_TYPE", range));
        };
        let object = self.object_index(object_id, range)?;
        if method == "clone" {
            return self.new_object(
                ObjectContent::String(self.state.objects[object].text.clone().unwrap_or_default()),
                datum.flags | CLONE,
                node,
                range,
                "clone",
            );
        }
        let before = self.state.clone();
        if method == "clear" {
            self.state.objects[object].text = Some(String::new());
            *self
                .flags
                .entry(self.state.bindings[target].id)
                .or_default() &= !INPUT;
            *self.object_flags.entry(object_id).or_default() &= !INPUT;
        } else if method == "push_str" {
            let Some(Expr {
                kind: ExprKind::Text(text),
                ..
            }) = args.first()
            else {
                return Err(self.fault("E_TYPE", range));
            };
            let mut content = self.state.objects[object].text.clone().unwrap_or_default();
            content.push_str(text);
            if content.len() > 4096 {
                return Err(self.fault("E_MEMORY_LIMIT", range));
            }
            self.state.objects[object].text = Some(content);
        } else {
            return Err(self.fault("E_UNSUPPORTED", range));
        }
        *self
            .flags
            .entry(self.state.bindings[target].id)
            .or_default() |= self.context;
        self.commit(before, node, "assign", range)?;
        Ok(Datum::unit())
    }
    fn assignment(&mut self, target: &Expr, value: Datum, node: u32, range: ByteRange) -> Eval<()> {
        let (name, index, deref) = match &target.kind {
            ExprKind::Name(name) => (name, None, false),
            ExprKind::Unary(op, value) if op == "*" => {
                let ExprKind::Name(name) = &value.kind else {
                    return Err(self.fault("E_TYPE", range));
                };
                (name, None, true)
            }
            ExprKind::Index(array, index) => {
                let ExprKind::Name(name) = &array.kind else {
                    return Err(self.fault("E_TYPE", range));
                };
                (name, Some(*index), false)
            }
            _ => return Err(self.fault("E_TYPE", range)),
        };
        let mut at = self.binding_index(name, range)?;
        let mut borrowed = false;
        if deref {
            let Value::Reference { loan_id } = self.state.bindings[at].value else {
                return Err(self.fault("E_TYPE", range));
            };
            let loan = self
                .state
                .loans
                .iter()
                .find(|l| l.id == loan_id)
                .ok_or_else(|| self.fault("E_BORROW_CONFLICT", range))?;
            if !loan.mutable {
                return Err(self.fault("E_BORROW_MUTABLE", range));
            }
            borrowed = true;
            at = self.binding_id_index(loan.target_binding_id, range)?;
        }
        let before = self.state.clone();
        let flags = value.flags | self.context | if borrowed { MUTABLE_BORROW } else { 0 };
        if let Some(index) = index {
            let Value::ArrayObject { object_id } = self.state.bindings[at].value else {
                return Err(self.fault("E_TYPE", range));
            };
            let Value::I32 { value } = value.value else {
                return Err(self.fault("E_TYPE", range));
            };
            let object = self.object_index(object_id, range)?;
            let slots = self.state.objects[object]
                .items
                .as_mut()
                .ok_or_else(|| Signal::Fault(Fault::new("E_TYPE", range)))?;
            let slot = slots
                .get_mut(index)
                .ok_or_else(|| Signal::Fault(Fault::new("E_ARRAY_BOUNDS", range)))?;
            *slot = value;
            self.slots.insert((object_id, index), flags | ARRAY_WRITE);
            self.commit(before, node, "array-write", range)
        } else {
            if self.state.bindings[at].status == "live"
                && let Some(id) = self.state.bindings[at].value.object_id()
            {
                let object = self.object_index(id, range)?;
                self.state.objects[object].alive = false;
            }
            self.consume_temp(&value);
            self.state.bindings[at].value = value.value;
            self.state.bindings[at].status = "live";
            self.flags.insert(self.state.bindings[at].id, flags);
            self.commit(before, node, "assign", range)
        }
    }
    fn output(
        &mut self,
        newline: bool,
        format: &str,
        args: &[Expr],
        node: u32,
        range: ByteRange,
    ) -> Eval<()> {
        let mut values = Vec::new();
        let mut temporaries = Vec::new();
        let mut flags = OUTPUT | self.context;
        for arg in args {
            let datum = self.eval(arg, false)?;
            flags |= datum.flags;
            values.push(self.display(&datum.value, range)?);
            if datum.temp.is_some() {
                temporaries.push(datum);
            }
        }
        let mut chars = format.chars().peekable();
        let mut text = String::new();
        let mut next = 0;
        while let Some(c) = chars.next() {
            match c {
                '{' if chars.peek() == Some(&'{') => {
                    chars.next();
                    text.push('{');
                }
                '}' if chars.peek() == Some(&'}') => {
                    chars.next();
                    text.push('}');
                }
                '{' => {
                    if chars.next() != Some('}') {
                        return Err(self.fault("E_UNSUPPORTED", range));
                    }
                    let value = values
                        .get(next)
                        .ok_or_else(|| self.fault("E_ARITY", range))?;
                    text.push_str(value);
                    next += 1;
                }
                '}' => return Err(self.fault("E_UNSUPPORTED", range)),
                _ => text.push(c),
            }
        }
        if next != values.len() {
            return Err(self.fault("E_ARITY", range));
        }
        if newline {
            text.push('\n');
        }
        let before = self.state.clone();
        self.state.output.push_str(&text);
        self.commit(before, node, "output", range)?;
        self.features |= flags;
        for temporary in temporaries {
            self.discard(temporary, node, range)?;
        }
        Ok(())
    }
    fn display(&self, value: &Value, range: ByteRange) -> Eval<String> {
        match value {
            Value::I32 { value } => Ok(value.to_string()),
            Value::Bool { value } => Ok(value.to_string()),
            Value::StringObject { object_id } => Ok(self.state.objects
                [self.object_index(*object_id, range)?]
            .text
            .clone()
            .unwrap_or_default()),
            Value::Reference { loan_id } => {
                let loan = self
                    .state
                    .loans
                    .iter()
                    .find(|l| l.id == *loan_id)
                    .ok_or_else(|| self.fault("E_BORROW_CONFLICT", range))?;
                let index = self.binding_id_index(loan.target_binding_id, range)?;
                self.display(&self.state.bindings[index].value, range)
            }
            _ => Err(self.fault("E_TYPE", range)),
        }
    }
    fn statement(&mut self, statement: &Stmt) -> Eval<()> {
        let node = statement.id;
        let range = statement.range;
        match &statement.kind {
            StmtKind::Let {
                name,
                mutable,
                annotation,
                value,
            } => {
                let datum = self.eval(value, true)?;
                self.declare(node, name, *mutable, annotation.as_ref(), datum, range)
            }
            StmtKind::Assign { target, value } => {
                let datum = self.eval(value, true)?;
                self.assignment(target, datum, node, range)
            }
            StmtKind::Expression(expr) => {
                let value = self.eval(expr, true)?;
                self.discard(value, node, range)
            }
            StmtKind::Return(value) => {
                let value = if let Some(value) = value {
                    self.eval(value, true)?
                } else {
                    Datum::unit()
                };
                Err(Signal::Return(value))
            }
            StmtKind::Break => Err(Signal::Break),
            StmtKind::Continue => Err(Signal::Continue),
            StmtKind::Print {
                newline,
                format,
                args,
            } => self.output(*newline, format, args, node, range),
            StmtKind::ReadLine(name) => {
                let index = self.binding_index(name, range)?;
                let datum = self.datum(index, range)?;
                let Value::StringObject { object_id } = datum.value else {
                    return Err(self.fault("E_TYPE", range));
                };
                let object = self.object_index(object_id, range)?;
                let start = self.state.control.input_cursor;
                let end = self.input[start..]
                    .find('\n')
                    .map_or(self.input.len(), |n| start + n + 1);
                let mut text = self.state.objects[object].text.clone().unwrap_or_default();
                text.push_str(&self.input[start..end]);
                if text.len() > 4096 {
                    return Err(self.fault("E_MEMORY_LIMIT", range));
                }
                let before = self.state.clone();
                self.state.objects[object].text = Some(text);
                self.state.control.input_cursor = end;
                if end > start {
                    *self.flags.entry(self.state.bindings[index].id).or_default() |= INPUT;
                }
                self.commit(before, node, "input", range)
            }
            StmtKind::While(test, body) => {
                loop {
                    let value = self.eval(test, true)?;
                    let Value::Bool { value: yes } = value.value else {
                        return Err(self.fault("E_TYPE", range));
                    };
                    self.mark(node, "condition", range)?;
                    if !yes {
                        break;
                    }
                    let previous = self.context;
                    self.context |= LOOP | value.flags;
                    self.mark(node, "loop", range)?;
                    let result = self.block(body);
                    self.context = previous;
                    match result {
                        Ok(value) => self.discard(value, node, range)?,
                        Err(Signal::Break) => break,
                        Err(Signal::Continue) => continue,
                        Err(signal) => return Err(signal),
                    }
                }
                Ok(())
            }
            StmtKind::Loop(body) => {
                loop {
                    let previous = self.context;
                    self.context |= LOOP;
                    self.mark(node, "loop", range)?;
                    let result = self.block(body);
                    self.context = previous;
                    match result {
                        Ok(value) => self.discard(value, node, range)?,
                        Err(Signal::Break) => break,
                        Err(Signal::Continue) => continue,
                        Err(signal) => return Err(signal),
                    }
                }
                Ok(())
            }
            StmtKind::For { name, iter, body } => {
                let (values, flags): (Box<dyn Iterator<Item = (i32, u32)>>, u32) = match iter {
                    ForIter::Range {
                        start,
                        end,
                        inclusive,
                    } => {
                        let start = self.eval(start, true)?;
                        let end = self.eval(end, true)?;
                        let (Value::I32 { value: a }, Value::I32 { value: b }) =
                            (start.value, end.value)
                        else {
                            return Err(self.fault("E_TYPE", range));
                        };
                        let stop = i64::from(b) + i64::from(*inclusive);
                        (
                            Box::new((i64::from(a)..stop).map(|n| (n as i32, 0))),
                            start.flags | end.flags,
                        )
                    }
                    ForIter::Array(array) => {
                        let d = self.eval(array, true)?;
                        let Value::ArrayObject { object_id } = d.value else {
                            return Err(self.fault("E_TYPE", range));
                        };
                        let i = self.object_index(object_id, range)?;
                        let items = self.state.objects[i]
                            .items
                            .clone()
                            .unwrap_or_default()
                            .into_iter()
                            .enumerate()
                            .map(|(index, value)| {
                                (
                                    value,
                                    self.slots.get(&(object_id, index)).copied().unwrap_or(0),
                                )
                            })
                            .collect::<Vec<_>>();
                        let flags = d.flags;
                        if d.temp.is_some() {
                            self.discard(d, node, range)?;
                        }
                        (Box::new(items.into_iter()), flags)
                    }
                };
                for (value, value_flags) in values {
                    let old = self.state.clone();
                    let scope = self.state.allocator.next_scope;
                    self.state.allocator.next_scope += 1;
                    if let Some(f) = self.state.frames.last_mut() {
                        f.scope_ids.push(scope);
                    }
                    self.commit(old, node, "scope-enter", range)?;
                    let previous = self.context;
                    self.context |= LOOP | flags;
                    self.declare(
                        node,
                        name,
                        false,
                        Some(&Type::I32),
                        Datum {
                            value: Value::I32 { value },
                            flags: flags | value_flags | LOOP,
                            temp: None,
                        },
                        range,
                    )?;
                    self.mark(node, "loop", range)?;
                    let result = self.block(body);
                    self.context = previous;
                    if !matches!(result, Err(Signal::Fault(_))) {
                        self.exit_scope(node, range)?;
                    }
                    match result {
                        Ok(value) => self.discard(value, node, range)?,
                        Err(Signal::Break) => break,
                        Err(Signal::Continue) => continue,
                        Err(signal) => return Err(signal),
                    }
                }
                Ok(())
            }
        }
    }
}
