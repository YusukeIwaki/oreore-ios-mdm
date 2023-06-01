require 'bundler'
Bundler.require :default, (ENV['RACK_ENV'] || :development).to_sym

ActiveRecord::Base.logger = Logger.new($stdout)
ActiveRecord.verbose_query_logs = true

require 'active_support/core_ext'
Time.zone_default = Time.find_zone!("Asia/Tokyo")
ActiveRecord::Base.time_zone_aware_attributes = true
ActiveRecord.default_timezone = :local

loader = Zeitwerk::Loader.new
loader.push_dir('./lib')
loader.push_dir('./models')
loader.setup

require 'omniauth'
require 'omniauth-github'
require 'sinatra/base'

Tilt.register('rb', Tilt::RubyTemplate)
Sinatra::Templates.prepend(SinatraTemplatesExtension)

class App < Sinatra::Base
  enable :sessions
  use OmniAuth::Builder do
    provider :github, ENV['GITHUB_CLIENT_ID'], ENV['GITHUB_CLIENT_SECRET']
  end
  use SinatraStdoutLogging

  helpers do
    def logged_in?
      session[:uid].present?
    end

    def login_required
      unless logged_in?
        session[:return_to] = request.fullpath
        redirect '/'
      end
    end

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

  get '/' do
    if logged_in?
      redirect '/devices'
    else
      erb :'login.html'
    end
  end

  get '/auth/github/callback' do
    url = session.delete(:return_to)
    return_url =
      if url.blank? || url.include?('/auth/')
        '/'
      else
        url
      end

    auth_hash = env["omniauth.auth"]
    username = auth_hash.dig('extra', 'raw_info', 'login')
    if ENV['GITHUB_LOGIN_ALLOWED_USERS'].split(',').include?(username)
      session[:uid] = username
      redirect return_url
    else
      halt 403, 'Access Forbidden'
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

    plist = Plist.parse_xml(request.body.read, marshal: false)
    udid = plist['UDID']
    status = plist['Status']

    if !udid || !status
      halt 400, 'Bad request'
    end

    command_queue = CommandQueue.new(udid)
    command_uuid = plist['CommandUUID']

    unless status == 'Idle'
      begin
        handling_request = command_queue.dequeue_handling_request(command_uuid: command_uuid)
        MdmCommandHistory.log_result(handling_request, plist)
      rescue ActiveRecord::RecordNotFound
        # iOS sometimes retry MDM response.
        # Just ignore if CommandUUID is already handled and not in DB.
        logger.warn("CommandUUID not in DB: #{plist}")
      end
    end

    # Additional response handling here.
    if ['Acknowledged', 'Error'].include?(status) && (request_type = handling_request.request_payload.dig('Command', 'RequestType'))
      if (handler_klass = CommandResponseHandler.const_get("#{request_type}#{status}") rescue nil)
        if status == 'Error'
          handler_klass.new(udid, plist['ErrorChain']).handle
        else
          response_payload = plist.reject do |key, value|
            %w[Status UDID CommandUUID ErrorChain].include?(key)
          end
          handler_klass.new(udid, response_payload).handle
        end
      end
    end

    command = command_queue.dequeue

    if status == 'NotNow' && handling_request
      command_queue << handling_request
    end

    logger.info("command: #{command || 'nil'}")
    if command
      content_type 'application/xml'
      body command.to_plist
    else
      200
    end
  end

  get '/devices' do
    login_required
    erb :'devices/index.html'
  end

  get '/devices/:udid' do
    login_required
    erb :'devices/show.html'
  end

  get '/devices/:udid/commands/:command_uuid' do
    login_required
    erb :'devices/command.html'
  end

  post '/commands/template.txt' do
    if params[:class] && Command.const_defined?(params[:class])
      args = JSON.parse(params[:args]) rescue {}
      command = Command.const_get(params[:class]).new(**args)
      command.request_payload.to_plist
    else
      ''
    end
  end

  post '/devices/:udid/commands' do
    login_required
    if params[:payload].present?
      command = Data.define(:request_payload).new(request_payload: Plist.parse_xml(params[:payload], marshal: false))
      CommandQueue.new(params[:udid]) << command
    end
    redirect "/devices/#{params[:udid]}"
  end

  post '/devices/:udid/push' do
    login_required
    mdm_push_token = MdmPushToken.find_by!(udid: params[:udid])
    push_result = PushClient.new.send_mdm_notification(mdm_push_token)
    puts "push_result: #{push_result.inspect}"
    redirect "/devices/#{params[:udid]}"
  end
end
