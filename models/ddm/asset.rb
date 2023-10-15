module Ddm
  class Asset < ActiveRecord::Base
    self.inheritance_column = '__no_sti'
    has_many :details,
      class_name: Ddm::AssetDetail.to_s,
      foreign_key: :ddm_asset_id

    def self.details_for(ddm_identifier)
      AssetDetail.for(ddm_identifier).preload(:asset)
    end

    def resource_identifier
      @resource_identifier ||= ResourceIdentifier.new('asset', name)
    end
  end
end
