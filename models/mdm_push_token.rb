class MdmPushToken
  include Mongoid::Document

  field :udid, type: String
  field :token, type: String
  field :push_magic, type: String
  field :unlock_token, type: String
end
