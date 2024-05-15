class PushClient
  class Response < Struct.new(:status, :apns_id, :body)
    def self.from(apnotic_response)
      new(
        apnotic_response.status.to_i,
        apnotic_response.headers["apns-id"],
        apnotic_response.body.presence || {},
      )
    end
  end

  # @param [MdmPushEndpoint|ByodPushEndpoint] push_endpoint
  # @return [Response]
  def send_mdm_notification(push_endpoint)
    notification = Apnotic::MdmNotification.new(
                    token: push_endpoint.token,
                    push_magic: push_endpoint.push_magic)
    Response.from(apnotic_connection.push(notification))
  end

  private def apnotic_connection
    return @apnotic_connection if @apnotic_connection

    pkcs12, password = PushCertificate.from_env._top_secrets
    if pkcs12.certificate.not_after < Time.current
      raise "Push certificate expired"
    end
    @apnotic_connection = Apnotic::Connection.new(
      cert_path: StringIO.new(pkcs12.to_der),
      cert_pass: password,
    )
  end
end
