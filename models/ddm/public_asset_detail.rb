module Ddm
  class PublicAssetDetail < ActiveRecord::Base
    self.inheritance_column = '__no_sti'
    belongs_to :public_asset,
      class_name: Ddm::PublicAsset.to_s,
      foreign_key: :ddm_public_asset_id
    attribute :path_identifier, :string, default: -> { SecureRandom.hex(128) }

    include AssetFileUploader::Attachment(:asset_file)

    scope :for_fallback, -> { where(target_identifier: nil) }
    scope :for, -> (ddm_identifier) do
      group_names = DeviceGroup.including(ddm_identifier).pluck(:name)
      group_names.sort!
      # smaller is higher priority
      priorities = { nil => group_names.size, ddm_identifier => -1 }.merge(group_names.each_with_index.to_h)
      found_detail_by_asset_id = {}
      PublicAssetDetail.where(target_identifier: [*group_names, ddm_identifier]).or(Ddm::PublicAssetDetail.for_fallback).select(:id, :ddm_public_asset_id, :target_identifier).each do |detail|
        priority = priorities[detail.target_identifier]
        if (existing = found_detail_by_asset_id[detail.ddm_public_asset_id])
          if priority < priorities[existing.target_identifier]
            found_detail_by_asset_id[detail.ddm_public_asset_id] = detail
          end
        else
          found_detail_by_asset_id[detail.ddm_public_asset_id] = detail
        end
      end

      where(id: found_detail_by_asset_id.values.map(&:id))
    end

    def access_url
      uri = URI(asset_file.url)
      if uri.scheme
        uri.to_s
      else
        "#{ENV['MDM_SERVER_BASE_URL']}#{uri}"
      end
    end
  end
end
