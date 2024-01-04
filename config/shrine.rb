require_relative '../lib/shrine_storage_azure_blob'
require 'shrine/storage/file_system'

container_name = ENV['AZURE_STORAGE_CONTAINER_NAME']

Shrine.storages = {
  cache: Shrine::Storage::FileSystem.new("public", prefix: "uploads/cache"),
  store: ShrineStorageAzureBlob.new(container_name: container_name)
}

Shrine.plugin :activerecord
Shrine.plugin :cached_attachment_data # for retaining the cached file across form redisplays
Shrine.plugin :download_endpoint, prefix: "asset_files"
Shrine.plugin :restore_cached_data # re-extract metadata when attaching a cached file
Shrine.plugin :rack_file # for non-Rails apps
