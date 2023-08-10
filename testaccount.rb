require 'json'
require 'sinatra'

get '/.well-known/com.apple.remotemanagement' do
  email = params['user-identifier']
  device_family = params['model-family']

  if device_family
    puts "Device Enrollment capable enrollment request with email=#{email} device_family=#{device_family}"

    headers('Content-Type' => 'application/json')
    body({
      Servers: [
        { Version: 'mdm-adde', BaseURL: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-adde/enroll" },
      ]
    }.to_json)
  else
    puts "User Enrollment request with email=#{email}"

    headers('Content-Type' => 'application/json')
    body({
      Servers: [
        { Version: 'mdm-byod', BaseURL: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-byod/enroll" },
      ]
    }.to_json)
  end
end
