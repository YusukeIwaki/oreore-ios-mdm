module DeclarativeManagement
  class Declaration
    class PublicAssetFile
      def initialize(target:, name:, path:)
        @target = target
        @name = name
        @reference_name = "@public/#{name}"
        @access_url = "#{ENV['MDM_SERVER_BASE_URL']}/mdm/declarative/assets/#{PublicAssetFile.digested_path(path)}"
      end

      attr_reader :reference_name, :access_url

      def self.digested_path(path)
        # hogehoge.png -> hogehoge.png
        filename = File.basename(path)
        if filename == path
          return filename
        end

        # hogehoge/SERIALNUMBER1.png -> hogehoge/#{digest(SERIALNUMBER1)}.png
        ext = File.extname(path)
        target = File.basename(filename, ext)
        uuid = Digest::UUID.uuid_v5(Digest::UUID::OID_NAMESPACE, target)
        File.join(File.dirname(path), "#{uuid}#{ext}")
      end

      def self.find_path_by_digested_path(digested_path)
        # hogehoge.png -> hogehoge.png
        filename = File.basename(digested_path)
        if filename == digested_path
          return filename
        end

        # hogehoge/#{digest(SERIALNUMBER1)}.png -> hogehoge/SERIALNUMBER1.png
        ext = File.extname(digested_path)
        uuid = File.basename(filename, ext)
        Dir.glob(File.join('declarations/public', File.dirname(digested_path), "*#{ext}")).find do |path|
          target = File.basename(path, ext)
          Digest::UUID.uuid_v5(Digest::UUID::OID_NAMESPACE, target) == uuid
        end
      end

      def self._each
        Enumerator.new do |out|
          Dir.glob('declarations/public/*').map do |public_asset_file|
            next if File.directory?(public_asset_file)

            name = public_asset_file.match(/declarations\/public\/(.*)/)[1]
            ext = File.extname(name)
            out << [nil, name, name]

            # detect device/group specific assets.
            #
            # base: declarations/public/hogehoge.png
            # - declarations/public/hogehoge/SERIALNUMBER1.png
            # - declarations/public/hogehoge/group1.png
            Dir.glob("declarations/public/#{File.basename(name, ext)}/*#{ext}") do |sub_asset_file|
              path = sub_asset_file.match(/declarations\/public\/(.*)/)[1]
              out << [File.basename(path, ext), name, path]
            end
          end
        end
      end

      def self.all
        _each.map do |target, name, path|
          PublicAssetFile.new(target: target, name: name, path: path)
        end
      end

      def self.for(serial_number)
        groups = DeviceGroup.including(serial_number)
        group_names = groups.map(&:name)
        group_names.sort!
        # smaller is higher priority
        priorities = { nil => group_names.size, serial_number => -1 }.merge(group_names.each_with_index.to_h)
        group_by_name = {}
        _each.each do |target, name, path|
          if group_names.include?(target) || target == serial_number || target.nil?
            priority = priorities[target]
            if (existing = group_by_name[name])
              if priority < priorities[existing.first]
                group_by_name[name] = [target, path]
              end
            else
              group_by_name[name] = [target, path]
            end
          end
        end
        group_by_name.map do |name, definition|
          target, path = definition
          PublicAssetFile.new(target: target, name: name, path: path)
        end
      end
    end

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
