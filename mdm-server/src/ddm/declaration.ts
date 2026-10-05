import { createHash } from "node:crypto";
import {
  collectRequiredResourceIdentifiers,
  resolvedPayload,
  resourceIdentifier,
  type JsonValue,
} from "./identifiers";

/**
 * Per-device declaration set (ported from
 * `models/declarative_management/declaration.rb` and `declaration_item.rb`).
 *
 * The Ruby `Declaration.new(serial)` queries the database internally; here the
 * caller supplies the already-queried rows (ordered by id, as the Ruby
 * relations are) so this module stays pure and unit-testable.
 */

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface DeclarationItemManifest {
  Identifier: string;
  ServerToken: string;
}

export interface DeclarationItemDetail extends DeclarationItemManifest {
  Type: string;
  Payload: JsonValue;
}

export class DeclarationItem {
  readonly identifier: string;
  readonly type: string;
  readonly payload: JsonValue;
  #serverToken: string | null = null;

  constructor(options: { identifier: string; type: string; payload: JsonValue }) {
    this.identifier = options.identifier;
    this.type = options.type;
    this.payload = options.payload;
  }

  hasIdentifier(identifier: string): boolean {
    return this.identifier === identifier;
  }

  serverToken(): string {
    if (this.#serverToken === null) {
      this.#serverToken = sha256Hex(JSON.stringify({ Type: this.type, Payload: this.payload }));
    }
    return this.#serverToken;
  }

  manifest(): DeclarationItemManifest {
    return { Identifier: this.identifier, ServerToken: this.serverToken() };
  }

  detail(): DeclarationItemDetail {
    return {
      Identifier: this.identifier,
      Type: this.type,
      Payload: this.payload,
      ServerToken: this.serverToken(),
    };
  }
}

export interface ActivationRow {
  name: string;
  type: string;
  payload: JsonValue;
}

export interface ConfigurationRow {
  name: string;
  type: string;
  payload: JsonValue;
}

export interface AssetRow {
  name: string;
}

export interface AssetDetailRow {
  assetName: string;
  assetType: string;
  payload: JsonValue;
}

export interface ManagementDetailRow {
  managementName: string;
  managementType: string;
  payload: JsonValue;
}

export interface PublicAssetDetailRow {
  assetName: string;
  accessUrl: string;
}

export interface DeclarationInput {
  /** Activations applying to the device. */
  activations: ActivationRow[];
  /** All configurations (used both as reference candidates and as sources). */
  configurations: ConfigurationRow[];
  /** All assets (reference candidates). */
  assets: AssetRow[];
  /** Winning asset details for the device. */
  assetDetails: AssetDetailRow[];
  /** Winning management details for the device. */
  managementDetails: ManagementDetailRow[];
  /** Winning public asset details for the device. */
  publicAssetDetails: PublicAssetDetailRow[];
}

/** `Time.now.iso8601` with the app timezone (Asia/Tokyo, second precision). */
export function formatJstTimestamp(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
    `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`
  );
}

export class Declaration {
  readonly #activations: DeclarationItem[];
  readonly #configurations: DeclarationItem[];
  readonly #assets: DeclarationItem[];
  readonly #managements: DeclarationItem[];

  constructor(input: DeclarationInput) {
    const publicAssetUrlMap: Record<string, JsonValue> = Object.fromEntries(
      input.publicAssetDetails.map((detail) => [`@public/${detail.assetName}`, detail.accessUrl]),
    );

    const configurationCandidates = input.configurations.map(
      (configuration) => `@configuration/${configuration.name}`,
    );
    const requiredConfigurationNames = new Set<string>();
    for (const activation of input.activations) {
      for (const reference of collectRequiredResourceIdentifiers(
        activation.payload,
        configurationCandidates,
      )) {
        requiredConfigurationNames.add(reference);
      }
    }
    const requiredConfigurations = input.configurations.filter((configuration) =>
      requiredConfigurationNames.has(`@configuration/${configuration.name}`),
    );

    const assetCandidates = input.assets.map((asset) => `@asset/${asset.name}`);
    const requiredAssetNames = new Set<string>();
    for (const configuration of requiredConfigurations) {
      for (const reference of collectRequiredResourceIdentifiers(
        configuration.payload,
        assetCandidates,
      )) {
        requiredAssetNames.add(reference);
      }
    }
    const requiredAssetDetails = input.assetDetails.filter((detail) =>
      requiredAssetNames.has(`@asset/${detail.assetName}`),
    );

    const configurationMap: Record<string, JsonValue> = Object.fromEntries(
      requiredConfigurations.map((configuration) => {
        const identifier = resourceIdentifier("configuration", configuration.name);
        return [identifier.referenceName, identifier.digest];
      }),
    );
    const assetMap: Record<string, JsonValue> = Object.fromEntries(
      requiredAssetDetails.map((detail) => {
        const identifier = resourceIdentifier("asset", detail.assetName);
        return [identifier.referenceName, identifier.digest];
      }),
    );

    this.#activations = input.activations.map(
      (activation) =>
        new DeclarationItem({
          identifier: resourceIdentifier("activation", activation.name).digest,
          type: activation.type,
          payload: resolvedPayload(activation.payload, configurationMap),
        }),
    );
    this.#configurations = requiredConfigurations.map(
      (configuration) =>
        new DeclarationItem({
          identifier: resourceIdentifier("configuration", configuration.name).digest,
          type: configuration.type,
          payload: resolvedPayload(configuration.payload, {
            ...assetMap,
            ...publicAssetUrlMap,
          }),
        }),
    );
    this.#assets = requiredAssetDetails.map(
      (detail) =>
        new DeclarationItem({
          identifier: resourceIdentifier("asset", detail.assetName).digest,
          type: detail.assetType,
          payload: resolvedPayload(detail.payload, publicAssetUrlMap),
        }),
    );
    this.#managements = input.managementDetails.map(
      (detail) =>
        new DeclarationItem({
          identifier: resourceIdentifier(
            detail.managementType === "com.apple.management.properties"
              ? "property"
              : "management",
            detail.managementName,
          ).digest,
          type: detail.managementType,
          payload: detail.payload,
        }),
    );
  }

  tokens(now: Date = new Date()): {
    SyncTokens: { DeclarationsToken: string; Timestamp: string };
  } {
    return {
      SyncTokens: {
        DeclarationsToken: this.declarationsToken(),
        Timestamp: formatJstTimestamp(now),
      },
    };
  }

  declarationItems(): {
    Declarations: {
      Activations: DeclarationItemManifest[];
      Configurations: DeclarationItemManifest[];
      Assets: DeclarationItemManifest[];
      Management: DeclarationItemManifest[];
    };
    DeclarationsToken: string;
  } {
    return {
      Declarations: {
        Activations: this.#activations.map((item) => item.manifest()),
        Configurations: this.#configurations.map((item) => item.manifest()),
        Assets: this.#assets.map((item) => item.manifest()),
        Management: this.#managements.map((item) => item.manifest()),
      },
      DeclarationsToken: this.declarationsToken(),
    };
  }

  activationDetailFor(identifier: string): DeclarationItemDetail | undefined {
    return this.#activations.find((item) => item.hasIdentifier(identifier))?.detail();
  }

  configurationDetailFor(identifier: string): DeclarationItemDetail | undefined {
    return this.#configurations.find((item) => item.hasIdentifier(identifier))?.detail();
  }

  assetDetailFor(identifier: string): DeclarationItemDetail | undefined {
    return this.#assets.find((item) => item.hasIdentifier(identifier))?.detail();
  }

  managementDetailFor(identifier: string): DeclarationItemDetail | undefined {
    return this.#managements.find((item) => item.hasIdentifier(identifier))?.detail();
  }

  private declarationsToken(): string {
    return sha256Hex(
      JSON.stringify([
        this.#activations.map((item) => item.manifest()),
        this.#configurations.map((item) => item.manifest()),
        this.#assets.map((item) => item.manifest()),
        this.#managements.map((item) => item.manifest()),
      ]),
    );
  }
}
