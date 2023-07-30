require 'bundler'
Bundler.require :default, (ENV['RACK_ENV'] || :development).to_sym

require 'json'
require 'sinatra'
require_relative './lib/sinatra_stdout_logging'

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


get '/.well-known/com.apple.remotemanagement' do
  verbose_print_request
  headers('Content-Type' => 'application/json')
  body({
    Servers: [
      { Version: 'mdm-byod', BaseURL: "#{ENV['MDM_SERVER_BASE_URL']}/mdm-byod/enroll" }
    ]
  }.to_json)
end
