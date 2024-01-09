class VppClient
  def initialize(token_value)
    @faraday = Faraday.new('https://vpp.itunes.apple.com/mdm/v2') do |builder|
      builder.request :authorization, 'Bearer', token_value
      builder.request :json
      builder.response :json
      builder.response :logger
      builder.response :raise_error
    end
  end

  def get(...)
    @faraday.get(...).body
  end

  def post(...)
    @faraday.post(...).body
  end

  def self.fetch_app_information(adam_id)
    body = Faraday.get(
      "https://uclient-api.itunes.apple.com/WebObjects/MZStorePlatform.woa/wa/lookup",
      {
        id: adam_id,
        version: 2,
        p: 'mdm-lockup',
        caller: 'MDM',
        platform: 'enterprisestore',
        cc: 'jp',
        l: 'ja',
      }
    ).body
    JSON.parse(body)['results'][adam_id.to_s]
  end
end
