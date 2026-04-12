require 'shrine/storage/s3'
require 'shrine/storage/file_system'

s3_options = {
  bucket: ENV['S3_BUCKET'],
  region: ENV.fetch('S3_REGION', 'us-east-1'),
  access_key_id: ENV['S3_ACCESS_KEY_ID'],
  secret_access_key: ENV['S3_SECRET_ACCESS_KEY'],
}
s3_options[:endpoint] = ENV['S3_ENDPOINT'] if ENV['S3_ENDPOINT']
s3_options[:force_path_style] = true if ENV['S3_ENDPOINT']

Shrine.storages = {
  cache: Shrine::Storage::FileSystem.new("public", prefix: "uploads/cache"),
  store: Shrine::Storage::S3.new(**s3_options),
}

Shrine.plugin :activerecord
Shrine.plugin :cached_attachment_data # for retaining the cached file across form redisplays
Shrine.plugin :download_endpoint, prefix: "asset_files"
Shrine.plugin :restore_cached_data # re-extract metadata when attaching a cached file
Shrine.plugin :rack_file # for non-Rails apps
