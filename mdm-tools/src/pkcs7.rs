//! PKCS#7 decryption (`mdmcert-download-decrypt`).

use std::fs;
use std::path::Path;

use openssl::pkcs7::{Pkcs7, Pkcs7Flags};
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::x509::X509;

use crate::{hex_decode, Error};

/// Decrypt a hex-encoded `.b64.p7` envelope with the server key and store the
/// resulting Base64 plist as `push_signed.req`.
pub fn decrypt_push_signed_request(dir: &Path, input_path: &Path) -> Result<(), Error> {
    let hex = fs::read_to_string(input_path)?;
    let envelope = Pkcs7::from_der(&hex_decode(&hex)?)?;
    let server_key = PKey::from_rsa(Rsa::private_key_from_pem(&fs::read(
        dir.join("server.key"),
    )?)?)?;
    let server_cert = X509::from_pem(&fs::read(dir.join("server.crt"))?)?;
    let plaintext = envelope.decrypt(&server_key, &server_cert, Pkcs7Flags::empty())?;
    fs::write(dir.join("push_signed.req"), plaintext)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_server_certificates;
    use openssl::symm::Cipher;

    #[test]
    fn decrypts_envelope_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        create_server_certificates(dir.path(), 1024, 1024).unwrap();
        let cert = X509::from_pem(&fs::read(dir.path().join("server.crt")).unwrap()).unwrap();

        let plaintext = b"push-signed-request-payload";
        let mut recipients = openssl::stack::Stack::new().unwrap();
        recipients.push(cert).unwrap();
        let envelope = Pkcs7::encrypt(
            &recipients,
            plaintext,
            Cipher::aes_128_cbc(),
            Pkcs7Flags::empty(),
        )
        .unwrap();
        let hex: String = envelope
            .to_der()
            .unwrap()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let input = dir.path().join("vendor.b64.p7");
        fs::write(&input, format!("{hex}\n")).unwrap();

        decrypt_push_signed_request(dir.path(), &input).unwrap();
        assert_eq!(
            fs::read(dir.path().join("push_signed.req")).unwrap(),
            plaintext
        );
    }
}
