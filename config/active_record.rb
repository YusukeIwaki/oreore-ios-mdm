ActiveRecord::Base.logger = Logger.new($stdout)
ActiveRecord.verbose_query_logs = true

require 'active_support/core_ext'
Time.zone_default = Time.find_zone!("Asia/Tokyo")
ActiveRecord::Base.time_zone_aware_attributes = true
ActiveRecord.default_timezone = :local

class ActiveRecordTypePlist < ActiveModel::Type::Value
  include ActiveModel::Type::Helpers::Mutable

  def type
    :plist
  end

  def deserialize(value)
    return value unless value.is_a?(::String)
    Plist.parse_xml(value, marshal: false) rescue nil
  end

  def serialize(value)
    value.to_plist unless value.nil?
  end

  def changed_in_place?(raw_old_value, new_value)
    deserialize(raw_old_value) != new_value
  end

  def accessor
    ActiveRecord::Store::StringKeyedHashAccessor
  end
end
ActiveRecord::Type.register(:plist, ActiveRecordTypePlist)
