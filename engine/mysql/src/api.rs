use crate::{
    Fault, Meter, budget_code, charge, codec,
    model::{self, Cell, Column, Session, SqlResult},
    runtime::{self, Run, Trace, Usage},
    span, syntax,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profiles {
    profiles: Vec<Profile>,
}
#[derive(Deserialize)]
struct Profile {
    id: String,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    session: Session,
    expected_result: SqlResult,
    expected_database: ExpectedDatabase,
    expected_transaction_active: bool,
    ordered: bool,
    check_column_names: bool,
    required_features: Vec<String>,
}
#[derive(Deserialize)]
struct ExpectedDatabase {
    tables: Vec<ExpectedTable>,
}
#[derive(Deserialize)]
struct ExpectedTable {
    name: String,
    columns: Vec<Column>,
    rows: Vec<Vec<Cell>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Identity<'a> {
    run_id: &'a str,
    source_revision: &'a str,
}
#[derive(Serialize)]
struct Terminal {
    cursor: usize,
    diagnostic: Option<Fault>,
    status: &'static str,
}
#[derive(Serialize)]
struct Replay {
    features: Vec<String>,
    terminal: Terminal,
    trace: Trace,
}
#[derive(Serialize)]
struct CaseResult {
    diagnostic: Option<Fault>,
    index: usize,
    passed: bool,
    reason: &'static str,
    status: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Judgement {
    cases: Vec<CaseResult>,
    complete: bool,
    passed: bool,
    review_case: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response<'a> {
    build_id: &'a str,
    diagnostic: Option<Fault>,
    dialect: &'static str,
    identity: Identity<'a>,
    judgement: Option<Judgement>,
    language: &'static str,
    node_map: Vec<syntax::Node>,
    operation: &'a str,
    replay: Option<Replay>,
    status: &'static str,
    usage: Usage,
    version: &'static str,
}
fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str, &'static str> {
    v.get(k).and_then(Value::as_str).ok_or("E_REQUEST_INVALID")
}
fn opaque(s: &str) -> bool {
    !s.is_empty() && s.len() <= 96 && s.bytes().all(|b| (32..=126).contains(&b))
}
fn closed(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}
fn cell_shape(v: &Value) -> bool {
    match v["kind"].as_str() {
        Some("null") => closed(v, &["kind"]),
        Some("int" | "text") => closed(v, &["kind", "value"]),
        _ => false,
    }
}
fn database_shape(v: &Value) -> bool {
    closed(v, &["tables", "nextRowId"])
        && v["tables"].as_array().is_some_and(|tables| {
            tables.iter().all(|t| {
                closed(t, &["name", "columns", "rows"])
                    && t["columns"].as_array().is_some_and(|cols| {
                        cols.iter().all(|c| {
                            closed(
                                c,
                                &[
                                    "name",
                                    "type",
                                    "length",
                                    "nullable",
                                    "primaryKey",
                                    "unique",
                                    "defaultValue",
                                ],
                            ) && (c["defaultValue"].is_null() || cell_shape(&c["defaultValue"]))
                        })
                    })
                    && t["rows"].as_array().is_some_and(|rows| {
                        rows.iter().all(|r| {
                            closed(r, &["id", "values"])
                                && r["values"]
                                    .as_array()
                                    .is_some_and(|values| values.iter().all(cell_shape))
                        })
                    })
            })
        })
}
fn session_shape(v: &Value) -> bool {
    closed(v, &["database", "transaction"])
        && database_shape(&v["database"])
        && closed(&v["transaction"], &["active", "base"])
        && (v["transaction"]["base"].is_null() || database_shape(&v["transaction"]["base"]))
}
fn packet(r: Run) -> Replay {
    Replay {
        features: r.features,
        terminal: Terminal {
            cursor: r.trace.steps.len(),
            diagnostic: r.fault.clone(),
            status: r.fault.as_ref().map_or("completed", Fault::status),
        },
        trace: r.trace,
    }
}
fn same_result(a: &SqlResult, b: &SqlResult, ordered: bool, names: bool) -> bool {
    if a.columns.len() != b.columns.len() {
        return false;
    }
    let mut a = a.clone();
    let mut b = b.clone();
    if !names {
        a.columns.clear();
        b.columns.clear();
    }
    if !ordered {
        a.rows.sort();
        b.rows.sort();
    }
    a == b
}
fn same_database(actual: &model::Database, expected: &ExpectedDatabase) -> bool {
    let mut a = actual
        .tables
        .iter()
        .map(|t| {
            let mut columns = t.columns.clone();
            for c in &mut columns {
                c.name = c.name.to_ascii_lowercase();
            }
            let mut rows = t.rows.iter().map(|r| r.values.clone()).collect::<Vec<_>>();
            rows.sort();
            (t.name.to_ascii_lowercase(), columns, rows)
        })
        .collect::<Vec<_>>();
    let mut b = expected
        .tables
        .iter()
        .map(|t| {
            let mut columns = t.columns.clone();
            for c in &mut columns {
                c.name = c.name.to_ascii_lowercase();
            }
            let mut rows = t.rows.clone();
            rows.sort();
            (t.name.to_ascii_lowercase(), columns, rows)
        })
        .collect::<Vec<_>>();
    a.sort_by(|a, b| a.0.cmp(&b.0));
    b.sort_by(|a, b| a.0.cmp(&b.0));
    a == b
}
/// Execute the current request source. Fixed profiles supply inputs and comparisons only.
pub fn execute(bytes: &[u8], build_id: &str, meter: &mut Meter) -> Result<Vec<u8>, &'static str> {
    if build_id.len() != 64
        || !build_id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("E_REQUEST_INVALID");
    }
    let decoded = codec::decode(bytes, meter, 262144).map_err(|e| match e {
        codec::CodecError::Budget(e) => budget_code(e),
        _ => "E_REQUEST_INVALID",
    })?;
    let op = text(&decoded, "operation")?;
    let keys: &[&str] = match op {
        "execute" => &[
            "version",
            "language",
            "dialect",
            "runId",
            "sourceRevision",
            "source",
            "operation",
            "session",
        ],
        "judge" => &[
            "version",
            "language",
            "dialect",
            "runId",
            "sourceRevision",
            "source",
            "operation",
            "profile",
            "reviewCase",
        ],
        _ => return Err("E_REQUEST_INVALID"),
    };
    let obj = decoded.as_object().ok_or("E_REQUEST_INVALID")?;
    if obj.len() != keys.len() || keys.iter().any(|k| !obj.contains_key(*k)) {
        return Err("E_REQUEST_INVALID");
    }
    if text(&decoded, "version")? != "1.0.0"
        || text(&decoded, "language")? != "mysql"
        || text(&decoded, "dialect")? != "8.0"
    {
        return Err("E_VERSION_UNSUPPORTED");
    }
    let run_id = text(&decoded, "runId")?;
    let revision = text(&decoded, "sourceRevision")?;
    if !opaque(run_id) || !opaque(revision) {
        return Err("E_REQUEST_INVALID");
    }
    let source = text(&decoded, "source")?;
    if source.len() > 32768 {
        return Err("E_SOURCE_LIMIT");
    }
    let mut usage = Usage::default();
    let mut initial = None;
    let mut profile = None;
    let mut review = 0;
    if op == "execute" {
        if !session_shape(&decoded["session"]) {
            return Err("E_SESSION_INVALID");
        }
        let s: Session =
            serde_json::from_value(decoded["session"].clone()).map_err(|_| "E_SESSION_INVALID")?;
        usage.database_bytes = model::session(&s).map_err(|c| {
            if c.ends_with("_LIMIT") {
                c
            } else {
                "E_SESSION_INVALID"
            }
        })?;
        initial = Some(s);
    } else {
        review = decoded["reviewCase"]
            .as_u64()
            .filter(|i| *i < 4)
            .ok_or("E_REQUEST_INVALID")? as usize;
        let id = text(&decoded, "profile")?;
        let set: Profiles = serde_json::from_str(include_str!(
            "../../../shared/contracts/mysql-profiles-1.0.0.json"
        ))
        .map_err(|_| "E_PROFILE_UNKNOWN")?;
        profile = Some(
            set.profiles
                .into_iter()
                .find(|p| p.id == id)
                .ok_or("E_PROFILE_UNKNOWN")?,
        );
    }
    let mut status = "completed";
    let mut diagnostic = None;
    let mut node_map = vec![];
    let mut judgement = None;
    let mut replay = None;
    match syntax::parse(source, meter) {
        Err(e) => {
            status = e.status();
            diagnostic = Some(e);
        }
        Ok(program) => {
            node_map = program.nodes.clone();
            if let Some(initial) = initial {
                let run = runtime::run(&program, initial, meter, &mut usage);
                status = run.fault.as_ref().map_or("completed", Fault::status);
                diagnostic = run.fault.clone();
                replay = Some(packet(run));
            } else if let Some(profile) = profile {
                let mut cases = vec![];
                let mut all = true;
                let mut interrupted = false;
                for (index, case) in profile.cases.into_iter().enumerate() {
                    usage.database_bytes = usage
                        .database_bytes
                        .max(model::session(&case.session).map_err(|_| "E_PROFILE_UNKNOWN")?);
                    let run = runtime::run(&program, case.session, meter, &mut usage);
                    if run.fault.as_ref().is_some_and(|e| e.code == "E_CANCELLED") {
                        return Err("E_CANCELLED");
                    }
                    let cs = run.fault.as_ref().map_or("completed", Fault::status);
                    let reason = if cs == "limited" {
                        "limited"
                    } else if cs == "error" {
                        "program-error"
                    } else if !same_result(
                        &run.state.result,
                        &case.expected_result,
                        case.ordered,
                        case.check_column_names,
                    ) {
                        "wrong-result"
                    } else if !same_database(&run.state.session.database, &case.expected_database)
                        || run.state.session.transaction.active != case.expected_transaction_active
                    {
                        "wrong-database"
                    } else if case
                        .required_features
                        .iter()
                        .any(|f| !run.features.contains(f))
                        || (case
                            .required_features
                            .iter()
                            .any(|f| f == "transaction-write")
                            && case.required_features.iter().any(|f| f == "rollback")
                            && !run.rolled_back_write)
                    {
                        "goal-unmet"
                    } else {
                        "passed"
                    };
                    let passed = reason == "passed";
                    all &= passed;
                    cases.push(CaseResult {
                        diagnostic: run.fault.clone(),
                        index,
                        passed,
                        reason,
                        status: cs,
                    });
                    if cs == "limited" {
                        status = "limited";
                        diagnostic = run.fault.clone();
                        interrupted = true;
                    }
                    if index == review {
                        replay = Some(packet(run));
                    }
                    if interrupted {
                        break;
                    }
                }
                let complete = !interrupted && cases.len() == 4;
                judgement = Some(Judgement {
                    cases,
                    complete,
                    passed: all && complete,
                    review_case: review,
                });
            }
        }
    }
    if diagnostic.as_ref().is_some_and(|e| e.code == "E_CANCELLED") {
        return Err("E_CANCELLED");
    }
    let mut response = Response {
        build_id,
        diagnostic,
        dialect: "8.0",
        identity: Identity {
            run_id,
            source_revision: revision,
        },
        judgement,
        language: "mysql",
        node_map,
        operation: op,
        replay,
        status,
        usage,
        version: "1.0.0",
    };
    meter.begin_finalization().map_err(budget_code)?;
    let mut charged = 0;
    for _ in 0..12 {
        response.usage.fuel = meter.used();
        let bytes = serde_json::to_vec(&response).map_err(|_| "E_RESULT_LIMIT")?;
        if bytes.len() > 16_777_216 {
            return Err("E_RESULT_LIMIT");
        }
        let needed = bytes.len().div_ceil(64);
        if needed > charged {
            charge(meter, needed - charged, span(0, 0)).map_err(|e| e.code)?;
            charged = needed;
            continue;
        }
        if response.usage.result_bytes != bytes.len() {
            response.usage.result_bytes = bytes.len();
            continue;
        }
        meter.check_commit().map_err(budget_code)?;
        return Ok(bytes);
    }
    Err("E_RESULT_LIMIT")
}
