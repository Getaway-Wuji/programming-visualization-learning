use crate::{
    ByteRange, Fault, Meter, charge,
    eval::{self, E, Field, Type},
    model::{self, Cell, Control, Database, Session, SqlResult, State, Table, Transaction},
    syntax::{Program, Projection, QueryPlan, Relation, Stmt},
};
use serde::Serialize;
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
};

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub database_bytes: usize,
    pub fuel: usize,
    pub result_bytes: usize,
    pub rows_examined: usize,
    pub steps: usize,
}
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum Component {
    Session(Session),
    Result(SqlResult),
    Control(Control),
}
#[derive(Clone, Serialize)]
pub struct Change {
    pub after: Component,
    pub before: Component,
    pub component: &'static str,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub changes: Vec<Change>,
    pub event: &'static str,
    pub node_id: usize,
    pub seq: usize,
}
#[derive(Clone, Serialize)]
pub struct Checkpoint {
    pub cursor: usize,
    pub state: State,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub checkpoints: Vec<Checkpoint>,
    pub completeness: &'static str,
    pub initial_state: State,
    pub steps: Vec<Step>,
}
pub struct Run {
    pub fault: Option<Fault>,
    pub state: State,
    pub trace: Trace,
    pub features: Vec<String>,
    // Private judge evidence, derived from one real transaction episode.
    pub rolled_back_write: bool,
}
struct Runner<'a> {
    state: State,
    trace: Trace,
    features: BTreeSet<String>,
    meter: &'a mut Meter,
    usage: &'a mut Usage,
    node: usize,
    range: ByteRange,
    trace_bytes: usize,
    episode_written: bool,
    rolled_back_write: bool,
}
fn size<T: Serialize>(v: &T) -> Result<usize, &'static str> {
    serde_json::to_vec(v)
        .map(|v| v.len())
        .map_err(|_| "E_RESULT_LIMIT")
}
fn fields(t: &Table, alias: &str) -> Vec<Field> {
    t.columns
        .iter()
        .map(|c| Field {
            table: alias.into(),
            name: c.name.clone(),
            kind: if c.kind == "int" {
                Type::Int
            } else {
                Type::Text
            },
        })
        .collect()
}
fn table_index(db: &Database, n: &str) -> Result<usize, &'static str> {
    db.tables
        .iter()
        .position(|t| t.name.eq_ignore_ascii_case(n))
        .ok_or("E_TABLE_UNKNOWN")
}
impl Runner<'_> {
    fn fault(&self, c: &'static str) -> Fault {
        Fault::new(c, self.range)
    }
    fn feature(&mut self, n: &str) {
        self.features.insert(n.into());
    }
    fn candidate(&mut self, db: &Database) -> Result<(), Fault> {
        let bytes = model::database(db).map_err(|c| self.fault(c))?;
        self.usage.database_bytes = self.usage.database_bytes.max(bytes);
        Ok(())
    }
    fn emit(&mut self, event: &'static str, after: State) -> Result<(), Fault> {
        if self.usage.steps >= 2048 {
            return Err(self.fault("E_STEP_LIMIT"));
        }
        let peak = model::session(&after.session).map_err(|c| self.fault(c))?;
        if after.result.columns.len() > 32 {
            return Err(self.fault("E_COLUMN_LIMIT"));
        }
        if after.result.rows.len() > 256 {
            return Err(self.fault("E_ROW_LIMIT"));
        }
        let mut changes = vec![];
        if self.state.session != after.session {
            changes.push(Change {
                after: Component::Session(after.session.clone()),
                before: Component::Session(self.state.session.clone()),
                component: "session",
            });
        }
        if self.state.result != after.result {
            changes.push(Change {
                after: Component::Result(after.result.clone()),
                before: Component::Result(self.state.result.clone()),
                component: "result",
            });
        }
        if self.state.control != after.control {
            changes.push(Change {
                after: Component::Control(after.control.clone()),
                before: Component::Control(self.state.control.clone()),
                component: "control",
            });
        }
        let step = Step {
            changes,
            event,
            node_id: self.node,
            seq: self.trace.steps.len() + 1,
        };
        let checkpoint = step.seq.is_multiple_of(128).then(|| Checkpoint {
            cursor: step.seq,
            state: after.clone(),
        });
        let bytes = size(&step).map_err(|c| self.fault(c))?
            + 1
            + checkpoint
                .as_ref()
                .map(size)
                .transpose()
                .map_err(|c| self.fault(c))?
                .unwrap_or(0)
            + usize::from(checkpoint.is_some());
        if self.trace_bytes + bytes + 4096 > 8_388_608 {
            return Err(self.fault("E_RESULT_LIMIT"));
        }
        self.meter
            .reserve_result(self.trace_bytes + bytes + 131072)
            .map_err(|e| self.fault(crate::budget_code(e)))?;
        charge(self.meter, bytes.div_ceil(64) + 1, self.range)?;
        self.meter
            .check_commit()
            .map_err(|e| self.fault(crate::budget_code(e)))?;
        // Admission is complete: no fallible operation remains before publication.
        self.trace_bytes += bytes;
        self.usage.steps += 1;
        self.usage.database_bytes = self.usage.database_bytes.max(peak);
        self.state = after;
        self.trace.steps.push(step);
        if let Some(c) = checkpoint {
            self.trace.checkpoints.push(c);
        }
        Ok(())
    }
    fn phase(
        &mut self,
        event: &'static str,
        table: Option<&str>,
        row_ids: Vec<usize>,
    ) -> Result<(), Fault> {
        let mut s = self.state.clone();
        s.control = Control {
            phase: event.into(),
            row_ids,
            statement: Some(self.node),
            table: table.map(str::to_string),
        };
        self.emit(event, s)
    }
    fn scan(&mut self, t: &Table) -> Result<(), Fault> {
        for r in &t.rows {
            charge(self.meter, 1, self.range)?;
            self.usage.rows_examined += 1;
            self.phase("scan", Some(&t.name), vec![r.id])?;
        }
        Ok(())
    }
    fn bind(
        &self,
        e: &sqlparser::ast::Expr,
        s: &[Field],
        aliases: &[(String, E, Type)],
    ) -> Result<(E, Type), Fault> {
        eval::bind(e, s, aliases, 0).map_err(|c| self.fault(c))
    }
    fn bind_condition(
        &self,
        e: &sqlparser::ast::Expr,
        s: &[Field],
        aliases: &[(String, E, Type)],
    ) -> Result<E, Fault> {
        let (e, t) = self.bind(e, s, aliases)?;
        if !matches!(t, Type::Null | Type::Int) {
            return Err(self.fault("E_TYPE"));
        }
        Ok(e)
    }
    fn value(&mut self, e: &E, row: &[Cell]) -> Result<Cell, Fault> {
        let refs = row.iter().collect::<Vec<_>>();
        self.value_ref(e, &refs, None)
    }
    fn value_ref(&mut self, e: &E, row: &[&Cell], g: Option<&[Vec<&Cell>]>) -> Result<Cell, Fault> {
        eval::eval(e, row, g, self.meter, self.range, 0)
    }
    fn condition_ref(
        &mut self,
        e: &E,
        row: &[&Cell],
        g: Option<&[Vec<&Cell>]>,
    ) -> Result<bool, Fault> {
        let v = self.value_ref(e, row, g)?;
        eval::truth(&v)
            .map(|v| v == Some(true))
            .map_err(|c| self.fault(c))
    }
    fn publish(
        &mut self,
        event: &'static str,
        session: Session,
        result: SqlResult,
        table: Option<String>,
    ) -> Result<(), Fault> {
        let write = matches!(event, "insert" | "update" | "delete")
            && session.database != self.state.session.database
            && self.state.session.transaction.active;
        let rolled_back_write =
            event == "rollback" && self.state.session.transaction.active && self.episode_written;
        let mut s = self.state.clone();
        s.session = session;
        s.result = result;
        s.control = Control {
            phase: "done".into(),
            row_ids: vec![],
            statement: Some(self.node),
            table,
        };
        self.emit(event, s)?;
        if matches!(event, "begin" | "commit" | "rollback") {
            self.episode_written = false;
        }
        if write {
            self.episode_written = true;
        }
        if rolled_back_write {
            self.rolled_back_write = true;
        }
        if !matches!(event, "drop" | "truncate") {
            self.feature(event);
        }
        if write {
            self.feature("transaction-write");
        }
        Ok(())
    }
    fn query(&mut self, p: &QueryPlan) -> Result<(), Fault> {
        let mut schema = vec![];
        let mut relations = vec![];
        let mut aliases = BTreeSet::new();
        for j in &p.tables {
            if !aliases.insert(j.table.alias.to_ascii_lowercase()) {
                return Err(self.fault("E_NAME"));
            }
            let i = table_index(&self.state.session.database, &j.table.name)
                .map_err(|c| self.fault(c))?;
            let t = self.state.session.database.tables[i].clone();
            schema.extend(fields(&t, &j.table.alias));
            let on =
                j.on.as_ref()
                    .map(|e| self.bind(e, &schema, &[]))
                    .transpose()?;
            if let Some((_, ty)) = &on
                && !matches!(ty, Type::Int | Type::Null)
            {
                return Err(self.fault("E_TYPE"));
            }
            relations.push((j, t, on.map(|(e, _)| e)));
        }
        let mut projection = vec![];
        for x in &p.projection {
            match x {
                Projection::Expr(e, n) => {
                    let (e, t) = self.bind(e, &schema, &[])?;
                    projection.push((n.clone(), e, t));
                }
                Projection::Star(t) => {
                    let mut found = false;
                    for (i, f) in schema.iter().enumerate() {
                        if t.as_ref().is_none_or(|t| f.table.eq_ignore_ascii_case(t)) {
                            projection.push((f.name.clone(), E::Col(i), f.kind));
                            found = true;
                        }
                    }
                    if !found {
                        return Err(self.fault("E_NAME"));
                    }
                }
            }
        }
        if projection.len() > 32 || projection.iter().any(|(n, _, _)| n.chars().count() > 256) {
            return Err(self.fault("E_COLUMN_LIMIT"));
        }
        let group_aliases = projection
            .iter()
            .filter(|(n, _, _)| !schema.iter().any(|f| f.name.eq_ignore_ascii_case(n)))
            .cloned()
            .collect::<Vec<_>>();
        let group = p
            .group
            .iter()
            .map(|e| self.bind(e, &schema, &group_aliases).map(|(e, _)| e))
            .collect::<Result<Vec<_>, _>>()?;
        if group.iter().any(E::aggregate) {
            return Err(self.fault("E_GROUP"));
        }
        let selection = p
            .selection
            .as_ref()
            .map(|e| self.bind_condition(e, &schema, &[]))
            .transpose()?;
        let having = p
            .having
            .as_ref()
            // MySQL resolves FROM/grouped source columns before SELECT aliases
            // in HAVING; ORDER BY below intentionally has the reverse order.
            .map(|e| self.bind_condition(e, &schema, &group_aliases))
            .transpose()?;
        let mut order = vec![];
        for (e, asc) in &p.order {
            let bound = if let sqlparser::ast::Expr::Value(v) = e
                && let sqlparser::ast::Value::Number(n, false) = &v.value
            {
                let i = n.parse::<usize>().map_err(|_| self.fault("E_NAME"))?;
                projection
                    .get(i.checked_sub(1).ok_or_else(|| self.fault("E_NAME"))?)
                    .map(|(_, e, _)| e.clone())
                    .ok_or_else(|| self.fault("E_NAME"))?
            } else {
                self.bind(e, &schema, &projection)?.0
            };
            if p.distinct && !projection.iter().any(|(_, e, _)| *e == bound) {
                return Err(self.fault("E_UNSUPPORTED"));
            }
            order.push((bound, *asc));
        }
        if projection
            .iter()
            .any(|(_, e, _)| e.average() && !e.direct_average())
            || having.as_ref().is_some_and(E::average)
            || order.iter().any(|(e, _)| e.average())
            || (p.distinct && projection.iter().any(|(_, e, _)| e.average()))
        {
            return Err(self.fault("E_UNSUPPORTED"));
        }
        let aggregated = !group.is_empty()
            || projection.iter().any(|(_, e, _)| e.aggregate())
            || having.as_ref().is_some_and(E::aggregate)
            || order.iter().any(|(e, _)| e.aggregate());
        if aggregated
            && (projection.iter().any(|(_, e, _)| !e.grouped(&group))
                || having.as_ref().is_some_and(|e| !e.grouped(&group))
                || order.iter().any(|(e, _)| !e.grouped(&group)))
        {
            return Err(self.fault("E_GROUP"));
        }
        self.feature("select");
        let mut rows = vec![vec![]];
        let mut width = 0;
        for (j, t, on) in &relations {
            self.scan(t)?;
            let mut next = vec![];
            for left in &rows {
                let mut matched = false;
                for r in &t.rows {
                    charge(self.meter, 1, self.range)?;
                    let mut row = left.clone();
                    row.extend(r.values.iter());
                    let accepted = if let Some(e) = &on {
                        self.condition_ref(e, &row, None)?
                    } else {
                        true
                    };
                    if accepted {
                        matched = true;
                        next.push(row);
                        if next.len() > 4096 {
                            return Err(self.fault("E_ROW_LIMIT"));
                        }
                    }
                }
                if !matched && j.kind == "left" {
                    let mut row = left.clone();
                    row.extend(std::iter::repeat_n(&Cell::Null, t.columns.len()));
                    next.push(row);
                    if next.len() > 4096 {
                        return Err(self.fault("E_ROW_LIMIT"));
                    }
                }
            }
            width += t.columns.len();
            rows = next;
            if j.kind != "cross" {
                self.phase("join", None, vec![])?;
                self.feature(if j.kind == "left" {
                    "left-join"
                } else {
                    "inner-join"
                });
            }
        }
        if let Some(e) = &selection {
            let mut filtered = vec![];
            for row in rows {
                if self.condition_ref(e, &row, None)? {
                    filtered.push(row);
                }
            }
            rows = filtered;
            self.phase("filter", None, vec![])?;
            self.feature("filter");
        }
        let groups = if aggregated {
            if group.is_empty() {
                vec![rows]
            } else {
                let mut groups: BTreeMap<Vec<Cell>, Vec<Vec<&Cell>>> = BTreeMap::new();
                for row in rows {
                    let mut key = vec![];
                    for e in &group {
                        key.push(self.value_ref(e, &row, None)?);
                    }
                    groups.entry(key).or_default().push(row);
                    if groups.len() > 256 {
                        return Err(self.fault("E_ROW_LIMIT"));
                    }
                }
                groups.into_values().collect()
            }
        } else {
            rows.into_iter().map(|r| vec![r]).collect()
        };
        if aggregated {
            self.phase("group", None, vec![])?;
            if !p.group.is_empty() {
                self.feature("group");
            }
            if projection.iter().any(|(_, e, _)| e.aggregate())
                || having.as_ref().is_some_and(E::aggregate)
            {
                self.feature("aggregate");
            }
        }
        let mut result: Vec<(Vec<Cell>, Vec<Cell>)> = vec![];
        let early_limit = order.is_empty() && !p.distinct;
        let mut passing = 0usize;
        let mut work_bytes = 0usize;
        for g in groups {
            let empty = vec![&Cell::Null; width];
            let row = g.first().unwrap_or(&empty);
            let gg = aggregated.then_some(g.as_slice());
            if let Some(e) = &having
                && !self.condition_ref(e, row, gg)?
            {
                continue;
            }
            if p.limit.is_some_and(|(_, limit)| limit == 0) {
                break;
            }
            if early_limit && let Some((offset, limit)) = p.limit {
                let ordinal = passing;
                passing += 1;
                if ordinal < offset {
                    continue;
                }
                if ordinal - offset >= limit {
                    break;
                }
            }
            let mut values = vec![];
            for (_, e, _) in &projection {
                values.push(self.value_ref(e, row, gg)?);
            }
            let mut keys = vec![];
            for (e, _) in &order {
                keys.push(self.value_ref(e, row, gg)?);
            }
            // Relations borrow verified cells. Only projected/sort values own
            // text; admit that working set before retaining the next row. The
            // reserve covers the typed trace, parser, profiles and final packet
            // within the same frozen 128 MiB linear memory ceiling.
            work_bytes += std::mem::size_of::<(Vec<Cell>, Vec<Cell>)>()
                + (values.capacity() + keys.capacity()) * std::mem::size_of::<Cell>()
                + values
                    .iter()
                    .chain(&keys)
                    .map(|c| {
                        if let Cell::Text { value } | Cell::Decimal { value } = c {
                            value.len()
                        } else {
                            0
                        }
                    })
                    .sum::<usize>();
            if work_bytes
                .saturating_add(self.trace_bytes.saturating_mul(3))
                .saturating_add(16 * 1024 * 1024)
                > 128 * 1024 * 1024
            {
                return Err(self.fault("E_MEMORY_LIMIT"));
            }
            result.push((values, keys));
        }
        self.phase("project", None, vec![])?;
        self.feature("projection");
        if p.distinct {
            // Keep only references to the already admitted projected values.
            // Cloning each row here would retain a second, unmetered text set.
            let keep = {
                let mut seen = BTreeSet::new();
                let mut keep = Vec::with_capacity(result.len());
                for (v, _) in &result {
                    charge(self.meter, 1, self.range)?;
                    keep.push(seen.insert(v));
                }
                keep
            };
            let mut keep = keep.into_iter();
            result.retain(|_| keep.next().unwrap_or(false));
            self.phase("distinct", None, vec![])?;
            self.feature("distinct");
        }
        if !order.is_empty() {
            let mut fault = None;
            let range = self.range;
            let meter = &mut self.meter;
            result.sort_by(|(_, a), (_, b)| {
                if let Err(e) = charge(meter, 1, range) {
                    fault = Some(e);
                    return Ordering::Equal;
                }
                for ((a, b), (_, asc)) in a.iter().zip(b).zip(&order) {
                    match eval::compare(a, b) {
                        Ok(c) if c != Ordering::Equal => return if *asc { c } else { c.reverse() },
                        Err(c) => {
                            fault = Some(Fault::new(c, range));
                            return Ordering::Equal;
                        }
                        _ => {}
                    }
                }
                Ordering::Equal
            });
            if let Some(e) = fault {
                return Err(e);
            }
            self.phase("order", None, vec![])?;
            self.feature("order");
        }
        if let Some((offset, limit)) = p.limit {
            if !early_limit {
                result = result.into_iter().skip(offset).take(limit).collect();
            }
            self.phase("limit", None, vec![])?;
            self.feature("limit");
        }
        if result.len() > 256 {
            return Err(self.fault("E_ROW_LIMIT"));
        }
        let mut s = self.state.clone();
        s.result = SqlResult {
            affected_rows: 0,
            columns: projection.iter().map(|(n, _, _)| n.clone()).collect(),
            kind: "query".into(),
            matched_rows: 0,
            rows: result.into_iter().map(|(v, _)| v).collect(),
        };
        s.control = Control {
            phase: "done".into(),
            row_ids: vec![],
            statement: Some(self.node),
            table: None,
        };
        self.emit("done", s)
    }
    fn dml(
        &mut self,
        t: &Relation,
        assign: Option<&[(String, sqlparser::ast::Expr)]>,
        selection: &Option<sqlparser::ast::Expr>,
    ) -> Result<(), Fault> {
        let mut candidate = self.state.session.clone();
        let i = table_index(&candidate.database, &t.name).map_err(|c| self.fault(c))?;
        let old = candidate.database.tables[i].clone();
        let schema = fields(&old, &t.alias);
        let condition = selection
            .as_ref()
            .map(|e| self.bind_condition(e, &schema, &[]))
            .transpose()?;
        let mut assignments = vec![];
        if let Some(asn) = assign {
            for (n, e) in asn {
                let ix =
                    eval::resolve(std::slice::from_ref(n), &schema).map_err(|c| self.fault(c))?;
                let (e, t) = self.bind(e, &schema, &[])?;
                if t != Type::Null && t != schema[ix].kind {
                    return Err(self.fault("E_TYPE"));
                }
                assignments.push((ix, e));
            }
        }
        let mut matched = 0;
        let mut affected = 0;
        let mut remove = vec![];
        for (ri, row) in old.rows.iter().enumerate() {
            charge(self.meter, 1, self.range)?;
            self.usage.rows_examined += 1;
            self.phase("scan", Some(&old.name), vec![row.id])?;
            if let Some(e) = &condition
                && !self.condition_ref(e, &row.values.iter().collect::<Vec<_>>(), None)?
            {
                continue;
            }
            matched += 1;
            if assign.is_some() {
                let mut values = candidate.database.tables[i].rows[ri].values.clone();
                for (ci, e) in &assignments {
                    values[*ci] = self.value(e, &values)?;
                    model::stored(&values[*ci], &old.columns[*ci]).map_err(|c| self.fault(c))?;
                }
                if values != row.values {
                    affected += 1;
                }
                candidate.database.tables[i].rows[ri].values = values;
                self.candidate(&candidate.database)?;
            } else {
                remove.push(row.id);
                affected += 1;
            }
        }
        if condition.is_some() {
            self.phase("filter", None, vec![])?;
            self.feature("filter");
        }
        if assign.is_none() {
            candidate.database.tables[i]
                .rows
                .retain(|r| !remove.contains(&r.id));
        }
        let mut result = SqlResult::empty("mutation");
        result.affected_rows = affected;
        result.matched_rows = if assign.is_some() { matched } else { 0 };
        self.publish(
            if assign.is_some() { "update" } else { "delete" },
            candidate,
            result,
            Some(old.name),
        )
    }
    fn statement(&mut self, s: &Stmt) -> Result<(), Fault> {
        self.phase("statement", None, vec![])?;
        match s {
            Stmt::Query(p) => self.query(p),
            Stmt::Update(t, a, c) => self.dml(t, Some(a), c),
            Stmt::Delete(t, c) => self.dml(t, None, c),
            Stmt::Create(n, if_not, cols) => {
                if self.state.session.transaction.active {
                    return Err(self.fault("E_UNSUPPORTED"));
                }
                let mut candidate = self.state.session.clone();
                if table_index(&candidate.database, n).is_ok() {
                    if !if_not {
                        return Err(self.fault("E_TABLE_EXISTS"));
                    }
                } else {
                    let mut out = vec![];
                    let mut names = BTreeSet::new();
                    for (c, d) in cols {
                        let mut c = c.clone();
                        if !names.insert(c.name.to_ascii_lowercase()) {
                            return Err(self.fault("E_NAME"));
                        }
                        if let Some(d) = d {
                            let (e, _) = self.bind(d, &[], &[])?;
                            c.default_value = Some(self.value(&e, &[])?);
                        }
                        out.push(c);
                    }
                    if out.iter().filter(|c| c.primary_key).count() > 1 {
                        return Err(self.fault("E_CONSTRAINT"));
                    }
                    candidate.database.tables.push(Table {
                        columns: out,
                        name: n.clone(),
                        rows: vec![],
                    });
                }
                self.publish("create", candidate, SqlResult::empty("ddl"), None)
            }
            Stmt::Drop(n, _) | Stmt::Truncate(n) => {
                if self.state.session.transaction.active {
                    return Err(self.fault("E_UNSUPPORTED"));
                }
                let mut candidate = self.state.session.clone();
                let i = table_index(&candidate.database, n);
                if let Ok(i) = i {
                    if matches!(s, Stmt::Drop(..)) {
                        candidate.database.tables.remove(i);
                    } else {
                        candidate.database.tables[i].rows.clear();
                    }
                } else if !matches!(s, Stmt::Drop(_, true)) {
                    return Err(self.fault("E_TABLE_UNKNOWN"));
                }
                let table = if matches!(s, Stmt::Truncate(_)) {
                    table_index(&candidate.database, n)
                        .ok()
                        .map(|i| candidate.database.tables[i].name.clone())
                } else {
                    None
                };
                self.publish(
                    if matches!(s, Stmt::Drop(..)) {
                        "drop"
                    } else {
                        "truncate"
                    },
                    candidate,
                    SqlResult::empty("ddl"),
                    table,
                )
            }
            Stmt::Insert(n, names, rows) => {
                let mut candidate = self.state.session.clone();
                let i = table_index(&candidate.database, n).map_err(|c| self.fault(c))?;
                let schema = fields(&candidate.database.tables[i], n);
                let cols = candidate.database.tables[i].columns.clone();
                let indices = if names.is_empty() {
                    (0..cols.len()).collect::<Vec<_>>()
                } else {
                    names
                        .iter()
                        .map(|n| {
                            eval::resolve(std::slice::from_ref(n), &schema)
                                .map_err(|c| self.fault(c))
                        })
                        .collect::<Result<Vec<_>, _>>()?
                };
                let mut unique = BTreeSet::new();
                if indices.iter().any(|i| !unique.insert(*i)) {
                    return Err(self.fault("E_NAME"));
                }
                for row in rows {
                    if row.len() != indices.len() {
                        return Err(self.fault("E_TYPE"));
                    }
                    let mut values = cols
                        .iter()
                        .map(|c| c.default_value.clone().unwrap_or(Cell::Null))
                        .collect::<Vec<_>>();
                    for (e, ci) in row.iter().zip(&indices) {
                        let (e, _) = self.bind(e, &[], &[])?;
                        values[*ci] = self.value(&e, &[])?;
                    }
                    if candidate.database.next_row_id > 4096 {
                        return Err(self.fault("E_ROW_ID_LIMIT"));
                    }
                    candidate.database.tables[i].rows.push(model::Row {
                        id: candidate.database.next_row_id,
                        values,
                    });
                    candidate.database.next_row_id += 1;
                    self.candidate(&candidate.database)?;
                }
                let mut result = SqlResult::empty("mutation");
                result.affected_rows = rows.len();
                let table = candidate.database.tables[i].name.clone();
                self.publish("insert", candidate, result, Some(table))
            }
            Stmt::Begin | Stmt::Commit | Stmt::Rollback => {
                let mut candidate = self.state.session.clone();
                let event = match s {
                    Stmt::Begin => {
                        if candidate.transaction.active {
                            return Err(self.fault("E_TRANSACTION"));
                        }
                        candidate.transaction = Transaction {
                            active: true,
                            base: Some(candidate.database.clone()),
                        };
                        "begin"
                    }
                    Stmt::Commit => {
                        candidate.transaction = Transaction {
                            active: false,
                            base: None,
                        };
                        "commit"
                    }
                    _ => {
                        if let Some(base) = candidate.transaction.base.take() {
                            candidate.database = base;
                        }
                        candidate.transaction = Transaction {
                            active: false,
                            base: None,
                        };
                        "rollback"
                    }
                };
                self.publish(event, candidate, SqlResult::empty("transaction"), None)
            }
        }
    }
}
pub fn run(program: &Program, session: Session, meter: &mut Meter, usage: &mut Usage) -> Run {
    let state = State::initial(session);
    let trace = Trace {
        checkpoints: vec![Checkpoint {
            cursor: 0,
            state: state.clone(),
        }],
        completeness: "complete",
        initial_state: state.clone(),
        steps: vec![],
    };
    let trace_bytes = size(&trace).unwrap_or(8_388_608);
    let mut runner = Runner {
        state,
        trace,
        features: BTreeSet::new(),
        meter,
        usage,
        node: 1,
        range: crate::span(0, 0),
        trace_bytes,
        episode_written: false,
        rolled_back_write: false,
    };
    let mut fault = None;
    for (s, n) in program.statements.iter().zip(&program.nodes) {
        runner.node = n.id;
        runner.range = n.byte_range;
        if let Err(e) = runner.statement(s) {
            fault = Some(e);
            runner.trace.completeness = "prefix";
            break;
        }
    }
    Run {
        fault,
        state: runner.state,
        trace: runner.trace,
        features: runner.features.into_iter().collect(),
        rolled_back_write: runner.rolled_back_write,
    }
}
