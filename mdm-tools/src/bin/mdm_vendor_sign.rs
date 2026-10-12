//! Sign `push.csr` with the MDM vendor certificate (`util/mdm_vendor_sign.rb`).
//!
//! Run from the repository root:
//! `MDM_VENDOR_CERT_P12_PATH=... MDM_VENDOR_CERT_P12_PASSWORD=... cargo run -p mdm-tools --bin mdm-vendor-sign`

use std::path::{Path, PathBuf};

use mdm_tools::Error;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Error> {
    let p12_path = std::env::var("MDM_VENDOR_CERT_P12_PATH")
        .map_err(|_| Error::MissingEnv("MDM_VENDOR_CERT_P12_PATH"))?;
    let p12_password = std::env::var("MDM_VENDOR_CERT_P12_PASSWORD")
        .map_err(|_| Error::MissingEnv("MDM_VENDOR_CERT_P12_PASSWORD"))?;
    mdm_tools::vendor_sign(Path::new("util"), &PathBuf::from(p12_path), &p12_password)
}
