module DeclarativeManagement
  class SynchronizationRequestHistory < ActiveRecord::Base
    belongs_to :mdm_device
    attribute :request_payload, :json
    attribute :response_payload, :json

    def self.log_response(device, endpoint, data, response_json)
      create!(
        mdm_device: device,
        endpoint: endpoint,
        request_payload: data,
        response_payload: response_json,
      )
    end

    def self.log_404(device, endpoint, data)
      create!(
        mdm_device: device,
        endpoint: endpoint,
        request_payload: data,
      )
    end
  end
end
