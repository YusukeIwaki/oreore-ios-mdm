class PushClient
  # @param [PushCertificate] push_certificate
  def initialize
    pkcs12, password = PushCertificate.from_env._top_secrets
    @apnotic_connection = Apnotic::Connection.new(
      cert_path: StringIO.new(pkcs12.to_der),
      cert_pass: password,
    )
  end

  class Response
    def initialize(apnotic_response)
      @status = apnotic_response.status
      @bodu = body == '' ? {} : apnotic_response.body
    end
    attr_reader :status, :body
  end

  # @param [MdmPushEndpoint|ByodPushEndpoint] push_endpoint
  # @return [Response]
  def send_mdm_notification(push_endpoint)
    notification = Apnotic::MdmNotification.new(
                    token: push_endpoint.token,
                    push_magic: push_endpoint.push_magic)
    @apnotic_connection.push(notification)
  end
end
