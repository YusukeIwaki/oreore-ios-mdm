//! MDM vendor signing (`mdm-vendor-sign`).
//!
//! Signs `push.csr` with a vendor key from a `.p12` archive and writes the
//! Base64-encoded plist to `push_signed.req`, ready for upload to
//! `https://identity.apple.com/pushcert/`.

use std::fs;
use std::path::Path;

use base64::Engine as _;
use openssl::hash::MessageDigest;
use openssl::pkcs12::Pkcs12;
use openssl::sign::Signer;
use openssl::stack::Stack;
use openssl::x509::store::X509StoreBuilder;
use openssl::x509::{X509Req, X509StoreContext, X509};

use crate::{base64_encode_wrapped, Error};

/// Sign `push.csr` with the vendor key and write `push_signed.req` into `dir`.
pub fn vendor_sign(
    dir: &Path,
    vendor_p12_path: &Path,
    vendor_p12_password: &str,
) -> Result<(), Error> {
    let der = fs::read(vendor_p12_path)?;
    let vendor = Pkcs12::from_der(&der)?;
    let parsed = vendor.parse2(vendor_p12_password)?;

    let push_csr = X509Req::from_pem(&fs::read(dir.join("push.csr"))?)?;
    let csr_der = push_csr.to_der()?;
    let pkey = parsed.pkey.as_ref().ok_or(Error::MissingVendorKey)?;
    let mut signer = Signer::new(MessageDigest::sha256(), pkey)?;
    signer.update(&csr_der)?;
    let signature = signer.sign_to_vec()?;

    let ca_certs: Vec<X509> = parsed
        .ca
        .as_ref()
        .map(|stack| stack.iter().map(|cert| cert.to_owned()).collect())
        .unwrap_or_default();
    let chain_pem = verified_chain_pem(
        parsed
            .cert
            .as_ref()
            .ok_or(Error::MissingVendorCertificate)?,
        &ca_certs,
    )?;

    let mut payload = plist::Dictionary::new();
    payload.insert(
        "PushCertCertificateChain".to_owned(),
        plist::Value::String(chain_pem),
    );
    payload.insert(
        "PushCertRequestCSR".to_owned(),
        plist::Value::String(base64_encode_wrapped(&csr_der)),
    );
    payload.insert(
        "PushCertSignature".to_owned(),
        plist::Value::String(base64_encode_wrapped(&signature)),
    );
    let mut xml = Vec::new();
    plist::to_writer_xml(&mut xml, &plist::Value::Dictionary(payload))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&xml);
    fs::write(dir.join("push_signed.req"), encoded)?;
    Ok(())
}

/// Collect the PEM-encoded verification chain for the vendor certificate.
///
/// The Ruby script calls `store.verify` but ignores the result, so a failure
/// only produces a warning here as well and signing continues.
fn verified_chain_pem(vendor_cert: &X509, ca_certs: &[X509]) -> Result<String, Error> {
    let mut store_builder = X509StoreBuilder::new()?;
    for ca in ca_certs {
        store_builder.add_cert(ca.clone())?;
    }
    let store = store_builder.build();
    let untrusted = Stack::new()?;
    let mut context = X509StoreContext::new()?;
    let chain = context.init(&store, vendor_cert, &untrusted, |context| {
        if !context.verify_cert().unwrap_or(false) {
            eprintln!(
                "warning: vendor certificate does not verify against its CA chain; continuing anyway"
            );
        }
        let chain = context
            .chain()
            .map(|stack| stack.iter().map(|cert| cert.to_owned()).collect())
            .unwrap_or_else(Vec::new);
        Ok(chain)
    })?;

    let mut pem = String::new();
    for cert in &chain {
        pem.push_str(&String::from_utf8(cert.to_pem()?)?);
    }
    Ok(pem)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{build_push_csr, build_server_certificate};
    use openssl::pkey::PKey;
    use openssl::rsa::Rsa;

    fn vendor_p12(
        vendor_key: &openssl::rsa::Rsa<openssl::pkey::Private>,
        vendor_cert: &X509,
    ) -> Vec<u8> {
        let pkey = PKey::from_rsa(vendor_key.clone()).unwrap();
        let mut builder = Pkcs12::builder();
        builder.name("vendor").pkey(&pkey).cert(vendor_cert);
        builder.build2("vendor-pass").unwrap().to_der().unwrap()
    }

    fn plist_strings(xml: &[u8]) -> plist::Dictionary {
        match plist::from_reader(std::io::Cursor::new(xml)).unwrap() {
            plist::Value::Dictionary(dict) => dict,
            other => panic!("expected a plist dictionary, got {other:?}"),
        }
    }

    fn strict_decode_wrapped(wrapped: &str) -> Vec<u8> {
        let flat: String = wrapped.chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD
            .decode(flat)
            .unwrap()
    }

    #[test]
    fn collects_pem_chain_for_verifying_certificate() {
        let key = Rsa::generate(1024).unwrap();
        let cert = build_server_certificate(&key).unwrap();

        let pem = verified_chain_pem(&cert, std::slice::from_ref(&cert)).unwrap();
        assert_eq!(pem, String::from_utf8(cert.to_pem().unwrap()).unwrap());
    }

    #[test]
    fn signs_csr_and_writes_signed_request() {
        let dir = tempfile::tempdir().unwrap();
        let push_key = Rsa::generate(1024).unwrap();
        fs::write(
            dir.path().join("push.csr"),
            build_push_csr(&push_key).unwrap().to_pem().unwrap(),
        )
        .unwrap();

        let vendor_key = Rsa::generate(1024).unwrap();
        let vendor_cert = build_server_certificate(&vendor_key).unwrap();
        let vendor_path = dir.path().join("vendor.p12");
        fs::write(&vendor_path, vendor_p12(&vendor_key, &vendor_cert)).unwrap();

        vendor_sign(dir.path(), &vendor_path, "vendor-pass").unwrap();

        let encoded = fs::read_to_string(dir.path().join("push_signed.req")).unwrap();
        assert!(!encoded.contains('\n'));
        let xml = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let payload = plist_strings(&xml);

        let csr_der = strict_decode_wrapped(payload["PushCertRequestCSR"].as_string().unwrap());
        let signature = strict_decode_wrapped(payload["PushCertSignature"].as_string().unwrap());
        let vendor_public = PKey::from_rsa(
            Rsa::public_key_from_pem(&vendor_key.public_key_to_pem().unwrap()).unwrap(),
        )
        .unwrap();
        let mut verifier =
            openssl::sign::Verifier::new(MessageDigest::sha256(), &vendor_public).unwrap();
        verifier.update(&csr_der).unwrap();
        assert!(verifier.verify(&signature).unwrap());
        // With no CA certs in the .p12, verification fails (see the warning
        // above) and the attempted chain — just the vendor certificate, same
        // as Ruby's `store.chain` — is collected.
        assert_eq!(
            payload["PushCertCertificateChain"].as_string().unwrap(),
            String::from_utf8(vendor_cert.to_pem().unwrap()).unwrap()
        );
    }
}
