//! Package the push identity and mint the device certificate
//! (`util/use_push_certificate.rb`).
//!
//! Run from the repository root:
//! `PUSH_CERTIFICATE_PASSWORD=... cargo run -p mdm-tools --bin use-push-certificate -- <path to push_certificate .pem file>`

use std::path::{Path, PathBuf};

use mdm_tools::Error;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Error> {
    let filepath: String = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    if filepath.is_empty() {
        println!("Usage: use-push-certificate <path to push_certificate .pem file>");
        std::process::exit(1);
    }
    let path = PathBuf::from(filepath);
    if !path.exists() {
        return Err(Error::NotFound(path));
    }
    let Ok(password) = std::env::var("PUSH_CERTIFICATE_PASSWORD") else {
        println!("Please set an environment variable: PUSH_CERTIFICATE_PASSWORD");
        std::process::exit(1);
    };
    let output = mdm_tools::use_push_certificate(Path::new("util"), &path, &password)?;
    println!("set environment variables:");
    println!(
        "  PUSH_CERTIFICATE_BASE64={}",
        output.push_certificate_base64
    );
    println!(
        "  SERVER_PRIVATE_KEY_BASE64={}",
        output.server_private_key_base64
    );
    println!(
        "  DEVICE_CERTIFICATE_BASE64={}",
        output.device_certificate_base64
    );
    Ok(())
}
