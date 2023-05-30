class MdmCommandHandlingRequest < ActiveRecord::Base
  attribute :request_payload, :json
end
