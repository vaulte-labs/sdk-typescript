import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Vault } from "../src/index.ts";

const library = new URL("../../sdk/target/dylib/debug/libvaulty.dylib", import.meta.url).pathname;

// scripts/check.sh runs this without LV_FAST_KDF, so a passphrase takes long enough to watch.
test("a call that takes a while leaves the main thread free", async () => {
  const folder = mkdtempSync(join(tmpdir(), "vaulte-ts-"));
  const vault = new Vault({ home: join(folder, "vault"), library });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    // Nothing is written until setup finishes.
    await vault.setupBegin({ passphrase: "test passphrase" });
  } finally {
    clearInterval(timer);
    await vault.close();
    rmSync(folder, { recursive: true, force: true });
  }
  expect(ticks).toBeGreaterThan(0);
});
