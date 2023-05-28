class MdmCommandRequest
  include Mongoid::Document

  field :device_identifier, type: String
  field :request_payload, type: Hash

  index({ device_identifier: 1 })

  def start_handling
    MdmCommandHandlingRequest.create!(attributes)
    destroy!
  end
end
