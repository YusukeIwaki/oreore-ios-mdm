module ByodCheckinRequest
  # <plist version="1.0">
  # <dict>
  #   <key>AwaitingConfiguration</key>
  #   <false/>
  #   <key>EnrollmentID</key>
  #   <string>622258EF-Xxxx-xxxx-XXxx-xXXxxXXxXxxX</string>
  #   <key>MessageType</key>
  #   <string>TokenUpdate</string>
  #   <key>PushMagic</key>
  #   <string>2DE5E54A-Xxxx-xxxx-XXxx-xXXxxXXxXxxX</string>
  #   <key>Token</key>
  #   <data>
  #   XXXxxXXXXXxxXXXXXxxxxxXXXx/XXXxxxXXXXxxxXXXXX=
  #   </data>
  #   <key>Topic</key>
  #   <string>com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx</string>
  # </dict>
  # </plist>
  class TokenUpdateMessageHandler
    def initialize(plist)
      @plist = plist
    end

    def handle
      byod_device = ByodDevice.find_by(enrollment_id: enrollment_id)
      if byod_device
        ActiveRecord::Base.transaction do
          byod_device.byod_push_endpoint.update!(
            token: token,
            push_magic: push_magic,
          )
        end
      else
        ActiveRecord::Base.transaction do
          mdm_device = ByodDevice.create!(enrollment_id: enrollment_id)
          mdm_device.create_byod_push_endpoint!(
            token: token,
            push_magic: push_magic,
          )
        end
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

    def enrollment_id
      @plist['EnrollmentID']
    end
  end
end
