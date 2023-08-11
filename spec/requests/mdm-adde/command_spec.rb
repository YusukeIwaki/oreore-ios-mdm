require 'spec_helper'

describe 'ADDE command' do
  before do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    access_token = account.access_tokens.create!(token: SecureRandom.hex(24))
    header 'Authorization', "Bearer #{access_token.token}"

    device = MdmDevice.create!(
      udid: udid,
      serial_number: 'SERIALNUMBER1',
      imei: '351111112222223')
    device.create_mdm_push_endpoint!(
      push_magic: SecureRandom.uuid,
      token: SecureRandom.hex(32),
    )
    ManagedAppleAccountAccessTokenUsage.create!(
      device_identifier: udid,
      managed_apple_account_access_token: account.access_tokens.first,
    )
  end

  let(:udid) { SecureRandom.uuid }
  let(:command_body) {
    <<~BODY
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>UDID</key>
      <string>#{udid}</string>
      <key>Status</key>
      <string>Idle</string>
    </dict>
    </plist>
    BODY
  }

  it 'should handle token refresh' do
    device = MdmDevice.last
    device.managed_apple_account_access_token.update!(expires_at: 3.minutes.ago)

    header 'Content-Type', 'application/x-apple-aspen-mdm'
    put '/mdm-adde/command', command_body
    expect(last_response.status).to eq(401)
    expect(last_response['WWW-Authenticate']).to match(/Bearer method="apple-as-web", url="[^"]+"/)

    header 'Content-Type', 'application/x-www-form-urlencoded'
    post '/mdm-adde/authenticate', URI.encode_www_form({ email: 'test@example.com', password: 'PASSWORD!' })
    new_token = last_response['Location'].match(/apple-remotemanagement-user-login:\/\/authentication-results\?access-token=(.+)/)[1]

    header 'Authorization', "Bearer #{new_token}"
    put '/mdm-adde/command', command_body
    expect(last_response.status).to eq(200)

    device = MdmDevice.last
    expect(device.managed_apple_account_access_token.token).to eq(new_token)
  end
end
