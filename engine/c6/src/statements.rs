//! C6 statement/control execution and real call/scope lifetime transitions.
use crate::{
    runtime::{Activation, Allocation, CallEvent, Deps, Eval, Runtime},
    state,
    syntax::{Decl, Expr, Fault, Id, Init, Kind},
    types::{Ty, Val},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub enum Flow {
    Next,
    Return(Eval),
    Break,
    Continue,
}
impl Runtime<'_, '_> {
    pub fn run(&mut self) -> Result<Eval, Fault> {
        let root = self.checked.program.root;
        self.emit(root, "program.enter", vec![])?;
        self.scope_enter(root)?;
        for id in self.checked.program.globals.clone() {
            let Kind::Declare(d) = self.checked.program.nodes[id].kind.clone() else {
                unreachable!()
            };
            self.declaration(d, id)?;
        }
        let result = self.function("main", vec![], root)?;
        let mut control = self.journal.state["control"].clone();
        control["activeFrameId"] = Value::Null;
        control["nextNodeId"] = Value::Null;
        control["returnValue"] = result.value.wire();
        self.emit(
            root,
            "program.return",
            vec![state::singleton(&self.journal.state, "control", control)],
        )?;
        self.output_deps.extend(self.evidence(
            &["program.main-return"],
            root,
            vec![],
            &result.value,
            "",
        ));
        Ok(result)
    }
    pub fn statement(&mut self, id: Id, new_scope: bool) -> Result<Flow, Fault> {
        self.guarded(id, |r| r.statement_inner(id, new_scope))
    }
    fn statement_inner(&mut self, id: Id, new_scope: bool) -> Result<Flow, Fault> {
        self.tick(id, 1)?;
        match self.checked.program.nodes[id].kind.clone() {
            Kind::Block(statements) => {
                if new_scope {
                    self.scope_enter(id)?
                }
                let mut flow = Flow::Next;
                for stmt in statements {
                    flow = self.statement(stmt, true)?;
                    if !matches!(flow, Flow::Next) {
                        break;
                    }
                }
                if new_scope {
                    self.scope_exit(id)?
                }
                Ok(flow)
            }
            Kind::Group(statements) => {
                for stmt in statements {
                    self.statement(stmt, true)?;
                }
                Ok(Flow::Next)
            }
            Kind::Declare(d) => {
                self.declaration(d, id)?;
                Ok(Flow::Next)
            }
            Kind::ExprStmt(expr) => {
                self.expression(expr)?;
                Ok(Flow::Next)
            }
            Kind::If { condition, yes, no } => {
                let value = self.expression(condition)?;
                let control = self.branch(
                    id,
                    &value,
                    &["condition.contribution", "control.if", "array.guard"],
                )?;
                let old = std::mem::replace(&mut self.control_deps, control.clone());
                let result = if value.value.truth() {
                    self.statement(yes, true)
                } else if let Some(no) = no {
                    self.statement(no, true)
                } else {
                    Ok(Flow::Next)
                };
                self.control_deps = old;
                let result = result?;
                self.merge_guard_writes(yes, &control);
                if let Some(no) = no {
                    self.merge_guard_writes(no, &control)
                }
                Ok(result)
            }
            Kind::While { condition, body } => {
                loop {
                    let c = self.expression(condition)?;
                    let control = self.branch(id, &c, &["loop.contribution", "control.while"])?;
                    if !c.value.truth() {
                        self.merge_guard_writes(body, &control);
                        break;
                    }
                    let old = std::mem::replace(&mut self.control_deps, control);
                    let result = self.statement(body, true);
                    self.control_deps = old;
                    match result? {
                        Flow::Next | Flow::Continue => {}
                        Flow::Break => break,
                        flow => return Ok(flow),
                    }
                }
                Ok(Flow::Next)
            }
            Kind::DoWhile { body, condition } => {
                loop {
                    self.emit(id, "control.jump", vec![])?;
                    self.branches.push(crate::runtime::BranchEvent {
                        node: id,
                        seq: self.journal.steps.len(),
                        truth: true,
                        deps: self.control_deps.clone(),
                    });
                    let mut control = self.control_deps.clone();
                    control.extend(self.evidence(
                        &["loop.contribution", "control.do-while"],
                        id,
                        vec![],
                        &Val::I(1),
                        "",
                    ));
                    let old = std::mem::replace(&mut self.control_deps, control);
                    let flow = self.statement(body, true);
                    self.control_deps = old;
                    match flow? {
                        Flow::Next | Flow::Continue => {}
                        Flow::Break => break,
                        flow => return Ok(flow),
                    }
                    let c = self.expression(condition)?;
                    let control =
                        self.branch(id, &c, &["loop.contribution", "control.do-while"])?;
                    if !c.value.truth() {
                        self.merge_guard_writes(body, &control);
                        break;
                    }
                }
                Ok(Flow::Next)
            }
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                self.scope_enter(id)?;
                if let Some(init) = init {
                    self.statement(init, true)?;
                }
                let mut flow = Flow::Next;
                loop {
                    let c = if let Some(c) = condition {
                        self.expression(c)?
                    } else {
                        Eval::plain(Val::I(1))
                    };
                    let control = self.branch(id, &c, &["loop.contribution", "control.for"])?;
                    if !c.value.truth() {
                        self.merge_guard_writes(body, &control);
                        break;
                    }
                    let old = std::mem::replace(&mut self.control_deps, control);
                    let next = self.statement(body, true);
                    self.control_deps = old;
                    match next? {
                        Flow::Next | Flow::Continue => {}
                        Flow::Break => break,
                        next => {
                            flow = next;
                            break;
                        }
                    }
                    if let Some(update) = update {
                        self.expression(update)?;
                    }
                }
                self.scope_exit(id)?;
                Ok(flow)
            }
            Kind::Switch { value, arms } => {
                let value = self.expression(value)?;
                let selected = arms
                    .iter()
                    .position(|a| {
                        a.label.as_ref().is_some_and(|label| {
                            crate::types::binary("==", &value.value, label).is_ok_and(|v| v.truth())
                        })
                    })
                    .or_else(|| arms.iter().position(|a| a.label.is_none()));
                let mut tags = vec!["switch.contribution", "control.switch"];
                let mut constants = arms.iter().filter_map(|a| a.label_expr).collect::<Vec<_>>();
                let mut has_enum = false;
                while let Some(node) = constants.pop() {
                    if matches!(
                        &self.checked.program.nodes[node].kind,
                        Kind::Expression(Expr::Literal(_, Some("type.enum")))
                    ) {
                        has_enum = true
                    }
                    constants.extend(self.checked.program.nodes[node].kind.children());
                }
                if has_enum {
                    tags.push("type.enum")
                }
                let control = self.branch(id, &value, &tags)?;
                let old = std::mem::replace(&mut self.control_deps, control);
                self.scope_enter(id)?;
                let mut result = Flow::Next;
                if let Some(start) = selected {
                    'arms: for arm in &arms[start..] {
                        self.emit(arm.node, "control.jump", vec![])?;
                        for stmt in &arm.statements {
                            result = self.statement(*stmt, true)?;
                            if !matches!(result, Flow::Next) {
                                break 'arms;
                            }
                        }
                    }
                }
                self.scope_exit(id)?;
                let merged = self.control_deps.clone();
                self.control_deps = old;
                for arm in &arms {
                    for stmt in &arm.statements {
                        self.merge_guard_writes(*stmt, &merged)
                    }
                }
                Ok(if matches!(result, Flow::Break) {
                    Flow::Next
                } else {
                    result
                })
            }
            Kind::Return(expr) => {
                let mut value = if let Some(expr) = expr {
                    self.expression(expr)?
                } else {
                    let mut e = Eval::plain(Val::I(0));
                    e.ty = Ty::Void;
                    e
                };
                value.deps.extend(self.control_deps.clone());
                value.deps.extend(self.call_deps.clone());
                let mut control = self.journal.state["control"].clone();
                control["returnValue"] = if value.ty.bare() == &Ty::Void {
                    Value::Null
                } else {
                    value.value.wire()
                };
                self.emit(
                    id,
                    "control.jump",
                    vec![state::singleton(&self.journal.state, "control", control)],
                )?;
                Ok(Flow::Return(value))
            }
            Kind::Break => {
                self.emit(id, "control.jump", vec![])?;
                Ok(Flow::Break)
            }
            Kind::Continue => {
                self.emit(id, "control.jump", vec![])?;
                Ok(Flow::Continue)
            }
            Kind::Empty | Kind::Marker(_) => {
                self.emit(id, "nop", vec![])?;
                Ok(Flow::Next)
            }
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn branch(&mut self, id: Id, value: &Eval, tags: &[&str]) -> Result<Deps, Fault> {
        self.emit(id, "condition", vec![])?;
        let mut deps = self.control_deps.clone();
        deps.extend(value.deps.clone());
        let selection = matches!(
            self.checked.program.nodes[id].kind,
            Kind::If { .. } | Kind::Switch { .. }
        );
        if !selection || value.deps.values().any(|p| p.tag == "input.source") {
            deps.extend(self.evidence(tags, id, vec![], &value.value, ""));
        }
        self.branches.push(crate::runtime::BranchEvent {
            node: id,
            seq: self.journal.steps.len(),
            truth: value.value.truth(),
            deps: deps.clone(),
        });
        Ok(deps)
    }
    fn merge_guard_writes(&mut self, id: Id, control: &Deps) {
        // A reaching-definition merge: a guard can preserve a value by skipping a potential write.
        // No unselected C expression is executed and no state value/counter is changed here.
        let mut stack = vec![id];
        let mut targets = BTreeSet::new();
        while let Some(n) = stack.pop() {
            if let Kind::Expression(Expr::Assign(_, target, value)) =
                &self.checked.program.nodes[n].kind
                && let Kind::Expression(Expr::Name(name)) =
                    &self.checked.program.nodes[*target].kind
            {
                let identity = matches!(&self.checked.program.nodes[*value].kind,Kind::Expression(Expr::Name(rhs))if rhs==name);
                if !identity && let Some(declaration) = self.checked.name_declarations[*target] {
                    targets.insert((name.clone(), declaration));
                }
            }
            stack.extend(self.checked.program.nodes[n].kind.children());
        }
        for (name, declaration) in targets {
            if let Ok(object) = self.lookup(&name, id)
                && self.objects[object].ty.scalar()
                && self.objects[object].declaration == declaration
            {
                self.cell_deps
                    .entry((object, 0))
                    .or_default()
                    .extend(control.clone());
            }
        }
    }
    fn declaration(&mut self, d: Decl, id: Id) -> Result<(), Fault> {
        let static_storage = d.static_storage || d.global;
        if static_storage && let Some(&object) = self.statics.get(&id) {
            return self.bind(&d.name, object, id, true);
        }
        let aggregate = matches!(d.ty.bare(), Ty::Array(..) | Ty::Struct(_));
        let initialized = !matches!(d.init, Init::None);
        let object = self.allocate(
            d.ty.clone(),
            &d.name,
            id,
            Allocation {
                storage: if static_storage {
                    "static"
                } else {
                    "automatic"
                },
                zero: static_storage || aggregate && initialized,
                writable: !d.ty.top_const(),
                parameter: false,
            },
        )?;
        if static_storage {
            self.statics.insert(id, object);
            self.bind(&d.name, object, id, true)?;
        } else {
            self.env_mut().bindings.insert(d.name.clone(), object);
        }
        if initialized {
            let mut updates = vec![];
            self.initializer(object, 0, &d.ty, &d.init, id, &mut updates)?;
            let values = self.writes(updates, id, true, vec![], "value.initialize")?;
            if matches!(d.ty.bare(), Ty::Struct(_)) {
                let value = values.first().map(|v| v.value.clone()).unwrap_or(Val::I(0));
                let oid = self.journal.state["objects"][object]["id"]
                    .as_str()
                    .unwrap()
                    .to_string();
                let deps = self.evidence(&["struct.initialize"], id, vec![oid], &value, "");
                self.objects[object].declaration_deps.extend(deps);
            }
        }
        Ok(())
    }
    fn initializer(
        &mut self,
        object: usize,
        offset: usize,
        ty: &Ty,
        init: &Init,
        id: Id,
        out: &mut Vec<(crate::runtime::Place, Eval)>,
    ) -> Result<(), Fault> {
        self.tick(id, 1)?;
        match init {
            Init::None => {}
            Init::Expr(expr) => {
                if let Ty::Array(base, n) = ty.bare()
                    && base.bare() == &Ty::Char
                    && let Kind::Expression(Expr::String(bytes)) =
                        &self.checked.program.nodes[*expr].kind
                {
                    let bytes = bytes.clone();
                    for (i, byte) in bytes
                        .iter()
                        .copied()
                        .chain(std::iter::once(0))
                        .take(*n)
                        .enumerate()
                    {
                        let mut p = self.object_place(object);
                        p.offset = offset + i;
                        p.ty = base.as_ref().clone();
                        out.push((p, Eval::plain(Val::C(byte))));
                    }
                    return Ok(());
                }
                let value = self.expression(*expr)?;
                let mut p = self.object_place(object);
                p.offset = offset;
                p.ty = ty.clone();
                out.push((p, value));
            }
            Init::Items(items) => match ty.bare() {
                Ty::Array(base, _) => {
                    let stride = self.checked.types.size(base);
                    for (i, init) in items.iter().enumerate() {
                        self.initializer(object, offset + i * stride, base, init, id, out)?
                    }
                }
                Ty::Struct(_) => {
                    let info = self.checked.types.table[&ty.name()].clone();
                    for (field, init) in info.fields.iter().zip(items) {
                        let ty = self.checked.types.resolved[&field.type_name].clone();
                        self.initializer(object, offset + field.byte_offset, &ty, init, id, out)?
                    }
                }
                _ => self.initializer(object, offset, ty, &items[0], id, out)?,
            },
        }
        Ok(())
    }
    pub fn function(&mut self, name: &str, args: Vec<Eval>, id: Id) -> Result<Eval, Fault> {
        self.guarded(id, |r| r.function_inner(name, args, id))
    }
    fn function_inner(&mut self, name: &str, args: Vec<Eval>, call: Id) -> Result<Eval, Fault> {
        if self.activations.len() >= 32 {
            return Err(self.err("E_STACK_LIMIT", call));
        }
        let index = self
            .checked
            .program
            .functions
            .iter()
            .position(|f| f.name == name)
            .ok_or_else(|| self.err("E_UNDECLARED", call))?;
        let f = self.checked.program.functions[index].clone();
        let state = &self.journal.state;
        let mut allocator = state["allocator"].clone();
        let frame = format!("f{}", allocator["nextFrame"].as_u64().unwrap());
        allocator["nextFrame"] = json!(allocator["nextFrame"].as_u64().unwrap() + 1);
        let mut control = state["control"].clone();
        control["activeFrameId"] = json!(frame);
        control["returnValue"] = Value::Null;
        let before = state["frames"].as_array().unwrap().len();
        let parent = self.current_frame();
        let function = json!({"id":frame,"functionNodeId":state::nid(f.node),"functionName":name,"parentFrameId":parent,"callNodeId":if name=="main"{None}else{Some(state::nid(call))},"scopeIds":[]});
        self.emit(
            call,
            if name == "main" {
                "program.enter"
            } else {
                "function.enter"
            },
            vec![
                state::record("frames", before, Value::Null, function),
                state::singleton(state, "allocator", allocator),
                state::singleton(state, "control", control),
            ],
        )?;
        let entry_seq = self.journal.steps.len();
        let arguments = args.iter().map(|a| a.value.clone()).collect();
        let recursive = self.activations.last().is_some_and(|a| a.function == index);
        let mut tags = vec![];
        if name != "main" {
            tags.push("call.contribution");
            if self.checked.program.signatures[name].declared_at < self.range(f.node).start {
                tags.push("function.prototype")
            }
        }
        if recursive {
            tags.extend(["recursion.contribution", "function.recursion"]);
            self.recursion_entries += 1;
        }
        let mut call_deps = self.call_deps.clone();
        call_deps.extend(self.evidence(&tags, call, vec![], &Val::I(0), ""));
        let previous_call = std::mem::replace(&mut self.call_deps, call_deps.clone());
        *self.call_counts.entry(name.into()).or_default() += 1;
        self.activations.push(Activation {
            function: index,
            frame: frame.clone(),
            env: vec![],
        });
        self.scope_enter(f.node)?;
        for (param, value) in f.params.iter().zip(args) {
            let object = self.allocate(
                param.ty.clone(),
                &param.name,
                param.node,
                Allocation {
                    storage: "automatic",
                    zero: false,
                    writable: !param.ty.top_const(),
                    parameter: true,
                },
            )?;
            self.env_mut().bindings.insert(param.name.clone(), object);
            self.writes(
                vec![(self.object_place(object), value)],
                param.node,
                true,
                vec![],
                "value.initialize",
            )?;
        }
        let flow = self.statement(f.body, false)?;
        let mut result = match flow {
            Flow::Return(value) => {
                if f.result.bare() == &Ty::Void {
                    let mut v = Eval::plain(Val::I(0));
                    v.ty = Ty::Void;
                    v
                } else {
                    value.cast(&f.result).map_err(|c| self.err(c, f.node))?
                }
            }
            Flow::Next if name == "main" => Eval::plain(Val::I(0)),
            Flow::Next if f.result.bare() == &Ty::Void => {
                let mut v = Eval::plain(Val::I(0));
                v.ty = Ty::Void;
                v
            }
            _ => return Err(self.err("E_RETURN_MISSING", f.node)),
        };
        self.scope_exit(f.node)?;
        self.activations.pop();
        self.call_deps = previous_call;
        let state = &self.journal.state;
        let at = self.frame_index(&frame);
        let before = state["frames"][at].clone();
        let mut control = state["control"].clone();
        control["activeFrameId"] = json!(self.current_frame());
        control["returnValue"] = if result.ty.bare() == &Ty::Void {
            Value::Null
        } else {
            result.value.wire()
        };
        self.emit(
            call,
            if name == "main" {
                "program.return"
            } else {
                "function.return"
            },
            vec![
                state::record("frames", at, before, Value::Null),
                state::singleton(state, "control", control),
            ],
        )?;
        result.deps.extend(call_deps);
        result.constant &= !result.deps.values().any(|p| p.tag == "input.source");
        if name != "main"
            && (self.watch.contains("call.contribution")
                || self.watch.contains("storage.static-local"))
        {
            self.calls.push(CallEvent {
                function: name.into(),
                node: call,
                entry_seq,
                exit_seq: self.journal.steps.len(),
                recursive,
                arguments,
                result: result.clone(),
            });
        }
        Ok(result)
    }
}
