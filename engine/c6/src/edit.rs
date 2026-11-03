//! EDIT2 is an analysis endpoint, not execution or learning authority.
//! One checked Rust tree is projected only if the entire document fits the old twenty blocks.
use crate::{
    api,
    budget::Meter,
    check::{self, Checked},
    codec, state,
    syntax::{self, Expr, Id, Init, Kind},
    types::{Ty, Val},
};
use serde_json::{Value, json};

struct Mapping<'a, 'm> {
    checked: &'a Checked,
    meter: &'m mut Meter,
    blocks: Vec<Value>,
}
impl Mapping<'_, '_> {
    fn node(&mut self, id: Id, kind: &str, fields: Value) -> Result<Value, ()> {
        syntax::charge(self.meter, 32, self.checked.program.nodes[id].range).map_err(|_| ())?;
        let block_id = format!("block.c6.{}", id + 1);
        self.blocks.push(json!({"blockId":block_id,"nodeId":state::nid(id),"byteRange":self.checked.program.nodes[id].range}));
        let mut fields = fields;
        fields["id"] = json!(block_id);
        fields["kind"] = json!(kind);
        Ok(fields)
    }
    fn name(name: &str) -> bool {
        name.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
    }
    fn expression(&mut self, id: Id) -> Result<Value, ()> {
        if self.checked.expr_types[id].as_ref() != Some(&Ty::Int) {
            return Err(());
        }
        let Kind::Expression(expr) = self.checked.program.nodes[id].kind.clone() else {
            return Err(());
        };
        match expr {
            Expr::Literal(Val::I(n), None) if n >= 0 => {
                self.node(id, "integer", json!({"value":n.to_string()}))
            }
            Expr::Name(name) if Self::name(&name) => {
                self.node(id, "variable", json!({"name":name}))
            }
            Expr::Unary(op, a) if matches!(op.as_str(), "+" | "-" | "!") => {
                let a = self.expression(a)?;
                self.node(id, "unary", json!({"operator":op,"operand":a}))
            }
            Expr::Binary(op, a, b)
                if matches!(
                    op.as_str(),
                    "+" | "-"
                        | "*"
                        | "/"
                        | "%"
                        | "<"
                        | "<="
                        | ">"
                        | ">="
                        | "=="
                        | "!="
                        | "&&"
                        | "||"
                ) =>
            {
                let left = self.expression(a)?;
                let right = self.expression(b)?;
                let kind = if matches!(op.as_str(), "&&" | "||") {
                    "logic"
                } else if matches!(op.as_str(), "<" | "<=" | ">" | ">=" | "==" | "!=") {
                    "compare"
                } else {
                    "arithmetic"
                };
                self.node(id, kind, json!({"operator":op,"left":left,"right":right}))
            }
            Expr::Index(a, index) => {
                let name = self.array_name(a)?;
                let index = self.expression(index)?;
                self.node(id, "array_read", json!({"name":name,"index":index}))
            }
            _ => Err(()),
        }
    }
    fn array_name(&self, id: Id) -> Result<String, ()> {
        match (
            &self.checked.program.nodes[id].kind,
            &self.checked.expr_types[id],
        ) {
            (Kind::Expression(Expr::Name(name)), Some(Ty::Array(t, _)))
                if **t == Ty::Int && Self::name(name) =>
            {
                Ok(name.clone())
            }
            _ => Err(()),
        }
    }
    fn assignment(&mut self, id: Id) -> Result<Value, ()> {
        let Kind::Expression(Expr::Assign(op, left, right)) =
            self.checked.program.nodes[id].kind.clone()
        else {
            return Err(());
        };
        if op != "=" {
            return Err(());
        }
        let value = self.expression(right)?;
        match self.checked.program.nodes[left].kind.clone() {
            Kind::Expression(Expr::Name(name))
                if Self::name(&name) && self.checked.expr_types[left] == Some(Ty::Int) =>
            {
                self.node(id, "assign", json!({"name":name,"value":value}))
            }
            Kind::Expression(Expr::Index(a, index)) => {
                let name = self.array_name(a)?;
                let index = self.expression(index)?;
                self.node(
                    id,
                    "array_write",
                    json!({"name":name,"index":index,"value":value}),
                )
            }
            _ => Err(()),
        }
    }
    fn body(&mut self, id: Id) -> Result<Vec<Value>, ()> {
        if let Kind::Block(ids) | Kind::Group(ids) = self.checked.program.nodes[id].kind.clone() {
            let mut values = vec![];
            for id in ids {
                if matches!(self.checked.program.nodes[id].kind, Kind::Group(_)) {
                    values.extend(self.body(id)?)
                } else if !matches!(self.checked.program.nodes[id].kind, Kind::Empty) {
                    values.push(self.statement(id)?);
                }
            }
            Ok(values)
        } else {
            Ok(vec![self.statement(id)?])
        }
    }
    fn statement(&mut self, id: Id) -> Result<Value, ()> {
        match self.checked.program.nodes[id].kind.clone() {
            Kind::Group(ids) if ids.len() == 1 => self.statement(ids[0]),
            Kind::Declare(d) if !d.static_storage && !d.global && Self::name(&d.name) => {
                match d.ty {
                    Ty::Int => {
                        let initial = match d.init {
                            Init::None => Value::Null,
                            Init::Expr(e) => self.expression(e)?,
                            _ => return Err(()),
                        };
                        self.node(id, "declare", json!({"name":d.name,"initial":initial}))
                    }
                    Ty::Array(t, n) if *t == Ty::Int => {
                        let values = match d.init {
                            Init::None => Value::Null,
                            Init::Items(items) => {
                                let mut values = vec![];
                                for init in items {
                                    let Init::Expr(e) = init else { return Err(()) };
                                    let (negative, e) = match &self.checked.program.nodes[e].kind {
                                        Kind::Expression(Expr::Unary(op, a)) if op == "-" => {
                                            (true, *a)
                                        }
                                        _ => (false, e),
                                    };
                                    let Kind::Expression(Expr::Literal(Val::I(n), None)) =
                                        self.checked.program.nodes[e].kind
                                    else {
                                        return Err(());
                                    };
                                    if n == i32::MIN {
                                        return Err(());
                                    }
                                    values.push(if negative {
                                        (-n).to_string()
                                    } else {
                                        n.to_string()
                                    });
                                }
                                json!(values)
                            }
                            _ => return Err(()),
                        };
                        self.node(
                            id,
                            "array_declare",
                            json!({"name":d.name,"length":n.to_string(),"values":values}),
                        )
                    }
                    _ => Err(()),
                }
            }
            Kind::ExprStmt(e) => {
                if let Kind::Expression(Expr::Call(name, args)) =
                    self.checked.program.nodes[e].kind.clone()
                {
                    if name != "printf" || args.is_empty() {
                        return Err(());
                    }
                    let Kind::Expression(Expr::String(format)) =
                        &self.checked.program.nodes[args[0]].kind
                    else {
                        return Err(());
                    };
                    if format.iter().any(|b| !(32..=126).contains(b) && *b != 10) {
                        return Err(());
                    }
                    let mut at = 0;
                    while at < format.len() {
                        if format[at] == b'%' {
                            at += 1;
                            if !matches!(format.get(at), Some(b'd' | b'%')) {
                                return Err(());
                            }
                        }
                        at += 1;
                    }
                    let format = String::from_utf8(format.clone()).map_err(|_| ())?;
                    let args = args[1..]
                        .iter()
                        .copied()
                        .map(|a| self.expression(a))
                        .collect::<Result<Vec<_>, _>>()?;
                    self.node(id, "print", json!({"format":format,"args":args}))
                } else {
                    self.assignment(e)
                }
            }
            Kind::Block(_) => {
                let body = self.body(id)?;
                self.node(id, "scope", json!({"body":body}))
            }
            Kind::If { condition, yes, no } => {
                let condition = self.expression(condition)?;
                let yes = self.body(yes)?;
                let no = match no {
                    Some(n) => json!(self.body(n)?),
                    None => Value::Null,
                };
                self.node(
                    id,
                    "if",
                    json!({"condition":condition,"then":yes,"else":no}),
                )
            }
            Kind::While { condition, body } => {
                let condition = self.expression(condition)?;
                let body = self.body(body)?;
                self.node(id, "while", json!({"condition":condition,"body":body}))
            }
            Kind::For {
                init,
                condition,
                update,
                body,
            } => {
                let init = match init {
                    Some(i) => self.statement(i)?,
                    None => Value::Null,
                };
                let condition = match condition {
                    Some(i) => self.expression(i)?,
                    None => Value::Null,
                };
                let update = match update {
                    Some(i) => self.assignment(i)?,
                    None => Value::Null,
                };
                if !init.is_null() && !matches!(init["kind"].as_str(), Some("declare" | "assign"))
                    || !update.is_null() && update["kind"] != "assign"
                {
                    return Err(());
                }
                let body = self.body(body)?;
                self.node(
                    id,
                    "for",
                    json!({"init":init,"condition":condition,"update":update,"body":body}),
                )
            }
            Kind::Return(Some(e)) => {
                let value = self.expression(e)?;
                self.node(id, "return", json!({"value":value}))
            }
            Kind::Break => self.node(id, "break", json!({})),
            Kind::Continue => self.node(id, "continue", json!({})),
            _ => Err(()),
        }
    }
}
fn project(checked: &Checked, meter: &mut Meter) -> Option<(Value, Vec<Value>)> {
    let p = &checked.program;
    if p.functions.len() != 1
        || !p.globals.is_empty()
        || !p.structs.is_empty()
        || !p.aliases.is_empty()
        || p.has_object_macros
        || p.headers.iter().any(|h| h != "stdio.h")
        || p.nodes.iter().any(
            |n| matches!(&n.kind,Kind::Marker(tag)if !matches!(*tag,"translation-unit"|"function")),
        )
    {
        return None;
    }
    let f = &p.functions[0];
    if f.name != "main" || f.result != Ty::Int || !f.params.is_empty() {
        return None;
    }
    let mut m = Mapping {
        checked,
        meter,
        blocks: vec![],
    };
    let body = m.body(f.body).ok()?;
    let program = m.node(f.node, "main", json!({"body":body})).ok()?;
    Some((program, m.blocks))
}
fn quote(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}
fn precedence(v: &Value) -> u8 {
    match v["kind"].as_str().unwrap_or_default() {
        "unary" => 13,
        "arithmetic" | "compare" | "logic" => match v["operator"].as_str().unwrap() {
            "||" => 1,
            "&&" => 2,
            "==" | "!=" => 3,
            "<" | "<=" | ">" | ">=" => 4,
            "+" | "-" => 5,
            _ => 6,
        },
        _ => 15,
    }
}
fn text(v: &Value) -> String {
    let s = |key: &str| v[key].as_str().unwrap_or_default();
    let child = |key: &str| text(&v[key]);
    let body = |key: &str| {
        v[key]
            .as_array()
            .unwrap()
            .iter()
            .map(text)
            .collect::<Vec<_>>()
            .join("")
    };
    match s("kind") {
        "main" => format!("#include <stdio.h>\nint main(void){{{}}}", body("body")),
        "integer" => s("value").into(),
        "variable" => s("name").into(),
        "unary" => format!(
            "{} {}",
            s("operator"),
            if precedence(&v["operand"]) < 13 {
                format!("({})", child("operand"))
            } else {
                child("operand")
            }
        ),
        "arithmetic" | "compare" | "logic" => {
            let p = precedence(v);
            let left = if precedence(&v["left"]) < p {
                format!("({})", child("left"))
            } else {
                child("left")
            };
            let right = if precedence(&v["right"]) <= p {
                format!("({})", child("right"))
            } else {
                child("right")
            };
            format!("{left}{}{right}", s("operator"))
        }
        "array_read" => format!("{}[{}]", s("name"), child("index")),
        "declare" => format!(
            "int {}{};",
            s("name"),
            if v["initial"].is_null() {
                String::new()
            } else {
                format!("={}", child("initial"))
            }
        ),
        "array_declare" => format!(
            "int {}[{}]{};",
            s("name"),
            s("length"),
            if v["values"].is_null() {
                String::new()
            } else {
                format!(
                    "={{{}}}",
                    v["values"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_str().unwrap())
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
        ),
        "assign" => format!("{}={};", s("name"), child("value")),
        "array_write" => format!("{}[{}]={};", s("name"), child("index"), child("value")),
        "print" => {
            let args = v["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(text)
                .collect::<Vec<_>>();
            format!(
                "printf({}{});",
                quote(s("format")),
                if args.is_empty() {
                    String::new()
                } else {
                    format!(",{}", args.join(","))
                }
            )
        }
        "return" => format!("return {};", child("value")),
        "scope" => format!("{{{}}}", body("body")),
        "if" => format!(
            "if({}){{{}}}{}",
            child("condition"),
            body("then"),
            if v["else"].is_null() {
                String::new()
            } else {
                format!("else{{{}}}", body("else"))
            }
        ),
        "while" => format!("while({}){{{}}}", child("condition"), body("body")),
        "for" => format!(
            "for({};{};{}){{{}}}",
            if v["init"].is_null() {
                String::new()
            } else {
                child("init").trim_end_matches(';').into()
            },
            if v["condition"].is_null() {
                String::new()
            } else {
                child("condition")
            },
            if v["update"].is_null() {
                String::new()
            } else {
                child("update").trim_end_matches(';').into()
            },
            body("body")
        ),
        "break" => "break;".into(),
        "continue" => "continue;".into(),
        _ => unreachable!(),
    }
}
fn without_ids(v: &Value) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(k, _)| *k != "id")
                .map(|(k, v)| (k.clone(), without_ids(v)))
                .collect(),
        ),
        Value::Array(a) => json!(a.iter().map(without_ids).collect::<Vec<_>>()),
        _ => v.clone(),
    }
}
// Keep the frozen JSON container-depth32 budget even for a full AST-depth64 mapping.
// Child links are block IDs; no nested raw C fragments or executable instructions are introduced.
fn flat_program(mut tree: Value) -> Value {
    fn collect(node: &mut Value, nodes: &mut Vec<Value>) {
        match node {
            Value::Object(o) if o.contains_key("kind") && o.contains_key("id") => {
                for value in o.values_mut() {
                    match value {
                        Value::Object(_) | Value::Array(_) => collect(value, nodes),
                        _ => {}
                    }
                }
                let id = node["id"].clone();
                nodes.push(node.take());
                *node = id;
            }
            Value::Array(values) => {
                for value in values {
                    collect(value, nodes)
                }
            }
            _ => {}
        }
    }
    let mut nodes = vec![];
    collect(&mut tree, &mut nodes);
    json!({"rootId":tree,"nodes":nodes})
}
pub fn execute(
    request: &Value,
    build_id: &str,
    meter: &mut Meter,
) -> Result<Vec<u8>, &'static str> {
    if !api::exact(
        request,
        &[
            "editVersion",
            "documentId",
            "packageRef",
            "engine",
            "sourceRevision",
            "sourceSha256",
            "source",
        ],
    ) {
        return Err("E_PROTOCOL_INVALID");
    }
    if request["editVersion"] != "2.0.0"
        || request["engine"] != json!({"id":api::ENGINE_ID,"version":"0.1.0"})
        || request["packageRef"] != json!({"id":"content.c.primer6","version":"1.0.0"})
    {
        return Err("E_UNSUPPORTED_VERSION");
    }
    if !api::opaque(&request["documentId"]) || !api::opaque(&request["sourceRevision"]) {
        return Err("E_PROTOCOL_INVALID");
    }
    let source = request["source"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    if request["sourceSha256"] != api::source_hash(source) {
        return Err("E_PROTOCOL_INVALID");
    }
    let checked = syntax::parse(source, meter).and_then(|p| check::check(p, meter));
    let mut result = request.clone();
    result["engine"]["buildId"] = json!(build_id);
    result["nodeMap"] = json!([]);
    result["program"] = Value::Null;
    result["blockMap"] = json!([]);
    result["diagnostics"] = json!([]);
    result["profileRef"] = json!({"id":"block-set.c6.common-int","version":"1.0.0"});
    match checked {
        Ok(checked) => {
            result["status"] = json!("code-only");
            result["nodeMap"] =
                api::metadata(&json!({}), build_id, Some(&checked))["nodeMap"].clone();
            if let Some((tree, blocks)) = project(&checked, meter) {
                let canonical = text(&tree);
                syntax::charge(
                    meter,
                    canonical.len(),
                    checked.program.nodes[checked.program.root].range,
                )
                .map_err(|e| e.code)?;
                let rebuilt = syntax::parse(&canonical, meter)
                    .and_then(|p| check::check(p, meter))
                    .map_err(|e| e.code)?;
                if let Some((other, _)) = project(&rebuilt, meter)
                    && without_ids(&tree) == without_ids(&other)
                {
                    result["status"] = json!("mapped");
                    result["program"] = flat_program(tree);
                    result["blockMap"] = json!(blocks);
                }
            }
        }
        Err(e) => {
            if api::status(e.code) == "limited" || e.code == "E_CANCELLED" {
                return Err(e.code);
            }
            result["status"] = json!(if e.code == "E_UNSUPPORTED_SYNTAX" {
                "unsupported"
            } else {
                "invalid"
            });
            result["diagnostics"] = json!([{"code":e.code,"byteRange":e.byte_range}]);
        }
    }
    meter
        .check_commit()
        .map_err(|e| api::codec_code(codec::CodecError::Budget(e)))?;
    codec::encode(&result, meter, meter.limits().result_bytes).map_err(api::codec_code)
}
