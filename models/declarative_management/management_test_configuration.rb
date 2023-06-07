module DeclarativeManagement
  # https://developer.apple.com/documentation/devicemanagement/managementtest
  class ManagementTestConfiguration < ActiveRecord::Base
    attribute :identifier, :string, default: -> { SecureRandom.uuid }
    attribute :echo, :string, default: -> { 'Hello, World!' }

    # @override
    def required_asset_identifiers
      {}
    end

    def declaration_payload
      DeclarationPayload.new(
        identifier: identifier,
        type: 'com.apple.configuration.management.test',
        payload: {
          Echo: echo,
          ReturnStatus: return_status.presence,
        }.compact,
      )
    end
  end
end
