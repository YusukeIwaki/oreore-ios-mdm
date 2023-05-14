module CommandResponseHandler
  class DeviceInformationAcknowledged
    def initialize(udid, response_payload)
      @udid = udid
      @response_payload = response_payload
    end

    def handle
      p self
    end
  end
end
