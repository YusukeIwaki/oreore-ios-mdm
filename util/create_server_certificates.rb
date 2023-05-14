require 'openssl'

OpenSSL::Random.seed(File.read("/dev/random", 16))

def openssl_genrsa(name, len)
  filename = "util/#{name}.key"
  if File.exist?(filename)
    OpenSSL::PKey::RSA.new(File.read(filename))
  else
    OpenSSL::PKey::RSA.generate(len).tap do |key|
      File.write(filename, key.to_s)
    end
  end
end

server_key = openssl_genrsa('server', 4096)
issuer = subject = OpenSSL::X509::Name.new([["CN", "oreore-mdm"]])

server_cert = OpenSSL::X509::Certificate.new
server_cert.not_before = Time.now
server_cert.not_after = Time.now + 60 * 60 * 24 * 365
server_cert.public_key = server_key.public_key
server_cert.serial = 0
server_cert.issuer = issuer
server_cert.subject = subject
server_cert.sign(server_key, OpenSSL::Digest::SHA256.new)
File.write('util/server.crt', server_cert.to_s)


push_key = openssl_genrsa('push', 2048)
subject = OpenSSL::X509::Name.new([["O", "oreore-org"], ["CN", "oreore-mdm-push"]])

push_csr = OpenSSL::X509::Request.new
push_csr.subject = subject
push_csr.public_key = push_key.public_key
push_csr.version = 0
push_csr.sign(push_key, OpenSSL::Digest::SHA256.new)
File.write('util/push.csr', push_csr.to_s)
