module Ddm
  class Configuration < ActiveRecord::Base
    include ResourceIdentifierResolvable
    validates :name, presence: true, uniqueness: true
    validates :type, presence: true
    validates :payload, presence: true

    self.inheritance_column = '__no_sti'
    attribute :payload, :json

    def resource_identifier
      @resource_identifier ||= ResourceIdentifier.new('configuration', name)
    end
  end
end
