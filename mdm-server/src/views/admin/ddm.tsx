import { AdminPage, DeleteForm, payloadYamlText, typedYamlText } from "./shared";

export interface DdmGroupSummary {
  id: number;
  name: string;
  items: string[];
}

export interface DdmActivationTargetSummary {
  activationId: number;
  activationName: string;
  activationType: string;
  activationPayloadJson: string;
  targetIdentifier: string | null;
}

export interface DdmConfigurationSummary {
  id: number;
  name: string;
  type: string;
  payloadJson: string;
}

export interface DdmDetailSummary {
  id?: number;
  targetIdentifier: string | null;
  payloadJson: string;
  accessUrl?: string;
}

export interface DdmMasterSummary {
  id: number;
  name: string;
  type?: string;
  details: DdmDetailSummary[];
}

function ddmCrumbs(tail: string) {
  return [
    { href: "/", label: "TOP" },
    { href: "/ddm", label: "Declarative Device Management" },
    { label: tail },
  ];
}

/** DDM overview (ported from `views/ddm/index.html.erb`). */
export function DdmIndexPage(options: {
  groups: DdmGroupSummary[];
  activationTargets: DdmActivationTargetSummary[];
  configurations: DdmConfigurationSummary[];
  assets: DdmMasterSummary[];
  managements: DdmMasterSummary[];
  publicAssets: DdmMasterSummary[];
}) {
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { label: "Declarative Device Management" },
    ],
    children: (
      <>
        <h2>Declarative device management</h2>
        <div class="list-group">
          <a href="/ddm/device_groups" class="list-group-item list-group-item-action">
            <h3>Device groups</h3>
            <ul>
              {options.groups.map((group) => (
                <li>
                  {group.name}
                  <ul>
                    {group.items.map((item) => (
                      <li>{item}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </a>
          <a href="/ddm/activations" class="list-group-item list-group-item-action">
            <h3>Activations</h3>
            <ul>
              {options.activationTargets.map((target) => (
                <li>
                  [{target.targetIdentifier ?? "ALL"}] {target.activationName}
                  <pre>
                    {typedYamlText(target.activationType, target.activationPayloadJson)}
                  </pre>
                </li>
              ))}
            </ul>
          </a>
          <a href="/ddm/configurations" class="list-group-item list-group-item-action">
            <h3>Configurations</h3>
            <ul>
              {options.configurations.map((configuration) => (
                <li>
                  {configuration.name}
                  <pre>{typedYamlText(configuration.type, configuration.payloadJson)}</pre>
                </li>
              ))}
            </ul>
          </a>
          <a href="/ddm/assets" class="list-group-item list-group-item-action">
            <h3>Assets</h3>
            <ul>
              {options.assets.map((asset) => (
                <li>
                  {asset.name}
                  <ul>
                    {asset.details.map((detail) => (
                      <li>
                        [{detail.targetIdentifier ?? "FALLBACK"}]
                        <pre>{typedYamlText(asset.type ?? "", detail.payloadJson)}</pre>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </a>
          <a href="/ddm/managements" class="list-group-item list-group-item-action">
            <h3>Management properties</h3>
            <ul>
              {options.managements.map((management) => (
                <li>
                  {management.name}
                  <ul>
                    {management.details.map((detail) => (
                      <li>
                        [{detail.targetIdentifier ?? "FALLBACK"}] {detail.payloadJson}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </a>
          <a href="/ddm/public_assets" class="list-group-item list-group-item-action">
            <h3>Public assets</h3>
            <ul>
              {options.publicAssets.map((asset) => (
                <li>
                  {asset.name}
                  <ul>
                    {asset.details.map((detail) => (
                      <li class="text-break">
                        [{detail.targetIdentifier ?? "FALLBACK"}] {detail.accessUrl ?? ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </a>
        </div>
      </>
    ),
  });
}

/** Device group list (ported from `views/ddm/device_groups/index.html.erb`). */
export function DdmDeviceGroupsPage(options: { groups: DdmGroupSummary[] }) {
  return AdminPage({
    crumbs: ddmCrumbs("Device groups"),
    children: (
      <>
        <h2>Device groups</h2>
        <div class="list-group">
          {options.groups.map((group) => (
            <a
              href={`/ddm/device_groups/${group.id}`}
              class="list-group-item list-group-item-action"
            >
              {group.name}
              <ul>
                {group.items.map((item) => (
                  <li>{item}</li>
                ))}
              </ul>
            </a>
          ))}
          <a href="/ddm/device_groups/new" class="list-group-item list-group-item-action">
            + Add device group
          </a>
        </div>
      </>
    ),
  });
}

/** Device group form (ported from `views/ddm/device_groups/show.html.erb`). */
export function DdmDeviceGroupFormPage(options: {
  group: { id: number; name: string } | null;
  serialNumbersText: string;
}) {
  const group = options.group;
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/ddm", label: "Declarative Device Management" },
      { href: "/ddm/device_groups", label: "Device groups" },
      { label: group?.name ?? "NEW" },
    ],
    children: (
      <>
        <h2>Device group: {group?.name ?? "NEW"}</h2>
        <form action={group ? `/ddm/device_groups/${group.id}` : "/ddm/device_groups"} method="post">
          <div class="mb-3">
            <label for="input_name" class="form-label">
              Name
            </label>
            {group ? (
              <>
                <input
                  type="text"
                  class="form-control"
                  id="input_name"
                  name="name"
                  value={group.name}
                  disabled
                />
                <a href={`/ddm/device_groups/${group.id}/rename`}>Rename</a>
              </>
            ) : (
              <input type="text" class="form-control" id="input_name" name="name" value="" />
            )}
          </div>
          <div class="mb-3">
            <label for="input_serial_numbers" class="form-label">
              Device serial numbers
            </label>
            <textarea
              class="form-control"
              id="input_serial_numbers"
              name="serial_numbers"
              rows={20}
            >
              {options.serialNumbersText}
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

/** Rename form (ported from `views/ddm/device_groups/rename.html.erb`). */
export function DdmDeviceGroupRenamePage(options: { group: { id: number; name: string } }) {
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/ddm", label: "Declarative Device Management" },
      { href: "/ddm/device_groups", label: "Device groups" },
      { label: options.group.name },
    ],
    children: (
      <>
        <h2>Device group: {options.group.name}</h2>
        <div class="alert alert-warning" role="alert">
          <h4 class="alert-heading">Warning</h4>
          <p>Activations, Assets, Management properties can refer the device group name.</p>
          <p>Renaming the device group will break the references. Please fix it manually.</p>
        </div>
        <form action={`/ddm/device_groups/${options.group.id}/rename`} method="post">
          <div class="mb-3">
            <label for="input_name" class="form-label">
              Name
            </label>
            <input
              type="text"
              class="form-control"
              id="input_name"
              name="name"
              value={options.group.name}
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

/** Activation list (ported from `views/ddm/activations/index.html.erb`). */
export function DdmActivationsPage(options: { targets: DdmActivationTargetSummary[] }) {
  return AdminPage({
    crumbs: ddmCrumbs("Activations"),
    children: (
      <>
        <h2>Activations</h2>
        <div class="list-group">
          {options.targets.map((target) => (
            <a
              href={`/ddm/activations/${target.activationId}`}
              class="list-group-item list-group-item-action"
            >
              [{target.targetIdentifier ?? "ALL"}] {target.activationName}
              <pre>{typedYamlText(target.activationType, target.activationPayloadJson)}</pre>
            </a>
          ))}
          <a href="/ddm/activations/new" class="list-group-item list-group-item-action">
            + Add activation
          </a>
        </div>
      </>
    ),
  });
}

/** Activation form (ported from `views/ddm/activations/show.html.erb`). */
export function DdmActivationFormPage(options: {
  activation: { id: number; name: string } | null;
  payloadYaml: string;
  targetIdentifiersText: string;
}) {
  const activation = options.activation;
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/ddm", label: "Declarative Device Management" },
      { href: "/ddm/activations", label: "Activations" },
      { label: activation?.name ?? "NEW" },
    ],
    children: (
      <>
        <h2>Activation: {activation?.name ?? "NEW"}</h2>
        <form
          action={activation ? `/ddm/activations/${activation.id}` : "/ddm/activations"}
          method="post"
        >
          {activation ? null : (
            <div class="mb-3">
              <label for="input_name" class="form-label">
                Name
              </label>
              <input type="text" class="form-control" id="input_name" name="name" value="" />
            </div>
          )}
          <div class="mb-3">
            <label for="input_type" class="form-label">
              Type
            </label>
            <input
              type="text"
              class="form-control"
              id="input_type"
              name="type"
              value="com.apple.activation.simple"
              readonly
            />
          </div>
          <div class="mb-3">
            <label for="input_payload" class="form-label">
              Payload
            </label>
            <textarea class="form-control" id="input_payload" name="payload" rows={20}>
              {options.payloadYaml}
            </textarea>
          </div>
          <div class="mb-3">
            <label for="input_target_identifiers" class="form-label">
              Target identifiers (describe serial_number or group_name into a line for each, or
              keep blank for all devices)
            </label>
            <textarea
              class="form-control"
              id="input_target_identifiers"
              name="target_identifiers"
              rows={10}
            >
              {options.targetIdentifiersText}
            </textarea>
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
        {activation ? (
          <DeleteForm
            action={`/ddm/activations/${activation.id}/delete`}
            confirm={`Delete activation ${activation.name}?`}
            label="Delete this activation"
          />
        ) : null}
      </>
    ),
  });
}

/** Configuration list (ported from `views/ddm/configurations/index.html.erb`). */
export function DdmConfigurationsPage(options: { configurations: DdmConfigurationSummary[] }) {
  return AdminPage({
    crumbs: ddmCrumbs("Configurations"),
    children: (
      <>
        <h2>Configurations</h2>
        <div class="list-group">
          {options.configurations.map((configuration) => (
            <a
              href={`/ddm/configurations/${configuration.id}`}
              class="list-group-item list-group-item-action"
            >
              {configuration.name}
              <pre>{typedYamlText(configuration.type, configuration.payloadJson)}</pre>
            </a>
          ))}
          <a href="/ddm/configurations/new" class="list-group-item list-group-item-action">
            + Add configuration
          </a>
        </div>
      </>
    ),
  });
}

/** Configuration form (ported from `views/ddm/configurations/show.html.erb`). */
export function DdmConfigurationFormPage(options: {
  configuration: { id: number; name: string; type: string } | null;
  payloadYaml: string;
}) {
  const configuration = options.configuration;
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/ddm", label: "Declarative Device Management" },
      { href: "/ddm/configurations", label: "Configurations" },
      { label: configuration?.name ?? "NEW" },
    ],
    children: (
      <>
        <h2>Configuration: {configuration?.name ?? "NEW"}</h2>
        <form
          action={configuration ? `/ddm/configurations/${configuration.id}` : "/ddm/configurations"}
          method="post"
        >
          {configuration ? null : (
            <div class="mb-3">
              <label for="input_name" class="form-label">
                Name
              </label>
              <input type="text" class="form-control" id="input_name" name="name" value="" />
            </div>
          )}
          <div class="mb-3">
            <label for="input_type" class="form-label">
              Type
            </label>
            <input
              type="text"
              class="form-control"
              id="input_type"
              name="type"
              value={configuration?.type ?? ""}
            />
          </div>
          <div class="mb-3">
            <label for="input_payload" class="form-label">
              Payload
            </label>
            <textarea class="form-control" id="input_payload" name="payload" rows={20}>
              {options.payloadYaml}
            </textarea>
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
        {configuration ? (
          <DeleteForm
            action={`/ddm/configurations/${configuration.id}/delete`}
            confirm={`Delete configuration ${configuration.name}?`}
            label="Delete this configuration"
          />
        ) : null}
      </>
    ),
  });
}

export interface DdmDetailsOption {
  basePath: string;
  section: string;
  heading: string;
  singular: string;
  emptyLabel: string;
  typeInput: { value: string; readonly: boolean } | null;
}

/** Master list + new-master form, shared by assets/managements/public assets. */
export function DdmMastersPage(
  options: DdmDetailsOption & { masters: DdmMasterSummary[]; showPayload: boolean },
) {
  return AdminPage({
    crumbs: ddmCrumbs(options.section),
    children: (
      <>
        <h2>{options.section}</h2>
        <div class="list-group">
          {options.masters.map((master) => (
            <a
              href={`${options.basePath}/${master.id}/details`}
              class="list-group-item list-group-item-action"
            >
              {master.name}
              <ul>
                {master.details.map((detail) => (
                  <li class={options.showPayload ? undefined : "text-break"}>
                    {options.showPayload ? (
                      <>
                        [{detail.targetIdentifier ?? "FALLBACK"}]
                        <pre>{typedYamlText(master.type ?? "", detail.payloadJson)}</pre>
                      </>
                    ) : (
                      <>
                        [{detail.targetIdentifier ?? "FALLBACK"}] {detail.accessUrl ?? ""}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </a>
          ))}
        </div>
        <h3>New {options.singular}</h3>
        <form class="card p-3" action={options.basePath} method="post">
          <div class="mb-3">
            <label for="form_name" class="form-label">
              Name
            </label>
            <input id="form_name" name="name" type="text" class="form-control" required />
          </div>
          {options.typeInput ? (
            <div class="mb-3">
              <label for="input_type" class="form-label">
                Type
              </label>
              <input
                type="text"
                class="form-control"
                id="input_type"
                name="type"
                value={options.typeInput.value}
                readonly={options.typeInput.readonly || undefined}
              />
            </div>
          ) : null}
          <button type="submit" class="btn btn-primary">
            Create
          </button>
        </form>
      </>
    ),
  });
}

export interface DdmDetailFormOption {
  master: { id: number; name: string; type?: string };
  detail: { id: number; targetIdentifier: string | null; payloadYaml: string } | null;
  details: DdmDetailSummary[];
  targetOptions: string[];
  deleteConfirm: string;
}

/**
 * Details list + target form, shared by assets/managements.
 * Public assets use `DdmPublicAssetDetailsPage` (file upload instead of YAML).
 */
export function DdmDetailsPage(options: DdmDetailsOption & DdmDetailFormOption) {
  const { master, detail } = options;
  return AdminPage({
    crumbs: detail
      ? [
          { href: "/", label: "TOP" },
          { href: "/ddm", label: "Declarative Device Management" },
          { href: options.basePath, label: options.section },
          { href: `${options.basePath}/${master.id}/details`, label: master.name },
          { label: detail.targetIdentifier ?? "" },
        ]
      : [
          { href: "/", label: "TOP" },
          { href: "/ddm", label: "Declarative Device Management" },
          { href: options.basePath, label: options.section },
          { label: master.name },
        ],
    children: (
      <>
        <h2>
          {options.heading}: {master.name}
        </h2>
        {detail ? null : (
          <div class="list-group">
            {options.details.map((row) => (
              <a
                href={`${options.basePath}/${master.id}/details/${row.id}`}
                class="list-group-item list-group-item-action"
              >
                [{row.targetIdentifier ?? "FALLBACK"}]
                <pre>{typedYamlText(master.type ?? "", row.payloadJson)}</pre>
              </a>
            ))}
          </div>
        )}
        <h3>{detail ? "Edit target" : "New target"}</h3>
        <form class="card p-3" action={`${options.basePath}/${master.id}/details`} method="post">
          <div class="mb-3">
            <label for="form_target_identifier" class="form-label">
              Target (serial_number, group_name, or blank for all devices)
            </label>
            <input
              id="form_target_identifier"
              name="target_identifier"
              list="target_options"
              type="text"
              value={detail?.targetIdentifier ?? ""}
              class="form-control"
            />
            <datalist id="target_options">
              {options.targetOptions.map((value) => (
                <option value={value} />
              ))}
            </datalist>
          </div>
          <div class="mb-3">
            <label for="input_type" class="form-label">
              Type
            </label>
            <input
              type="text"
              class="form-control"
              id="input_type"
              name="type"
              value={master.type ?? ""}
              readonly
            />
          </div>
          <div class="mb-3">
            <label for="input_payload" class="form-label">
              Payload
            </label>
            <textarea class="form-control" id="input_payload" name="payload" rows={20}>
              {detail?.payloadYaml ?? payloadYamlText(null)}
            </textarea>
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
        <DeleteForm
          action={`${options.basePath}/${master.id}/delete`}
          confirm={options.deleteConfirm.replace("{name}", master.name)}
          label={`Delete this ${options.singular}`}
        />
      </>
    ),
  });
}

export interface DdmPublicAssetDetailOption {
  master: { id: number; name: string };
  detail: { id: number; targetIdentifier: string | null } | null;
  details: DdmDetailSummary[];
  detailLinks: { id: number; targetIdentifier: string | null; accessUrl: string }[];
  targetOptions: string[];
}

/** Public asset details (ported from `views/ddm/public_assets/details.html.erb`). */
export function DdmPublicAssetDetailsPage(options: DdmPublicAssetDetailOption) {
  const { master, detail } = options;
  return AdminPage({
    crumbs: detail
      ? [
          { href: "/", label: "TOP" },
          { href: "/ddm", label: "Declarative Device Management" },
          { href: "/ddm/public_assets", label: "Public assets" },
          { href: `/ddm/public_assets/${master.id}/details`, label: master.name },
          { label: detail.targetIdentifier ?? "" },
        ]
      : [
          { href: "/", label: "TOP" },
          { href: "/ddm", label: "Declarative Device Management" },
          { href: "/ddm/public_assets", label: "Public assets" },
          { label: master.name },
        ],
    children: (
      <>
        <h2>Public assets - {master.name}</h2>
        {detail ? null : (
          <div class="list-group">
            {options.detailLinks.map((row) => (
              <a
                href={`/ddm/public_assets/${master.id}/details/${row.id}`}
                class="list-group-item list-group-item-action text-break"
              >
                [{row.targetIdentifier ?? "FALLBACK"}] {row.accessUrl}
              </a>
            ))}
          </div>
        )}
        {detail ? (
          <form
            action={`/ddm/public_assets/${master.id}/details/${detail.id}/delete`}
            method="post"
            onsubmit="return confirm('Are you sure you want to delete this detail?')"
          >
            <button type="submit" class="btn btn-danger mt-2">
              Delete
            </button>
          </form>
        ) : null}
        <h3>{detail ? "Edit target" : "New target"}</h3>
        <form
          class="card p-3"
          action={`/ddm/public_assets/${master.id}/details`}
          method="post"
          enctype="multipart/form-data"
        >
          <div class="mb-3">
            <label for="form_target_identifier" class="form-label">
              Target (serial_number, group_name, or blank for all devices)
            </label>
            <input
              id="form_target_identifier"
              name="target_identifier"
              list="target_options"
              type="text"
              value={detail?.targetIdentifier ?? ""}
              class="form-control"
            />
            <datalist id="target_options">
              {options.targetOptions.map((value) => (
                <option value={value} />
              ))}
            </datalist>
          </div>
          <div class="mb-3">
            <label for="form_asset_file" class="form-label">
              File
            </label>
            <input id="form_asset_file" name="asset_file" type="file" class="form-control" required />
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
        <DeleteForm
          action={`/ddm/public_assets/${master.id}/delete`}
          confirm={`Delete public asset ${master.name} and all of its files?`}
          label="Delete this public asset"
        />
      </>
    ),
  });
}
