fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        // This stack is part of, never additional to, the fixed128MiB linear memory.
        println!("cargo:rustc-link-arg=-z");
        println!("cargo:rustc-link-arg=stack-size=8388608");
    }
}
