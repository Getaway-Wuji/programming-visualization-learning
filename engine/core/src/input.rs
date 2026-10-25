//! CONTENT-01 input instantiation over the real P0-C AST.
//!
//! Callers supply entities from the already validated content package. This
//! boundary checks their input-relevant structure and exact references again;
//! it is not a replacement for full package/schema/duplicate-JSON-key checks.
//! Only controlled declarations in main's input prefix are replaced. The
//! returned source is the complete source checked and consumed by execution.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::ast::{Expression, Initializer, NodeData, NodeId, UnaryOp};
use crate::budget::Meter;
use crate::diagnostic::{Diagnostic, DiagnosticCode, Location, Stage};
use crate::semantic::{CheckedProgram, analyze, analyze_metered};
use crate::source::ByteRange;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingMapEntry {
    pub binding_key: String,
    pub byte_range: ByteRange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedBinding {
    pub binding_key: String,
    pub declaration_node: NodeId,
    pub byte_range: ByteRange,
}

/// One replaced declaration; all bytes between edits are preserved verbatim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceEdit {
    pub original_range: ByteRange,
    pub generated_range: ByteRange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedProgram {
    source: String,
    checked: CheckedProgram,
    bindings: Vec<ResolvedBinding>,
    edits: Vec<SourceEdit>,
}

impl PreparedProgram {
    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn checked(&self) -> &CheckedProgram {
        &self.checked
    }

    pub fn bindings(&self) -> &[ResolvedBinding] {
        &self.bindings
    }

    pub fn edits(&self) -> &[SourceEdit] {
        &self.edits
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldKind {
    Integer,
    Sequence { min_items: usize, max_items: usize },
}

struct Field<'a> {
    key: &'a str,
    kind: FieldKind,
    min: i32,
    max: i32,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Relation<'a> {
    Length { field: &'a str, target: &'a str },
    Index { field: &'a str, target: &'a str },
    Nondecreasing { field: &'a str },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BindingKind {
    Scalar,
    Array,
    Length,
}

struct Binding<'a> {
    key: &'a str,
    input: &'a str,
    name: &'a str,
    kind: BindingKind,
}

struct Configuration<'a> {
    fields: Vec<Field<'a>>,
    relations: Vec<Relation<'a>>,
    bindings: Vec<Binding<'a>>,
    example: &'a Value,
    source: &'a str,
    loop_count: bool,
}

fn charge(meter: &mut Option<&mut Meter>, units: usize) -> Result<(), Diagnostic> {
    if let Some(meter) = meter.as_deref_mut() {
        meter.charge(units).map_err(|error| {
            error.diagnostic(
                Stage::Semantic,
                Location::Synthetic {
                    reason: "pre-execution",
                },
            )
        })?;
    }
    Ok(())
}

// Visit external Value trees before configuration processing. Child vectors are
// paid before growth, including malformed/oversized metadata and failed runs.
fn inspect_json(value: &Value, meter: &mut Option<&mut Meter>) -> Result<(), Diagnostic> {
    if meter.is_none() {
        return Ok(());
    }
    charge(meter, 1)?;
    let mut pending = vec![(value, 1usize)];
    while let Some((value, depth)) = pending.pop() {
        charge(meter, 1)?;
        if depth > 32 {
            return Err(content());
        }
        match value {
            Value::Array(values) => {
                charge(meter, values.len())?;
                pending.extend(values.iter().map(|value| (value, depth + 1)));
            }
            Value::Object(values) => {
                charge(meter, values.len())?;
                for (key, value) in values {
                    charge(meter, key.len().div_ceil(64) + 1)?;
                    pending.push((value, depth + 1));
                }
            }
            Value::String(text) => {
                charge(meter, text.len().div_ceil(64))?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn checked_source(
    source: &str,
    meter: &mut Option<&mut Meter>,
) -> Result<CheckedProgram, Diagnostic> {
    match meter.as_deref_mut() {
        Some(meter) => analyze_metered(source, meter),
        None => analyze(source),
    }
}

fn rejected(code: DiagnosticCode, expected: &'static str) -> Diagnostic {
    Diagnostic::preflight(code, expected)
}

fn content() -> Diagnostic {
    rejected(
        DiagnosticCode::ContentMismatch,
        "current CONTENT-01 input configuration and exact references",
    )
}

fn binding_error() -> Diagnostic {
    rejected(
        DiagnosticCode::BindingInvalid,
        "unique original main-prefix input declarations and matching initialization",
    )
}

fn invalid_input() -> Diagnostic {
    rejected(
        DiagnosticCode::InputInvalid,
        "exact required integer inputs within configured domains and relations",
    )
}

fn object<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, Diagnostic> {
    let object = value.as_object().ok_or_else(content)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(content());
    }
    Ok(object)
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Diagnostic> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(content)
}

fn integer(value: &Value) -> Option<i32> {
    value.as_i64().and_then(|n| i32::try_from(n).ok())
}

fn field_key(key: &str) -> bool {
    let mut bytes = key.bytes();
    bytes.next().is_some_and(|c| c.is_ascii_lowercase()) && bytes.all(|c| c.is_ascii_alphanumeric())
}

fn stable_id(id: &str) -> bool {
    if id.len() > 96 {
        return false;
    }
    let mut parts = id.split('.');
    let valid = |part: &str| {
        !part.is_empty()
            && part.split('-').all(|piece| {
                !piece.is_empty()
                    && piece
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            })
    };
    parts.next().is_some_and(|part| {
        !part.contains('-')
            && part.bytes().next().is_some_and(|c| c.is_ascii_lowercase())
            && valid(part)
    }) && parts.clone().next().is_some()
        && parts.all(valid)
}

fn exact_ref(value: &Value, id: &str) -> Result<(), Diagnostic> {
    object(value, &["id", "version"])?;
    if value["id"] != id || value["version"] != "1.0.0" {
        return Err(content());
    }
    Ok(())
}

impl<'a> Configuration<'a> {
    fn read(
        program: &'a Value,
        spec: &'a Value,
        meter: &mut Option<&mut Meter>,
    ) -> Result<Self, Diagnostic> {
        inspect_json(program, meter)?;
        inspect_json(spec, meter)?;
        object(spec, &["id", "version", "title", "fields", "relations"])?;
        object(
            program,
            &[
                "id",
                "version",
                "title",
                "languageRef",
                "subsetRef",
                "inputRef",
                "exampleInput",
                "sourceExample",
                "bindings",
                "blockRefs",
                "reference",
            ],
        )?;
        if !stable_id(text(spec, "id")?)
            || !stable_id(text(program, "id")?)
            || spec["version"] != "1.0.0"
            || !(program["version"] == "1.0.0"
                || (program["version"] == "1.0.1"
                    && matches!(
                        text(program, "id")?,
                        "program.c.bubble-sort" | "program.c.selection-sort"
                    )))
        {
            return Err(content());
        }
        text(spec, "title")?;
        text(program, "title")?;
        exact_ref(&program["inputRef"], text(spec, "id")?)?;
        exact_ref(&program["languageRef"], "lang.c")?;
        exact_ref(&program["subsetRef"], "subset.c.p0")?;
        let raw_fields = spec["fields"]
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or_else(content)?;
        let mut fields = Vec::new();
        let mut keys = BTreeSet::new();
        for raw in raw_fields {
            charge(meter, 1 + keys.len())?;
            let kind = match text(raw, "kind")? {
                "integer" => {
                    object(raw, &["key", "kind", "min", "max"])?;
                    FieldKind::Integer
                }
                "sequence" => {
                    object(raw, &["key", "kind", "min", "max", "minItems", "maxItems"])?;
                    let min_items = integer(&raw["minItems"]).ok_or_else(content)?;
                    let max_items = integer(&raw["maxItems"]).ok_or_else(content)?;
                    if !(0..=30).contains(&min_items) || !(min_items..=30).contains(&max_items) {
                        return Err(content());
                    }
                    FieldKind::Sequence {
                        min_items: min_items as usize,
                        max_items: max_items as usize,
                    }
                }
                _ => return Err(content()),
            };
            let key = text(raw, "key")?;
            charge(meter, key.len())?;
            let min = integer(&raw["min"]).ok_or_else(content)?;
            let max = integer(&raw["max"]).ok_or_else(content)?;
            if !field_key(key)
                || !keys.insert(key)
                || !(-999..=999).contains(&min)
                || !(min..=999).contains(&max)
            {
                return Err(content());
            }
            // The frozen scalar loop count is not an ordinary -999..999 input.
            if spec["id"] == "input.c.loop-count"
                && (key != "n" || min < 0 || max > 30 || kind != FieldKind::Integer)
            {
                return Err(content());
            }
            fields.push(Field {
                key,
                kind,
                min,
                max,
            });
        }
        let raw_relations = spec["relations"].as_array().ok_or_else(content)?;
        let mut relations = Vec::new();
        let mut relation_keys = BTreeSet::new();
        let mut derived = BTreeMap::new();
        for raw in raw_relations {
            charge(
                meter,
                1 + fields.len() + keys.len() + derived.len() + relation_keys.len(),
            )?;
            let field = text(raw, "field")?;
            let field_kind = fields
                .iter()
                .find(|f| f.key == field)
                .ok_or_else(content)?
                .kind;
            let relation = match text(raw, "kind")? {
                "length-of" => {
                    object(raw, &["kind", "field", "target"])?;
                    let target = text(raw, "target")?;
                    charge(meter, target.len())?;
                    if !matches!(field_kind, FieldKind::Sequence { .. })
                        || !field_key(target)
                        || keys.contains(target)
                        || derived.insert(target, field).is_some()
                    {
                        return Err(content());
                    }
                    Relation::Length { field, target }
                }
                "index-in" => {
                    object(raw, &["kind", "field", "target"])?;
                    let target = text(raw, "target")?;
                    if field_kind != FieldKind::Integer
                        || !fields.iter().any(|f| {
                            f.key == target && matches!(f.kind, FieldKind::Sequence { .. })
                        })
                    {
                        return Err(content());
                    }
                    Relation::Index { field, target }
                }
                "nondecreasing" => {
                    object(raw, &["kind", "field"])?;
                    if !matches!(field_kind, FieldKind::Sequence { .. }) {
                        return Err(content());
                    }
                    Relation::Nondecreasing { field }
                }
                _ => return Err(content()),
            };
            if !relation_keys.insert(relation) {
                return Err(content());
            }
            relations.push(relation);
        }
        let raw_bindings = program["bindings"]
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or_else(binding_error)?;
        let mut bindings = Vec::new();
        let mut binding_keys = BTreeSet::new();
        let mut target_names = BTreeSet::new();
        let mut bound_fields = BTreeSet::new();
        let mut bound_lengths = BTreeSet::new();
        for raw in raw_bindings {
            charge(
                meter,
                1 + fields.len()
                    + binding_keys.len()
                    + target_names.len()
                    + bound_fields.len()
                    + derived.len()
                    + bound_lengths.len(),
            )?;
            let kind = match text(raw, "targetKind")? {
                "scalar" => BindingKind::Scalar,
                "array" => BindingKind::Array,
                "logical-length" => BindingKind::Length,
                _ => return Err(binding_error()),
            };
            let mut required = vec!["bindingKey", "inputKey", "targetName", "targetKind", "from"];
            if kind == BindingKind::Array {
                required.push("emptyStorage");
            }
            object(raw, &required).map_err(|_| binding_error())?;
            let key = text(raw, "bindingKey")?;
            let input = text(raw, "inputKey")?;
            let name = text(raw, "targetName")?;
            charge(meter, key.len() + name.len())?;
            if !stable_id(key)
                || !binding_keys.insert(key)
                || !target_names.insert(name)
                || !name.bytes().next().is_some_and(|c| c.is_ascii_alphabetic())
                || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            {
                return Err(binding_error());
            }
            let field = fields
                .iter()
                .find(|f| f.key == input)
                .ok_or_else(binding_error)?;
            let valid = match (kind, field.kind) {
                (BindingKind::Scalar, FieldKind::Integer) => {
                    raw["from"] == "field" && bound_fields.insert(input)
                }
                (BindingKind::Array, FieldKind::Sequence { .. }) => {
                    raw["from"] == "field"
                        && raw["emptyStorage"] == "one-zero-placeholder"
                        && bound_fields.insert(input)
                }
                (BindingKind::Length, FieldKind::Sequence { .. }) => {
                    raw["from"] == "length-of"
                        && derived.get(name) == Some(&input)
                        && bound_lengths.insert(name)
                }
                _ => false,
            };
            if !valid {
                return Err(binding_error());
            }
            bindings.push(Binding {
                key,
                input,
                name,
                kind,
            });
        }
        charge(
            meter,
            bound_fields.len() + keys.len() + fields.len().saturating_mul(derived.len() + 1),
        )?;
        if bound_fields != keys
            || bound_lengths.len() != derived.len()
            || fields.iter().any(|field| {
                matches!(field.kind, FieldKind::Sequence { .. })
                    && !derived.values().any(|source| *source == field.key)
            })
        {
            return Err(binding_error());
        }
        Ok(Self {
            fields,
            relations,
            bindings,
            example: &program["exampleInput"],
            source: text(program, "sourceExample")?,
            loop_count: spec["id"] == "input.c.loop-count",
        })
    }

    fn validate_input(
        &self,
        input: &Value,
        meter: &mut Option<&mut Meter>,
    ) -> Result<(), Diagnostic> {
        inspect_json(input, meter)?;
        let input = input.as_object().ok_or_else(invalid_input)?;
        charge(meter, input.len().saturating_mul(self.fields.len() + 1))?;
        if input.len() != self.fields.len()
            || input
                .keys()
                .any(|key| !self.fields.iter().any(|field| field.key == key))
        {
            return Err(invalid_input());
        }
        for field in &self.fields {
            charge(meter, 1 + input.len())?;
            let value = input.get(field.key).ok_or_else(invalid_input)?;
            let valid_number = |value: &Value| {
                integer(value).is_some_and(|n| (field.min..=field.max).contains(&n))
            };
            match field.kind {
                FieldKind::Integer if !valid_number(value) => return Err(invalid_input()),
                FieldKind::Sequence {
                    min_items,
                    max_items,
                } => {
                    let values = value.as_array().ok_or_else(invalid_input)?;
                    charge(meter, values.len())?;
                    if !(min_items..=max_items).contains(&values.len())
                        || !values.iter().all(valid_number)
                    {
                        return Err(invalid_input());
                    }
                }
                FieldKind::Integer => {}
            }
        }
        for relation in &self.relations {
            charge(meter, 1)?;
            match *relation {
                Relation::Length { .. } => {}
                Relation::Index { field, target } => {
                    charge(meter, 2 * input.len())?;
                    let index = integer(&input[field]).expect("validated integer");
                    if index < 0
                        || index as usize
                            >= input[target].as_array().expect("validated sequence").len()
                    {
                        return Err(invalid_input());
                    }
                }
                Relation::Nondecreasing { field } => {
                    charge(meter, input.len())?;
                    let values = input[field].as_array().expect("validated sequence");
                    charge(meter, values.len().saturating_sub(1))?;
                    if values
                        .windows(2)
                        .any(|pair| integer(&pair[0]) > integer(&pair[1]))
                    {
                        return Err(rejected(
                            DiagnosticCode::InputOrder,
                            "nondecreasing input sequence",
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn check_example(&self, meter: &mut Option<&mut Meter>) -> Result<CheckedProgram, Diagnostic> {
        self.validate_input(self.example, meter).map_err(|error| {
            if matches!(
                error.code,
                DiagnosticCode::InputInvalid | DiagnosticCode::InputOrder
            ) {
                content()
            } else {
                error
            }
        })?;
        let checked = checked_source(self.source, meter)?;
        self.check_declarations(&checked, self.example, None, meter)?;
        Ok(checked)
    }

    fn check_declarations(
        &self,
        checked: &CheckedProgram,
        input: &Value,
        original_order: Option<&[String]>,
        meter: &mut Option<&mut Meter>,
    ) -> Result<Vec<ResolvedBinding>, Diagnostic> {
        let program = &checked.parsed.program;
        let NodeData::Function { body } = program.nodes[program.root].data else {
            unreachable!("checked main")
        };
        let NodeData::Block { statements } = &program.nodes[body].data else {
            unreachable!("checked main block")
        };
        if statements.len() < self.bindings.len() {
            return Err(binding_error());
        }
        let mut resolved = Vec::new();
        for (position, &id) in statements.iter().take(self.bindings.len()).enumerate() {
            charge(meter, 1 + self.bindings.len() + resolved.len())?;
            let node = &program.nodes[id];
            let NodeData::Declaration {
                name,
                array_length,
                initializer,
                ..
            } = &node.data
            else {
                return Err(binding_error());
            };
            if original_order.is_some_and(|order| &order[position] != name) {
                return Err(binding_error());
            }
            let binding = self
                .bindings
                .iter()
                .find(|binding| binding.name == name)
                .ok_or_else(binding_error)?;
            charge(meter, input.as_object().map_or(0, |fields| fields.len()))?;
            let input_value = &input[binding.input];
            let valid = match binding.kind {
                BindingKind::Scalar => {
                    if let Initializer::Scalar(expression) = initializer {
                        array_length.is_none()
                            && literal(checked, *expression, meter)? == integer(input_value)
                    } else {
                        false
                    }
                }
                BindingKind::Length => {
                    if let Initializer::Scalar(expression) = initializer {
                        array_length.is_none()
                            && literal(checked, *expression, meter)?
                                == Some(input_value.as_array().expect("validated sequence").len()
                                    as i32)
                    } else {
                        false
                    }
                }
                BindingKind::Array => {
                    let values = input_value.as_array().expect("validated sequence");
                    let length = values.len().max(1);
                    if *array_length != Some(length as i32) {
                        false
                    } else if let Initializer::Array(expressions) = initializer {
                        if expressions.len() != length {
                            false
                        } else {
                            let mut valid = true;
                            for (index, &expression) in expressions.iter().enumerate() {
                                charge(meter, 1)?;
                                let expected = if values.is_empty() {
                                    0
                                } else {
                                    integer(&values[index]).expect("validated int")
                                };
                                if literal(checked, expression, meter)? != Some(expected) {
                                    valid = false;
                                    break;
                                }
                            }
                            valid
                        }
                    } else {
                        false
                    }
                }
            };
            if !valid
                || resolved
                    .iter()
                    .any(|old: &ResolvedBinding| old.binding_key == binding.key)
            {
                return Err(Diagnostic::semantic(
                    DiagnosticCode::BindingInvalid,
                    node.byte_range,
                    "original input declaration with matching type, capacity and literal initializer",
                ));
            }
            charge(meter, 1 + binding.key.len().div_ceil(64))?;
            resolved.push(ResolvedBinding {
                binding_key: binding.key.to_owned(),
                declaration_node: id,
                byte_range: node.byte_range,
            });
        }
        // Dynamic query tables use direct AST indices and explicit scans;
        // every entry/comparison is paid before mutation, with no opaque tree
        // insertion/sorting work hidden inside a collect operation.
        let mut protected = Vec::new();
        for resolved_binding in &resolved {
            charge(meter, 1)?;
            for binding in &self.bindings {
                charge(meter, 1)?;
                if binding.key == resolved_binding.binding_key {
                    if binding.kind == BindingKind::Length
                        || (self.loop_count && binding.input == "n")
                    {
                        charge(meter, 1)?;
                        protected.push(resolved_binding.declaration_node);
                    }
                    break;
                }
            }
        }
        charge(meter, program.nodes.len())?;
        let mut references = vec![None; program.nodes.len()];
        for reference in &checked.references {
            charge(meter, 1)?;
            references[reference.expression_node] = Some(reference.declaration_node);
        }
        for node in &program.nodes {
            charge(meter, 1)?;
            if let NodeData::Assignment { target, .. } = node.data {
                charge(meter, 1)?;
                if let Some(declaration) = references[target] {
                    for &protected_declaration in &protected {
                        charge(meter, 1)?;
                        if declaration == protected_declaration {
                            return Err(Diagnostic::semantic(
                                DiagnosticCode::BindingInvalid,
                                node.byte_range,
                                "input n and derived logical lengths remain unchanged on every source path",
                            ));
                        }
                    }
                }
            }
        }
        Ok(resolved)
    }
}

fn literal(
    checked: &CheckedProgram,
    id: NodeId,
    meter: &mut Option<&mut Meter>,
) -> Result<Option<i32>, Diagnostic> {
    charge(meter, 1)?;
    let result = match checked.parsed.program.nodes[id].data {
        NodeData::Expr(Expression::Integer(value)) => Some(value),
        NodeData::Expr(Expression::Unary {
            op: UnaryOp::Plus,
            operand,
        }) => {
            charge(meter, 1)?;
            match checked.parsed.program.nodes[operand].data {
                NodeData::Expr(Expression::Integer(value)) => Some(value),
                _ => None,
            }
        }
        NodeData::Expr(Expression::Unary {
            op: UnaryOp::Minus,
            operand,
        }) => {
            charge(meter, 1)?;
            match checked.parsed.program.nodes[operand].data {
                NodeData::Expr(Expression::Integer(value)) => value.checked_neg(),
                _ => None,
            }
        }
        _ => None,
    };
    Ok(result)
}

fn decimal_bytes(value: i32) -> usize {
    let magnitude = value.unsigned_abs();
    usize::from(value < 0)
        + if magnitude == 0 {
            1
        } else {
            magnitude.ilog10() as usize + 1
        }
}

fn declaration(
    binding: &Binding<'_>,
    input: &Value,
    meter: &mut Option<&mut Meter>,
) -> Result<String, Diagnostic> {
    charge(
        meter,
        1 + input.as_object().map_or(0, |fields| fields.len()),
    )?;
    let input_value = &input[binding.input];
    match binding.kind {
        BindingKind::Scalar | BindingKind::Length => {
            let value = if binding.kind == BindingKind::Scalar {
                integer(input_value).expect("validated integer")
            } else {
                input_value.as_array().expect("validated sequence").len() as i32
            };
            let bytes = 8 + binding.name.len() + decimal_bytes(value);
            // The complete generated statement is paid before allocating or
            // formatting any owned text; appending it is a separate paid copy.
            charge(meter, bytes.div_ceil(64))?;
            let mut generated = String::with_capacity(bytes);
            generated.push_str("int ");
            generated.push_str(binding.name);
            generated.push_str(" = ");
            generated.push_str(&value.to_string());
            generated.push(';');
            Ok(generated)
        }
        BindingKind::Array => {
            let values = input_value.as_array().expect("validated sequence");
            let length = values.len().max(1);
            let mut list_bytes = usize::from(values.is_empty());
            for (index, value) in values.iter().enumerate() {
                charge(meter, 1)?;
                list_bytes += decimal_bytes(integer(value).expect("validated integer"))
                    + if index == 0 { 0 } else { 2 };
            }
            let bytes = 12 + binding.name.len() + decimal_bytes(length as i32) + list_bytes;
            charge(meter, bytes.div_ceil(64))?;
            let mut generated = String::with_capacity(bytes);
            generated.push_str("int ");
            generated.push_str(binding.name);
            generated.push('[');
            generated.push_str(&length.to_string());
            generated.push_str("] = {");
            if values.is_empty() {
                generated.push('0');
            } else {
                for (index, value) in values.iter().enumerate() {
                    charge(meter, 1)?;
                    if index != 0 {
                        generated.push_str(", ");
                    }
                    generated.push_str(&integer(value).expect("validated integer").to_string());
                }
            }
            generated.push_str("};");
            Ok(generated)
        }
    }
}

fn names(
    checked: &CheckedProgram,
    bindings: &[ResolvedBinding],
    meter: &mut Option<&mut Meter>,
) -> Result<Vec<String>, Diagnostic> {
    for binding in bindings {
        charge(
            meter,
            checked.parsed.program.nodes[binding.declaration_node]
                .data
                .entry_weight(),
        )?;
    }
    Ok(bindings
        .iter()
        .map(
            |binding| match &checked.parsed.program.nodes[binding.declaration_node].data {
                NodeData::Declaration { name, .. } => name.clone(),
                _ => unreachable!("resolved declaration"),
            },
        )
        .collect())
}

/// Instantiate checked input into complete source, then resolve its final AST.
pub fn prepare(
    program: &Value,
    spec: &Value,
    input: &Value,
) -> Result<PreparedProgram, Diagnostic> {
    prepare_inner(program, spec, input, None)
}

pub fn prepare_metered(
    program: &Value,
    spec: &Value,
    input: &Value,
    meter: &mut Meter,
) -> Result<PreparedProgram, Diagnostic> {
    prepare_inner(program, spec, input, Some(meter))
}

fn prepare_inner(
    program: &Value,
    spec: &Value,
    input: &Value,
    mut meter: Option<&mut Meter>,
) -> Result<PreparedProgram, Diagnostic> {
    let configuration = Configuration::read(program, spec, &mut meter)?;
    configuration.validate_input(input, &mut meter)?;
    let original = configuration.check_example(&mut meter)?;
    let original_bindings =
        configuration.check_declarations(&original, configuration.example, None, &mut meter)?;
    let original_order = names(&original, &original_bindings, &mut meter)?;
    let mut source = String::new();
    let mut edits = Vec::new();
    let mut previous = 0;
    for original_binding in &original_bindings {
        charge(&mut meter, 1 + configuration.bindings.len())?;
        let binding = configuration
            .bindings
            .iter()
            .find(|binding| binding.key == original_binding.binding_key)
            .expect("resolved configured binding");
        let range = original_binding.byte_range;
        charge(&mut meter, (range.start - previous).div_ceil(64))?;
        source.push_str(&configuration.source[previous..range.start]);
        let start = source.len();
        let generated = declaration(binding, input, &mut meter)?;
        charge(&mut meter, generated.len().div_ceil(64) + 1)?;
        source.push_str(&generated);
        edits.push(SourceEdit {
            original_range: range,
            generated_range: ByteRange {
                start,
                end: source.len(),
            },
        });
        previous = range.end;
    }
    charge(
        &mut meter,
        (configuration.source.len() - previous).div_ceil(64),
    )?;
    source.push_str(&configuration.source[previous..]);
    let checked = checked_source(&source, &mut meter)?;
    let bindings =
        configuration.check_declarations(&checked, input, Some(&original_order), &mut meter)?;
    debug_assert!(
        bindings
            .iter()
            .zip(&edits)
            .all(|(binding, edit)| binding.byte_range == edit.generated_range)
    );
    Ok(PreparedProgram {
        source,
        checked,
        bindings,
        edits,
    })
}

/// Verify a displayed/submitted instance and its mapping without changing it.
pub fn verify_instance(
    program: &Value,
    spec: &Value,
    input: &Value,
    source: &str,
    map: &[BindingMapEntry],
) -> Result<CheckedProgram, Diagnostic> {
    verify_inner(program, spec, input, source, map, None)
}

pub fn verify_instance_metered(
    program: &Value,
    spec: &Value,
    input: &Value,
    source: &str,
    map: &[BindingMapEntry],
    meter: &mut Meter,
) -> Result<CheckedProgram, Diagnostic> {
    verify_inner(program, spec, input, source, map, Some(meter))
}

fn verify_inner(
    program: &Value,
    spec: &Value,
    input: &Value,
    source: &str,
    map: &[BindingMapEntry],
    mut meter: Option<&mut Meter>,
) -> Result<CheckedProgram, Diagnostic> {
    let configuration = Configuration::read(program, spec, &mut meter)?;
    configuration.validate_input(input, &mut meter)?;
    let original = configuration.check_example(&mut meter)?;
    let original_bindings =
        configuration.check_declarations(&original, configuration.example, None, &mut meter)?;
    let checked = checked_source(source, &mut meter)?;
    let resolved = configuration.check_declarations(
        &checked,
        input,
        Some(&names(&original, &original_bindings, &mut meter)?),
        &mut meter,
    )?;
    charge(
        &mut meter,
        map.len().saturating_mul(resolved.len() + map.len() + 1),
    )?;
    let mut keys = BTreeSet::new();
    if map.len() != resolved.len()
        || map.iter().any(|entry| {
            !keys.insert(entry.binding_key.as_str())
                || !resolved.iter().any(|binding| {
                    binding.binding_key == entry.binding_key
                        && binding.byte_range == entry.byte_range
                })
        })
    {
        return Err(binding_error());
    }
    Ok(checked)
}
