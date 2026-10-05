/**
 * Post-command response handlers (ported from `CommandResponseHandler::*`).
 * All current handlers are stubs in Ruby (`p self`), so the dispatch table
 * intentionally maps to no-ops — add real handlers here as needed.
 */
export type ResponseHandler = (device: unknown, payload: unknown) => void;

const mdmHandlers: Record<string, ResponseHandler> = {
  DeviceInformationAcknowledged: () => {},
  InstalledApplicationListAcknowledged: () => {},
};

const byodHandlers: Record<string, ResponseHandler> = {
  DeviceInformationAcknowledged: () => {},
};

export function mdmResponseHandler(name: string): ResponseHandler | undefined {
  return mdmHandlers[name];
}

export function byodResponseHandler(name: string): ResponseHandler | undefined {
  return byodHandlers[name];
}
