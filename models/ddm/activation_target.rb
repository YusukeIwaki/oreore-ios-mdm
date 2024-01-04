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

    def self.display_sorted
      device_identifiers = Set.new
      sort_map = Enumerator.new do |out|
        out << nil
        Ddm::DeviceGroup.preload(:items).each do |group|
          out << group.name
          group.items.each do |item|
            device_identifiers << item.device_identifier
            out << item.device_identifier
          end
        end
      end.to_a
      activation_target_group = Ddm::ActivationTarget.preload(:activation).group_by(&:target_identifier)

      Enumerator.new do |out|
        sort_map.each do |target_identifier|
          activation_target_group[target_identifier]&.each do |activation_target|
            out << activation_target
          end
        end

        Ddm::ActivationTarget.where.not(target_identifier: device_identifiers).each do |activation_target|
          next if activation_target.target_identifier.nil?
          out << activation_target
        end
      end
    end
  end
end
