module Command
  class EnableLostMode
    def initialize(message: nil, phone_number: nil, footnote: nil)
      @command_uuid = SecureRandom.uuid
      @message = message
      @phone_number = phone_number
      @footnote = footnote
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/device.lostmode.enable.yaml
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'EnableLostMode',
          Message: @message,
          PhoneNumber: @phone_number,
          Footnote: @footnote
        }.compact,
      }
    end
  end
end
