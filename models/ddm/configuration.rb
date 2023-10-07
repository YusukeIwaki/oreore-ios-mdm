module Ddm
  class Configuration < ActiveRecord::Base
    self.inheritance_column = '__no_sti'
    attribute :payload, :json
  end
end
