use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const SENTINEL: &str = "DESIGN_ONLY_NOT_A_REAL_KEY";
fn fixtures() -> Value {
    serde_json::from_str(include_str!(
        "../../../shared/contracts/19.3-API-Key设计样例.json"
    ))
    .unwrap()
}
fn request() -> Value {
    fixtures()["examples"][0]["request"].clone()
}
fn config_request() -> Value {
    fixtures()["configCheck"].clone()
}
fn config(port: u16) -> Config {
    Config::new(
        format!("http://127.0.0.1:{port}"),
        "/".into(),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/dist"),
    )
    .unwrap()
}
fn upstream_packet(request: &Value, provider: Provider) -> Vec<u8> {
    serde_json::to_vec(&json!({"model":provider.model(),"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":serde_json::to_string(&fixtures()["examples"][0]["hypotheticalResponse"]["content"]).unwrap()}}],"usage":{"total_tokens":1},"id":request["requestId"]})).unwrap()
}

#[test]
fn three_original_contexts_and_both_provider_projections_are_bounded_and_key_free() {
    for case in fixtures()["examples"].as_array().unwrap() {
        for provider in [Provider::OpenAi, Provider::DeepSeek] {
            let mut req = case["request"].clone();
            req["provider"] = json!({"providerId":provider.id(),"model":provider.model()});
            wire::validate(&req).unwrap();
            wire::context(&req["context"]).unwrap();
            let payload = wire::payload(&req, provider).unwrap();
            let text = String::from_utf8(payload.clone()).unwrap();
            assert!(payload.len() <= 6144);
            for key in [
                "apiKey",
                "Authorization",
                "contextId",
                "configRevision",
                "confirmationId",
                "inputRevision",
            ] {
                assert!(!text.contains(key));
            }
            assert!(!text.contains(req["requestId"].as_str().unwrap()));
            let v: Value = serde_json::from_slice(&payload).unwrap();
            assert_eq!(v["stream"], false);
            assert!(v.get("tools").is_none());
            if let Some(dir) = std::env::var_os("AI_EVIDENCE_DIR") {
                let dir = PathBuf::from(dir);
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(
                    dir.join(format!(
                        "{}-{}-DESIGN-NOT-SENT.json",
                        provider.id(),
                        case["id"].as_str().unwrap()
                    )),
                    payload,
                )
                .unwrap();
            }
        }
    }
}
#[test]
fn duplicate_escaped_keys_and_deep_json_are_rejected_before_use() {
    for raw in [
        br#"{"a":1,"a":2}"#.as_slice(),
        br#"{"a":1,"\u0061":2}"#,
        br#"{"a":{"b":1,"b":2}}"#,
    ] {
        assert_eq!(wire::parse(raw, 1024).unwrap_err(), "E_AI_PROTOCOL_INVALID");
    }
    assert!(
        wire::parse(
            format!("{}0{}", "[".repeat(34), "]".repeat(34)).as_bytes(),
            1024
        )
        .is_err()
    );
    assert_eq!(
        wire::parse(&vec![b' '; 1025], 1024).unwrap_err(),
        "E_AI_RESULT_LIMIT"
    );
}
#[test]
fn request_extra_keys_wrong_models_and_source_budget_are_rejected() {
    for key in [
        "apiKey",
        "baseURL",
        "providerUrl",
        "tools",
        "rawInput",
        "learningArchive",
        "weaknessSummary",
        "fullTrace",
    ] {
        let mut v = request();
        v[key] = SENTINEL.into();
        assert!(wire::validate(&v).is_err(), "{key}");
    }
    let mut v = request();
    v["provider"]["model"] = "unlisted".into();
    assert!(wire::validate(&v).is_err());
    let mut v = request();
    v["aiVersion"] = "1.0.0".into();
    assert!(wire::validate(&v).is_err());
    let mut v = request();
    v["context"]["snippets"][0]["text"] = "汉".repeat(700).into();
    assert!(wire::context(&v["context"]).is_err());
    let mut v = request();
    v["context"]["snippets"][0]["byteRange"]["end"] = 0.into();
    assert!(wire::context(&v["context"]).is_err());
    let mut v = request();
    v["context"]["facts"][1]["factId"] = v["context"]["facts"][0]["factId"].clone();
    assert!(wire::context(&v["context"]).is_err());
    let mut v = request();
    v["context"]["cursor"] = 0.into();
    assert!(wire::context(&v["context"]).is_err());
    let mut v = request();
    v["context"]["traceAvailable"] = false.into();
    v["context"]["cursor"] = Value::Null;
    assert!(wire::validate(&v).is_err());
}
#[test]
fn response_output_and_actual_reference_allowlist_are_strict() {
    let req = request();
    let raw = upstream_packet(&req, Provider::OpenAi);
    let output = wire::response(&req, Provider::OpenAi, &raw, 20).unwrap();
    assert_eq!(output["producer"], "provider-api-adapter");
    assert_eq!(
        wire::response(&req, Provider::OpenAi, &raw, 60000).unwrap_err(),
        "E_AI_DEADLINE"
    );
    for (path, value, expected) in [
        ("/model", json!("unlisted"), "E_AI_MODEL_MISMATCH"),
        (
            "/choices/0/finish_reason",
            json!("length"),
            "E_AI_PROTOCOL_INVALID",
        ),
        (
            "/choices/0/finish_reason",
            json!("content_filter"),
            "E_AI_REFUSED",
        ),
        (
            "/choices/0/message/refusal",
            json!("refused"),
            "E_AI_REFUSED",
        ),
        (
            "/choices/0/message/reasoning_content",
            json!("unwanted"),
            "E_AI_PROTOCOL_INVALID",
        ),
        (
            "/choices/0/message/tool_calls",
            json!([]),
            "E_AI_PROTOCOL_INVALID",
        ),
    ] {
        let mut v: Value = serde_json::from_slice(&raw).unwrap();
        if let Some(target) = v.pointer_mut(path) {
            *target = value;
        } else {
            v["choices"][0]["message"][path.rsplit('/').next().unwrap()] = value;
        }
        assert_eq!(
            wire::response(&req, Provider::OpenAi, &serde_json::to_vec(&v).unwrap(), 20)
                .unwrap_err(),
            expected,
            "{path}"
        );
    }
    let mut v: Value = serde_json::from_slice(&raw).unwrap();
    let mut content = fixtures()["examples"][0]["hypotheticalResponse"]["content"].clone();
    content["explanations"][0]["factIds"] = json!(["f12"]);
    v["choices"][0]["message"]["content"] = serde_json::to_string(&content).unwrap().into();
    assert_eq!(
        wire::response(&req, Provider::OpenAi, &serde_json::to_vec(&v).unwrap(), 20).unwrap_err(),
        "E_AI_INVALID_REFERENCE"
    );
    for content in ["   ", "{bad}", "{\"summary\":\"x\",\"summary\":\"y\"}"] {
        v["choices"][0]["message"]["content"] = content.into();
        assert!(
            wire::response(&req, Provider::OpenAi, &serde_json::to_vec(&v).unwrap(), 20).is_err()
        );
    }
}
#[test]
fn provider_statuses_map_only_to_closed_codes_never_upstream_messages() {
    let raw =
        format!("{{\"error\":{{\"message\":\"{SENTINEL}\",\"code\":\"insufficient_quota\"}}}}");
    assert_eq!(wire::upstream_code(401, raw.as_bytes()), "E_AI_AUTH");
    assert_eq!(wire::upstream_code(403, b""), "E_AI_PERMISSION");
    assert_eq!(wire::upstream_code(402, b""), "E_AI_QUOTA");
    assert_eq!(wire::upstream_code(429, raw.as_bytes()), "E_AI_QUOTA");
    assert_eq!(wire::upstream_code(429, b"not json"), "E_AI_RATE_LIMIT");
    assert_eq!(wire::upstream_code(500, raw.as_bytes()), "E_AI_PROVIDER");
    assert!(
        !wire::error(&request(), wire::upstream_code(401, raw.as_bytes()))
            .to_string()
            .contains(SENTINEL)
    );
}
#[test]
fn dns_private_mapped_metadata_multicast_and_documentation_addresses_are_rejected() {
    for addr in [
        "127.0.0.1",
        "10.0.0.1",
        "192.168.0.1",
        "172.16.1.2",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "198.18.0.1",
        "192.0.2.1",
        "224.0.0.1",
        "::1",
        "::ffff:8.8.8.8",
        "fe80::1",
        "fc00::1",
        "2001:db8::1",
    ] {
        assert!(!network::public_ip(addr.parse().unwrap()), "{addr}");
    }
    assert!(network::public_ip("8.8.8.8".parse().unwrap()));
    assert!(network::public_ip("2606:4700:4700::1111".parse().unwrap()));
}
struct Immediate;
impl Upstream for Immediate {
    fn call(&self, p: Provider, verify: bool, _key: String, body: Vec<u8>) -> Call {
        Box::pin(async move {
            assert!(!String::from_utf8_lossy(&body).contains(SENTINEL));
            Ok(network::RawResponse {
                status: 200,
                bytes: serde_json::to_vec(&if verify {
                    json!({"data":[{"id":p.model()}]})
                } else {
                    serde_json::from_slice::<Value>(&upstream_packet(&request(), p)).unwrap()
                })
                .unwrap(),
            })
        })
    }
}
async fn start(upstream: Arc<dyn Upstream>) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = make_router(config(port), upstream);
    (
        format!("http://127.0.0.1:{port}"),
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() }),
    )
}
fn post(
    client: &reqwest::Client,
    origin: &str,
    path: &str,
    body: &Value,
) -> reqwest::RequestBuilder {
    client
        .post(format!("{origin}/api/ai/v2/{path}"))
        .header("Origin", origin)
        .header("Sec-Fetch-Site", "same-origin")
        .header("Sec-Fetch-Mode", "same-origin")
        .header("X-CViz-API-Key", SENTINEL)
        .header("Content-Type", "application/json")
        .body(serde_json::to_vec(body).unwrap())
}
#[tokio::test]
async fn real_http_capabilities_static_csp_verify_and_explain_use_one_origin() {
    let (origin, server) = start(Arc::new(Immediate)).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let page = client.get(format!("{origin}/")).send().await.unwrap();
    assert_eq!(page.status(), 200);
    let csp = page.headers()["content-security-policy"].to_str().unwrap();
    assert!(csp.contains("connect-src 'self'") && !csp.contains("'unsafe-eval'"));
    assert!(page.text().await.unwrap().contains("<html"));
    let cap = client
        .get(format!("{origin}/api/ai/v2/capabilities"))
        .send()
        .await
        .unwrap();
    assert_eq!(cap.headers()["cache-control"], "no-store");
    let v: Value = cap.json().await.unwrap();
    assert_eq!(v["providers"].as_array().unwrap().len(), 2);
    let v: Value = post(&client, &origin, "verify", &config_request())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(v["verified"], true);
    wire::validate(&v).unwrap();
    let v: Value = post(&client, &origin, "explain", &request())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(v["kind"], "explain.response");
    wire::validate(&v).unwrap();
    server.abort();
}
#[tokio::test]
async fn static_compression_negotiates_brotli_gzip_and_identity_without_changing_resources() {
    let (origin, server) = start(Arc::new(Immediate)).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let root = config(1).static_dir;
    let html = std::fs::read_to_string(root.join("index.html")).unwrap();
    let path = html
        .split("src=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    for (encoding, suffix) in [("br", ".br"), ("gzip", ".gz"), ("identity", "")] {
        let expected =
            std::fs::read(root.join(format!("{}{suffix}", path.trim_start_matches('/')))).unwrap();
        let response = client
            .get(format!("{origin}{path}"))
            .header("Accept-Encoding", encoding)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(
            response.headers()["content-type"]
                .to_str()
                .unwrap()
                .contains("javascript")
        );
        if encoding == "identity" {
            assert!(response.headers().get("content-encoding").is_none());
        } else {
            assert_eq!(response.headers()["content-encoding"], encoding);
        }
        assert_eq!(
            response.bytes().await.unwrap().as_ref(),
            expected.as_slice()
        );
    }
    server.abort();
}
#[tokio::test]
async fn real_http_rejects_cross_origin_arbitrary_urls_extra_secrets_and_oversized_requests() {
    let (origin, server) = start(Arc::new(Immediate)).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let r = post(&client, &origin, "verify", &config_request())
        .header("Origin", "https://cross.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    assert!(!r.text().await.unwrap().contains(SENTINEL));
    for key in ["apiKey", "baseURL", "learningArchive"] {
        let mut v = config_request();
        v[key] = SENTINEL.into();
        let r = post(&client, &origin, "verify", &v).send().await.unwrap();
        assert_eq!(r.status(), 400);
        assert!(!r.text().await.unwrap().contains(SENTINEL));
    }
    let r = post(&client, &origin, "verify", &config_request())
        .body(" ".repeat(1025))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 413);
    let r = post(
        &client,
        &origin,
        "verify?key=DESIGN_ONLY",
        &config_request(),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(r.status(), 400);
    assert!(!r.text().await.unwrap().contains("DESIGN_ONLY"));
    server.abort();
}
struct TestNetwork(String);
impl Upstream for TestNetwork {
    fn call(&self, _: Provider, verify: bool, key: String, body: Vec<u8>) -> Call {
        let url = self.0.clone();
        Box::pin(async move {
            let client = reqwest::Client::builder()
                .no_proxy()
                .pool_max_idle_per_host(0)
                .build()
                .unwrap();
            network::authenticated(&client, &url, verify, key, body).await
        })
    }
}
#[tokio::test]
async fn real_http_disconnect_closes_the_outbound_socket_and_releases_the_slot() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/models", listener.local_addr().unwrap());
    let (ready, started) = tokio::sync::oneshot::channel();
    let (closed, observed) = tokio::sync::oneshot::channel();
    let fake = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut raw = Vec::new();
        let mut chunk = [0u8; 1024];
        while !raw.windows(4).any(|v| v == b"\r\n\r\n") {
            let n = socket.read(&mut chunk).await.unwrap();
            if n == 0 {
                return;
            }
            raw.extend_from_slice(&chunk[..n]);
        }
        assert!(raw.len() < 16384);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\n{\r\n").await.unwrap();
        let _ = ready.send(());
        let ended = !socket.read(&mut chunk).await.is_ok_and(|n| n > 0);
        let _ = closed.send(ended);
    });
    let (origin, server) = start(Arc::new(TestNetwork(url))).await;
    let client = reqwest::Client::builder()
        .no_proxy()
        .pool_max_idle_per_host(0)
        .build()
        .unwrap();
    let response = post(&client, &origin, "verify", &config_request())
        .send()
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), started)
        .await
        .unwrap()
        .unwrap();
    let busy = post(&client, &origin, "verify", &json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(busy.status(), 409);
    drop(busy);
    drop(response);
    assert!(
        tokio::time::timeout(Duration::from_secs(3), observed)
            .await
            .unwrap()
            .unwrap()
    );
    let next = post(&client, &origin, "verify", &json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(next.status(), 400);
    server.abort();
    fake.abort();
}
struct Pending;
impl Upstream for Pending {
    fn call(&self, _: Provider, _: bool, _: String, _: Vec<u8>) -> Call {
        Box::pin(std::future::pending())
    }
}

#[tokio::test(start_paused = true)]
async fn original_sixty_second_explanation_deadline_releases_the_slot() {
    let state = Arc::new(Gateway {
        config: config(4173),
        slot: Arc::new(Semaphore::new(1)),
        upstream: Arc::new(Pending),
    });
    let req = Request::builder()
        .uri("/api/ai/v2/explain")
        .method("POST")
        .header("Host", "127.0.0.1:4173")
        .header("Origin", "http://127.0.0.1:4173")
        .header("Sec-Fetch-Site", "same-origin")
        .header("Sec-Fetch-Mode", "same-origin")
        .header("Content-Type", "application/json")
        .header("X-CViz-API-Key", SENTINEL)
        .body(Body::from(serde_json::to_vec(&request()).unwrap()))
        .unwrap();
    let response = intake(Arc::clone(&state), req, false).await;
    let task = tokio::spawn(async move { to_bytes(response.into_body(), 12288).await.unwrap() });
    tokio::task::yield_now().await;
    assert_eq!(state.slot.available_permits(), 0);
    tokio::time::advance(Duration::from_secs(60)).await;
    let result = wire::parse(&task.await.unwrap(), 12288).unwrap();
    assert_eq!(result["code"], "E_AI_DEADLINE");
    assert_eq!(state.slot.available_permits(), 1);
}

#[tokio::test]
async fn chunked_upstream_is_stopped_at_the_original_64k_limit() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut raw = Vec::new();
        let mut part = [0u8; 1024];
        while !raw.windows(4).any(|v| v == b"\r\n\r\n") {
            let n = socket.read(&mut part).await.unwrap();
            assert!(n > 0);
            raw.extend_from_slice(&part[..n]);
        }
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
        for _ in 0..9 {
            if socket.write_all(b"2000\r\n").await.is_err() {
                return;
            }
            if socket.write_all(&vec![b' '; 8192]).await.is_err() {
                return;
            }
            if socket.write_all(b"\r\n").await.is_err() {
                return;
            }
        }
        let _ = socket.write_all(b"0\r\n\r\n").await;
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .pool_max_idle_per_host(0)
        .build()
        .unwrap();
    let result = network::authenticated(&client, &url, true, SENTINEL.into(), Vec::new()).await;
    assert!(matches!(result, Err("E_AI_RESULT_LIMIT")));
    server.await.unwrap();
}
#[tokio::test(start_paused = true)]
async fn original_ten_second_verify_deadline_is_enforced_without_background_work() {
    let state = Arc::new(Gateway {
        config: config(4173),
        slot: Arc::new(Semaphore::new(1)),
        upstream: Arc::new(Pending),
    });
    let req = Request::builder()
        .uri("/api/ai/v2/verify")
        .method("POST")
        .header("Host", "127.0.0.1:4173")
        .header("Origin", "http://127.0.0.1:4173")
        .header("Sec-Fetch-Site", "same-origin")
        .header("Sec-Fetch-Mode", "same-origin")
        .header("Content-Type", "application/json")
        .header("X-CViz-API-Key", SENTINEL)
        .body(Body::from(serde_json::to_vec(&config_request()).unwrap()))
        .unwrap();
    let response = intake(Arc::clone(&state), req, true).await;
    let task = tokio::spawn(async move { to_bytes(response.into_body(), 12288).await.unwrap() });
    tokio::task::yield_now().await;
    assert_eq!(state.slot.available_permits(), 0);
    tokio::time::advance(Duration::from_secs(10)).await;
    let result = wire::parse(&task.await.unwrap(), 12288).unwrap();
    assert_eq!(result["code"], "E_AI_DEADLINE");
    assert_eq!(state.slot.available_permits(), 1);
}
