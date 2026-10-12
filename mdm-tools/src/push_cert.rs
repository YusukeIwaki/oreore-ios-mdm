//! Push / device certificate packaging (`use-push-certificate`).

use std::fs;
use std::path::Path;

use base64::Engine as _;
use openssl::pkcs12::Pkcs12;
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::x509::X509;

use crate::{build_device_certificate, Error};

/// Base64 blobs printed for the operator to store as environment variables.
#[derive(Debug, PartialEq, Eq)]
pub struct PushCertificateOutput {
    pub push_certificate_base64: String,
    pub server_private_key_base64: String,
    pub device_certificate_base64: String,
}

/// Package the push identity, mint the shared device certificate, and report
/// the Base64 blobs. Writes `device.p12` into `dir`.
///
/// Mirrors the Ruby script: a single shared device certificate is used for all
/// devices because Safari's `GET /mdm.mobileconfig` offers no way to tell
/// devices apart.
pub fn use_push_certificate(
    dir: &Path,
    push_certificate_path: &Path,
    password: &str,
) -> Result<PushCertificateOutput, Error> {
    let push_key = Rsa::private_key_from_pem(&fs::read(dir.join("push.key"))?)?;
    let push_cert = X509::from_pem(&fs::read(push_certificate_path)?)?;
    let push_pkey = PKey::from_rsa(push_key)?;
    let mut push_builder = Pkcs12::builder();
    push_builder
        .name("oreore-mdm-push")
        .pkey(&push_pkey)
        .cert(&push_cert);
    let push_p12 = push_builder.build2(password)?;

    let server_key = Rsa::private_key_from_pem(&fs::read(dir.join("server.key"))?)?;
    let device_cert = build_device_certificate(&server_key)?;
    let server_pkey = PKey::from_rsa(server_key.clone())?;
    let mut device_builder = Pkcs12::builder();
    device_builder
        .name("oreore-mdm-device")
        .pkey(&server_pkey)
        .cert(&device_cert);
    let device_p12 = device_builder.build2("!oreore-mdm")?;
    let device_der = device_p12.to_der()?;
    fs::write(dir.join("device.p12"), &device_der)?;

    let engine = base64::engine::general_purpose::STANDARD;
    Ok(PushCertificateOutput {
        push_certificate_base64: engine.encode(push_p12.to_der()?),
        server_private_key_base64: engine.encode(server_key.private_key_to_pem()?),
        device_certificate_base64: engine.encode(device_der),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certs::build_self_signed_certificate;
    use crate::create_server_certificates;
    use openssl::nid::Nid;
    use openssl::rsa::Rsa;

    fn common_name(cert: &X509, nid: Nid) -> String {
        let entry = cert.subject_name().entries_by_nid(nid).next().unwrap();
        String::from_utf8_lossy(entry.data().as_slice()).into_owned()
    }

    #[test]
    fn packages_identities_and_reports_blobs() {
        let dir = tempfile::tempdir().unwrap();
        create_server_certificates(dir.path(), 1024, 1024).unwrap();

        // A certificate matching the push key stands in for Apple's push
        // certificate (both OpenSSL and modern Ruby reject mismatched pairs).
        let push_key =
            Rsa::private_key_from_pem(&fs::read(dir.path().join("push.key")).unwrap()).unwrap();
        let push_cert = build_self_signed_certificate(&push_key, "oreore-mdm-push").unwrap();
        let push_cert_path = dir.path().join("push_certificate.pem");
        fs::write(&push_cert_path, push_cert.to_pem().unwrap()).unwrap();
        let output = use_push_certificate(dir.path(), &push_cert_path, "push-pass").unwrap();

        for blob in [
            &output.push_certificate_base64,
            &output.server_private_key_base64,
            &output.device_certificate_base64,
        ] {
            assert!(!blob.contains('\n'));
        }

        let engine = base64::engine::general_purpose::STANDARD;
        let push_der = engine.decode(&output.push_certificate_base64).unwrap();
        let parsed_push = Pkcs12::from_der(&push_der)
            .unwrap()
            .parse2("push-pass")
            .unwrap();
        assert!(parsed_push.cert.is_some());

        assert_eq!(
            engine.decode(&output.server_private_key_base64).unwrap(),
            fs::read(dir.path().join("server.key")).unwrap()
        );

        let device_der = engine.decode(&output.device_certificate_base64).unwrap();
        assert_eq!(fs::read(dir.path().join("device.p12")).unwrap(), device_der);
        let parsed_device = Pkcs12::from_der(&device_der)
            .unwrap()
            .parse2("!oreore-mdm")
            .unwrap();
        let device_cert = parsed_device.cert.unwrap();
        assert_eq!(
            common_name(&device_cert, Nid::COMMONNAME),
            "oreore-mdm-device"
        );
    }
}
