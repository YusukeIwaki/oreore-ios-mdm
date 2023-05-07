class PushCertificate
  def self.from_env
    new(Base64.strict_decode64(ENV['PUSH_CERTIFICATE_BASE64']), ENV['PUSH_CERTIFICATE_PASSWORD'])
  end

  def initialize(der, password)
    @pkcs12 = OpenSSL::PKCS12.new(der, password)
    @password = password
  end

  # intended for internal access from PushClient
  def _top_secrets
    [@pkcs12, @password]
  end

  def topic
    # > certificate.subject.to_a
    # => [["UID", "com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx", 12],
    #  ["CN", "APSP:53b84869-7f41-4266-xxxx-xxxxxxxxxxxx", 12],
    #  ["C", "US", 19]]
    @pkcs12.certificate.subject.to_a.filter_map do |oid, value, type|
      oid == 'UID' ? value : nil
    end.first or raise 'Failed to extract topic from push certificate'
  end
end
