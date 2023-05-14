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
      puts <<~RUBY
      Destination = Data.define(:udid, :token, :push_magic)
      destination = Destination.new(
        udid: '#{udid}',
        token: '#{token}',
        push_magic: '#{push_magic}',
      )
      PushClient.new.send_mdm_notification(destination, commands: [Command::DeviceInformation.new])
      RUBY

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
      @plist['UnlockToken'].read.unpack('H*').first
    end
  end
end
