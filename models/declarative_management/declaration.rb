module DeclarativeManagement
  class Declaration
    def initialize(device_identifier)
      @activations = DeclarativeManagement::Activation.preload(:activation_target_configurations)
      @configurations = DeclarativeManagement::ActivationTargetConfiguration.
                          where(activation_id: @activations.map(&:id)).
                          preload(:configuration).
                          map(&:configuration)

      required_asset_identifiers = {}
      @configurations.each do |configuration|
        configuration.required_asset_identifiers.each do |class_name, identifiers|
          required_asset_identifiers[class_name] ||= Set.new
          required_asset_identifiers[class_name].merge(identifiers)
        end
      end
      @assets = required_asset_identifiers.flat_map do |class_name, identifiers|
        class_name.constantize.where(identifier: identifiers)
      end

      @management = DeclarativeManagement::ManagementProperty.where(device_identifier: device_identifier)
    end

    private def timestamp
      [
        @activations.map(&:updated_at).max,
        @configurations.map(&:updated_at).max,
        @assets.map(&:updated_at).max,
        @management.map(&:updated_at).max,
      ].max
    end

    private def declarations_token
      Digest::SHA256.hexdigest([
          @activations.map do |activation|
            activation.declaration_payload.manifest
          end,
          @configurations.map do |configuration|
            configuration.declaration_payload.manifest
          end,
          @assets.map do |asset|
            asset.declaration_payload.manifest
          end,
          @management.map do |management|
            management.declaration_payload.manifest
          end,
      ].to_json)
    end

    def tokens
      # https://github.com/apple/device-management/blob/release/declarative/protocol/tokensresponse.yaml
      {
        SyncTokens: {
          DeclarationsToken: declarations_token,
          Timestamp: timestamp.iso8601,
        },
      }
    end

    def declaration_items
      # https://github.com/apple/device-management/blob/release/declarative/protocol/declarationitemsresponse.yaml
      {
        Declarations: {
          Activations: @activations.map do |activation|
            activation.declaration_payload.manifest
          end,
          Configurations: @configurations.map do |configuration|
            configuration.declaration_payload.manifest
          end,
          Assets: @assets.map do |asset|
            asset.declaration_payload.manifest
          end,
          Management: @management.map do |management|
            management.declaration_payload.manifest
          end,
        },
        DeclarationsToken: declarations_token,
      }
    end
  end
end
