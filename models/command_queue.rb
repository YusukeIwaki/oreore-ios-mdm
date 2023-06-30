class CommandQueue
  def self.for_device(mdm_device)
    unless mdm_device.is_a?(MdmDevice)
      raise ArgumentError, "mdm_device must be a MdmDevice, but was #{mdm_device.class}"
    end
    new(mdm_device.id)
  end

  def initialize(mdm_device_id)
    @mdm_device_id = mdm_device_id
  end

  # @param [Command|MdmCommandHandlingRequest] command
  def <<(command)
    MdmCommandRequest.create!(
      mdm_device_id: @mdm_device_id,
      request_payload: command.request_payload,
    )
  end

  def self.bulk_insert(mdm_device_ids, commands)
    request_payloads = commands.map(&:request_payload)
    MdmCommandRequest.insert_all!(
      mdm_device_ids.product(request_payloads).map do |mdm_device_id, request_payload|
        {
          mdm_device_id: mdm_device_id,
          request_payload: request_payload,
        }
      end
    )
  end

  def dequeue
    mdm_command_request = MdmCommandRequest.find_by(mdm_device_id: @mdm_device_id)
    return nil unless mdm_command_request

    MdmCommandRequest.transaction do
      MdmCommandHandlingRequest.create!(
        mdm_device_id: mdm_command_request.mdm_device_id,
        command_uuid: mdm_command_request.request_payload['CommandUUID'],
        request_payload: mdm_command_request.request_payload,
      )
      mdm_command_request.destroy!
    end

    mdm_command_request.request_payload
  end

  def dequeue_handling_request(command_uuid:)
    MdmCommandHandlingRequest.find_by!(
      mdm_device_id: @mdm_device_id,
      command_uuid: command_uuid,
    ).tap(&:destroy!)
  end

  def size
    MdmCommandRequest.where(mdm_device_id: @mdm_device_id).count
  end

  def clear
    MdmCommandRequest.transaction do
      MdmCommandRequest.where(mdm_device_id: @mdm_device_id).destroy_all
      MdmCommandHandlingRequest.where(mdm_device_id: @mdm_device_id).destroy_all
    end
  end
end
