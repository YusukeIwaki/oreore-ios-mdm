require 'base64'
require 'openssl'

filepath = ARGV.join(' ')
if filepath.empty?
  puts "Usage: bundle exec ruby #{__FILE__} <path to push_certificate .pem file>"
  exit 1
end
File.exist?(filepath) or raise "File not found: #{filepath}"

unless ENV['PUSH_CERTIFICATE_PASSWORD']
  puts 'Please set an environment variable: PUSH_CERTIFICATE_PASSWORD'
  exit 1
end

# just checking
push_key = OpenSSL::PKey::RSA.new(File.read('util/push.key'))
push_certificate = OpenSSL::X509::Certificate.new(File.read(filepath))
p12 = OpenSSL::PKCS12.create(ENV['PUSH_CERTIFICATE_PASSWORD'], 'oreore-mdm-push', push_key, push_certificate)
server_key = OpenSSL::PKey::RSA.new(File.read('util/server.key'))

# create device certificate
# This certificate should be different for each device,
# however no way do distinguish the device on the access of GET /mdm.mobileconfig by Safari.
# So, we use the same certificate for all devices.
device_cert = OpenSSL::X509::Certificate.new
device_cert.not_before = Time.now
device_cert.not_after = Time.now + 60 * 60 * 24 * 365
device_cert.public_key = server_key.public_key
device_cert.serial = 0
device_cert.issuer = OpenSSL::X509::Name.new([["CN", "oreore-mdm"]])
device_cert.subject = OpenSSL::X509::Name.new([["CN", "oreore-mdm-device"]])
device_cert.sign(server_key, OpenSSL::Digest::SHA256.new)
device_pkcs12 = OpenSSL::PKCS12.create(
  '!oreore-mdm',
  'oreore-mdm-device',
  server_key,
  device_cert)

File.open('util/device.p12', 'wb') { |f| f.write(device_pkcs12.to_der) }

puts "set an environment variable:"
puts "  PUSH_CERTIFICATE_BASE64=#{Base64.strict_encode64(p12.to_der)}"
puts "  SERVER_PRIVATE_KEY_BASE64=#{Base64.strict_encode64(server_key.to_pem)}"
puts "  DEVICE_CERTIFICATE_BASE64=#{Base64.strict_encode64(device_pkcs12.to_der)}"
