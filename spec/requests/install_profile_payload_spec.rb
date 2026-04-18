require 'spec_helper'

describe 'POST /install_profile_payload', logged_in: true do
  let(:mobileconfig_content) do
    <<~XML
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>PayloadDisplayName</key>
        <string>Dropped Profile</string>
        <key>PayloadIdentifier</key>
        <string>com.example.dropped</string>
        <key>PayloadType</key>
        <string>Configuration</string>
        <key>PayloadUUID</key>
        <string>11111111-1111-1111-1111-111111111111</string>
        <key>PayloadVersion</key>
        <integer>1</integer>
      </dict>
      </plist>
    XML
  end

  it 'returns an InstallProfile request payload that wraps the uploaded mobileconfig' do
    post '/install_profile_payload', {
      mobileconfig_file: Rack::Test::UploadedFile.new(
        StringIO.new(mobileconfig_content),
        'application/x-apple-aspen-config',
        false,
        original_filename: 'example.mobileconfig',
      ),
    }

    expect(last_response).to be_ok

    parsed = Plist.parse_xml(last_response.body, marshal: false)
    expect(parsed['CommandUUID']).to match(/\A[0-9a-f-]{36}\z/)
    expect(parsed['Command']['RequestType']).to eq('InstallProfile')

    payload_io = parsed['Command']['Payload']
    expect(payload_io).to respond_to(:read)
    expect(payload_io.read).to eq(mobileconfig_content)
  end

  it 'handles binary (e.g. PKCS7-signed) mobileconfig content' do
    binary_content = (0..255).map(&:chr).join.b

    post '/install_profile_payload', {
      mobileconfig_file: Rack::Test::UploadedFile.new(
        StringIO.new(binary_content),
        'application/x-apple-aspen-config',
        false,
        original_filename: 'signed.mobileconfig',
      ),
    }

    expect(last_response).to be_ok

    parsed = Plist.parse_xml(last_response.body, marshal: false)
    expect(parsed['Command']['Payload'].read.b).to eq(binary_content)
  end

  it 'returns 400 when no file is given' do
    post '/install_profile_payload'

    expect(last_response.status).to eq(400)
  end

  it 'produces a payload that is accepted by POST /devices/:udid/commands' do
    device = MdmDevice.create!(
      udid: SecureRandom.uuid,
      serial_number: "SERIAL#{SecureRandom.hex(4)}",
    )

    post '/install_profile_payload', {
      mobileconfig_file: Rack::Test::UploadedFile.new(
        StringIO.new(mobileconfig_content),
        'application/x-apple-aspen-config',
        false,
        original_filename: 'example.mobileconfig',
      ),
    }
    expect(last_response).to be_ok
    payload = last_response.body

    expect {
      post "/devices/#{device.udid}/commands", { payload: payload }
    }.to change { CommandQueue.for_device(device).size }.by(1)

    queued = CommandQueue.for_device(device).command_requests.last
    expect(queued.request_payload.dig('Command', 'RequestType')).to eq('InstallProfile')
    expect(queued.request_payload.dig('Command', 'Payload').read).to eq(mobileconfig_content)
  end
end
