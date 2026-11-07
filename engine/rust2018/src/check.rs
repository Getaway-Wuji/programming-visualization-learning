use crate::source::ByteRange;
use crate::syntax::{Block, Expr, ExprKind, ForIter, Function, Program, Stmt, StmtKind, Type};
use crate::{Fault, Meter, charge};

type Result<T> = std::result::Result<T, Fault>;

#[derive(Clone)]
struct Variable {
    name: String,
    ty: Type,
    mutable: bool,
    moved: bool,
}

#[derive(Clone, Default)]
struct Environment {
    variables: Vec<Variable>,
    loans: Vec<(usize, bool)>,
    loop_boundaries: Vec<usize>,
}

impl Environment {
    fn position(&self, name: &str, range: ByteRange) -> Result<usize> {
        self.variables
            .iter()
            .rposition(|variable| variable.name == name)
            .ok_or_else(|| Fault::new("E_NAME", range))
    }

    fn declare(&mut self, name: String, ty: Type, mutable: bool, range: ByteRange) -> Result<()> {
        if self.variables.len() >= 128 {
            return Err(Fault::new("E_MEMORY_LIMIT", range));
        }
        self.variables.push(Variable {
            name,
            ty,
            mutable,
            moved: false,
        });
        Ok(())
    }

    fn available(&self, index: usize, range: ByteRange) -> Result<()> {
        if self.variables[index].moved {
            return Err(Fault::new("E_MOVED", range));
        }
        if self.loans.iter().any(|(target, _)| *target == index) {
            return Err(Fault::new("E_BORROW_CONFLICT", range));
        }
        Ok(())
    }

    fn name(&mut self, name: &str, range: ByteRange, consume: bool) -> Result<Type> {
        let index = self.position(name, range)?;
        self.available(index, range)?;
        let ty = self.variables[index].ty.clone();
        if consume && matches!(ty, Type::Ref(..)) {
            return Err(Fault::new("E_UNSUPPORTED", range));
        }
        if consume && ty == Type::String {
            if self
                .loop_boundaries
                .last()
                .is_some_and(|boundary| index < *boundary)
            {
                return Err(Fault::new("E_UNSUPPORTED", range));
            }
            self.variables[index].moved = true;
        }
        Ok(ty)
    }
}

struct ExpressionType {
    ty: Type,
    exits: bool,
}

impl ExpressionType {
    fn value(ty: Type) -> Self {
        Self { ty, exits: false }
    }
}

struct Checker<'a> {
    program: &'a Program,
    function: &'a Function,
    meter: &'a mut Meter,
    depth: usize,
}

pub(crate) fn check(program: &Program, meter: &mut Meter) -> Result<()> {
    let main = program
        .functions
        .get("main")
        .ok_or_else(|| Fault::new("E_ENTRY", crate::span(0, 0)))?;
    if !main.params.is_empty() || main.result != Type::Unit {
        return Err(Fault::new("E_ENTRY", main.range));
    }
    for function in program.functions.values() {
        if matches!(function.result, Type::Ref(..)) {
            return Err(Fault::new("E_UNSUPPORTED", function.range));
        }
        let mut environment = Environment::default();
        for parameter in &function.params {
            if environment
                .variables
                .iter()
                .any(|variable| variable.name == parameter.name)
            {
                return Err(Fault::new("E_NAME", parameter.range));
            }
            environment.declare(
                parameter.name.clone(),
                parameter.ty.clone(),
                parameter.mutable,
                parameter.range,
            )?;
        }
        let mut checker = Checker {
            program,
            function,
            meter,
            depth: 0,
        };
        let value = checker.block(&function.body, &mut environment, Some(&function.result))?;
        if !value.exits && value.ty != function.result {
            return Err(Fault::new("E_RETURN", function.body.range));
        }
    }
    Ok(())
}

impl Checker<'_> {
    fn expect(actual: &Type, expected: &Type, range: ByteRange) -> Result<()> {
        if actual == expected {
            Ok(())
        } else {
            Err(Fault::new("E_TYPE", range))
        }
    }

    fn block(
        &mut self,
        block: &Block,
        environment: &mut Environment,
        expected: Option<&Type>,
    ) -> Result<ExpressionType> {
        self.depth += 1;
        if self.depth > 256 {
            return Err(Fault::new("E_DEPTH_LIMIT", block.range));
        }
        let result = self.block_inner(block, environment, expected);
        self.depth -= 1;
        result
    }

    fn block_inner(
        &mut self,
        block: &Block,
        environment: &mut Environment,
        expected: Option<&Type>,
    ) -> Result<ExpressionType> {
        charge(self.meter, 1, block.range)?;
        let scope_start = environment.variables.len();
        let mut exits = false;
        for statement in &block.statements {
            exits |= self.statement(statement, environment)?;
        }
        let tail = if let Some(tail) = &block.tail {
            self.expression(tail, environment, expected, true)?
        } else {
            ExpressionType::value(Type::Unit)
        };
        environment.variables.truncate(scope_start);
        Ok(ExpressionType {
            ty: tail.ty,
            exits: exits || tail.exits,
        })
    }

    fn statement(&mut self, statement: &Stmt, environment: &mut Environment) -> Result<bool> {
        charge(self.meter, 1, statement.range)?;
        match &statement.kind {
            StmtKind::Let {
                name,
                mutable,
                annotation,
                value,
            } => {
                if annotation
                    .as_ref()
                    .is_some_and(|ty| matches!(ty, Type::Ref(..)))
                {
                    return Err(Fault::new("E_UNSUPPORTED", statement.range));
                }
                let result = self.expression(value, environment, annotation.as_ref(), true)?;
                if matches!(result.ty, Type::Ref(..)) {
                    return Err(Fault::new("E_UNSUPPORTED", value.range));
                }
                if let Some(annotation) = annotation {
                    Self::expect(&result.ty, annotation, value.range)?;
                }
                environment.declare(name.clone(), result.ty, *mutable, statement.range)?;
                Ok(result.exits)
            }
            StmtKind::Assign { target, value } => {
                self.assign(target, value, environment)?;
                Ok(false)
            }
            StmtKind::Expression(expression) => {
                let result = self.expression(expression, environment, None, true)?;
                if statement.range.end == expression.range.end
                    && result.ty != Type::Unit
                    && !result.exits
                {
                    return Err(Fault::new("E_TYPE", expression.range));
                }
                Ok(result.exits)
            }
            StmtKind::While(condition, body) => {
                environment
                    .loop_boundaries
                    .push(environment.variables.len());
                let result = (|| {
                    let condition =
                        self.expression(condition, environment, Some(&Type::Bool), true)?;
                    Self::expect(&condition.ty, &Type::Bool, body.range)?;
                    let branch = self.block(body, environment, Some(&Type::Unit))?;
                    if branch.ty != Type::Unit && !branch.exits {
                        return Err(Fault::new("E_TYPE", body.range));
                    }
                    Ok(false)
                })();
                environment.loop_boundaries.pop();
                result
            }
            StmtKind::Loop(body) => {
                environment
                    .loop_boundaries
                    .push(environment.variables.len());
                let result = self.block(body, environment, Some(&Type::Unit));
                environment.loop_boundaries.pop();
                let branch = result?;
                if branch.ty != Type::Unit && !branch.exits {
                    return Err(Fault::new("E_TYPE", body.range));
                }
                Ok(!block_breaks(body))
            }
            StmtKind::For { name, iter, body } => {
                match iter {
                    ForIter::Range { start, end, .. } => {
                        let first = self.expression(start, environment, Some(&Type::I32), true)?;
                        let last = self.expression(end, environment, Some(&Type::I32), true)?;
                        Self::expect(&first.ty, &Type::I32, start.range)?;
                        Self::expect(&last.ty, &Type::I32, end.range)?;
                    }
                    ForIter::Array(array) => {
                        let result = self.expression(array, environment, None, true)?;
                        if !matches!(result.ty, Type::Array(_)) {
                            return Err(Fault::new("E_TYPE", array.range));
                        }
                    }
                }
                let before = environment.variables.len();
                environment.loop_boundaries.push(before);
                environment.declare(name.clone(), Type::I32, false, statement.range)?;
                let result = self.block(body, environment, Some(&Type::Unit));
                environment.variables.truncate(before);
                environment.loop_boundaries.pop();
                let result = result?;
                if result.ty != Type::Unit && !result.exits {
                    return Err(Fault::new("E_TYPE", body.range));
                }
                Ok(false)
            }
            StmtKind::Return(value) => {
                let expected = self.function.result.clone();
                let result = if let Some(value) = value {
                    self.expression(value, environment, Some(&expected), true)?
                } else {
                    ExpressionType::value(Type::Unit)
                };
                if result.ty != expected && !result.exits {
                    return Err(Fault::new("E_RETURN", statement.range));
                }
                Ok(true)
            }
            StmtKind::Break | StmtKind::Continue => {
                if environment.loop_boundaries.is_empty() {
                    return Err(Fault::new("E_SYNTAX", statement.range));
                }
                Ok(true)
            }
            StmtKind::Print { format, args, .. } => {
                if placeholders(format, statement.range)? != args.len() {
                    return Err(Fault::new("E_ARITY", statement.range));
                }
                for argument in args {
                    let value = self.expression(argument, environment, None, false)?;
                    let printable = matches!(value.ty, Type::I32 | Type::Bool | Type::String)
                        || matches!(&value.ty, Type::Ref(_, ty) if matches!(**ty, Type::I32 | Type::String));
                    if !printable {
                        return Err(Fault::new("E_TYPE", argument.range));
                    }
                }
                Ok(false)
            }
            StmtKind::ReadLine(name) => {
                let index = environment.position(name, statement.range)?;
                environment.available(index, statement.range)?;
                if environment.variables[index].ty != Type::String {
                    return Err(Fault::new("E_TYPE", statement.range));
                }
                if !environment.variables[index].mutable {
                    return Err(Fault::new("E_IMMUTABLE", statement.range));
                }
                Ok(false)
            }
        }
    }

    fn assign(&mut self, target: &Expr, value: &Expr, environment: &mut Environment) -> Result<()> {
        let (index, ty, is_reference) = match &target.kind {
            ExprKind::Name(name) => {
                let index = environment.position(name, target.range)?;
                if environment.loans.iter().any(|(target, _)| *target == index) {
                    return Err(Fault::new("E_BORROW_CONFLICT", target.range));
                }
                (index, environment.variables[index].ty.clone(), false)
            }
            ExprKind::Index(array, _) => {
                let ExprKind::Name(name) = &array.kind else {
                    return Err(Fault::new("E_UNSUPPORTED", target.range));
                };
                let index = environment.position(name, target.range)?;
                environment.available(index, target.range)?;
                if !matches!(environment.variables[index].ty, Type::Array(_)) {
                    return Err(Fault::new("E_TYPE", array.range));
                }
                (index, Type::I32, false)
            }
            ExprKind::Unary(operator, operand) if operator == "*" => {
                let ExprKind::Name(name) = &operand.kind else {
                    return Err(Fault::new("E_UNSUPPORTED", target.range));
                };
                let index = environment.position(name, target.range)?;
                let Type::Ref(mutable, inner) = &environment.variables[index].ty else {
                    return Err(Fault::new("E_TYPE", target.range));
                };
                if !mutable {
                    return Err(Fault::new("E_BORROW_MUTABLE", target.range));
                }
                if **inner != Type::I32 {
                    return Err(Fault::new("E_UNSUPPORTED", target.range));
                }
                (index, Type::I32, true)
            }
            _ => return Err(Fault::new("E_UNSUPPORTED", target.range)),
        };
        if !is_reference && !environment.variables[index].mutable {
            return Err(Fault::new("E_IMMUTABLE", target.range));
        }
        if matches!(ty, Type::Ref(..)) {
            return Err(Fault::new("E_UNSUPPORTED", target.range));
        }
        let result = self.expression(value, environment, Some(&ty), true)?;
        Self::expect(&result.ty, &ty, value.range)?;
        environment.variables[index].moved = false;
        Ok(())
    }

    fn expression(
        &mut self,
        expression: &Expr,
        environment: &mut Environment,
        expected: Option<&Type>,
        consume: bool,
    ) -> Result<ExpressionType> {
        self.depth += 1;
        if self.depth > 256 {
            return Err(Fault::new("E_DEPTH_LIMIT", expression.range));
        }
        charge(self.meter, 1, expression.range)?;
        let result = self.expression_inner(expression, environment, expected, consume);
        self.depth -= 1;
        result
    }

    fn expression_inner(
        &mut self,
        expression: &Expr,
        environment: &mut Environment,
        expected: Option<&Type>,
        consume: bool,
    ) -> Result<ExpressionType> {
        let range = expression.range;
        let ty = match &expression.kind {
            ExprKind::Int(_) => Type::I32,
            ExprKind::Bool(_) => Type::Bool,
            ExprKind::Text(_) => return Err(Fault::new("E_UNSUPPORTED", range)),
            ExprKind::Name(name) => environment.name(name, range, consume)?,
            ExprKind::Unary(operator, operand) => {
                if operator == "*" {
                    let ExprKind::Name(name) = &operand.kind else {
                        return Err(Fault::new("E_UNSUPPORTED", range));
                    };
                    let ty = environment.name(name, range, false)?;
                    match ty {
                        Type::Ref(_, inner) if *inner == Type::I32 => Type::I32,
                        _ => return Err(Fault::new("E_TYPE", range)),
                    }
                } else {
                    let ty = if operator == "!" {
                        Type::Bool
                    } else {
                        Type::I32
                    };
                    let operand = self.expression(
                        operand,
                        environment,
                        expected.filter(|expected| **expected == ty),
                        true,
                    )?;
                    Self::expect(&operand.ty, &ty, range)?;
                    ty
                }
            }
            ExprKind::Binary(operator, left, right) => {
                let boolean = operator == "&&" || operator == "||";
                let left = self.expression(
                    left,
                    environment,
                    if boolean {
                        Some(&Type::Bool)
                    } else if matches!(operator.as_str(), "+" | "-" | "*" | "/" | "%") {
                        expected.filter(|expected| **expected == Type::I32)
                    } else {
                        None
                    },
                    true,
                )?;
                let right = self.expression(right, environment, Some(&left.ty), true)?;
                Self::expect(&right.ty, &left.ty, range)?;
                match operator.as_str() {
                    "&&" | "||" => {
                        Self::expect(&left.ty, &Type::Bool, range)?;
                        Type::Bool
                    }
                    "==" | "!=" => {
                        if !matches!(left.ty, Type::I32 | Type::Bool) {
                            return Err(Fault::new("E_TYPE", range));
                        }
                        Type::Bool
                    }
                    "<" | "<=" | ">" | ">=" => {
                        Self::expect(&left.ty, &Type::I32, range)?;
                        Type::Bool
                    }
                    _ => {
                        Self::expect(&left.ty, &Type::I32, range)?;
                        Type::I32
                    }
                }
            }
            ExprKind::Call(name, arguments) => {
                let function = self
                    .program
                    .functions
                    .get(name)
                    .ok_or_else(|| Fault::new("E_NAME", range))?;
                if function.params.len() != arguments.len() {
                    return Err(Fault::new("E_ARITY", range));
                }
                let borrowed_before = environment.loans.len();
                let result = (|| {
                    for (argument, parameter) in arguments.iter().zip(&function.params) {
                        let actual = match &parameter.ty {
                            Type::Ref(mutable, inner) => {
                                self.borrow(argument, *mutable, inner, environment)?
                            }
                            _ => {
                                if matches!(argument.kind, ExprKind::Borrow(..)) {
                                    return Err(Fault::new("E_TYPE", argument.range));
                                }
                                self.expression(argument, environment, Some(&parameter.ty), true)?
                                    .ty
                            }
                        };
                        Self::expect(&actual, &parameter.ty, argument.range)?;
                    }
                    Ok(function.result.clone())
                })();
                environment.loans.truncate(borrowed_before);
                result?
            }
            ExprKind::If(condition, yes, no) => {
                let condition = self.expression(condition, environment, Some(&Type::Bool), true)?;
                Self::expect(&condition.ty, &Type::Bool, range)?;
                let before = environment.clone();
                let mut yes_environment = before.clone();
                let yes = self.block(yes, &mut yes_environment, expected)?;
                let mut no_environment = before;
                let no = if let Some(no) = no {
                    self.expression(
                        no,
                        &mut no_environment,
                        expected.or(if yes.exits { None } else { Some(&yes.ty) }),
                        consume,
                    )?
                } else {
                    ExpressionType::value(Type::Unit)
                };
                for index in 0..environment.variables.len() {
                    environment.variables[index].moved = if yes.exits && !no.exits {
                        no_environment.variables[index].moved
                    } else if no.exits && !yes.exits {
                        yes_environment.variables[index].moved
                    } else {
                        yes_environment.variables[index].moved
                            || no_environment.variables[index].moved
                    };
                }
                if !yes.exits && !no.exits {
                    Self::expect(&yes.ty, &no.ty, range)?;
                }
                return Ok(ExpressionType {
                    ty: if yes.exits { no.ty } else { yes.ty },
                    exits: yes.exits && no.exits,
                });
            }
            ExprKind::Block(block) => return self.block(block, environment, expected),
            ExprKind::Array(values) => {
                for value in values {
                    let element = self.expression(value, environment, Some(&Type::I32), true)?;
                    Self::expect(&element.ty, &Type::I32, value.range)?;
                }
                Type::Array(values.len())
            }
            ExprKind::Repeat(value, length) => {
                let element = self.expression(value, environment, Some(&Type::I32), true)?;
                Self::expect(&element.ty, &Type::I32, value.range)?;
                Type::Array(*length)
            }
            ExprKind::Index(array, _) => {
                let array = self.expression(array, environment, None, false)?;
                if !matches!(array.ty, Type::Array(_)) {
                    return Err(Fault::new("E_TYPE", range));
                }
                Type::I32
            }
            ExprKind::Borrow(..) => return Err(Fault::new("E_UNSUPPORTED", range)),
            ExprKind::Method(receiver, method, arguments) => {
                self.method(receiver, method, arguments, environment, range)?
            }
            ExprKind::Parse(name) => {
                let ty = environment.name(name, range, false)?;
                if ty != Type::String {
                    return Err(Fault::new("E_TYPE", range));
                }
                let inferred = self
                    .program
                    .nodes
                    .get(expression.id as usize - 1)
                    .is_some_and(|node| node.kind == "parse-inferred");
                if inferred && expected != Some(&Type::I32) {
                    return Err(Fault::new("E_TYPE", range));
                }
                Type::I32
            }
            ExprKind::StringNew | ExprKind::StringFrom(_) => Type::String,
        };
        if let Some(expected) = expected {
            Self::expect(&ty, expected, range)?;
        }
        Ok(ExpressionType::value(ty))
    }

    fn borrow(
        &mut self,
        argument: &Expr,
        mutable: bool,
        expected: &Type,
        environment: &mut Environment,
    ) -> Result<Type> {
        let ExprKind::Borrow(actual_mutable, name) = &argument.kind else {
            return Err(Fault::new("E_UNSUPPORTED", argument.range));
        };
        if *actual_mutable != mutable {
            return Err(Fault::new("E_TYPE", argument.range));
        }
        let index = environment.position(name, argument.range)?;
        if environment.variables[index].moved {
            return Err(Fault::new("E_MOVED", argument.range));
        }
        let variable = &environment.variables[index];
        if matches!(variable.ty, Type::Ref(..)) {
            return Err(Fault::new("E_UNSUPPORTED", argument.range));
        }
        Self::expect(&variable.ty, expected, argument.range)?;
        if mutable && !variable.mutable {
            return Err(Fault::new("E_IMMUTABLE", argument.range));
        }
        if environment
            .loans
            .iter()
            .any(|(target, previous_mutable)| *target == index && (mutable || *previous_mutable))
        {
            return Err(Fault::new("E_BORROW_CONFLICT", argument.range));
        }
        environment.loans.push((index, mutable));
        Ok(Type::Ref(mutable, Box::new(expected.clone())))
    }

    fn method(
        &mut self,
        receiver: &Expr,
        method: &str,
        arguments: &[Expr],
        environment: &mut Environment,
        range: ByteRange,
    ) -> Result<Type> {
        let ExprKind::Name(name) = &receiver.kind else {
            return Err(Fault::new("E_UNSUPPORTED", receiver.range));
        };
        let index = environment.position(name, receiver.range)?;
        environment.available(index, receiver.range)?;
        let variable = &environment.variables[index];
        match method {
            "clone" => {
                if variable.ty != Type::String {
                    return Err(Fault::new("E_UNSUPPORTED", range));
                }
                if !arguments.is_empty() {
                    return Err(Fault::new("E_ARITY", range));
                }
                Ok(Type::String)
            }
            "push_str" | "clear" => {
                match &variable.ty {
                    Type::String if !variable.mutable => {
                        return Err(Fault::new("E_IMMUTABLE", receiver.range));
                    }
                    Type::String => {}
                    Type::Ref(mutable, inner) if **inner == Type::String => {
                        if !mutable {
                            return Err(Fault::new("E_BORROW_MUTABLE", receiver.range));
                        }
                    }
                    _ => return Err(Fault::new("E_TYPE", receiver.range)),
                }
                if method == "clear" {
                    if !arguments.is_empty() {
                        return Err(Fault::new("E_ARITY", range));
                    }
                } else if arguments.len() != 1 || !matches!(arguments[0].kind, ExprKind::Text(_)) {
                    return Err(Fault::new("E_UNSUPPORTED", range));
                }
                Ok(Type::Unit)
            }
            _ => Err(Fault::new("E_UNSUPPORTED", range)),
        }
    }
}

fn placeholders(format: &str, range: ByteRange) -> Result<usize> {
    let mut chars = format.chars();
    let mut count = 0;
    while let Some(c) = chars.next() {
        match c {
            '{' => match chars.next() {
                Some('{') => {}
                Some('}') => count += 1,
                _ => return Err(Fault::new("E_UNSUPPORTED", range)),
            },
            '}' if chars.next() != Some('}') => return Err(Fault::new("E_UNSUPPORTED", range)),
            _ => {}
        }
    }
    Ok(count)
}

fn block_breaks(block: &Block) -> bool {
    block
        .statements
        .iter()
        .any(|statement| match &statement.kind {
            StmtKind::Break => true,
            StmtKind::Expression(expression) => expression_breaks(expression),
            _ => false,
        })
        || block
            .tail
            .as_ref()
            .is_some_and(|expression| expression_breaks(expression))
}

fn expression_breaks(expression: &Expr) -> bool {
    match &expression.kind {
        ExprKind::If(_, yes, no) => {
            block_breaks(yes) || no.as_ref().is_some_and(|no| expression_breaks(no))
        }
        ExprKind::Block(block) => block_breaks(block),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn validate(source: &str) -> Result<()> {
        let mut meter = Meter::new();
        meter.set_clock(1000, Box::new(|| 0));
        let program = crate::syntax::parse(source, &mut meter)?;
        check(&program, &mut meter)
    }

    #[test]
    fn mutable_parameter_binding_and_mutable_referent_are_independent() {
        validate(
            r#"fn append(mut text: String) -> String { text.push_str("b"); text }
               fn bump(value: &mut i32) { *value = *value + 1; }
               fn main() { let mut n = 1; bump(&mut n); println!("{}", append(String::from("a"))); }"#,
        )
        .unwrap();
        let error =
            validate(r#"fn append(text: String) { text.clear(); } fn main() {}"#).unwrap_err();
        assert_eq!(error.code, "E_IMMUTABLE");
        let error =
            validate(r#"fn bump(mut value: &i32) { *value = 2; } fn main() {}"#).unwrap_err();
        assert_eq!(error.code, "E_BORROW_MUTABLE");
    }

    #[test]
    fn dead_branch_types_and_maybe_moved_bindings_are_checked() {
        assert_eq!(
            validate("fn main() { if false { let value: i32 = true; } }")
                .unwrap_err()
                .code,
            "E_TYPE"
        );
        assert_eq!(
            validate(r#"fn main() { let text = String::from("a"); if false { let moved = text; } println!("{}", text); }"#)
                .unwrap_err()
                .code,
            "E_MOVED"
        );
    }

    #[test]
    fn annotation_reaches_nested_parse_expression() {
        validate(
            r#"fn main() { let text = String::from("1"); let n: i32 = -text.trim().parse().unwrap() + 2; println!("{}", n); }"#,
        )
        .unwrap();
        assert_eq!(
            validate(r#"fn main() { let text = String::from("1"); let n = text.trim().parse().unwrap(); }"#)
                .unwrap_err()
                .code,
            "E_TYPE"
        );
    }

    #[test]
    fn semicolon_controls_if_statement_value_discard() {
        validate("fn main() { if true { 1 } else { 2 }; let n = 3; }").unwrap();
        assert_eq!(
            validate("fn main() { if true { 1 } else { 2 } let n = 3; }")
                .unwrap_err()
                .code,
            "E_TYPE"
        );
    }
}
