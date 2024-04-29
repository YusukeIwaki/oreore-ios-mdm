require 'spec_helper'

describe 'ADDE Enrollment' do
  it 'should return 401 without access token' do
    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/pkcs7-signature'
    post '/mdm-adde/enroll', Base64.strict_decode64(asset('enroll_body.b64'))

    expect(last_response.status).to eq(401)
    expect(last_response['WWW-Authenticate']).to match(/Bearer method="apple-as-web", url="[^"]+"/)
  end

  it 'should return 401 with expired access token' do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    token = SecureRandom.hex(24)
    account.access_tokens.create!(token: token, expires_at: 3.minutes.ago)

    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/pkcs7-signature'
    header 'Authorization', "Bearer #{token}"
    post '/mdm-adde/enroll', Base64.strict_decode64(asset('enroll_body.b64'))
    expect(last_response.status).to eq(401)
  end

  it 'should return mobileconfig with valid access token' do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    token = SecureRandom.hex(24)
    account.access_tokens.create!(token: token)
    GetTokenTarget.delete_all

    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/pkcs7-signature'
    header 'Authorization', "Bearer #{token}"
    post '/mdm-adde/enroll', Base64.strict_decode64(asset('enroll_body.b64'))
    expect(last_response.status).to eq(200)
    plist = Plist.parse_xml(last_response.body, marshal: false)

    mdm_payload = plist['PayloadContent'].find { |payload| payload['PayloadType'] == 'com.apple.mdm' }
    expect(mdm_payload['EnrollmentMode']).to eq('ADDE')
    expect(mdm_payload['AssignedManagedAppleID']).to eq('test@example.com')
    expect(mdm_payload).to have_key("AccessRights") # without this enrollment fails with an error "The MDM payload [Oreore MDM] contains invalid access rights".
    expect(mdm_payload['ServerCapabilities']).to contain_exactly('com.apple.mdm.per-user-connections')
  end

  it 'should have ServerCapabilities com.apple.mdm.token if GetTokenTarget exists' do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    token = SecureRandom.hex(24)
    account.access_tokens.create!(token: token)

    dep_server_token = DepServerToken.create!(
      filename: SecureRandom.hex(24),
      consumer_key: SecureRandom.hex(24),
      consumer_secret: SecureRandom.hex(24),
      access_token: SecureRandom.hex(24),
      access_secret: SecureRandom.hex(24),
      access_token_expiry: 1.day.from_now,
    )
    GetTokenTarget.delete_all
    GetTokenTarget.create!(
      dep_server_token: dep_server_token,
      server_uuid: SecureRandom.uuid,
    )

    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/pkcs7-signature'
    header 'Authorization', "Bearer #{token}"
    post '/mdm-adde/enroll', Base64.strict_decode64(asset('enroll_body.b64'))
    expect(last_response.status).to eq(200)
    plist = Plist.parse_xml(last_response.body, marshal: false)

    mdm_payload = plist['PayloadContent'].find { |payload| payload['PayloadType'] == 'com.apple.mdm' }
    expect(mdm_payload['ServerCapabilities']).to contain_exactly('com.apple.mdm.per-user-connections', 'com.apple.mdm.token')
  end
end
