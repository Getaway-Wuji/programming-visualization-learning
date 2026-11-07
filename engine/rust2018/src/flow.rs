//! Potential writes identify join points for executed conditional predicates.
//! Local declarations are tracked so a branch-local shadow never taints its outer name.

use crate::syntax::{Block, Expr, ExprKind, ForIter, Program, StmtKind};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Access {
    Binding,
    Element(usize),
    Referent,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Write {
    pub name: String,
    pub access: Access,
}

#[derive(Clone, Default)]
pub(crate) struct Effects {
    pub writes: BTreeSet<Write>,
    pub may_return: bool,
    pub visited: usize,
}

pub(crate) fn conditional(program: &Program, yes: &Block, no: Option<&Expr>) -> Effects {
    let mut effects = Effects::default();
    block(program, yes, &BTreeSet::new(), true, &mut effects);
    if let Some(no) = no {
        expression(program, no, &BTreeSet::new(), true, &mut effects);
    }
    effects
}

fn add(name: &str, access: Access, locals: &BTreeSet<String>, effects: &mut Effects) {
    if !locals.contains(name) {
        effects.writes.insert(Write {
            name: name.to_owned(),
            access,
        });
    }
}

fn target(target: &Expr, locals: &BTreeSet<String>, effects: &mut Effects) {
    match &target.kind {
        ExprKind::Name(name) => add(name, Access::Binding, locals, effects),
        ExprKind::Index(receiver, index) => {
            if let ExprKind::Name(name) = &receiver.kind {
                add(name, Access::Element(*index), locals, effects);
            }
        }
        ExprKind::Unary(op, receiver) if op == "*" => {
            if let ExprKind::Name(name) = &receiver.kind {
                add(name, Access::Referent, locals, effects);
            }
        }
        _ => {}
    }
}

fn block(
    program: &Program,
    value: &Block,
    outer: &BTreeSet<String>,
    follow_calls: bool,
    effects: &mut Effects,
) {
    let mut locals = outer.clone();
    for statement in &value.statements {
        effects.visited += 1;
        match &statement.kind {
            StmtKind::Let { name, value, .. } => {
                expression(program, value, &locals, follow_calls, effects);
                locals.insert(name.clone());
            }
            StmtKind::Assign {
                target: value,
                value: rhs,
            } => {
                target(value, &locals, effects);
                expression(program, rhs, &locals, follow_calls, effects);
            }
            StmtKind::Expression(value) => {
                expression(program, value, &locals, follow_calls, effects)
            }
            StmtKind::While(test, body) => {
                expression(program, test, &locals, follow_calls, effects);
                if constant_bool(test) != Some(false) {
                    block(program, body, &locals, follow_calls, effects);
                }
            }
            StmtKind::Loop(body) => block(program, body, &locals, follow_calls, effects),
            StmtKind::For { name, iter, body } => {
                match iter {
                    ForIter::Range { start, end, .. } => {
                        expression(program, start, &locals, follow_calls, effects);
                        expression(program, end, &locals, follow_calls, effects);
                    }
                    ForIter::Array(value) => {
                        expression(program, value, &locals, follow_calls, effects)
                    }
                }
                let mut nested = locals.clone();
                nested.insert(name.clone());
                block(program, body, &nested, follow_calls, effects);
            }
            StmtKind::Return(value) => {
                effects.may_return = true;
                if let Some(value) = value {
                    expression(program, value, &locals, follow_calls, effects);
                }
            }
            StmtKind::Print { args, .. } => {
                for argument in args {
                    expression(program, argument, &locals, follow_calls, effects);
                }
            }
            StmtKind::ReadLine(name) => add(name, Access::Binding, &locals, effects),
            StmtKind::Break | StmtKind::Continue => {}
        }
    }
    if let Some(tail) = &value.tail {
        expression(program, tail, &locals, follow_calls, effects);
    }
}

fn expression(
    program: &Program,
    value: &Expr,
    locals: &BTreeSet<String>,
    follow_calls: bool,
    effects: &mut Effects,
) {
    effects.visited += 1;
    match &value.kind {
        ExprKind::Unary(_, value) | ExprKind::Repeat(value, _) | ExprKind::Index(value, _) => {
            expression(program, value, locals, follow_calls, effects)
        }
        ExprKind::Binary(_, left, right) => {
            expression(program, left, locals, follow_calls, effects);
            expression(program, right, locals, follow_calls, effects);
        }
        ExprKind::Block(value) => block(program, value, locals, follow_calls, effects),
        ExprKind::If(test, yes, no) => {
            expression(program, test, locals, follow_calls, effects);
            if constant_bool(test) != Some(false) {
                block(program, yes, locals, follow_calls, effects);
            }
            if constant_bool(test) != Some(true)
                && let Some(no) = no
            {
                expression(program, no, locals, follow_calls, effects);
            }
        }
        ExprKind::Array(values) => {
            for value in values {
                expression(program, value, locals, follow_calls, effects);
            }
        }
        ExprKind::Method(receiver, method, args) => {
            if matches!(method.as_str(), "clear" | "push_str")
                && let ExprKind::Name(name) = &receiver.kind
            {
                add(name, Access::Referent, locals, effects);
            }
            for argument in args {
                expression(program, argument, locals, follow_calls, effects);
            }
        }
        ExprKind::Call(name, args) => {
            for argument in args {
                expression(program, argument, locals, follow_calls, effects);
            }
            if follow_calls && let Some(function) = program.functions.get(name) {
                // Reference forwarding is outside the subset, so only direct parameter writes matter.
                let mut callee = Effects::default();
                block(
                    program,
                    &function.body,
                    &BTreeSet::new(),
                    false,
                    &mut callee,
                );
                effects.visited += callee.visited;
                for (parameter, argument) in function.params.iter().zip(args) {
                    if let ExprKind::Borrow(true, name) = &argument.kind
                        && callee.writes.contains(&Write {
                            name: parameter.name.clone(),
                            access: Access::Referent,
                        })
                    {
                        add(name, Access::Referent, locals, effects);
                    }
                }
            }
        }
        _ => {}
    }
}

fn constant_bool(value: &Expr) -> Option<bool> {
    match &value.kind {
        ExprKind::Bool(value) => Some(*value),
        ExprKind::Unary(op, value) if op == "!" => constant_bool(value).map(|value| !value),
        ExprKind::Binary(op, left, right) if op == "&&" => {
            Some(constant_bool(left)? && constant_bool(right)?)
        }
        ExprKind::Binary(op, left, right) if op == "||" => {
            Some(constant_bool(left)? || constant_bool(right)?)
        }
        _ => None,
    }
}
