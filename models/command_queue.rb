class CommandQueue
  def initialize(device_identifier)
    @device_identifier = device_identifier
  end

  def <<(command)
    MdmCommandRequest.create!(
      device_identifier: @device_identifier,
      request_payload: command.request_payload,
    )
  end

  def self.bulk_insert(device_identifiers, commands)
    request_payloads = commands.map(&:request_payload)
    MdmCommandRequest.collection.insert_many(
      device_identifiers.product(request_payloads).map do |device_identifier, request_payload|
        {
          device_identifier: device_identifier,
          request_payload: request_payload,
        }
      end
    )
  end

  def dequeue
    mdm_command_request = MdmCommandRequest.where(device_identifier: @device_identifier).first
    return nil unless mdm_command_request

    mdm_command_request.start_handling
    mdm_command_request.request_payload
  end

  def find_handling_request(command_uuid:)
    MdmCommandHandlingRequest.find_by!(
      device_identifier: @device_identifier,
      'request_payload.CommandUUID': command_uuid,
    )
  end

  def size
    MdmCommandRequest.where(device_identifier: @device_identifier).count
  end

  def clear
    MdmCommandRequest.where(device_identifier: @device_identifier).destroy_all
    MdmCommandHandlingRequest.where(device_identifier: @device_identifier).destroy_all
  end
end
