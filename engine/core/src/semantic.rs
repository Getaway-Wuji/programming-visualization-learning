//! Static P0-C checks over the one parser-produced AST, without execution.
//!
//! All source paths are checked, including dead branches, short-circuit right
//! operands and text after return. References identify declarations rather than
//! runtime objects. No initialization, array bounds or arithmetic is evaluated.

use crate::ast::{Expression, Initializer, NodeData, NodeId};
use crate::budget::{Meter, TimingPhase};
use crate::diagnostic::{Diagnostic, DiagnosticCode, Location, Stage};
use crate::format::{CompiledFormat, FormatError, compile_format, compile_format_metered};
use crate::parser::{self, Parsed};
use crate::source::ByteRange;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectType {
    Int,
    IntArray { length: i32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeclarationInfo {
    pub node_id: NodeId,
    pub name: String,
    pub object_type: ObjectType,
    /// Static block/for node; this is not a dynamic STEP scope identifier.
    pub scope_node: NodeId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedReference {
    pub expression_node: NodeId,
    pub declaration_node: NodeId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedOutput {
    pub output_node: NodeId,
    pub format: CompiledFormat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedProgram {
    pub parsed: Parsed,
    pub declarations: Vec<DeclarationInfo>,
    pub references: Vec<ResolvedReference>,
    pub outputs: Vec<CheckedOutput>,
    /// Successful prior-phase cost plus semantic node/scope visits and decoded
    /// format bytes. Not complete run fuel: failed work, map comparisons,
    /// mapping/encoding and deadline checks are integrated in task 06.4.
    pub fuel_used: usize,
}

pub fn analyze(source: &str) -> Result<CheckedProgram, Diagnostic> {
    Checker::new(parser::parse(source)?, None).check()
}

pub fn analyze_bytes(source: &[u8]) -> Result<CheckedProgram, Diagnostic> {
    Checker::new(parser::parse_bytes(source)?, None).check()
}

/// Use the same meter from source decoding through execution and encoding.
pub fn analyze_metered(source: &str, meter: &mut Meter) -> Result<CheckedProgram, Diagnostic> {
    let parsed = parser::parse_metered(source, meter)?;
    meter.measure(TimingPhase::Semantic, |meter| {
        Checker::new(parsed, Some(meter)).check()
    })
}

pub fn analyze_bytes_metered(
    source: &[u8],
    meter: &mut Meter,
) -> Result<CheckedProgram, Diagnostic> {
    let parsed = parser::parse_bytes_metered(source, meter)?;
    meter.measure(TimingPhase::Semantic, |meter| {
        Checker::new(parsed, Some(meter)).check()
    })
}

struct Scope {
    node: NodeId,
    declarations: Vec<(String, usize)>,
}

enum Work {
    Visit(NodeId),
    LeaveScope,
    LeaveLoop,
}

#[derive(Clone, Copy)]
enum Required {
    Int,
    Array,
}

struct Checker<'m> {
    meter: Option<&'m mut Meter>,
    parsed: Parsed,
    scopes: Vec<Scope>,
    loop_depth: usize,
    declarations: Vec<DeclarationInfo>,
    references: Vec<ResolvedReference>,
    outputs: Vec<CheckedOutput>,
    work: usize,
}

impl<'m> Checker<'m> {
    fn new(parsed: Parsed, meter: Option<&'m mut Meter>) -> Self {
        Self {
            meter,
            parsed,
            scopes: Vec::new(),
            loop_depth: 0,
            declarations: Vec::new(),
            references: Vec::new(),
            outputs: Vec::new(),
            work: 0,
        }
    }

    fn charge(&mut self, units: usize, range: ByteRange) -> Result<(), Diagnostic> {
        if let Some(meter) = self.meter.as_deref_mut() {
            meter.charge(units).map_err(|error| {
                error.diagnostic(Stage::Semantic, Location::Source { byte_range: range })
            })?;
        }
        Ok(())
    }

    // Sorted-vector binary search makes every key comparison visible to the
    // run meter; library BTreeMap comparison callbacks cannot propagate errors.
    fn lookup(
        &mut self,
        scope: usize,
        name: &str,
        range: ByteRange,
    ) -> Result<Result<usize, usize>, Diagnostic> {
        let mut low = 0;
        let mut high = self.scopes[scope].declarations.len();
        while low < high {
            self.charge(1, range)?;
            let middle = low + (high - low) / 2;
            match self.scopes[scope].declarations[middle].0.as_str().cmp(name) {
                std::cmp::Ordering::Less => low = middle + 1,
                std::cmp::Ordering::Greater => high = middle,
                std::cmp::Ordering::Equal => return Ok(Ok(middle)),
            }
        }
        Ok(Err(low))
    }

    fn check(mut self) -> Result<CheckedProgram, Diagnostic> {
        self.charge(
            1,
            self.parsed.program.nodes[self.parsed.program.root].byte_range,
        )?;
        let mut pending = vec![Work::Visit(self.parsed.program.root)];
        while let Some(task) = pending.pop() {
            self.charge(
                1,
                self.parsed.program.nodes[self.parsed.program.root].byte_range,
            )?;
            self.work += 1;
            let id = match task {
                Work::LeaveScope => {
                    self.scopes.pop().expect("balanced static scope");
                    continue;
                }
                Work::LeaveLoop => {
                    self.loop_depth -= 1;
                    continue;
                }
                Work::Visit(id) => id,
            };
            // Only parser-produced arenas enter this private checker. Cloning
            // one flat record lets scope operations mutate independent state.
            self.charge(
                self.parsed.program.nodes[id].data.entry_weight(),
                self.parsed.program.nodes[id].byte_range,
            )?;
            let data = self.parsed.program.nodes[id].data.clone();
            match data {
                NodeData::Function { body } => pending.push(Work::Visit(body)),
                NodeData::Block { statements } => {
                    self.enter_scope(id)?;
                    pending.push(Work::LeaveScope);
                    pending.extend(statements.into_iter().rev().map(Work::Visit));
                }
                NodeData::Declaration {
                    name,
                    name_range,
                    array_length,
                    initializer,
                } => {
                    self.declaration(id, name, name_range, array_length, initializer)?;
                }
                NodeData::Assignment { target, value } => {
                    self.expression(target, Required::Int)?;
                    self.expression(value, Required::Int)?;
                }
                NodeData::If {
                    condition,
                    then_block,
                    else_block,
                } => {
                    if let Some(block) = else_block {
                        pending.push(Work::Visit(block));
                    }
                    pending.push(Work::Visit(then_block));
                    pending.push(Work::Visit(condition));
                }
                NodeData::While { condition, body } => {
                    self.loop_depth += 1;
                    pending.push(Work::LeaveLoop);
                    pending.push(Work::Visit(body));
                    pending.push(Work::Visit(condition));
                }
                NodeData::For {
                    init,
                    condition,
                    update,
                    body,
                } => {
                    self.enter_scope(id)?;
                    self.loop_depth += 1;
                    pending.push(Work::LeaveScope);
                    pending.push(Work::LeaveLoop);
                    pending.push(Work::Visit(body));
                    if let Some(id) = update {
                        pending.push(Work::Visit(id));
                    }
                    if let Some(id) = condition {
                        pending.push(Work::Visit(id));
                    }
                    if let Some(id) = init {
                        pending.push(Work::Visit(id));
                    }
                }
                NodeData::Condition { expression } | NodeData::Return { value: expression } => {
                    self.expression(expression, Required::Int)?;
                }
                NodeData::Output {
                    format,
                    format_range,
                    arguments,
                } => {
                    self.work += format.len();
                    let compiled = match self.meter.as_deref_mut() {
                        Some(meter) => {
                            compile_format_metered(&format, arguments.len(), meter, format_range)?
                        }
                        None => compile_format(&format, arguments.len()),
                    };
                    // Inspect format syntax first; if only the arity differs,
                    // check argument names/types left-to-right before arity.
                    if matches!(
                        compiled,
                        Err(FormatError::InvalidSpecifier | FormatError::Nul)
                    ) {
                        return Err(Self::format_error(format_range));
                    }
                    for argument in arguments {
                        self.expression(argument, Required::Int)?;
                    }
                    let format = compiled.map_err(|_| Self::format_error(format_range))?;
                    self.charge(1, self.parsed.program.nodes[id].byte_range)?;
                    self.outputs.push(CheckedOutput {
                        output_node: id,
                        format,
                    });
                }
                NodeData::Break | NodeData::Continue if self.loop_depth == 0 => {
                    return Err(self.error(
                        id,
                        DiagnosticCode::UnsupportedSyntax,
                        "jump inside an enclosing loop",
                    ));
                }
                NodeData::Break | NodeData::Continue | NodeData::Empty => {}
                NodeData::Expr(_) => {
                    unreachable!("expressions belong to checked statement contexts")
                }
            }
        }
        debug_assert!(self.scopes.is_empty() && self.loop_depth == 0);
        let fuel_used = self.parsed.fuel_used + self.work;
        Ok(CheckedProgram {
            parsed: self.parsed,
            declarations: self.declarations,
            references: self.references,
            outputs: self.outputs,
            fuel_used,
        })
    }

    fn enter_scope(&mut self, node: NodeId) -> Result<(), Diagnostic> {
        self.charge(1, self.parsed.program.nodes[node].byte_range)?;
        self.scopes.push(Scope {
            node,
            declarations: Vec::new(),
        });
        Ok(())
    }

    fn error(&self, id: NodeId, code: DiagnosticCode, expected: &'static str) -> Diagnostic {
        Diagnostic::semantic(code, self.parsed.program.nodes[id].byte_range, expected)
    }

    fn format_error(range: ByteRange) -> Diagnostic {
        Diagnostic::semantic(
            DiagnosticCode::FormatInvalid,
            range,
            "printf %d and %% with matching integer arguments",
        )
    }

    fn declaration(
        &mut self,
        id: NodeId,
        name: String,
        range: ByteRange,
        array_length: Option<i32>,
        initializer: Initializer,
    ) -> Result<(), Diagnostic> {
        if invalid_name(&name) {
            return Err(Diagnostic::semantic(
                DiagnosticCode::NameInvalid,
                range,
                "nonreserved ASCII object identifier",
            ));
        }
        let scope_index = self.scopes.len() - 1;
        let insertion = match self.lookup(scope_index, &name, range)? {
            Ok(_) => {
                return Err(Diagnostic::semantic(
                    DiagnosticCode::NameInvalid,
                    range,
                    "unique object name in this scope",
                ));
            }
            Err(position) => position,
        };
        let object_type = match array_length {
            Some(length) if length <= 0 => {
                return Err(self.error(
                    id,
                    DiagnosticCode::TypeInvalid,
                    "positive fixed array length",
                ));
            }
            Some(length) => ObjectType::IntArray { length },
            None => ObjectType::Int,
        };
        if let (Some(length), Initializer::Array(values)) = (array_length, &initializer)
            && values.len() > length as usize
        {
            return Err(self.error(
                id,
                DiagnosticCode::TypeInvalid,
                "initializer count within array capacity",
            ));
        }
        let index = self.declarations.len();
        self.charge(
            1 + name.len().div_ceil(64) + self.scopes[scope_index].declarations.len() - insertion,
            range,
        )?;
        self.declarations.push(DeclarationInfo {
            node_id: id,
            name: name.clone(),
            object_type,
            scope_node: self.scopes[scope_index].node,
        });
        self.scopes[scope_index]
            .declarations
            .insert(insertion, (name, index));
        // The declaration is visible to its initializer, including a shadowing
        // self-reference. Reading its uninitialized value is a runtime issue.
        match initializer {
            Initializer::None => {}
            Initializer::Scalar(value) => self.expression(value, Required::Int)?,
            Initializer::Array(values) => {
                for value in values {
                    self.expression(value, Required::Int)?;
                }
            }
        }
        Ok(())
    }

    fn resolve(&mut self, id: NodeId, name: &str) -> Result<ObjectType, Diagnostic> {
        for scope_index in (0..self.scopes.len()).rev() {
            self.charge(1, self.parsed.program.nodes[id].byte_range)?;
            self.work += 1;
            if let Ok(position) =
                self.lookup(scope_index, name, self.parsed.program.nodes[id].byte_range)?
            {
                self.charge(1, self.parsed.program.nodes[id].byte_range)?;
                let index = self.scopes[scope_index].declarations[position].1;
                let declaration = &self.declarations[index];
                self.references.push(ResolvedReference {
                    expression_node: id,
                    declaration_node: declaration.node_id,
                });
                return Ok(declaration.object_type);
            }
        }
        Err(self.error(
            id,
            DiagnosticCode::NameInvalid,
            "object declared and visible before this reference",
        ))
    }

    fn expression(&mut self, root: NodeId, required: Required) -> Result<(), Diagnostic> {
        self.charge(1, self.parsed.program.nodes[root].byte_range)?;
        let mut pending = vec![(root, required)];
        while let Some((id, required)) = pending.pop() {
            self.charge(
                self.parsed.program.nodes[id].data.entry_weight(),
                self.parsed.program.nodes[id].byte_range,
            )?;
            self.work += 1;
            let expression = match &self.parsed.program.nodes[id].data {
                NodeData::Expr(expression) => expression.clone(),
                _ => unreachable!("parser expression edge targets an expression"),
            };
            if let Expression::Name(name) = expression {
                let object_type = self.resolve(id, &name)?;
                if !matches!(
                    (required, object_type),
                    (Required::Int, ObjectType::Int)
                        | (Required::Array, ObjectType::IntArray { .. })
                ) {
                    return Err(self.error(
                        id,
                        DiagnosticCode::TypeInvalid,
                        "integer value or target; array only as indexing base",
                    ));
                }
                continue;
            }
            if matches!(required, Required::Array) {
                return Err(self.error(
                    id,
                    DiagnosticCode::TypeInvalid,
                    "array object as indexing base",
                ));
            }
            match expression {
                Expression::Integer(_) => {}
                Expression::Unary { operand, .. } => pending.push((operand, Required::Int)),
                Expression::Binary { left, right, .. } => {
                    pending.push((right, Required::Int));
                    pending.push((left, Required::Int));
                }
                Expression::Index { array, index } => {
                    pending.push((index, Required::Int));
                    pending.push((array, Required::Array));
                }
                Expression::Name(_) => unreachable!(),
            }
        }
        Ok(())
    }
}

fn invalid_name(name: &str) -> bool {
    name == "main"
        || name == "printf"
        || name.starts_with("__")
        || (name.starts_with('_') && name.as_bytes().get(1).is_some_and(u8::is_ascii_uppercase))
}
