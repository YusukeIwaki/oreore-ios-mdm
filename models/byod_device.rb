class ByodDevice < ActiveRecord::Base
  belongs_to :managed_apple_account
  has_one :byod_push_endpoint, dependent: :destroy
end
