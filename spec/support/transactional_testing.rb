# ref:
#  - https://github.com/rspec/rspec-rails/blob/v6.0.3/lib/rspec/rails/fixture_support.rb#L4
#  - https://github.com/rspec/rspec-rails/blob/v6.0.3/lib/rspec/rails/adapters.rb#L66
module TransactionalTesting
  extend ActiveSupport::Concern
  include ActiveRecord::TestFixtures

  included do |example_group|
    example_group.around do |example|
      setup_fixtures
      example.run
      teardown_fixtures
    end
  end

  def run_in_transaction?
    true
  end
end

RSpec.configure do |config|
  config.include TransactionalTesting
end
