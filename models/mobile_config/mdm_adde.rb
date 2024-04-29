module MobileConfig
  class MdmAdde < Data.define(:uuid, :identity_cerificate, :topic, :assigned_managed_apple_id)
    def initialize(uuid: nil, identity_cerificate: nil, topic: nil, assigned_managed_apple_id: nil)
      unless identity_cerificate.is_a?(MobileConfig::SecurityPkcs12)
        raise ArgumentError, 'identity_cerificate must be a MobileConfig::SecurityPkcs12'
      end
      if !topic.is_a?(String) || !topic.start_with?('com.apple.mgmt.External.')
        raise ArgumentError, 'topic must be a String starting with com.apple.mgmt.External.'
      end
      unless assigned_managed_apple_id.is_a?(String)
        raise ArgumentError, 'assigned_managed_apple_id must be a String'
      end

      super(
        uuid: uuid || SecureRandom.uuid,
        identity_cerificate: identity_cerificate,
        topic: topic,
        assigned_managed_apple_id: assigned_managed_apple_id,
      )
    end

    def identifier
      "com.apple.mdm.#{uuid}"
    end

    def server_url
      "#{ENV['MDM_SERVER_BASE_URL']}/mdm-adde/command"
    end

    def check_in_url
      "#{ENV['MDM_SERVER_BASE_URL']}/mdm-adde/checkin"
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
        AssignedManagedAppleID: assigned_managed_apple_id,
        EnrollmentMode: 'ADDE',
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
