require 'spec_helper'

describe 'BYOD Enrollment' do
  it 'should handle iOS15 buggy headers' do
    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/x-www-form-urlencoded'
    post '/mdm-byod/enroll', Base64.strict_decode64(asset('enroll_body.b64'))
    expect(last_response.status).to eq(401)
  end

  it 'should return 401 without access token' do
    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/pkcs7-signature'
    post '/mdm-byod/enroll', Base64.strict_decode64(asset('enroll_body.b64'))

    # https://developer.apple.com/documentation/devicemanagement/user_enrollment/onboarding_users_with_account_sign-in/implementing_the_simple_authentication_user-enrollment_flow#4084285
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
    post '/mdm-byod/enroll', Base64.strict_decode64(asset('enroll_body.b64'))
    expect(last_response.status).to eq(401)
  end

  it 'should return mobileconfig with valid access token' do
    account = ManagedAppleAccount.create!(email: 'test@example.com')
    token = SecureRandom.hex(24)
    account.access_tokens.create!(token: token)

    header 'User-Agent', 'DeviceManagementClient/1.0'
    header 'Content-Type', 'application/pkcs7-signature'
    header 'Authorization', "Bearer #{token}"
    post '/mdm-byod/enroll', Base64.strict_decode64(asset('enroll_body.b64'))
    expect(last_response.status).to eq(200)
    plist = Plist.parse_xml(last_response.body, marshal: false)

    # https://developer.apple.com/documentation/devicemanagement/user_enrollment/onboarding_users_with_account_sign-in/implementing_the_simple_authentication_user-enrollment_flow#4084278
    mdm_payload = plist['PayloadContent'].find { |payload| payload['PayloadType'] == 'com.apple.mdm' }
    expect(mdm_payload['EnrollmentMode']).to eq('BYOD')
    expect(mdm_payload['AssignedManagedAppleID']).to eq('test@example.com')
    expect(mdm_payload).not_to have_key("AccessRights")
  end
end
