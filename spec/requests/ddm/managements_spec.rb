require 'spec_helper'

describe 'POST /ddm/managements', logged_in: true do
  before {
    Ddm::ManagementDetail.delete_all
    Ddm::Management.delete_all
  }

  it 'creates a new management property' do
    expect {
      post '/ddm/managements', {
        name: 'age',
        type: 'com.apple.management.properties',
      }
    }.to change { Ddm::Management.count }.by(1)
    management = Ddm::Management.last
    expect(management.name).to eq('age')
    expect(management.type).to eq('com.apple.management.properties')
  end

  it 'should raise error if name is not given' do
    expect {
      post '/ddm/managements', {
        name: '',
        type: 'com.apple.management.properties',
      }
    }.to raise_error
    expect(Ddm::Management.count).to eq(0)
  end

  it 'should raise error if type is not given' do
    expect {
      post '/ddm/managements', {
        name: 'age',
        type: '',
      }
    }.to raise_error
    expect(Ddm::Management.count).to eq(0)
  end

  it 'should raise error if name is dupplicated' do
    Ddm::Management.create!(name: 'test', type: 'aaa')
    expect {
      post '/ddm/managements', {
        name: 'test',
        type: 'com.apple.management.properties',
      }
    }.to raise_error
    expect(Ddm::Management.count).to eq(1)
  end
end

describe 'POST /ddm/managements/:id/details', logged_in: true do
  before {
    Ddm::ManagementDetail.delete_all
    Ddm::Management.delete_all
  }

  it 'creates a new detail (FALLBACK)' do
    management = Ddm::Management.create!(name: 'test', type: 'com.apple.management.properties')

    expect {
      post "/ddm/managements/#{management.id}/details", {
        target_identifier: '',
        type: 'com.apple.credential.hoge', # not used
        payload: <<~YAML
        ---
        age: 20
        YAML
      }
    }.to change { Ddm::ManagementDetail.where(management: management).count }.by(1)

    management.reload
    detail = management.details.last
    expect(detail.target_identifier).to be_nil
    expect(management.type).to eq('com.apple.management.properties') # not changed
    expect(detail.payload.keys).to contain_exactly('age')
    expect(detail.payload['age']).to eq(20)
  end

  it 'creates a new detail (serial number)' do
    management = Ddm::Management.create!(name: 'test', type: 'com.apple.management.properties')

    expect {
      post "/ddm/managements/#{management.id}/details", {
        target_identifier: 'SERIALNUMBER1',
        type: 'com.apple.credential.hoge', # not used
        payload: <<~YAML
        ---
        age: 20
        YAML
      }
    }.to change { Ddm::ManagementDetail.where(management: management).count }.by(1)

    management.reload
    detail = management.details.last
    expect(detail.target_identifier).to eq('SERIALNUMBER1')
    expect(management.type).to eq('com.apple.management.properties') # not changed
    expect(detail.payload.keys).to contain_exactly('age')
    expect(detail.payload['age']).to eq(20)
  end

  it 'should update detail if already exists (FALLBACK)' do
    management = Ddm::Management.create!(name: 'test', type: 'com.apple.management.properties')
    detail = Ddm::ManagementDetail.create!(management: management, target_identifier: nil, payload: { 'age' => 20 })

    post "/ddm/managements/#{management.id}/details", {
      target_identifier: '',
      type: 'com.apple.credential.hoge', # not used
      payload: <<~YAML
      ---
      age: 30
      YAML
    }

    management.reload
    expect(management.details.count).to eq(1)
    detail.reload
    expect(detail.target_identifier).to be_nil
    expect(management.type).to eq('com.apple.management.properties') # not changed
    expect(detail.payload.keys).to contain_exactly('age')
    expect(detail.payload['age']).to eq(30)
  end

  it 'should update detail if already exists (serial number)' do
    management = Ddm::Management.create!(name: 'test', type: 'com.apple.management.properties')
    detail = Ddm::ManagementDetail.create!(management: management, target_identifier: 'SERIALNUMBER1', payload: { 'age' => 20 })

    post "/ddm/managements/#{management.id}/details", {
      target_identifier: 'SERIALNUMBER1',
      type: 'com.apple.credential.hoge', # not used
      payload: <<~YAML
      ---
      age: 30
      YAML
    }

    management.reload
    expect(management.details.count).to eq(1)
    detail.reload
    expect(detail.target_identifier).to eq('SERIALNUMBER1')
    expect(management.type).to eq('com.apple.management.properties') # not changed
    expect(detail.payload.keys).to contain_exactly('age')
    expect(detail.payload['age']).to eq(30)
  end
end
