module DeclarativeManagement
  # https://github.com/apple/device-management/blob/release/declarative/declarations/declarationbase.yaml
  class DeclarationItem
    def initialize(identifier:, type:, payload:)
      @identifier = identifier
      @type = type
      @payload = payload
    end

    def has_identifier?(identifier)
      @identifier == identifier
    end

    def server_token
      @server_token ||= calc_server_token
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

    private def calc_server_token
      Digest::SHA256.hexdigest({
        Type: @type,
        Payload: @payload,
      }.to_json)
    end
  end
end
