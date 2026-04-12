require 'shrine/storage/s3'

RSpec.configure do |config|
  config.before(:suite) do
    if ENV['S3_ENDPOINT']
      s3_options = {
        bucket: ENV.fetch('S3_BUCKET', 'oreore-ios-mdm-test'),
        region: ENV.fetch('S3_REGION', 'us-east-1'),
        access_key_id: ENV.fetch('S3_ACCESS_KEY_ID', 'test'),
        secret_access_key: ENV.fetch('S3_SECRET_ACCESS_KEY', 'test'),
        endpoint: ENV['S3_ENDPOINT'],
        force_path_style: true,
      }

      # Create the bucket if it doesn't exist (for local dev with floci/MinIO)
      s3_client = Aws::S3::Client.new(
        region: s3_options[:region],
        access_key_id: s3_options[:access_key_id],
        secret_access_key: s3_options[:secret_access_key],
        endpoint: s3_options[:endpoint],
        force_path_style: true,
      )
      begin
        s3_client.create_bucket(bucket: s3_options[:bucket])
      rescue Aws::S3::Errors::BucketAlreadyOwnedByYou, Aws::S3::Errors::BucketAlreadyExists
        # bucket already exists
      end

      Shrine.storages = {
        cache: Shrine::Storage::S3.new(prefix: "cache", **s3_options),
        store: Shrine::Storage::S3.new(**s3_options),
      }
    else
      require 'shrine/storage/memory'
      Shrine.storages = {
        cache: Shrine::Storage::Memory.new,
        store: Shrine::Storage::Memory.new,
      }
    end
  end
end
