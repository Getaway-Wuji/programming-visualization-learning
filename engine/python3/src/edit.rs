use crate::parser::{Expr, ExprKind, Node, Program, Stmt, StmtKind};

pub(crate) fn map(program: &Program) -> Option<Vec<Node>> {
    if program.has_comments {
        return None;
    }
    let mut map = Vec::new();
    block(&program.statements, &mut map)?;
    map.sort_by_key(|node| node.node_id);
    Some(map)
}

fn block(statements: &[Stmt], map: &mut Vec<Node>) -> Option<()> {
    for statement in statements {
        map.push(statement.node);
        match &statement.kind {
            StmtKind::Assign(target, "=", value) if matches!(target.kind, ExprKind::Name(_)) => {
                expression(target, map)?;
                expression(value, map)?;
            }
            StmtKind::Eval(call) => {
                let ExprKind::Call(callee, args) = &call.kind else {
                    return None;
                };
                if !matches!(&callee.kind, ExprKind::Name(name) if name == "print")
                    || !args.keywords.is_empty()
                {
                    return None;
                }
                map.push(call.node);
                expression(callee, map)?;
                for argument in &args.positional {
                    expression(argument, map)?;
                }
            }
            StmtKind::If(arms, otherwise) if arms.len() == 1 => {
                expression(&arms[0].0, map)?;
                block(&arms[0].1, map)?;
                block(otherwise, map)?;
            }
            StmtKind::While(condition, body) => {
                expression(condition, map)?;
                block(body, map)?;
            }
            StmtKind::For(_, range, body) => {
                let ExprKind::Call(callee, args) = &range.kind else {
                    return None;
                };
                if !(1..=3).contains(&args.positional.len()) {
                    return None;
                }
                map.push(range.node);
                expression(callee, map)?;
                for argument in &args.positional {
                    expression(argument, map)?;
                }
                block(body, map)?;
            }
            StmtKind::Pass => {}
            _ => return None,
        }
    }
    Some(())
}

fn expression(expr: &Expr, map: &mut Vec<Node>) -> Option<()> {
    map.push(expr.node);
    match &expr.kind {
        ExprKind::None
        | ExprKind::Bool(_)
        | ExprKind::Int(_)
        | ExprKind::Float(_)
        | ExprKind::Text(_)
        | ExprKind::Name(_) => {}
        ExprKind::Group(inner) | ExprKind::Unary(_, inner) => expression(inner, map)?,
        ExprKind::Binary(_, left, right) => {
            expression(left, map)?;
            expression(right, map)?;
        }
        ExprKind::Compare(first, chain) if chain.len() == 1 => {
            expression(first, map)?;
            expression(&chain[0].1, map)?;
        }
        _ => return None,
    }
    Some(())
}
