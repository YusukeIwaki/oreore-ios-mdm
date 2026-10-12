import { describe, expect, test } from "bun:test";
import { Declaration } from "../../src/ddm/declaration";
import { handleDeclarationRequest, RouteNotFound } from "../../src/ddm/router";
import { resourceIdentifier } from "../../src/ddm/identifiers";

const INPUT = {
  activations: [{ name: "a1", type: "com.apple.activation.simple", payload: {} }],
  configurations: [],
  assets: [],
  assetDetails: [],
  managementDetails: [],
  publicAssetDetails: [],
};

const create = () => new Declaration(INPUT);

describe("declaration router", () => {
  test("status is a null stub", () => {
    expect(handleDeclarationRequest("status", {}, create)).toBeNull();
  });

  test("tokens and declaration-items delegate to the declaration", () => {
    const declaration = create();
    const tokens = handleDeclarationRequest("tokens", null, () => declaration) as {
      SyncTokens: { DeclarationsToken: string };
    };
    expect(tokens.SyncTokens.DeclarationsToken).toBe(
      (declaration.declarationItems() as { DeclarationsToken: string }).DeclarationsToken,
    );
    const items = handleDeclarationRequest("declaration-items", null, create) as {
      Declarations: { Activations: unknown[] };
    };
    expect(items.Declarations.Activations).toHaveLength(1);
  });

  test("detail routes resolve by identifier", () => {
    const digest = resourceIdentifier("activation", "a1").digest;
    const detail = handleDeclarationRequest(`declaration/activation/${digest}`, null, create) as {
      Identifier: string;
    };
    expect(detail.Identifier).toBe(digest);
  });

  test("missing details raise RouteNotFound with exact messages", () => {
    expect(() => handleDeclarationRequest("declaration/activation/nope", null, create)).toThrow(
      new RouteNotFound("No activation found with identifier nope"),
    );
    expect(() => handleDeclarationRequest("declaration/configuration/nope", null, create)).toThrow(
      new RouteNotFound("No configuration found with identifier nope"),
    );
    expect(() => handleDeclarationRequest("declaration/asset/nope", null, create)).toThrow(
      new RouteNotFound("No asset found with identifier nope"),
    );
    expect(() => handleDeclarationRequest("declaration/management/nope", null, create)).toThrow(
      new RouteNotFound("No management found with identifier nope"),
    );
  });

  test("unknown endpoints raise RouteNotFound", () => {
    for (const endpoint of ["unknown", "declaration/activation/", "declaration-items/extra"]) {
      expect(() => handleDeclarationRequest(endpoint, null, create)).toThrow(
        new RouteNotFound("Not Found"),
      );
    }
  });
});
