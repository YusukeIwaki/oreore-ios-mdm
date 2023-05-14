require 'base64'
require 'faraday'

%w[MDMCERT_DOWNLOAD_API_KEY MDMCERT_DOWNLOAD_EMAIL].each do |key|
  raise "#{key} is not set" unless ENV[key]
end

push_csr_str = File.read('util/push.csr')
server_cert_str = File.read('util/server.crt')

conn = Faraday.new(url: 'https://mdmcert.download') do |faraday|
  faraday.request :json
  faraday.response :json
end

response = conn.post('/api/v1/signrequest', {
  key: ENV['MDMCERT_DOWNLOAD_API_KEY'],
  email: ENV['MDMCERT_DOWNLOAD_EMAIL'],
  csr: Base64.strict_encode64(push_csr_str),
  encrypt: Base64.strict_encode64(server_cert_str),
})

if response.status == 200 && response.body['result'] == 'success'
  "Email titled as 'do_not_reply' including .p7 will be sent to #{ENV['MDMCERT_DOWNLOAD_EMAIL']}."
end
