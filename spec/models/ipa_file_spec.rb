require 'spec_helper'

describe IpaFile do
  before {
    IpaFile.delete_all
  }

  describe '#metadata' do
    it 'returns metadata with bundle_identifier and download_url' do
      ipa = IpaFile.create!(
        filename: 'example.ipa',
        bundle_identifier: 'com.example.app',
        asset_file: StringIO.new('fake ipa content'),
      )

      metadata = ipa.metadata
      expect(metadata.bundle_identifier).to eq('com.example.app')
      expect(metadata.download_url).to be_a(String)
    end
  end

  describe IpaFile::Metadata do
    describe '#as_manifest' do
      it 'generates a valid plist manifest' do
        metadata = IpaFile::Metadata.new(
          bundle_identifier: 'com.example.app',
          download_url: 'https://example.com/app.ipa',
        )

        manifest = metadata.as_manifest
        parsed = Plist.parse_xml(manifest, marshal: false)

        expect(parsed['items'].length).to eq(1)
        item = parsed['items'][0]
        expect(item['assets'][0]['kind']).to eq('software-package')
        expect(item['assets'][0]['url']).to eq('https://example.com/app.ipa')
        expect(item['metadata']['bundle-identifier']).to eq('com.example.app')
        expect(item['metadata']['kind']).to eq('software')
      end
    end
  end

  describe 'IPA upload to InstallApplication command payload' do
    before {
      ENV['MDM_SERVER_BASE_URL'] = 'https://mdm.example.com'
    }

    after {
      ENV.delete('MDM_SERVER_BASE_URL')
    }

    it 'generates an InstallApplication command with manifest URL pointing to the uploaded IPA' do
      ipa = IpaFile.create!(
        filename: 'MyApp.ipa',
        bundle_identifier: 'com.example.myapp',
        asset_file: StringIO.new('fake ipa content'),
      )

      manifest_url = "#{ENV['MDM_SERVER_BASE_URL']}/ipa/#{ipa.url_encoded_filename}/manifest"
      command = Command::InstallApplication.new(manifest_url: manifest_url)
      payload = command.request_payload

      expect(payload[:Command][:RequestType]).to eq('InstallApplication')
      expect(payload[:Command][:ManifestURL]).to eq('https://mdm.example.com/ipa/MyApp.ipa/manifest')
      expect(payload[:CommandUUID]).to be_a(String)

      # ManifestURL が返すmanifestの中身も検証
      manifest = ipa.metadata.as_manifest
      parsed_manifest = Plist.parse_xml(manifest, marshal: false)
      item = parsed_manifest['items'][0]

      expect(item['metadata']['bundle-identifier']).to eq('com.example.myapp')
      expect(item['assets'][0]['kind']).to eq('software-package')
      expect(item['assets'][0]['url']).to include('asset_files/')
    end

    it 'generates a valid plist that can be sent as an MDM command' do
      ipa = IpaFile.create!(
        filename: 'Another App.ipa',
        bundle_identifier: 'jp.example.another-app',
        asset_file: StringIO.new('fake ipa content'),
      )

      manifest_url = "#{ENV['MDM_SERVER_BASE_URL']}/ipa/#{ipa.url_encoded_filename}/manifest"
      command = Command::InstallApplication.new(manifest_url: manifest_url)
      plist_xml = command.request_payload.to_plist

      # plistとしてparse可能であること
      parsed = Plist.parse_xml(plist_xml, marshal: false)
      expect(parsed['Command']['RequestType']).to eq('InstallApplication')
      expect(parsed['Command']['ManifestURL']).to eq('https://mdm.example.com/ipa/Another%20App.ipa/manifest')
      expect(parsed['CommandUUID']).to be_present
    end
  end
end
