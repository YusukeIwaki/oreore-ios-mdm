module Ddm
  class SynchronizationRequestHistory < ActiveRecord::Base
    attribute :request_payload, :json
    attribute :response_payload, :json

    def self.log_response(device_identifier, endpoint, data, response_json)
      create!(
        device_identifier: device_identifier,
        endpoint: endpoint,
        request_payload: data,
        response_payload: response_json,
      )
    end

    def self.log_404(device_identifier, endpoint, data)
      create!(
        device_identifier: device_identifier,
        endpoint: endpoint,
        request_payload: data,
      )
    end
  end
end
