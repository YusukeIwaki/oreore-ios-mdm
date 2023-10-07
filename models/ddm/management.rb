module Ddm
  class Management < ActiveRecord::Base
    has_many :details,
      class_name: Ddm::ManagementDetail.to_s,
      foreign_key: :ddm_management_id

    def self.details_for(ddm_identifier)
      ManagementDetail.for(ddm_identifier).preload(:management)
    end
  end
end
