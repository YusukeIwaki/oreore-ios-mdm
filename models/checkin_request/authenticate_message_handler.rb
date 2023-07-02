module CheckinRequest
  # <plist version="1.0">
  # <dict>
  #   <key>BuildVersion</key>
  #   <string>19H12</string>
  #   <key>IMEI</key>
  #   <string>35 XXXXXX XXXXXX 8</string>
  #   <key>MessageType</key>
  #   <string>Authenticate</string>
  #   <key>OSVersion</key>
  #   <string>15.7</string>
  #   <key>ProductName</key>
  #   <string>iPad8,3</string>
  #   <key>SerialNumber</key>
  #   <string>DMPXXXXXXXXXX</string>
  #   <key>Topic</key>
  #   <string>com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx</string>
  #   <key>UDID</key>
  #   <string>00008027-XXXXXXXXXXXXXXXXXXXX</string>
  # </dict>
  # </plist>
  class AuthenticateMessageHandler
    def initialize(plist)
      @plist = plist
    end

    def handle
      PendingCheckin.find_or_initialize_by(udid: udid).update!(
        imei: imei&.gsub(/\s/, ''),
        serial_number: serial_number,
      )
    end

    private

    def build_version
      @plist['BuildVersion']
    end

    def imei
      @plist['IMEI']
    end

    def os_version
      @plist['OSVersion']
    end

    def product_name
      @plist['ProductName']
    end

    def serial_number
      @plist['SerialNumber']
    end

    def topic
      @plist['Topic']
    end

    def udid
      @plist['UDID']
    end
  end
end
