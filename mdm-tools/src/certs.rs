//! Server / push certificate provisioning (`create-server-certificates`).

use std::fs;
use std::path::Path;
use std::time::Duration;

use openssl::asn1::{Asn1Integer, Asn1Time};
use openssl::bn::BigNum;
use openssl::hash::MessageDigest;
use openssl::pkey::{PKey, Private};
use openssl::rsa::Rsa;
use openssl::x509::{X509Name, X509Req, X509};

use crate::keys::load_or_generate_rsa_key;
use crate::unix_now;
use crate::Error;

const ONE_YEAR: Duration = Duration::from_secs(60 * 60 * 24 * 365);

fn subject_name(entries: &[(&str, &str)]) -> Result<X509Name, Error> {
    let mut builder = X509Name::builder()?;
    for (field, value) in entries {
        builder.append_entry_by_text(field, value)?;
    }
    Ok(builder.build())
}

fn validity_window() -> Result<(Asn1Time, Asn1Time), Error> {
    let now = unix_now()?;
    Ok((
        Asn1Time::from_unix(now)?,
        Asn1Time::from_unix(now + ONE_YEAR.as_secs() as i64)?,
    ))
}

fn zero_serial() -> Result<Asn1Integer, Error> {
    Ok(BigNum::from_u32(0)?.to_asn1_integer()?)
}

fn build_certificate(
    key: &Rsa<Private>,
    issuer: &[(&str, &str)],
    subject: &[(&str, &str)],
) -> Result<X509, Error> {
    let pkey = PKey::from_rsa(key.clone())?;
    let (not_before, not_after) = validity_window()?;
    let mut builder = X509::builder()?;
    builder.set_not_before(&not_before)?;
    builder.set_not_after(&not_after)?;
    builder.set_pubkey(&pkey)?;
    let serial = zero_serial()?;
    builder.set_serial_number(&serial)?;
    let issuer_name = subject_name(issuer)?;
    builder.set_issuer_name(&issuer_name)?;
    let subject_name = subject_name(subject)?;
    builder.set_subject_name(&subject_name)?;
    builder.sign(&pkey, MessageDigest::sha256())?;
    Ok(builder.build())
}

/// Self-signed `CN=oreore-mdm` server certificate, valid for one year.
pub fn build_server_certificate(server_key: &Rsa<Private>) -> Result<X509, Error> {
    build_certificate(server_key, &[("CN", "oreore-mdm")], &[("CN", "oreore-mdm")])
}

/// Device certificate issued by the server key (`CN=oreore-mdm-device`).
pub fn build_device_certificate(server_key: &Rsa<Private>) -> Result<X509, Error> {
    build_certificate(
        server_key,
        &[("CN", "oreore-mdm")],
        &[("CN", "oreore-mdm-device")],
    )
}

/// Self-signed fixture certificate carrying `key`'s public key (tests only).
#[cfg(test)]
pub(crate) fn build_self_signed_certificate(
    key: &Rsa<Private>,
    common_name: &str,
) -> Result<X509, Error> {
    build_certificate(key, &[("CN", common_name)], &[("CN", common_name)])
}

/// `O=oreore-org, CN=oreore-mdm-push` certificate signing request.
pub fn build_push_csr(push_key: &Rsa<Private>) -> Result<X509Req, Error> {
    let pkey = PKey::from_rsa(push_key.clone())?;
    let mut builder = X509Req::builder()?;
    let subject = subject_name(&[("O", "oreore-org"), ("CN", "oreore-mdm-push")])?;
    builder.set_subject_name(&subject)?;
    builder.set_pubkey(&pkey)?;
    // The default request version is not valid for signing; Ruby sets 0 too.
    builder.set_version(0)?;
    builder.sign(&pkey, MessageDigest::sha256())?;
    Ok(builder.build())
}

/// Provision `server.key` / `server.crt` / `push.key` / `push.csr`.
///
/// Existing keys are reused (and their certificate/CSR are regenerated from
/// them, exactly like the Ruby script); missing keys are generated.
pub fn create_server_certificates(
    dir: &Path,
    server_bits: u32,
    push_bits: u32,
) -> Result<(), Error> {
    let server_key = load_or_generate_rsa_key(&dir.join("server.key"), server_bits)?;
    let server_cert = build_server_certificate(&server_key)?;
    fs::write(dir.join("server.crt"), server_cert.to_pem()?)?;

    let push_key = load_or_generate_rsa_key(&dir.join("push.key"), push_bits)?;
    let push_csr = build_push_csr(&push_key)?;
    fs::write(dir.join("push.csr"), push_csr.to_pem()?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use openssl::nid::Nid;
    use openssl::x509::X509NameRef;

    fn public_pkey(key: &Rsa<Private>) -> PKey<openssl::pkey::Public> {
        let public_pem = key.public_key_to_pem().unwrap();
        PKey::from_rsa(Rsa::public_key_from_pem(&public_pem).unwrap()).unwrap()
    }

    fn common_name(name: &X509NameRef) -> String {
        let entry = name.entries_by_nid(Nid::COMMONNAME).next().unwrap();
        String::from_utf8_lossy(entry.data().as_slice()).into_owned()
    }

    #[test]
    fn server_certificate_has_expected_fields_and_signature() {
        let key = Rsa::generate(1024).unwrap();
        let cert = build_server_certificate(&key).unwrap();

        assert_eq!(common_name(cert.subject_name()), "oreore-mdm");
        assert_eq!(common_name(cert.issuer_name()), "oreore-mdm");
        assert_eq!(
            cert.serial_number()
                .to_bn()
                .unwrap()
                .to_dec_str()
                .unwrap()
                .as_bytes(),
            b"0".as_slice()
        );
        let window = cert.not_before().diff(cert.not_after()).unwrap();
        assert_eq!((window.days, window.secs), (365, 0));
        assert!(cert.verify(&public_pkey(&key)).unwrap());
        assert_eq!(
            cert.public_key().unwrap().public_key_to_pem().unwrap(),
            key.public_key_to_pem().unwrap()
        );
    }

    #[test]
    fn device_certificate_is_issued_by_server_key() {
        let key = Rsa::generate(1024).unwrap();
        let cert = build_device_certificate(&key).unwrap();

        assert_eq!(common_name(cert.subject_name()), "oreore-mdm-device");
        assert_eq!(common_name(cert.issuer_name()), "oreore-mdm");
        assert!(cert.verify(&public_pkey(&key)).unwrap());
    }

    #[test]
    fn push_csr_has_expected_subject_and_signature() {
        let key = Rsa::generate(1024).unwrap();
        let csr = build_push_csr(&key).unwrap();

        let subject = csr.subject_name();
        assert_eq!(common_name(subject), "oreore-mdm-push");
        let org = subject
            .entries_by_nid(Nid::ORGANIZATIONNAME)
            .next()
            .unwrap();
        assert_eq!(org.data().as_slice(), b"oreore-org");
        assert!(csr.verify(&public_pkey(&key)).unwrap());

        let pem = String::from_utf8(csr.to_pem().unwrap()).unwrap();
        assert!(pem.contains("BEGIN CERTIFICATE REQUEST"));
    }

    #[test]
    fn provision_writes_four_files_and_reuses_keys() {
        let dir = tempfile::tempdir().unwrap();
        create_server_certificates(dir.path(), 1024, 1024).unwrap();
        for name in ["server.key", "server.crt", "push.key", "push.csr"] {
            assert!(dir.path().join(name).exists(), "{name} should exist");
        }
        let server_key = fs::read(dir.path().join("server.key")).unwrap();
        let push_key = fs::read(dir.path().join("push.key")).unwrap();

        create_server_certificates(dir.path(), 1024, 1024).unwrap();
        assert_eq!(fs::read(dir.path().join("server.key")).unwrap(), server_key);
        assert_eq!(fs::read(dir.path().join("push.key")).unwrap(), push_key);
    }
}
