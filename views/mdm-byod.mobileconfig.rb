device_pkcs12 = OpenSSL::PKCS12.new(
  Base64.strict_decode64(ENV['DEVICE_CERTIFICATE_BASE64']),
  '!oreore-mdm',
)

identity_cerificate = MobileConfig::SecurityPkcs12.new(
  pkcs12: device_pkcs12,
  filename: 'oreore-mdm-device.p12',
  password: '!oreore-mdm',
)

topic = PushCertificate.from_env.topic

payload = MobileConfig.new(
  uuid: ENV['MDM_MOBILECONFIG_PAYLOAD_UUID'],
  display_name: 'Oreore MDM configuration',
  contents: [
    identity_cerificate,
    MobileConfig::MdmByod.new(
      topic: topic,
      identity_cerificate: identity_cerificate,
      assigned_managed_apple_id: assigned_managed_apple_id,
    ),
  ]
).build_payload
payload.to_plist
