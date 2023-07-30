class ManagedAppleAccountAccessToken < ActiveRecord::Base
  belongs_to :managed_apple_account
  attribute :expires_at, :datetime, default: -> { 1.hour.from_now }

  def expired?
    expires_at <= Time.now
  end
end
