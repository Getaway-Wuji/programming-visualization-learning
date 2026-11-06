use crate::syntax::{Block, Expr, Expression, Node, Program, Statement, Type};
use crate::types;

pub(crate) fn map(program: &Program) -> Option<Vec<Node>> {
    if program.has_comments
        || program.scanner_import
        || !program.classes.is_empty()
        || program.methods.len() != 1
    {
        return None;
    }
    block(&program.methods["main"].body)?;
    Some(program.nodes.clone())
}

fn block(source: &Block) -> Option<()> {
    for statement in &source.item {
        match &statement.item {
            Statement::Let(Type::Int | Type::Long | Type::Bool | Type::String, _, value) => {
                expression(value)?
            }
            Statement::Assign(target, value) if matches!(target.item, Expression::Name(_)) => {
                expression(value)?
            }
            Statement::Call(call) => {
                let Expression::ReceiverCall(receiver, name, args) = &call.item else {
                    return None;
                };
                if !types::is_system_out(receiver) || !matches!(name.as_str(), "print" | "println")
                {
                    return None;
                }
                for arg in args {
                    expression(arg)?;
                }
            }
            Statement::If(test, yes, no) => {
                expression(test)?;
                block(yes)?;
                if let Some(no) = no {
                    let Statement::Block(no) = &no.item else {
                        return None;
                    };
                    block(no)?;
                }
            }
            Statement::While(test, body) => {
                expression(test)?;
                block(body)?;
            }
            _ => return None,
        }
    }
    Some(())
}

fn expression(expr: &Expr) -> Option<()> {
    match &expr.item {
        Expression::Int(_)
        | Expression::Long(_)
        | Expression::Bool(_)
        | Expression::String(_)
        | Expression::Name(_) => Some(()),
        Expression::Group(value) | Expression::Unary(_, value) => expression(value),
        Expression::Binary(_, left, right) => {
            expression(left)?;
            expression(right)
        }
        _ => None,
    }
}
