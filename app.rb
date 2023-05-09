require 'bundler'
Bundler.require :default, (ENV['RACK_ENV'] || :development).to_sym

loader = Zeitwerk::Loader.new
loader.push_dir('./lib')
loader.push_dir('./models')
loader.setup

require 'sinatra/base'

Tilt.register('rb', Tilt::RubyTemplate)
Sinatra::Templates.prepend(SinatraTemplatesExtension)

class App < Sinatra::Base
  use SinatraStdoutLogging
  helpers do
    def verbose_print_request
      lines = []
      request.env.each do |key, value|
        if key.start_with?('HTTP_')
          lines << "#{key}: #{value}"
        end
      end
      request.body.rewind
      lines << request.body.read
      request.body.rewind

      logger.info(lines.join("\n"))
    end
  end

  get '/MDMServiceConfig' do
    verbose_print_request
    halt 404, 'Not supported.'
  end

  get '/mdm/appleconfigurator' do # AppleConfigurator: add server
    verbose_print_request
    'OK'
  end

  post '/mdm/appleconfigurator' do # AppleConfigurator: iOS provisioning: Remote Management
    verbose_print_request
    content_type 'application/x-apple-aspen-config'
    rb :'mdm.mobileconfig'
  end

  get '/mdm.mobileconfig' do
    content_type 'application/x-apple-aspen-config'
    rb :'mdm.mobileconfig'
  end

  post '/mdm.mobileconfig' do
    verbose_print_request
    content_type 'application/x-apple-aspen-config'
    rb :'mdm.mobileconfig'
  end

  put '/mdm/checkin' do
    verbose_print_request

    plist = Plist.parse_xml(request.body.read, marshal: false)
    if plist.delete('Topic') != PushCertificate.from_env.topic
      halt 403, 'Topic mismatch'
    end

    message_handler =
      case plist['MessageType']
      when 'Authenticate'
        CheckinRequest::AuthenticateMessageHandler.new(plist)
      when 'TokenUpdate'
        CheckinRequest::TokenUpdateMessageHandler.new(plist)
      when 'CheckOut'
        CheckinRequest::CheckOutMessageHandler.new(plist)
      else
        raise 'Unknown MessageType'
      end

    message_handler.handle

    content_type 'text/plain'
    'OK'
  end

  put '/mdm/command' do
    verbose_print_request
  end
end
