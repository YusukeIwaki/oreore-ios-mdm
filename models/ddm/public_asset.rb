module Ddm
  class PublicAsset < ActiveRecord::Base
    has_many :details,
      class_name: Ddm::PublicAssetDetail.to_s,
      foreign_key: :ddm_public_asset_id

    def self.details_for(ddm_identifier)
      PublicAssetDetail.for(ddm_identifier).preload(:public_asset)
    end
  end
end
