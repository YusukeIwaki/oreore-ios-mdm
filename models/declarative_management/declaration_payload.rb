module DeclarativeManagement
  # https://github.com/apple/device-management/blob/release/declarative/declarations/declarationbase.yaml
  class DeclarationPayload
    def initialize(identifier:, type:, payload:)
      @identifier = identifier
      @type = type
      @payload = payload
    end

    def server_token
      @server_token ||= Digest::SHA256.hexdigest({
        Type: @type,
        Payload: @payload,
      }.to_json)
    end

    def manifest
      {
        Identifier: @identifier,
        ServerToken: server_token,
      }
    end

    def detail
      {
        Identifier: @identifier,
        Type: @type,
        Payload: @payload,
        ServerToken: server_token,
      }
    end
  end
end
