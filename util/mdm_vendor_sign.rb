require 'base64'
require 'openssl'
require 'plist'

%w[MDM_VENDOR_CERT_P12_PATH MDM_VENDOR_CERT_P12_PASSWORD].each do |env|
  raise "ENV['#{env}'] is not set" unless ENV[env]
end

mdm_vendor_pkcs12 = OpenSSL::PKCS12.new(
  File.read(ENV['MDM_VENDOR_CERT_P12_PATH']),
  ENV['MDM_VENDOR_CERT_P12_PASSWORD'],
)

push_csr = OpenSSL::X509::Request.new(File.read('util/push.csr'))
push_cert_signature = mdm_vendor_pkcs12.key.sign(OpenSSL::Digest::SHA256.new, push_csr.to_der)

cert_store = mdm_vendor_pkcs12.ca_certs.each_with_object(OpenSSL::X509::Store.new) do |ca, store|
  store.add_cert(ca)
end
cert_store.verify(mdm_vendor_pkcs12.certificate)

payload = {
  PushCertCertificateChain: cert_store.chain.map(&:to_pem).join(''),
  PushCertRequestCSR: Base64.encode64(push_csr.to_der),
  PushCertSignature: Base64.encode64(push_cert_signature),
}

File.write('util/push_signed.req', Base64.strict_encode64(payload.to_plist))
