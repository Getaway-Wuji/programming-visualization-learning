//! Real expression evaluation; metadata is propagated from operations, not source keywords.
use crate::{
    runtime::{Access, Allocation, Deps, Eval, Place, Runtime},
    state,
    syntax::{Expr, Fault, Id, Kind},
    types::{self, Ty, Val},
};
use serde_json::json;

impl Runtime<'_, '_> {
    pub fn expression(&mut self, id: Id) -> Result<Eval, Fault> {
        self.guarded(id, |r| r.expression_inner(id))
    }
    fn expression_inner(&mut self, id: Id) -> Result<Eval, Fault> {
        self.tick(id, 1)?;
        let Kind::Expression(expr) = self.checked.program.nodes[id].kind.clone() else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        match expr {
            Expr::Literal(value, origin) => {
                let mut tags = vec!["value.variable-constant"];
                if let Some(origin) = origin {
                    tags.push(origin)
                }
                self.attach(Eval::plain(value), &tags, id, vec![], "constant")
            }
            Expr::String(text) => {
                let object = if let Some(object) = self.literals.get(&id) {
                    *object
                } else {
                    let ty = self.checked.expr_types[id].clone().unwrap();
                    let object = self.allocate(
                        ty,
                        "string literal",
                        id,
                        Allocation {
                            storage: "literal",
                            zero: true,
                            writable: false,
                            parameter: false,
                        },
                    )?;
                    let mut updates = vec![];
                    let mut bytes = text;
                    bytes.push(0);
                    for (i, byte) in bytes.into_iter().enumerate() {
                        let mut place = self.object_place(object);
                        place.offset = i;
                        place.ty = Ty::Char;
                        updates.push((place, Eval::plain(Val::C(byte))));
                    }
                    self.writes(updates, id, true, vec![], "value.initialize")?;
                    self.literals.insert(id, object);
                    object
                };
                self.read(self.object_place(object), id)
            }
            Expr::Name(_) | Expr::Index(..) | Expr::Member(..) => {
                let place = self.place(id)?;
                let mut eval = self.read(place, id)?;
                if matches!(
                    self.checked.program.nodes[id].kind,
                    Kind::Expression(Expr::Name(_))
                ) {
                    eval =
                        self.attach(eval, &["value.variable-constant"], id, vec![], "variable")?;
                }
                Ok(eval)
            }
            Expr::Unary(op, a) if op == "&" => {
                let place = self.place(a)?;
                let object = &self.journal.state["objects"][place.object];
                if object["alive"] != true {
                    return Err(self.err("E_DANGLING_POINTER", id));
                }
                let mut eval = Eval {
                    value: Val::P(types::Pointer {
                        object_id: Some(object["id"].as_str().unwrap().into()),
                        byte_offset: place.offset,
                        lower_bound: place.lower,
                        upper_bound: place.upper,
                        pointee_type: place.ty.name(),
                    }),
                    ty: Ty::Pointer(Box::new(place.ty)),
                    deps: place.deps,
                    constant: false,
                    access: place.access,
                };
                eval = self.attach(
                    eval,
                    &["pointer.address"],
                    id,
                    vec![object["id"].as_str().unwrap().into()],
                    "",
                )?;
                Ok(eval)
            }
            Expr::Unary(op, _) if op == "*" => {
                let place = self.place(id)?;
                self.read(place, id)
            }
            Expr::Unary(op, a) if op == "++" || op == "--" => self.increment(id, a, &op, false),
            Expr::Postfix(op, a) => self.increment(id, a, &op, true),
            Expr::Unary(op, a) => {
                let mut eval = self.expression(a)?;
                eval.value = types::unary(&op, &eval.value).map_err(|c| self.err(c, id))?;
                eval.ty = eval.value.ty();
                Ok(eval)
            }
            Expr::Binary(op, a, b) => {
                let mut left = self.expression(a)?;
                if op == "&&" || op == "||" {
                    let evaluate = if op == "&&" {
                        left.value.truth()
                    } else {
                        !left.value.truth()
                    };
                    let mut deps = left.deps.clone();
                    let mut access = left.access.clone();
                    let mut constant = left.constant;
                    let truth = if evaluate {
                        let right = self.expression(b)?;
                        deps.extend(right.deps);
                        access.merge(&right.access);
                        constant &= right.constant;
                        right.value.truth()
                    } else {
                        left.value.truth()
                    };
                    let value = Val::I(i32::from(truth));
                    return Ok(Eval {
                        value,
                        ty: Ty::Int,
                        deps,
                        constant,
                        access,
                    });
                }
                let right = self.expression(b)?;
                if left.access.unsequenced(&right.access) {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                let is_pointer =
                    matches!(left.value, Val::P(_)) || matches!(right.value, Val::P(_));
                let value = if is_pointer {
                    self.pointer_binary(&op, &left, &right, id)?
                } else {
                    types::binary(&op, &left.value, &right.value).map_err(|c| self.err(c, id))?
                };
                let (deps, constant, neutral) = self.binary_origin(&op, a, b, &left, &right)?;
                left.access.merge(&right.access);
                let ty = self.checked.expr_types[id].clone().unwrap();
                let eval = Eval {
                    value,
                    ty,
                    deps,
                    constant,
                    access: left.access,
                };
                let mut tags = vec![];
                if !is_pointer && left.value.ty().integral() && right.value.ty().integral() {
                    tags.push("int.contribution")
                }
                if matches!(op.as_str(), "&" | "|" | "^") {
                    tags.push("uint.bitwise");
                    if op == "^" {
                        tags.push("operator.bitwise-xor")
                    }
                }
                if matches!(op.as_str(), "<<" | ">>") {
                    tags.extend(["shift.contribution", "operator.shift"])
                }
                if matches!(eval.value, Val::F(_) | Val::D(_)) {
                    tags.push("float.typed")
                }
                if is_pointer && matches!(op.as_str(), "+" | "-") {
                    tags.push("pointer.offset")
                }
                if matches!(op.as_str(), "==" | "!=" | "<" | "<=" | ">" | ">=") {
                    let mut counters = self.journal.state["counters"].clone();
                    counters["comparisons"] = json!(counters["comparisons"].as_u64().unwrap() + 1);
                    self.emit(
                        id,
                        "condition",
                        vec![state::singleton(&self.journal.state, "counters", counters)],
                    )?;
                }
                if neutral {
                    tags.clear()
                }
                self.attach(eval, &tags, id, vec![], "")
            }
            Expr::Assign(op, a, b) => {
                let place = self.place(a)?;
                let right = self.expression(b)?;
                if place.access.unsequenced(&right.access)
                    || right.access.writes.contains(&(place.object, place.offset))
                {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                let mut neutral = false;
                let mut value = if op == "=" {
                    right
                } else {
                    let mut left = self.read(place.clone(), a)?;
                    let code = &op[..op.len() - 1];
                    let (deps, constant, no_effect) =
                        self.binary_origin(code, a, b, &left, &right)?;
                    neutral = no_effect;
                    left.value = if matches!(left.value, Val::P(_)) {
                        self.pointer_binary(code, &left, &right, id)?
                    } else {
                        types::binary(code, &left.value, &right.value)
                            .map_err(|c| self.err(c, id))?
                    };
                    left.deps = deps;
                    left.access.merge(&right.access);
                    left.constant = constant;
                    left
                };
                if op != "=" && !neutral {
                    let mut tags = vec!["operator.compound"];
                    if value.value.ty().integral() {
                        tags.push("int.contribution")
                    }
                    if matches!(op.as_str(), "<<=" | ">>=") {
                        tags.extend(["shift.contribution", "operator.shift"])
                    }
                    if matches!(op.as_str(), "&=" | "|=" | "^=") {
                        tags.push("uint.bitwise");
                        if op == "^=" {
                            tags.push("operator.bitwise-xor")
                        }
                    }
                    value = self.attach(value, &tags, id, vec![], "")?;
                }
                let mut values =
                    self.writes(vec![(place, value)], id, false, vec![], "value.write")?;
                Ok(values.remove(0))
            }
            Expr::Conditional(condition, yes, no) => {
                let c = self.expression(condition)?;
                self.emit(id, "condition", vec![])?;
                let mut control = self.control_deps.clone();
                let identical = self.same_pure(yes, no)?;
                if !identical {
                    control.extend(c.deps.clone());
                }
                if !identical && c.deps.values().any(|p| p.tag == "input.source") {
                    control.extend(self.evidence(
                        &["condition.contribution", "operator.conditional"],
                        id,
                        vec![],
                        &c.value,
                        "",
                    ));
                }
                let old = std::mem::replace(&mut self.control_deps, control.clone());
                let result = self.expression(if c.value.truth() { yes } else { no });
                self.control_deps = old;
                let mut value = result?;
                value.deps.extend(control);
                value.access.merge(&c.access);
                if !identical {
                    value.constant &= c.constant;
                }
                value
                    .cast(self.checked.expr_types[id].as_ref().unwrap())
                    .map_err(|c| self.err(c, id))
            }
            Expr::Cast(ty, a) => {
                let before = self.expression(a)?;
                let changed = before.ty.bare() != ty.bare();
                let value = before.cast(&ty).map_err(|c| self.err(c, id))?;
                if !changed {
                    return Ok(value);
                }
                self.attach(
                    value,
                    &["cast.contribution", "operator.cast"],
                    id,
                    vec![],
                    "",
                )
            }
            Expr::SizeType(ty) => self.sizeof(id, ty),
            Expr::SizeExpr(a) => self.sizeof(id, self.checked.expr_types[a].clone().unwrap()),
            Expr::Call(name, args) => {
                if crate::check::builtin(&name).is_some() {
                    self.library(&name, &args, id)
                } else {
                    let mut values = vec![];
                    let mut access = Access::default();
                    for arg in args {
                        let value = self.expression(arg)?;
                        if access.unsequenced(&value.access) {
                            return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                        }
                        access.merge(&value.access);
                        values.push(value);
                    }
                    let mut result = self.function(&name, values, id)?;
                    result.access = access;
                    Ok(result)
                }
            }
        }
    }
    // A finite provenance simplifier, not a C optimizer or a source-template matcher.
    // All operands have already executed, including their reads, diagnostics and side effects.
    fn binary_origin(
        &mut self,
        op: &str,
        a: Id,
        b: Id,
        left: &Eval,
        right: &Eval,
    ) -> Result<(Deps, bool, bool), Fault> {
        let both_int = left.ty.integral() && right.ty.integral();
        let zero = |v: &Eval| v.constant && !v.value.truth();
        let one = |v: &Eval| v.constant && v.value.real() == Ok(1.0);
        if both_int
            && matches!(op, "-" | "^" | "==" | "!=" | "<" | "<=" | ">" | ">=")
            && self.same_pure(a, b)?
        {
            return Ok((Deps::new(), true, true));
        }
        if op == "*" && (zero(left) || zero(right)) {
            return Ok((
                if zero(left) {
                    left.deps.clone()
                } else {
                    right.deps.clone()
                },
                true,
                true,
            ));
        }
        if (both_int || matches!(left.value, Val::P(_)))
            && zero(right)
            && matches!(op, "+" | "-" | "^" | "|" | "<<" | ">>")
            || one(right) && matches!(op, "*" | "/")
        {
            return Ok((left.deps.clone(), left.constant, true));
        }
        if both_int && zero(left) && matches!(op, "+" | "^" | "|") || one(left) && op == "*" {
            return Ok((right.deps.clone(), right.constant, true));
        }
        let mut deps = left.deps.clone();
        deps.extend(right.deps.clone());
        Ok((deps, left.constant && right.constant, false))
    }
    fn same_pure(&mut self, a: Id, b: Id) -> Result<bool, Fault> {
        self.tick(a, 1)?;
        let (Kind::Expression(x), Kind::Expression(y)) = (
            self.checked.program.nodes[a].kind.clone(),
            self.checked.program.nodes[b].kind.clone(),
        ) else {
            return Ok(false);
        };
        Ok(match (x, y) {
            (Expr::Literal(x, _), Expr::Literal(y, _)) => x == y,
            (Expr::Name(_), Expr::Name(_)) => {
                self.checked.name_declarations[a].is_some()
                    && self.checked.name_declarations[a] == self.checked.name_declarations[b]
            }
            (Expr::Unary(op, x), Expr::Unary(q, y))
                if op == q && !matches!(op.as_str(), "++" | "--") =>
            {
                self.same_pure(x, y)?
            }
            (Expr::Binary(op, x1, x2), Expr::Binary(q, y1, y2)) if op == q => {
                self.same_pure(x1, y1)? && self.same_pure(x2, y2)?
            }
            (Expr::Index(x1, x2), Expr::Index(y1, y2)) => {
                self.same_pure(x1, y1)? && self.same_pure(x2, y2)?
            }
            (Expr::Member(x, f, i), Expr::Member(y, g, j)) if f == g && i == j => {
                self.same_pure(x, y)?
            }
            (Expr::Cast(t, x), Expr::Cast(u, y)) if t == u => self.same_pure(x, y)?,
            (Expr::SizeType(t), Expr::SizeType(u)) => t == u,
            (Expr::SizeExpr(x), Expr::SizeExpr(y)) => {
                self.checked.expr_types[x] == self.checked.expr_types[y]
            }
            _ => false,
        })
    }
    fn sizeof(&mut self, id: Id, ty: Ty) -> Result<Eval, Fault> {
        let value = Eval::plain(Val::U(self.checked.types.size(&ty) as u32));
        let mut tags = vec!["type.sizeof"];
        fn alias(t: &Ty) -> bool {
            match t {
                Ty::Alias(..) => true,
                Ty::Const(t) | Ty::Pointer(t) | Ty::Array(t, _) => alias(t),
                _ => false,
            }
        }
        if alias(&ty) {
            tags.push("type.typedef")
        }
        self.attach(value, &tags, id, vec![], &id.to_string())
    }
    pub fn place(&mut self, id: Id) -> Result<Place, Fault> {
        self.guarded(id, |r| r.place_inner(id))
    }
    fn place_inner(&mut self, id: Id) -> Result<Place, Fault> {
        self.tick(id, 1)?;
        let Kind::Expression(expr) = self.checked.program.nodes[id].kind.clone() else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        match expr {
            Expr::Name(name) => {
                let object = self.lookup(&name, id)?;
                Ok(self.object_place(object))
            }
            Expr::Unary(op, a) if op == "*" => {
                let pointer = self.expression(a)?;
                let mut place = self.pointer_place(&pointer, id)?;
                place.explicit_deref = true;
                Ok(place)
            }
            Expr::Index(a, b) => {
                let mut base = self.expression(a)?;
                let index = self.expression(b)?;
                if base.access.unsequenced(&index.access) {
                    return Err(self.err("E_UNSUPPORTED_SYNTAX", id));
                }
                base.value = self.pointer_binary("+", &base, &index, id)?;
                base.deps.extend(index.deps);
                base.access.merge(&index.access);
                self.pointer_place(&base, id)
            }
            Expr::Member(a, field, indirect) => {
                let mut place = if indirect {
                    let base = self.expression(a)?;
                    self.pointer_place(&base, id)?
                } else {
                    self.place(a)?
                };
                self.validate(&place, false, false, id)?;
                let (ty, offset) = self
                    .checked
                    .types
                    .field(&place.ty, &field)
                    .ok_or_else(|| self.err("E_TYPE_INVALID", id))?;
                place.offset += offset;
                place.lower = place.offset;
                place.upper = place.offset + self.checked.types.size(&ty);
                place.ty = ty;
                self.emit(id, "nop", vec![])?;
                let oid = self.journal.state["objects"][place.object]["id"]
                    .as_str()
                    .unwrap()
                    .to_string();
                place.deps.extend(self.evidence(
                    &[
                        "struct.field-contribution",
                        if indirect {
                            "struct.arrow"
                        } else {
                            "struct.dot"
                        },
                    ],
                    id,
                    vec![oid],
                    &Val::U(place.offset as u32),
                    &format!("{}:{}", place.object, place.offset),
                ));
                Ok(place)
            }
            _ => Err(self.err("E_TYPE_INVALID", id)),
        }
    }
    fn increment(&mut self, id: Id, arg: Id, op: &str, postfix: bool) -> Result<Eval, Fault> {
        let place = self.place(arg)?;
        let old = self.read(place.clone(), arg)?;
        let one = Eval::plain(Val::I(1));
        let code = if op == "++" { "+" } else { "-" };
        let mut next = old.clone();
        next.value = if matches!(old.value, Val::P(_)) {
            self.pointer_binary(code, &old, &one, id)?
        } else {
            types::binary(code, &old.value, &one.value).map_err(|c| self.err(c, id))?
        };
        let pointer = matches!(old.value, Val::P(_));
        let mut tags = vec![if op == "++" {
            "operator.increment"
        } else {
            "operator.decrement"
        }];
        if pointer {
            tags.push("pointer.offset")
        }
        next = self.attach(next, &tags, id, vec![], "")?;
        let mut changed = self
            .writes(vec![(place, next)], id, false, vec![], "value.write")?
            .remove(0);
        if postfix {
            changed.value = old.value;
            changed.deps.extend(old.deps);
        }
        Ok(changed)
    }
    pub fn pointer_binary(
        &self,
        op: &str,
        left: &Eval,
        right: &Eval,
        id: Id,
    ) -> Result<Val, Fault> {
        let mut a = &left.value;
        let mut b = &right.value;
        if op == "+" && !matches!(a, Val::P(_)) {
            std::mem::swap(&mut a, &mut b)
        }
        if let (Val::P(x), Val::P(y)) = (a, b) {
            if matches!(op, "==" | "!=") {
                let equal = x.object_id == y.object_id && x.byte_offset == y.byte_offset;
                return Ok(Val::I(i32::from(if op == "==" { equal } else { !equal })));
            }
            if x.object_id.is_none()
                || x.object_id != y.object_id
                || x.lower_bound != y.lower_bound
                || x.upper_bound != y.upper_bound
                || !crate::check::compatible_pointer_targets(
                    &self.checked.types.resolved[&x.pointee_type],
                    &self.checked.types.resolved[&y.pointee_type],
                )
            {
                return Err(self.err("E_POINTER_BOUNDS", id));
            }
            let object = x.object_id.as_ref().unwrap()[1..].parse::<usize>().unwrap() - 1;
            if self.journal.state["objects"][object]["alive"] != true {
                return Err(self.err("E_DANGLING_POINTER", id));
            }
            let size = self.checked.types.table[&x.pointee_type].byte_size;
            return if op == "-" {
                Ok(Val::I(
                    (x.byte_offset as i64 - y.byte_offset as i64)
                        .checked_div(size as i64)
                        .and_then(|n| i32::try_from(n).ok())
                        .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?,
                ))
            } else {
                Ok(Val::I(i32::from(match op {
                    "<" => x.byte_offset < y.byte_offset,
                    "<=" => x.byte_offset <= y.byte_offset,
                    ">" => x.byte_offset > y.byte_offset,
                    ">=" => x.byte_offset >= y.byte_offset,
                    _ => return Err(self.err("E_TYPE_INVALID", id)),
                })))
            };
        }
        if matches!(op, "==" | "!=") {
            if let Val::P(p) = a
                && !b.truth()
            {
                return Ok(Val::I(i32::from(if op == "==" {
                    p.object_id.is_none()
                } else {
                    p.object_id.is_some()
                })));
            }
            if let Val::P(p) = b
                && !a.truth()
            {
                return Ok(Val::I(i32::from(if op == "==" {
                    p.object_id.is_none()
                } else {
                    p.object_id.is_some()
                })));
            }
            return Err(self.err("E_TYPE_INVALID", id));
        }
        let Val::P(p) = a else {
            return Err(self.err("E_TYPE_INVALID", id));
        };
        let Some(object) = p.object_id.as_ref() else {
            return Err(self.err("E_NULL_POINTER", id));
        };
        let index = object[1..].parse::<usize>().unwrap() - 1;
        if self.journal.state["objects"][index]["alive"] != true {
            return Err(self.err("E_DANGLING_POINTER", id));
        }
        let n = match b {
            Val::I(n) => i64::from(*n),
            Val::U(n) => i64::from(*n),
            Val::C(n) => i64::from(*n),
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        };
        let size = self.checked.types.table[&p.pointee_type].byte_size as i64;
        let movement = n
            .checked_mul(size)
            .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?;
        let at = match op {
            "+" => (p.byte_offset as i64).checked_add(movement),
            "-" => (p.byte_offset as i64).checked_sub(movement),
            _ => return Err(self.err("E_TYPE_INVALID", id)),
        }
        .ok_or_else(|| self.err("E_POINTER_BOUNDS", id))?;
        if at < 0 || at < p.lower_bound as i64 || at > p.upper_bound as i64 {
            return Err(self.err("E_POINTER_BOUNDS", id));
        }
        let mut p = p.clone();
        p.byte_offset = at as usize;
        Ok(Val::P(p))
    }
}
