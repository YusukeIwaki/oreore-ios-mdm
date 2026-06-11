module Ddm
  class PublicAsset < ActiveRecord::Base
    has_many :details,
      class_name: Ddm::PublicAssetDetail.to_s,
      foreign_key: :ddm_public_asset_id,
      dependent: :delete_all
    include DetailsPrioritySorted

    def self.details_for(ddm_identifier)
      PublicAssetDetail.for(ddm_identifier).preload(:public_asset)
    end

    def reference_name
      "@public/#{name}"
    end

    # Deletes the asset, its details, and the related blobs stored in Azure Blob.
    #
    # The blobs are deleted explicitly (instead of relying on Shrine's
    # after_commit destroy callback) so that the deletion happens synchronously
    # within this request. `dependent: :delete_all` then removes the detail rows
    # without re-triggering Shrine's callback, avoiding a double deletion.
    def destroy_with_blobs!
      details.each { |detail| detail.asset_file_attacher.destroy }
      destroy!
    end
  end
end
