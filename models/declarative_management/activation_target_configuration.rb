module DeclarativeManagement
  class ActivationTargetConfiguration < ActiveRecord::Base
    belongs_to :activation
    belongs_to :configuration, polymorphic: true,
      foreign_key: :configuration_identifier,
      primary_key: :identifier
  end
end
