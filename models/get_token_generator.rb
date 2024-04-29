class GetTokenGenerator
  def initialize(get_token_target:, device_identifier:, service_type:)
    @get_token_target = get_token_target or raise ArgumentError, 'get_token_target is required'
    @device_identifier = device_identifier
    @service_type = service_type
  end

  def find_or_generate
    existing = GetTokenHistory.where(
      device_identifier: @device_identifier,
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

    token = JWT.encode(payload, DepKey.private_key, 'RS256')

    GetTokenHistory.create!(
      device_identifier: @device_identifier,
      service_type: @service_type,
      iat: iat,
      jti: jti,
      jwt: token,
    )
    token
  end
end
