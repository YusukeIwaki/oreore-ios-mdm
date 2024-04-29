class DepServerToken < ActiveRecord::Base
  def self.update_from(filename, p7m_content)
    payload = OpenSSL::PKCS7.read_smime(p7m_content).decrypt(DepKey.private_key)

    message = payload.match(/-----BEGIN MESSAGE-----\n(.*)\n-----END MESSAGE-----/m)[1]
    json = JSON.parse(message)

    record = DepServerToken.find_or_initialize_by(filename: filename)
    record.update!(
      raw_payload: payload,
      consumer_key: json['consumer_key'],
      consumer_secret: json['consumer_secret'],
      access_token: json['access_token'],
      access_secret: json['access_secret'],
      access_token_expiry: json['access_token_expiry'],
    )
  end

  def url_encoded_filename
    ERB::Util.url_encode(filename)
  end
end
