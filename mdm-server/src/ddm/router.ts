import type { Declaration } from "./declaration";

/**
 * DDM endpoint dispatcher (ported from
 * `models/declarative_management_router.rb`).
 */

export class RouteNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteNotFound";
  }
}

export type DeclarationFactory = () => Declaration;

export function handleDeclarationRequest(
  endpoint: string,
  _data: unknown,
  createDeclaration: DeclarationFactory,
): unknown {
  switch (endpoint) {
    case "status":
      // Stub in Ruby too (`handle_status` returns nil); do not invent behavior.
      return null;
    case "declaration-items":
      return createDeclaration().declarationItems();
    case "tokens":
      return createDeclaration().tokens();
    default:
      break;
  }

  const activation = /^declaration\/activation\/(.+)$/.exec(endpoint);
  if (activation) {
    const detail = createDeclaration().activationDetailFor(activation[1]!);
    if (!detail) {
      throw new RouteNotFound(`No activation found with identifier ${activation[1]}`);
    }
    return detail;
  }
  const configuration = /^declaration\/configuration\/(.+)$/.exec(endpoint);
  if (configuration) {
    const detail = createDeclaration().configurationDetailFor(configuration[1]!);
    if (!detail) {
      throw new RouteNotFound(`No configuration found with identifier ${configuration[1]}`);
    }
    return detail;
  }
  const asset = /^declaration\/asset\/(.+)$/.exec(endpoint);
  if (asset) {
    const detail = createDeclaration().assetDetailFor(asset[1]!);
    if (!detail) {
      throw new RouteNotFound(`No asset found with identifier ${asset[1]}`);
    }
    return detail;
  }
  const management = /^declaration\/management\/(.+)$/.exec(endpoint);
  if (management) {
    const detail = createDeclaration().managementDetailFor(management[1]!);
    if (!detail) {
      throw new RouteNotFound(`No management found with identifier ${management[1]}`);
    }
    return detail;
  }
  throw new RouteNotFound("Not Found");
}
