module Command
  class Base
    def request_payload
      raise NotImplementedError, 'request_payload must be implemented'
    end

    def command_uuid
      @command_uuid ||= SecureRandom.uuid
    end
  end
end
