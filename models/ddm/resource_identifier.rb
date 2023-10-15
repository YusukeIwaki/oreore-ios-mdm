module Ddm
  class ResourceIdentifier
    def initialize(resource_type, resource_name)
      @basename = resource_name
      @reference_name = "@#{resource_type}/#{resource_name}"
      @digest = Digest::UUID.uuid_v5(Digest::UUID::OID_NAMESPACE, @reference_name)
    end

    attr_reader :basename, :reference_name, :digest
  end
end
