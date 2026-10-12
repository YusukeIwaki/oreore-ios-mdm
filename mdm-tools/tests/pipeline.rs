//! End-to-end provisioning flow across all tools in an isolated directory.

use std::fs;

use base64::Engine as _;
use openssl::asn1::Asn1Time;
use openssl::bn::BigNum;
use openssl::hash::MessageDigest;
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::x509::{X509Name, X509};

fn self_signed_cert_pem(key_pem: &[u8], common_name: &str) -> Vec<u8> {
    let pkey = PKey::from_rsa(Rsa::private_key_from_pem(key_pem).unwrap()).unwrap();
    let mut name_builder = X509Name::builder().unwrap();
    name_builder
        .append_entry_by_text("CN", common_name)
        .unwrap();
    let name = name_builder.build();
    let mut builder = X509::builder().unwrap();
    builder
        .set_not_before(Asn1Time::days_from_now(0).unwrap().as_ref())
        .unwrap();
    builder
        .set_not_after(Asn1Time::days_from_now(365).unwrap().as_ref())
        .unwrap();
    builder.set_pubkey(&pkey).unwrap();
    let serial = BigNum::from_u32(1).unwrap().to_asn1_integer().unwrap();
    builder.set_serial_number(&serial).unwrap();
    builder.set_issuer_name(&name).unwrap();
    builder.set_subject_name(&name).unwrap();
    builder.sign(&pkey, MessageDigest::sha256()).unwrap();
    builder.build().to_pem().unwrap()
}

#[test]
fn full_certificate_provisioning_flow() {
    let dir = tempfile::tempdir().unwrap();
    let dir = dir.path();

    let dep_key = mdm_tools::create_dep_key(dir, 1024).unwrap();
    assert!(!dep_key.contains('\n'));
    assert!(dir.join("dep.key").exists());

    mdm_tools::create_server_certificates(dir, 1024, 1024).unwrap();
    for name in ["server.key", "server.crt", "push.key", "push.csr"] {
        assert!(dir.join(name).exists(), "{name} should exist");
    }

    // A self-signed fixture stands in for the real vendor identity.
    let vendor_key = mdm_tools::load_or_generate_rsa_key(&dir.join("vendor.key"), 1024).unwrap();
    let vendor_cert = mdm_tools::build_server_certificate(&vendor_key).unwrap();
    let vendor_pkey = openssl::pkey::PKey::from_rsa(vendor_key).unwrap();
    let mut vendor_builder = openssl::pkcs12::Pkcs12::builder();
    vendor_builder
        .name("vendor")
        .pkey(&vendor_pkey)
        .cert(&vendor_cert);
    let vendor_p12 = vendor_builder.build2("vendor-pass").unwrap();
    let vendor_path = dir.join("vendor.p12");
    fs::write(&vendor_path, vendor_p12.to_der().unwrap()).unwrap();
    mdm_tools::vendor_sign(dir, &vendor_path, "vendor-pass").unwrap();
    let signed = fs::read_to_string(dir.join("push_signed.req")).unwrap();
    assert!(!signed.is_empty());

    // A certificate matching the push key stands in for Apple's push
    // certificate (mismatched key/cert pairs are rejected, as in Ruby).
    let push_cert_path = dir.join("push_certificate.pem");
    fs::write(
        &push_cert_path,
        self_signed_cert_pem(&fs::read(dir.join("push.key")).unwrap(), "oreore-mdm-push"),
    )
    .unwrap();
    let output = mdm_tools::use_push_certificate(dir, &push_cert_path, "push-pass").unwrap();
    assert!(dir.join("device.p12").exists());
    let engine = base64::engine::general_purpose::STANDARD;
    assert!(!engine
        .decode(&output.push_certificate_base64)
        .unwrap()
        .is_empty());
    assert!(!engine
        .decode(&output.server_private_key_base64)
        .unwrap()
        .is_empty());
    assert!(!engine
        .decode(&output.device_certificate_base64)
        .unwrap()
        .is_empty());
}
