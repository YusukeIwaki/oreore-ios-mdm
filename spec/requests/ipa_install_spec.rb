require 'spec_helper'

describe 'POST /ipa/:id/install', logged_in: true do
  before do
    ENV['MDM_SERVER_BASE_URL'] = 'https://example.com'
  end

  after do
    ENV.delete('MDM_SERVER_BASE_URL')
  end

  let!(:ipa) do
    IpaFile.create!(
      filename: 'example.ipa',
      bundle_identifier: 'com.example.app',
      asset_file: StringIO.new('fake ipa content'),
    )
  end

  let!(:device1) do
    MdmDevice.create!(udid: 'UDID-1', serial_number: 'SN1').tap do |d|
      MdmPushEndpoint.create!(mdm_device: d, token: 'tok1', push_magic: 'magic1')
    end
  end

  let!(:device2) do
    MdmDevice.create!(udid: 'UDID-2', serial_number: 'SN2').tap do |d|
      MdmPushEndpoint.create!(mdm_device: d, token: 'tok2', push_magic: 'magic2')
    end
  end

  it 'enqueues InstallApplication for selected devices' do
    post "/ipa/#{ipa.id}/install", { device_identifiers: ['UDID-1', 'UDID-2'] }

    expect(last_response).to be_ok
    expect(MdmCommandRequest.where(device_identifier: 'UDID-1').count).to eq(1)
    expect(MdmCommandRequest.where(device_identifier: 'UDID-2').count).to eq(1)
  end

  it 'is a no-op when no devices are selected' do
    expect {
      post "/ipa/#{ipa.id}/install", {}
    }.not_to change { MdmCommandRequest.count }
    expect(last_response).to be_ok
  end

  it 'ignores unknown UDIDs' do
    post "/ipa/#{ipa.id}/install", { device_identifiers: ['UDID-1', 'UNKNOWN'] }
    expect(MdmCommandRequest.where(device_identifier: 'UDID-1').count).to eq(1)
    expect(MdmCommandRequest.where(device_identifier: 'UNKNOWN').count).to eq(0)
  end
end
