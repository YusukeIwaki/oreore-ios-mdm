module MobileConfig
  # https://github.com/apple/device-management/blob/release/mdm/profiles/TopLevel.yaml
  class Root < Data.define(:uuid, :display_name, :contents)
    def initialize(uuid: nil, display_name: nil, contents: nil)
      if !contents.is_a?(Enumerable) || contents.any? { |c| !c.respond_to?(:build_payload) }
        raise ArgumentError, 'contents must be an Enumerable of MobileConfig'
      end

      super(
        uuid: uuid || SecureRandom.uuid,
        display_name: display_name || 'Untitled',
        contents: contents,
      )
    end

    def identifier
      "dev.oreore-mdm.#{uuid}"
    end

    def build_payload
      {
        PayloadContent: contents.map(&:build_payload),
        PayloadDisplayName: display_name,
        PayloadIdentifier: identifier,
        PayloadRemovalDisallowed: false,
        PayloadType: 'Configuration',
        PayloadUUID: uuid,
        PayloadVersion: 1,
      }
    end
  end
end
