class MdmPushEndpoint < ActiveRecord::Base
  belongs_to :mdm_device

  def self.create_with_mdm_device(udid:, token:, push_magic:, unlock_token:)
    ActiveRecord::Base.transaction do
      mdm_device = MdmDevice.find_or_create_by!(udid: udid)
      MdmPushEndpoint.find_or_initialize_by(mdm_device_id: mdm_device.id).update!(
        token: token,
        push_magic: push_magic,
        unlock_token: unlock_token,
      )
    end
  end
end
