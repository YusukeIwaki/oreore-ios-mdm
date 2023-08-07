module ByodCommandResponseHandler
  class DeviceInformationAcknowledged
    def initialize(byod_device, response_payload)
      @byod_device = byod_device
      @response_payload = response_payload
    end

    def handle
      p self
    end
  end
end
