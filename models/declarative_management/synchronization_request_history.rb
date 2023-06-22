module DeclarativeManagement
  class SynchronizationRequestHistory < ActiveRecord::Base
    attribute :request_payload, :json
    attribute :response_payload, :json

    def self.log_response(udid, endpoint, data, response_json)
      create!(
        udid: udid,
        endpoint: endpoint,
        request_payload: data,
        response_payload: response_json,
      )
    end

    def self.log_404(udid, endpoint, data)
      create!(
        udid: udid,
        endpoint: endpoint,
        request_payload: data,
      )
    end
  end
end
