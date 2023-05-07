module MobileConfig
  # https://github.com/apple/device-management/blob/release/mdm/profiles/com.apple.security.pkcs12.yaml
  class SecurityPkcs12 < Data.define(:uuid, :pkcs12, :filename, :password)
    def initialize(uuid: nil, pkcs12: nil, filename: nil, password: nil)
      unless pkcs12.is_a?(OpenSSL::PKCS12)
        raise ArgumentError, 'pkcs12 must be an OpenSSL::PKCS12'
      end
      unless filename.is_a?(String)
        raise ArgumentError, 'filename must be a String'
      end
      unless password.is_a?(String)
        raise ArgumentError, 'password must be a String'
      end

      super(
        uuid: uuid || SecureRandom.uuid,
        pkcs12: pkcs12,
        filename: filename,
        password: password,
      )
    end

    def identifier
      "com.apple.security.pkcs12.#{uuid}"
    end

    def build_payload
      {
        Password: password,
        PayloadCertificateFileName: filename,
        PayloadContent: StringIO.new(pkcs12.to_der),
        PayloadDescription: 'Certificate (PKCS #12)',
        PayloadDisplayName: filename,
        PayloadIdentifier: identifier,
        PayloadType: 'com.apple.security.pkcs12',
        PayloadUUID: uuid,
        PayloadVersion: 1,
      }
    end
  end
end
