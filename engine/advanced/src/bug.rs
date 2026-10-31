//! Bounded, explicitly versioned companion judgment for four public repair levels.
use crate::budget::Meter;
use serde::Deserialize;
use serde_json::{Value, json};

const REGISTRY: &str = include_str!("../../../content/cpp/bugs/questions-1.0.0.json");
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    registry_version: String,
    questions: Vec<Question>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Question {
    exercise_ref: Value,
    goal: String,
    tests: Vec<Test>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Test {
    case_key: String,
    input: Vec<i32>,
    expected_stdout: String,
}
pub(crate) struct BugContext {
    exercise_ref: Value,
    case_key: String,
    input: Vec<i32>,
    expected: String,
    goal: String,
}
#[derive(Default)]
pub(crate) struct Observations {
    pub indirect_reads: usize,
    pub loop_iterations: usize,
}

pub(crate) fn context(request: &Value, meter: &mut Meter) -> Result<BugContext, &'static str> {
    let bug = &request["bug"];
    if !bug.as_object().is_some_and(|v| {
        v.len() == 3
            && ["version", "exerciseId", "caseKey"]
                .iter()
                .all(|k| v.contains_key(*k))
    }) || bug["version"] != "1.0.0"
        || request["language"] != "cpp"
    {
        return Err("E_PROTOCOL_INVALID");
    }
    meter
        .charge(REGISTRY.len().div_ceil(64))
        .map_err(|_| "E_FUEL_LIMIT")?;
    let registry: Registry = serde_json::from_str(REGISTRY).map_err(|_| "E_PROTOCOL_INVALID")?;
    if registry.registry_version != "1.0.0" {
        return Err("E_UNSUPPORTED_VERSION");
    }
    let question = registry
        .questions
        .into_iter()
        .find(|q| q.exercise_ref["id"] == bug["exerciseId"])
        .ok_or("E_PROTOCOL_INVALID")?;
    let test = question
        .tests
        .into_iter()
        .find(|t| Some(t.case_key.as_str()) == bug["caseKey"].as_str())
        .ok_or("E_PROTOCOL_INVALID")?;
    if request["input"] != json!(test.input) {
        return Err("E_INPUT_INVALID");
    }
    Ok(BugContext {
        exercise_ref: question.exercise_ref,
        case_key: test.case_key,
        input: test.input,
        expected: test.expected_stdout,
        goal: question.goal,
    })
}
impl BugContext {
    pub(crate) fn judge(
        &self,
        completed: bool,
        returned: Option<i32>,
        output: &str,
        consumed: usize,
        observation: &Observations,
    ) -> Value {
        let checks = [
            ("exit-zero", completed && returned == Some(0)),
            ("stdout-exact", output == self.expected),
            ("input-consumed", consumed == self.input.len()),
            (
                "teaching-target",
                if self.goal == "indirect-read" {
                    observation.indirect_reads > 0
                } else {
                    observation.loop_iterations >= self.input[0] as usize
                },
            ),
        ];
        json!({"version":"1.0.0","registryRef":{"id":"bug-catalog.cpp.memory-loop","version":"1.0.0"},"exerciseRef":self.exercise_ref,"caseKey":self.case_key,"status":if checks.iter().all(|(_,met)|*met){"met"}else{"unmet"},"checks":checks.map(|(id,met)|json!({"id":id,"met":met}))})
    }
}
