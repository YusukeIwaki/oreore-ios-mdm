class DepClient
  def initialize(dep_server_token)
    @auth_session = AuthSession.new(dep_server_token)

    retry_options = {
      max: 3,
      interval: 1,
      interval_randomness: 0.5,
      backoff_factor: 2,
      # 400 and 403 always requires user action, and not recovered as it is.
      # https://developer.apple.com/documentation/devicemanagement/device_assignment/authenticating_with_a_device_enrollment_program_dep_server/interpreting_error_codes
      retry_statuses: [401],
      methods: [:get, :post, :put, :delete],
      # Update Auth Session Token on retry
      retry_block: ->(env, _options, _retry_count, _exception) {
        update_auth_session_token(env: env)
      },
    }

    @faraday = Faraday.new(url: 'https://mdmenrollment.apple.com') do |faraday|
      faraday.response :raise_error # raise Faraday::Error on status code 4xx or 5xx
      faraday.request :retry, retry_options
      faraday.response :logger, App._logger, bodies: true
    end
    update_auth_session_token
  end

  def get(path, params = nil)
    response = @faraday.get(path, params, default_headers)
    JSON.parse(response.body)
  end

  def post(path, body = {})
    response = @faraday.post(path, body.to_json, default_headers)
    JSON.parse(response.body)
  end

  def put(path, body = {})
    response = @faraday.put(path, body.to_json, default_headers)
    JSON.parse(response.body)
  end

  # For DEP usage, HTTP body is required also on DELETE method.
  # while Faraday does not allow body on DELETE method by default.
  def delete(path, body = nil)
    response = @faraday.delete(path) do |req|
      req.body = body.to_json
      req.headers = default_headers
    end
    JSON.parse(response.body)
  end

  private def default_headers
    {
      'X-ADM-Auth-Session' => @auth_session_token,
      'X-Server-Protocol-Version' => '3',
      'Content-Type' => 'application/json;charset=UTF8',
    }
  end

  private def update_auth_session_token(**kwargs)
    auth_session_token = @auth_session.fetch_token

    # Faraday Retryから呼ばれるときはkwargsにはenvが入っている
    if kwargs[:env]
      # リトライ時には default_headersが改めて評価されないため、headersを直接書き換える
      headers = kwargs[:env][:request_headers]
      headers['X-ADM-Auth-Session'] = auth_session_token
    end

    # 次回以降のリクエストでは新しいトークンを使う
    @auth_session_token = auth_session_token
  end

  class AuthSession
    def initialize(dep_server_token)
      @faraday = Faraday.new(url: 'https://mdmenrollment.apple.com') do |faraday|
        faraday.response :raise_error # raise Faraday::Error on status code 4xx or 5xx
        faraday.response :logger, App._logger, bodies: true
        faraday.request :json
        faraday.response :json
      end
      @consumer_key = dep_server_token.consumer_key
      @consumer_secret = dep_server_token.consumer_secret
      @access_token = dep_server_token.access_token
      @access_secret = dep_server_token.access_secret
    end

    def fetch_token
      @nonce = SecureRandom.hex(16)

      headers = { 'Authorization' => "OAuth #{oauth_header_value}" }
      response = @faraday.get('/session', nil, headers)
      response.body['auth_session_token']
    end

    private def oauth_parameters
      {
        oauth_consumer_key: @consumer_key,
        oauth_token: @access_token,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Time.now.to_i.to_s,
        oauth_nonce: @nonce,
        oauth_version: "1.0",
      }
    end

    private def signature
      # https://support.e-map.ne.jp/manuals/v3/?q=oauth_sig
      _params = oauth_parameters.stringify_keys.
                  sort_by(&:first).
                  map { |k, v| "#{k}=#{v}" }.
                  join('&')

      signature_target = [
        'GET',
        URI.encode_www_form_component(@faraday.build_url('/session')),
        URI.encode_www_form_component(_params),
      ].join('&')

      signature_key = [
        @consumer_secret,
        @access_secret,
      ].join('&')

      digest = OpenSSL::HMAC.digest('sha1', signature_key, signature_target)
      Faraday::Utils.escape(Base64.strict_encode64(digest).chomp.gsub(/\n/, ''))
    end

    private def oauth_header_value
      oauth_parameters.merge(
        oauth_signature: signature,
        realm: 'ADM'
      ).map { |k, v| "#{k}=\"#{v}\"" }.join(', ')
    end
  end
end
