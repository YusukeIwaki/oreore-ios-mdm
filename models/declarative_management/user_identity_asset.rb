module DeclarativeManagement
  # https://github.com/apple/device-management/blob/release/declarative/declarations/assets/useridentity.yaml
  class UserIdentityAsset < ActiveRecord::Base
    attribute :identifier, :string, default: -> { SecureRandom.uuid }

    def declaration_payload
      DeclarationPayload.new(
        identifier: identifier,
        type: 'com.apple.asset.useridentity',
        payload: {
          FullName: full_name.presence,
          EmailAddress: email_address.presence,
        }.compact,
      )
    end
  end
end
