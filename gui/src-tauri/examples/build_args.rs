// The argv the GUI hands FASTag for one run request, from the shipped
// build_args: reads the request JSON ({in, out, params}) on stdin and prints
// the argv as a JSON array. gui/src/adversarial/cli-consistency.test.tsx runs
// it against the installed CLI. `cargo test` builds it
// (target/debug/examples/build_args).
use std::io::Read;

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).expect("read stdin");
    match fastag_lib::build_args_json(&s) {
        Ok(args) => println!("{}", serde_json::to_string(&args).expect("serialize argv")),
        Err(e) => {
            eprintln!("bad run request: {e}");
            std::process::exit(2);
        }
    }
}
