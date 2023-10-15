module DeclarativeManagement
  class Declaration
    def initialize(serial_number)
      @public_asset_details = Ddm::PublicAsset.details_for(serial_number)

      @activations = Ddm::Activation.for(serial_number)

      configuration_resource_identifier_map = Ddm::Configuration.select(:id, :name).map do |configuration|
        [configuration.resource_identifier.reference_name, configuration.id]
      end.to_h
      configuration_resource_identifiers = configuration_resource_identifier_map.keys
      required_configurations_ids = Set.new
      @activations.each do |activation|
        required_configuration_resource_identifiers =
          activation.collect_required_resource_identifiers_from(configuration_resource_identifiers)
        required_configuration_resource_identifiers.each do |resource_identifier|
          required_configurations_ids << configuration_resource_identifier_map[resource_identifier]
        end
      end

      @configurations = Ddm::Configuration.where(id: required_configurations_ids)

      asset_resource_identifier_map = Ddm::Asset.select(:id, :name).map do |asset|
        [asset.resource_identifier.reference_name, asset.id]
      end.to_h
      asset_resource_identifiers = asset_resource_identifier_map.keys
      required_assets_ids = Set.new
      @configurations.each do |configuration|
        required_asset_resource_identifiers =
          configuration.collect_required_resource_identifiers_from(asset_resource_identifiers)
        required_asset_resource_identifiers.each do |resource_identifier|
          required_assets_ids << asset_resource_identifier_map[resource_identifier]
        end
      end

      @asset_details = Ddm::Asset.details_for(serial_number).where(ddm_asset_id: required_assets_ids)

      @management_details = Ddm::Management.details_for(serial_number)

      public_asset_url_map = @public_asset_details.map do |public_asset_detail|
        [public_asset_detail.public_asset.reference_name, public_asset_detail.access_url]
      end.to_h

      configuration_map = @configurations.map do |configuration|
        [configuration.resource_identifier.reference_name, configuration.resource_identifier.digest]
      end.to_h

      asset_map = @asset_details.map do |asset_detail|
        [asset_detail.asset.resource_identifier.reference_name, asset_detail.asset.resource_identifier.digest]
      end.to_h

      @activation_declaration_items = @activations.map do |activation|
        DeclarationItem.new(
          identifier: activation.resource_identifier.digest,
          type: activation.type,
          payload: activation.reference_identifier_resolved_payload(configuration_map),
        )
      end

      @configuration_declaration_items = @configurations.map do |configuration|
        DeclarationItem.new(
          identifier: configuration.resource_identifier.digest,
          type: configuration.type,
          payload: configuration.reference_identifier_resolved_payload(asset_map.merge(public_asset_url_map)),
        )
      end

      @asset_declaration_items = @asset_details.map do |asset_detail|
        DeclarationItem.new(
          identifier: asset_detail.asset.resource_identifier.digest,
          type: asset_detail.asset.type,
          payload: asset_detail.reference_identifier_resolved_payload(public_asset_url_map),
        )
      end

      @management_declaration_items = @management_details.map do |management_detail|
        DeclarationItem.new(
          identifier: management_detail.management.resource_identifier.digest,
          type: management_detail.management.type,
          payload: management_detail.payload,
        )
      end
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
          Activations: @activation_declaration_items.map(&:manifest),
          Configurations: @configuration_declaration_items.map(&:manifest),
          Assets: @asset_declaration_items.map(&:manifest),
          Management: @management_declaration_items.map(&:manifest),
        },
        DeclarationsToken: declarations_token,
      }
    end

    def activation_detail_for(identifier)
      @activation_declaration_items.find { |item| item.has_identifier?(identifier) }&.detail
    end

    def configuration_detail_for(identifier)
      @configuration_declaration_items.find { |item| item.has_identifier?(identifier) }&.detail
    end

    def asset_detail_for(identifier)
      @asset_declaration_items.find { |item| item.has_identifier?(identifier) }&.detail
    end

    def management_detail_for(identifier)
      @management_declaration_items.find { |item| item.has_identifier?(identifier) }&.detail
    end

    private

    def timestamp
      Time.now
    end

    def declarations_token
      Digest::SHA256.hexdigest([
          @activation_declaration_items.map(&:manifest),
          @configuration_declaration_items.map(&:manifest),
          @asset_declaration_items.map(&:manifest),
          @management_declaration_items.map(&:manifest),
      ].to_json)
    end
  end
end
