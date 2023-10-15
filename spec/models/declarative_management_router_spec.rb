require 'spec_helper'

describe DeclarativeManagementRouter do
  before do
    Ddm::Activation.delete_all
    Ddm::ActivationTarget.delete_all
    Ddm::Configuration.delete_all
    Ddm::Asset.delete_all
    Ddm::AssetDetail.delete_all
    Ddm::Management.delete_all
    Ddm::ManagementDetail.delete_all
    Ddm::PublicAsset.delete_all
    Ddm::PublicAssetDetail.delete_all
    Ddm::DeviceGroup.delete_all
    Ddm::DeviceGroupItem.delete_all
  end

  let(:serial_number) { SecureRandom.hex(8) }
  let(:mdm_device) {
    MdmDevice.create!(
      udid: SecureRandom.uuid,
      serial_number: serial_number,
      imei: '351111112222223',
    )
  }
  let(:router) { DeclarativeManagementRouter.new(mdm_device) }

  context 'example' do
    around do |example|
      Dir.mktmpdir do |dir|
        @tmpdir = dir
        example.run
      end
    end

    before do
      # Device group
      group1 = Ddm::DeviceGroup.create!(name: 'group1')
      group1.items.create!(device_identifier: 'SERIALNUMBER1')
      group1.items.create!(device_identifier: serial_number)
      group2 = Ddm::DeviceGroup.create!(name: 'group2')
      group2.items.create!(device_identifier: 'SERIALNUMBER2')

      # Configuration
      Ddm::Configuration.create!(
        name: 'group1_member_gmail',
        type: 'com.apple.configuration.account.google',
        payload: {
          VisibleName: 'Google Mail',
          UserIdentityAssetReference: '@asset/group1_member_gmail',
        }
      )
      Ddm::Configuration.create!(
        name: 'status_report_subscription',
        type: 'com.apple.configuration.management.status-subscriptions',
        payload: {
          StatusItems: [
            { Name: 'device.identifier.serial-number' },
            { Name: 'device.identifier.udid' },
            { Name: 'device.operating-system.build-version' },
            { Name: 'device.operating-system.family' },
            { Name: 'device.operating-system.marketing-name' },
            { Name: 'device.operating-system.supplemental.build-version' },
            { Name: 'device.operating-system.supplemental.extra-version' },
            { Name: 'device.operating-system.version' },
            { Name: 'management.declarations' },
          ],
        }
      )
      Ddm::Configuration.create!(
        name: 'wifi_office_profile',
        type: 'com.apple.configuration.legacy',
        payload: {
          ProfileURL: "@public/wifi_office",
        }
      )
      Ddm::Configuration.create!(
        name: 'wifi_guest_profile',
        type: 'com.apple.configuration.legacy',
        payload: {
          ProfileURL: "@public/wifi_guest",
        }
      )
      Ddm::Configuration.create!(
        name: 'wifi_EAPTest_profile',
        type: 'com.apple.configuration.legacy',
        payload: {
          ProfileURL: "@public/wifi_EAPTest",
        }
      )

      # Activation
      Ddm::Activation.create!(
        name: 'apply_status_report_subscription_and_guest_wifi',
        type: 'com.apple.activation.simple',
        payload: {
          StandardConfigurations: [
            '@configuration/status_report_subscription',
            '@configuration/wifi_guest_profile',
          ]
        }
      ).targets.create!(target_identifier: nil)
      Ddm::Activation.create!(
        name: 'apply_wifi_office_profile',
        type: 'com.apple.activation.simple',
        payload: {
          Predicate: "@status(device.model.family) == 'iPhone'",
          StandardConfigurations: [
            '@configuration/wifi_office_profile',
          ]
        }
      ).targets.create!(target_identifier: 'group1')
      Ddm::Activation.create!(
        name: 'apply_group1_member_gmail',
        type: 'com.apple.activation.simple',
        payload: {
          StandardConfigurations: [
            '@configuration/group1_member_gmail',
          ]
        }
      ).targets.create!(target_identifier: 'group1')
      Ddm::Activation.create!(
        name: 'apply_wifi_EAPTest_profile',
        type: 'com.apple.activation.simple',
        payload: {
          StandardConfigurations: [
            '@configuration/wifi_EAPTest_profile',
          ]
        }
      ).targets.create!(target_identifier: serial_number)

      # Asset
      group1_member_gmail = Ddm::Asset.create!(
        name: 'group1_member_gmail',
        type: 'com.apple.asset.useridentity',
      )
      group1_member_gmail.details.create!(
        target_identifier: nil,
        payload: {
          FullName: 'default',
          EmailAddress: 'default@gmail.com',
        }
      )
      group1_member_gmail.details.create!(
        target_identifier: 'SERIALNUMBER1',
        payload: {
          FullName: 'member1',
          EmailAddress: 'member1@gmail.com',
        }
      )
      group1_member_gmail.details.create!(
        target_identifier: serial_number,
        payload: {
          FullName: 'user',
          EmailAddress: 'user@gmail.com',
        }
      )
      group1_member_gmail.details.create!(
        target_identifier: 'group1',
        payload: {
          FullName: 'Group1',
          EmailAddress: 'group1@gmail.com',
        }
      )

      # Public asset
      %w(office guest EAPTest).each do |name|
        xml = <<~XML
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>PayloadDisplayName</key>
          <string>Wi-Fi (#{name})</string>
        </dict>
        </plist>
        XML
        file = File.join(@tmpdir, "wifi_#{name}.mobileconfig")
        File.write(file, xml)

        wifi_office_profile = Ddm::PublicAsset.create!(name: "wifi_#{name}")
        wifi_office_profile.details.create!(
          target_identifier: nil,
          asset_file: Rack::Test::UploadedFile.new(file, 'application/x-apple-aspen-config'),
        )
      end

      # Management
      age = Ddm::Management.create!(
        name: 'age',
        type: 'com.apple.management.properties',
      )
      age.details.create!(
        target_identifier: nil,
        payload: { age: 18 },
      )
      age.details.create!(
        target_identifier: serial_number,
        payload: { age: 23 },
      )
      age.details.create!(
        target_identifier: 'group1',
        payload: { age: 22 },
      )
    end

    it 'should generate declaration' do
      tokens = router.handle_request('tokens', nil)
      expect(tokens[:SyncTokens][:Timestamp]).to match(/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\+[0-9][0-9]:00/)

      declaration_items = router.handle_request('declaration-items', nil)
      expect(declaration_items[:DeclarationsToken]).to eq(tokens[:SyncTokens][:DeclarationsToken])

      expect(declaration_items[:Declarations][:Activations].count).to eq(4)
      declaration_items[:Declarations][:Activations].each_with_index do |activation, i|
        aggregate_failures("Activation##{i}-#{activation[:Identifier]}") do
          expect(activation[:ServerToken]).not_to be_nil

          detail = router.handle_request("declaration/activation/#{activation[:Identifier]}", nil)
          expect(detail[:Identifier]).to eq(activation[:Identifier])
          expect(detail[:ServerToken]).not_to be_nil
        end
      end

      expect(declaration_items[:Declarations][:Configurations].count).to eq(5)
      declaration_items[:Declarations][:Configurations].each_with_index do |configuration, i|
        expect(configuration[:ServerToken]).not_to be_nil

        detail = router.handle_request("declaration/configuration/#{configuration[:Identifier]}", nil)
        expect(detail[:Identifier]).to eq(configuration[:Identifier])
        expect(detail[:ServerToken]).not_to be_nil
      end

      expect(declaration_items[:Declarations][:Assets].count).to eq(1)
      declaration_items[:Declarations][:Assets].each_with_index do |asset, i|
        expect(asset[:ServerToken]).not_to be_nil

        detail = router.handle_request("declaration/asset/#{asset[:Identifier]}", nil)
        expect(detail[:Identifier]).to eq(asset[:Identifier])
        expect(detail[:ServerToken]).not_to be_nil
      end

      expect(declaration_items[:Declarations][:Management].count).to eq(1)
      declaration_items[:Declarations][:Management].each_with_index do |management, i|
        expect(management[:ServerToken]).not_to be_nil

        detail = router.handle_request("declaration/management/#{management[:Identifier]}", nil)
        expect(detail[:Identifier]).to eq(management[:Identifier])
        expect(detail[:ServerToken]).not_to be_nil
      end
    end
  end
end
