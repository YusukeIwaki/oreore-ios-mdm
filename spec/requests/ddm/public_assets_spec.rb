require 'spec_helper'
require 'tmpdir'

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

describe 'POST /ddm/public_assets/:id/delete', logged_in: true do
  before {
    Ddm::PublicAssetDetail.delete_all
    Ddm::PublicAsset.delete_all
  }

  around do |example|
    Dir.mktmpdir do |dir|
      @dir = dir
      example.run
    end
  end

  def uploaded_file(name, content)
    filepath = File.join(@dir, name)
    File.write(filepath, content)
    Rack::Test::UploadedFile.new(filepath, 'application/x-plist')
  end

  it 'should delete a public asset, its details, and the blobs stored in Azure Blob' do
    public_asset = Ddm::PublicAsset.create!(name: 'test_profile')
    detail1 = public_asset.details.create!(target_identifier: nil, asset_file: uploaded_file('a.plist', 'AAA'))
    detail2 = public_asset.details.create!(target_identifier: 'SERIALNUMBER1', asset_file: uploaded_file('b.plist', 'BBB'))

    # the actual files (Azure Blob resources) must exist before deletion
    file1 = detail1.reload.asset_file
    file2 = detail2.reload.asset_file
    expect(file1.exists?).to be(true)
    expect(file2.exists?).to be(true)

    expect {
      post "/ddm/public_assets/#{public_asset.id}/delete"
    }.to change { Ddm::PublicAsset.count }.by(-1)
      .and change { Ddm::PublicAssetDetail.count }.by(-2)
    expect(last_response).to be_redirect

    expect(Ddm::PublicAsset.exists?(public_asset.id)).to be(false)
    expect(Ddm::PublicAssetDetail.where(ddm_public_asset_id: public_asset.id).count).to eq(0)

    # the related Azure Blob resources must be removed as well
    expect(file1.exists?).to be(false)
    expect(file2.exists?).to be(false)
  end

  it 'should raise error if id is wrong' do
    Ddm::PublicAsset.create!(name: 'test_profile')
    expect {
      post '/ddm/public_assets/hoge/delete'
    }.to raise_error
    expect(Ddm::PublicAsset.count).to eq(1)
  end
end
