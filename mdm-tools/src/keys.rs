//! RSA key provisioning (`create-dep-key`, plus key reuse for the other tools).

use std::fs;
use std::path::Path;

use base64::Engine as _;
use openssl::pkey::Private;
use openssl::rsa::Rsa;

use crate::Error;

/// Load an existing PEM-encoded RSA private key, or generate and store a new one.
///
/// Mirrors `openssl_genrsa` in the original Ruby scripts: an existing file is
/// reused as-is, otherwise a fresh key is generated and written back.
pub fn load_or_generate_rsa_key(path: &Path, bits: u32) -> Result<Rsa<Private>, Error> {
    if path.exists() {
        let pem = fs::read(path)?;
        return Ok(Rsa::private_key_from_pem(&pem)?);
    }
    let key = Rsa::generate(bits)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(path, key.private_key_to_pem()?)?;
    Ok(key)
}

/// Provision `dep.key` and return its PEM bytes as strict Base64.
pub fn create_dep_key(dir: &Path, bits: u32) -> Result<String, Error> {
    let key = load_or_generate_rsa_key(&dir.join("dep.key"), bits)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(key.private_key_to_pem()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_key_and_reuses_it_on_second_call() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("dep.key");
        let first = load_or_generate_rsa_key(&path, 1024).unwrap();
        assert!(path.exists());
        let second = load_or_generate_rsa_key(&path, 1024).unwrap();
        assert_eq!(
            first.private_key_to_pem().unwrap(),
            second.private_key_to_pem().unwrap()
        );
    }

    #[test]
    fn dep_key_output_is_base64_of_stored_pem() {
        let dir = tempfile::tempdir().unwrap();
        let encoded = create_dep_key(dir.path(), 1024).unwrap();
        assert!(!encoded.contains('\n'));
        let stored = fs::read(dir.path().join("dep.key")).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert_eq!(stored, decoded);
    }
}
