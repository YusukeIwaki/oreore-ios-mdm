require 'rack/test'

# https://github.com/rack/rack-test#examples
module IntegrationTesting
  include Rack::Test::Methods

  def app
    App
  end
end

RSpec.configure do |config|
  config.define_derived_metadata(file_path: /spec\/requests/) do |metadata|
    metadata[:type] = :integration
  end
  config.include(IntegrationTesting, type: :integration)
end
