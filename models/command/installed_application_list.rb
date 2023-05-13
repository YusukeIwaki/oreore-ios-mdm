module Command
  class InstalledApplicationList < Base
    def initialize(managed_apps_only: false)
      @managed_apps_only = managed_apps_only
    end

    # https://github.com/apple/device-management/blob/release/mdm/commands/application.installed.list.yaml
    def request_payload
      {
        CommandUUID: command_uuid,
        Command: {
          Items: [
            'BundleSize',
            'DynamicSize',
            'ExternalVersionIdentifier',
            'HasUpdateAvailable',
            'Identifier',
            'Installing',
            'Name',
            'ShortVersion',
            'Version',
          ],
          ManagedAppsOnly: @managed_apps_only,
          RequestType: 'InstalledApplicationList',
        }
      }
    end
  end
end
