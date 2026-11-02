use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value, json};
use std::{collections::HashSet, fmt, sync::OnceLock};

pub type Result<T> = std::result::Result<T, &'static str>;
pub const SCHEMA: &str = include_str!("../../../shared/contracts/19.3-AI解释2.0.0.schema.json");
pub const PROMPT: &str = include_str!("../../../shared/ai/system-prompt.txt");
pub fn require(value: bool, code: &'static str) -> Result<()> {
    if value { Ok(()) } else { Err(code) }
}
pub fn object(value: &Value) -> Result<&Map<String, Value>> {
    value.as_object().ok_or("E_AI_PROTOCOL_INVALID")
}
pub fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or("E_AI_PROTOCOL_INVALID")
}
pub fn list<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or("E_AI_PROTOCOL_INVALID")
}
pub fn number(value: &Value, key: &str) -> Result<u64> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or("E_AI_PROTOCOL_INVALID")
}

// Reject duplicate keys before a Value map can overwrite them. No data is put into errors.
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Unique;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("bounded JSON")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Bool(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Unique, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| Unique(Value::Number(n)))
                    .ok_or_else(|| E::custom("invalid JSON"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_none<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = seq.next_element::<Unique>()? {
                    out.push(v.0);
                }
                Ok(Unique(out.into()))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut out = Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if out.contains_key(&key) {
                        return Err(serde::de::Error::custom("duplicate JSON key"));
                    }
                    out.insert(key, map.next_value::<Unique>()?.0);
                }
                Ok(Unique(out.into()))
            }
        }
        d.deserialize_any(V)
    }
}
pub fn parse(raw: &[u8], limit: usize) -> Result<Value> {
    require(raw.len() <= limit, "E_AI_RESULT_LIMIT")?;
    let value = serde_json::from_slice::<Unique>(raw)
        .map_err(|_| "E_AI_PROTOCOL_INVALID")?
        .0;
    fn depth(value: &Value, level: usize) -> bool {
        level <= 32
            && match value {
                Value::Array(a) => a.iter().all(|v| depth(v, level + 1)),
                Value::Object(o) => o.values().all(|v| depth(v, level + 1)),
                _ => true,
            }
    }
    require(depth(&value, 0), "E_AI_PROTOCOL_INVALID")?;
    Ok(value)
}
pub fn validate(value: &Value) -> Result<()> {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    let validator = VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(SCHEMA).expect("trusted AI schema");
        jsonschema::validator_for(&schema).expect("trusted AI schema compiles")
    });
    require(validator.is_valid(value), "E_AI_PROTOCOL_INVALID")
}
#[derive(Clone, Copy)]
pub enum Provider {
    OpenAi,
    DeepSeek,
}
impl Provider {
    pub fn parse(v: &Value) -> Result<Self> {
        match (text(v, "providerId")?, text(v, "model")?) {
            ("openai", "gpt-5.4-mini-2026-03-17") => Ok(Self::OpenAi),
            ("deepseek", "deepseek-flash") => Ok(Self::DeepSeek),
            _ => Err("E_AI_MODEL_MISMATCH"),
        }
    }
    pub fn host(self) -> &'static str {
        match self {
            Self::OpenAi => "api.openai.com",
            Self::DeepSeek => "api.deepseek.com",
        }
    }
    pub fn model(self) -> &'static str {
        match self {
            Self::OpenAi => "gpt-5.4-mini-2026-03-17",
            Self::DeepSeek => "deepseek-flash",
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::DeepSeek => "deepseek",
        }
    }
    pub fn endpoint(self, verify: bool) -> &'static str {
        match (self, verify) {
            (Self::OpenAi, true) => "https://api.openai.com/v1/models",
            (Self::OpenAi, false) => "https://api.openai.com/v1/chat/completions",
            (Self::DeepSeek, true) => "https://api.deepseek.com/models",
            (Self::DeepSeek, false) => "https://api.deepseek.com/chat/completions",
        }
    }
    pub fn returned(self, model: &str) -> bool {
        match self {
            Self::OpenAi => model == self.model(),
            Self::DeepSeek => ["deepseek-flash", "DeepSeek-V4.1-Flash-1017"].contains(&model),
        }
    }
}
pub fn context(value: &Value) -> Result<()> {
    let snippets = list(value, "snippets")?;
    let facts = list(value, "facts")?;
    let total = snippets.iter().try_fold((0, 0), |(bytes, lines), s| {
        Ok::<_, &'static str>((
            bytes + text(s, "text")?.len(),
            lines + text(s, "text")?.matches('\n').count() + 1,
        ))
    })?;
    require(total.0 <= 2048 && total.1 <= 32, "E_AI_CONTEXT_LIMIT")?;
    let mut snippet_ids = HashSet::new();
    for s in snippets {
        require(
            snippet_ids.insert(text(s, "snippetId")?),
            "E_AI_PROTOCOL_INVALID",
        )?;
        let range = &s["byteRange"];
        require(
            number(range, "end")?.checked_sub(number(range, "start")?)
                == Some(text(s, "text")?.len() as u64),
            "E_AI_PROTOCOL_INVALID",
        )?;
    }
    let mut ids = HashSet::new();
    let mut objects = HashSet::new();
    let mut frames = HashSet::new();
    let mut cells = HashSet::new();
    let (mut diagnostics, mut steps, mut values) = (0, 0, 0);
    for f in facts {
        require(ids.insert(text(f, "factId")?), "E_AI_PROTOCOL_INVALID")?;
        match text(f, "kind")? {
            "diagnostic" => diagnostics += 1,
            "step" => {
                steps += 1;
                require(
                    value["traceAvailable"] == true
                        && number(f, "step")? <= number(value, "cursor")?,
                    "E_AI_CONTEXT_STALE",
                )?;
            }
            "state" => {
                values += 1;
                require(
                    value["traceAvailable"] == true && f["atCursor"] == value["cursor"],
                    "E_AI_CONTEXT_STALE",
                )?;
                objects.insert(text(f, "objectId")?);
                frames.insert(f["frameId"].to_string());
                require(
                    cells.insert((text(f, "objectId")?, number(f, "byteOffset")?)),
                    "E_AI_PROTOCOL_INVALID",
                )?;
            }
            _ => return Err("E_AI_PROTOCOL_INVALID"),
        }
        if !f["byteRange"].is_null() {
            let range = &f["byteRange"];
            require(
                number(range, "start")? <= number(range, "end")?
                    && snippets.iter().any(|s| {
                        s["byteRange"]["start"].as_u64() <= range["start"].as_u64()
                            && range["end"].as_u64() <= s["byteRange"]["end"].as_u64()
                    }),
                "E_AI_PROTOCOL_INVALID",
            )?;
        }
    }
    require(
        diagnostics <= 1 && steps <= 4 && values <= 8 && objects.len() <= 2 && frames.len() <= 2,
        "E_AI_CONTEXT_LIMIT",
    )
}
pub fn payload(request: &Value, provider: Provider) -> Result<Vec<u8>> {
    let context = &request["context"];
    let user =
        serde_json::to_string(&json!({"snippets":context["snippets"],"facts":context["facts"]}))
            .map_err(|_| "E_AI_PROTOCOL_INVALID")?;
    let messages = json!([{"role":"system","content":PROMPT},{"role":"user","content":user}]);
    let body = match provider {
        Provider::DeepSeek => {
            json!({"model":provider.model(),"messages":messages,"stream":false,"max_tokens":768,"thinking":{"type":"disabled"},"response_format":{"type":"json_object"}})
        }
        Provider::OpenAi => {
            let schema: Value =
                serde_json::from_str(SCHEMA).map_err(|_| "E_AI_PROTOCOL_INVALID")?;
            let mut output = schema["$defs"]["modelOutput"].clone();
            let fact_ids =
                &mut output["properties"]["explanations"]["items"]["properties"]["factIds"];
            object(fact_ids)?;
            fact_ids
                .as_object_mut()
                .ok_or("E_AI_PROTOCOL_INVALID")?
                .remove("uniqueItems");
            fact_ids["items"] = json!({"type":"string","enum":list(context,"facts")?.iter().map(|f|f["factId"].clone()).collect::<Vec<_>>()});
            json!({"model":provider.model(),"messages":messages,"stream":false,"n":1,"reasoning_effort":"none","max_completion_tokens":768,"store":false,"response_format":{"type":"json_schema","json_schema":{"name":"cviz_explanation_v2","strict":true,"schema":output}}})
        }
    };
    let bytes = serde_json::to_vec(&body).map_err(|_| "E_AI_PROTOCOL_INVALID")?;
    require(bytes.len() <= 6144, "E_AI_CONTEXT_LIMIT")?;
    Ok(bytes)
}
pub fn upstream_code(status: u16, raw: &[u8]) -> &'static str {
    match status {
        401 => "E_AI_AUTH",
        403 => "E_AI_PERMISSION",
        402 => "E_AI_QUOTA",
        404 => "E_AI_MODEL_MISMATCH",
        429 => {
            let quota = parse(raw, 65536).ok().is_some_and(|v| {
                v["error"]["code"] == "insufficient_quota"
                    || v["error"]["type"] == "insufficient_quota"
            });
            if quota {
                "E_AI_QUOTA"
            } else {
                "E_AI_RATE_LIMIT"
            }
        }
        _ => "E_AI_PROVIDER",
    }
}
pub fn checked(request: &Value, result: Result<()>) -> Value {
    json!({"aiVersion":"2.0.0","kind":"config.checked","requestId":request["requestId"],"configRevision":request["configRevision"],"provider":request["provider"],"verified":result.is_ok(),"code":result.err()})
}
pub fn error(request: &Value, code: &'static str) -> Value {
    json!({"aiVersion":"2.0.0","kind":"explain.error","requestId":request["requestId"],"configRevision":request["configRevision"],"confirmationId":request["confirmationId"],"contextId":request["context"]["contextId"],"code":code})
}
pub fn response(request: &Value, provider: Provider, raw: &[u8], elapsed: u128) -> Result<Value> {
    require(elapsed < 60000, "E_AI_DEADLINE")?;
    let packet = parse(raw, 65536)?;
    let returned = text(&packet, "model")?;
    require(provider.returned(returned), "E_AI_MODEL_MISMATCH")?;
    let choices = list(&packet, "choices")?;
    require(choices.len() == 1, "E_AI_PROTOCOL_INVALID")?;
    let choice = &choices[0];
    require(
        choice["finish_reason"] == "stop",
        if choice["finish_reason"] == "content_filter" {
            "E_AI_REFUSED"
        } else {
            "E_AI_PROTOCOL_INVALID"
        },
    )?;
    let message = &choice["message"];
    require(message["role"] == "assistant", "E_AI_PROTOCOL_INVALID")?;
    require(message["refusal"].is_null(), "E_AI_REFUSED")?;
    require(
        message["tool_calls"].is_null()
            && message["function_call"].is_null()
            && (message["reasoning_content"].is_null() || message["reasoning_content"] == ""),
        "E_AI_PROTOCOL_INVALID",
    )?;
    let content = parse(text(message, "content")?.as_bytes(), 8192)?;
    let ids: HashSet<_> = list(&request["context"], "facts")?
        .iter()
        .map(|f| text(f, "factId"))
        .collect::<Result<_>>()?;
    // Shape is validated before any field is trusted or rendered.
    let context = &request["context"];
    let output = json!({"aiVersion":"2.0.0","kind":"explain.response","requestId":request["requestId"],"configRevision":request["configRevision"],"confirmationId":request["confirmationId"],"contextId":context["contextId"],"runRef":context["runRef"],"inputRevision":context["inputRevision"],"cursor":context["cursor"],"producer":"provider-api-adapter","provider":{"providerId":provider.id(),"configVersion":"2.0.0","requestedModel":provider.model(),"returnedModel":returned},"content":content,"timing":{"elapsedMs":elapsed}});
    validate(&output)?;
    require(
        list(&output["content"], "explanations")?.iter().all(|e| {
            e["factIds"].as_array().is_some_and(|a| {
                a.iter()
                    .all(|id| id.as_str().is_some_and(|id| ids.contains(id)))
            })
        }),
        "E_AI_INVALID_REFERENCE",
    )?;
    require(
        serde_json::to_vec(&output)
            .map_err(|_| "E_AI_PROTOCOL_INVALID")?
            .len()
            <= 12288,
        "E_AI_RESULT_LIMIT",
    )?;
    Ok(output)
}
