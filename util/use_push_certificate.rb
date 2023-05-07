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
puts "set an environment variable: PUSH_CERTIFICATE_BASE64=#{Base64.strict_encode64(p12.to_der)}"
