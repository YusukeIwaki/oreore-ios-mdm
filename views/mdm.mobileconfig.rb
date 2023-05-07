server_key = OpenSSL::PKey::RSA.new(File.read('util/server.key'))

# create device certificate
device_key = OpenSSL::PKey::RSA.generate(2048)
issuer = OpenSSL::X509::Name.new([["CN", "oreore-mdm"]])

device_cert = OpenSSL::X509::Certificate.new
device_cert.not_before = Time.now
device_cert.not_after = Time.now + 60 * 60 * 24 * 365
device_cert.public_key = device_key.public_key
device_cert.serial = 0
device_cert.issuer = OpenSSL::X509::Name.new([["CN", "oreore-mdm"]])
device_cert.subject = OpenSSL::X509::Name.new([["CN", "oreore-mdm-device"]])
device_cert.sign(server_key, OpenSSL::Digest::SHA256.new)
device_pkcs12 = OpenSSL::PKCS12.create(
  '!oreore-mdm',
  'oreore-mdm-device',
  device_key,
  device_cert)

identity_cerificate = MobileConfig::SecurityPkcs12.new(
  pkcs12: device_pkcs12,
  filename: 'oreore-mdm-device.p12',
  password: '!oreore-mdm',
)

topic = PushCertificate.from_env.topic

payload = MobileConfig.new(
  display_name: 'Oreore MDM configuration',
  contents: [
    identity_cerificate,
    MobileConfig::Mdm.new(
      topic: topic,
      identity_cerificate: identity_cerificate,
    ),
  ]
).build_payload

payload.to_plist
