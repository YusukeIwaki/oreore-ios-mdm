module Command
  class DisableLostMode
    def initialize
      @command_uuid = SecureRandom.uuid
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/device.lostmode.disable.yaml
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'DisableLostMode',
        },
      }
    end
  end
end
