//! Optional AI API gateway, independent from all interpreter crates.
mod network;
mod wire;
use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::stream;
use serde_json::{Value, json};
use std::{
    convert::Infallible,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;
use tower_http::services::ServeDir;
use wire::{Provider, Result, require};

pub struct Config {
    pub origin: String,
    pub base: String,
    pub static_dir: PathBuf,
    policy: String,
}
impl Config {
    pub fn new(origin: String, base: String, static_dir: PathBuf) -> Result<Self> {
        let url = reqwest::Url::parse(&origin).map_err(|_| "E_AI_UNSUPPORTED_ORIGIN")?;
        require(
            url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
                && url.path() == "/"
                && url.origin().ascii_serialization() == origin,
            "E_AI_UNSUPPORTED_ORIGIN",
        )?;
        require(
            url.scheme() == "https"
                || (url.scheme() == "http"
                    && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))),
            "E_AI_UNSUPPORTED_ORIGIN",
        )?;
        require(
            base.starts_with('/')
                && base.ends_with('/')
                && base.split('/').all(|s| {
                    s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                }),
            "E_AI_UNSUPPORTED_ORIGIN",
        )?;
        let policy = std::fs::read(static_dir.join("ai-gateway-policy.json"))
            .map_err(|_| "E_AI_UNAVAILABLE")?;
        let policy = wire::parse(&policy, 1024)?;
        let hashes = wire::list(&policy, "styleHashes")?;
        require(
            policy["version"] == "1.0.0"
                && hashes.len() == 2
                && hashes.iter().all(|v| {
                    v.as_str().is_some_and(|s| {
                        s.len() == 44
                            && s.ends_with('=')
                            && s.as_bytes()[..43]
                                .iter()
                                .all(|b| b.is_ascii_alphanumeric() || *b == b'+' || *b == b'/')
                    })
                }),
            "E_AI_UNAVAILABLE",
        )?;
        let styles = hashes
            .iter()
            .map(|v| format!("'sha256-{}'", v.as_str().unwrap_or_default()))
            .collect::<Vec<_>>()
            .join(" ");
        let policy = format!(
            "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' {styles}; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'"
        );
        Ok(Self {
            origin,
            base,
            static_dir,
            policy,
        })
    }
}
type Call = Pin<Box<dyn Future<Output = Result<network::RawResponse>> + Send>>;
trait Upstream: Send + Sync {
    fn call(&self, provider: Provider, verify: bool, key: String, body: Vec<u8>) -> Call;
}
struct Official;
impl Upstream for Official {
    fn call(&self, p: Provider, verify: bool, key: String, body: Vec<u8>) -> Call {
        Box::pin(network::call(p, verify, key, body))
    }
}
struct Gateway {
    config: Config,
    slot: Arc<Semaphore>,
    upstream: Arc<dyn Upstream>,
}
fn fixed(status: StatusCode, code: &'static str) -> Response {
    packet(status, json!({"code":code}))
}
fn packet(status: StatusCode, value: Value) -> Response {
    let body = serde_json::to_vec(&value)
        .unwrap_or_else(|_| b"{\"code\":\"E_AI_PROTOCOL_INVALID\"}".to_vec());
    with_headers((status, body).into_response())
}
fn with_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    headers.insert(
        header::CONNECTION,
        header::HeaderValue::from_static("close"),
    );
    headers.insert(
        "x-content-type-options",
        header::HeaderValue::from_static("nosniff"),
    );
    response
}
fn validate_origin(headers: &HeaderMap, config: &Config, post: bool) -> Result<()> {
    require(
        headers
            .iter()
            .map(|(n, v)| n.as_str().len() + v.len() + 4)
            .sum::<usize>()
            <= 16384,
        "E_AI_CONTEXT_LIMIT",
    )?;
    let expected_host = config
        .origin
        .split_once("://")
        .ok_or("E_AI_UNSUPPORTED_ORIGIN")?
        .1;
    require(
        headers.get(header::HOST).and_then(|v| v.to_str().ok()) == Some(expected_host),
        "E_AI_UNSUPPORTED_ORIGIN",
    )?;
    require(
        headers.get_all(header::ORIGIN).iter().count() <= 1
            && headers.get_all(header::HOST).iter().count() == 1,
        "E_AI_UNSUPPORTED_ORIGIN",
    )?;
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    require(
        origin.is_none_or(|v| v == config.origin) && (!post || origin.is_some()),
        "E_AI_UNSUPPORTED_ORIGIN",
    )?;
    if post {
        require(
            headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("same-origin")
                && headers.get("sec-fetch-mode").and_then(|v| v.to_str().ok())
                    == Some("same-origin"),
            "E_AI_UNSUPPORTED_ORIGIN",
        )?;
    }
    require(
        !headers.contains_key(header::AUTHORIZATION) && !headers.contains_key(header::COOKIE),
        "E_AI_PROTOCOL_INVALID",
    )
}
async fn capabilities(State(state): State<Arc<Gateway>>, request: Request) -> Response {
    if validate_origin(request.headers(), &state.config, false).is_err()
        || request.uri().query().is_some()
        || request.headers().contains_key("X-CViz-API-Key")
    {
        return fixed(StatusCode::FORBIDDEN, "E_AI_UNSUPPORTED_ORIGIN");
    }
    packet(
        StatusCode::OK,
        json!({"aiVersion":"2.0.0","kind":"ai.capabilities","available":true,"providers":[{"providerId":"openai","model":"gpt-5.4-mini-2026-03-17"},{"providerId":"deepseek","model":"deepseek-flash"}]}),
    )
}
async fn intake(state: Arc<Gateway>, request: Request, verify: bool) -> Response {
    let start = Instant::now();
    if let Err(code) = validate_origin(request.headers(), &state.config, true) {
        return fixed(StatusCode::FORBIDDEN, code);
    }
    if request.uri().query().is_some()
        || request.headers().get_all("X-CViz-API-Key").iter().count() != 1
        || request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            != Some("application/json")
    {
        return fixed(StatusCode::BAD_REQUEST, "E_AI_PROTOCOL_INVALID");
    }
    let key = match request
        .headers()
        .get("X-CViz-API-Key")
        .and_then(|v| v.to_str().ok())
    {
        Some(v) if !v.is_empty() && v.len() <= 4096 && v.bytes().all(|b| b.is_ascii_graphic()) => {
            v.to_owned()
        }
        _ => return fixed(StatusCode::BAD_REQUEST, "E_AI_UNCONFIGURED"),
    };
    let permit = match Arc::clone(&state.slot).try_acquire_owned() {
        Ok(p) => p,
        Err(_) => return fixed(StatusCode::CONFLICT, "E_AI_BUSY"),
    };
    let maximum = if verify { 1024 } else { 16384 };
    let raw = match tokio::time::timeout(
        Duration::from_secs(10),
        to_bytes(request.into_body(), maximum),
    )
    .await
    {
        Ok(Ok(b)) => b,
        Ok(Err(_)) => return fixed(StatusCode::PAYLOAD_TOO_LARGE, "E_AI_CONTEXT_LIMIT"),
        Err(_) => return fixed(StatusCode::REQUEST_TIMEOUT, "E_AI_DEADLINE"),
    };
    let request = match wire::parse(&raw, maximum).and_then(|v| {
        wire::validate(&v)?;
        require(
            v["kind"]
                == if verify {
                    "config.check"
                } else {
                    "explain.request"
                },
            "E_AI_PROTOCOL_INVALID",
        )?;
        if !verify {
            wire::context(&v["context"])?;
        }
        Ok(v)
    }) {
        Ok(v) => v,
        Err(code) => return fixed(StatusCode::BAD_REQUEST, code),
    };
    let provider = match Provider::parse(&request["provider"]) {
        Ok(p) => p,
        Err(code) => return fixed(StatusCode::BAD_REQUEST, code),
    };
    let payload = if verify {
        Vec::new()
    } else {
        match wire::payload(&request, provider) {
            Ok(v) => v,
            Err(code) => return packet(StatusCode::OK, wire::error(&request, code)),
        }
    };
    // Hyper owns this response stream. Disconnect drops the upstream Future, key and slot;
    // it is never spawned into a detached background task.
    let response = stream::once(async move {
        let _permit = permit;
        let limit = Duration::from_secs(if verify { 10 } else { 60 });
        let upstream = if let Some(remaining) = limit.checked_sub(start.elapsed()) {
            tokio::time::timeout(
                remaining,
                state.upstream.call(provider, verify, key, payload),
            )
            .await
            .map_err(|_| "E_AI_DEADLINE")
            .and_then(|v| v)
        } else {
            Err("E_AI_DEADLINE")
        };
        let result = upstream.and_then(|raw| {
            require(
                raw.status == 200,
                wire::upstream_code(raw.status, &raw.bytes),
            )?;
            if verify {
                let value = wire::parse(&raw.bytes, 65536)?;
                require(
                    wire::list(&value, "data")?
                        .iter()
                        .any(|v| v["id"] == provider.model()),
                    "E_AI_MODEL_MISMATCH",
                )?;
                Ok(Value::Null)
            } else {
                wire::response(&request, provider, &raw.bytes, start.elapsed().as_millis())
            }
        });
        let packet = if verify {
            wire::checked(&request, result.map(|_| ()))
        } else {
            result.unwrap_or_else(|code| wire::error(&request, code))
        };
        let data = serde_json::to_vec(&packet)
            .unwrap_or_else(|_| b"{\"code\":\"E_AI_PROTOCOL_INVALID\"}".to_vec());
        Ok::<Bytes, Infallible>(Bytes::from(data))
    });
    with_headers(Response::new(Body::from_stream(response)))
}
async fn verify(State(state): State<Arc<Gateway>>, request: Request) -> Response {
    intake(state, request, true).await
}
async fn explain(State(state): State<Arc<Gateway>>, request: Request) -> Response {
    intake(state, request, false).await
}
fn make_router(config: Config, upstream: Arc<dyn Upstream>) -> Router {
    let prefix = config.base.trim_end_matches('/').to_owned();
    let static_files = ServeDir::new(&config.static_dir).append_index_html_on_directories(true);
    let policy = config.policy.clone();
    let state = Arc::new(Gateway {
        config,
        slot: Arc::new(Semaphore::new(1)),
        upstream,
    });
    let api = Router::new()
        .route("/capabilities", get(capabilities))
        .route("/verify", post(verify))
        .route("/explain", post(explain))
        .fallback(|| async { fixed(StatusCode::NOT_FOUND, "E_AI_UNAVAILABLE") })
        .method_not_allowed_fallback(|| async {
            fixed(StatusCode::METHOD_NOT_ALLOWED, "E_AI_PROTOCOL_INVALID")
        })
        .with_state(state);
    let router = Router::new().nest(&format!("{prefix}/api/ai/v2"), api);
    let router = if prefix.is_empty() {
        router.fallback_service(static_files)
    } else {
        router.nest_service(&prefix, static_files)
    };
    router.layer(axum::middleware::from_fn(
        move |request: Request, next: axum::middleware::Next| {
            let policy = policy.clone();
            async move {
                let mut response = next.run(request).await;
                if let Ok(value) = header::HeaderValue::from_str(&policy) {
                    response
                        .headers_mut()
                        .insert(header::CONTENT_SECURITY_POLICY, value);
                }
                response.headers_mut().insert(
                    "referrer-policy",
                    header::HeaderValue::from_static("no-referrer"),
                );
                response.headers_mut().insert(
                    "x-content-type-options",
                    header::HeaderValue::from_static("nosniff"),
                );
                response
            }
        },
    ))
}
pub fn router(config: Config) -> Router {
    make_router(config, Arc::new(Official))
}

#[cfg(test)]
mod tests;
