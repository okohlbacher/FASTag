// The pipe-order helper of gui/src/adversarial/cli-consistency.test.tsx:
// runs `order_rs <cli> <args...>` with the reader shape of fastag.rs run(),
// one blocking thread per pipe, and prints the lines in the order they
// arrived. Node's event loop orders simultaneous pipe data differently from
// two OS threads, so the test takes the arrival order from Rust.
//
// Output on stdout: `rc\t<exit code|null>`, then one `out\t<line>` or
// `err\t<line>` per line (stderr FASTAG_PROGRESS lines dropped, as run()
// turns them into progress events). `cargo test` builds it
// (target/debug/examples/order_rs); before P1 it lived outside the
// repository (scratch/cli/order_rs).
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    if a.is_empty() {
        eprintln!("usage: order_rs <program> [args...]");
        std::process::exit(2);
    }
    let mut c = Command::new(&a[0])
        .args(&a[1..])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("order_rs: cannot run {}: {e}", a[0]);
            std::process::exit(2);
        });
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let (o, e) = (c.stdout.take().expect("stdout"), c.stderr.take().expect("stderr"));
    let l1 = log.clone();
    let t1 = std::thread::spawn(move || {
        for l in BufReader::new(e).lines().map_while(Result::ok) {
            if !l.starts_with("FASTAG_PROGRESS ") {
                l1.lock().expect("log").push(format!("err\t{l}"));
            }
        }
    });
    let l2 = log.clone();
    let t2 = std::thread::spawn(move || {
        for l in BufReader::new(o).lines().map_while(Result::ok) {
            l2.lock().expect("log").push(format!("out\t{l}"));
        }
    });
    t1.join().expect("stderr reader");
    t2.join().expect("stdout reader");
    let st = c.wait().expect("wait");
    let v = log.lock().expect("log");
    println!("rc\t{}", st.code().map(|c| c.to_string()).unwrap_or_else(|| "null".into()));
    for l in v.iter() {
        println!("{l}");
    }
}
