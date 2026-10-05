import { beforeEach, describe, expect, test } from "bun:test";
import {
  bulkEnqueueCommands,
  clearQueue,
  dequeueCommand,
  dequeueHandlingRequest,
  enqueueCommand,
  HandlingRequestNotFound,
  logCommandResult,
  queueSize,
} from "../../src/db/queue";
import { testDb, truncateAll } from "./helpers";

const command = (uuid: string) => ({
  CommandUUID: uuid,
  Command: { RequestType: "DeviceInformation" },
});

describe("command queue", () => {
  const db = testDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test("enqueues and dequeues FIFO", async () => {
    await enqueueCommand(db, "UDID-1", command("uuid-1"));
    await enqueueCommand(db, "UDID-1", command("uuid-2"));
    expect(await queueSize(db, "UDID-1")).toBe(2);

    expect(await dequeueCommand(db, "UDID-1")).toEqual(command("uuid-1"));
    expect(await queueSize(db, "UDID-1")).toBe(1);
    expect(await dequeueCommand(db, "UDID-1")).toEqual(command("uuid-2"));
    expect(await dequeueCommand(db, "UDID-1")).toBeNull();
  });

  test("bulk-enqueues the cartesian product", async () => {
    await bulkEnqueueCommands(db, ["A", "B"], [command("u1"), command("u2")]);
    expect(await queueSize(db, "A")).toBe(2);
    expect(await queueSize(db, "B")).toBe(2);
    await bulkEnqueueCommands(db, [], [command("u1")]);
    expect(await queueSize(db, "A")).toBe(2);
  });

  test("handling requests round-trip and log results", async () => {
    await enqueueCommand(db, "UDID-1", command("uuid-1"));
    await dequeueCommand(db, "UDID-1");

    const handling = await dequeueHandlingRequest(db, "UDID-1", "uuid-1");
    expect(handling.commandUuid).toBe("uuid-1");
    await expect(dequeueHandlingRequest(db, "UDID-1", "uuid-1")).rejects.toBeInstanceOf(
      HandlingRequestNotFound,
    );

    await logCommandResult(db, handling, { Status: "Acknowledged", UDID: "UDID-1" });
    // Re-enqueue on NotNow, like the command endpoints do.
    const { parsePlist } = await import("../../src/mdm/plist");
    await enqueueCommand(
      db,
      "UDID-1",
      parsePlist(handling.requestPayloadXml) as Record<string, unknown>,
    );
    expect(await queueSize(db, "UDID-1")).toBe(1);
  });

  test("clear wipes pending and handling rows", async () => {
    await enqueueCommand(db, "UDID-1", command("uuid-1"));
    await enqueueCommand(db, "UDID-1", command("uuid-2"));
    await dequeueCommand(db, "UDID-1");
    await clearQueue(db, "UDID-1");
    expect(await queueSize(db, "UDID-1")).toBe(0);
    await expect(dequeueHandlingRequest(db, "UDID-1", "uuid-1")).rejects.toBeInstanceOf(
      HandlingRequestNotFound,
    );
  });
});
