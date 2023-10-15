class MdmDevice < ActiveRecord::Base
  concerning :AccountDrivenDeviceEnrollment do
    included do
      has_one :managed_apple_account_access_token_usage, foreign_key: :device_identifier, primary_key: :udid
      has_one :managed_apple_account_access_token, through: :managed_apple_account_access_token_usage
      has_one :managed_apple_account, through: :managed_apple_account_access_token
    end
  end

  has_one :mdm_push_endpoint, dependent: :destroy

  def ddm_identifier
    serial_number
  end
end
