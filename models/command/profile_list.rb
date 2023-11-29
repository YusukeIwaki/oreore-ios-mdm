module Command
  class ProfileList
    def initialize
      @command_uuid = SecureRandom.uuid
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/profile.list.yaml
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'ProfileList',
        }
      }
    end
  end
end
