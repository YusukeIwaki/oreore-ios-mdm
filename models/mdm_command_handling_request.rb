class MdmCommandHandlingRequest
  include Mongoid::Document

  field :device_identifier, type: String
  field :request_payload, type: Hash

  index({ device_identifier: 1, 'request_payload.CommandUUID' => 1 })

  def reschedule
    MdmCommandRequest.create!(attributes)
    destroy!
  end
end
