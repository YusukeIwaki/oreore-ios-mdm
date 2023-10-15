module Ddm
  class AssetDetail < ActiveRecord::Base
    include ResourceIdentifierResolvable

    belongs_to :asset,
      class_name: Ddm::Asset.to_s,
      foreign_key: :ddm_asset_id
    attribute :payload, :json

    scope :for_fallback, -> { where(target_identifier: nil) }
    scope :for, -> (ddm_identifier) do
      group_names = DeviceGroup.including(ddm_identifier).pluck(:name)
      group_names.sort!
      # smaller is higher priority
      priorities = { nil => group_names.size, ddm_identifier => -1 }.merge(group_names.each_with_index.to_h)
      found_detail_by_asset_id = {}
      AssetDetail.where(target_identifier: [*group_names, ddm_identifier]).or(AssetDetail.for_fallback).select(:id, :ddm_asset_id, :target_identifier).each do |detail|
        priority = priorities[detail.target_identifier]
        if (existing = found_detail_by_asset_id[detail.ddm_asset_id])
          if priority < priorities[existing.target_identifier]
            found_detail_by_asset_id[detail.ddm_asset_id] = detail
          end
        else
          found_detail_by_asset_id[detail.ddm_asset_id] = detail
        end
      end

      where(id: found_detail_by_asset_id.values.map(&:id))
    end
  end
end
