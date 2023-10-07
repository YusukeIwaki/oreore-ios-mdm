module Ddm
  class DeviceGroupItem < ActiveRecord::Base
    belongs_to :device_group,
      class_name: Ddm::DeviceGroup.to_s,
      foreign_key: :ddm_device_group_id
  end
end
