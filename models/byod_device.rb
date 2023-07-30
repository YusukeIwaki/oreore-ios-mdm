class ByodDevice < ActiveRecord::Base
  has_one :byod_push_endpoint, dependent: :destroy
end
