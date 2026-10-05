import { raw } from "hono/html";
import { page } from "../layout";
import { parsePlist } from "../../mdm/plist";
import { prettyJson } from "./shared";

/**
 * Queue rows store plist XML; the Ruby console pretty-prints the decoded
 * hash as JSON, so decode here and fall back to the raw text on failure.
 */
export function plistToPrettyJson(plistXml: string): string {
  try {
    return prettyJson(parsePlist(plistXml));
  } catch {
    return plistXml;
  }
}

export interface DeviceListItem {
  href: string;
  label: string;
}

/** Device list + enrollment QR (ported from `views/devices/index.html.erb`). */
export function DevicesIndexPage(options: { devices: DeviceListItem[]; qrSvg: string }) {
  const body = (
    <>
      <div class="container">
        <h1>Devices</h1>
        {options.devices.length > 0 ? (
          <div class="list-group">
            {options.devices.map((device) => (
              <a href={device.href} class="list-group-item list-group-item-action">
                {device.label}
              </a>
            ))}
          </div>
        ) : (
          "no devices"
        )}
        {raw(options.qrSvg)}
      </div>
      <hr />
      <div class="container">
        misc
        <ul>
          <li>
            <a href="/ddm">Manage declarative device management resources</a>
          </li>
          <li>
            <a href="/rts/wifi_profiles">Manage Return to Service</a>
          </li>
          <li>
            <a href="/dep">Manage Automated Device Enrollment</a>
          </li>
          <li>
            <a href="/vpp">Manage Apps and Books</a>
          </li>
          <li>
            <a href="/ipa">Manage IPA files</a>
          </li>
        </ul>
      </div>
    </>
  );
  return page(body);
}

export interface QueuedCommand {
  requestPayloadJson: string;
  createdAt: Date;
}

export interface CommandHistoryItem {
  requestType: string;
  commandUuid: string;
  createdAt: Date;
}

export interface SyncHistoryItem {
  id: number;
  endpoint: string;
  createdAt: Date;
}

/** Shared by MDM and BYOD device pages (`devices/_command_queue.html.erb`). */
export function CommandQueueView(options: {
  requests: QueuedCommand[];
  handling: QueuedCommand[];
  histories: CommandHistoryItem[];
}) {
  return (
    <>
      {options.requests.length > 0 ? (
        <ul class="list-group">
          {options.requests.map((request) => (
            <li class="list-group-item">
              {plistToPrettyJson(request.requestPayloadJson)}
              {request.createdAt.toISOString()}
            </li>
          ))}
        </ul>
      ) : (
        "No commands."
      )}
      <h3>Handling</h3>
      {options.handling.length > 0 ? (
        <ul class="list-group">
          {options.handling.map((request) => (
            <li class="list-group-item">
              {plistToPrettyJson(request.requestPayloadJson)}
              {request.createdAt.toISOString()}
            </li>
          ))}
        </ul>
      ) : (
        "No commands."
      )}
      <h2>Command History</h2>
      {options.histories.length > 0 ? (
        <div class="list-group">
          {options.histories.slice(-100).map((history) => (
            <a
              href={`/commands/${history.commandUuid}`}
              class="list-group-item list-group-item-action"
            >
              {history.requestType} - {history.commandUuid} ({history.createdAt.toISOString()})
            </a>
          ))}
        </div>
      ) : (
        "no histories"
      )}
    </>
  );
}

export interface PickerItem {
  id: number;
  label: string;
  active: boolean;
}

/**
 * Template picker + payload textarea inside a turbo-frame. The route prepares
 * `payloadText` and the IPA/RTS pickers; the view only renders.
 */
export function CommandRequestFormInner(options: {
  endpointPath: string;
  selectedCommand: string;
  commands: Array<{ value: string; label: string }>;
  payloadText: string;
  installApplicationPicker?: { items: PickerItem[] };
  eraseDevicePicker?: { items: PickerItem[] };
}) {
  const selected = options.selectedCommand;
  const queryFor = (extra: string) =>
    `${options.endpointPath}?command=${selected}${extra}`;
  return (
    <turbo-frame id="command_request_form_inner">
      <select
        class="form-select form-select-sm mb-3"
        onchange={`document.getElementById('command_request_form_inner').src = '${options.endpointPath}?command=' + this.value`}
      >
        {options.commands.map((command) => (
          <option value={command.value} selected={command.value === selected || undefined}>
            {command.label}
          </option>
        ))}
      </select>
      {selected === "InstallApplication" && options.installApplicationPicker ? (
        <div class="list-group mb-3">
          <b>IPA file</b>
          {options.installApplicationPicker.items.map((item) => (
            <a
              href={queryFor(`&ipa_file_id=${item.id}`)}
              class={
                item.active
                  ? "list-group-item list-group-item-action active"
                  : "list-group-item list-group-item-action"
              }
              aria-current={item.active || undefined}
            >
              {item.label}
            </a>
          ))}
        </div>
      ) : null}
      {selected === "EraseDevice" && options.eraseDevicePicker ? (
        <div class="list-group mb-3">
          <b>WiFiProfileData</b>
          {options.eraseDevicePicker.items.map((item) => (
            <a
              href={queryFor(`&rts_wifi_profile_id=${item.id}`)}
              class={
                item.active
                  ? "list-group-item list-group-item-action active"
                  : "list-group-item list-group-item-action"
              }
              aria-current={item.active || undefined}
            >
              {item.label}
            </a>
          ))}
        </div>
      ) : null}
      <div class="mb-3">
        <label for="input_payload" class="form-label">
          Payload
          {selected === "InstallProfile" ? (
            <small class="text-muted">
              (.mobileconfigファイルをドロップするとペイロードを再生成します)
            </small>
          ) : null}
        </label>
        <textarea
          class="form-control"
          id="input_payload"
          name="payload"
          rows={10}
          data-install-profile-drop={selected === "InstallProfile" || undefined}
        >
          {options.payloadText}
        </textarea>
      </div>
      {selected === "InstallProfile" ? (
        <script>
          {raw(`(function() {
      var textarea = document.querySelector('textarea[data-install-profile-drop="true"]');
      if (!textarea) return;

      textarea.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        textarea.classList.add('border-primary');
      });

      textarea.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        textarea.classList.remove('border-primary');
      });

      textarea.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        textarea.classList.remove('border-primary');

        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;

        var formData = new FormData();
        formData.append('mobileconfig_file', file);

        fetch('/install_profile_payload', {
          method: 'POST',
          body: formData,
        }).then(function(response) {
          if (!response.ok) throw new Error('Failed to build payload: ' + response.status);
          return response.text();
        }).then(function(text) {
          textarea.value = text;
        }).catch(function(err) {
          console.error(err);
          alert('Failed to process mobileconfig file: ' + err.message);
        });
      });
    })();`)}
        </script>
      ) : null}
    </turbo-frame>
  );
}

export const MDM_COMMAND_OPTIONS = [
  { value: "", label: "Custom" },
  { value: "DeclarativeManagement", label: "DeclarativeManagement" },
  { value: "DeviceInformation", label: "DeviceInformation" },
  { value: "InstalledApplicationList", label: "InstalledApplicationList" },
  { value: "ProfileList", label: "ProfileList" },
  { value: "InstallProfile", label: "InstallProfile" },
  { value: "InstallApplication", label: "InstallApplication" },
  { value: "RemoveProfile", label: "RemoveProfile" },
  { value: "EnableLostMode", label: "EnableLostMode" },
  { value: "DeviceLocation", label: "DeviceLocation" },
  { value: "DisableLostMode", label: "DisableLostMode" },
  { value: "EraseDevice", label: "EraseDevice" },
];

export const BYOD_COMMAND_OPTIONS = [
  { value: "", label: "Custom" },
  { value: "DeviceInformation", label: "DeviceInformation" },
  { value: "InstalledApplicationList", label: "InstalledApplicationList" },
  { value: "ProfileList", label: "ProfileList" },
];

/** MDM device detail (ported from `views/devices/show.html.erb`). */
export function DeviceShowPage(options: {
  udid: string;
  serialNumber: string;
  formInner: unknown;
  queue: { requests: QueuedCommand[]; handling: QueuedCommand[]; histories: CommandHistoryItem[] };
  syncHistories: SyncHistoryItem[];
}) {
  const body = (
    <div class="container">
      <h1>Device - {options.serialNumber}</h1>
      <h2>Commands</h2>
      <form action={`/devices/${options.udid}/commands`} class="card p-2" method="post">
        {options.formInner as never}
        <button type="submit" class="btn btn-outline-primary">
          Enqueue command
        </button>
      </form>
      <h2>Command Queue</h2>
      <form action={`/devices/${options.udid}/push`} method="post">
        <button type="submit" class="btn btn-outline-primary">
          Request fetching commands
        </button>
      </form>
      <CommandQueueView
        requests={options.queue.requests}
        handling={options.queue.handling}
        histories={options.queue.histories}
      />
      <h2>DeclarativeManagement Synchronization History</h2>
      {options.syncHistories.length > 0 ? (
        <div class="list-group">
          {[...options.syncHistories].reverse().map((history) => (
            <a
              href={`/devices/${options.udid}/synchronization_request_histories/${history.id}`}
              class="list-group-item list-group-item-action"
            >
              {history.endpoint} - ({history.createdAt.toISOString()})
            </a>
          ))}
        </div>
      ) : (
        "no histories"
      )}
    </div>
  );
  return page(body);
}

/** BYOD device detail (ported from `views/byod/devices/show.html.erb`). */
export function ByodDeviceShowPage(options: {
  enrollmentId: string;
  accessTokenJson: string;
  formInner: unknown;
  queue: { requests: QueuedCommand[]; handling: QueuedCommand[]; histories: CommandHistoryItem[] };
}) {
  const body = (
    <div class="container">
      <h1>Device - {options.enrollmentId}</h1>
      <h2>access token</h2>
      <div class="card p-2 mb-4">
        <pre>{options.accessTokenJson}</pre>
      </div>
      <h2>Commands</h2>
      <form
        action={`/byod/devices/${options.enrollmentId}/commands`}
        class="card p-2"
        method="post"
      >
        {options.formInner as never}
        <button type="submit" class="btn btn-outline-primary">
          Enqueue command
        </button>
      </form>
      <h2>Command Queue</h2>
      <form action={`/byod/devices/${options.enrollmentId}/push`} method="post">
        <button type="submit" class="btn btn-outline-primary">
          Request fetching commands
        </button>
      </form>
      <CommandQueueView
        requests={options.queue.requests}
        handling={options.queue.handling}
        histories={options.queue.histories}
      />
    </div>
  );
  return page(body);
}

/** Single command history (ported from `views/mdm_command_history.html.erb`). */
export function CommandHistoryPage(options: { commandUuid: string; request: string; response: string }) {
  const body = (
    <div class="container">
      <h2>Command - {options.commandUuid}</h2>
      <h3>Request</h3>
      <div class="card p-2 mb-4">
        <pre>{options.request}</pre>
      </div>
      <h3>Response</h3>
      <div class="card p-2 mb-4">
        <pre>{options.response}</pre>
      </div>
    </div>
  );
  return page(body);
}

/** Single sync history (ported from `views/devices/synchronization_request_history.html.erb`). */
export function SyncHistoryPage(options: {
  serialNumber: string;
  endpoint: string;
  createdAt: Date;
  requestJson: string;
  responseJson: string;
}) {
  const body = (
    <div class="container">
      <h1>Device - {options.serialNumber}</h1>
      <h2>Endpoint - {options.endpoint}</h2>
      <p>{options.createdAt.toISOString()}</p>
      <h3>Request</h3>
      <div class="card p-2 mb-4">
        <pre>{options.requestJson}</pre>
      </div>
      <h3>Response</h3>
      <div class="card p-2 mb-4">
        <pre>{options.responseJson}</pre>
      </div>
    </div>
  );
  return page(body);
}
