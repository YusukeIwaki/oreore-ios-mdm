class IpaInstallDispatcher
  Result = Data.define(:enqueued, :push_succeeded, :push_failed) do
    def as_json
      {
        enqueued: enqueued.map { |d| device_to_json(d) },
        push_succeeded: push_succeeded.map { |d| device_to_json(d) },
        push_failed: push_failed.map { |entry|
          device_to_json(entry[:device]).merge(error: entry[:error])
        },
      }
    end

    private

    def device_to_json(device)
      case device
      when MdmDevice
        { kind: 'mdm', udid: device.udid, serial_number: device.serial_number }
      when ByodDevice
        { kind: 'byod', enrollment_id: device.enrollment_id }
      end
    end
  end

  def initialize(ipa_file:, devices:, push_client: PushClient.new)
    @ipa_file = ipa_file
    @devices = Array(devices)
    @push_client = push_client
  end

  def call
    return Result.new(enqueued: [], push_succeeded: [], push_failed: []) if @devices.empty?

    manifest_url = "#{ENV['MDM_SERVER_BASE_URL']}/ipa/#{@ipa_file.url_encoded_filename}/manifest"

    device_identifiers = @devices.map { |d| device_identifier_for(d) }
    commands = @devices.map { Command::InstallApplication.new(manifest_url: manifest_url) }
    MdmCommandRequest.insert_all!(
      device_identifiers.zip(commands).map do |device_identifier, command|
        {
          device_identifier: device_identifier,
          request_payload: command.request_payload,
        }
      end
    )

    push_succeeded = []
    push_failed = []
    @devices.each do |device|
      endpoint = push_endpoint_for(device)
      unless endpoint
        push_failed << { device: device, error: 'no push endpoint' }
        next
      end
      begin
        @push_client.send_mdm_notification(endpoint)
        push_succeeded << device
      rescue => e
        push_failed << { device: device, error: e.message }
      end
    end

    Result.new(enqueued: @devices, push_succeeded: push_succeeded, push_failed: push_failed)
  end

  private

  def device_identifier_for(device)
    case device
    when MdmDevice then device.udid
    when ByodDevice then device.enrollment_id
    else
      raise ArgumentError, "unsupported device class: #{device.class}"
    end
  end

  def push_endpoint_for(device)
    case device
    when MdmDevice then device.mdm_push_endpoint
    when ByodDevice then device.byod_push_endpoint
    end
  end
end
