module CheckinRequest
  # <plist version="1.0">
  # <dict>
  #   <key>MessageType</key>
  #   <string>CheckOut</string>
  #   <key>Topic</key>
  #   <string>com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx</string>
  #   <key>UDID</key>
  #   <string>00008027-XXXXXXXXXXXXXXXXXXXX</string>
  # </dict>
  # </plist>
  class CheckOutMessageHandler
    def initialize(plist)
      @plist = plist
    end

    def handle
      device = MdmDevice.find_by!(udid: udid)
      CommandQueue.for_device(device).clear
      MdmCommandHistory.where(device_identifier: udid).destroy_all
      device.destroy!
      Ddm::SynchronizationRequestHistory.where(device_identifier: udid).destroy_all
    end

    private

    def topic
      @plist['Topic']
    end

    def udid
      @plist['UDID']
    end
  end
end
