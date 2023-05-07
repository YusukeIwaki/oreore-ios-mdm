require 'spec_helper'

RSpec.describe MobileConfig do
  it 'should generate random uuid without uuid parameter' do
    mobileconfig = MobileConfig.new(display_name: "test", contents: [])
    expect(mobileconfig.uuid).not_to be_blank
  end

  it 'should not generate a random uuid when uuid parameter is given' do
    mobileconfig = MobileConfig.new(uuid: "uuid", display_name: "test", contents: [])
    expect(mobileconfig.uuid).to eq('uuid')
  end

  it 'should extend contents' do
    klass = Data.define(:id) do
      def build_payload
        { id: id }
      end
    end

    mobileconfig = MobileConfig.new(display_name: "test", contents: [klass.new(id: 10), klass.new(id: 1)])
    payload = mobileconfig.build_payload
    expect(payload[:PayloadContent]).to eq([{ id: 10 }, { id: 1 }])
  end
end
