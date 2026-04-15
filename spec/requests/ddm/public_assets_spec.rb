require 'spec_helper'

describe 'POST /ddm/public_assets/:id/details/:detail_id/delete', logged_in: true do
  before {
    Ddm::PublicAssetDetail.delete_all
    Ddm::PublicAsset.delete_all
  }

  it 'deletes the public asset detail' do
    public_asset = Ddm::PublicAsset.create!(name: 'test')
    detail = public_asset.details.create!(asset_file: StringIO.new('test content'))

    expect {
      post "/ddm/public_assets/#{public_asset.id}/details/#{detail.id}/delete"
    }.to change { Ddm::PublicAssetDetail.count }.by(-1)

    expect(last_response).to be_redirect
    follow_redirect!
    expect(last_request.path).to eq("/ddm/public_assets/#{public_asset.id}/details")
  end

  it 'returns 404 if detail does not exist' do
    public_asset = Ddm::PublicAsset.create!(name: 'test')

    expect {
      post "/ddm/public_assets/#{public_asset.id}/details/999999/delete"
    }.to raise_error(ActiveRecord::RecordNotFound)
  end

  it 'returns 404 if public asset does not exist' do
    expect {
      post '/ddm/public_assets/999999/details/1/delete'
    }.to raise_error(ActiveRecord::RecordNotFound)
  end
end
