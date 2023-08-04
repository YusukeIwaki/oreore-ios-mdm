module ByodCheckinRequest
  # <plist version="1.0">
  # <dict>
  #   <key>BuildVersion</key>
  #   <string>19H12</string>
  #   <key>EnrollmentID</key>
  #   <string>622258EF-Xxxx-xxxx-XXxx-xXXxxXXxXxxX</string>
  #   <key>MessageType</key>
  #   <string>Authenticate</string>
  #   <key>OSVersion</key>
  #   <string>15.7</string>
  #   <key>ProductName</key>
  #   <string>iPhone12,1</string>
  #   <key>Topic</key>
  #   <string>com.apple.mgmt.External.53b84869-7f41-4266-xxxx-xxxxxxxxxxxx</string>
  # </dict>
  # </plist>
  class AuthenticateMessageHandler
    def initialize(managed_apple_account, plist)
      @plist = plist
    end

    def handle
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

    def topic
      @plist['Topic']
    end

    def endollment_id
      @plist['EnrollmentID']
    end
  end
end
