use crate::wire::{Provider, Result, require};
use reqwest::{
    Client,
    header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue},
};
use std::{
    net::{IpAddr, Ipv4Addr},
    time::Duration,
};

// These endpoints and DNS checks cannot be changed by request JSON or environment proxies.
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, _, _] = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_broadcast()
                || v.is_unspecified()
                || v.is_multicast()
                || a == 0
                || a >= 240
                || (a == 100 && (64..=127).contains(&b))
                || (a == 198 && (b == 18 || b == 19))
                || v == Ipv4Addr::new(169, 254, 169, 254)
                || v.is_documentation())
        }
        IpAddr::V6(v) => {
            let octets = v.octets();
            v.to_ipv4_mapped().is_none()
                && octets[0] & 0xe0 == 0x20
                && !(v.segments()[0] == 0x2001
                    && (v.segments()[1] == 0xdb8 || v.segments()[1] == 0))
        }
    }
}
pub struct RawResponse {
    pub status: u16,
    pub bytes: Vec<u8>,
}
pub async fn call(
    provider: Provider,
    verify: bool,
    key: String,
    body: Vec<u8>,
) -> Result<RawResponse> {
    let addresses: Vec<_> = tokio::net::lookup_host((provider.host(), 443))
        .await
        .map_err(|_| "E_AI_NETWORK")?
        .collect();
    require(
        !addresses.is_empty() && addresses.iter().all(|a| public_ip(a.ip())),
        "E_AI_NETWORK",
    )?;
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .https_only(true)
        .http1_only()
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(if verify { 10 } else { 60 }))
        .resolve_to_addrs(provider.host(), &addresses)
        .build()
        .map_err(|_| "E_AI_UNAVAILABLE")?;
    authenticated(&client, provider.endpoint(verify), verify, key, body).await
}
pub(crate) async fn authenticated(
    client: &Client,
    endpoint: &str,
    verify: bool,
    key: String,
    body: Vec<u8>,
) -> Result<RawResponse> {
    let mut authorization =
        HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| "E_AI_UNCONFIGURED")?;
    authorization.set_sensitive(true);
    let request = if verify {
        client.get(endpoint)
    } else {
        client
            .post(endpoint)
            .header(CONTENT_TYPE, "application/json")
            .body(body)
    };
    let mut response = request
        .header(AUTHORIZATION, authorization)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "E_AI_DEADLINE"
            } else {
                "E_AI_NETWORK"
            }
        })?;
    let status = response.status().as_u16();
    require(
        response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.split(';').next() == Some("application/json")),
        "E_AI_PROTOCOL_INVALID",
    )?;
    require(
        response.content_length().is_none_or(|n| n <= 65536),
        "E_AI_RESULT_LIMIT",
    )?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "E_AI_NETWORK")? {
        require(bytes.len() + chunk.len() <= 65536, "E_AI_RESULT_LIMIT")?;
        bytes.extend_from_slice(&chunk);
    }
    Ok(RawResponse { status, bytes })
}
