class DeclarativeManagementRouter
  # @param [String] device_identifier such as UDID.
  def initialize(device_identifier)
    @device_identifier = device_identifier
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
    DeclarativeManagement::Declaration.new(@device_identifier).declaration_items
  end

  # @return [Hash]
  private def handle_tokens
    DeclarativeManagement::Token.new(@device_identifier).tokens
  end

  # @return [Hash]
  private def handle_activation(identifier)
    activation = DeclarativeManagement::Activation.find_by!(identifier: identifier)
    activation.declaration_payload.detail
  end

  # @return [Hash]
  private def handle_configuration(identifier)
    configuration = DeclarativeManagement::ActivationTargetConfiguration.
                      find_by!(configuration_identifier: identifier).configuration
    configuration.declaration_payload.detail
  end

  # @return [Hash]
  private def handle_asset(identifier)
    asset = DeclarativeManagement::UserIdentityAsset.find_by(identifier: identifier)
    asset.declaration_payload.detail
  end

  # @return [Hash]
  private def handle_management(identifier)
    management = DeclarativeManagement::ManagementProperty.find_by(identifier: identifier)
    management.declaration_payload.detail
  end
end
