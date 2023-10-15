module Ddm
  class Management < ActiveRecord::Base
    self.inheritance_column = '__no_sti'
    has_many :details,
      class_name: Ddm::ManagementDetail.to_s,
      foreign_key: :ddm_management_id

    def self.details_for(ddm_identifier)
      ManagementDetail.for(ddm_identifier).preload(:management)
    end

    def resource_identifier
      @resource_identifier ||= case type
      when 'com.apple.management.properties'
        ResourceIdentifier.new('property', name)
      else
        ResourceIdentifier.new('management', name)
      end
    end
  end
end
