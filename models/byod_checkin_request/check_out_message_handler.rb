module ByodCheckinRequest
  # <plist version="1.0">
  # <dict>
  #   <key>EnrollmentID</key>
  #   <string>622258EF-Xxxx-xxxx-XXxx-xXXxxXXxXxxX</string>
  #   <key>MessageType</key>
  #   <string>CheckOut</string>
  #   <key>Topic</key>
  #   <string>com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx</string>
  # </dict>
  # </plist>
  class CheckOutMessageHandler
    def initialize(plist)
      @plist = plist
    end

    def handle
      device = ByodDevice.find_by!(enrollment_id: enrollment_id)
      CommandQueue.for_byod_device(device).clear
      MdmCommandHistory.where(device_identifier: enrollment_id).destroy_all
      device.destroy!
      # Ddm::SynchronizationRequestHistory.where(device_identifier: enrollment_id).destroy_all
    end

    private

    def topic
      @plist['Topic']
    end

    def enrollment_id
      @plist['EnrollmentID']
    end
  end
end
