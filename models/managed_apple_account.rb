class ManagedAppleAccount < ActiveRecord::Base
  has_many :access_tokens, class_name: ManagedAppleAccountAccessToken.to_s, dependent: :destroy
end
