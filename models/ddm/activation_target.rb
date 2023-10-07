module Ddm
  class ActivationTarget < ActiveRecord::Base
    belongs_to :activation,
      class_name: Ddm::Activation.to_s,
      foreign_key: :ddm_activation_id

    scope :applied_for_all_devices, -> { where(target_identifier: nil) }
    scope :for, -> (ddm_identifier) do
      device_groups = DeviceGroup.joins(:items).
        where(ddm_device_group_items: { device_identifier: ddm_identifier })

      target_identifiers = device_groups.pluck(:name)
      target_identifiers << ddm_identifier

      where(target_identifier: target_identifiers).or(applied_for_all_devices)
    end
  end
end
