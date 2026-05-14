require 'spec_helper'

describe 'API v1' do
  before do
    ENV['MDM_API_TOKEN'] = 'test-token-123'
    ENV['MDM_SERVER_BASE_URL'] = 'https://example.com'
  end

  after do
    ENV.delete('MDM_API_TOKEN')
    ENV.delete('MDM_SERVER_BASE_URL')
  end

  def auth_header
    { 'HTTP_AUTHORIZATION' => 'Bearer test-token-123' }
  end

  describe 'authentication' do
    it 'rejects requests without a Bearer token' do
      get '/api/v1/devices'
      expect(last_response.status).to eq(401)
    end

    it 'rejects requests with a wrong token' do
      get '/api/v1/devices', {}, { 'HTTP_AUTHORIZATION' => 'Bearer wrong' }
      expect(last_response.status).to eq(401)
    end

    it 'returns 503 when MDM_API_TOKEN is not set' do
      ENV.delete('MDM_API_TOKEN')
      get '/api/v1/devices', {}, auth_header
      expect(last_response.status).to eq(503)
    end
  end

  describe 'GET /api/v1/devices' do
    it 'lists MDM devices' do
      MdmDevice.create!(udid: 'UDID-A', serial_number: 'SN-A')
      MdmDevice.create!(udid: 'UDID-B', serial_number: 'SN-B')

      get '/api/v1/devices', {}, auth_header
      expect(last_response).to be_ok
      data = JSON.parse(last_response.body)
      udids = data['mdm_devices'].map { |d| d['udid'] }
      expect(udids).to include('UDID-A', 'UDID-B')
    end
  end

  describe 'POST /api/v1/ipa' do
    before { IpaFile.delete_all }

    it 'uploads an IPA file' do
      expect {
        post '/api/v1/ipa', {
          bundle_identifier: 'com.example.app',
          asset_file: Rack::Test::UploadedFile.new(StringIO.new('fake ipa'), 'application/octet-stream', false, original_filename: 'a.ipa'),
        }, auth_header
      }.to change { IpaFile.count }.by(1)

      expect(last_response.status).to eq(201)
      data = JSON.parse(last_response.body)
      expect(data['filename']).to eq('a.ipa')
      expect(data['manifest_url']).to eq('https://example.com/ipa/a.ipa/manifest')
    end

    it 'returns 400 when required params are missing' do
      post '/api/v1/ipa', {}, auth_header
      expect(last_response.status).to eq(400)
    end
  end

  describe 'GET /api/v1/ipa and /api/v1/ipa/:id' do
    before { IpaFile.delete_all }

    let!(:ipa) do
      IpaFile.create!(
        filename: 'example.ipa',
        bundle_identifier: 'com.example.app',
        asset_file: StringIO.new('fake ipa'),
      )
    end

    it 'lists IPA files' do
      get '/api/v1/ipa', {}, auth_header
      expect(last_response).to be_ok
      data = JSON.parse(last_response.body)
      expect(data['ipa_files'].map { |i| i['filename'] }).to eq(['example.ipa'])
    end

    it 'returns the IPA detail' do
      get "/api/v1/ipa/#{ipa.id}", {}, auth_header
      expect(last_response).to be_ok
      data = JSON.parse(last_response.body)
      expect(data['filename']).to eq('example.ipa')
    end

    it 'returns 404 for an unknown id' do
      get '/api/v1/ipa/999999', {}, auth_header
      expect(last_response.status).to eq(404)
    end
  end

  describe 'POST /api/v1/ipa/:id/install' do
    let!(:ipa) do
      IpaFile.create!(
        filename: 'example.ipa',
        bundle_identifier: 'com.example.app',
        asset_file: StringIO.new('fake ipa'),
      )
    end

    let!(:device) do
      MdmDevice.create!(udid: 'UDID-1', serial_number: 'SN1').tap do |d|
        MdmPushEndpoint.create!(mdm_device: d, token: 'tok', push_magic: 'magic')
      end
    end

    it 'enqueues InstallApplication and returns the dispatch result' do
      post "/api/v1/ipa/#{ipa.id}/install", { udids: ['UDID-1', 'UNKNOWN'] }.to_json,
           auth_header.merge('CONTENT_TYPE' => 'application/json')

      expect(last_response).to be_ok
      data = JSON.parse(last_response.body)
      expect(data['enqueued'].map { |d| d['udid'] }).to eq(['UDID-1'])
      expect(data['push_succeeded'].map { |d| d['udid'] }).to eq(['UDID-1'])
      expect(data['push_failed']).to be_empty
      expect(data['unknown_udids']).to eq(['UNKNOWN'])

      expect(MdmCommandRequest.where(device_identifier: 'UDID-1').count).to eq(1)
    end

    it 'returns 404 when the IPA does not exist' do
      post '/api/v1/ipa/999999/install', { udids: [] }.to_json,
           auth_header.merge('CONTENT_TYPE' => 'application/json')
      expect(last_response.status).to eq(404)
    end

    it 'returns 400 for invalid JSON body' do
      post "/api/v1/ipa/#{ipa.id}/install", 'not-json',
           auth_header.merge('CONTENT_TYPE' => 'application/json')
      expect(last_response.status).to eq(400)
    end
  end
end
