import { urlEncodeFilename } from "../../vpp/token";
import { AdminPage } from "./shared";

export interface IpaListItem {
  filename: string;
}

/** IPA list (ported from `views/ipa/index.html.erb`). */
export function IpaIndexPage(options: { ipas: IpaListItem[] }) {
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { label: "IPA" },
    ],
    children: (
      <>
        <h2>IPA files</h2>
        <div class="list-group">
          {options.ipas.map((ipa) => (
            <a
              href={`/ipa/${urlEncodeFilename(ipa.filename)}`}
              class="list-group-item list-group-item-action"
            >
              {ipa.filename}
            </a>
          ))}
        </div>
        <h3>Add a IPA file</h3>
        <form class="card p-3" action="/ipa" method="post" enctype="multipart/form-data">
          <div class="mb-3">
            <label for="input_bundle_identifier" class="form-label">
              Bundle identifier
            </label>
            <input
              type="text"
              class="form-control"
              id="input_bundle_identifier"
              name="bundle_identifier"
              required
            />
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
      </>
    ),
  });
}

export interface InstallFailure {
  serialNumber: string;
  udid: string;
  error: string;
}

export interface InstallResultView {
  enqueued: number;
  pushSucceeded: number;
  failures: InstallFailure[];
}

export interface InstallDeviceOption {
  udid: string;
  serialNumber: string;
}

/** IPA detail + install form (ported from `views/ipa/show.html.erb`). */
export function IpaShowPage(options: {
  id: number;
  filename: string;
  bundleIdentifier: string;
  manifestUrl: string;
  manifestXml: string;
  devices: InstallDeviceOption[];
  installResult: InstallResultView | null;
}) {
  const result = options.installResult;
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/ipa", label: "IPA" },
      { label: options.filename },
    ],
    children: (
      <>
        <h2>{options.filename}</h2>
        <p>{options.bundleIdentifier}</p>
        <p>
          Manifest URL: <code>{options.manifestUrl}</code>
        </p>
        {result ? (
          <div class="alert alert-info">
            <strong>Install dispatched.</strong>
            Enqueued: {result.enqueued}, Push succeeded: {result.pushSucceeded}, Push failed:{" "}
            {result.failures.length}.
            {result.failures.length > 0 ? (
              <ul class="mb-0 mt-2">
                {result.failures.map((failure) => (
                  <li>
                    {failure.serialNumber} ({failure.udid}): {failure.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <h3>Install to devices</h3>
        {options.devices.length > 0 ? (
          <form
            action={`/ipa/${options.id}/install`}
            method="post"
            class="card p-3 mb-3"
            onsubmit="return confirm('Send InstallApplication to selected devices?')"
          >
            <div class="mb-2">
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                onclick={
                  "document.querySelectorAll('input[name=\"device_identifiers[]\"]').forEach(function(c){c.checked=true})"
                }
              >
                Select all
              </button>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                onclick={
                  "document.querySelectorAll('input[name=\"device_identifiers[]\"]').forEach(function(c){c.checked=false})"
                }
              >
                Clear
              </button>
            </div>
            <div class="list-group mb-3">
              {options.devices.map((device) => (
                <label class="list-group-item">
                  <input
                    type="checkbox"
                    name="device_identifiers[]"
                    value={device.udid}
                    class="form-check-input me-2"
                  />
                  {device.serialNumber}
                  <small class="text-muted ms-2">{device.udid}</small>
                </label>
              ))}
            </div>
            <button type="submit" class="btn btn-primary">
              Install on selected devices
            </button>
          </form>
        ) : (
          <p>No MDM devices registered.</p>
        )}
        <h3>Manifest</h3>
        <div class="card p-3 m-3">
          <pre class="m-0">{options.manifestXml}</pre>
        </div>
        <h3>Update IPA file</h3>
        <form
          class="card p-3"
          action={`/ipa/${options.id}/update`}
          method="post"
          enctype="multipart/form-data"
          onsubmit="return confirm('Are you sure you want to replace this IPA file? The existing file will be deleted.')"
        >
          <div class="mb-3">
            <label for="input_bundle_identifier" class="form-label">
              Bundle identifier
            </label>
            <input
              type="text"
              class="form-control"
              id="input_bundle_identifier"
              name="bundle_identifier"
              value={options.bundleIdentifier}
              required
            />
          </div>
          <div class="mb-3">
            <label for="form_asset_file" class="form-label">
              File
            </label>
            <input id="form_asset_file" name="asset_file" type="file" class="form-control" required />
          </div>
          <button type="submit" class="btn btn-primary">
            Update
          </button>
        </form>
        <form
          action={`/ipa/${options.id}/delete`}
          method="post"
          onsubmit="return confirm('Are you sure you want to delete this IPA file?')"
        >
          <button type="submit" class="btn btn-danger mt-2">
            Delete
          </button>
        </form>
      </>
    ),
  });
}
