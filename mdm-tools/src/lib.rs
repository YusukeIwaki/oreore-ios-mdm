//! Shared building blocks for the oreore-ios-mdm certificate utilities.
//!
//! Each binary in `src/bin` is a thin CLI wrapper around the functions exposed
//! here. The functions take explicit paths (instead of assuming the current
//! directory) so the behavior stays unit-testable without touching the real
//! `util/` directory.

mod certs;
mod keys;
mod mdmcert;
mod pkcs7;
mod push_cert;
mod vendor_sign;

pub use certs::{
    build_device_certificate, build_push_csr, build_server_certificate, create_server_certificates,
};
pub use keys::{create_dep_key, load_or_generate_rsa_key};
pub use mdmcert::{
    build_sign_request_body, is_success_response, send_sign_request, MDMCERT_DOWNLOAD_BASE_URL,
};
pub use pkcs7::decrypt_push_signed_request;
pub use push_cert::{use_push_certificate, PushCertificateOutput};
pub use vendor_sign::vendor_sign;

use std::fmt;
use std::path::PathBuf;
use std::time::SystemTime;

/// Failure modes shared by all tools.
#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Ssl(openssl::error::ErrorStack),
    Plist(plist::Error),
    Json(serde_json::Error),
    Http(ureq::Error),
    Utf8(std::string::FromUtf8Error),
    Hex(String),
    Clock,
    MissingEnv(&'static str),
    NotFound(PathBuf),
    MissingVendorCertificate,
    MissingVendorKey,
    SignRequestRejected { status: u16, body: String },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(error) => write!(f, "I/O error: {error}"),
            Error::Ssl(error) => write!(f, "OpenSSL error: {error}"),
            Error::Plist(error) => write!(f, "plist error: {error}"),
            Error::Json(error) => write!(f, "JSON error: {error}"),
            Error::Http(error) => write!(f, "HTTP error: {error}"),
            Error::Utf8(error) => write!(f, "UTF-8 error: {error}"),
            Error::Hex(detail) => write!(f, "invalid hex input: {detail}"),
            Error::Clock => write!(f, "system clock is before the UNIX epoch"),
            Error::MissingEnv(key) => write!(f, "ENV['{key}'] is not set"),
            Error::NotFound(path) => write!(f, "File not found: {}", path.display()),
            Error::MissingVendorCertificate => {
                write!(f, "vendor .p12 archive contains no certificate")
            }
            Error::MissingVendorKey => {
                write!(f, "vendor .p12 archive contains no private key")
            }
            Error::SignRequestRejected { status, body } => {
                write!(f, "signing request rejected (HTTP {status}): {body}")
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Io(error) => Some(error),
            Error::Ssl(error) => Some(error),
            Error::Plist(error) => Some(error),
            Error::Json(error) => Some(error),
            Error::Http(error) => Some(error),
            Error::Utf8(error) => Some(error),
            _ => None,
        }
    }
}

macro_rules! from_error {
    ($variant:ident, $type:ty) => {
        impl From<$type> for Error {
            fn from(error: $type) -> Self {
                Error::$variant(error)
            }
        }
    };
}

from_error!(Io, std::io::Error);
from_error!(Ssl, openssl::error::ErrorStack);
from_error!(Plist, plist::Error);
from_error!(Json, serde_json::Error);
from_error!(Http, ureq::Error);
from_error!(Utf8, std::string::FromUtf8Error);

/// Base64 with Ruby `Base64.encode64` line wrapping: 60 characters per line,
/// every line (including the last) terminated with `\n`.
pub fn base64_encode_wrapped(bytes: &[u8]) -> String {
    use base64::Engine as _;

    let flat = base64::engine::general_purpose::STANDARD.encode(bytes);
    if flat.is_empty() {
        return String::new();
    }
    let mut wrapped = String::with_capacity(flat.len() + flat.len() / 60 + 1);
    for chunk in flat.as_bytes().chunks(60) {
        // Base64 output is pure ASCII by construction.
        wrapped.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        wrapped.push('\n');
    }
    wrapped
}

/// Strict hex decoding. ASCII whitespace is tolerated (and ignored) so that
/// files with a trailing newline decode the same way Ruby's `pack('H*')` does.
pub fn hex_decode(text: &str) -> Result<Vec<u8>, Error> {
    fn nibble(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let digits: Vec<u8> = text
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    if !digits.len().is_multiple_of(2) {
        return Err(Error::Hex("odd number of hex digits".to_owned()));
    }
    let mut bytes = Vec::with_capacity(digits.len() / 2);
    for pair in digits.as_chunks::<2>().0 {
        match (nibble(pair[0]), nibble(pair[1])) {
            (Some(high), Some(low)) => bytes.push(high << 4 | low),
            _ => {
                return Err(Error::Hex(format!(
                    "invalid hex digit in {:?}",
                    String::from_utf8_lossy(pair)
                )));
            }
        }
    }
    Ok(bytes)
}

pub(crate) fn unix_now() -> Result<i64, Error> {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .map_err(|_| Error::Clock)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    #[test]
    fn wrapped_base64_matches_ruby_encode64() {
        // Vectors cross-checked against Ruby's Base64.encode64.
        assert_eq!(base64_encode_wrapped(b""), "");
        assert_eq!(base64_encode_wrapped(b"a"), "YQ==\n");
        assert_eq!(
            base64_encode_wrapped(&[0u8; 45]),
            format!("{}\n", "A".repeat(60))
        );
        assert_eq!(
            base64_encode_wrapped(&[0u8; 46]),
            format!("{}\nAA==\n", "A".repeat(60))
        );
    }

    #[test]
    fn wrapped_base64_roundtrips() {
        let payload: Vec<u8> = (0..500u32).map(|n| (n % 251) as u8).collect();
        let wrapped = base64_encode_wrapped(&payload);
        for line in wrapped.split('\n') {
            assert!(line.len() <= 60, "line too long: {line:?}");
        }
        assert!(wrapped.ends_with('\n'));
        let flat: String = wrapped.chars().filter(|c| *c != '\n').collect();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(flat)
                .unwrap(),
            payload
        );
    }

    #[test]
    fn hex_decode_accepts_mixed_case_and_whitespace() {
        assert_eq!(
            hex_decode("deadBEEF").unwrap(),
            vec![0xde, 0xad, 0xbe, 0xef]
        );
        assert_eq!(hex_decode("  de ad\n").unwrap(), vec![0xde, 0xad]);
        assert_eq!(hex_decode("").unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn hex_decode_rejects_garbage() {
        assert!(hex_decode("abc").is_err());
        assert!(hex_decode("zz").is_err());
        assert!(hex_decode("0g").is_err());
    }
}
