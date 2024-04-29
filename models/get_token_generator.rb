class GetTokenGenerator
  def initialize(get_token_target:, udid:, service_type:)
    @get_token_target = get_token_target or raise ArgumentError, 'get_token_target is required'
    @udid = udid
    @service_type = service_type
  end

  def find_or_generate
    existing = GetTokenHistory.where(
      device_udid: @udid,
      service_type: @service_type,
    ).order(iat: :desc).first
    return existing.jwt if existing&.jwt.present?

    iat = Time.current
    jti = SecureRandom.uuid

    payload = {
      service_type: @service_type,
      iss: @get_token_target.server_uuid,
      iat: iat.to_i,
      jti: jti,
    }

    dep_key = OpenSSL::PKey::RSA.new(Base64.strict_decode64(ENV['DEP_KEY_BASE64']))

    token = JWT.encode(payload, dep_key, 'RS256')

    GetTokenHistory.create!(
      device_udid: @udid,
      service_type: @service_type,
      iat: iat,
      jti: jti,
      jwt: token,
    )
    token
  end
end
