RSpec.configure do |config|
  config.before(:each) do
    mock_cert = double('PushCertificate')
    allow(mock_cert).to receive(:topic).and_return("com.apple.mgmt.External.#{SecureRandom.uuid}}")
    allow(PushCertificate).to receive(:from_env).and_return(mock_cert)

    mock_response = PushClient::Response.new(200, SecureRandom.uuid, {})
    allow_any_instance_of(PushClient).to receive(:send_mdm_notification).and_return(mock_response)
  end
end
