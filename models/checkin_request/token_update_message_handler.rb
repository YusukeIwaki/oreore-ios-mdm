module CheckinRequest
  # <plist version="1.0">
  # <dict>
  #   <key>AwaitingConfiguration</key>
  #   <false/>
  #   <key>MessageType</key>
  #   <string>TokenUpdate</string>
  #   <key>PushMagic</key>
  #   <string>DC257A6C-96C9-4714-XXXX-XXXXXXXXXXXX</string>
  #   <key>Token</key>
  #   <data>
  #   XXXxxXXXXXxxXXXXXxxxxxXXXx/XXXxxxXXXXxxxXXXXX=
  #   </data>
  #   <key>Topic</key>
  #   <string>com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx</string>
  #   <key>UDID</key>
  #   <string>00008027-XXXXXXXXXXXXXXXXXXXX</string>
  #   <key>UnlockToken</key>
  #   <data>
  #   long long long string!
  #   </data>
  # </dict>
  # </plist>
  class TokenUpdateMessageHandler
    def initialize(plist)
      @plist = plist
    end

    def handle
      pending_checkin = PendingCheckin.find_by(udid: udid)
      if pending_checkin
        handle_token_update_after_authenticate(pending_checkin)
      else
        handle_token_update_only
      end

      nil
    end

    private

    def awaiting_configuration
      @plist['AwaitingConfiguration']
    end

    def push_magic
      @plist['PushMagic']
    end

    def token
      @plist['Token'].read.unpack('H*').first
    end

    def topic
      @plist['Topic']
    end

    def udid
      @plist['UDID']
    end

    def unlock_token
      if @plist['UnlockToken']
        @plist['UnlockToken'].read.unpack('H*').first
      else
        nil
      end
    end

    def handle_token_update_after_authenticate(pending_checkin)
      mdm_device = MdmDevice.find_by(udid: udid)
      if mdm_device
        ActiveRecord::Base.transaction do
          mdm_device.mdm_push_endpoint.update!(
            token: token,
            push_magic: push_magic,
            unlock_token: unlock_token,
          )
          pending_checkin.destroy!
        end
      else
        ActiveRecord::Base.transaction do
          mdm_device = MdmDevice.create!(
            udid: udid,
            imei: pending_checkin.imei,
            serial_number: pending_checkin.serial_number,
          )
          mdm_device.create_mdm_push_endpoint!(
            token: token,
            push_magic: push_magic,
            unlock_token: unlock_token,
          )
          pending_checkin.destroy!
        end
      end
    end

    def handle_token_update_only
      attributes = {
        token: token,
        push_magic: push_magic,
        unlock_token: unlock_token,
      }.compact # unlock_token can be nil

      mdm_device = MdmDevice.find_by!(udid: udid)
      mdm_device.mdm_push_endpoint.update!(attributes)
    end
  end
end
