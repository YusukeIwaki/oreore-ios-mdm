module Ddm
  class DeviceGroup < ActiveRecord::Base
    has_many :items,
      class_name: Ddm::DeviceGroupItem.to_s,
      foreign_key: :ddm_device_group_id

    def self.including(ddm_identifier)
      ids = DeviceGroupItem.where(device_identifier: ddm_identifier).pluck(:ddm_device_group_id)
      where(id: ids)
    end

    def self.display_sort_map
      Enumerator.new do |out|
        out << nil
        preload(:items).each do |group|
          out << group.name
          group.items.each do |item|
            out << item.device_identifier
          end
        end
      end.to_a
    end

    def self.priority_sort_map
      Enumerator.new do |out|
        group_names = []
        preload(:items).each do |group|
          group_names << group.name
          group.items.each do |item|
            out << item.device_identifier
          end
        end
        group_names.each(&out)
        out << nil
      end.to_a
    end
  end
end
