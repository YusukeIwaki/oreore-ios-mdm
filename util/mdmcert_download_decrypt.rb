require 'openssl'

filepath = ARGV.join(' ')
if filepath.empty?
  puts "Usage: bundle exec ruby #{__FILE__} <path to .b64.p7 file>"
  exit 1
end
File.exist?(filepath) or raise "File not found: #{filepath}"

server_key = OpenSSL::PKey::RSA.new(File.read('util/server.key'))
server_cert = OpenSSL::X509::Certificate.new(File.read('util/server.crt'))

p7 = [File.read(filepath)].pack('H*')

plist_b64 = OpenSSL::PKCS7.new(p7).decrypt(server_key, server_cert)
File.write('util/push_signed.req', plist_b64)
