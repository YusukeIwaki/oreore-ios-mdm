module Ddm
  class Configuration < ActiveRecord::Base
    include ResourceIdentifierResolvable

    self.inheritance_column = '__no_sti'
    attribute :payload, :json

    def resource_identifier
      @resource_identifier ||= ResourceIdentifier.new('configuration', name)
    end
  end
end
