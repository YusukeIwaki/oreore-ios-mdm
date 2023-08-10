class ByodDevice < ActiveRecord::Base
  has_one :managed_apple_account_access_token_usage, foreign_key: :device_identifier, primary_key: :enrollment_id
  has_one :managed_apple_account_access_token, through: :managed_apple_account_access_token_usage
  has_one :managed_apple_account, through: :managed_apple_account_access_token
  has_one :byod_push_endpoint, dependent: :destroy
end
