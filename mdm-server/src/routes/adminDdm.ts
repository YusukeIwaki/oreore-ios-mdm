import { Hono, type Context } from "hono";
import { asc, eq } from "drizzle-orm";
import type { AppEnv } from "../http/context";
import { loginRequired } from "../http/adminAuth";
import type { Database } from "../db";
import * as schema from "../schema";
import {
  createActivation,
  createConfiguration,
  createDeviceGroup,
  createMaster,
  deleteActivation,
  deleteConfiguration,
  deleteMaster,
  getActivationWithTargets,
  listActivationTargetsDisplaySorted,
  listMastersPrioritySorted,
  parseIdParam,
  parseSerialNumbers,
  renameDeviceGroup,
  targetOptions,
  updateActivation,
  updateConfiguration,
  updateDeviceGroupItems,
  upsertDetailPayload,
} from "../db/ddm_admin";
import {
  deletePublicAssetDetail,
  deletePublicAssetWithBlobs,
  upsertPublicAssetDetail,
} from "../db/console";
import { assetFilesUrl, parseStoredFileData } from "../storage/files";
import { payloadYamlText } from "../views/admin/shared";
import { textField, uploadedFile } from "./adminHelpers";
import {
  DdmActivationFormPage,
  DdmActivationsPage,
  DdmConfigurationFormPage,
  DdmConfigurationsPage,
  DdmDetailsPage,
  DdmDeviceGroupFormPage,
  DdmDeviceGroupRenamePage,
  DdmDeviceGroupsPage,
  DdmIndexPage,
  DdmMastersPage,
  DdmPublicAssetDetailsPage,
  type DdmDetailSummary,
} from "../views/admin/ddm";

/** Admin console: declarative device management resources. */
export const adminDdmRoutes = new Hono<AppEnv>();

adminDdmRoutes.use("/ddm/*", loginRequired());

async function groupSummaries(db: Database) {
  const groups = await db.select().from(schema.ddmDeviceGroups).orderBy(asc(schema.ddmDeviceGroups.id));
  const out: { id: number; name: string; items: string[] }[] = [];
  for (const group of groups) {
    const items = await db
      .select()
      .from(schema.ddmDeviceGroupItems)
      .where(eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, group.id))
      .orderBy(asc(schema.ddmDeviceGroupItems.id));
    out.push({ id: group.id, name: group.name, items: items.map((item) => item.deviceIdentifier) });
  }
  return out;
}

function publicAssetAccessUrl(baseUrl: string, assetFileData: string): string {
  return assetFilesUrl(baseUrl, parseStoredFileData(assetFileData));
}

async function masterSummaries(
  c: Context<AppEnv>,
  kind: "asset" | "management" | "publicAsset",
  onlyId?: number,
) {
  const masters = await listMastersPrioritySorted(c.get("db"), kind, onlyId);
  const baseUrl = c.get("config").baseUrl;
  return masters.map((entry) => ({
    id: entry.master.id,
    name: entry.master.name,
    type: entry.master.type,
    details: entry.details.map(
      (detail): DdmDetailSummary => ({
        id: detail.id,
        targetIdentifier: (detail.targetIdentifier as string | null) ?? null,
        payloadJson: typeof detail.payload === "string" ? detail.payload : "",
        accessUrl:
          kind === "publicAsset" && typeof detail.assetFileData === "string"
            ? publicAssetAccessUrl(baseUrl, detail.assetFileData)
            : undefined,
      }),
    ),
  }));
}

adminDdmRoutes.get("/ddm", async (c) => {
  const db = c.get("db");
  const [groups, targets, configurations, assets, managements, publicAssets] = await Promise.all([
    groupSummaries(db),
    listActivationTargetsDisplaySorted(db),
    db.select().from(schema.ddmConfigurations).orderBy(asc(schema.ddmConfigurations.id)),
    masterSummaries(c, "asset"),
    masterSummaries(c, "management"),
    masterSummaries(c, "publicAsset"),
  ]);
  return c.html(
    DdmIndexPage({
      groups,
      activationTargets: targets.map((entry) => ({
        activationId: entry.activation.id,
        activationName: entry.activation.name,
        activationType: entry.activation.type,
        activationPayloadJson: entry.activation.payload,
        targetIdentifier: entry.target.targetIdentifier,
      })),
      configurations: configurations.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        payloadJson: row.payload,
      })),
      assets,
      managements,
      publicAssets,
    }),
  );
});

// --- Device groups ---

adminDdmRoutes.get("/ddm/device_groups", async (c) => {
  return c.html(DdmDeviceGroupsPage({ groups: await groupSummaries(c.get("db")) }));
});

adminDdmRoutes.post("/ddm/device_groups", async (c) => {
  const body = await c.req.parseBody();
  await createDeviceGroup(c.get("db"), {
    name: textField(body.name),
    serialNumbersText: textField(body.serial_numbers),
  });
  return c.redirect("/ddm/device_groups");
});

adminDdmRoutes.get("/ddm/device_groups/:id", async (c) => {
  const idParam = c.req.param("id");
  if (idParam === "new") {
    return c.html(DdmDeviceGroupFormPage({ group: null, serialNumbersText: "" }));
  }
  const id = parseIdParam(idParam);
  const [group] = await c
    .get("db")
    .select()
    .from(schema.ddmDeviceGroups)
    .where(eq(schema.ddmDeviceGroups.id, id))
    .limit(1);
  if (!group) {
    throw new Error(`Couldn't find Ddm::DeviceGroup with id=${id}`);
  }
  const items = await c
    .get("db")
    .select()
    .from(schema.ddmDeviceGroupItems)
    .where(eq(schema.ddmDeviceGroupItems.ddmDeviceGroupId, id))
    .orderBy(asc(schema.ddmDeviceGroupItems.id));
  return c.html(
    DdmDeviceGroupFormPage({
      group: { id: group.id, name: group.name },
      serialNumbersText: items.map((item) => item.deviceIdentifier).join("\n"),
    }),
  );
});

adminDdmRoutes.post("/ddm/device_groups/:id", async (c) => {
  const body = await c.req.parseBody();
  await updateDeviceGroupItems(c.get("db"), parseIdParam(c.req.param("id")), textField(body.serial_numbers));
  return c.redirect(`/ddm/device_groups/${c.req.param("id")}`);
});

adminDdmRoutes.get("/ddm/device_groups/:id/rename", async (c) => {
  const id = parseIdParam(c.req.param("id"));
  const [group] = await c
    .get("db")
    .select()
    .from(schema.ddmDeviceGroups)
    .where(eq(schema.ddmDeviceGroups.id, id))
    .limit(1);
  if (!group) {
    throw new Error(`Couldn't find Ddm::DeviceGroup with id=${id}`);
  }
  return c.html(DdmDeviceGroupRenamePage({ group: { id: group.id, name: group.name } }));
});

adminDdmRoutes.post("/ddm/device_groups/:id/rename", async (c) => {
  const body = await c.req.parseBody();
  await renameDeviceGroup(c.get("db"), parseIdParam(c.req.param("id")), textField(body.name));
  return c.redirect(`/ddm/device_groups/${c.req.param("id")}`);
});

// --- Activations ---

adminDdmRoutes.get("/ddm/activations", async (c) => {
  const targets = await listActivationTargetsDisplaySorted(c.get("db"));
  return c.html(
    DdmActivationsPage({
      targets: targets.map((entry) => ({
        activationId: entry.activation.id,
        activationName: entry.activation.name,
        activationType: entry.activation.type,
        activationPayloadJson: entry.activation.payload,
        targetIdentifier: entry.target.targetIdentifier,
      })),
    }),
  );
});

adminDdmRoutes.post("/ddm/activations", async (c) => {
  const body = await c.req.parseBody();
  await createActivation(c.get("db"), {
    name: textField(body.name),
    payloadYaml: textField(body.payload),
    targetIdentifiers: parseSerialNumbers(textField(body.target_identifiers)),
  });
  return c.redirect("/ddm/activations");
});

adminDdmRoutes.get("/ddm/activations/:id", async (c) => {
  const idParam = c.req.param("id");
  if (idParam === "new") {
    return c.html(
      DdmActivationFormPage({ activation: null, payloadYaml: payloadYamlText(null), targetIdentifiersText: "" }),
    );
  }
  const { activation, targets } = await getActivationWithTargets(c.get("db"), parseIdParam(idParam));
  return c.html(
    DdmActivationFormPage({
      activation: { id: activation.id, name: activation.name },
      payloadYaml: payloadYamlText(activation.payload),
      targetIdentifiersText: targets
        .map((target) => target.targetIdentifier ?? "")
        .filter((identifier) => identifier !== "")
        .join("\n"),
    }),
  );
});

adminDdmRoutes.post("/ddm/activations/:id", async (c) => {
  const body = await c.req.parseBody();
  await updateActivation(c.get("db"), parseIdParam(c.req.param("id")), {
    payloadYaml: textField(body.payload),
    targetIdentifiers: parseSerialNumbers(textField(body.target_identifiers)),
  });
  return c.redirect(`/ddm/activations/${c.req.param("id")}`);
});

adminDdmRoutes.post("/ddm/activations/:id/delete", async (c) => {
  await deleteActivation(c.get("db"), parseIdParam(c.req.param("id")));
  return c.redirect("/ddm/activations");
});

// --- Configurations ---

adminDdmRoutes.get("/ddm/configurations", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(schema.ddmConfigurations)
    .orderBy(asc(schema.ddmConfigurations.id));
  return c.html(
    DdmConfigurationsPage({
      configurations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        payloadJson: row.payload,
      })),
    }),
  );
});

adminDdmRoutes.post("/ddm/configurations", async (c) => {
  const body = await c.req.parseBody();
  await createConfiguration(c.get("db"), {
    name: textField(body.name),
    type: textField(body.type),
    payloadYaml: textField(body.payload),
  });
  return c.redirect("/ddm/configurations");
});

adminDdmRoutes.get("/ddm/configurations/:id", async (c) => {
  const idParam = c.req.param("id");
  if (idParam === "new") {
    return c.html(
      DdmConfigurationFormPage({ configuration: null, payloadYaml: payloadYamlText(null) }),
    );
  }
  const id = parseIdParam(idParam);
  const [row] = await c
    .get("db")
    .select()
    .from(schema.ddmConfigurations)
    .where(eq(schema.ddmConfigurations.id, id))
    .limit(1);
  if (!row) {
    throw new Error(`Couldn't find Ddm::Configuration with id=${id}`);
  }
  return c.html(
    DdmConfigurationFormPage({
      configuration: { id: row.id, name: row.name, type: row.type },
      payloadYaml: payloadYamlText(row.payload),
    }),
  );
});

adminDdmRoutes.post("/ddm/configurations/:id", async (c) => {
  const body = await c.req.parseBody();
  await updateConfiguration(c.get("db"), parseIdParam(c.req.param("id")), {
    type: textField(body.type),
    payloadYaml: textField(body.payload),
  });
  return c.redirect(`/ddm/configurations/${c.req.param("id")}`);
});

adminDdmRoutes.post("/ddm/configurations/:id/delete", async (c) => {
  await deleteConfiguration(c.get("db"), parseIdParam(c.req.param("id")));
  return c.redirect("/ddm/configurations");
});

// --- Assets / managements (shared shape) ---

const YAML_MASTER_CONFIG = {
  asset: {
    basePath: "/ddm/assets",
    section: "Assets",
    heading: "Asset",
    singular: "asset",
    emptyLabel: "asset",
    typeInput: { value: "", readonly: false },
    deleteNoun: "asset",
  },
  management: {
    basePath: "/ddm/managements",
    section: "Management properties",
    heading: "Management property",
    singular: "management property",
    emptyLabel: "management property",
    typeInput: { value: "com.apple.management.properties", readonly: true },
    deleteNoun: "management property",
  },
} as const;

async function yamlMasterDetails(
  c: Context<AppEnv>,
  kind: "asset" | "management",
  masterId: number,
  detailId: number | null,
) {
  const db = c.get("db");
  const table = kind === "asset" ? schema.ddmAssets : schema.ddmManagements;
  const detailTable = kind === "asset" ? schema.ddmAssetDetails : schema.ddmManagementDetails;
  const foreignKey = kind === "asset" ? "ddmAssetId" : "ddmManagementId";
  const [master] = await db.select().from(table).where(eq(table.id, masterId)).limit(1);
  if (!master) {
    throw new Error(`Couldn't find record with id=${masterId}`);
  }
  let detail: { id: number; targetIdentifier: string | null; payloadYaml: string } | null = null;
  if (detailId !== null) {
    const [row] = await db
      .select()
      .from(detailTable)
      .where(eq(detailTable.id, detailId))
      .limit(1);
    if (!row || (row as Record<string, unknown>)[foreignKey] !== masterId) {
      throw new Error(`Couldn't find record with id=${detailId}`);
    }
    detail = {
      id: row.id,
      targetIdentifier: row.targetIdentifier,
      payloadYaml: payloadYamlText(row.payload),
    };
  }
  const summaries = await masterSummaries(c, kind, masterId);
  return { master, detail, details: summaries[0]?.details ?? [] };
}

for (const kind of ["asset", "management"] as const) {
  const config = YAML_MASTER_CONFIG[kind];
  adminDdmRoutes.get(config.basePath, async (c) => {
    return c.html(
      DdmMastersPage({
        ...config,
        masters: await masterSummaries(c, kind),
        showPayload: true,
      }),
    );
  });

  adminDdmRoutes.post(config.basePath, async (c) => {
    const body = await c.req.parseBody();
    await createMaster(c.get("db"), kind, {
      name: textField(body.name),
      type: textField(body.type),
    });
    return c.redirect(config.basePath);
  });

  for (const detailsPath of [`${config.basePath}/:id/details`, `${config.basePath}/:id/details/:detail_id`] as const) {
    adminDdmRoutes.get(detailsPath, async (c) => {
      const detailParam = c.req.param("detail_id");
      const { master, detail, details } = await yamlMasterDetails(
        c,
        kind,
        parseIdParam(c.req.param("id")),
        detailParam === undefined ? null : parseIdParam(detailParam),
      );
      return c.html(
        DdmDetailsPage({
          ...config,
          master: { id: master.id, name: master.name, type: master.type },
          detail,
          details,
          targetOptions: await targetOptions(c.get("db")),
          deleteConfirm: `Delete ${config.deleteNoun} {name} and all of its targets?`,
        }),
      );
    });
  }

  adminDdmRoutes.post(`${config.basePath}/:id/details`, async (c) => {
    const body = await c.req.parseBody();
    await upsertDetailPayload(c.get("db"), kind, parseIdParam(c.req.param("id")), {
      targetIdentifier: textField(body.target_identifier),
      payloadYaml: textField(body.payload),
    });
    return c.redirect(`${config.basePath}/${c.req.param("id")}/details`);
  });

  adminDdmRoutes.post(`${config.basePath}/:id/delete`, async (c) => {
    await deleteMaster(c.get("db"), kind, parseIdParam(c.req.param("id")));
    return c.redirect(config.basePath);
  });
}

// --- Public assets ---

adminDdmRoutes.get("/ddm/public_assets", async (c) => {
  return c.html(
    DdmMastersPage({
      basePath: "/ddm/public_assets",
      section: "Public assets",
      heading: "Public assets",
      singular: "asset",
      emptyLabel: "asset",
      typeInput: null,
      masters: await masterSummaries(c, "publicAsset"),
      showPayload: false,
    }),
  );
});

adminDdmRoutes.post("/ddm/public_assets", async (c) => {
  const body = await c.req.parseBody();
  await createMaster(c.get("db"), "publicAsset", { name: textField(body.name) });
  return c.redirect("/ddm/public_assets");
});

async function publicAssetDetailsData(c: Context<AppEnv>, masterId: number, detailId: number | null) {
  const db = c.get("db");
  const [master] = await db
    .select()
    .from(schema.ddmPublicAssets)
    .where(eq(schema.ddmPublicAssets.id, masterId))
    .limit(1);
  if (!master) {
    throw new Error(`Couldn't find record with id=${masterId}`);
  }
  let detail: { id: number; targetIdentifier: string | null } | null = null;
  if (detailId !== null) {
    const [row] = await db
      .select()
      .from(schema.ddmPublicAssetDetails)
      .where(eq(schema.ddmPublicAssetDetails.id, detailId))
      .limit(1);
    if (!row || row.ddmPublicAssetId !== masterId) {
      throw new Error(`Couldn't find record with id=${detailId}`);
    }
    detail = { id: row.id, targetIdentifier: row.targetIdentifier };
  }
  const summaries = await masterSummaries(c, "publicAsset", masterId);
  const details = summaries[0]?.details ?? [];
  return {
    master,
    detail,
    details,
    detailLinks: details.map((row) => ({
      id: row.id ?? 0,
      targetIdentifier: row.targetIdentifier,
      accessUrl: row.accessUrl ?? "",
    })),
  };
}

for (const detailsPath of [
  "/ddm/public_assets/:id/details",
  "/ddm/public_assets/:id/details/:detail_id",
] as const) {
  adminDdmRoutes.get(detailsPath, async (c) => {
    const detailParam = c.req.param("detail_id");
    const data = await publicAssetDetailsData(
      c,
      parseIdParam(c.req.param("id")),
      detailParam === undefined ? null : parseIdParam(detailParam),
    );
    return c.html(
      DdmPublicAssetDetailsPage({
        master: { id: data.master.id, name: data.master.name },
        detail: data.detail,
        details: data.details,
        detailLinks: data.detailLinks,
        targetOptions: await targetOptions(c.get("db")),
      }),
    );
  });
}

adminDdmRoutes.post("/ddm/public_assets/:id/details", async (c) => {
  const body = await c.req.parseBody();
  const file = await uploadedFile(body.asset_file);
  if (!file) {
    throw new Error("asset_file is required");
  }
  await upsertPublicAssetDetail(c.get("db"), c.get("fileStore"), parseIdParam(c.req.param("id")), {
    targetIdentifier: textField(body.target_identifier),
    file,
  });
  return c.redirect(`/ddm/public_assets/${c.req.param("id")}/details`);
});

adminDdmRoutes.post("/ddm/public_assets/:id/details/:detail_id/delete", async (c) => {
  await deletePublicAssetDetail(
    c.get("db"),
    parseIdParam(c.req.param("id")),
    parseIdParam(c.req.param("detail_id")),
  );
  return c.redirect(`/ddm/public_assets/${c.req.param("id")}/details`);
});

adminDdmRoutes.post("/ddm/public_assets/:id/delete", async (c) => {
  await deletePublicAssetWithBlobs(c.get("db"), c.get("fileStore"), parseIdParam(c.req.param("id")));
  return c.redirect("/ddm/public_assets");
});
