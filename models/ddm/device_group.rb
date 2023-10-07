module Ddm
  class DeviceGroup < ActiveRecord::Base
    has_many :items,
      class_name: Ddm::DeviceGroupItem.to_s,
      foreign_key: :ddm_device_group_id

    def self.including(ddm_identifier)
      ids = DeviceGroupItem.where(device_identifier: ddm_identifier).pluck(:ddm_device_group_id)
      where(id: ids)
    end
  end
end
