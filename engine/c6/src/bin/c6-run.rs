//! Internal validation driver for the real Rust interpreter, not a native C runner.
use std::io::{Read, Write};
fn main() {
    let build_id = std::env::args().nth(1).unwrap_or_default();
    let mut input = vec![];
    std::io::stdin()
        .take(65537)
        .read_to_end(&mut input)
        .expect("read request");
    let result = std::thread::Builder::new()
        .name("c6-validation".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            let mut meter = c_viz_c6::budget::Meter::new();
            c_viz_c6::execute(&input, &build_id, &mut meter)
        })
        .expect("validation thread")
        .join()
        .expect("validation worker");
    match result {
        Ok(output) => {
            std::io::stdout().write_all(&output).unwrap();
        }
        Err(code) => {
            eprintln!("{code}");
            std::process::exit(2);
        }
    }
}
