class MdmCommandHandlingRequest
  include Mongoid::Document

  field :device_identifier, type: String
  field :request_payload, type: Hash

  def reschedule
    MdmCommandRequest.create!(attributes)
    destroy!
  end
end
