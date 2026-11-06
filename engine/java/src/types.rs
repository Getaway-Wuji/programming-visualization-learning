use std::collections::BTreeMap;

use crate::syntax::{self, Block, Expr, Expression, Node, Program, Statement, Stmt, Type};
use crate::{Fault, JavaResult, MAX_BINDINGS, Meter, charge};

pub(crate) struct Typed {
    expressions: BTreeMap<u32, Type>,
}

impl Typed {
    pub fn contains(&self, expr: &Expr) -> bool {
        self.expressions.contains_key(&expr.node.node_id)
    }

    pub fn of(&self, expr: &Expr) -> &Type {
        &self.expressions[&expr.node.node_id]
    }
}

pub(crate) fn check(program: &Program, meter: &mut Meter) -> JavaResult<Typed> {
    let mut checker = Checker {
        program,
        meter,
        types: BTreeMap::new(),
        scopes: Vec::new(),
        result: Type::Void,
        loop_depth: 0,
    };
    for class in program.classes.values() {
        for ty in class.fields.values() {
            checker.validate_type(ty, &class.node)?;
        }
    }
    for method in program.methods.values() {
        checker.validate_type(&method.result, &method.node)?;
        checker.result = method.result.clone();
        checker.scopes.push(BTreeMap::new());
        for (ty, name) in &method.params {
            checker.validate_type(ty, &method.node)?;
            checker.declare(name, ty, &method.node)?;
        }
        let returns = checker.block(&method.body)?;
        if method.result != Type::Void && !returns {
            return Err(fault("E_JAVA_RETURN", &method.node));
        }
        checker.scopes.pop();
    }
    Ok(Typed {
        expressions: checker.types,
    })
}

struct Checker<'a> {
    program: &'a Program,
    meter: &'a mut Meter,
    types: BTreeMap<u32, Type>,
    scopes: Vec<BTreeMap<String, Type>>,
    result: Type,
    loop_depth: usize,
}

fn fault(code: &'static str, node: &Node) -> Fault {
    Fault::new(code, node.byte_range, "type")
}

fn is_numeric(ty: &Type) -> bool {
    matches!(ty, Type::Int | Type::Long)
}

fn is_reference(ty: &Type) -> bool {
    matches!(
        ty,
        Type::String | Type::IntArray | Type::StringArray | Type::Class(_) | Type::Scanner
    )
}

fn is_printable(ty: &Type) -> bool {
    matches!(ty, Type::Bool | Type::Int | Type::Long | Type::String)
}

fn assignment(source: &Type, target: &Type) -> bool {
    source == target
        || matches!((source, target), (Type::Int, Type::Long))
        || *source == Type::Null && is_reference(target)
}

fn numeric_result(left: &Type, right: &Type) -> Type {
    if *left == Type::Long || *right == Type::Long {
        Type::Long
    } else {
        Type::Int
    }
}

impl Checker<'_> {
    fn validate_type(&self, ty: &Type, node: &Node) -> JavaResult<()> {
        match ty {
            Type::Class(name) if !self.program.classes.contains_key(name) => {
                Err(fault("E_JAVA_UNSUPPORTED", node))
            }
            Type::Scanner if !self.program.scanner_import => Err(fault("E_JAVA_UNSUPPORTED", node)),
            _ => Ok(()),
        }
    }

    fn declare(&mut self, name: &str, ty: &Type, node: &Node) -> JavaResult<()> {
        if self.lookup(name).is_some() {
            return Err(fault("E_JAVA_DUPLICATE", node));
        }
        if self.scopes.iter().map(BTreeMap::len).sum::<usize>() >= MAX_BINDINGS {
            return Err(fault("E_JAVA_UNSUPPORTED", node));
        }
        self.scopes
            .last_mut()
            .unwrap()
            .insert(name.to_owned(), ty.clone());
        Ok(())
    }

    fn lookup(&self, name: &str) -> Option<&Type> {
        self.scopes.iter().rev().find_map(|scope| scope.get(name))
    }

    fn block(&mut self, block: &Block) -> JavaResult<bool> {
        self.scopes.push(BTreeMap::new());
        let mut ended = false;
        for stmt in &block.item {
            if ended {
                return Err(fault("E_JAVA_UNREACHABLE", &stmt.node));
            }
            ended = self.statement(stmt)?;
        }
        self.scopes.pop();
        Ok(ended)
    }

    fn condition(&mut self, expr: &Expr) -> JavaResult<()> {
        if self.expression(expr)? != Type::Bool {
            return Err(fault("E_JAVA_TYPE", &expr.node));
        }
        Ok(())
    }

    fn statement(&mut self, stmt: &Stmt) -> JavaResult<bool> {
        let node = &stmt.node;
        charge(self.meter, 1, node.byte_range, "type")?;
        match &stmt.item {
            Statement::Block(block) => return self.block(block),
            Statement::Let(ty, name, init) => {
                self.validate_type(ty, node)?;
                let value = self.expression(init)?;
                if !assignment(&value, ty) {
                    return Err(fault("E_JAVA_TYPE", &init.node));
                }
                self.declare(name, ty, node)?;
            }
            Statement::Assign(target, value) => {
                let target_type = self.expression(target)?;
                match &target.item {
                    Expression::Name(_) | Expression::Index(..) => {}
                    Expression::Field(owner, _)
                        if matches!(self.types[&owner.node.node_id], Type::Class(_)) => {}
                    _ => return Err(fault("E_JAVA_TYPE", &target.node)),
                }
                if !assignment(&self.expression(value)?, &target_type) {
                    return Err(fault("E_JAVA_TYPE", &value.node));
                }
            }
            Statement::Increment(name, _) => {
                let ty = self
                    .lookup(name)
                    .ok_or_else(|| fault("E_JAVA_NAME", node))?;
                if !is_numeric(ty) {
                    return Err(fault("E_JAVA_TYPE", node));
                }
            }
            Statement::Call(expr) => {
                self.expression(expr)?;
            }
            Statement::If(cond, body, alternate) => {
                self.condition(cond)?;
                let yes = self.block(body)?;
                let no = alternate
                    .as_ref()
                    .map(|stmt| self.statement(stmt))
                    .transpose()?
                    .unwrap_or(false);
                return Ok(yes && no);
            }
            Statement::While(cond, body) => {
                self.condition(cond)?;
                self.loop_depth += 1;
                self.block(body)?;
                self.loop_depth -= 1;
            }
            Statement::For {
                init,
                test,
                update,
                body,
            } => {
                self.scopes.push(BTreeMap::new());
                if let Some(init) = init {
                    self.statement(init)?;
                }
                if let Some(test) = test {
                    self.condition(test)?;
                }
                if let Some(update) = update {
                    self.statement(update)?;
                }
                self.loop_depth += 1;
                self.block(body)?;
                self.loop_depth -= 1;
                self.scopes.pop();
            }
            Statement::Return(expr) => {
                if let Some(expr) = expr {
                    let ty = self.expression(expr)?;
                    if ty == Type::Void || !assignment(&ty, &self.result) {
                        return Err(fault("E_JAVA_RETURN", &expr.node));
                    }
                } else if self.result != Type::Void {
                    return Err(fault("E_JAVA_RETURN", node));
                }
                return Ok(true);
            }
            Statement::Break | Statement::Continue => {
                if self.loop_depth == 0 {
                    return Err(fault("E_JAVA_CONTROL", node));
                }
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn expression(&mut self, expr: &Expr) -> JavaResult<Type> {
        use Expression::*;
        let node = &expr.node;
        charge(self.meter, 1, node.byte_range, "type")?;
        let result = match &expr.item {
            Int(_) => Type::Int,
            Long(_) => Type::Long,
            Bool(_) => Type::Bool,
            String(_) => Type::String,
            Null => Type::Null,
            Name(name) => self.lookup(name).cloned().ok_or_else(|| {
                fault(
                    if syntax::library_name(name) {
                        "E_JAVA_UNSUPPORTED"
                    } else {
                        "E_JAVA_NAME"
                    },
                    node,
                )
            })?,
            Group(value) => self.expression(value)?,
            Unary(op, value) => {
                let ty = self.expression(value)?;
                if (*op == "!" && ty == Type::Bool) || (*op != "!" && is_numeric(&ty)) {
                    ty
                } else {
                    return Err(fault("E_JAVA_TYPE", node));
                }
            }
            Cast(ty, value) => {
                if !is_numeric(&self.expression(value)?) {
                    return Err(fault("E_JAVA_TYPE", node));
                }
                ty.clone()
            }
            Binary(op, left, right) => {
                let l = self.expression(left)?;
                let r = self.expression(right)?;
                binary(op, &l, &r).ok_or_else(|| fault("E_JAVA_TYPE", node))?
            }
            Index(value, index) => {
                let owner = self.expression(value)?;
                if self.expression(index)? != Type::Int {
                    return Err(fault("E_JAVA_TYPE", &index.node));
                }
                match owner {
                    Type::IntArray => Type::Int,
                    Type::StringArray => Type::String,
                    _ => return Err(fault("E_JAVA_TYPE", &value.node)),
                }
            }
            Field(value, field) => match self.expression(value)? {
                Type::IntArray | Type::StringArray if field == "length" => Type::Int,
                Type::Class(class) => self.program.classes[&class]
                    .fields
                    .get(field)
                    .cloned()
                    .ok_or_else(|| fault("E_JAVA_NAME", node))?,
                _ => return Err(fault("E_JAVA_UNSUPPORTED", node)),
            },
            Call(name, args) => self.call(name, args, node)?,
            ReceiverCall(receiver, name, args) => self.receiver(receiver, name, args, node)?,
            NewArray(ty, length) => {
                if self.expression(length)? != Type::Int {
                    return Err(fault("E_JAVA_TYPE", &length.node));
                }
                ty.clone()
            }
            NewClass(name) => {
                let ty = Type::Class(name.clone());
                self.validate_type(&ty, node)?;
                ty
            }
            NewScanner => {
                self.validate_type(&Type::Scanner, node)?;
                if self.lookup("System").is_some() {
                    return Err(fault("E_JAVA_UNSUPPORTED", node));
                }
                Type::Scanner
            }
        };
        self.types.insert(node.node_id, result.clone());
        Ok(result)
    }

    fn call(&mut self, name: &str, args: &[Expr], node: &Node) -> JavaResult<Type> {
        let Some(method) = self.program.methods.get(name) else {
            return Err(fault("E_JAVA_NAME", node));
        };
        if args.len() != method.params.len() {
            return Err(fault("E_JAVA_TYPE", node));
        }
        for (arg, (ty, _)) in args.iter().zip(&method.params) {
            if !assignment(&self.expression(arg)?, ty) {
                return Err(fault("E_JAVA_TYPE", &arg.node));
            }
        }
        Ok(method.result.clone())
    }

    fn receiver(
        &mut self,
        receiver: &Expr,
        name: &str,
        args: &[Expr],
        node: &Node,
    ) -> JavaResult<Type> {
        if is_system_out(receiver) && self.lookup("System").is_none() {
            return match (name, args) {
                ("println", []) => Ok(Type::Void),
                ("print" | "println", [arg]) => {
                    if !is_printable(&self.expression(arg)?) {
                        return Err(fault("E_JAVA_TYPE", &arg.node));
                    }
                    Ok(Type::Void)
                }
                _ => Err(fault("E_JAVA_UNSUPPORTED", node)),
            };
        }
        if matches!(&receiver.item, Expression::Name(owner) if owner == &self.program.name && self.lookup(owner).is_none())
        {
            return self.call(name, args, node);
        }
        let ty = self.expression(receiver)?;
        match (&ty, name, args) {
            (Type::String, "length", []) => Ok(Type::Int),
            (Type::String, "equals", [arg]) => {
                if !assignment(&self.expression(arg)?, &Type::String) {
                    return Err(fault("E_JAVA_TYPE", &arg.node));
                }
                Ok(Type::Bool)
            }
            (Type::Scanner, "nextInt", []) => Ok(Type::Int),
            (Type::Scanner, "nextLong", []) => Ok(Type::Long),
            (Type::Scanner, "nextLine", []) => Ok(Type::String),
            _ => Err(fault("E_JAVA_UNSUPPORTED", node)),
        }
    }
}

pub(crate) fn is_system_out(receiver: &Expr) -> bool {
    matches!(&receiver.item, Expression::Field(owner, field)
        if field == "out" && matches!(&owner.item, Expression::Name(name) if name == "System"))
}

fn binary(op: &str, left: &Type, right: &Type) -> Option<Type> {
    let numbers = is_numeric(left) && is_numeric(right);
    match op {
        "&&" | "||" if *left == Type::Bool && *right == Type::Bool => Some(Type::Bool),
        "==" | "!="
            if numbers
                || *left == Type::Bool && *right == Type::Bool
                || *left == Type::Null && (*right == Type::Null || is_reference(right))
                || *right == Type::Null && is_reference(left)
                || left == right && *left != Type::String && is_reference(left) =>
        {
            Some(Type::Bool)
        }
        "<" | "<=" | ">" | ">=" if numbers => Some(Type::Bool),
        "+" if (*left == Type::String || *right == Type::String)
            && (is_printable(left) || *left == Type::Null)
            && (is_printable(right) || *right == Type::Null) =>
        {
            Some(Type::String)
        }
        "+" | "-" | "*" | "/" | "%" if numbers => Some(numeric_result(left, right)),
        _ => None,
    }
}
