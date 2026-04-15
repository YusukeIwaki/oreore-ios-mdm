require 'spec_helper'

describe 'POST /rts/wifi_profiles/:id/delete', logged_in: true do
  before {
    Rts::WifiProfile.delete_all
  }

  it 'deletes the wifi profile' do
    wifi_profile = Rts::WifiProfile.create!(name: 'test', asset_file: StringIO.new('<xml>test</xml>'))

    expect {
      post "/rts/wifi_profiles/#{wifi_profile.id}/delete"
    }.to change { Rts::WifiProfile.count }.by(-1)

    expect(last_response).to be_redirect
    follow_redirect!
    expect(last_request.path).to eq('/rts/wifi_profiles')
  end

  it 'returns 404 if wifi profile does not exist' do
    expect {
      post '/rts/wifi_profiles/999999/delete'
    }.to raise_error(ActiveRecord::RecordNotFound)
  end
end
