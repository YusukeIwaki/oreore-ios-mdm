require 'spec_helper'

describe 'POST /ddm/configurations', logged_in: true do
  before {
    Ddm::Configuration.delete_all
  }

  it 'should create a new configuration' do
    post '/ddm/configurations', {
      name: 'test1',
      type: 'com.apple.configuration.hoge',
      payload: <<~YAML
      ---
      ProfileURL: https://example.com/profiles/test1.mobileconfig
      Test: "@public/test1"
      YAML
    }
    configuration = Ddm::Configuration.find_by!(name: 'test1')
    expect(configuration.type).to eq('com.apple.configuration.hoge')
    expect(configuration.payload.keys).to contain_exactly('ProfileURL', 'Test')
    expect(configuration.payload['ProfileURL']).to eq('https://example.com/profiles/test1.mobileconfig')
    expect(configuration.payload['Test']).to eq('@public/test1')
  end

  it 'should raise error if name is not given' do
    expect {
      post '/ddm/configurations', {
        name: '',
        type: 'com.apple.configuration.hoge',
        payload: "---\nProfileURL: https://example.com/profiles/test1.mobileconfig\n"
      }
    }.to raise_error
    expect(Ddm::Configuration.count).to eq(0)
  end

  it 'should raise error if type is not given' do
    expect {
      post '/ddm/configurations', {
        name: 'hoge',
        type: '',
        payload: "---\nProfileURL: https://example.com/profiles/test1.mobileconfig\n"
      }
    }.to raise_error
    expect(Ddm::Configuration.count).to eq(0)
  end

  it 'should raise error if payload is blank' do
    expect {
      post '/ddm/configurations', {
        name: 'hoge',
        type: 'com.apple.configuration.hoge',
        payload: ''
      }
    }.to raise_error
    expect(Ddm::Configuration.count).to eq(0)
  end
end

describe 'POST /ddm/configurations/:id', logged_in: true do
  before {
    Ddm::Configuration.delete_all
  }

  it 'should update a configuration' do
    configuration = Ddm::Configuration.create!(name: 'test1', type: 'com.apple.configuration.hoge', payload: { 'ProfileURL' => 'https://example.com/profiles/test1.mobileconfig' })
    post "/ddm/configurations/#{configuration.id}", {
      name: 'test2',
      type: 'com.apple.configuration.fuga',
      payload: <<~YAML
      ---
      ProfileURL: https://example.com/profiles/test2.mobileconfig
      Test: "@public/test2"
      YAML
    }
    configuration.reload
    expect(configuration.name).to eq('test1') # not updated even if name is given
    expect(configuration.type).to eq('com.apple.configuration.fuga')
    expect(configuration.payload.keys).to contain_exactly('ProfileURL', 'Test')
    expect(configuration.payload['ProfileURL']).to eq('https://example.com/profiles/test2.mobileconfig')
    expect(configuration.payload['Test']).to eq('@public/test2')
  end

  it 'should raise error if payload is blank' do
    configuration = Ddm::Configuration.create!(name: 'test1', type: 'com.apple.configuration.hoge', payload: { 'ProfileURL' => 'https://example.com/profiles/test1.mobileconfig' })
    expect {
      post "/ddm/configurations/#{configuration.id}", {
        name: 'test2',
        type: 'com.apple.configuration.fuga',
        payload: ''
      }
    }.to raise_error
    configuration.reload
    expect(configuration.name).to eq('test1')
    expect(configuration.type).to eq('com.apple.configuration.hoge')
    expect(configuration.payload.keys).to contain_exactly('ProfileURL')
  end

  it 'should raise error if id is wrong' do
    configuration = Ddm::Configuration.create!(name: 'test1', type: 'com.apple.configuration.hoge', payload: { 'ProfileURL' => 'https://example.com/profiles/test1.mobileconfig' })
    expect {
      post '/ddm/configurations/hoge', {
        name: 'test1',
        type: 'com.apple.configuration.fuga',
        payload: "---"
      }
    }.to raise_error
    configuration.reload
    expect(configuration.name).to eq('test1')
    expect(configuration.type).to eq('com.apple.configuration.hoge')
    expect(configuration.payload.keys).to contain_exactly('ProfileURL')
  end
end
