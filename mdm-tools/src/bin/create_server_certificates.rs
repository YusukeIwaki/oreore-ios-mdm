//! Provision server / push keys and certificates
//! (`util/create_server_certificates.rb`).
//!
//! Run from the repository root:
//! `cargo run -p mdm-tools --bin create-server-certificates`

use std::path::Path;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), mdm_tools::Error> {
    mdm_tools::create_server_certificates(Path::new("util"), 4096, 2048)
}
