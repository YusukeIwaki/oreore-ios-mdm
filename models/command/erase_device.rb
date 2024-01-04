module Command
  class EraseDevice
    def initialize(rts_enabled:, rts_wifi_profile_data: nil, rts_mdm_profile_data: nil)
      @command_uuid = SecureRandom.uuid
      if rts_enabled
        @rts = {
          Enabled: true,
          WiFiProfileData: rts_wifi_profile_data.respond_to?(:read) ? rts_wifi_profile_data : StringIO.new(rts_wifi_profile_data),
          MDMProfileData: rts_mdm_profile_data.respond_to?(:read) ? rts_mdm_profile_data : StringIO.new(rts_mdm_profile_data),
        }
      end
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/device.erase.yaml
    def request_payload
      {
        CommandUUID: @command_uuid,
        Command: {
          RequestType: 'EraseDevice',
          PreserveDataPlan: true,
          ReturnToService: @rts,
        }.compact,
      }
    end

  end
end
