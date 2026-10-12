//! Decrypt a `.b64.p7` envelope from mdmcert.download
//! (`util/mdmcert_download_decrypt.rb`).
//!
//! Run from the repository root:
//! `cargo run -p mdm-tools --bin mdmcert-download-decrypt -- <path to .b64.p7 file>`

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
        println!("Usage: mdmcert-download-decrypt <path to .b64.p7 file>");
        std::process::exit(1);
    }
    let path = PathBuf::from(filepath);
    if !path.exists() {
        return Err(Error::NotFound(path));
    }
    mdm_tools::decrypt_push_signed_request(Path::new("util"), &path)
}
