module DeclarativeManagement
  # https://developer.apple.com/documentation/devicemanagement/accountgoogle
  class AccountGoogleConfiguration < ActiveRecord::Base
    attribute :identifier, :string, default: -> { SecureRandom.uuid }

    belongs_to :user_identity_asset,
      foreign_key: :user_identity_asset_identifier,
      primary_key: :identifier

    # @override
    def required_asset_identifiers
      { UserIdentityAsset.to_s => [user_identity_asset_identifier] }
    end

    def declaration_payload
      DeclarationPayload.new(
        identifier: identifier,
        type: 'com.apple.configuration.account.google',
        payload: {
          VisibleName: visible_name,
          UserIdentityAssetReference: user_identity_asset_identifier,
        },
      )
    end
  end
end
