require 'spec_helper'

describe 'POST /ddm/assets', logged_in: true do
  before {
    Ddm::AssetDetail.delete_all
    Ddm::Asset.delete_all
  }

  it 'creates a new asset' do
    expect {
      post '/ddm/assets', {
        name: 'test',
        type: 'com.apple.asset.credential.identity',
      }
    }.to change { Ddm::Asset.count }.by(1)
    asset = Ddm::Asset.last
    expect(asset.name).to eq('test')
    expect(asset.type).to eq('com.apple.asset.credential.identity')
  end

  it 'should raise error if name is not given' do
    expect {
      post '/ddm/assets', {
        name: '',
        type: 'com.apple.asset.useridentity',
      }
    }.to raise_error
    expect(Ddm::Asset.count).to eq(0)
  end

  it 'should raise error if type is not given' do
    expect {
      post '/ddm/assets', {
        name: 'test',
        type: '',
      }
    }.to raise_error
    expect(Ddm::Asset.count).to eq(0)
  end

  it 'should raise error if name is dupplicated' do
    Ddm::Asset.create!(name: 'test', type: 'com.apple.asset.credential.identity')
    expect {
      post '/ddm/assets', {
        name: 'test',
        type: 'com.apple.asset.useridentity',
      }
    }.to raise_error
    expect(Ddm::Asset.count).to eq(1)
  end
end

describe 'POST /ddm/assets/:id/details', logged_in: true do
  before {
    Ddm::AssetDetail.delete_all
    Ddm::Asset.delete_all
  }

  it 'creates a new detail (FALLBACK)' do
    asset = Ddm::Asset.create!(name: 'test', type: 'com.apple.asset.credential.identity')

    expect {
      post "/ddm/assets/#{asset.id}/details", {
        target_identifier: '',
        type: 'com.apple.credential.hoge', # not used
        payload: <<~YAML
        ---
        FullName: John Doe
        EmailAddress: test1@example.com
        YAML
      }
    }.to change { Ddm::AssetDetail.where(asset: asset).count }.by(1)

    asset.reload
    detail = asset.details.last
    expect(detail.target_identifier).to be_nil
    expect(asset.type).to eq('com.apple.asset.credential.identity') # not changed
    expect(detail.payload.keys).to contain_exactly('FullName', 'EmailAddress')
    expect(detail.payload['FullName']).to eq('John Doe')
    expect(detail.payload['EmailAddress']).to eq('test1@example.com')
  end

  it 'creates a new detail (serial number)' do
    asset = Ddm::Asset.create!(name: 'test', type: 'com.apple.asset.credential.identity')

    expect {
      post "/ddm/assets/#{asset.id}/details", {
        target_identifier: 'SERIALNUMBER1',
        type: 'com.apple.credential.hoge', # not used
        payload: <<~YAML
        ---
        FullName: John Doe
        EmailAddress: test1@example.com
        YAML
      }
    }.to change { Ddm::AssetDetail.where(asset: asset).count }.by(1)

    asset.reload
    detail = asset.details.last
    expect(detail.target_identifier).to eq('SERIALNUMBER1')
    expect(asset.type).to eq('com.apple.asset.credential.identity') # not changed
    expect(detail.payload.keys).to contain_exactly('FullName', 'EmailAddress')
    expect(detail.payload['FullName']).to eq('John Doe')
    expect(detail.payload['EmailAddress']).to eq('test1@example.com')
  end

  it 'should update detail if already exists (FALLBACK)' do
    asset = Ddm::Asset.create!(name: 'test', type: 'com.apple.asset.credential.identity')
    detail = Ddm::AssetDetail.create!(asset: asset, target_identifier: nil, payload: { 'FullName' => 'John Doe', 'EmailAddress' => 'test1@example.com' })

    post "/ddm/assets/#{asset.id}/details", {
      target_identifier: '',
      type: 'com.apple.credential.hoge', # not used
      payload: <<~YAML
      ---
      FullName: Hoge
      EmailAddress: hoge@example.com
      YAML
    }

    asset.reload
    expect(asset.details.count).to eq(1)
    detail.reload
    expect(detail.target_identifier).to be_nil
    expect(asset.type).to eq('com.apple.asset.credential.identity') # not changed
    expect(detail.payload.keys).to contain_exactly('FullName', 'EmailAddress')
    expect(detail.payload['FullName']).to eq('Hoge')
    expect(detail.payload['EmailAddress']).to eq('hoge@example.com')
  end

  it 'should update detail if already exists (serial number)' do
    asset = Ddm::Asset.create!(name: 'test', type: 'com.apple.asset.credential.identity')
    detail = Ddm::AssetDetail.create!(asset: asset, target_identifier: 'SERIALNUMBER1', payload: { 'FullName' => 'John Doe', 'EmailAddress' => 'test1@example.com' })

    post "/ddm/assets/#{asset.id}/details", {
      target_identifier: 'SERIALNUMBER1',
      type: 'com.apple.credential.hoge', # not used
      payload: <<~YAML
      ---
      FullName: Hoge
      EmailAddress: hoge@example.com
      YAML
    }

    asset.reload
    expect(asset.details.count).to eq(1)
    detail.reload
    expect(detail.target_identifier).to eq('SERIALNUMBER1')
    expect(asset.type).to eq('com.apple.asset.credential.identity') # not changed
    expect(detail.payload.keys).to contain_exactly('FullName', 'EmailAddress')
    expect(detail.payload['FullName']).to eq('Hoge')
    expect(detail.payload['EmailAddress']).to eq('hoge@example.com')
  end
end
