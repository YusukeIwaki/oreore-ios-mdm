module Command
  class InstallApplication
    def initialize(manifest_url:)
      @command_uuid = SecureRandom.uuid
      @manifest_url = manifest_url
    end

    # https://developer.apple.com/documentation/devicemanagement/install_an_application
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'InstallApplication',
          ManifestURL: @manifest_url,
        }
      }
    end
  end
end
