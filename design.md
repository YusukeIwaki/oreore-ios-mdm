```
- MDM_SERVER_BASE_URL
- PUSH_CERTIFICATE_PASSWORD
- PUSH_CERTIFICATE_BASE64
- SERVER_PRIVATE_KEY_BASE64
- DEVICE_CERTIFICATE_BASE64
- MDM_MOBILECONFIG_PAYLOAD_UUID
```

## Declaration

```
device_groups/
|-group1.yml
|-group2.yml
```

```group1.yml
- SERIALNUMBER1
- SERIALNUMBER2
```

```
activations/
  group1/
    |-apply_x_profile_for_iphone.yml
  SERIALNUMBER2/
    |-apply_y_profile.yml
  apply_z_profile.yml
```

```apply_x_profile_for_iphone.yml
Predicate: device.family == 'iPhone'
StandardConfigurations:
- "@configurations/apply_x_profile"
```

```apply_y_profile.yml
StandardConfigurations:
- "@configurations/y_google"
- "@configurations/y_mail"
```

```apply_z_profile.yml
StandardConfigurations:
- "@configurations/apply_z_profile"
```

| device with   | will get the configurations                        |
| :------------ | :------------------------------------------------- |
| SERIALNUMBER1 | apply_x_profile, apply_z_profile                   |
| SERIALNUMBER2 | apply_x_profile, y_google, y_mail, apply_z_profile |
| SERIALNUMBER3 | apply_z_profile                                    |

```
configurations
  |-apply_x_profile.yml
  |-y_google.yml
  |-y_mail.yml
  |-apply_z_profile.yml
```

```y_google.yml
type: com.apple.configuration.account.google
VisibleName: USER2
UserIdentityAssetReference: @assets/y_google
```

```apply_x_profile.yml
type: com.apple.configuration.legacy
ProfileURL: "@public/x_profile.mobileconfig"
```

```
assets
|-y_google
  |-SERIALNUMBER1.yml
  |-group2.yml
|-y_google.yml
```

resolve order: SERIALNUMBER > group > default

```SERIALNUMBER1.yml
type: com.apple.asset.useridentity
FullName: user1
EmailAddress: user1@example.com
```

```group2.yml
type: com.apple.asset.useridentity
FullName: group2 shared
EmailAddress: group2@ml.example.com
```

```
properties/
├── age
│   ├── SERIALNUMBER1.yml (age: 10)
│   └── group1.yml (age: 18)
├── age.yml (age: 100000)
└── role
    └── group1.yml (role: manager)
```

| device with   | will get the property  |
| :------------ | :--------------------- |
| SERIALNUMBER1 | age: 10, role: manager |
| SERIALNUMBER2 | age: 18, role: manager |
| SERIALNUMBER3 | age: 100000            |
