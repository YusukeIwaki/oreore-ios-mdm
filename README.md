# oreore-ios-mdm

## Prepare MDM push certificate

At first, `bundle exec ruby util/create_server_certificates.rb` generates server keys and certificates, and push certificate sign request.

Set environment variables below:

- MDMCERT_DOWNLOAD_API_KEY
- MDMCERT_DOWNLOAD_EMAIL

then execute `bundle exec ruby util/mdmcert_download_request.rb` for requesting signing.

After receiving an email with an attachment named **.b64.p7, execute `bundle exec ruby util/mdmcert_download_decrypt.rb <path to **.b64.p7>`.

(or if you happen to have MDM vendor certificate p12 file, `MDM_VENDOR_CERT_P12_PATH=<path to **.p12> MDM_VENDOR_CERT_P12_PASSWORD=<passphrase> bundle exec ruby util/mdm_vendor_sign.rb` will create `util/push_signed.req` using the specified MDM vendor certificate.)

Upload util/push_signed.req to https://identity.apple.com/pushcert/ and download push certificate.

`PUSH_CERTIFICATE_PASSWORD=your_top_secret bundle exec ruby util/use_push_certificate.rb <path to push_certificate .pem file>` will show which value to be set into `PUSH_CERTIFICATE_BASE64`.

Following environment variables should be configured before launching MDM server.

- MDM_SERVER_BASE_URL
- PUSH_CERTIFICATE_PASSWORD
- PUSH_CERTIFICATE_BASE64
- SERVER_PRIVATE_KEY_BASE64

## Launch server

Just hit `bundle exec rackup -p 3000`

## Checkin

Install MDM configuration profile into your device.

- `<your domain>` can be local, `https` is required, self-signed SSL cert can be accepted.
- `ngrok http 3000` is also useful for testing.

### via Apple Configurator

Server: oreore-mdm
URL: `https://<your domain>/mdm/appleconfigurator`

### via OTA (Safari)

Visit `https://<your domain>/mdm.mobileconfig`

## Send commands

```
$ bin/console
```

```
push_client = PushClient.new

mdm_push_token = MdmPushToken.last
push_client.send_mdm_notification(
  mdm_push_token,
  commands: [
    Command::DeviceInformation.new,
    Command::InstalledApplicationList.new,
  ],
)
```
