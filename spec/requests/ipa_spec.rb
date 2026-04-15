require 'spec_helper'

describe 'POST /ipa', logged_in: true do
  before {
    IpaFile.delete_all
  }

  it 'creates a new IPA file' do
    expect {
      post '/ipa', {
        bundle_identifier: 'com.example.app',
        asset_file: Rack::Test::UploadedFile.new(StringIO.new('fake ipa content'), 'application/octet-stream', false, original_filename: 'example.ipa'),
      }
    }.to change { IpaFile.count }.by(1)

    ipa = IpaFile.last
    expect(ipa.filename).to eq('example.ipa')
    expect(ipa.bundle_identifier).to eq('com.example.app')
  end
end

describe 'POST /ipa/:id/delete', logged_in: true do
  before {
    IpaFile.delete_all
  }

  it 'deletes the IPA file' do
    ipa = IpaFile.create!(
      filename: 'example.ipa',
      bundle_identifier: 'com.example.app',
      asset_file: StringIO.new('fake ipa content'),
    )

    expect {
      post "/ipa/#{ipa.id}/delete"
    }.to change { IpaFile.count }.by(-1)

    expect(last_response).to be_redirect
    follow_redirect!
    expect(last_request.path).to eq('/ipa')
  end

  it 'returns 404 if IPA file does not exist' do
    expect {
      post '/ipa/999999/delete'
    }.to raise_error(ActiveRecord::RecordNotFound)
  end
end

describe 'GET /ipa/:filename/manifest' do
  before {
    IpaFile.delete_all
    ENV['MDM_SERVER_BASE_URL'] = 'https://example.com'
  }

  after {
    ENV.delete('MDM_SERVER_BASE_URL')
  }

  it 'returns a valid plist manifest with correct structure' do
    ipa = IpaFile.create!(
      filename: 'example.ipa',
      bundle_identifier: 'com.example.app',
      asset_file: StringIO.new('fake ipa content'),
    )

    get "/ipa/#{ipa.url_encoded_filename}/manifest"

    expect(last_response).to be_ok

    parsed = Plist.parse_xml(last_response.body, marshal: false)
    expect(parsed['items'].length).to eq(1)

    item = parsed['items'][0]
    expect(item['assets'].length).to eq(1)
    expect(item['assets'][0]['kind']).to eq('software-package')
    expect(item['assets'][0]['url']).to include('asset_files/')

    expect(item['metadata']['bundle-identifier']).to eq('com.example.app')
    expect(item['metadata']['kind']).to eq('software')
    expect(item['metadata']['title']).to eq('Download com.example.app')
  end
end
