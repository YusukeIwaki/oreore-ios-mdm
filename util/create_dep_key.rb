require 'openssl'
require 'base64'

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

dep_key = openssl_genrsa('dep', 4096)
puts "set an environment variable:"
puts "  DEP_KEY_BASE64=#{Base64.strict_encode64(dep_key.to_pem)}"
