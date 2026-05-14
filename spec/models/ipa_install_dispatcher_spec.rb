require 'spec_helper'

RSpec.describe IpaInstallDispatcher do
  before do
    ENV['MDM_SERVER_BASE_URL'] = 'https://example.com'
  end

  after do
    ENV.delete('MDM_SERVER_BASE_URL')
  end

  let(:ipa) do
    IpaFile.create!(
      filename: 'example.ipa',
      bundle_identifier: 'com.example.app',
      asset_file: StringIO.new('fake ipa content'),
    )
  end

  def create_mdm_device(udid:, serial_number:, with_push: true)
    device = MdmDevice.create!(udid: udid, serial_number: serial_number)
    if with_push
      MdmPushEndpoint.create!(
        mdm_device: device,
        token: SecureRandom.hex(16),
        push_magic: SecureRandom.uuid,
      )
    end
    device
  end

  it 'enqueues an InstallApplication command per device with unique CommandUUIDs' do
    d1 = create_mdm_device(udid: 'UDID-1', serial_number: 'SN1')
    d2 = create_mdm_device(udid: 'UDID-2', serial_number: 'SN2')

    result = described_class.new(ipa_file: ipa, devices: [d1, d2]).call

    expect(result.enqueued).to match_array([d1, d2])
    expect(result.push_succeeded).to match_array([d1, d2])
    expect(result.push_failed).to be_empty

    payloads = MdmCommandRequest.where(device_identifier: ['UDID-1', 'UDID-2']).to_a
    expect(payloads.size).to eq(2)
    expect(payloads.map { |p| p.request_payload['Command']['RequestType'] }.uniq).to eq(['InstallApplication'])
    uuids = payloads.map { |p| p.request_payload['CommandUUID'] }
    expect(uuids.uniq.size).to eq(2)
    expect(payloads.first.request_payload['Command']['ManifestURL']).to eq(
      'https://example.com/ipa/example.ipa/manifest'
    )
  end

  it 'reports devices without a push endpoint as push_failed but still enqueues' do
    d_with = create_mdm_device(udid: 'UDID-W', serial_number: 'SNW')
    d_without = create_mdm_device(udid: 'UDID-N', serial_number: 'SNN', with_push: false)

    result = described_class.new(ipa_file: ipa, devices: [d_with, d_without]).call

    expect(result.enqueued).to match_array([d_with, d_without])
    expect(result.push_succeeded).to eq([d_with])
    expect(result.push_failed.map { |e| e[:device] }).to eq([d_without])
    expect(MdmCommandRequest.where(device_identifier: 'UDID-N').count).to eq(1)
  end

  it 'catches per-device push errors without affecting other devices' do
    d1 = create_mdm_device(udid: 'UDID-1', serial_number: 'SN1')
    d2 = create_mdm_device(udid: 'UDID-2', serial_number: 'SN2')

    push_client = PushClient.new
    allow(push_client).to receive(:send_mdm_notification) do |endpoint|
      if endpoint.mdm_device_id == d1.id
        raise 'boom'
      else
        PushClient::Response.new(200, SecureRandom.uuid, {})
      end
    end

    result = described_class.new(ipa_file: ipa, devices: [d1, d2], push_client: push_client).call

    expect(result.enqueued).to match_array([d1, d2])
    expect(result.push_succeeded).to eq([d2])
    expect(result.push_failed.map { |e| e[:device] }).to eq([d1])
    expect(result.push_failed.first[:error]).to eq('boom')
  end

  it 'returns an empty result when no devices are given' do
    result = described_class.new(ipa_file: ipa, devices: []).call
    expect(result.enqueued).to be_empty
    expect(result.push_succeeded).to be_empty
    expect(result.push_failed).to be_empty
    expect(MdmCommandRequest.count).to eq(0)
  end
end
