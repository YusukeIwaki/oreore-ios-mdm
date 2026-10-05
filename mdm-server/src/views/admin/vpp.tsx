import { urlEncodeFilename } from "../../vpp/token";
import { AdminPage, prettyJson } from "./shared";

export interface VppTokenListItem {
  filename: string;
}

/** VPP token list (ported from `views/vpp/index.html.erb`). */
export function VppIndexPage(options: { tokens: VppTokenListItem[] }) {
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { label: "App and Book management" },
    ],
    children: (
      <>
        <h2>Content tokens</h2>
        <div class="list-group">
          {options.tokens.map((token) => (
            <a
              href={`/vpp/${urlEncodeFilename(token.filename)}`}
              class="list-group-item list-group-item-action"
            >
              {token.filename}
            </a>
          ))}
        </div>
        <h3>Upload VPP content token</h3>
        <form class="card p-3" action="/vpp" method="post" enctype="multipart/form-data">
          <div class="mb-3">
            <label for="form_vpptoken_file" class="form-label">
              File
            </label>
            <input id="form_vpptoken_file" name="vpptoken_file" type="file" class="form-control" required />
          </div>
          <button type="submit" class="btn btn-primary">
            Submit
          </button>
        </form>
      </>
    ),
  });
}

const ASSET_COLUMNS = [
  "adamId",
  "assignedCount",
  "availableCount",
  "deviceAssignable",
  "pricingParam",
  "productType",
  "retiredCount",
  "revocable",
  "totalCount",
  "supportedPlatforms",
];

/** VPP asset list (ported from `views/vpp/show.html.erb`). */
export function VppShowPage(options: {
  filename: string;
  assets: Record<string, unknown>[];
}) {
  const encoded = urlEncodeFilename(options.filename);
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/vpp", label: "App and Book management" },
      { label: options.filename },
    ],
    children: (
      <>
        <h2>{options.filename}</h2>
        <h3>Assets</h3>
        <table class="table table-hover">
          <thead>
            <tr>
              {ASSET_COLUMNS.map((column) => (
                <th scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options.assets.map((asset) => (
              <tr onclick={`location.href='/vpp/${encoded}/${cellText(asset.adamId)}'`}>
                {ASSET_COLUMNS.map((column) => (
                  <td>{cellText(asset[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  });
}

const ASSIGNMENT_COLUMNS = ["adamId", "clientUserId", "pricingParam", "serialNumber"];

/** VPP assignments (ported from `views/vpp/assignments.html.erb`). */
export function VppAssignmentsPage(options: {
  filename: string;
  adamId: string;
  appInfo: unknown;
  showAppInfo: boolean;
  assignments: Record<string, unknown>[];
  currentPageIndex: number;
  totalPages: number;
}) {
  const encoded = urlEncodeFilename(options.filename);
  return AdminPage({
    crumbs: [
      { href: "/", label: "TOP" },
      { href: "/vpp", label: "App and Book management" },
      { href: `/vpp/${encoded}`, label: options.filename },
      { label: options.adamId },
    ],
    children: (
      <>
        {options.showAppInfo ? (
          <>
            <h2>{appName(options.appInfo)}</h2>
            <div class="card p-3">
              <pre>{prettyJson(options.appInfo)}</pre>
            </div>
          </>
        ) : null}
        <h3>License assignments</h3>
        <table class="table">
          <thead>
            <tr>
              {ASSIGNMENT_COLUMNS.map((column) => (
                <th scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options.assignments.map((assignment) => (
              <tr>
                {ASSIGNMENT_COLUMNS.map((column) => (
                  <td>{cellText(assignment[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {options.totalPages >= 2 ? (
          <>
            {options.currentPageIndex >= 1 ? (
              <a href={`?page_index=${options.currentPageIndex - 1}`}>PREV</a>
            ) : null}
            {options.currentPageIndex < options.totalPages - 1 ? (
              <a href={`?page_index=${options.currentPageIndex + 1}`}>NEXT</a>
            ) : null}
          </>
        ) : null}
        <form
          class="card p-3"
          action={`/vpp/${encoded}/${options.adamId}/assignments`}
          method="post"
        >
          <div class="row mb-3">
            <div class="col">
              <label for="input_adam_id" class="form-label">
                Adam ID
              </label>
              <input
                type="text"
                class="form-control"
                id="input_adam_id"
                name="adam_id"
                value={options.adamId}
                readonly
              />
            </div>
            <div class="col">
              <label for="input_serial_number" class="form-label">
                Serial number
              </label>
              <input type="text" class="form-control" id="input_serial_number" name="serial_number" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary">
            Add
          </button>
        </form>
      </>
    ),
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cellText(entry)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function appName(appInfo: unknown): string {
  if (appInfo && typeof appInfo === "object" && "name" in appInfo) {
    return String((appInfo as Record<string, unknown>).name);
  }
  return "";
}
