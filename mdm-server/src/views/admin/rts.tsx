import { AdminPage } from "./shared";

export interface RtsProfileListItem {
  id: number;
  name: string;
}

/** RTS wifi profiles (ported from `views/rts/wifi_profiles.html.erb`). */
export function RtsWifiProfilesPage(options: {
  selected: { id: number; name: string; content: string } | null;
  profiles: RtsProfileListItem[];
}) {
  const selected = options.selected;
  return AdminPage({
    crumbs: selected
      ? [
          { href: "/", label: "TOP" },
          { label: "Return to Service configuration" },
          { href: "/rts/wifi_profiles", label: "Wi-Fi profiles" },
          { label: selected.name },
        ]
      : [
          { href: "/", label: "TOP" },
          { label: "Return to Service configuration" },
          { label: "Wi-Fi profiles" },
        ],
    children: (
      <>
        <h2>Return to Service configuration | Wi-Fi profiles</h2>
        {selected ? (
          <>
            <div class="card p-3">
              <pre>{selected.content}</pre>
            </div>
            <form
              action={`/rts/wifi_profiles/${selected.id}/delete`}
              method="post"
              onsubmit="return confirm('Are you sure you want to delete this Wi-Fi profile?')"
            >
              <button type="submit" class="btn btn-danger mt-2">
                Delete
              </button>
            </form>
          </>
        ) : (
          <div class="list-group">
            {options.profiles.map((profile) => (
              <a
                href={`/rts/wifi_profiles/${profile.id}`}
                class="list-group-item list-group-item-action"
              >
                {profile.name}
              </a>
            ))}
          </div>
        )}
        <h3>{selected ? "Edit profile" : "New profile"}</h3>
        <form class="card p-3" action="/rts/wifi_profiles" method="post" enctype="multipart/form-data">
          <div class="mb-3">
            <label for="form_name" class="form-label">
              Name
            </label>
            <input
              id="form_name"
              name="name"
              type="text"
              class="form-control"
              value={selected?.name ?? ""}
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
