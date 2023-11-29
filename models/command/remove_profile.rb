module Command
  class RemoveProfile
    def self.template_new
      new(identifier: "oreoremdm.#{SecureRandom.uuid}")
    end

    def initialize(identifier:)
      @command_uuid = SecureRandom.uuid
      @identifier = identifier
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/profile.remove.yaml
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'RemoveProfile',
          Identifier: @identifier,
        }
      }
    end
  end
end
