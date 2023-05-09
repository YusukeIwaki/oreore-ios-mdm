# oreore-ios-mdm

Set environment variables below:

- MDMCERT_DOWNLOAD_API_KEY
- MDMCERT_DOWNLOAD_EMAIL

then execute `bundle exec ruby util/mdmcert_download_request.rb` for requesting signing.

After receiving an email with an attachment named **.b64.p7, execute `bundle exec ruby util/mdmcert_download_decrypt.rb <path to **.b64.p7>`.

Upload util/push_signed.req to https://identity.apple.com/pushcert/ and download push certificate.

`PUSH_CERTIFICATE_PASSWORD=your_top_secret bundle exec ruby util/use_push_certificate.rb <path to push_certificate .pem file>` will show which value to be set into `PUSH_CERTIFICATE_BASE64`.

Following environment variables should be configured before launching MDM server.

- MDM_SERVER_BASE_URL
- PUSH_CERTIFICATE_PASSWORD
- PUSH_CERTIFICATE_BASE64
- SERVER_PRIVATE_KEY_BASE64
