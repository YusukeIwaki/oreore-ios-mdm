module CommandResponseHandler
  class InstalledApplicationListAcknowledged
    def initialize(mdm_device, response_payload)
      @mdm_device = mdm_device
      @response_payload = response_payload
    end

    def handle
      p self
    end
  end
end
