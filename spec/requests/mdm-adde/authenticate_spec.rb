require 'spec_helper'

describe 'ADDE Authentication' do
  it 'should generate an access token' do
    account = ManagedAppleAccount.create!(email: 'hoge@example.com')

    expect {
      header 'Content-Type', 'application/x-www-form-urlencoded'
      post '/mdm-adde/authenticate', URI.encode_www_form({ email: 'hoge@example.com', password: 'PASSWORD!' })
    }.to change { account.access_tokens.count }.by(1)

    access_token = account.access_tokens.last

    # https://developer.apple.com/documentation/devicemanagement/user_enrollment/onboarding_users_with_account_sign-in/implementing_the_simple_authentication_user-enrollment_flow#4084279
    expect(last_response.status).to eq(308)
    expect(last_response['Location']).to eq("apple-remotemanagement-user-login://authentication-results?access-token=#{access_token.token}")
  end
end
