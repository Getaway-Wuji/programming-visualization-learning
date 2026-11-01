//! Original deterministic C practice, validated by the existing restricted Rust interpreter.
//! Inputs are minimal selection parameters and one transient answer, never a learner archive.
use c_viz_advanced::{
    budget::{BudgetError, Limits, Meter},
    codec,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub const VERSION: &str = "1.0.0";
pub const MAX_REQUEST: usize = 65_536;
pub const MAX_RESULT: usize = 16_777_216;
type Clock = Rc<RefCell<Box<dyn FnMut() -> u64>>>;

pub struct Session {
    clock: Clock,
    started: u64,
    remaining_ms: u64,
    cancelled: Rc<Cell<bool>>,
    pub fuel_used: usize,
    pub steps: usize,
    pub output_bytes: usize,
}
impl Session {
    pub fn new(
        remaining_ms: u32,
        clock: impl FnMut() -> u64 + 'static,
    ) -> Result<Self, &'static str> {
        if !(1..=1000).contains(&remaining_ms) {
            return Err("E_DEADLINE");
        }
        let clock: Clock = Rc::new(RefCell::new(Box::new(clock)));
        let started = (clock.borrow_mut())();
        Ok(Self {
            clock,
            started,
            remaining_ms: u64::from(remaining_ms),
            cancelled: Rc::new(Cell::new(false)),
            fuel_used: 0,
            steps: 0,
            output_bytes: 0,
        })
    }
    pub fn cancel(&self) {
        self.cancelled.set(true);
    }
    fn check(&mut self) -> Result<u64, &'static str> {
        if self.cancelled.get() {
            return Err("E_CANCELLED");
        }
        let elapsed = (self.clock.borrow_mut())().saturating_sub(self.started);
        if elapsed >= self.remaining_ms {
            return Err("E_DEADLINE");
        }
        if self.fuel_used >= 1_000_000 {
            return Err("E_FUEL_LIMIT");
        }
        Ok(self.remaining_ms - elapsed)
    }
    fn meter(&mut self) -> Result<Meter, &'static str> {
        let remaining = self.check()?;
        let fuel = 1_000_000_usize.saturating_sub(self.fuel_used);
        if fuel <= 4096 {
            return Err("E_FUEL_LIMIT");
        }
        let mut meter = Meter::with_limits(Limits {
            fuel,
            steps: 20_000_usize.saturating_sub(self.steps),
            output_bytes: 16_384_usize.saturating_sub(self.output_bytes),
            ..Limits::default()
        });
        let clock = self.clock.clone();
        meter.set_clock(remaining, Box::new(move || (clock.borrow_mut())()));
        let cancel = self.cancelled.clone();
        meter.set_cancel(Box::new(move || cancel.get()));
        Ok(meter)
    }
    fn absorb(&mut self, meter: &Meter) -> Result<(), &'static str> {
        self.fuel_used = self.fuel_used.saturating_add(meter.used());
        self.check().map(|_| ())
    }
    fn charge(&mut self, units: usize) -> Result<(), &'static str> {
        let mut meter = self.meter()?;
        let result = meter.charge(units).map_err(budget_code);
        self.absorb(&meter)?;
        result
    }
    fn decode(&mut self, bytes: &[u8], max: usize) -> Result<Value, &'static str> {
        let mut meter = self.meter()?;
        let value = codec::decode(bytes, &mut meter, max).map_err(codec_code);
        self.absorb(&meter)?;
        value
    }
    fn encode(&mut self, value: &Value, max: usize) -> Result<Vec<u8>, &'static str> {
        let mut meter = self.meter()?;
        let bytes = codec::encode(value, &mut meter, max).map_err(codec_code);
        self.absorb(&meter)?;
        bytes
    }
}
fn budget_code(e: BudgetError) -> &'static str {
    match e {
        BudgetError::Cancelled => "E_CANCELLED",
        BudgetError::Deadline { .. } => "E_DEADLINE",
        BudgetError::Fuel { .. } => "E_FUEL_LIMIT",
    }
}
fn codec_code(e: codec::CodecError) -> &'static str {
    match e {
        codec::CodecError::Budget(e) => budget_code(e),
        codec::CodecError::Limit { .. } => "E_RESULT_LIMIT",
        _ => "E_PROTOCOL_INVALID",
    }
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        && value.as_bytes()[0].is_ascii_alphanumeric()
}
fn build_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    generator_version: String,
    request_id: String,
    operation: String,
    knowledge_id: String,
    difficulty: u8,
    seed: String,
    problem_id: Option<String>,
    attempt_id: Option<String>,
    source_revision: Option<String>,
    source: Option<String>,
    input_text: Option<String>,
}
#[derive(Clone, Serialize)]
struct Ref {
    id: &'static str,
    version: &'static str,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub case_id: String,
    pub input_text: String,
    pub expected_stdout: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    problem_version: &'static str,
    pub problem_id: String,
    template_ref: Ref,
    language: &'static str,
    difficulty: u8,
    seed: String,
    knowledge_ids: Vec<&'static str>,
    title: &'static str,
    prompt: String,
    parameters: Value,
    pub input_min: i32,
    pub input_max: i32,
    pub cases: Vec<Case>,
    starter_source: String,
    pub reference_source: String,
    validation: Value,
}
enum Parameters {
    Affine(i32, i32),
    Interval(i32, Option<i32>, i32, i32),
    Accumulate(i32, i32, i32),
}
impl Parameters {
    fn expected(&self, x: i32) -> i32 {
        match *self {
            Self::Affine(a, b) => a * x + b,
            Self::Interval(low, high, inside, outside) => {
                if x >= low && high.is_none_or(|h| x <= h) {
                    inside
                } else {
                    outside
                }
            }
            Self::Accumulate(a, b, d) => (1..=x).filter(|i| i % d == 0).map(|i| a * i + b).sum(),
        }
    }
}
struct Random(u32);
impl Random {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.0
    }
    fn int(&mut self, low: i32, high: i32) -> i32 {
        low + (self.next() % (high - low + 1) as u32) as i32
    }
}
fn canonical_seed(seed: &str) -> Result<u32, &'static str> {
    if seed.is_empty() || seed.len() > 10 || !seed.bytes().all(|b| b.is_ascii_digit()) {
        return Err("E_GEN_SEED");
    }
    seed.parse::<u32>().map_err(|_| "E_GEN_SEED")
}
fn construct(knowledge: &str, difficulty: u8, seed: &str) -> Result<Problem, &'static str> {
    if ![1, 2].contains(&difficulty) {
        return Err("E_GEN_DIFFICULTY");
    }
    let seed = canonical_seed(seed)?;
    let (template, salt, knowledge_ids) = match knowledge {
        "knowledge.c.expressions"
        | "knowledge.c.variables"
        | "knowledge.c.output"
        | "knowledge.c.input" => (
            "generated.c.affine",
            0x1357_2468,
            vec![
                "knowledge.c.expressions",
                "knowledge.c.variables",
                "knowledge.c.output",
                "knowledge.c.input",
            ],
        ),
        "knowledge.c.conditions" => (
            "generated.c.interval",
            0x2468_1357,
            vec!["knowledge.c.conditions"],
        ),
        "knowledge.c.loops" => (
            "generated.c.accumulate",
            0x5a5a_c3c3,
            vec!["knowledge.c.loops"],
        ),
        _ => return Err("E_GEN_KNOWLEDGE"),
    };
    let mut rng = Random(seed ^ salt ^ (u32::from(difficulty) * 0x0101_0101));
    let (title, parameters, parameter_json, requirement, body, input_min, input_max) =
        match template {
            "generated.c.affine" => {
                let a = if difficulty == 1 {
                    rng.int(1, 5)
                } else {
                    let magnitude = rng.int(2, 7);
                    if rng.next().is_multiple_of(2) {
                        -magnitude
                    } else {
                        magnitude
                    }
                };
                let b = if difficulty == 1 {
                    rng.int(-7, 7)
                } else {
                    rng.int(-12, 12)
                };
                (
                    "仿射表达式输出",
                    Parameters::Affine(a, b),
                    json!({"a":a,"b":b}),
                    format!("读取整数 x，计算 ({a}) * x + ({b})，输出结果并换行。"),
                    format!("  int answer = ({a}) * x + ({b});\n  printf(\"%d\\n\", answer);\n"),
                    if difficulty == 1 { -6 } else { -12 },
                    if difficulty == 1 { 6 } else { 12 },
                )
            }
            "generated.c.interval" => {
                let low = if difficulty == 1 {
                    rng.int(-2, 2)
                } else {
                    rng.int(-7, -1)
                };
                let high = if difficulty == 1 {
                    None
                } else {
                    Some(rng.int(1, 7))
                };
                let inside = rng.int(2, 9);
                let outside = rng.int(-9, -1);
                let condition = high.map_or_else(
                    || format!("x >= ({low})"),
                    |h| format!("x >= ({low}) && x <= ({h})"),
                );
                let text = high.map_or_else(
                    || format!("x 大于或等于 {low}"),
                    |h| format!("x 位于闭区间 [{low}, {h}] 内（包含两端）"),
                );
                (
                    "边界分支输出",
                    Parameters::Interval(low, high, inside, outside),
                    json!({"lower":low,"upper":high,"inside":inside,"outside":outside}),
                    format!(
                        "读取整数 x。若{text}，输出 {inside}；否则输出 {outside}。结果后换行。"
                    ),
                    format!(
                        "  if ({condition}) {{\n    printf(\"%d\\n\", {inside});\n  }} else {{\n    printf(\"%d\\n\", {outside});\n  }}\n"
                    ),
                    if difficulty == 1 { -6 } else { -12 },
                    if difficulty == 1 { 6 } else { 12 },
                )
            }
            _ => {
                let a = rng.int(1, 3);
                let b = rng.int(0, 3);
                let divisor = if difficulty == 1 { 1 } else { rng.int(2, 3) };
                let term = format!("sum = sum + ({a}) * i + ({b});");
                let update = if divisor == 1 {
                    format!("    {term}\n")
                } else {
                    format!("    if (i % {divisor} == 0) {{\n      {term}\n    }}\n")
                };
                let rule = if divisor == 1 {
                    "所有下标 i".into()
                } else {
                    format!("可被 {divisor} 整除的下标 i")
                };
                (
                    "循环条件累加",
                    Parameters::Accumulate(a, b, divisor),
                    json!({"a":a,"b":b,"divisor":divisor}),
                    format!(
                        "读取非负整数 x。考察 1 到 x（含 x）的{rule}，累加 ({a}) * i + ({b})。x=0 时和为0，输出和并换行。"
                    ),
                    format!(
                        "  int sum = 0;\n  for (int i = 1; i <= x; i = i + 1) {{\n{update}  }}\n  printf(\"%d\\n\", sum);\n"
                    ),
                    0,
                    if difficulty == 1 { 5 } else { 9 },
                )
            }
        };
    let problem_id = format!("{template}@{VERSION}:d{difficulty}:s{seed}");
    let prefix = "#include <stdio.h>\nint main() {\n  int x;\n  scanf(\"%d\", &x);\n";
    let reference_source = format!("{prefix}{body}  return 0;\n}}\n");
    let starter_source =
        format!("{prefix}  // 在这里完成题目要求，并输出结果及换行。\n  return 0;\n}}\n");
    let cases = (input_min..=input_max)
        .map(|x| Case {
            case_id: format!("{problem_id}:input:{x}"),
            input_text: x.to_string(),
            expected_stdout: format!("{}\n", parameters.expected(x)),
        })
        .collect();
    Ok(Problem {
        problem_version: VERSION,
        problem_id,
        template_ref: Ref {
            id: template,
            version: VERSION,
        },
        language: "c",
        difficulty,
        seed: seed.to_string(),
        knowledge_ids,
        title,
        prompt: format!(
            "{requirement} 合法输入是 [{input_min}, {input_max}] 中的每个整数；提交会检查完整有限域。"
        ),
        parameters: parameter_json,
        input_min,
        input_max,
        cases,
        starter_source,
        reference_source,
        validation: json!({"checkedCases":0,"fuelUsed":0}),
    })
}
fn parse_input(text: &str, problem: &Problem) -> Result<i32, &'static str> {
    if text.len() > 256 || !text.is_ascii() {
        return Err("E_GEN_INPUT");
    }
    let words = text.split_ascii_whitespace().collect::<Vec<_>>();
    if words.len() != 1 {
        return Err("E_GEN_INPUT");
    }
    let word = words[0];
    let digits = word.strip_prefix('-').unwrap_or(word);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err("E_GEN_INPUT");
    }
    let value = word.parse::<i32>().map_err(|_| "E_GEN_INPUT")?;
    if !(problem.input_min..=problem.input_max).contains(&value) {
        return Err("E_GEN_INPUT");
    }
    Ok(value)
}
fn run_case(
    session: &mut Session,
    source: &str,
    revision: &str,
    attempt: &str,
    index: usize,
    case: &Case,
    build: &str,
) -> Result<(Value, Value, Value), &'static str> {
    let x = case
        .input_text
        .parse::<i32>()
        .map_err(|_| "E_GENERATED_REFERENCE")?;
    let request = json!({"execVersion":"1.4.0","dslVersion":"1.3.0","diagnosticVersion":"1.3.0","integerEncoding":"1.0.0","language":"c","engineId":"engine.rust.advanced","runId":format!("{attempt}.case.{index}"),"sourceRevision":revision,"source":source,"input":{"kind":"integers","values":[x]}});
    let bytes = session.encode(&request, MAX_REQUEST)?;
    let mut meter = session.meter()?;
    let result = c_viz_advanced::runtime::execute(&bytes, build, &mut meter);
    session.absorb(&meter)?;
    let result = session.decode(&result?, MAX_RESULT)?;
    let steps = result["trace"]["steps"].as_array();
    let mut stdout = String::new();
    if let Some(steps) = steps {
        session.steps += steps.len();
        for step in steps {
            if let Some(changes) = step["changes"].as_array() {
                for change in changes {
                    if change["op"] == "output" {
                        stdout.push_str(change["append"].as_str().ok_or("E_GENERATED_REFERENCE")?);
                    }
                }
            }
        }
    }
    session.output_bytes = session.output_bytes.saturating_add(stdout.len());
    if session.steps > 20_000 {
        return Err("E_STEP_LIMIT");
    }
    if session.output_bytes > 16_384 {
        return Err("E_OUTPUT_LIMIT");
    }
    let terminal = result["terminal"]["status"]
        .as_str()
        .ok_or("E_GENERATED_REFERENCE")?;
    let status = if terminal == "completed" && result["terminal"]["returnValue"] == 0 {
        if stdout == case.expected_stdout {
            "passed"
        } else {
            "wrong-answer"
        }
    } else if terminal == "limited" {
        "resource-limit"
    } else {
        "program-error"
    };
    let summary = json!({"caseId":case.case_id,"inputText":case.input_text,"expectedStdout":case.expected_stdout,"actualStdout":stdout,"status":status,"code":result["terminal"]["code"]});
    Ok((request, result, summary))
}

pub fn process(bytes: &[u8], build: &str, session: &mut Session) -> Result<Vec<u8>, &'static str> {
    if bytes.len() > MAX_REQUEST {
        return Err("E_REQUEST_LIMIT");
    }
    if !build_id(build) {
        return Err("E_PROTOCOL_INVALID");
    }
    let value = session.decode(bytes, MAX_REQUEST)?;
    let operation = value["operation"].as_str().ok_or("E_PROTOCOL_INVALID")?;
    let mut fields = vec![
        "generatorVersion",
        "requestId",
        "operation",
        "knowledgeId",
        "difficulty",
        "seed",
    ];
    match operation {
        "generate" => {}
        "grade" | "preview" => {
            fields.extend(["problemId", "attemptId", "sourceRevision", "source"]);
            if operation == "preview" {
                fields.push("inputText");
            }
        }
        _ => return Err("E_PROTOCOL_INVALID"),
    }
    let map = value.as_object().ok_or("E_PROTOCOL_INVALID")?;
    if map.len() != fields.len() || fields.iter().any(|k| !map.contains_key(*k)) {
        return Err("E_PROTOCOL_INVALID");
    }
    let request: Request = serde_json::from_value(value).map_err(|_| "E_PROTOCOL_INVALID")?;
    if request.generator_version != VERSION {
        return Err("E_UNSUPPORTED_VERSION");
    }
    if !id(&request.request_id) {
        return Err("E_PROTOCOL_INVALID");
    }
    let mut problem = construct(&request.knowledge_id, request.difficulty, &request.seed)?;
    session.charge(problem.reference_source.len() + problem.cases.len() * 32)?;
    let mut response = json!({"generatorVersion":VERSION,"producer":"rust","buildId":build,"requestId":request.request_id,"operation":request.operation,"stats":{}});
    if request.operation == "generate" {
        for (index, case) in problem.cases.iter().enumerate() {
            let (_, _, summary) = run_case(
                session,
                &problem.reference_source,
                "generated-reference",
                &request.request_id,
                index,
                case,
                build,
            )?;
            if summary["status"] != "passed" {
                return Err("E_GENERATED_REFERENCE");
            }
        }
        problem.validation =
            json!({"checkedCases":problem.cases.len(),"fuelUsed":session.fuel_used});
        response["problem"] = serde_json::to_value(problem).map_err(|_| "E_ENCODING_FAILURE")?;
    } else {
        if request.problem_id.as_deref() != Some(&problem.problem_id) {
            return Err("E_GEN_IDENTITY");
        }
        let attempt = request
            .attempt_id
            .as_deref()
            .filter(|s| id(s) && s.len() <= 70)
            .ok_or("E_PROTOCOL_INVALID")?;
        let revision = request
            .source_revision
            .as_deref()
            .filter(|s| id(s))
            .ok_or("E_PROTOCOL_INVALID")?;
        let source = request.source.as_deref().ok_or("E_PROTOCOL_INVALID")?;
        if source.len() > 32_768 {
            return Err("E_SOURCE_LIMIT");
        }
        let cases = if request.operation == "preview" {
            let x = parse_input(
                request.input_text.as_deref().ok_or("E_PROTOCOL_INVALID")?,
                &problem,
            )?;
            vec![problem.cases[(x - problem.input_min) as usize].clone()]
        } else {
            problem.cases.clone()
        };
        let mut results = vec![];
        let mut replay = Value::Null;
        let mut first_failure = false;
        let mut terminal_failure = false;
        for (index, case) in cases.iter().enumerate() {
            let (req, result, summary) =
                run_case(session, source, revision, attempt, index, case, build)?;
            let passed = summary["status"] == "passed";
            let stopped =
                summary["status"] == "program-error" || summary["status"] == "resource-limit";
            if !first_failure {
                replay = json!({"caseId":case.case_id,"inputText":case.input_text,"request":req,"result":result});
                if !passed {
                    first_failure = true;
                }
            }
            results.push(summary);
            if stopped {
                terminal_failure = true;
                break;
            }
        }
        let passed = results.iter().filter(|r| r["status"] == "passed").count();
        let complete = request.operation == "grade"
            && !terminal_failure
            && results.len() == problem.cases.len();
        let verdict = if results.iter().any(|r| r["status"] == "resource-limit") {
            "limited"
        } else if terminal_failure {
            "rejected"
        } else if passed == results.len() {
            "passed"
        } else {
            "unmet"
        };
        response["assessment"] = json!({"problemId":problem.problem_id,"attemptId":attempt,"sourceRevision":revision,"complete":complete,"verdict":verdict,"totalCases":problem.cases.len(),"checkedCases":results.len(),"passedCases":passed,"results":results,"replay":replay});
    }
    response["stats"] = json!({"fuelUsed":session.fuel_used,"steps":session.steps,"outputBytes":session.output_bytes});
    session.encode(&response, MAX_RESULT)
}
