require 'spec_helper'

describe 'MDM Checkin (DeclarativeManagement)' do
  let(:udid) { SecureRandom.uuid }
  let(:serial_number) { "SN#{SecureRandom.hex(4).upcase}" }

  before do
    MdmDevice.create!(udid: udid, serial_number: serial_number)
  end

  # Production runs with LANG unset, i.e. Encoding.default_external == US-ASCII.
  # The plist gem builds <data> payloads via `StringIO.new`, which inherits the
  # default external encoding, so Data containing non-ASCII bytes (e.g. U+2019
  # in "Activation’s ...") used to crash JSON.parse with
  # Encoding::InvalidByteSequenceError ("\xE2" on US-ASCII).
  around do |example|
    orig = Encoding.default_external
    Encoding.default_external = Encoding::US_ASCII
    begin
      example.run
    ensure
      Encoding.default_external = orig
    end
  end

  let(:status_json) do
    {
      StatusItems: {
        management: {
          declarations: {
            activations: [
              {
                reasons: [
                  {
                    details: {
                      Identifier: '544f167b-4c55-581b-92cb-43f8589fa723',
                      ServerToken: '5a6840ba06d6fe6d5cd83b7aaec6ff833f8c06a1033d3972193b6449fb357c7f',
                      Predicate: 'status.device.operating-system.version >= "27.0"',
                    },
                    description: 'Activation’s (544f167b-4c55-581b-92cb-43f8589fa723:5a6840ba06d6fe6d5cd83b7aaec6ff833f8c06a1033d3972193b6449fb357c7f) predicate (status.device.operating-system.version >= "27.0") evaluated to false.',
                    code: 'Info.Predicate',
                  },
                ],
                active: false,
                identifier: '544f167b-4c55-581b-92cb-43f8589fa723',
                valid: 'valid',
                'server-token': '5a6840ba06d6fe6d5cd83b7aaec6ff833f8c06a1033d3972193b6449fb357c7f',
              },
            ],
            configurations: [
              {
                reasons: [
                  {
                    details: { UnknownDeclarationType: 'com.apple.configuration.webcontent-filter.plugin' },
                    description: 'Unknown Declaration Type',
                    code: 'Error.UnknownDeclarationType',
                  },
                ],
                active: false,
                identifier: 'a2e570f6-2ffd-5e0c-a876-efa28278cb9a',
                valid: 'unknown',
                'server-token': '07875469ae6563a8b6e3ddb1d31abf21766f7598d4900c13bb08097127b4a351',
              },
            ],
          },
        },
      },
    }.to_json
  end

  let(:status_body) do
    <<~BODY
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>Data</key>
      <data>
      #{Base64.strict_encode64(status_json)}
      </data>
      <key>Endpoint</key>
      <string>status</string>
      <key>MessageType</key>
      <string>DeclarativeManagement</string>
      <key>UDID</key>
      <string>#{udid}</string>
    </dict>
    </plist>
    BODY
  end

  it 'handles status reports containing non-ASCII characters' do
    header 'User-Agent', 'MDM/1.0'
    header 'Content-Type', 'application/x-apple-aspen-mdm-checkin'
    put '/mdm/checkin', status_body

    expect(last_response.status).to eq(200)

    history = Ddm::SynchronizationRequestHistory.last
    expect(history.device_identifier).to eq(udid)
    expect(history.endpoint).to eq('status')
    description = history.request_payload['StatusItems']['management']['declarations']['activations'][0]['reasons'][0]['description']
    expect(description).to include('Activation’s')
  end
end
