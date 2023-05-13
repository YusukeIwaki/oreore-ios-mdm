module Command
  class DeviceInformation < Base
    # https://github.com/apple/device-management/blob/release/mdm/commands/information.device.yaml
    def request_payload
      {
        CommandUUID: command_uuid,
        Command: {
          RequestType: 'DeviceInformation',
          Queries:[
            'UDID',
            'OrganizationInfo',
            'AwaitingConfiguration',
            'MDMOptions',
            'DeviceName',
            'OSVersion',
            'SupplementalOSVersionExtra',
            'BuildVersion',
            'SupplementalBuildVersion',
            'ModelName',
            'Model',
            'ModelNumber',
            'IsAppleSilicon',
            'ProductName',
            'SerialNumber',
            'IMEI',
            'MEID',
            'HostName',
            'IsNetworkTethered',
          ],
        }
      }
    end
  end
end
