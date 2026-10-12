import { stringify as stringifyYaml } from "yaml";
import { page } from "../layout";

/** Ruby `Hash#to_yaml` display shape (`---` header included). */
export function yamlText(value: unknown): string {
  if (value === null || value === undefined) {
    return "--- \n";
  }
  return `---\n${stringifyYaml(value)}`;
}

export function typedYamlText(type: string, payloadJson: string): string {
  let payload: unknown = {};
  try {
    payload = JSON.parse(payloadJson) as unknown;
  } catch {
    payload = {};
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return yamlText({ type, ...(payload as Record<string, unknown>) });
  }
  return yamlText({ type, payload });
}

export function payloadYamlText(payloadJson: string | null): string {
  if (payloadJson === null) {
    return "--- \n";
  }
  try {
    return yamlText(JSON.parse(payloadJson) as unknown);
  } catch {
    return yamlText(payloadJson);
  }
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}

export function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface Crumb {
  href?: string;
  label: string;
}

export function Breadcrumbs(options: { items: Crumb[] }) {
  return (
    <>
      {options.items.map((item, index) => (
        <>
          {index > 0 ? " > " : null}
          {item.href ? <a href={item.href}>{item.label}</a> : item.label}
        </>
      ))}
    </>
  );
}

export function TopCrumb() {
  return <a href="/">TOP</a>;
}

/** Shared delete-confirm form used by the DDM pages. */
export function DeleteForm(options: { action: string; confirm: string; label: string }) {
  return (
    <form action={options.action} method="post" class="mt-4" onsubmit={`return confirm('${options.confirm}')`}>
      <button type="submit" class="btn btn-outline-danger">
        {options.label}
      </button>
    </form>
  );
}

export function AdminPage(options: { crumbs: Crumb[]; children: unknown; title?: string }) {
  return page(
    <>
      <Breadcrumbs items={options.crumbs} />
      <div class="container">{options.children as never}</div>
    </>,
    options.title,
  );
}
