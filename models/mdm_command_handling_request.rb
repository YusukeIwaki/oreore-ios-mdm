class MdmCommandHandlingRequest < ActiveRecord::Base
  attribute :request_payload, :json

  def reschedule
    transaction do
      MdmCommandRequest.create!(
        device_identifier: device_identifier,
        request_payload: request_payload,
      )
      destroy!
    end
  end
end
