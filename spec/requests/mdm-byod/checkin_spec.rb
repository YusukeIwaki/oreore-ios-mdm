require 'spec_helper'

describe 'BYOD Checkin' do
  before do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    token = SecureRandom.hex(24)
    account.access_tokens.create!(token: token)
    header 'Authorization', "Bearer #{token}"
  end

  let(:enrollment_id) { SecureRandom.uuid }
  let(:topic) { PushCertificate.from_env.topic }
  let(:push_magic) { SecureRandom.uuid }
  let(:push_token) { SecureRandom.hex(32) }

  let(:authenticate_body) {
    <<~BODY
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>BuildVersion</key>
      <string>19H12</string>
      <key>EnrollmentID</key>
      <string>#{enrollment_id}</string>
      <key>MessageType</key>
      <string>Authenticate</string>
      <key>OSVersion</key>
      <string>15.7</string>
      <key>ProductName</key>
      <string>iPhone12,1</string>
      <key>Topic</key>
      <string>#{topic}</string>
    </dict>
    </plist>
    BODY
  }
  let(:token_update_body) {
    <<~BODY
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>AwaitingConfiguration</key>
      <false/>
      <key>EnrollmentID</key>
      <string>#{enrollment_id}</string>
      <key>MessageType</key>
      <string>TokenUpdate</string>
      <key>PushMagic</key>
      <string>#{push_magic}</string>
      <key>Token</key>
      <data>
      #{Base64.strict_encode64([push_token].pack("H*"))}
      </data>
      <key>Topic</key>
      <string>#{topic}</string>
    </dict>
    </plist>
    BODY
  }

  it 'should handle Authenticate/TokenUpdate' do
    header 'User-Agent', 'MDM/1.0'
    header 'Content-Type', 'application/x-apple-aspen-mdm-checkin'
    expect {
      put '/mdm-byod/checkin', authenticate_body
      put '/mdm-byod/checkin', token_update_body
    }.to change { ByodDevice.count }.by(1)

    expect(last_response.status).to eq(200)

    device = ByodDevice.last
    expect(device.enrollment_id).to eq(enrollment_id)
    expect(device.managed_apple_account.email).to eq('test@example.com')
    expect(device.byod_push_endpoint.token).to eq(push_token)
    expect(device.byod_push_endpoint.push_magic).to eq(push_magic)
  end

  it 'should deny accesses from another enrollmentId' do
    header 'User-Agent', 'MDM/1.0'
    header 'Content-Type', 'application/x-apple-aspen-mdm-checkin'
    put '/mdm-byod/checkin', authenticate_body
    put '/mdm-byod/checkin', token_update_body
    expect(last_response).to be_ok

    put '/mdm-byod/checkin', token_update_body.gsub(enrollment_id, SecureRandom.uuid)
    expect(last_response).not_to be_ok
  end

  let(:checkout_body) {
    <<~BODY
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>EnrollmentID</key>
      <string>#{enrollment_id}</string>
      <key>MessageType</key>
      <string>CheckOut</string>
      <key>Topic</key>
      <string>#{topic}</string>
    </dict>
    </plist>
    BODY
  }

  it 'should allow CheckOut with expired access token' do
    header 'User-Agent', 'MDM/1.0'
    header 'Content-Type', 'application/x-apple-aspen-mdm-checkin'
    put '/mdm-byod/checkin', authenticate_body
    put '/mdm-byod/checkin', token_update_body

    device = ByodDevice.last
    device.managed_apple_account_access_token.update!(expires_at: 3.minutes.ago)

    put '/mdm-byod/checkin', checkout_body
    expect(last_response.status).to eq(200)
    expect(ByodDevice.where(enrollment_id: enrollment_id).count).to eq(0)
  end

  it 'should require access token for CheckOut' do
    header 'User-Agent', 'MDM/1.0'
    header 'Content-Type', 'application/x-apple-aspen-mdm-checkin'
    put '/mdm-byod/checkin', authenticate_body
    put '/mdm-byod/checkin', token_update_body

    header 'Authorization', "Bearer #{SecureRandom.hex(24)}"
    put '/mdm-byod/checkin', checkout_body
    expect(last_response.status).to eq(401)
  end
end
