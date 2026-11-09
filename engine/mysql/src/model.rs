use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const SAFE: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Cell {
    Null,
    Int { value: i64 },
    Text { value: String },
    Decimal { value: String },
}
impl Cell {
    pub fn int(value: i64) -> Self {
        Self::Int { value }
    }
    pub fn text(value: impl Into<String>) -> Self {
        Self::Text {
            value: value.into(),
        }
    }
    pub fn null(&self) -> bool {
        matches!(self, Self::Null)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Column {
    pub default_value: Option<Cell>,
    pub length: Option<usize>,
    pub name: String,
    pub nullable: bool,
    pub primary_key: bool,
    #[serde(rename = "type")]
    pub kind: String,
    pub unique: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub id: usize,
    pub values: Vec<Cell>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Table {
    pub columns: Vec<Column>,
    pub name: String,
    pub rows: Vec<Row>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Database {
    pub next_row_id: usize,
    pub tables: Vec<Table>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transaction {
    pub active: bool,
    pub base: Option<Database>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub database: Database,
    pub transaction: Transaction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SqlResult {
    pub affected_rows: usize,
    pub columns: Vec<String>,
    pub kind: String,
    pub matched_rows: usize,
    pub rows: Vec<Vec<Cell>>,
}
impl SqlResult {
    pub fn empty(kind: &str) -> Self {
        Self {
            affected_rows: 0,
            columns: vec![],
            kind: kind.into(),
            matched_rows: 0,
            rows: vec![],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    pub phase: String,
    pub row_ids: Vec<usize>,
    pub statement: Option<usize>,
    pub table: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub control: Control,
    pub result: SqlResult,
    pub session: Session,
}
impl State {
    pub fn initial(session: Session) -> Self {
        Self {
            control: Control {
                phase: "ready".into(),
                row_ids: vec![],
                statement: None,
                table: None,
            },
            result: SqlResult::empty("none"),
            session,
        }
    }
}

pub fn name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_alphabetic() || b == b'_' || (i > 0 && b.is_ascii_digit()))
}
pub fn stored(cell: &Cell, col: &Column) -> Result<(), &'static str> {
    match cell {
        Cell::Null if col.nullable && !col.primary_key => Ok(()),
        Cell::Null => Err("E_CONSTRAINT"),
        Cell::Int { value } if col.kind == "int" => {
            if i32::try_from(*value).is_ok() {
                Ok(())
            } else {
                Err("E_OVERFLOW")
            }
        }
        Cell::Text { value } if col.kind == "varchar" => {
            if value.len() > 1024 || value.chars().count() > col.length.unwrap_or(0) {
                Err("E_TEXT_LIMIT")
            } else {
                Ok(())
            }
        }
        _ => Err("E_TYPE"),
    }
}
pub fn database(db: &Database) -> Result<usize, &'static str> {
    if db.tables.len() > 16 {
        return Err("E_DATABASE_LIMIT");
    }
    if !(1..=4097).contains(&db.next_row_id) {
        return Err("E_ROW_ID_LIMIT");
    }
    let mut names = BTreeSet::new();
    let mut ids = BTreeSet::new();
    let mut count = 0;
    for t in &db.tables {
        if !name(&t.name) || !names.insert(t.name.to_ascii_lowercase()) {
            return Err("E_SESSION_INVALID");
        }
        if t.columns.is_empty() || t.columns.len() > 16 {
            return Err("E_COLUMN_LIMIT");
        }
        let mut cols = BTreeSet::new();
        let mut primary = 0;
        for c in &t.columns {
            if !name(&c.name) || !cols.insert(c.name.to_ascii_lowercase()) {
                return Err("E_SESSION_INVALID");
            }
            match c.kind.as_str() {
                "int" if c.length.is_none() => {}
                "varchar" if c.length.is_some_and(|n| (1..=256).contains(&n)) => {}
                _ => return Err("E_SESSION_INVALID"),
            }
            if c.primary_key {
                primary += 1;
                if c.nullable || !c.unique {
                    return Err("E_SESSION_INVALID");
                }
            }
            if let Some(v) = &c.default_value {
                stored(v, c)?;
            }
        }
        if primary > 1 {
            return Err("E_SESSION_INVALID");
        }
        for r in &t.rows {
            count += 1;
            if r.id == 0
                || r.id >= db.next_row_id
                || r.id > 4096
                || !ids.insert(r.id)
                || r.values.len() != t.columns.len()
            {
                return Err("E_SESSION_INVALID");
            }
            for (v, c) in r.values.iter().zip(&t.columns) {
                stored(v, c)?;
            }
        }
        for (i, c) in t.columns.iter().enumerate() {
            if c.unique || c.primary_key {
                let mut seen = BTreeSet::new();
                for r in &t.rows {
                    if !r.values[i].null() && !seen.insert(&r.values[i]) {
                        return Err("E_CONSTRAINT");
                    }
                }
            }
        }
    }
    if count > 256 {
        return Err("E_ROW_LIMIT");
    }
    let bytes = serde_json::to_vec(db)
        .map_err(|_| "E_DATABASE_LIMIT")?
        .len();
    if bytes > 65536 {
        return Err("E_DATABASE_LIMIT");
    }
    Ok(bytes)
}
pub fn session(s: &Session) -> Result<usize, &'static str> {
    let mut peak = database(&s.database)?;
    match (&s.transaction.active, &s.transaction.base) {
        (false, None) => {}
        (true, Some(base)) => {
            peak = peak.max(database(base)?);
            if s.database.next_row_id < base.next_row_id {
                return Err("E_SESSION_INVALID");
            }
            if base.tables.len() != s.database.tables.len()
                || base
                    .tables
                    .iter()
                    .zip(&s.database.tables)
                    .any(|(a, b)| a.name != b.name || a.columns != b.columns)
            {
                return Err("E_SESSION_INVALID");
            }
        }
        _ => return Err("E_SESSION_INVALID"),
    }
    Ok(peak)
}
