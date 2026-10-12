import { VppClient } from "./client";

/**
 * VPP license assignment form (ported from `VppLicenseForm`): associate, then
 * poll the event until it leaves PENDING (up to 10 polls, 0.6s apart).
 */
export interface LicenseClient {
  post(path: string, body: unknown): Promise<unknown>;
  get(path: string, params?: Record<string, string>): Promise<unknown>;
}

export function validateLicenseForm(form: {
  adam_id?: unknown;
  serial_number?: unknown;
}): form is { adam_id: string; serial_number: string } {
  return (
    typeof form.adam_id === "string" &&
    form.adam_id.length > 0 &&
    typeof form.serial_number === "string" &&
    form.serial_number.length > 0
  );
}

export async function associateLicense(
  client: LicenseClient,
  form: { adam_id: string; serial_number: string },
  sleepMs: (ms: number) => Promise<void> = Bun.sleep,
): Promise<void> {
  const created = (await client.post("assets/associate", {
    assets: [{ adamId: form.adam_id }],
    serialNumbers: [form.serial_number],
  })) as { eventId?: unknown };
  const eventId = created.eventId;
  for (let attempt = 0; attempt < 10; attempt++) {
    const event = (await client.get("status", { eventId: String(eventId) })) as {
      eventStatus?: unknown;
    };
    console.log(`event=${JSON.stringify(event)}`);
    if (event.eventStatus !== "PENDING") {
      break;
    }
    await sleepMs(600);
  }
}

export function createVppClient(tokenValue: string): VppClient {
  return new VppClient(tokenValue);
}
