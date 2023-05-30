class CommandQueue
  def initialize(device_identifier)
    @device_identifier = device_identifier
  end

  # @param [Command|MdmCommandHandlingRequest] command
  def <<(command)
    MdmCommandRequest.create!(
      device_identifier: @device_identifier,
      request_payload: command.request_payload,
    )
  end

  def self.bulk_insert(device_identifiers, commands)
    request_payloads = commands.map(&:request_payload)
    MdmCommandRequest.insert_all!(
      device_identifiers.product(request_payloads).map do |device_identifier, request_payload|
        {
          device_identifier: device_identifier,
          request_payload: request_payload,
        }
      end
    )
  end

  def dequeue
    mdm_command_request = MdmCommandRequest.find_by(device_identifier: @device_identifier)
    return nil unless mdm_command_request

    MdmCommandRequest.transaction do
      MdmCommandHandlingRequest.create!(
        device_identifier: mdm_command_request.device_identifier,
        command_uuid: mdm_command_request.request_payload['CommandUUID'],
        request_payload: mdm_command_request.request_payload,
      )
      mdm_command_request.destroy!
    end

    mdm_command_request.request_payload
  end

  def dequeue_handling_request(command_uuid:)
    MdmCommandHandlingRequest.find_by!(
      device_identifier: @device_identifier,
      command_uuid: command_uuid,
    ).tap(&:destroy!)
  end

  def size
    MdmCommandRequest.where(device_identifier: @device_identifier).count
  end

  def clear
    MdmCommandRequest.transaction do
      MdmCommandRequest.where(device_identifier: @device_identifier).destroy_all
      MdmCommandHandlingRequest.where(device_identifier: @device_identifier).destroy_all
    end
  end
end
