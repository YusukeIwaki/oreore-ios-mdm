class MdmCommandRequest < ActiveRecord::Base
  belongs_to :mdm_device
  attribute :request_payload, :plist

  def start_handling
    transaction do
      MdmCommandHandlingRequest.create!(
        device_identifier: device_identifier,
        command_uuid: request_payload['CommandUUID'],
        request_payload: request_payload,
      )
      destroy!
    end
  end
end
