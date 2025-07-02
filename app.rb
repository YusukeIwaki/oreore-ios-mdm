require 'bundler'
Bundler.require :default, (ENV['RACK_ENV'] || :development).to_sym

require_relative './config/active_record'
require_relative './config/shrine'
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

      App._logger.info(lines.join("\n"))
    end
  end

  # Specify {mdm_service_discovery_url: 'https://your-domain.example.com/mdm_service_discovery'} into POST /account-driven-enrollment/profile (Account-driven Enrollment Profile)
  get '/mdm_service_discovery' do
    email = params['user-identifier']
    device_family = params['model-family']

    App._logger.info "MDM service discovery request with email=#{email}, device_family=#{device_family}"

    headers('Content-Type' => 'application/json')
    body({
      Servers: [
        { Version: 'mdm-byod', BaseURL: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-byod/enroll" },
      ]
    }.to_json)
  end

  get '/MDMServiceConfig' do # AppleConfigurator: add server
    verbose_print_request

    content_type 'application/json'
    {
      dep_enrollment_url: "#{ENV['MDM_SERVER_BASE_URL']}/mdm/dep_enroll",
      dep_anchor_certs_url: "#{ENV['MDM_SERVER_BASE_URL']}/mdm/dep_anchor_certs",
    }.to_json
  end

  get '/mdm/dep_enroll' do # for macOS
    verbose_print_request
    content_type 'application/x-apple-aspen-config'
    rb :'mdm.mobileconfig'
  end

  post '/mdm/dep_enroll' do # for iOS/iPadOS
    verbose_print_request
    content_type 'application/x-apple-aspen-config'
    rb :'mdm.mobileconfig'
  end

  get '/mdm/dep_anchor_certs' do
    verbose_print_request
    content_type 'application/json'
    '[]'
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

  get '/mdm/service_discovery' do
    verbose_print_request
    content_type 'application/json'
    {
      Servers: [
        {
          Version: 'mdm-byod',
          BaseURL: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-byod/enroll",
        }
      ]
    }.to_json
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

  get '/asset_files/*rest' do
    verbose_print_request
    AssetFileUploader.download_response(request.env).tap do |status, headers, body|
      case headers['Content-Disposition']
      when /^inline; filename=\".*\.plist\";/
        headers.delete('Content-Disposition')
        headers.delete('ETag')
        headers['Content-Type'] = 'application/plist'
      end
    end
  end

  put '/mdm/checkin' do
    verbose_print_request

    plist = Plist.parse_xml(request.body.read, marshal: false)

    if plist['MessageType'] == 'DeclarativeManagement'
      unless plist['Endpoint']
        halt 400, 'Bad request'
      end
      udid = plist['UDID']
      device = MdmDevice.find_by!(udid: udid)

      endpoint = plist['Endpoint']
      data = plist['Data'] ? JSON.parse(plist['Data'].read) : nil

      App._logger.info("DeclarativeManagement: endpoint=#{endpoint} data=#{data.inspect}")
      content_type 'application/json'
      router = DeclarativeManagementRouter.new(device.ddm_identifier)
      begin
        response = router.handle_request(endpoint, data)
        Ddm::SynchronizationRequestHistory.log_response(udid, endpoint, data, response)
        return response.to_json
      rescue DeclarativeManagementRouter::RouteNotFound
        Ddm::SynchronizationRequestHistory.log_404(udid, endpoint, data)
        halt 404, 'Not found'
      end
    end

    if plist['MessageType'] == 'GetToken'
      # https://developer.apple.com/documentation/devicemanagement/get_token
      get_token_target = GetTokenTarget.first
      if !get_token_target || plist['TokenServiceType'] != 'com.apple.maid'
        halt 400, 'Not supported yet'
      end

      token = GetTokenGenerator.new(get_token_target: get_token_target, device_identifier: plist['UDID'], service_type: plist['TokenServiceType']).find_or_generate

      # https://developer.apple.com/documentation/devicemanagement/gettokenresponse
      get_token_response = { TokenData: StringIO.new(token) }
      content_type 'application/xml'
      body get_token_response.to_plist
      return
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
        App._logger.warn("CommandUUID not in DB: #{plist}")
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

    App._logger.info("command: #{command || 'nil'}")
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
    App._logger.info "Enrollment request with email=#{email}"

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
      get_token_target = GetTokenTarget.first
      if !get_token_target || plist['TokenServiceType'] != 'com.apple.maid'
        halt 400, 'Not supported yet'
      end

      token = GetTokenGenerator.new(get_token_target: get_token_target, device_identifier: plist['EnrollmentID'], service_type: plist['TokenServiceType']).find_or_generate

      # https://developer.apple.com/documentation/devicemanagement/gettokenresponse
      get_token_response = { TokenData: StringIO.new(token) }
      content_type 'application/xml'
      body get_token_response.to_plist
      return
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
      begin
        # Record usage and block access from other devices.
        ManagedAppleAccountAccessTokenUsage.
          find_or_initialize_by(device_identifier: plist['EnrollmentID']).
          update!(managed_apple_account_access_token: current_access_token)
      rescue ActiveRecord::RecordNotUnique
        halt 400, 'Access token is already used by another device'
      end
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

    begin
      # Record usage and block access from other devices.
      ManagedAppleAccountAccessTokenUsage.
        find_or_initialize_by(device_identifier: enrollment_id).
        update!(managed_apple_account_access_token: current_access_token)
    rescue ActiveRecord::RecordNotUnique
      halt 400, 'Access token is already used by another device'
    end

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
        App._logger.warn("CommandUUID not in DB: #{plist}")
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

    App._logger.info("command: #{command || 'nil'}")
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
    App._logger.info "Device enrollment request with email=#{email}"

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
      get_token_target = GetTokenTarget.first
      if !get_token_target || plist['TokenServiceType'] != 'com.apple.maid'
        halt 400, 'Not supported yet'
      end

      token = GetTokenGenerator.new(get_token_target: get_token_target, device_identifier: plist['UDID'], service_type: plist['TokenServiceType']).find_or_generate

      # https://developer.apple.com/documentation/devicemanagement/gettokenresponse
      get_token_response = { TokenData: StringIO.new(token) }
      content_type 'application/xml'
      body get_token_response.to_plist
      return
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
      udid = plist['UDID']
      device = MdmDevice.find_by!(udid: udid)

      endpoint = plist['Endpoint']
      data = plist['Data'] ? JSON.parse(plist['Data'].read) : nil

      App._logger.info("DeclarativeManagement: endpoint=#{endpoint} data=#{data.inspect}")
      content_type 'application/json'
      router = DeclarativeManagementRouter.new(device.ddm_identifier)
      begin
        response = router.handle_request(endpoint, data)
        Ddm::SynchronizationRequestHistory.log_response(udid, endpoint, data, response)
        return response.to_json
      rescue DeclarativeManagementRouter::RouteNotFound
        Ddm::SynchronizationRequestHistory.log_404(udid, endpoint, data)
        halt 404, 'Not found'
      end
    end

    if plist.delete('Topic') != PushCertificate.from_env.topic
      halt 403, 'Topic mismatch'
    end

    if plist['UDID'].present?
      begin
        # Record usage and block access from other devices.
        ManagedAppleAccountAccessTokenUsage.
          find_or_initialize_by(device_identifier: plist['UDID']).
          update!(managed_apple_account_access_token: current_access_token)
      rescue ActiveRecord::RecordNotUnique
        halt 400, 'Access token is already used by another device'
      end
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

    begin
      # Record usage and block access from other devices.
      ManagedAppleAccountAccessTokenUsage.
        find_or_initialize_by(device_identifier: udid).
        update!(managed_apple_account_access_token: current_access_token)
    rescue ActiveRecord::RecordNotUnique
      halt 400, 'Access token is already used by another device'
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
        App._logger.warn("CommandUUID not in DB: #{plist}")
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

    App._logger.info("command: #{command || 'nil'}")
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
    def login_allowed?(email)
      App._logger.info("login_allowed? email=#{email}, GOOGLE_ALLOWED_DOMAINS=#{ENV['GOOGLE_ALLOWED_DOMAINS']}, GOOGLE_ALLOWED_USERS=#{ENV['GOOGLE_ALLOWED_USERS']}")
      if ENV['GOOGLE_ALLOWED_DOMAINS'].present?
        return true if ENV['GOOGLE_ALLOWED_DOMAINS'].split(',').include?(email.split('@').last)
      end
      if ENV['GOOGLE_ALLOWED_USERS'].present?
        return true if ENV['GOOGLE_ALLOWED_USERS'].split(',').include?(email)
      end
      false
    end

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

  get '/auth/developer/callback' do
    url = session.delete(:return_to)
    return_url =
      if url.blank? || url.include?('/auth/')
        '/'
      else
        url
      end

    auth_hash = env["omniauth.auth"]
    username = auth_hash['uid']
    if login_allowed?(username)
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
    if email_verified && login_allowed?(email)
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

  get '/devices/:udid/command_request_form_inner' do
    login_required
    erb :'devices/_command_request_form_inner.html', layout: false
  end

  get '/devices/:udid/synchronization_request_histories/:id' do
    login_required
    erb :'devices/synchronization_request_history.html'
  end

  get '/commands/:command_uuid' do
    login_required
    erb :'mdm_command_history.html'
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

  get '/byod/devices/:enrollment_id/command_request_form_inner' do
    login_required
    erb :'byod/devices/_command_request_form_inner.html', layout: false
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

  get '/rts/wifi_profiles' do
    login_required
    erb :'rts/wifi_profiles.html'
  end

  get '/rts/wifi_profiles/:id' do
    login_required
    erb :'rts/wifi_profiles.html'
  end

  post '/rts/wifi_profiles' do
    login_required
    wifi_profile = Rts::WifiProfile.find_or_initialize_by(name: params[:name])
    wifi_profile.update!(asset_file: params[:asset_file])
    redirect '/rts/wifi_profiles'
  end

  get '/vpp' do
    login_required
    erb :'vpp/index.html'
  end

  post '/vpp' do
    login_required
    vpp_token_file = params[:vpptoken_file]
    if vpp_token_file
      VppContentToken.update_from(vpp_token_file[:filename], vpp_token_file[:tempfile].read)
    end
    redirect '/vpp'
  end

  get '/vpp/:filename' do
    login_required
    erb :'vpp/show.html'
  end

  get '/vpp/:filename/:adam_id' do
    login_required
    erb :'vpp/assignments.html'
  end

  get '/vpp/:filename/:adam_id/assignments' do
    # just in case POST /vpp/:filename/:adam_id/assignments is redirected into login and callbacked to the URL.
    login_required
    vpp_content_token = VppContentToken.find_by!(filename: params[:filename])
    redirect "/vpp/#{vpp_content_token.url_encoded_filename}/#{params[:adam_id]}"
  end

  post '/vpp/:filename/:adam_id/assignments' do
    login_required
    vpp_content_token = VppContentToken.find_by!(filename: params[:filename])
    adam_id = params[:adam_id]

    license = VppLicenseForm.new(
      adam_id: adam_id,
      serial_number: params[:serial_number],
    )
    license.associate(vpp_content_token)

    redirect "/vpp/#{vpp_content_token.url_encoded_filename}/#{adam_id}"
  end

  get '/dep' do
    login_required
    erb :'dep/index.html'
  end

  post '/dep' do
    login_required

    dep_token_file = params[:dep_token_file]
    if dep_token_file
      DepServerToken.update_from(dep_token_file[:filename], dep_token_file[:tempfile].read)
    end
    erb :'dep/index.html'
  end

  get '/dep/pub_key.pem' do
    login_required

    issuer = subject = OpenSSL::X509::Name.new([["CN", "oreore-mdm DEP"]])
    cert = OpenSSL::X509::Certificate.new
    cert.not_before = Time.now
    cert.not_after = Time.now + 60 * 60 * 24 * 365
    cert.public_key = DepKey.public_key
    cert.serial = 0
    cert.issuer = issuer
    cert.subject = subject
    cert.sign(DepKey.private_key, OpenSSL::Digest::SHA256.new)

    content_type 'application/x-pem-file'
    attachment 'pub_key.pem'
    cert.to_pem
  end

  get '/dep/:filename' do
    login_required
    erb :'dep/show.html'
  end

  get '/dep/:filename/account' do
    login_required
    erb :'dep/account.html'
  end

  get '/dep/:filename/os_beta_enrollment_tokens' do
    login_required
    erb :'dep/os_beta_enrollment_tokens.html'
  end

  get '/dep/:filename/account_driven_enrollment_profile' do
    login_required
    erb :'dep/account_driven_enrollment_profile.html'
  end

  post '/dep/:filename/account_driven_enrollment_profile' do
    login_required
    dep_server_token = DepServerToken.find_by!(filename: params[:filename])
    if params[:url] == '' # not nil. just ""
      DepClient.new(dep_server_token).delete('account-driven-enrollment/profile')
    elsif !params[:url].nil?
      payload = {
        mdm_service_discovery_url: params[:url],
      }
      DepClient.new(dep_server_token).post('account-driven-enrollment/profile', payload)
    end
    redirect "/dep/#{params[:filename]}/account_driven_enrollment_profile"
  end

  get '/dep/:filename/devices' do
    login_required
    erb :'dep/devices.html'
  end

  get '/dep/:filename/devices/:serial_number' do
    login_required
    erb :'dep/devices.html'
  end

  get '/dep/:filename/devices/:serial_number/remove_profile' do
    login_required
    dep_server_token = DepServerToken.find_by!(filename: params[:filename])
    serial_number = params[:serial_number].presence&.strip

    dep = DepClient.new(dep_server_token)
    json = dep.post('devices', { devices: [serial_number] })
    if json['devices'][serial_number] && json['devices'][serial_number]['profile_uuid']
      json = dep.delete('profile/devices', {
        profile_uuid: json['devices'][serial_number]['profile_uuid'],
        devices: [serial_number],
      })
    end
    redirect "/dep/#{params[:filename]}/devices/#{serial_number}"
  end

  get '/dep/:filename/profiles/:profile_uuid' do
    login_required
    erb :'dep/profile.html'
  end

  post '/dep/:filename/profiles' do
    login_required
    dep_server_token = DepServerToken.find_by!(filename: params[:filename])
    json = DepClient.new(dep_server_token).post('profile', YAML.load(params['payload']))
    if json['devices'].size == 1
      redirect "/dep/#{params[:filename]}/devices/#{json['devices'].keys.first}"
    else
      redirect "/dep/#{params[:filename]}/profiles/#{json['profile_uuid']}"
    end
  end

  post '/dep/:filename/profiles/:profile_uuid/assign' do
    login_required
    dep_server_token = DepServerToken.find_by!(filename: params[:filename])
    serial_numbers = params[:serial_numbers].split("\n").filter_map { |s| s.presence&.strip }

    json = DepClient.new(dep_server_token).post('profile/devices', {
      profile_uuid: params[:profile_uuid],
      devices: serial_numbers,
    })
    redirect "/dep/#{params[:filename]}/profiles/#{json['profile_uuid']}"
  end

  get '/ddm' do
    login_required
    erb :'ddm/index.html'
  end

  get '/ddm/device_groups' do
    login_required
    erb :'ddm/device_groups/index.html'
  end

  post '/ddm/device_groups' do
    login_required
    serial_numbers = params[:serial_numbers].split("\n").filter_map { |s| s.presence&.strip }
    if serial_numbers.empty?
      Ddm::DeviceGroup.create!(name: params[:name])
    else
      timestamp = Time.current
      ActiveRecord::Base.transaction do
        group = Ddm::DeviceGroup.create!(name: params[:name])
        Ddm::DeviceGroupItem.insert_all!(
          serial_numbers.map do |serial_number|
            {
              ddm_device_group_id: group.id,
              device_identifier: serial_number,
              created_at: timestamp,
            }
          end
        )
      end
    end
    redirect '/ddm/device_groups'
  end

  get '/ddm/device_groups/:id' do
    login_required
    erb :'ddm/device_groups/show.html'
  end

  post '/ddm/device_groups/:id' do
    login_required
    group = Ddm::DeviceGroup.find(params[:id])
    serial_numbers = params[:serial_numbers].split("\n").filter_map { |s| s.presence&.strip }
    if serial_numbers.empty?
      Ddm::DeviceGroupItem.where(device_group: group).delete_all
    else
      new_serial_numbers = serial_numbers - group.items.pluck(:device_identifier)
      unless new_serial_numbers.empty?
        timestamp = Time.current
        ActiveRecord::Base.transaction do
          Ddm::DeviceGroupItem.where(device_group: group).where.not(device_identifier: serial_numbers).delete_all
          Ddm::DeviceGroupItem.insert_all!(
            new_serial_numbers.map do |serial_number|
              {
                ddm_device_group_id: group.id,
                device_identifier: serial_number,
                created_at: timestamp,
              }
            end
          )
        end
      end
    end
    redirect "/ddm/device_groups/#{params[:id]}"
  end

  get '/ddm/device_groups/:id/rename' do
    login_required
    erb :'ddm/device_groups/rename.html'
  end

  post '/ddm/device_groups/:id/rename' do
    login_required
    group = Ddm::DeviceGroup.find(params[:id])
    group.update!(name: params[:name])
    redirect "/ddm/device_groups/#{params[:id]}"
  end

  get '/ddm/activations' do
    login_required
    erb :'ddm/activations/index.html'
  end

  post '/ddm/activations' do
    login_required
    form = Ddm::ActivationForm.new_with_sliced(params)
    form.create
    redirect "/ddm/activations"
  end

  get '/ddm/activations/:id' do
    login_required
    erb :'ddm/activations/show.html'
  end

  post '/ddm/activations/:id' do
    login_required
    form = Ddm::ActivationForm.new_with_sliced(params)
    form.update(params[:id])
    redirect "/ddm/activations/#{params[:id]}"
  end

  get '/ddm/configurations' do
    login_required
    erb :'ddm/configurations/index.html'
  end

  post '/ddm/configurations' do
    login_required
    payload = YAML.load(params[:payload])
    configuration = Ddm::Configuration.create!(
      name: params[:name],
      type: params[:type],
      payload: payload,
    )
    redirect "/ddm/configurations"
  end

  get '/ddm/configurations/:id' do
    login_required
    erb :'ddm/configurations/show.html'
  end

  post '/ddm/configurations/:id' do
    login_required
    configuration = Ddm::Configuration.find(params[:id])
    payload = YAML.load(params[:payload])
    configuration.update!(type: params[:type], payload: payload)
    redirect "/ddm/configurations/#{params[:id]}"
  end

  get '/ddm/managements' do
    login_required
    erb :'ddm/managements/index.html'
  end

  post '/ddm/managements' do
    login_required
    management = Ddm::Management.create!(name: params[:name], type: params[:type])
    redirect '/ddm/managements'
  end

  get '/ddm/managements/:id/details' do
    login_required
    erb :'ddm/managements/details.html'
  end

  get '/ddm/managements/:id/details/:detail_id' do
    login_required
    erb :'ddm/managements/details.html'
  end

  post '/ddm/managements/:id/details' do
    login_required
    management = Ddm::Management.find(params[:id])
    detail = management.details.find_or_initialize_by(target_identifier: params[:target_identifier].presence)
    detail.update!(payload: YAML.load(params[:payload]))
    redirect "/ddm/managements/#{management.id}/details"
  end

  get '/ddm/assets' do
    login_required
    erb :'ddm/assets/index.html'
  end

  post '/ddm/assets' do
    login_required
    asset = Ddm::Asset.create!(name: params[:name], type: params[:type])
    redirect '/ddm/assets'
  end

  get '/ddm/assets/:id/details' do
    login_required
    erb :'ddm/assets/details.html'
  end

  get '/ddm/assets/:id/details/:detail_id' do
    login_required
    erb :'ddm/assets/details.html'
  end

  post '/ddm/assets/:id/details' do
    login_required
    asset = Ddm::Asset.find(params[:id])
    detail = asset.details.find_or_initialize_by(target_identifier: params[:target_identifier].presence)
    detail.update!(payload: YAML.load(params[:payload]))
    redirect "/ddm/assets/#{asset.id}/details"
  end

  get '/ddm/public_assets' do
    login_required
    erb :'ddm/public_assets/index.html'
  end

  post '/ddm/public_assets' do
    login_required

    public_asset = Ddm::PublicAsset.create!(name: params[:name])
    redirect '/ddm/public_assets'
  end

  get '/ddm/public_assets/:id/details' do
    login_required
    erb :'ddm/public_assets/details.html'
  end

  get '/ddm/public_assets/:id/details/:detail_id' do
    login_required
    erb :'ddm/public_assets/details.html'
  end

  post '/ddm/public_assets/:id/details' do
    login_required

    public_asset = Ddm::PublicAsset.find(params[:id])
    detail = public_asset.details.find_or_initialize_by(target_identifier: params[:target_identifier].presence)
    detail.update!(asset_file: params[:asset_file])

    redirect "/ddm/public_assets/#{public_asset.id}/details"
  end
end

class App < Sinatra::Base
  def self._logger
    @_logger ||= Logger.new($stdout)
  end
  use FixContentTypeMiddleware

  use MdmServer
  use MdmByodServer
  use MdmAddeServer
  use SimpleAdminConsole
end
