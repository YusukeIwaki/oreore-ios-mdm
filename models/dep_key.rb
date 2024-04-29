class DepKey
  def self.private_key
    OpenSSL::PKey::RSA.new(Base64.strict_decode64(ENV['DEP_KEY_BASE64']))
  end

  def self.public_key
    private_key.public_key
  end
end
