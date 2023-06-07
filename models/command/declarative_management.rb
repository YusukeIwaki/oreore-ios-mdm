module Command
  class DeclarativeManagement
    def initialize(tokens:)
      @command_uuid = SecureRandom.uuid
      @tokens = tokens
    end

    # https://developer.apple.com/documentation/devicemanagement/declarativemanagementcommand/command#properties
    def request_payload
      {
        'CommandUUID' => @command_uuid,
        'Command' => {
          'RequestType' => 'DeclarativeManagement',
          'Data' => StringIO.new(@tokens.to_json)
        },
      }
    end
  end
end
