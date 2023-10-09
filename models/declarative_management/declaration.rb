module DeclarativeManagement
  class Declaration
    class YmlReader
      def initialize(serial_number)
        @reference_map = {}
        ConfigurationDefinition.all.each do |definition|
          @reference_map[definition.identifier.reference_name] = definition
        end
        AssetDefinition.for(serial_number).each do |definition|
          @reference_map[definition.identifier.reference_name] = definition
        end
        PropertyDefinition.for(serial_number).each do |definition|
          @reference_map[definition.identifier.reference_name] = definition
        end
        @public_asset_file_map = {}
        PublicAssetFile.for(serial_number).each do |public_asset_file|
          @public_asset_file_map[public_asset_file.reference_name] = public_asset_file.access_url
        end

      end

      class ReadResult
        def initialize(dependencies, yml)
          @dependencies = dependencies
          @yml = yml
        end

        attr_reader :dependencies, :yml
      end

      def read(yaml_string)
        dependencies = []
        _yaml_string = yaml_string.dup
        @reference_map.each do |reference_name, definition|
          _yaml_string.gsub!(reference_name) do
            dependencies << definition.identifier
            definition.identifier.digest
          end
        end
        @public_asset_file_map.each do |reference_name, access_url|
          _yaml_string.gsub!(reference_name, access_url)
        end

        ReadResult.new(dependencies, YAML.load(_yaml_string))
      end
    end

    # mixed into resource classes with @yml:String
    module ReadWithDependencies
      # @param [YmlReader] reader
      # @return [YmlReader::ReadResult]
      def read(reader)
        reader.read(@yml)
      end
    end

    def initialize(serial_number)
      reader = YmlReader.new(serial_number)
      dependent_configurations = Set.new
      @activations = ActivationDefinition.for(serial_number).map do |definition|
        result = definition.read(reader)
        dependent_configurations.merge(result.dependencies)

        DeclarationItem.new(
          identifier: definition.identifier.digest,
          type: result.yml['type'],
          payload: result.yml.reject { |k, _| k == 'type' },
        )
      end

      dependent_assets = Set.new
      dependent_reference_names = dependent_configurations.map(&:reference_name)
      @configurations = ConfigurationDefinition.all.filter_map do |definition|
        if dependent_reference_names.include?(definition.identifier.reference_name)
          result = definition.read(reader)
          dependent_assets.merge(result.dependencies)

          DeclarationItem.new(
            identifier: definition.identifier.digest,
            type: result.yml['type'],
            payload: result.yml.reject { |k, _| k == 'type' },
          )
        else
          nil
        end
      end

      @assets = AssetDefinition.for(serial_number).map do |definition|
        result = definition.read(reader)
        DeclarationItem.new(
          identifier: definition.identifier.digest,
          type: result.yml['type'],
          payload: result.yml.reject { |k, _| k == 'type' },
        )
      end

      @management = PropertyDefinition.for(serial_number).map do |definition|
        result = definition.read(reader)
        DeclarationItem.new(
          identifier: definition.identifier.digest,
          type: result.yml['type'],
          payload: result.yml.reject { |k, _| k == 'type' },
        )
      end
    end

    private def timestamp
      Time.now
    end

    private def declarations_token
      Digest::SHA256.hexdigest([
          @activations.map(&:manifest),
          @configurations.map(&:manifest),
          @assets.map(&:manifest),
          @management.map(&:manifest),
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
          Activations: @activations.map(&:manifest),
          Configurations: @configurations.map(&:manifest),
          Assets: @assets.map(&:manifest),
          Management: @management.map(&:manifest),
        },
        DeclarationsToken: declarations_token,
      }
    end

    def activation_detail_for(identifier)
      @activations.find { |item| item.has_identifier?(identifier) }&.detail
    end

    def configuration_detail_for(identifier)
      @configurations.find { |item| item.has_identifier?(identifier) }&.detail
    end

    def asset_detail_for(identifier)
      @assets.find { |item| item.has_identifier?(identifier) }&.detail
    end

    def management_detail_for(identifier)
      @management.find { |item| item.has_identifier?(identifier) }&.detail
    end
  end
end
