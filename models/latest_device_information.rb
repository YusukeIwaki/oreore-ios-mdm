class LatestDeviceInformation
  include Mongoid::Document

  field :udid, type: String

  field :AwaitingConfiguration, type: Boolean
  field :BuildVersion, type: String
  field :DeviceName, type: String
  field :IMEI, type: String
  field :IsNetworkTethered, type: Boolean
  field :MDMOptions, type: Hash
  field :MEID, type: String
  field :Model, type: String
  field :ModelName, type: String
  field :ModelNumber, type: String
  field :OSVersion, type: String
  field :ProductName, type: String
  field :SerialNumber, type: String
  field :SupplementalBuildVersion, type: String
  field :UDID, type: String

  index(
    { udid: 1 },
    { unique: true },
  )
end
