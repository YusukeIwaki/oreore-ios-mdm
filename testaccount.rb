require 'json'
require 'sinatra'

get '/.well-known/com.apple.remotemanagement' do
  email = params['user-identifier']
  puts "Enrollment request with email=#{email}"

  headers('Content-Type' => 'application/json')
  body({
    Servers: [
      { Version: 'mdm-byod', BaseURL: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-byod/enroll" }
    ]
  }.to_json)
end
