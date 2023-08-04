class MdmCommandHistory < ActiveRecord::Base
  # @param [MdmCommandHandlingRequest] mdm_command_handling_request
  # @param [Hash] response_payload
  # @return [String]
  def self.log_result(mdm_command_handling_request, response_payload)
    create!(
      device_identifier: mdm_command_handling_request.device_identifier,
      request_type: mdm_command_handling_request.request_payload['Command']['RequestType'],
      command_uuid: mdm_command_handling_request.command_uuid,
      request_payload: mdm_command_handling_request.request_payload.to_plist,
      response_payload: response_payload.to_plist,
    )
  end
end
