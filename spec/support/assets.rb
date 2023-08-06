module AssetsMethods
  def asset(name)
    File.read(File.join('spec/assets', name))
  end
end

RSpec.configure do |config|
  config.include AssetsMethods
end
