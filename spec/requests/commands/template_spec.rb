require 'spec_helper'

RSpec.describe 'POST /commands/template.txt' do
  describe 'Return to Service' do
    around do |example|
      Rts::WifiProfile.delete_all

      Dir.mktmpdir do |dir|
        @tmpdir = dir
        example.run
      end
    end

    def wifi_profile_uploaded_file(name)
      xml = <<~XML
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>PayloadDisplayName</key>
        <string>Wi-Fi (#{name})</string>
      </dict>
      </plist>
      XML
      file = File.join(@tmpdir, "wifi_#{name}.mobileconfig")
      File.write(file, xml)
      Rack::Test::UploadedFile.new(file, 'application/x-apple-aspen-config')
    end

    it 'should create return to service payload' do
      name = SecureRandom.hex(4)
      wifi_profile = Rts::WifiProfile.create!(
        name: "my-wifi_#{name}",
        asset_file: wifi_profile_uploaded_file(name),
      )

      post '/commands/template.txt', { :class => 'EraseDevice' }

      expect(last_response.status).to eq(200)
      body = last_response.body
      plist = Plist.parse_xml(body, marshal: false)
      command_payload = plist['Command']
      expect(command_payload['RequestType']).to eq('EraseDevice')
      expect(command_payload['ReturnToService']['Enabled']).to eq(true)

      wifi = Plist.parse_xml(command_payload['ReturnToService']['WiFiProfileData'].read, marshal: false)
      mdm = Plist.parse_xml(command_payload['ReturnToService']['MDMProfileData'].read, marshal: false)

      expect(wifi['PayloadDisplayName']).to eq("Wi-Fi (#{name})")
      expect(mdm['PayloadDisplayName']).to eq('Oreore MDM configuration')
    end
  end
end
