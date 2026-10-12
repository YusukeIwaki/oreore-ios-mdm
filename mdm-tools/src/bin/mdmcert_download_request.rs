//! Request signing from mdmcert.download (`util/mdmcert_download_request.rb`).
//!
//! Run from the repository root:
//! `MDMCERT_DOWNLOAD_API_KEY=... MDMCERT_DOWNLOAD_EMAIL=... cargo run -p mdm-tools --bin mdmcert-download-request`

use std::fs;
use std::path::Path;

use mdm_tools::Error;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Error> {
    let api_key = std::env::var("MDMCERT_DOWNLOAD_API_KEY")
        .map_err(|_| Error::MissingEnv("MDMCERT_DOWNLOAD_API_KEY"))?;
    let email = std::env::var("MDMCERT_DOWNLOAD_EMAIL")
        .map_err(|_| Error::MissingEnv("MDMCERT_DOWNLOAD_EMAIL"))?;
    let dir = Path::new("util");
    let push_csr_pem = fs::read_to_string(dir.join("push.csr"))?;
    let server_cert_pem = fs::read_to_string(dir.join("server.crt"))?;
    let body =
        mdm_tools::build_sign_request_body(&api_key, &email, &push_csr_pem, &server_cert_pem);
    let message =
        mdm_tools::send_sign_request(mdm_tools::MDMCERT_DOWNLOAD_BASE_URL, &body, &email)?;
    println!("{message}");
    Ok(())
}
