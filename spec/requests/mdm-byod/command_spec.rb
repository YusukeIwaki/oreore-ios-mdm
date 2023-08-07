require 'spec_helper'

describe 'BYOD command' do
  before do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    access_token = account.access_tokens.create!(token: SecureRandom.hex(24))
    header 'Authorization', "Bearer #{access_token.token}"

    device = ByodDevice.create!(enrollment_id: enrollment_id)
    device.create_byod_push_endpoint!(
      push_magic: SecureRandom.uuid,
      token: SecureRandom.hex(32),
    )
    ManagedAppleAccountAccessTokenUsage.create!(
      enrollment_id: enrollment_id,
      managed_apple_account_access_token: account.access_tokens.first,
    )
  end

  let(:enrollment_id) { SecureRandom.uuid }
  let(:command_body) {
    <<~BODY
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>EnrollmentID</key>
      <string>#{enrollment_id}</string>
      <key>Status</key>
      <string>Idle</string>
    </dict>
    </plist>
    BODY
  }

  it 'should handle token refresh' do
    device = ByodDevice.last
    device.managed_apple_account_access_token.update!(expires_at: 3.minutes.ago)

    header 'Content-Type', 'application/x-apple-aspen-mdm'
    put '/mdm-byod/command', command_body
    expect(last_response.status).to eq(401)
    expect(last_response['WWW-Authenticate']).to match(/Bearer method="apple-as-web", url="[^"]+"/)

    header 'Content-Type', 'application/x-www-form-urlencoded'
    post '/mdm-byod/authenticate', URI.encode_www_form({ email: 'test@example.com', password: 'password!' })
    new_token = last_response['Location'].match(/apple-remotemanagement-user-login:\/\/authentication-results\?access-token=(.+)/)[1]

    header 'Authorization', "Bearer #{new_token}"
    put '/mdm-byod/command', command_body
    expect(last_response.status).to eq(200)

    device = ByodDevice.last
    expect(device.managed_apple_account_access_token.token).to eq(new_token)
  end
end
