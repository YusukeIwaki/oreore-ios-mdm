# frozen_string_literal: true

require 'shrine'
require 'azure/storage/blob'
require 'content_disposition'

require 'uri'
require 'cgi'
require 'tempfile'

# https://github.com/TQsoft-GmbH/shrine-storage-azureblob/blob/master/lib/shrine/storage/azure_blob.rb
class ShrineStorageAzureBlob
  def initialize(container_name: nil)
    @client = Azure::Storage::Blob::BlobService.create_from_env
    @container_name = container_name
  end

  def upload(io, id, shrine_metadata: {}, **_upload_options)
    content_type, filename = shrine_metadata.values_at('mime_type', 'filename')
    options = {}
    options[:content_type] = content_type if content_type
    options[:content_disposition] = ContentDisposition.inline(filename) if filename

    put(io, id, **options)
  end

  def extract_path(io)
    if io.respond_to?(:path)
      io.path
    elsif io.is_a?(Shrine::UploadedFile) &&
          defined?(Shrine::Storage::FileSystem) &&
          io.storage.is_a?(Shrine::Storage::FileSystem)
      io.storage.path(io.id).to_s
    end
  end

  def open(id, _rewindable: false, **_options)
    GC.start
    _blob, content = @client.get_blob(@container_name, id)
    StringIO.new(content)
  end

  def put(io, id, **_options)
    if (path = extract_path(io))
      ::File.open(path, 'rb') do |file|
        @client.create_block_blob(@container_name, id, file.read, timeout: 30, **_options)
      end
    else
      @client.create_block_blob(@container_name, id, io.to_io, **_options)
    end
  end

  def delete(id)
    @client.delete_blob(@container_name, id)
  end

  def url(id, **options)
    @client.generate_uri("#{@container_name}/#{id}")
  end

  class Tempfile < ::Tempfile
    attr_accessor :content_type
  end
end
