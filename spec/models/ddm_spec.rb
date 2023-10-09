require 'spec_helper'

# just for checking model's relation methods
RSpec.describe 'declarative device management', skip: ENV['CI'] do
  it 'should define DeviceGroup' do
    Ddm::DeviceGroup.delete_all
    Ddm::DeviceGroupItem.delete_all

    device_group = Ddm::DeviceGroup.create!(name: 'group1')
    device_group.items.create!(device_identifier: 'SERIALNUMBER1')
    device_group = Ddm::DeviceGroup.create!(name: 'group2')
    device_group.items.create!(device_identifier: 'SERIALNUMBER1')

    items = Ddm::DeviceGroupItem.where(device_identifier: 'SERIALNUMBER1')
    expect(items.count).to eq(2)
    expect(items.map(&:device_group).map(&:name)).to contain_exactly('group1', 'group2')
  end

  it 'should filter groups with DeviceGroup.including' do
    Ddm::DeviceGroup.delete_all
    Ddm::DeviceGroupItem.delete_all

    group_def = {
      '1.hoge' => %w(SERIALNUMBER1 SERIALNUMBER2),
      '2.fuga' => %w(SERIALNUMBER1 SERIALNUMBER3),
      '3.piyo' => %w(SERIALNUMBER2 SERIALNUMBER3),
    }
    group_def.to_a.shuffle.each do |name, device_identifiers|
      device_group = Ddm::DeviceGroup.create!(name: name)
      device_identifiers.each do |device_identifier|
        device_group.items.create!(device_identifier: device_identifier)
      end
    end

    expect(Ddm::DeviceGroup.including('serialnumber1')).to be_empty
    expect(Ddm::DeviceGroup.including('serialnumber')).to be_empty
    groups = Ddm::DeviceGroup.including('SERIALNUMBER1')
    expect(groups.size).to eq(2)
    expect(groups.map(&:name)).to contain_exactly('1.hoge', '2.fuga')
    groups = Ddm::DeviceGroup.including('SERIALNUMBER2')
    expect(groups.size).to eq(2)
    expect(groups.map(&:name)).to contain_exactly('1.hoge', '3.piyo')
  end

  it 'should define an Activation' do
    Ddm::Configuration.delete_all
    Ddm::Activation.delete_all
    Ddm::ActivationTarget.delete_all

    configuration = Ddm::Configuration.create!(
      name: 'configuration1',
      type: 'com.apple.configuration.legacy',
      payload: { ProfileURL: '@public/wifi1.mobileconfig' },
    )
    activation = Ddm::Activation.create!(
      name: 'activation1',
      type: 'com.apple.activation.simple',
      payload: {
        Predicate: "@status(device.model.family) == 'iPhone'",
        StandardConfigurations: [
          '@configuration/configuration1'
        ]
      },
    )
    activation_target = Ddm::ActivationTarget.create!(
      activation: activation,
      target_identifier: 'SERIALNUMBER1',
    )

    activations = Ddm::Activation.for('SERIALNUMBER1')
    expect(activations.count).to eq(1)
    expect(activations.first.name).to eq('activation1')
  end

  it 'should collect all matched activation with ActivationTarget.for' do
    Ddm::DeviceGroup.delete_all
    Ddm::DeviceGroupItem.delete_all

    group_def = {
      '1.hoge' => %w(SERIALNUMBER1 SERIALNUMBER2),
      '2.fuga' => %w(SERIALNUMBER1 SERIALNUMBER3),
      '3.piyo' => %w(SERIALNUMBER2 SERIALNUMBER3),
    }
    group_def.to_a.shuffle.each do |name, device_identifiers|
      device_group = Ddm::DeviceGroup.create!(name: name)
      device_identifiers.each do |device_identifier|
        device_group.items.create!(device_identifier: device_identifier)
      end
    end

    Ddm::Configuration.delete_all
    Ddm::Activation.delete_all
    Ddm::ActivationTarget.delete_all

    target_def = [
      nil,
      '1.hoge',
      '2.fuga',
      '3.piyo',
      'SERIALNUMBER1',
    ]
    target_def.shuffle.each_with_index do |target_identifier, i|
      activation = Ddm::Activation.create!(
        name: "activation-#{SecureRandom.hex(4)}",
        type: 'com.apple.activation.simple',
        payload: {
          StandardConfigurations: [
            "@configuration/configuration-#{i}"
          ]
        },
      )
      Ddm::ActivationTarget.create!(
        activation: activation,
        target_identifier: target_identifier,
      )
    end

    targets = Ddm::ActivationTarget.for('SERIALNUMBER1')
    expect(targets.count).to eq(4)
    expect(targets.map(&:target_identifier)).to contain_exactly('1.hoge', '2.fuga', 'SERIALNUMBER1', nil)
  end

  it 'should define a Asset' do
    Ddm::Asset.delete_all
    Ddm::AssetDetail.delete_all

    asset = Ddm::Asset.create!(name: 'member_gmail')
    asset.details.create!(
      target_identifier: 'SERIALNUMBER1',
      type: 'com.apple.asset.useridentity',
      payload: {
        FullName: 'Serial1User',
        EmailAddress: 'seri1user@gmail.com',
      },
    )

    asset_details = Ddm::Asset.details_for('SERIALNUMBER1')
    expect(asset_details.count).to eq(1)
    expect(asset_details.first.name).to eq('member_gmail')
    expect(asset_details.first.payload['FullName']).to eq('Serial1User')
    expect(asset_details.first.payload['EmailAddress']).to eq('seri1user@gmail.com')
  end

  describe 'Asset.details_for' do
    before do
      Ddm::Asset.delete_all
      Ddm::AssetDetail.delete_all
      Ddm::DeviceGroup.delete_all
      Ddm::DeviceGroupItem.delete_all
    end

    it 'should return details with priority SERIAL or group or fallback' do
      group = Ddm::DeviceGroup.create!(name: 'group')
      group.items.create!(device_identifier: 'SERIALNUMBER2')

      asset = Ddm::Asset.create!(name: 'member_gmail1')
      asset.details.create!(
        target_identifier: 'SERIALNUMBER1',
        type: 'com.apple.asset.useridentity',
        payload: { FullName: 'user1', EmailAddress: 'user1@gmail.com' },
      )
      details = Ddm::Asset.details_for('SERIALNUMBER1')
      expect(details.size).to eq(1)
      expect(details.first.name).to eq('member_gmail1')
      expect(details.first.payload['FullName']).to eq('user1')

      asset = Ddm::Asset.create!(name: 'member_gmail2')
      asset.details.create!(
        target_identifier: 'group',
        type: 'com.apple.asset.useridentity',
        payload: { FullName: 'group', EmailAddress: 'group@gmail.com' },
      )
      details = Ddm::Asset.details_for('SERIALNUMBER2')
      expect(details.size).to eq(1)
      expect(details.first.name).to eq('member_gmail2')
      expect(details.first.payload['FullName']).to eq('group')

      expect(Ddm::Asset.details_for('SERIALNUMBER3')).to be_empty

      asset = Ddm::Asset.create!(name: 'member_gmail3')
      asset.details.create!(
        target_identifier: nil,
        type: 'com.apple.asset.useridentity',
        payload: { FullName: 'fallback', EmailAddress: 'fallback@gmail.com' },
      )
      details = Ddm::Asset.details_for('SERIALNUMBER3')
      expect(details.size).to eq(1)
      expect(details.first.name).to eq('member_gmail3')
      expect(details.first.payload['FullName']).to eq('fallback')
    end

    it 'should return detail with priority identifier > group > fallback' do
      group_def = {
        'group1' => %w(SERIALNUMBER2 SERIALNUMBER3),
        'group2' => %w(SERIALNUMBER1 SERIALNUMBER3),
      }
      group_def.each do |name, device_identifiers|
        device_group = Ddm::DeviceGroup.create!(name: name)
        device_identifiers.each do |device_identifier|
          device_group.items.create!(device_identifier: device_identifier)
        end
      end

      asset_def = {
        nil => ['fallback', 'fallback@gmail.com'],
        'group1' => ['group1', 'group1@gmail.com'],
        'group2' => ['group2', 'group2@gmail.com'],
        'group3' => ['group3', 'group3@gmail.com'],
        'SERIALNUMBER1' => ['user1', 'user1@gmail.com'],
        'SERIALNUMBER2' => ['user2', 'user2@gmail.com'],
      }
      asset = Ddm::Asset.create!(name: 'member_gmail')
      asset_def.to_a.shuffle.each do |target_identifier, info|
        asset.details.create!(
          target_identifier: target_identifier,
          type: 'com.apple.asset.useridentity',
          payload: { FullName: info.first, EmailAddress: info.last },
        )
      end

      details = Ddm::Asset.details_for('SERIALNUMBER1')
      expect(details.size).to eq(1)
      expect(details.first.payload['FullName']).to eq('user1')

      details = Ddm::Asset.details_for('SERIALNUMBER3')
      expect(details.size).to eq(1)
      expect(details.first.payload['FullName']).to eq('group1')

      details = Ddm::Asset.details_for('SERIALNUMBER4')
      expect(details.size).to eq(1)
      expect(details.first.payload['FullName']).to eq('fallback')
    end

    it 'should return multiple assets' do
      group = Ddm::DeviceGroup.create!(name: 'group1')
      group.items.create!(device_identifier: 'SERIALNUMBER1')

      asset1 = Ddm::Asset.create!(name: 'gmail1')
      asset1.details.create!(
        target_identifier: nil,
        type: 'com.apple.asset.useridentity',
        payload: { FullName: 'default', EmailAddress: 'default@gmail.com' },
      )

      asset2 = Ddm::Asset.create!(name: 'gmail2')
      asset2.details.create!(
        target_identifier: 'group1',
        type: 'com.apple.asset.useridentity',
        payload: { FullName: 'group1', EmailAddress: 'group1@gmail.com' },
      )

      asset3 = Ddm::Asset.create!(name: 'gmail3')
      asset3.details.create!(
        target_identifier: 'SERIALNUMBER1',
        type: 'com.apple.asset.useridentity',
        payload: { FullName: 'user1', EmailAddress: 'user1@gmail.com' },
      )

      details = Ddm::Asset.details_for('SERIALNUMBER1')
      expect(details.size).to eq(3)
      expect(details.map(&:name)).to contain_exactly('gmail1', 'gmail2', 'gmail3')
      expect(details.map(&:payload).map { |payload| payload['EmailAddress'] }).to contain_exactly('default@gmail.com', 'group1@gmail.com', 'user1@gmail.com')
    end
  end

  it 'should define Management' do
    Ddm::Management.delete_all
    Ddm::ManagementDetail.delete_all

    management = Ddm::Management.create!(name: 'age')
    management.details.create!(
      target_identifier: 'SERIALNUMBER1',
      type: 'com.apple.management.properties',
      payload: { age: 31 },
    )

    management_details = Ddm::Management.details_for('SERIALNUMBER1')
    expect(management_details.count).to eq(1)
    expect(management_details.first.name).to eq('age')
    expect(management_details.first.payload['age']).to eq(31)
  end

  describe 'Management.details_for' do
    before do
      Ddm::Management.delete_all
      Ddm::ManagementDetail.delete_all
      Ddm::DeviceGroup.delete_all
      Ddm::DeviceGroupItem.delete_all
    end

    it 'should return details with priority identifier > group > fallback' do
      group_def = {
        'group1' => %w(SERIALNUMBER2 SERIALNUMBER3),
        'group2' => %w(SERIALNUMBER1 SERIALNUMBER3),
      }
      group_def.each do |name, device_identifiers|
        device_group = Ddm::DeviceGroup.create!(name: name)
        device_identifiers.each do |device_identifier|
          device_group.items.create!(device_identifier: device_identifier)
        end
      end

      management_def = {
        nil => ['fallback', 18],
        'group1' => ['group1', 21],
        'group2' => ['group2', 22],
        'group3' => ['group3', 23],
        'SERIALNUMBER1' => ['user1', 51],
        'SERIALNUMBER2' => ['user2', 52],
      }
      management = Ddm::Management.create!(name: 'age')
      management_def.to_a.shuffle.each do |target_identifier, info|
        management.details.create!(
          target_identifier: target_identifier,
          type: 'com.apple.management.properties',
          payload: { age: info.last },
        )
      end

      details = Ddm::Management.details_for('SERIALNUMBER1')
      expect(details.size).to eq(1)
      expect(details.first.payload['age']).to eq(51)

      details = Ddm::Management.details_for('SERIALNUMBER3')
      expect(details.size).to eq(1)
      expect(details.first.payload['age']).to eq(21)

      details = Ddm::Management.details_for('SERIALNUMBER4')
      expect(details.size).to eq(1)
      expect(details.first.payload['age']).to eq(18)
    end

    it 'should return multiple management properties' do
      group = Ddm::DeviceGroup.create!(name: 'group1')
      group.items.create!(device_identifier: 'SERIALNUMBER1')

      management1 = Ddm::Management.create!(name: 'age')
      management1.details.create!(
        target_identifier: nil,
        type: 'com.apple.management.properties',
        payload: { age: 18 },
      )

      management2 = Ddm::Management.create!(name: 'organization')
      management2.details.create!(
        target_identifier: 'group1',
        type: 'com.apple.management.properties',
        payload: { organization_unit: 'engineering' },
      )

      management3 = Ddm::Management.create!(name: 'email')
      management3.details.create!(
        target_identifier: 'SERIALNUMBER1',
        type: 'com.apple.management.properties',
        payload: { email: 'user1@gmail.com' },
      )

      details = Ddm::Management.details_for('SERIALNUMBER1')
      expect(details.size).to eq(3)
      expect(details.map(&:name)).to contain_exactly('age', 'organization', 'email')
    end
  end

  it 'should define PublicAsset' do
    Ddm::PublicAsset.delete_all
    Ddm::PublicAssetDetail.delete_all

    Dir.mktmpdir do |dir|
      filepath = File.join(dir, 'test_user1.plist')
      xml = <<~XML
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>PayloadDisplayName</key>
        <string>Oreore MDM configuration</string>
      </dict>
      </plist>
      XML
      File.write(filepath, xml)

      file = Rack::Test::UploadedFile.new(filepath, 'application/x-plist')
      asset = Ddm::PublicAsset.create!(name: 'test.plist')
      asset.details.create!(target_identifier: 'SERIALNUMBER1', asset_file: file)

      uploaded = Ddm::PublicAssetDetail.where(public_asset: asset).last
      expect(uploaded.asset_file.read).to eq(xml)
    end
  end

  describe 'PublicAsset.details_for' do
    before do
      Ddm::PublicAsset.delete_all
      Ddm::PublicAssetDetail.delete_all
      Ddm::DeviceGroup.delete_all
      Ddm::DeviceGroupItem.delete_all
    end

    around do |example|
      Dir.mktmpdir do |dir|
        @tmpdir = dir
        example.run
      end
    end

    it 'should return details with priority identifier > group > fallback' do
      group_def = {
        'group1' => %w(SERIALNUMBER2 SERIALNUMBER3),
        'group2' => %w(SERIALNUMBER1 SERIALNUMBER3),
      }
      group_def.each do |name, device_identifiers|
        device_group = Ddm::DeviceGroup.create!(name: name)
        device_identifiers.each do |device_identifier|
          device_group.items.create!(device_identifier: device_identifier)
        end
      end

      public_asset_def = {
        nil => ['fallback', 'test_fallback.xml'],
        'group1' => ['group1', 'test_group.xml'],
        'group2' => ['group2', 'test_group.xml'],
        'group3' => ['group3', 'test_group.xml'],
        'SERIALNUMBER1' => ['user1', 'test_user.xml'],
        'SERIALNUMBER2' => ['user2', 'test_user.xml'],
      }
      public_asset = Ddm::PublicAsset.create!(name: 'test.plist')
      public_asset_def.to_a.shuffle.each do |target_identifier, info|
        filepath = File.join(@tmpdir, info.last)
        xml = <<~XML
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>PayloadDisplayName</key>
          <string>#{info.first}</string>
        </dict>
        </plist>
        XML
        File.write(filepath, xml)
        public_asset.details.create!(
          target_identifier: target_identifier,
          asset_file: Rack::Test::UploadedFile.new(filepath, 'application/x-plist'),
        )
      end

      details = Ddm::PublicAsset.details_for('SERIALNUMBER1')
      expect(details.size).to eq(1)
      plist = Plist.parse_xml(details.first.asset_file.read)
      expect(plist['PayloadDisplayName']).to eq('user1')

      details = Ddm::PublicAsset.details_for('SERIALNUMBER3')
      expect(details.size).to eq(1)
      plist = Plist.parse_xml(details.first.asset_file.read)
      expect(plist['PayloadDisplayName']).to eq('group1')

      details = Ddm::PublicAsset.details_for('SERIALNUMBER4')
      expect(details.size).to eq(1)
      plist = Plist.parse_xml(details.first.asset_file.read)
      expect(plist['PayloadDisplayName']).to eq('fallback')
    end

    it 'should return multiple public assets' do
      group = Ddm::DeviceGroup.create!(name: 'group1')
      group.items.create!(device_identifier: 'SERIALNUMBER1')

      public_asset_target_def = {
        'test1' => nil,
        'test2' => 'group1',
        'test3' => 'SERIALNUMBER1',
      }
      public_asset_target_def.each do |name, target_identifier|
        filepath = File.join(@tmpdir, "#{name}.plist")
        xml = <<~XML
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>PayloadDisplayName</key>
          <string>#{name}</string>
        </dict>
        </plist>
        XML
        File.write(filepath, xml)
        public_asset = Ddm::PublicAsset.create!(name: "#{name}.plist")
        public_asset.details.create!(
          target_identifier: target_identifier,
          asset_file: Rack::Test::UploadedFile.new(filepath, 'application/x-plist'),
        )
      end

      details = Ddm::PublicAsset.details_for('SERIALNUMBER1')
      expect(details.size).to eq(3)
      expect(details.map(&:name)).to contain_exactly('test1.plist', 'test2.plist', 'test3.plist')
    end
  end
end
