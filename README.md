# oreore-ios-mdm

## Prepare Google OAuth apps

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET

and set allowed user names like this: `export GOOGLE_ALLOWED_USERS=test@gmail.com,iwaki@example.com` or `export GOOGLE_ALLOWED_DOMAINS=mail1.example.com,mail2.example.com`

## Prepare MDM push certificate

At first, `bundle exec ruby util/create_server_certificates.rb` generates server keys and certificates, and push certificate sign request.

Set environment variables below:

- MDMCERT_DOWNLOAD_API_KEY
- MDMCERT_DOWNLOAD_EMAIL

then execute `bundle exec ruby util/mdmcert_download_request.rb` for requesting signing.

After receiving an email with an attachment named **.b64.p7, execute `bundle exec ruby util/mdmcert_download_decrypt.rb <path to **.b64.p7>`.

(or if you happen to have MDM vendor certificate p12 file, `MDM_VENDOR_CERT_P12_PATH=<path to **.p12> MDM_VENDOR_CERT_P12_PASSWORD=<passphrase> bundle exec ruby util/mdm_vendor_sign.rb` will create `util/push_signed.req` using the specified MDM vendor certificate.)

Upload util/push_signed.req to https://identity.apple.com/pushcert/ and download push certificate.

`PUSH_CERTIFICATE_PASSWORD=your_top_secret bundle exec ruby util/use_push_certificate.rb <path to push_certificate .pem file>` will show which value to be set into `PUSH_CERTIFICATE_BASE64`, `SERVER_PRIVATE_KEY_BASE64`, and `DEVICE_CERTIFICATE_BASE64`.

Following environment variables should be configured before launching MDM server.

- MDM_SERVER_BASE_URL
- PUSH_CERTIFICATE_PASSWORD
- PUSH_CERTIFICATE_BASE64
- SERVER_PRIVATE_KEY_BASE64
- DEVICE_CERTIFICATE_BASE64
- MDM_MOBILECONFIG_PAYLOAD_UUID

`MDM_MOBILECONFIG_PAYLOAD_UUID` can be generated by `SecureRandom.uuid`

## Prepare PostgreSQL

```
$ bundle exec ridgepole -c $DATABASE_URL --apply
```

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

## Declaration

UI is available on `https://<your domain>/ddm`, however bulk-insert is hard to do with web-UI. So we can also prepare declaration using console.

### Defining device group

```ruby
group1 = DeviceGroup.create!(name: 'group1)
group1.items.create!(device_identifier: 'SERIALNUMBER1')
group1.items.create!(device_identifier: 'SERIALNUMBER2')
```

### Defining configuration

```ruby
Ddm::Configuration.create!(
  name: 'status_report_subscription',
  type: 'com.apple.configuration.management.status-subscriptions',
  payload: {
    StatusItems: [
      { Name: 'device.identifier.serial-number' },
      { Name: 'device.identifier.udid' },
      { Name: 'device.operating-system.build-version' },
      { Name: 'device.operating-system.family' },
      { Name: 'device.operating-system.marketing-name' },
      { Name: 'device.operating-system.supplemental.build-version' },
      { Name: 'device.operating-system.supplemental.extra-version' },
      { Name: 'device.operating-system.version' },
      { Name: 'management.declarations' },
    ],
  }
)
```

List of the configuration types are available at [apple/device-management](https://github.com/apple/device-management/tree/release/declarative/declarations/configurations) on GitHub.

We can define a configuration with assets.

```ruby
Ddm::Configuration.create!(
  name: 'group1_member_gmail',
  type: 'com.apple.configuration.account.google',
  payload: {
    VisibleName: 'Google Mail',
    UserIdentityAssetReference: '@asset/group1_member_gmail',
  }
)
```

`@asset/group1_member_gmail` is automatically replaced with the identifier of the asset defined in the asset named 'group1_member_gmail'.

We can also define a configuration with a reference to a public file.

```ruby
Ddm::Configuration.create!(
  name: 'wifi_office_profile',
  type: 'com.apple.configuration.legacy',
  payload: {
    ProfileURL: "@public/wifi_office",
  }
)
```

`@public/wifi_office` is automatically replaced with the URL of the public file defined in the public asset named 'wifi_office.mobileconfig'.

### Defining activation

```ruby
activation = Ddm::Activation.create!(
  name: 'apply_wifi_office_profile',
  type: 'com.apple.activation.simple',
  predicate: "@status(device.model.family) == 'iPhone'",
  standard_configurations: [
    '@configuration/wifi_office_profile',
    '@configuration/status_report_subscription',
  ],
)

# for applying to all devices
activation.targets.create!(target_identifier: nil)

# for applying to a specific device group
activation.targets.create!(target_identifier: 'group1')

# for applying to a specific device
activation.targets.create!(target_identifier: 'SERIALNUMBER1')
```

Configuration can be referred by `@configuration/<configuration name>`.

### Defining asset

Asset can be separately distributed to a specific device or a specific device group.

```ruby
asset_def = Ddm::Asset.create!(name: 'group1_member_gmail')

# asset definition for a specific device
asset_def.details.create!(
  target_identifier: 'SERIALNUMBER1',
  payload: { EmailAddress: 'user1@gmail.com' }
)

# asset definition for a specific device group except for a specific device
asset_def.details.create!(
  target_identifier: 'group',
  payload: { EmailAddress: 'group@gmail.com' }
)

# asset definition for all devices except for a specific device nor a specific device group
asset_def.details.create!(
  target_identifier: nil,
  payload: { EmailAddress: 'default@gmail.com' }
)
```

### Defining management property

Management property can be separately distributed to a specific device or a specific device group, just like assets.

```ruby
property_def = Ddm::Property.create!(name: 'age')
property_def.details.create!(
  target_identifier: 'born_in_1990',
  payload: { age: 31 }
)
property_def.details.create!(
  target_identifier: 'born_in_2000',
  payload: { age: 21 }
)
```

### Describe declaration items

Each declaration item should have `type`, `payload`. Please refer [official reference](https://developer.apple.com/documentation/devicemanagement/leveraging_the_declarative_management_data_model_to_scale_devices#3993591) and [schema docs](https://github.com/apple/device-management/blob/release/declarative/declarations/declarationbase.yaml) to understand which one to use.

### Re-distribute the declaration after updating it

After updating the declaration, we have to re-distribute the declaration to the devices using `DeclarativeManagement` MDM command.

## Example app for Account-driven User/Device Enrollment

```
ruby testaccount.rb
```

will launch a test server with Sinatra, just for serving `.well-known/com.apple.remotemanagement`.

Note that this test server requires `MDM_SERVER_BASE_URL` environment variable set.

iOS (> 17) devices will get a MDM configuration of Device Enrollment (ADDE) while iOS <= 16 will get a configuration of User Enrollment (BYOD).
