class MdmCommandHandlingRequest < ActiveRecord::Base
  belongs_to :mdm_device
  attribute :request_payload, :plist
end
