//! Bounded AST-MAP-01 analysis over the existing checked P0-C tree.
//!
//! This endpoint never executes a program, emits a trace, or grants learning
//! authority. The static catalog is independently selected by the Worker.

use serde_json::{Value, json};

use crate::ast::{BinaryOp, Expression, Initializer, NodeData, NodeId, UnaryOp};
use crate::budget::{BudgetError, Meter};
use crate::codec::{self, CodecError};
use crate::diagnostic::{Diagnostic, DiagnosticCode};
use crate::exec::{self, ExecFailure};
use crate::input::{self, BindingMapEntry};
use crate::lexer;
use crate::parser;
use crate::semantic::CheckedProgram;
use crate::source::ByteRange;

fn failure(error: CodecError) -> ExecFailure {
    ExecFailure(match error {
        CodecError::Budget(BudgetError::Cancelled) => "E_CANCELLED",
        CodecError::Budget(BudgetError::Deadline { .. }) => "E_DEADLINE",
        CodecError::Budget(BudgetError::Fuel { .. }) => "E_FUEL_LIMIT",
        CodecError::Limit { .. } => "E_RESULT_LIMIT",
        CodecError::Allocation => "E_ENCODING_FAILURE",
        _ => "E_PROTOCOL_INVALID",
    })
}

fn charge(meter: &mut Meter, units: usize) -> Result<(), Diagnostic> {
    meter.charge(units).map_err(|error| {
        error.diagnostic(
            crate::diagnostic::Stage::Semantic,
            crate::diagnostic::Location::Synthetic {
                reason: "pre-execution",
            },
        )
    })
}

fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}

fn opaque(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        let mut bytes = text.bytes();
        (1..=96).contains(&text.len())
            && bytes
                .next()
                .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    })
}

fn positive(value: &Value) -> bool {
    value
        .as_u64()
        .is_some_and(|value| (1..=9_007_199_254_740_991).contains(&value))
}

fn reference(value: &Value) -> bool {
    if !exact(value, &["id", "version"]) {
        return false;
    }
    let Some(id) = value["id"].as_str().filter(|id| id.len() <= 96) else {
        return false;
    };
    let mut parts = id.split('.');
    let first = parts.next().unwrap_or_default();
    if !first
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase())
        || !first
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        || parts.clone().next().is_none()
        || !parts.all(|part| {
            part.split('-').all(|piece| {
                !piece.is_empty()
                    && piece
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
        })
    {
        return false;
    }
    value["version"].as_str().is_some_and(|version| {
        let parts: Vec<_> = version.split('.').collect();
        parts.len() == 3
            && parts.iter().all(|part| {
                !part.is_empty()
                    && (part.len() == 1 || !part.starts_with('0'))
                    && part.bytes().all(|byte| byte.is_ascii_digit())
            })
    })
}

fn request_shape(request: &Value) -> Result<(), ExecFailure> {
    if !exact(
        request,
        &[
            "kind",
            "analysisVersion",
            "identity",
            "refs",
            "sourceText",
            "input",
        ],
    ) || request["kind"] != "analysisRequest"
    {
        return Err(ExecFailure("E_PROTOCOL_INVALID"));
    }
    if request["analysisVersion"] != "1.0.0" {
        return Err(ExecFailure("E_PROTOCOL_VERSION"));
    }
    let identity = &request["identity"];
    if !exact(
        identity,
        &[
            "contextId",
            "contextRevision",
            "documentRevision",
            "editId",
            "operationId",
        ],
    ) || !["contextId", "editId", "operationId"]
        .iter()
        .all(|key| opaque(&identity[key]))
        || !["contextRevision", "documentRevision"]
            .iter()
            .all(|key| positive(&identity[key]))
    {
        return Err(ExecFailure("E_PROTOCOL_INVALID"));
    }
    let refs = &request["refs"];
    if !exact(refs, &["packageRef", "programRef", "subsetRef"])
        || !["packageRef", "programRef", "subsetRef"]
            .iter()
            .all(|key| reference(&refs[key]))
        || request["sourceText"].as_str().is_none()
    {
        return Err(ExecFailure("E_PROTOCOL_INVALID"));
    }
    let input = &request["input"];
    if !exact(input, &["specRef", "values", "random"])
        || !(input["specRef"].is_null() || reference(&input["specRef"]))
    {
        return Err(ExecFailure("E_PROTOCOL_INVALID"));
    }
    let Some(values) = input["values"].as_object() else {
        return Err(ExecFailure("E_PROTOCOL_INVALID"));
    };
    for (key, value) in values {
        let mut name = key.bytes();
        let integer = |value: &Value| value.as_i64().is_some_and(|n| i32::try_from(n).is_ok());
        if key.len() > 96
            || !name
                .next()
                .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
            || !name.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            || !(integer(value)
                || value
                    .as_array()
                    .is_some_and(|items| items.len() <= 30 && items.iter().all(integer)))
        {
            return Err(ExecFailure("E_PROTOCOL_INVALID"));
        }
    }
    let random = &input["random"];
    if !random.is_null()
        && (!exact(random, &["generatorRef", "seed"])
            || !reference(&random["generatorRef"])
            || !random["seed"]
                .as_str()
                .is_some_and(|seed| (1..=128).contains(&seed.chars().count())))
    {
        return Err(ExecFailure("E_PROTOCOL_INVALID"));
    }
    Ok(())
}

fn node_id(id: NodeId) -> String {
    format!("n{}", id + 1)
}

fn binding_error(range: ByteRange) -> Diagnostic {
    Diagnostic::semantic(
        DiagnosticCode::BindingInvalid,
        range,
        "controlled prefix declarations and all controlled-name references keep their binding",
    )
}

fn checked(
    request: &Value,
    catalog: &Value,
    meter: &mut Meter,
) -> Result<(CheckedProgram, Vec<BindingMapEntry>, Vec<NodeId>), Diagnostic> {
    let source = request["sourceText"]
        .as_str()
        .expect("checked request text");
    let mismatch = || {
        Diagnostic::preflight(
            DiagnosticCode::ContentMismatch,
            "current exact static course references",
        )
    };
    let program = &catalog["program"];
    if request["refs"]["packageRef"] != catalog["packageRef"]
        || request["refs"]["programRef"] != json!({"id":program["id"],"version":program["version"]})
        || request["refs"]["subsetRef"] != program["subsetRef"]
        || catalog["subject"]["programRef"] != request["refs"]["programRef"]
        || request["input"]["specRef"] != program["inputRef"]
        || request["input"]["specRef"]
            != json!({"id":catalog["inputSpec"]["id"],"version":catalog["inputSpec"]["version"]})
    {
        return Err(mismatch());
    }
    // Only ranges are needed to propose the prefix mapping. The existing
    // verifier below produces the one semantically checked tree that is
    // projected; do not repeat a full semantic pass before that verifier.
    let parsed = parser::parse_metered(source, meter)?;
    let ast = &parsed.program;
    let NodeData::Function { body } = ast.nodes[ast.root].data else {
        unreachable!()
    };
    let NodeData::Block { statements } = &ast.nodes[body].data else {
        unreachable!()
    };
    let bindings = program["bindings"].as_array().ok_or_else(mismatch)?;
    charge(meter, bindings.len() + 1)?;
    if statements.len() < bindings.len() {
        return Err(binding_error(ast.nodes[body].byte_range));
    }
    let mut map = Vec::with_capacity(bindings.len());
    let mut input_nodes = Vec::with_capacity(bindings.len());
    for &id in statements.iter().take(bindings.len()) {
        charge(meter, 1 + bindings.len())?;
        let NodeData::Declaration { name, .. } = &ast.nodes[id].data else {
            return Err(binding_error(ast.nodes[id].byte_range));
        };
        // Use the original static declaration order, not config array order.
        let configured = bindings
            .iter()
            .find(|candidate| candidate["targetName"] == *name)
            .ok_or_else(|| binding_error(ast.nodes[id].byte_range))?;
        let key = configured["bindingKey"].as_str().ok_or_else(mismatch)?;
        charge(meter, key.len().div_ceil(64) + 1)?;
        map.push(BindingMapEntry {
            binding_key: key.to_owned(),
            byte_range: ast.nodes[id].byte_range,
        });
        input_nodes.push(id);
    }
    // This existing verifier checks exact input domains, original prefix order,
    // types, literal values, capacity, and loop-count/logical-length writes.
    let result = input::verify_instance_metered(
        program,
        &catalog["inputSpec"],
        &request["input"]["values"],
        source,
        &map,
        meter,
    )?;
    for reference in &result.references {
        let NodeData::Expr(Expression::Name(name)) =
            &result.parsed.program.nodes[reference.expression_node].data
        else {
            continue;
        };
        for &declaration in &input_nodes {
            charge(meter, 1 + name.len().div_ceil(64))?;
            let NodeData::Declaration {
                name: input_name, ..
            } = &result.parsed.program.nodes[declaration].data
            else {
                unreachable!()
            };
            if name == input_name && reference.declaration_node != declaration {
                return Err(binding_error(
                    result.parsed.program.nodes[reference.expression_node].byte_range,
                ));
            }
        }
    }
    Ok((result, map, input_nodes))
}

fn unary(operator: UnaryOp) -> &'static str {
    match operator {
        UnaryOp::Plus => "+",
        UnaryOp::Minus => "-",
        UnaryOp::Not => "!",
    }
}

fn binary(operator: BinaryOp) -> &'static str {
    match operator {
        BinaryOp::Multiply => "*",
        BinaryOp::Divide => "/",
        BinaryOp::Remainder => "%",
        BinaryOp::Add => "+",
        BinaryOp::Subtract => "-",
        BinaryOp::Less => "<",
        BinaryOp::LessEqual => "<=",
        BinaryOp::Greater => ">",
        BinaryOp::GreaterEqual => ">=",
        BinaryOp::Equal => "==",
        BinaryOp::NotEqual => "!=",
        BinaryOp::And => "&&",
        BinaryOp::Or => "||",
    }
}

fn payload(data: &NodeData, reference: Option<NodeId>) -> Value {
    match data {
        NodeData::Function { body } => json!({"kind":"function","body":node_id(*body)}),
        NodeData::Block { statements } => {
            json!({"kind":"block","statements":statements.iter().map(|id|node_id(*id)).collect::<Vec<_>>()})
        }
        NodeData::Declaration {
            name,
            name_range,
            array_length,
            initializer,
        } => {
            let initializer = match initializer {
                Initializer::None => json!({"kind":"none"}),
                Initializer::Scalar(id) => json!({"kind":"scalar","expression":node_id(*id)}),
                Initializer::Array(ids) => {
                    json!({"kind":"array","elements":ids.iter().map(|id|node_id(*id)).collect::<Vec<_>>()})
                }
            };
            json!({"kind":"declaration","name":name,"nameRange":name_range,"arrayLength":array_length.map(|length|length.to_string()),"initializer":initializer})
        }
        NodeData::Assignment { target, value } => {
            json!({"kind":"assignment","target":node_id(*target),"value":node_id(*value)})
        }
        NodeData::If {
            condition,
            then_block,
            else_block,
        } => {
            json!({"kind":"if","condition":node_id(*condition),"thenBlock":node_id(*then_block),"elseBlock":else_block.map(node_id)})
        }
        NodeData::While { condition, body } => {
            json!({"kind":"while","condition":node_id(*condition),"body":node_id(*body)})
        }
        NodeData::For {
            init,
            condition,
            update,
            body,
        } => {
            json!({"kind":"for","init":init.map(node_id),"condition":condition.map(node_id),"update":update.map(node_id),"body":node_id(*body)})
        }
        NodeData::Condition { expression } => {
            json!({"kind":"condition","expression":node_id(*expression)})
        }
        NodeData::Output {
            format,
            format_range,
            arguments,
        } => {
            json!({"kind":"output","format":format,"formatRange":format_range,"arguments":arguments.iter().map(|id|node_id(*id)).collect::<Vec<_>>()})
        }
        NodeData::Return { value } => json!({"kind":"return","value":node_id(*value)}),
        NodeData::Break => json!({"kind":"break"}),
        NodeData::Continue => json!({"kind":"continue"}),
        NodeData::Empty => json!({"kind":"empty"}),
        NodeData::Expr(expression) => match expression {
            Expression::Integer(value) => json!({"kind":"integer","value":value.to_string()}),
            Expression::Name(name) => {
                json!({"kind":"name","name":name,"resolvedDeclarationId":node_id(reference.expect("checked name resolution"))})
            }
            Expression::Index { array, index } => {
                json!({"kind":"index","array":node_id(*array),"index":node_id(*index)})
            }
            Expression::Unary { op, operand } => {
                json!({"kind":"unary","operator":unary(*op),"operand":node_id(*operand)})
            }
            Expression::Binary { op, left, right } => {
                json!({"kind":"binary","operator":binary(*op),"left":node_id(*left),"right":node_id(*right)})
            }
        },
    }
}

// Gaps between real lexer token spans contain only whitespace/comments. Strings
// and the teaching header are whole tokens, so comment-like string text cannot
// enter this collector. No independent C parsing or execution is introduced.
fn trivia(source: &str, meter: &mut Meter) -> Result<Vec<Value>, Diagnostic> {
    let lexed = lexer::lex_metered(source, meter)?;
    let mut result = Vec::new();
    let mut previous = 0;
    for token in lexed.tokens {
        let end = token.byte_range.start;
        let mut at = previous;
        while at < end {
            let start = at;
            let bytes = source.as_bytes();
            let kind = if source[at..end].starts_with("//") {
                charge(meter, 2)?;
                at += 2;
                while at < end && !matches!(bytes[at], b'\r' | b'\n') {
                    charge(meter, 1)?;
                    at += 1;
                }
                "line-comment"
            } else if source[at..end].starts_with("/*") {
                charge(meter, 2)?;
                at += 2;
                while at + 1 < end && &bytes[at..at + 2] != b"*/" {
                    charge(meter, 1)?;
                    at += 1;
                }
                charge(meter, 2)?;
                at += 2;
                "block-comment"
            } else {
                while at < end
                    && matches!(bytes[at], b' ' | b'\t' | b'\x0b' | b'\x0c' | b'\r' | b'\n')
                {
                    charge(meter, 1)?;
                    at += 1;
                }
                "whitespace"
            };
            assert!(at > start && at <= end, "lexer gap has only valid trivia");
            charge(meter, 16)?;
            result.push(json!({"kind":kind,"byteRange":{"start":start,"end":at}}));
        }
        previous = token.byte_range.end;
    }
    Ok(result)
}

fn valid_payload(request: &Value, catalog: &Value, meter: &mut Meter) -> Result<Value, Diagnostic> {
    let source = request["sourceText"].as_str().expect("checked source");
    let (checked, bindings, inputs) = checked(request, catalog, meter)?;
    let ast = &checked.parsed.program;
    charge(meter, ast.nodes.len().saturating_mul(4))?;
    let mut references = vec![None; ast.nodes.len()];
    for reference in &checked.references {
        charge(meter, 1)?;
        references[reference.expression_node] = Some(reference.declaration_node);
    }
    let node_map = ast.node_map_metered(meter)?;
    let mut parents = vec![None; ast.nodes.len()];
    for (id, node) in ast.nodes.iter().enumerate() {
        charge(meter, node.data.entry_weight())?;
        for child in node.data.children() {
            parents[child] = Some(id);
        }
    }
    let mut hidden = vec![false; ast.nodes.len()];
    let mut nodes = Vec::with_capacity(ast.nodes.len());
    let mut blocks = Vec::new();
    for (id, node) in ast.nodes.iter().enumerate() {
        // Covers bounded payload key insertion, cloning and all child strings.
        charge(
            meter,
            128 + inputs.len() + node.data.entry_weight().saturating_mul(8),
        )?;
        if let Some(parent) = parents[id] {
            hidden[id] = hidden[parent]
                || inputs.contains(&parent)
                || matches!(
                    ast.nodes[parent].data,
                    NodeData::Declaration {
                        array_length: Some(_),
                        ..
                    }
                );
        }
        let mut value = payload(&node.data, references[id]);
        let object = value.as_object_mut().expect("payload object");
        object.insert("nodeId".to_owned(), json!(node_id(id)));
        object.insert("parentId".to_owned(), json!(parents[id].map(node_id)));
        object.insert("byteRange".to_owned(), json!(node.byte_range));
        let auxiliary = match &node.data {
            NodeData::Condition { .. } | NodeData::Empty => true,
            NodeData::Block { .. } => parents[id].is_some_and(|parent| {
                matches!(
                    ast.nodes[parent].data,
                    NodeData::Function { .. }
                        | NodeData::If { .. }
                        | NodeData::While { .. }
                        | NodeData::For { .. }
                )
            }),
            NodeData::Expr(_) => parents[id].is_some_and(|parent| match ast.nodes[parent].data {
                NodeData::Assignment { target, .. } => target == id,
                NodeData::Expr(Expression::Index { array, .. }) => array == id,
                _ => false,
            }),
            _ => false,
        };
        if !hidden[id] && !auxiliary {
            blocks.push(
                json!({"blockId":format!("block.analysis.{}",id+1),"byteRange":node.byte_range}),
            );
        }
        nodes.push(value);
    }
    charge(meter, bindings.len().saturating_mul(16) + 64)?;
    let binding_map: Vec<_> = bindings
        .iter()
        .map(|binding| json!({"bindingKey":binding.binding_key,"byteRange":binding.byte_range}))
        .collect();
    let trivia = trivia(source, meter)?;
    Ok(
        json!({"kind":"analysisResult","analysisVersion":"1.0.0","identity":request["identity"],"refs":request["refs"],"status":"valid","checkedAst":{"rootId":node_id(ast.root),"headerRange":ast.header_range,"nodes":nodes},"bindingMap":binding_map,"nodeMap":node_map,"blockMap":blocks,"trivia":trivia,"diagnostics":[]}),
    )
}

fn resource(code: DiagnosticCode) -> bool {
    matches!(
        code,
        DiagnosticCode::SourceLimit
            | DiagnosticCode::DepthLimit
            | DiagnosticCode::FuelLimit
            | DiagnosticCode::MemoryLimit
            | DiagnosticCode::OutputLimit
            | DiagnosticCode::ResultLimit
            | DiagnosticCode::RequestLimit
            | DiagnosticCode::Deadline
            | DiagnosticCode::Cancelled
    )
}

fn failure_payload(request: &Value, code: &'static str) -> Value {
    json!({"kind":"analysisFailure","analysisVersion":"1.0.0","identity":request["identity"],"refs":request["refs"],"error":{"code":code}})
}

/// Analyze one unchanged source and its current controlled input. Request JSON
/// uses the same bounded canonical codec as EXEC; no user text is persisted.
pub fn analyze_code_draft(
    request_json: &str,
    catalog_json: &str,
    meter: &mut Meter,
) -> Result<Vec<u8>, ExecFailure> {
    let request = codec::decode(request_json.as_bytes(), meter, meter.limits().request_bytes)
        .map_err(|error| match error {
            CodecError::Limit { .. } => ExecFailure("E_REQUEST_LIMIT"),
            other => failure(other),
        })?;
    request_shape(&request)?;
    let catalog = exec::parse_catalog(catalog_json, meter)?;
    let output = match valid_payload(&request, &catalog, meter) {
        Ok(value) => value,
        Err(diagnostic) if resource(diagnostic.code) => {
            meter
                .begin_finalization()
                .map_err(|error| failure(error.into()))?;
            failure_payload(
                &request,
                if diagnostic.code == DiagnosticCode::Cancelled {
                    "cancelled"
                } else {
                    "budget"
                },
            )
        }
        Err(diagnostic) => {
            charge(meter, 64).map_err(|_| ExecFailure("E_FUEL_LIMIT"))?;
            json!({"kind":"analysisResult","analysisVersion":"1.0.0","identity":request["identity"],"refs":request["refs"],"status":"invalid","diagnostics":[diagnostic]})
        }
    };
    match codec::encode(&output, meter, meter.limits().result_bytes) {
        Ok(bytes) => Ok(bytes),
        Err(error @ (CodecError::Budget(BudgetError::Fuel { .. }) | CodecError::Limit { .. })) => {
            let _ = error;
            meter
                .begin_finalization()
                .map_err(|error| failure(error.into()))?;
            codec::encode(
                &failure_payload(&request, "budget"),
                meter,
                meter.limits().result_bytes,
            )
            .map_err(failure)
        }
        Err(error) => Err(failure(error)),
    }
}
