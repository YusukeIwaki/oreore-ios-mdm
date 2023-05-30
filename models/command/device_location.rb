module Command
  class DeviceLocation
    def initialize
      @command_uuid = SecureRandom.uuid
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/device.lostmode.location.yaml
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'DeviceLocation',
        },
      }
    end
  end
end
