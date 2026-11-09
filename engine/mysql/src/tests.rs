use crate::{budget::Meter, execute};
use serde_json::{Value, json};
fn profiles() -> Value {
    serde_json::from_str(include_str!(
        "../../../shared/contracts/mysql-profiles-1.0.0.json"
    ))
    .unwrap()
}
fn request(source: &str, session: Value) -> Value {
    json!({"version":"1.0.0","language":"mysql","dialect":"8.0","operation":"execute","runId":"host test","sourceRevision":"r1","source":source,"session":session})
}
fn run(req: &Value) -> Result<Value, &'static str> {
    run_meter(req, &mut Meter::new())
}
fn run_meter(req: &Value, meter: &mut Meter) -> Result<Value, &'static str> {
    let bytes = serde_json::to_vec(req).unwrap();
    let out = execute(&bytes, &"a".repeat(64), meter)?;
    let v: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(
        v["usage"]["resultBytes"].as_u64().unwrap() as usize,
        out.len()
    );
    assert_eq!(serde_json::to_vec(&v).unwrap(), out, "canonical producer");
    Ok(v)
}
fn terminal(v: &Value) -> Value {
    let trace = &v["replay"]["trace"];
    let mut state = trace["initialState"].clone();
    assert_eq!(trace["checkpoints"][0]["cursor"], 0);
    assert_eq!(trace["checkpoints"][0]["state"], state);
    let steps = trace["steps"].as_array().unwrap();
    for (i, step) in steps.iter().enumerate() {
        assert_eq!(step["seq"], i + 1);
        for c in step["changes"].as_array().unwrap() {
            let k = c["component"].as_str().unwrap();
            assert_eq!(state[k], c["before"], "before");
            state[k] = c["after"].clone();
        }
        if (i + 1) % 128 == 0 {
            assert_eq!(trace["checkpoints"][(i + 1) / 128]["cursor"], i + 1);
            assert_eq!(trace["checkpoints"][(i + 1) / 128]["state"], state);
        }
    }
    assert_eq!(
        trace["checkpoints"].as_array().unwrap().len(),
        steps.len() / 128 + 1
    );
    assert_eq!(v["replay"]["terminal"]["cursor"], steps.len());
    let terminal = state.clone();
    for step in steps.iter().rev() {
        for c in step["changes"].as_array().unwrap().iter().rev() {
            let k = c["component"].as_str().unwrap();
            assert_eq!(state[k], c["after"]);
            state[k] = c["before"].clone();
        }
    }
    assert_eq!(state, trace["initialState"]);
    terminal
}
#[test]
fn frozen_semantics() {
    let f: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/mysql-semantic-1.0.0.json"
    ))
    .unwrap();
    let p = profiles();
    for v in f["vectors"].as_array().unwrap() {
        let id = v["id"].as_str().unwrap();
        let seed = v["seed"].as_u64().unwrap() as usize;
        let session = v
            .get("sessionOverride")
            .cloned()
            .unwrap_or_else(|| p["profiles"][0]["cases"][seed]["session"].clone());
        let mut req = request(v["source"].as_str().unwrap(), session.clone());
        match v["requestMutation"].as_str() {
            Some("add-unknown-top-level-field") => {
                req["extra"] = json!(1);
            }
            Some("duplicate-logical-row-id") => {
                req["session"]["database"]["tables"][0]["rows"][1]["id"] =
                    req["session"]["database"]["tables"][0]["rows"][0]["id"].clone();
            }
            Some("unknown-judge-profile") => {
                req.as_object_mut().unwrap().remove("session");
                req["operation"] = json!("judge");
                req["profile"] = json!("unknown");
                req["reviewCase"] = json!(0);
            }
            _ => {}
        }
        let got = run(&req);
        if v["expectedStatus"] == "rejected" {
            assert_eq!(
                got.unwrap_err(),
                v["expectedCode"].as_str().unwrap(),
                "{id}"
            );
            continue;
        }
        let got = got.unwrap_or_else(|e| panic!("{id}: {e}"));
        assert_eq!(got["status"], v["expectedStatus"], "{id} {got}");
        assert_eq!(
            got["diagnostic"]
                .get("code")
                .cloned()
                .unwrap_or(Value::Null),
            v["expectedCode"],
            "{id}"
        );
        if !got["replay"].is_null() {
            let state = terminal(&got);
            if let Some(rows) = v.get("expectedRows") {
                let mut actual = state["result"]["rows"].clone();
                let mut expected = rows.clone();
                if v["ordered"] == false {
                    actual
                        .as_array_mut()
                        .unwrap()
                        .sort_by_key(ToString::to_string);
                    expected
                        .as_array_mut()
                        .unwrap()
                        .sort_by_key(ToString::to_string);
                }
                assert_eq!(actual, expected, "{id}");
            }
            if v["unchangedDatabase"] == true {
                assert_eq!(state["session"]["database"], session["database"], "{id}");
            }
            for key in ["AffectedRows", "MatchedRows"] {
                if let Some(expected) = v.get(format!("expected{key}")) {
                    let k = format!("{}{}", key[..1].to_lowercase(), &key[1..]);
                    assert_eq!(state["result"][k], *expected, "{id}");
                }
            }
            if let Some(active) = v.get("expectedTransactionActive") {
                assert_eq!(state["session"]["transaction"]["active"], *active, "{id}");
            }
        }
    }
}
#[test]
fn all_frozen_judges_execute_current_source() {
    let p = profiles();
    for profile in p["profiles"].as_array().unwrap() {
        for review in 0..4 {
            let r = json!({"version":"1.0.0","language":"mysql","dialect":"8.0","operation":"judge","runId":"judge","sourceRevision":"r1","source":profile["referenceSource"],"profile":profile["id"],"reviewCase":review});
            let out = run(&r).unwrap();
            assert_eq!(
                out["judgement"]["passed"], true,
                "{} review={review}: {out}",
                profile["id"]
            );
            terminal(&out);
        }
    }
}

#[test]
fn long_left_associative_expression_is_bounded() {
    let source = format!("SELECT {};", vec!["1"; 4000].join("+"));
    let out = run(&request(&source, profiles()["defaultSession"].clone())).unwrap();
    assert_eq!(out["diagnostic"]["code"], "E_DEPTH_LIMIT");
    assert!(out["replay"].is_null());
    for depth in [24, 32, 48, 64] {
        let source = format!("SELECT {}1{};", "(".repeat(depth), ")".repeat(depth));
        let out = run(&request(&source, profiles()["defaultSession"].clone())).unwrap();
        assert!(out["status"] == "completed" || out["diagnostic"]["code"] == "E_DEPTH_LIMIT");
    }
}

#[test]
fn relational_and_exact_aggregate_variants() {
    let p = profiles();
    let session = p["defaultSession"].clone();
    let cases = [
        (
            "SELECT SUM(score) AS total FROM students HAVING total > 200 ORDER BY total;",
            json!([[{"kind":"decimal","value":"219"}]]),
        ),
        (
            "SELECT COUNT(*) AS n FROM students s CROSS JOIN departments d;",
            json!([[{"kind":"int","value":12}]]),
        ),
        (
            "SELECT dept_id, AVG(score) AS average FROM students GROUP BY dept_id ORDER BY dept_id;",
            json!([[{"kind":"null"},{"kind":"null"}],[{"kind":"int","value":1},{"kind":"decimal","value":"88.0000"}],[{"kind":"int","value":2},{"kind":"decimal","value":"72.0000"}],[{"kind":"int","value":99},{"kind":"decimal","value":"59.0000"}]]),
        ),
        (
            "SELECT name AS student FROM students ORDER BY id DESC LIMIT 1,2;",
            json!([[{"kind":"text","value":"周岚"}],[{"kind":"text","value":"陈禾"}]]),
        ),
        (
            "SELECT COALESCE(NULL, '🌱') AS x, IFNULL('a ', 'b') AS y, 1 NOT BETWEEN 2 AND 3 AS z;",
            json!([[{"kind":"text","value":"🌱"},{"kind":"text","value":"a "},{"kind":"int","value":1}]]),
        ),
        (
            "SELECT id FROM students WHERE id IN (4,2) ORDER BY 1 DESC;",
            json!([[{"kind":"int","value":4}],[{"kind":"int","value":2}]]),
        ),
    ];
    for (source, expected) in cases {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["status"], "completed", "{source}: {out}");
        assert_eq!(terminal(&out)["result"]["rows"], expected, "{source}");
    }
}

#[test]
fn schema_defaults_writes_and_deleted_targets_are_atomic() {
    let session =
        json!({"database":{"tables":[],"nextRowId":1},"transaction":{"active":false,"base":null}});
    let out=run(&request("CREATE TABLE t (a INT PRIMARY KEY, b VARCHAR(4) DEFAULT '🌱'); INSERT INTO T (a) VALUES (1),(2); UPDATE t SET a=a+2; DELETE FROM t WHERE a=3; TRUNCATE T; DROP TABLE T;",session.clone())).unwrap();
    assert_eq!(out["status"], "completed", "{out}");
    let state = terminal(&out);
    assert_eq!(state["session"]["database"]["tables"], json!([]));
    assert_eq!(state["control"]["table"], Value::Null);
    assert_eq!(state["control"]["rowIds"], json!([]));
    let out=run(&request("CREATE TABLE t (a INT, b VARCHAR(4) DEFAULT '🌱', UNIQUE (b)); INSERT INTO t (a) VALUES (1),(2);",session)).unwrap();
    assert_eq!(out["diagnostic"]["code"], "E_CONSTRAINT");
    let state = terminal(&out);
    assert_eq!(state["session"]["database"]["tables"][0]["rows"], json!([]));
    assert_eq!(state["session"]["database"]["nextRowId"], 1);
}

#[test]
fn structural_refusal_precedes_all_execution_and_empty_names_types_are_checked() {
    let p = profiles();
    let full = p["defaultSession"].clone();
    for suffix in [
        "SELECT AVG(score)+1 FROM students;",
        "SELECT AVG(score) FROM students ORDER BY 1;",
        "SELECT DISTINCT AVG(score) FROM students;",
        "CREATE VIEW v AS SELECT 1;",
    ] {
        let source = format!("UPDATE students SET score=0; {suffix}");
        let out = run(&request(&source, full.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], "E_UNSUPPORTED", "{suffix}");
        assert!(out["replay"].is_null());
    }
    let empty = p["profiles"][0]["cases"][2]["session"].clone();
    for (source, code) in [
        ("SELECT id FROM students WHERE 'text';", "E_TYPE"),
        ("UPDATE students SET score='text';", "E_TYPE"),
        (
            "SELECT name,COUNT(*) FROM students GROUP BY dept_id;",
            "E_GROUP",
        ),
        (
            "SELECT s.id FROM students s JOIN departments d ON missing=1;",
            "E_NAME",
        ),
    ] {
        let out = run(&request(source, empty.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], code, "{source}");
        assert_eq!(terminal(&out)["session"], empty);
    }
}

#[test]
fn transaction_continuation_requires_a_real_dml_write_feature() {
    let session = profiles()["defaultSession"].clone();
    let out = run(&request(
        "BEGIN; UPDATE students SET score=99 WHERE id=1;",
        session.clone(),
    ))
    .unwrap();
    let active = terminal(&out)["session"].clone();
    assert!(
        out["replay"]["features"]
            .as_array()
            .unwrap()
            .contains(&json!("transaction-write"))
    );
    let rollback = run(&request("ROLLBACK;", active)).unwrap();
    assert_eq!(terminal(&rollback)["session"], session);
    assert!(
        !rollback["replay"]["features"]
            .as_array()
            .unwrap()
            .contains(&json!("transaction-write"))
    );
}

#[test]
fn step_exhaustion_keeps_the_last_committed_statement() {
    let rows = (1..=64)
        .map(|id| json!({"id":id,"values":[{"kind":"int","value":0}]}))
        .collect::<Vec<_>>();
    let session = json!({"database":{"tables":[{"name":"t","columns":[{"name":"a","type":"int","length":null,"nullable":true,"primaryKey":false,"unique":false,"defaultValue":null}],"rows":rows}],"nextRowId":65},"transaction":{"active":false,"base":null}});
    let source = "UPDATE t SET a=a+1;".repeat(32);
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    let out = run_meter(&request(&source, session), &mut meter).unwrap();
    assert_eq!(out["status"], "limited");
    assert_eq!(out["diagnostic"]["code"], "E_STEP_LIMIT");
    assert_eq!(out["usage"]["steps"], 2048);
    let state = terminal(&out);
    for row in state["session"]["database"]["tables"][0]["rows"]
        .as_array()
        .unwrap()
    {
        assert_eq!(row["values"][0]["value"], 31);
    }
    assert_eq!(out["replay"]["trace"]["completeness"], "prefix");
}

#[test]
fn judge_cases_share_the_frozen_step_budget() {
    let source="SELECT s.id FROM students s CROSS JOIN students x CROSS JOIN students y CROSS JOIN students z LIMIT 0;".repeat(32);
    let req = json!({"version":"1.0.0","language":"mysql","dialect":"8.0","operation":"judge","runId":"shared quota","sourceRevision":"r1","source":source,"profile":"mysql.exercise.projection","reviewCase":0});
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    let out = run_meter(&req, &mut meter).unwrap();
    assert_eq!(out["status"], "limited", "{out}");
    assert_eq!(out["usage"]["steps"], 2048);
    assert_eq!(out["judgement"]["complete"], false);
    assert_eq!(out["judgement"]["passed"], false);
    assert_eq!(out["replay"]["terminal"]["status"], "completed");
    terminal(&out);
}

#[test]
fn session_optional_values_still_require_their_closed_wire_fields() {
    let initial = profiles()["defaultSession"].clone();
    for key in ["length", "defaultValue"] {
        let mut session = initial.clone();
        session["database"]["tables"][0]["columns"][0]
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert_eq!(
            run(&request("SELECT 1;", session)).unwrap_err(),
            "E_SESSION_INVALID"
        );
    }
    let mut session = initial.clone();
    session["transaction"]
        .as_object_mut()
        .unwrap()
        .remove("base");
    assert_eq!(
        run(&request("SELECT 1;", session)).unwrap_err(),
        "E_SESSION_INVALID"
    );
    let source = format!("SELECT {};", vec!["1"; 100].join("+"));
    let out = run(&request(&source, initial)).unwrap();
    assert_eq!(out["diagnostic"]["code"], "E_COLUMN_LIMIT");
}

#[test]
fn wide_utf8_join_uses_borrowed_cells_and_admits_working_memory_before_growth() {
    let text = "🌱".repeat(240);
    let columns=(0..8).map(|i|json!({"name":format!("c{i}"),"type":"varchar","length":256,"nullable":true,"primaryKey":false,"unique":false,"defaultValue":null})).collect::<Vec<_>>();
    let rows=(1..=8).map(|id|json!({"id":id,"values":(0..8).map(|_|json!({"kind":"text","value":text})).collect::<Vec<_>>()})).collect::<Vec<_>>();
    let session = json!({"database":{"tables":[{"name":"t","columns":columns,"rows":rows}],"nextRowId":9},"transaction":{"active":false,"base":null}});
    assert!(serde_json::to_vec(&session["database"]).unwrap().len() <= 65536);
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    let out = run_meter(
        &request(
            "SELECT * FROM t a CROSS JOIN t b CROSS JOIN t c CROSS JOIN t d LIMIT 0;",
            session.clone(),
        ),
        &mut meter,
    )
    .unwrap();
    assert_eq!(out["status"], "completed");
    assert_eq!(terminal(&out)["result"]["rows"], json!([]));
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    let out = run_meter(
        &request(
            "SELECT * FROM t a CROSS JOIN t b CROSS JOIN t c CROSS JOIN t d ORDER BY a.c0 LIMIT 1;",
            session.clone(),
        ),
        &mut meter,
    )
    .unwrap();
    assert_eq!(out["diagnostic"]["code"], "E_MEMORY_LIMIT");
    assert_eq!(terminal(&out)["session"], session);
}

#[test]
fn having_resolves_grouped_source_before_same_named_projection_alias() {
    let session = profiles()["defaultSession"].clone();
    let out = run(&request(
        "SELECT 1 AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;",
        session.clone(),
    ))
    .unwrap();
    assert_eq!(out["status"], "completed", "{out}");
    assert_eq!(
        terminal(&out)["result"]["rows"],
        json!([[{"kind":"int","value":1}],[{"kind":"int","value":1}]])
    );
    let out = run(&request(
        "SELECT AVG(score) AS id FROM students GROUP BY id HAVING id>2;",
        session.clone(),
    ))
    .unwrap();
    assert_eq!(out["status"], "completed", "{out}");
    assert_eq!(
        terminal(&out)["result"]["rows"],
        json!([[{"kind":"null"}],[{"kind":"decimal","value":"59.0000"}]])
    );
    for source in [
        "SELECT AVG(score) AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;",
        "SELECT AVG(score) AS x FROM students GROUP BY id HAVING x>2;",
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], "E_UNSUPPORTED");
    }
}

#[test]
fn primary_key_declarations_cannot_be_silently_merged() {
    let session = profiles()["defaultSession"].clone();
    for source in [
        "CREATE TABLE t(x INT PRIMARY KEY, PRIMARY KEY(x));",
        "CREATE TABLE t(x INT PRIMARY KEY PRIMARY KEY);",
        "CREATE TABLE t(x INT,PRIMARY KEY(x),PRIMARY KEY(x));",
        "CREATE TABLE t(x INT PRIMARY KEY,y INT PRIMARY KEY);",
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], "E_CONSTRAINT", "{source}: {out}");
        assert!(out["replay"].is_null());
    }
    let out = run(&request("CREATE TABLE t(x INT,PRIMARY KEY(x));", session)).unwrap();
    assert_eq!(out["status"], "completed");
}

#[test]
fn lazy_branches_skip_runtime_work_but_preserve_all_static_binding() {
    let session = profiles()["defaultSession"].clone();
    for (source, value) in [
        ("SELECT IFNULL(1,9007199254740991+1);", 1),
        ("SELECT COALESCE(1,9007199254740991+1);", 1),
        ("SELECT COALESCE(NULL,NULL,7,9007199254740991+1);", 7),
        ("SELECT 0 AND (9007199254740991+1);", 0),
        ("SELECT 1 OR (9007199254740991+1);", 1),
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["status"], "completed", "{source}: {out}");
        assert_eq!(
            terminal(&out)["result"]["rows"],
            json!([[{"kind":"int","value":value}]])
        );
    }
    for (source, code) in [
        ("SELECT IFNULL(NULL,9007199254740991+1);", "E_OVERFLOW"),
        ("SELECT 0 OR (9007199254740991+1);", "E_OVERFLOW"),
        ("SELECT 1 AND (9007199254740991+1);", "E_OVERFLOW"),
        ("SELECT NULL AND (9007199254740991+1);", "E_OVERFLOW"),
        ("SELECT IFNULL(1,'text');", "E_TYPE"),
        ("SELECT COALESCE(1,missing) FROM students;", "E_NAME"),
        ("SELECT 0 AND missing FROM students;", "E_NAME"),
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], code, "{source}");
    }
}

#[test]
fn rollback_judge_requires_written_transaction_episode_not_feature_concatenation() {
    let prefix = "START TRANSACTION;UPDATE students SET score=score+5 WHERE score>=70;UPDATE students SET score=score-5 WHERE score>=75;";
    for ending in ["COMMIT;ROLLBACK;", "COMMIT;BEGIN;ROLLBACK;"] {
        let source = format!("{prefix}{ending}SELECT id,score FROM students ORDER BY id;");
        let req = json!({"version":"1.0.0","language":"mysql","dialect":"8.0","operation":"judge","runId":"episode","sourceRevision":"r1","source":source,"profile":"mysql.exercise.transaction","reviewCase":0});
        let out = run(&req).unwrap();
        assert_eq!(out["status"], "completed");
        assert_eq!(out["judgement"]["passed"], false);
        for i in [0, 1, 3] {
            assert_eq!(out["judgement"]["cases"][i]["reason"], "goal-unmet");
        }
        assert_eq!(out["judgement"]["cases"][2]["passed"], true);
        terminal(&out);
    }
    let source = format!("{prefix}ROLLBACK;SELECT id,score FROM students ORDER BY id;");
    let req = json!({"version":"1.0.0","language":"mysql","dialect":"8.0","operation":"judge","runId":"episode","sourceRevision":"r1","source":source,"profile":"mysql.exercise.transaction","reviewCase":0});
    let out = run(&req).unwrap();
    assert_eq!(out["judgement"]["passed"], true, "{out}");
    terminal(&out);
}

#[test]
fn distinct_retains_borrowed_identity_set_without_a_second_text_payload() {
    let text = "😀".repeat(256);
    let columns = json!([{"name":"id","type":"int","length":null,"nullable":false,"primaryKey":true,"unique":true,"defaultValue":null},{"name":"payload","type":"varchar","length":256,"nullable":true,"primaryKey":false,"unique":false,"defaultValue":null}]);
    let rows = (1..=16)
        .map(
            |id| json!({"id":id,"values":[{"kind":"int","value":id},{"kind":"text","value":text}]}),
        )
        .collect::<Vec<_>>();
    let session = json!({"database":{"tables":[{"name":"t","columns":columns,"rows":rows}],"nextRowId":17},"transaction":{"active":false,"base":null}});
    let projection = (0..16)
        .map(|i| format!("a.payload AS p{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let source = format!(
        "SELECT DISTINCT a.id,b.id,c.id,{projection} FROM t a CROSS JOIN t b CROSS JOIN t c LIMIT 1;"
    );
    let mut meter = Meter::new();
    meter.set_clock(1000, Box::new(|| 0));
    let out = run_meter(&request(&source, session.clone()), &mut meter).unwrap();
    assert_eq!(out["status"], "completed", "{out}");
    let state = terminal(&out);
    assert_eq!(state["session"], session);
    assert_eq!(state["result"]["columns"].as_array().unwrap().len(), 19);
    assert_eq!(state["result"]["rows"].as_array().unwrap().len(), 1);
    assert_eq!(state["result"]["rows"][0][0]["value"], 1);
}

#[test]
fn identical_duplicate_result_labels_resolve_without_hiding_conflicts() {
    let session = profiles()["defaultSession"].clone();
    let expected = json!([[{"kind":"int","value":1},{"kind":"int","value":1}],[{"kind":"int","value":2},{"kind":"int","value":2}],[{"kind":"int","value":3},{"kind":"int","value":3}],[{"kind":"int","value":4},{"kind":"int","value":4}]]);
    for source in [
        "SELECT id,id FROM students ORDER BY id;",
        "SELECT id AS x,id AS x FROM students ORDER BY x;",
        "SELECT id AS x,(id) AS X FROM students ORDER BY x;",
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["status"], "completed", "{source}: {out}");
        assert_eq!(terminal(&out)["result"]["rows"], expected);
    }
    for source in [
        "SELECT id AS x,score AS x FROM students ORDER BY x;",
        "SELECT id AS x,name AS x FROM students ORDER BY x;",
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], "E_NAME", "{source}");
        assert_eq!(terminal(&out)["session"], session);
    }
}

#[test]
fn duplicate_alias_resolution_is_consistent_in_group_and_having() {
    let session = profiles()["defaultSession"].clone();
    let out=run(&request("SELECT dept_id AS x,dept_id AS x,COUNT(*) AS n FROM students GROUP BY x HAVING x IS NOT NULL ORDER BY x;",session.clone())).unwrap();
    assert_eq!(out["status"], "completed", "{out}");
    assert_eq!(
        terminal(&out)["result"]["rows"],
        json!([[{"kind":"int","value":1},{"kind":"int","value":1},{"kind":"int","value":1}],[{"kind":"int","value":2},{"kind":"int","value":2},{"kind":"int","value":1}],[{"kind":"int","value":99},{"kind":"int","value":99},{"kind":"int","value":1}]])
    );
    let out = run(&request(
        "SELECT 1 AS id,1 AS id FROM students GROUP BY id HAVING id>2 ORDER BY id;",
        session.clone(),
    ))
    .unwrap();
    assert_eq!(out["status"], "completed", "{out}");
    assert_eq!(
        terminal(&out)["result"]["rows"],
        json!([[{"kind":"int","value":1},{"kind":"int","value":1}],[{"kind":"int","value":1},{"kind":"int","value":1}]])
    );
    for source in [
        "SELECT dept_id AS x,id AS x,COUNT(*) AS n FROM students GROUP BY x;",
        "SELECT 2 AS x,3 AS x,COUNT(*) AS n FROM students GROUP BY dept_id HAVING x>1;",
    ] {
        let out = run(&request(source, session.clone())).unwrap();
        assert_eq!(out["diagnostic"]["code"], "E_NAME", "{source}");
        assert_eq!(terminal(&out)["session"], session);
    }
}
