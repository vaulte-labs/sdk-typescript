import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Vault, VaulteError } from "../src/index.ts";

// scripts/check.sh builds this with the C SDK's test hooks, where a passphrase stands in for a touch,
// and points LV_DAEMON at a matching broker.
const library = new URL("../../sdk-c/target/dylib/debug/libvaulty.dylib", import.meta.url).pathname;

const passphrase = "test passphrase";
const folder = mkdtempSync(join(tmpdir(), "vaulte-ts-"));
const vault = new Vault({ home: join(folder, "vault"), library });

beforeAll(async () => {
  expect(await vault.exists()).toBe(false);
  await vault.setupBegin({ passphrase });
  const words = (await vault.setupWords()).split(" ");
  expect(words).toHaveLength(24);
  for (const position of await vault.setupPositions()) {
    expect(await vault.setupCheckWord({ position, answer: words[position] ?? "" })).toBe(true);
  }
  await vault.setupFinish({ deviceName: "test mac" });
  await vault.connect({ passphrase });
});

// Settled before matching: under `bun test`, `expect(pending).rejects` was seen to wait without
// ever receiving the worker's reply.
const failure = (call: Promise<unknown>) => call.then(() => undefined, (error: unknown) => error);

afterAll(async () => {
  await vault.stop();
  await vault.close();
  rmSync(folder, { recursive: true, force: true });
});

test("replies arrive typed, in camelCase", async () => {
  expect(await vault.exists()).toBe(true);
  const status = await vault.status();
  expect(status).toMatchObject({ hardware: false, deviceCount: 1, lastCopy: true, syncPort: null });
  expect(await vault.spaces()).toEqual(["Personal"]);
});

test("a value goes in, stays out of lists, and comes back through reveal", async () => {
  await vault.addEnv({ name: "OPENAI_API_KEY", value: "sk-real-value" });
  const items = await vault.items();
  expect(items).toEqual([{ space: "Personal", kind: "env", name: "OPENAI_API_KEY", hosts: ["api.openai.com"] }]);
  expect(await vault.reveal({ name: "OPENAI_API_KEY" })).toEqual({ type: "env", value: "sk-real-value" });
});

test("a failed call rejects with the library's code", async () => {
  const error = await failure(vault.item({ name: "nothing here" }));
  expect(error).toBeInstanceOf(VaulteError);
  expect(error).toMatchObject({ code: "not_found" });
});

test("a grant lets an agent into its space and nothing more", async () => {
  await vault.createSpace({ name: "Work" });
  await vault.addEnv({ space: "Work", name: "DEPLOY_TOKEN", value: "work-value" });
  const { token } = await vault.grant({ space: "Work", agent: "deploy-bot", seconds: 60 });
  expect((await vault.grants()).map(({ agent, space }) => ({ agent, space }))).toEqual([{ agent: "deploy-bot", space: "Work" }]);

  const agent = new Vault({ home: join(folder, "vault"), library });
  await agent.connect({ session: token });
  expect((await agent.items()).map(({ name }) => name)).toEqual(["DEPLOY_TOKEN"]);
  expect(await failure(agent.grant({ agent: "another-bot", seconds: 60 }))).toMatchObject({ code: "denied" });
  await agent.close();
  expect(await failure(agent.spaces())).toMatchObject({ message: "this vault is closed" });
});

test("each undo names what it changed back, one change at a time", async () => {
  await vault.addEnv({ name: "FIRST", value: "1" });
  await vault.addEnv({ name: "SECOND", value: "2" });
  expect(await vault.undo()).toEqual(["SECOND"]);
  expect(await vault.undo()).toEqual(["FIRST"]);
});

test("lock settings come back as they were set, in camelCase", async () => {
  const settings = { stayUnlocked: "ten_minutes", withScreen: false } as const;
  await vault.setLockSettings({ settings });
  expect(await vault.lockSettings()).toEqual(settings);
});

test("a space can be renamed, and an empty one removed", async () => {
  await vault.createSpace({ name: "Scratch" });
  expect(await vault.renameSpace({ name: "Scratch", to: "Notes" })).toBe("Notes");
  await vault.removeSpace({ name: "Notes" });
  expect(await vault.spaces()).not.toContain("Notes");
});

test("with no subscription there is no account and no billing page", async () => {
  expect(await vault.relayStatus()).toEqual({ account: null, paidUntil: null });
  expect(await failure(vault.relayBilling())).toMatchObject({ code: "not_found" });
});
