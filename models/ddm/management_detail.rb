module Ddm
  class ManagementDetail < ActiveRecord::Base
    belongs_to :management,
      class_name: Ddm::Management.to_s,
      foreign_key: :ddm_management_id
    attribute :payload, :json

    scope :for_fallback, -> { where(target_identifier: nil) }
    scope :for, -> (ddm_identifier) do
      group_names = DeviceGroup.including(ddm_identifier).pluck(:name)
      group_names.sort!
      # smaller is higher priority
      priorities = { nil => group_names.size, ddm_identifier => -1 }.merge(group_names.each_with_index.to_h)
      found_detail_by_management_id = {}
      ManagementDetail.where(target_identifier: [*group_names, ddm_identifier]).or(ManagementDetail.for_fallback).select(:id, :ddm_management_id, :target_identifier).each do |detail|
        priority = priorities[detail.target_identifier]
        if (existing = found_detail_by_management_id[detail.ddm_management_id])
          if priority < priorities[existing.target_identifier]
            found_detail_by_management_id[detail.ddm_management_id] = detail
          end
        else
          found_detail_by_management_id[detail.ddm_management_id] = detail
        end
      end

      where(id: found_detail_by_management_id.values.map(&:id))
    end
  end
end
