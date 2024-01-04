module Ddm
  class DeviceGroup < ActiveRecord::Base
    validates :name, presence: true, uniqueness: true

    has_many :items,
      class_name: Ddm::DeviceGroupItem.to_s,
      foreign_key: :ddm_device_group_id

    def self.including(ddm_identifier)
      ids = DeviceGroupItem.where(device_identifier: ddm_identifier).pluck(:ddm_device_group_id)
      where(id: ids)
    end

    def self.target_options
      Enumerator.new do |out|
        order(:name).pluck(:name).each do |device_group_name|
          out << device_group_name
        end
        MdmDevice.order(:serial_number).pluck(:serial_number).each do |serial_number|
          out << serial_number
        end
      end
    end
  end
end
