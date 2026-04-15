class IpaFile < ActiveRecord::Base
  include AssetFileUploader::Attachment(:asset_file)

  def url_encoded_filename
    ERB::Util.url_encode(filename)
  end

  def metadata
    Metadata.new(
      bundle_identifier: bundle_identifier,
      download_url: asset_file.download_url(host: ENV['MDM_SERVER_BASE_URL']),
    )
  end

  class Metadata < Data.define(:bundle_identifier, :download_url)
    def as_manifest
      payload = {
        items: [
          {
            assets: [
              {
                kind: 'software-package',
                url: download_url,
              },
            ],
            metadata: {
              'bundle-identifier': bundle_identifier,
              kind: :software,
              title: "Download #{bundle_identifier}",
            }
          }
        ]
      }

      payload.to_plist
    end
  end
end
