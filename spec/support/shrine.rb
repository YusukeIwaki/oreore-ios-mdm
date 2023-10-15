require 'shrine/storage/memory'

RSpec.configure do |config|
  config.before(:suite) do
    Shrine.storages = {
      cache: Shrine::Storage::Memory.new,
      store: Shrine::Storage::Memory.new,
    }
  end
end
