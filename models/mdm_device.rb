class MdmDevice < ActiveRecord::Base
  has_one :mdm_push_endpoint, dependent: :destroy
end
