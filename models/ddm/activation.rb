module Ddm
  class Activation < ActiveRecord::Base
    self.inheritance_column = '__no_sti'
    attribute :payload, :json

    has_many :targets,
      class_name: Ddm::ActivationTarget.to_s,
      foreign_key: :ddm_activation_id

    def self.for(ddm_identifier)
      ids = ActivationTarget.for(ddm_identifier).distinct.pluck(:ddm_activation_id)
      where(id: ids)
    end

    def resource_identifier
      @resource_identifier ||= ResourceIdentifier.new('activation', name)
    end
  end
end
