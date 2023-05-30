module CommandResponseHandler
  class DeviceInformationAcknowledged
    def initialize(udid, response_payload)
      @udid = udid
      @response_payload = response_payload
    end

    def handle
      latest_device_information = LatestDeviceInformation.find_or_initialize_by(udid: @udid)
      latest_device_information.update!(data: @response_payload['QueryResponses'])
    end
  end
end
