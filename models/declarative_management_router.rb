class DeclarativeManagementRouter
  # @param [String] ddm_identifier
  def initialize(ddm_identifier)
    @ddm_identifier = ddm_identifier
  end

  class RouteNotFound < StandardError ; end

  # @param [String] endpoint
  # @param [Hash|nil] data
  # @return [Hash]
  def handle_request(endpoint, data)
    case endpoint
    when 'status'
      handle_status(data)
    when 'declaration-items'
      handle_declaration_items
    when 'tokens'
      handle_tokens
    when /^declaration\/activation\/(.+)$/
      handle_activation($1)
    when /^declaration\/configuration\/(.+)$/
      handle_configuration($1)
    when /^declaration\/asset\/(.+)$/
      handle_asset($1)
    when /^declaration\/management\/(.+)$/
      handle_management($1)
    else
      raise RouteNotFound, "Not Found"
    end
  end

  # @param [Hash] data
  # @return [Hash]
  private def handle_status(data)
  end

  # @return [Hash]
  private def handle_declaration_items
    declaration.declaration_items
  end

  # @return [Hash]
  private def handle_tokens
    declaration.tokens
  end

  # @return [Hash]
  private def handle_activation(identifier)
    declaration.activation_detail_for(identifier) or raise RouteNotFound, "No activation found with identifier #{identifier}"
  end

  # @return [Hash]
  private def handle_configuration(identifier)
    declaration.configuration_detail_for(identifier) or raise RouteNotFound, "No configuration found with identifier #{identifier}"
  end

  # @return [Hash]
  private def handle_asset(identifier)
    declaration.asset_detail_for(identifier) or raise RouteNotFound, "No asset found with identifier #{identifier}"
  end

  # @return [Hash]
  private def handle_management(identifier)
    declaration.management_detail_for(identifier) or raise RouteNotFound, "No management found with identifier #{identifier}"
  end

  # @return [DeclarativeManagement::Declaration]
  private def declaration
    DeclarativeManagement::Declaration.new(@ddm_identifier)
  end
end
