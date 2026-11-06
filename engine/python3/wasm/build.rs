fn main() {
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg=-z");
        println!("cargo:rustc-link-arg=stack-size=8388608");
        println!("cargo:rustc-link-arg=--max-memory=134217728");
    }
}
