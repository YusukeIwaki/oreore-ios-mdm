module DeclarativeManagement
  class Activation < ActiveRecord::Base
    has_many :activation_target_configurations

    attribute :predicate, :string
    attribute :identifier, :string, default: -> { SecureRandom.uuid }

    # https://developer.apple.com/documentation/devicemanagement/activationsimple
    def declaration_payload
      DeclarationPayload.new(
        identifier: identifier,
        type: 'com.apple.activation.simple',
        payload: {
          Predicate: predicate.presence,
          StandardConfigurations: activation_target_configurations.map(&:configuration_identifier),
        }.compact,
      )
    end
  end
end
