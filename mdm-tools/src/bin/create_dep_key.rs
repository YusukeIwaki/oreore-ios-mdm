//! Provision the DEP key (`util/create_dep_key.rb`).
//!
//! Run from the repository root: `cargo run -p mdm-tools --bin create-dep-key`

use std::path::Path;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), mdm_tools::Error> {
    let encoded = mdm_tools::create_dep_key(Path::new("util"), 4096)?;
    println!("set an environment variable:");
    println!("  DEP_KEY_BASE64={encoded}");
    Ok(())
}
