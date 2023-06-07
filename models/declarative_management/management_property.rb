module DeclarativeManagement
  class ManagementProperty < ActiveRecord::Base
    attribute :identifier, :string, default: -> { SecureRandom.uuid }
    attribute :data, :json

    # https://github.com/apple/device-management/blob/release/declarative/declarations/management/properties.yaml
    def declaration_payload
      DeclarationPayload.new(
        identifier: identifier,
        type: 'com.apple.management.properties',
        payload: data,
      )
    end
  end
end
