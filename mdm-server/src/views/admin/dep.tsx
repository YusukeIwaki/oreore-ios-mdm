import { stringify as stringifyYaml } from "yaml";
import { urlEncodeFilename } from "../../vpp/token";
import { AdminPage, prettyJson } from "./shared";

export interface DepTokenListItem {
  filename: string;
}

/** YAML body without the `---` header line (Ruby `to_yaml.split("\n")[1..]`). */
export function yamlBodyText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return stringifyYaml(value);
}

/** DEP token list (ported from `views/dep/index.html.erb`). */
export function DepIndexPage(options: { tokens: DepTokenListItem[] }) {
  return AdminPage({
    crumbs: [{ href: "/", label: "TOP" }, { label: "Automated Device Enrollment" }],
    children: (
      <>
        <h2>Automated Device Enrollment</h2>
        <a href="/dep/pub_key.pem" class="btn btn-outline-primary">
          Download public key file
        </a>
        <p>
          After downloading, upload the public key file to Apple Business Manager or Apple School
          Manager.
        </p>
        <hr />
        <h3>DEP server tokens</h3>
        <div class="list-group">
          {options.tokens.map((token) => (
            <a
              href={`/dep/${urlEncodeFilename(token.filename)}`}
              class="list-group-item list-group-item-action"
            >
              {token.filename}
            </a>
          ))}
        </div>
        <form action="/dep" method="post" enctype="multipart/form-data" class="card p-3">
          <div class="mb-3">
            <label for="input_dep_token_file" class="form-label">
              DEP token p7m file
            </label>
            <input
              id="input_dep_token_file"
              name="dep_token_file"
              type="file"
              class="form-control"
              required
            />
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
      </>
    ),
  });
}

function tokenCrumbs(filename: string, tail?: { href?: string; label: string }) {
  const crumbs = [
    { href: "/", label: "TOP" },
    { href: "/dep", label: "Automated Device Enrollment" },
    { href: `/dep/${urlEncodeFilename(filename)}`, label: filename },
  ];
  return tail ? [...crumbs.slice(0, 2), { href: crumbs[2].href, label: crumbs[2].label }, tail] : crumbs;
}

/** DEP token detail (ported from `views/dep/show.html.erb`). */
export function DepShowPage(options: { filename: string }) {
  const encoded = urlEncodeFilename(options.filename);
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/dep", label: "Automated Device Enrollment" },
      { label: options.filename },
    ],
    children: (
      <>
        <h2>{options.filename}</h2>
        <ul>
          <li>
            <a href={`/dep/${encoded}/devices`}>Devices</a>
          </li>
          <li>
            <a href={`/dep/${encoded}/profiles/new`}>Setup profile</a>
          </li>
          <li>
            <a href={`/dep/${encoded}/account`}>Get Account Detail</a>
          </li>
          <li>
            <a href={`/dep/${encoded}/os_beta_enrollment_tokens`}>Beta Enrollment Tokens</a>
          </li>
          <li>
            <a href={`/dep/${encoded}/account_driven_enrollment_profile`}>
              Account-driven Enrollment Profile
            </a>
          </li>
        </ul>
      </>
    ),
  });
}

/** Live account detail (ported from `views/dep/account.html.erb`). */
export function DepAccountPage(options: {
  filename: string;
  accountJson: unknown;
  error: { message: string; body?: string } | null;
}) {
  return AdminPage({
    crumbs: tokenCrumbs(options.filename, { label: "Get Account Detail" }),
    children: (
      <>
        <h2>Account Detail</h2>
        {options.error ? (
          <>
            {options.error.message}
            <br />
            {options.error.body ?? ""}
          </>
        ) : (
          <pre>{prettyJson(options.accountJson)}</pre>
        )}
      </>
    ),
  });
}

export interface BetaEnrollmentToken {
  title: string;
  os: string;
  token: string;
}

/** Beta tokens (ported from `views/dep/os_beta_enrollment_tokens.html.erb`). */
export function DepBetaTokensPage(options: { filename: string; tokens: BetaEnrollmentToken[] }) {
  return AdminPage({
    crumbs: tokenCrumbs(options.filename, { label: "OS Beta Enrollment Tokens" }),
    children: (
      <>
        <h2>OS Beta Enrollment Tokens</h2>
        <table class="table">
          <thead>
            <tr>
              <th scope="col">title</th>
              <th scope="col">os</th>
              <th scope="col">token</th>
            </tr>
          </thead>
          <tbody>
            {options.tokens.map((token) => (
              <tr>
                <th scope="row">{token.title}</th>
                <td>{token.os}</td>
                <td>{token.token}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  });
}

/** Account-driven enrollment profile (ported from its ERB). */
export function DepAddeProfilePage(options: {
  filename: string;
  discoveryUrl: string;
  lastUpdatedTimestamp: string;
  baseUrl: string;
}) {
  const encoded = urlEncodeFilename(options.filename);
  return AdminPage({
    crumbs: tokenCrumbs(options.filename, { label: "Account-driven Enrollment Profile" }),
    children: (
      <>
        <h2>Account-driven Enrollment Profile</h2>
        <form
          action={`/dep/${encoded}/account_driven_enrollment_profile`}
          method="post"
          enctype="multipart/form-data"
          class="p-3"
        >
          <div class="mb-3">
            <label for="input_url" class="form-label">
              Account-driven Enrollment Profile{" "}
              {options.lastUpdatedTimestamp ? (
                <b>(last_updated_timestamp: {options.lastUpdatedTimestamp})</b>
              ) : null}
            </label>
            <input
              id="input_url"
              name="url"
              value={options.discoveryUrl}
              type="text"
              class="form-control"
              required
            />
            <p class="form-text">
              Specify "{options.baseUrl}/mdm_service_discovery" to use this server.
            </p>
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
      </>
    ),
  });
}

export interface DepDeviceJson {
  serial_number?: unknown;
  profile_uuid?: unknown;
  [key: string]: unknown;
}

/** DEP device list (ported from `views/dep/devices.html.erb`). */
export function DepDevicesPage(options: {
  filename: string;
  devices: DepDeviceJson[];
  fetchedUntil: string;
  moreToFollow: boolean;
  cursor: string;
  singleDevice: boolean;
  error: { message: string; body?: string } | null;
}) {
  const encoded = urlEncodeFilename(options.filename);
  return AdminPage({
    crumbs: tokenCrumbs(options.filename, { label: "Devices" }),
    children: (
      <>
        <h2>DEP devices</h2>
        {options.error ? (
          <>
            {options.error.message}
            <br />
            {options.error.body ?? ""}
          </>
        ) : (
          <>
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">SERIAL</th>
                  <th scope="col">profile</th>
                  <th scope="col">etc</th>
                </tr>
              </thead>
              <tbody>
                {options.devices.map((device) => {
                  const serial = String(device.serial_number ?? "");
                  const profileEntries = pickByPrefix(device, "profile");
                  const otherEntries = rejectKeys(device, (key) =>
                    key === "serial_number" || key.startsWith("profile"),
                  );
                  return (
                    <tr>
                      <th scope="row">{serial}</th>
                      <td>
                        {device.profile_uuid ? (
                          <ul>
                            <li>
                              <a href={`/dep/${encoded}/profiles/${device.profile_uuid}`}>
                                {String(device.profile_uuid)}
                              </a>
                            </li>
                            <li>
                              <a href={`/dep/${encoded}/devices/${serial}/remove_profile`}>
                                Remove profile
                              </a>
                            </li>
                          </ul>
                        ) : (
                          <>
                            <ul>
                              <li>
                                <a href={`/dep/${encoded}/profiles/new?serial_number=${serial}`}>
                                  Setup profile
                                </a>
                              </li>
                            </ul>
                            <pre>{yamlBodyText(profileEntries)}</pre>
                          </>
                        )}
                      </td>
                      <td>
                        <pre>{yamlBodyText(otherEntries)}</pre>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {options.singleDevice ? null : (
              <>
                Results until {options.fetchedUntil} are listed.
                {options.moreToFollow ? <a href={`?cursor=${options.cursor}`}>NEXT</a> : null}
              </>
            )}
          </>
        )}
      </>
    ),
  });
}

function pickByPrefix(record: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith(prefix)) {
      out[key] = value;
    }
  }
  return out;
}

function rejectKeys(
  record: Record<string, unknown>,
  reject: (key: string) => boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!reject(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** New-profile form (ported from the `new` branch of `views/dep/profile.html.erb`). */
export function DepProfileNewPage(options: {
  filename: string;
  baseUrl: string;
  serialNumber: string;
}) {
  const encoded = urlEncodeFilename(options.filename);
  const devicesYaml = options.serialNumber
    ? `  - ${options.serialNumber}\n`
    : "  - SERIALNUMBER1\n  - SERIALNUMBER2\n";
  const template =
    "---\n" +
    "# https://developer.apple.com/documentation/devicemanagement/profile\n" +
    "allow_pairing: true\n" +
    `configuration_web_url: ${options.baseUrl}/mdm/dep_enroll\n` +
    "department: oreore-mdm Organization\n" +
    "devices:\n" +
    devicesYaml +
    "is_mandatory: true\n" +
    "is_mdm_removable: false\n" +
    "is_multi_user: false\n" +
    "is_supervised: true\n" +
    "language: ja\n" +
    "profile_name: oreore-mdm DEP profile\n" +
    "skip_setup_items:\n" +
    [
      "Accessibility",
      "ActionButton",
      "Android",
      "Appearance",
      "AppleID",
      "AppStore",
      "Biometric",
      "DeviceToDeviceMigration",
      "Diagnostics",
      "EnableLockdownMode",
      "iMessageAndFaceTime",
      "Location",
      "MessagingActivationUsingPhoneNumber",
      "OnBoarding",
      "Passcode",
      "Payment",
      "Privacy",
      "Restore",
      "RestoreCompleted",
      "Safety",
      "ScreenTime",
      "SIMSetup",
      "Siri",
      "SoftwareUpdate",
      "TapToSetup",
      "TermsOfAddress",
      "TOS",
      "UpdateCompleted",
      "WatchMigration",
      "Welcome",
      "Zoom",
    ]
      .map((item) => `  - ${item}\n`)
      .join("") +
    `url: ${options.baseUrl}/mdm/command\n`;
  return AdminPage({
    crumbs: tokenCrumbs(options.filename, { label: "Define a new profile" }),
    children: (
      <>
        <h2>Setup a profile</h2>
        <form action={`/dep/${encoded}/profiles`} method="post">
          <div class="mb-3">
            <label for="input_payload" class="form-label">
              Payload
            </label>
            <textarea class="form-control" id="input_payload" name="payload" rows={20}>
              {template}
            </textarea>
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
      </>
    ),
  });
}

/** Existing-profile detail + assign form (ported from `views/dep/profile.html.erb`). */
export function DepProfileShowPage(options: {
  filename: string;
  profileUuid: string;
  profileJson: unknown;
}) {
  const encoded = urlEncodeFilename(options.filename);
  return AdminPage({
    crumbs: tokenCrumbs(options.filename, { label: `Profiles-${options.profileUuid}` }),
    children: (
      <>
        <h2>Profile - {options.profileUuid}</h2>
        <div class="card p-3 mb-4">
          <pre>{prettyJson(options.profileJson)}</pre>
        </div>
        <div class="card p-3 mb-4">
          <details>
            <summary>Assign to devices</summary>
            <form action={`/dep/${encoded}/profiles/${options.profileUuid}/assign`} method="post">
              <div class="mb-3">
                <label for="input_serial_numbers" class="form-label">
                  Device serial numbers
                </label>
                <textarea
                  class="form-control"
                  id="input_serial_numbers"
                  name="serial_numbers"
                  rows={20}
                />
              </div>
              <button type="submit" class="btn btn-primary">
                Submit
              </button>
            </form>
          </details>
        </div>
      </>
    ),
  });
}
