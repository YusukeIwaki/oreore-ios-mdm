module MobileConfig
  class Mdm < Data.define(:uuid, :identity_cerificate, :topic)
    def initialize(uuid: nil, identity_cerificate: nil, topic: nil)
      unless identity_cerificate.is_a?(MobileConfig::SecurityPkcs12)
        raise ArgumentError, 'identity_cerificate must be a MobileConfig::SecurityPkcs12'
      end
      if !topic.is_a?(String) || !topic.start_with?('com.apple.mgmt.External.')
        raise ArgumentError, 'topic must be a String starting with com.apple.mgmt.External.'
      end

      super(
        uuid: uuid || SecureRandom.uuid,
        identity_cerificate: identity_cerificate,
        topic: topic,
      )
    end

    def identifier
      "com.apple.mdm.#{uuid}"
    end

    def server_url
      "#{ENV['MDM_SERVER_BASE_URL']}/mdm/command"
    end

    def check_in_url
      "#{ENV['MDM_SERVER_BASE_URL']}/mdm/checkin"
    end

    def build_payload
      {
        IdentityCertificateUUID: identity_cerificate.uuid,
        Topic: topic,
        ServerURL: server_url,
        ServerCapabilities: server_capabilities,
        CheckInURL: check_in_url,
        CheckOutWhenRemoved: true,
        AccessRights: 8191,
        PayloadDescription: 'Configures Mobile Device Management',
        PayloadDisplayName: 'Oreore MDM',
        PayloadIdentifier: identifier,
        PayloadType: 'com.apple.mdm',
        PayloadUUID: uuid,
        PayloadVersion: 1,
      }
    end

    private

    def server_capabilities
      if GetTokenTarget.first
        ['com.apple.mdm.per-user-connections', 'com.apple.mdm.token']
      else
        ['com.apple.mdm.per-user-connections']
      end
    end
  end
end
