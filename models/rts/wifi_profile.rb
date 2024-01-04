module Rts
  class WifiProfile < ActiveRecord::Base
    include AssetFileUploader::Attachment(:asset_file)
  end
end
