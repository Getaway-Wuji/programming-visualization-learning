use c_viz_ai_proxy::{Config, router};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
};
#[tokio::main]
async fn main() {
    std::panic::set_hook(Box::new(|_| eprintln!("AI gateway stopped.")));
    if run().await.is_err() {
        eprintln!(
            "AI gateway could not start or continue. Check the fixed port, origin and built static directory."
        );
        std::process::exit(1);
    }
}
async fn run() -> Result<(), ()> {
    let mut port = 4173u16;
    let mut origin = None;
    let mut base = "/".to_owned();
    let mut root = PathBuf::from("web/dist");
    let mut args = std::env::args().skip(1);
    while let Some(key) = args.next() {
        let value = args.next().ok_or(())?;
        match key.as_str() {
            "--port" => port = value.parse().map_err(|_| ())?,
            "--origin" => origin = Some(value),
            "--base" => base = value,
            "--static" => root = PathBuf::from(value),
            _ => return Err(()),
        }
    }
    if port == 0 || !root.is_dir() || !root.join("index.html").is_file() {
        return Err(());
    }
    let origin = origin.unwrap_or_else(|| format!("http://127.0.0.1:{port}"));
    let config = Config::new(origin.clone(), base, root).map_err(|_| ())?;
    let listener =
        tokio::net::TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port))
            .await
            .map_err(|_| ())?;
    println!(
        "AI gateway ready at {origin}; optional AI is off until user configuration. No request content or credentials are logged."
    );
    axum::serve(listener, router(config)).await.map_err(|_| ())
}
