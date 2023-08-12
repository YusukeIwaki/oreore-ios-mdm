require 'bundler'
Bundler.require :default, (ENV['RACK_ENV'] || :development).to_sym

require_relative './config/active_record'
require_relative './config/zeitwerk'

require 'sinatra/base'

Tilt.register('rb', Tilt::RubyTemplate)
Sinatra::Templates.prepend(SinatraTemplatesExtension)

class FixContentTypeMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    if env['PATH_INFO'] == '/mdm-byod/enroll'
      # iOS 15 is buggy. It sends Content-Type: application/x-www-form-urlencoded
      # and Rack raises errors Invalid query parameters: invalid %-encoding.
      if env['CONTENT_TYPE'] == 'application/x-www-form-urlencoded'
        # just avoid it by rewriting Content-Type
        env['CONTENT_TYPE'] = 'application/pkcs7-signature'
      end
    end
    @app.call(env)
  end
end

class MdmServer < Sinatra::Base
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

  get '/mdm/declarative/assets/:file' do
    verbose_print_request
    send_file File.join('declarations/public', params[:file])
  end

  get '/mdm/declarative/assets/:file/:digest' do
    verbose_print_request
    found = DeclarativeManagement::Declaration::PublicAssetFile.find_path_by_digested_path(File.join(params[:file], params[:digest]))

    unless found
      halt 404, 'Not found'
    end

    send_file found
  end

  put '/mdm/checkin' do
    verbose_print_request

    plist = Plist.parse_xml(request.body.read, marshal: false)

    if plist['MessageType'] == 'DeclarativeManagement'
      unless plist['Endpoint']
        halt 400, 'Bad request'
      end
      device = MdmDevice.find_by!(udid: plist['UDID'])

      endpoint = plist['Endpoint']
      data = plist['Data'] ? JSON.parse(plist['Data'].read) : nil

      logger.info("DeclarativeManagement: endpoint=#{endpoint} data=#{data.inspect}")
      content_type 'application/json'
      router = DeclarativeManagementRouter.new(device)
      begin
        response = router.handle_request(endpoint, data)
        DeclarativeManagement::SynchronizationRequestHistory.
          log_response(device, endpoint, data, response)
        return response.to_json
      rescue DeclarativeManagementRouter::RouteNotFound
        DeclarativeManagement::SynchronizationRequestHistory.
          log_404(device, endpoint, data)
        halt 404, 'Not found'
      end
    end

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

    device = MdmDevice.find_by!(udid: udid)
    command_queue = CommandQueue.for_device(device)
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
    if ['Acknowledged', 'Error'].include?(status) && handling_request && (request_type = handling_request.request_payload.dig('Command', 'RequestType'))
      if (handler_klass = CommandResponseHandler.const_get("#{request_type}#{status}") rescue nil)
        if status == 'Error'
          handler_klass.new(device, plist['ErrorChain']).handle
        else
          response_payload = plist.reject do |key, value|
            %w[Status UDID CommandUUID ErrorChain].include?(key)
          end
          handler_klass.new(device, response_payload).handle
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
end


class MdmByodServer < Sinatra::Base
  helpers do
    # Get access_token from Authorization Header. The result access token can be expired.
    def current_access_token
      return @current_access_token if @current_access_token

      m = request.env['HTTP_AUTHORIZATION']&.match(/\ABearer (.+)\z/)
      return nil unless m

      token = ManagedAppleAccountAccessToken.find_by(token: m[1])
      return nil unless token

      @current_access_token = token
    end

    def authorized_account
      current_access_token.try! do |token|
        if token.expired?
          nil
        else
          token.managed_apple_account
        end
      end
    end

    def authorized_account_required
      redirect_to_authenticate_url unless authorized_account
    end

    def redirect_to_authenticate_url
      realm = {
        method: 'apple-as-web',
        url: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-byod/authenticate",
      }.map { |k, v| "#{k}=\"#{v}\"" }.join(', ')

      halt 401, { 'WWW-Authenticate' => "Bearer #{realm}" }, 'Unauthorized'
    end
  end

  # https://developer.apple.com/documentation/devicemanagement/user_enrollment/onboarding_users_with_account_sign-in/implementing_the_simple_authentication_user-enrollment_flow
  post '/mdm-byod/enroll' do
    authorized_account_required
    content_type 'application/x-apple-aspen-config'
    rb :'mdm-byod.mobileconfig', locals: { assigned_managed_apple_id: authorized_account.email }
  end

  # accessed via WebView.
  get '/mdm-byod/authenticate' do
    email = params['user-identifier']
    logger.info "Enrollment request with email=#{email}"

    erb :'mdm-byod/authenticate.html'
  end

  # accessed via WebView.
  post '/mdm-byod/authenticate' do
    account = ManagedAppleAccount.find_by!(email: params[:email])

    if params[:password] == 'password!'
      token = SecureRandom.hex(24)
      account.access_tokens.create!(token: token)

      url = "apple-remotemanagement-user-login://authentication-results?access-token=#{token}"
      halt 308, { 'Location' => url }, 'Redirect'
    end

    @error = 'Invalid password'
    erb :'mdm-byod/authenticate.html'
  end

  put '/mdm-byod/checkin' do
    plist = Plist.parse_xml(request.body.read, marshal: false)

    if plist['MessageType'] == 'GetToken'
      # https://developer.apple.com/documentation/devicemanagement/get_token
      halt 400, 'Not supported yet'
    end

    if plist['MessageType'] == 'CheckOut' && current_access_token
      begin
        # Check if the access token is used by the device,
        # since CheckOut request cannot handle 401.
        ManagedAppleAccountAccessTokenUsage.find_by!(
          managed_apple_account_access_token: current_access_token,
          device_identifier: plist['EnrollmentID'],
        )
      rescue ActiveRecord::RecordNotFound
        redirect_to_authenticate_url
      end
    else
      authorized_account_required
    end

    if plist.delete('Topic') != PushCertificate.from_env.topic
      halt 403, 'Topic mismatch'
    end

    if plist['EnrollmentID'].present?
      # Record usage and block access from other devices.
      ManagedAppleAccountAccessTokenUsage.
        find_or_initialize_by(device_identifier: plist['EnrollmentID']).
        update!(managed_apple_account_access_token: current_access_token)
    end

    message_handler =
      case plist['MessageType']
      when 'Authenticate'
        ByodCheckinRequest::AuthenticateMessageHandler.new(plist)
      when 'TokenUpdate'
        ByodCheckinRequest::TokenUpdateMessageHandler.new(plist)
      when 'CheckOut'
        ByodCheckinRequest::CheckOutMessageHandler.new(plist)
      else
        raise 'Unknown MessageType'
      end

    message_handler.handle

    content_type 'text/plain'
    'OK'
  end

  put '/mdm-byod/command' do
    authorized_account_required

    plist = Plist.parse_xml(request.body.read, marshal: false)
    enrollment_id = plist['EnrollmentID']
    status = plist['Status']

    if !enrollment_id || !status
      halt 400, 'Bad request'
    end

    # Record usage and block access from other devices.
    ManagedAppleAccountAccessTokenUsage.
      find_or_initialize_by(device_identifier: enrollment_id).
      update!(managed_apple_account_access_token: current_access_token)

    device = ByodDevice.find_by!(enrollment_id: enrollment_id)
    command_queue = CommandQueue.for_byod_device(device)
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
    if ['Acknowledged', 'Error'].include?(status) && handling_request && (request_type = handling_request.request_payload.dig('Command', 'RequestType'))
      if (handler_klass = ByodCommandResponseHandler.const_get("#{request_type}#{status}") rescue nil)
        if status == 'Error'
          handler_klass.new(device, plist['ErrorChain']).handle
        else
          response_payload = plist.reject do |key, value|
            %w[Status UDID CommandUUID ErrorChain].include?(key)
          end
          handler_klass.new(device, response_payload).handle
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
end

class MdmAddeServer < Sinatra::Base
  helpers do
    # Get access_token from Authorization Header. The result access token can be expired.
    def current_access_token
      return @current_access_token if @current_access_token

      m = request.env['HTTP_AUTHORIZATION']&.match(/\ABearer (.+)\z/)
      return nil unless m

      token = ManagedAppleAccountAccessToken.find_by(token: m[1])
      return nil unless token

      @current_access_token = token
    end

    def authorized_account
      current_access_token.try! do |token|
        if token.expired?
          nil
        else
          token.managed_apple_account
        end
      end
    end

    def authorized_account_required
      redirect_to_authenticate_url unless authorized_account
    end

    def redirect_to_authenticate_url
      realm = {
        method: 'apple-as-web',
        url: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-adde/authenticate",
      }.map { |k, v| "#{k}=\"#{v}\"" }.join(', ')

      halt 401, { 'WWW-Authenticate' => "Bearer #{realm}" }, 'Unauthorized'
    end
  end

  post '/mdm-adde/enroll' do
    authorized_account_required
    content_type 'application/x-apple-aspen-config'
    rb :'mdm-adde.mobileconfig', locals: { assigned_managed_apple_id: authorized_account.email }
  end

  # accessed via WebView.
  get '/mdm-adde/authenticate' do
    email = params['user-identifier']
    logger.info "Device enrollment request with email=#{email}"

    erb :'mdm-adde/authenticate.html'
  end

  # accessed via WebView.
  post '/mdm-adde/authenticate' do
    account = ManagedAppleAccount.find_by!(email: params[:email])

    if params[:password] == 'PASSWORD!'
      token = SecureRandom.hex(24)
      account.access_tokens.create!(token: token)

      url = "apple-remotemanagement-user-login://authentication-results?access-token=#{token}"
      halt 308, { 'Location' => url }, 'Redirect'
    end

    @error = 'Invalid password'
    erb :'mdm-adde/authenticate.html'
  end

  put '/mdm-adde/checkin' do
    plist = Plist.parse_xml(request.body.read, marshal: false)

    if plist['MessageType'] == 'GetToken'
      # https://developer.apple.com/documentation/devicemanagement/get_token
      halt 400, 'Not supported yet'
    end

    if plist['MessageType'] == 'CheckOut' && current_access_token
      begin
        # Check if the access token is used by the device,
        # since CheckOut request cannot handle 401.
        ManagedAppleAccountAccessTokenUsage.find_by!(
          managed_apple_account_access_token: current_access_token,
          device_identifier: plist['UDID'],
        )
      rescue ActiveRecord::RecordNotFound
        redirect_to_authenticate_url
      end
    else
      authorized_account_required
    end

    if plist['MessageType'] == 'DeclarativeManagement'
      unless plist['Endpoint']
        halt 400, 'Bad request'
      end
      device = MdmDevice.find_by!(udid: plist['UDID'])

      endpoint = plist['Endpoint']
      data = plist['Data'] ? JSON.parse(plist['Data'].read) : nil

      logger.info("DeclarativeManagement: endpoint=#{endpoint} data=#{data.inspect}")
      content_type 'application/json'
      router = DeclarativeManagementRouter.new(device)
      begin
        response = router.handle_request(endpoint, data)
        DeclarativeManagement::SynchronizationRequestHistory.
          log_response(device, endpoint, data, response)
        return response.to_json
      rescue DeclarativeManagementRouter::RouteNotFound
        DeclarativeManagement::SynchronizationRequestHistory.
          log_404(device, endpoint, data)
        halt 404, 'Not found'
      end
    end

    if plist.delete('Topic') != PushCertificate.from_env.topic
      halt 403, 'Topic mismatch'
    end

    if plist['UDID'].present?
      # Record usage and block access from other devices.
      ManagedAppleAccountAccessTokenUsage.
        find_or_initialize_by(device_identifier: plist['UDID']).
        update!(managed_apple_account_access_token: current_access_token)
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

  put '/mdm-adde/command' do
    authorized_account_required

    plist = Plist.parse_xml(request.body.read, marshal: false)
    udid = plist['UDID']
    status = plist['Status']

    if !udid || !status
      halt 400, 'Bad request'
    end

    # Record usage and block access from other devices.
    ManagedAppleAccountAccessTokenUsage.
      find_or_initialize_by(device_identifier: udid).
      update!(managed_apple_account_access_token: current_access_token)

    device = MdmDevice.find_by!(udid: udid)
    command_queue = CommandQueue.for_device(device)
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
    if ['Acknowledged', 'Error'].include?(status) && handling_request && (request_type = handling_request.request_payload.dig('Command', 'RequestType'))
      if (handler_klass = CommandResponseHandler.const_get("#{request_type}#{status}") rescue nil)
        if status == 'Error'
          handler_klass.new(device, plist['ErrorChain']).handle
        else
          response_payload = plist.reject do |key, value|
            %w[Status UDID CommandUUID ErrorChain].include?(key)
          end
          handler_klass.new(device, response_payload).handle
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
end

class SimpleAdminConsole < Sinatra::Base
  enable :sessions
  if ENV['GOOGLE_CLIENT_ID'].present?
    use OmniAuth::Builder do
      provider :google_oauth2, ENV['GOOGLE_CLIENT_ID'], ENV['GOOGLE_CLIENT_SECRET']
    end
  else
    use OmniAuth::Builder do
      provider :developer, fields: [:email], uid_field: :email
    end
  end

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
  end

  get '/' do
    if logged_in?
      redirect '/devices'
    else
      erb :'login.html'
    end
  end

  post '/auth/developer/callback' do
    url = session.delete(:return_to)
    return_url =
      if url.blank? || url.include?('/auth/')
        '/'
      else
        url
      end

    auth_hash = env["omniauth.auth"]
    username = auth_hash['uid']
    if ENV['GOOGLE_ALLOWED_USERS'].split(',').include?(username)
      session[:uid] = username
      redirect return_url
    else
      halt 403, 'Access Forbidden'
    end
  end

  get '/auth/google_oauth2/callback' do
    url = session.delete(:return_to)
    return_url =
      if url.blank? || url.include?('/auth/')
        '/'
      else
        url
      end

    auth_hash = env["omniauth.auth"]
    email_verified = auth_hash.dig('extra', 'raw_info', 'email_verified')
    email = auth_hash.dig('extra', 'raw_info', 'email')
    if email_verified && ENV['GOOGLE_ALLOWED_USERS'].split(',').include?(email)
      session[:uid] = email
      redirect return_url
    else
      halt 403, 'Access Forbidden'
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

  get '/devices/:udid/synchronization_request_histories/:id' do
    login_required
    erb :'devices/synchronization_request_history.html'
  end

  get '/commands/:command_uuid' do
    login_required
    erb :'mdm_command_history.html'
  end

  post '/commands/template.txt' do
    if params[:class] == 'DeclarativeManagement'
      declaration = DeclarativeManagement::Declaration.new(params[:declarativemanagement_device_identifier])
      command = Command::DeclarativeManagement.new(tokens: declaration.tokens)
      command.request_payload.to_plist
    elsif params[:class] && Command.const_defined?(params[:class])
      command = Command.const_get(params[:class]).new
      command.request_payload.to_plist
    else
      ''
    end
  end

  post '/devices/:udid/commands' do
    login_required
    if params[:payload].present?
      command = Data.define(:request_payload).new(request_payload: Plist.parse_xml(params[:payload], marshal: false))
      CommandQueue.for_device(MdmDevice.find_by!(udid: params[:udid])) << command
    end
    redirect "/devices/#{params[:udid]}"
  end

  post '/devices/:udid/push' do
    login_required
    mdm_push_endpoint = MdmDevice.find_by!(udid: params[:udid]).mdm_push_endpoint
    push_result = PushClient.new.send_mdm_notification(mdm_push_endpoint)
    puts "push_result: #{push_result.inspect}"
    redirect "/devices/#{params[:udid]}"
  end

  get '/byod/devices/:enrollment_id' do
    login_required
    erb :'byod/devices/show.html'
  end

  post '/byod/devices/:enrollment_id/commands' do
    login_required
    if params[:payload].present?
      command = Data.define(:request_payload).new(request_payload: Plist.parse_xml(params[:payload], marshal: false))
      CommandQueue.for_byod_device(ByodDevice.find_by!(enrollment_id: params[:enrollment_id])) << command
    end
    redirect "/byod/devices/#{params[:enrollment_id]}"
  end

  post '/byod/devices/:enrollment_id/push' do
    login_required
    byod_push_endpoint = ByodDevice.find_by!(enrollment_id: params[:enrollment_id]).byod_push_endpoint
    push_result = PushClient.new.send_mdm_notification(byod_push_endpoint)
    puts "push_result: #{push_result.inspect}"
    redirect "/byod/devices/#{params[:enrollment_id]}"
  end

  get '/device_groups/:id' do
    login_required
    @device_group = DeviceGroup.find(params[:id])
    erb :'/device_groups/edit.html'
  end
end

class App < Sinatra::Base
  use SinatraStdoutLogging
  use FixContentTypeMiddleware

  use MdmServer
  use MdmByodServer
  use MdmAddeServer
  use SimpleAdminConsole
end
