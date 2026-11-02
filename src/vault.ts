import { suffix } from "bun:ffi";

import type * as T from "./types.ts";
import type { Reply, Request } from "./worker.ts";

export class VaulteError extends Error {
  override name = "VaulteError";

  constructor(
    message: string,
    readonly code: T.ErrorCode,
  ) {
    super(message);
  }
}

export interface VaultOptions {
  /** The vault's folder. Defaults to `LV_HOME`, then the system's place for it. */
  home?: string;
  /** Path to libvaulty. Defaults to the dynamic loader's search, as `/usr/local/lib`. */
  library?: string;
}

type Space = { space?: string };
type Named = { space?: string; name: string };

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** libvault names fields in snake_case. No call or reply has a key chosen by a person. */
function renameKeys(value: unknown, rename: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => renameKeys(item, rename));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [rename(key), renameKeys(item, rename)]));
}

/**
 * A handle on a vault. Each call runs on a thread of its own, one at a time, and may wait while a
 * person approves it. Policy stays in the broker: nothing here can do what `vlt` could not.
 */
export class Vault {
  readonly #worker = new Worker(new URL("./worker.ts", import.meta.url));
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #nextId = 0;
  #closed: Promise<void> | undefined;
  #onClosed = () => {};

  constructor({ home, library = `libvaulty.${suffix}` }: VaultOptions = {}) {
    // Only a call in flight keeps the process alive, so a script can end without `close`.
    this.#worker.unref();
    this.#worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      if ("closed" in data) {
        this.#worker.terminate();
        this.#onClosed();
        return;
      }
      const pending = this.#pending.get(data.id);
      this.#pending.delete(data.id);
      this.#unrefWhenIdle();
      const reply = JSON.parse(data.reply) as { result: unknown } | { error: string; code: T.ErrorCode };
      if ("error" in reply) pending?.reject(new VaulteError(reply.error, reply.code));
      else pending?.resolve(renameKeys(reply.result, toCamel));
    };
    this.#worker.onerror = (event) => {
      for (const { reject } of this.#pending.values()) reject(new Error(event.message));
      this.#pending.clear();
      this.#unrefWhenIdle();
    };
    this.#post({ library, home });
  }

  /** Closing keeps the process alive until the handle is let go. */
  #unrefWhenIdle() {
    if (this.#pending.size === 0 && this.#closed === undefined) this.#worker.unref();
  }

  #post(request: Request) {
    this.#worker.postMessage(request);
  }

  #call<Result>(method: string, args: object = {}): Promise<Result> {
    if (this.#closed !== undefined) return Promise.reject(new VaulteError("this vault is closed", "error"));
    const id = this.#nextId++;
    const call = JSON.stringify({ method: toSnake(method), ...(renameKeys(args, toSnake) as object) });
    return new Promise<unknown>((resolve, reject) => {
      if (this.#pending.size === 0) this.#worker.ref();
      this.#pending.set(id, { resolve, reject });
      this.#post({ id, call });
    }) as Promise<Result>;
  }

  async #run(method: string, args?: object): Promise<void> {
    await this.#call(method, args);
  }

  /** Waits for calls already made, then lets the handle go. */
  close(): Promise<void> {
    this.#closed ??= new Promise((resolve) => {
      this.#onClosed = resolve;
      this.#worker.ref();
      this.#post({ close: true });
    });
    return this.#closed;
  }

  /** Needs no broker. */
  exists() {
    return this.#call<boolean>("exists");
  }

  /** Whether this vault asks for a passphrase in place of a touch. */
  needsPassphrase() {
    return this.#call<boolean>("needsPassphrase");
  }

  hasSecureHardware() {
    return this.#call<boolean>("hasSecureHardware");
  }

  deviceName() {
    return this.#call<string>("deviceName");
  }

  /** Starts a new vault. `passphrase` is for devices without secure hardware. */
  setupBegin(args: { passphrase?: string } = {}) {
    return this.#run("setupBegin", args);
  }

  /** The 24 recovery words, separated by spaces. */
  setupWords() {
    return this.#call<string>("setupWords");
  }

  setupPositions() {
    return this.#call<[number, number, number]>("setupPositions");
  }

  setupCheckWord(args: { position: number; answer: string }) {
    return this.#call<boolean>("setupCheckWord", args);
  }

  setupFinish(args: { deviceName: string }) {
    return this.#run("setupFinish", args);
  }

  /** Listens for an enrolled device, returning the port it can be reached on. Writes nothing yet. */
  joinBegin(args: { passphrase?: string; deviceName: string }) {
    return this.#call<number>("joinBegin", args);
  }

  /** Waits for a device to connect, and returns the words both screens show. */
  joinWait(args: { seconds: number }) {
    return this.#call<[string, string, string]>("joinWait", args);
  }

  /** The words match. Waits for the other device to approve, then creates the vault here. */
  joinConfirm() {
    return this.#run("joinConfirm");
  }

  /** Opens a backup folder or archive with the 24 words. `asItStood` opens it as it was before they were replaced. */
  recoverOpen({ asItStood = false, ...args }: { source: string; words: string; asItStood?: boolean }) {
    return this.#run("recoverOpen", { ...args, asItStood });
  }

  /** With two or more, the person picks theirs with `recoverChoose` before finishing. */
  recoverHistories() {
    return this.#call<T.RecoveredHistory[]>("recoverHistories");
  }

  recoverChoose(args: { index: number }) {
    return this.#run("recoverChoose", args);
  }

  /** What is wrong with the open copy, for a person to weigh before trusting it. */
  recoverProblems() {
    return this.#call<string[]>("recoverProblems");
  }

  recoverFinish(args: { passphrase?: string; deviceName: string }) {
    return this.#run("recoverFinish", args);
  }

  /** Connecting happens by itself. This is for a software vault's passphrase or an agent's session token. */
  connect(args: { passphrase?: string; session?: string }) {
    return this.#run("connect", args);
  }

  status() {
    return this.#call<T.Status>("status");
  }

  /** A session for an agent, limited to one space, after a touch. Hand its `token` to `connect`. */
  grant(args: { space?: string; agent: string; seconds: number }) {
    return this.#call<{ token: string; id: string }>("grant", args);
  }

  grants() {
    return this.#call<T.Grant[]>("grants");
  }

  endGrant(args: { id: string }) {
    return this.#run("endGrant", args);
  }

  /** Stops the broker, which locks the vault. */
  stop() {
    return this.#run("stop");
  }

  unlock() {
    return this.#run("unlock");
  }

  lock() {
    return this.#run("lock");
  }

  spaces() {
    return this.#call<string[]>("spaces");
  }

  createSpace(args: { name: string }) {
    return this.#run("createSpace", args);
  }

  items(args: Space = {}) {
    return this.#call<T.Item[]>("items", args);
  }

  item(args: Named) {
    return this.#call<T.Item>("item", args);
  }

  /** Allowed hosts for a well-known name are filled in by the library. */
  addEnv(args: Named & { value: string }) {
    return this.#run("addEnv", args);
  }

  /** With no `password`, the library generates one. `totp` is a two-factor secret as a site shows it. */
  addLogin(args: Named & { username?: string; urls?: string[]; password?: string; totp?: string }) {
    return this.#run("addLogin", args);
  }

  addNote(args: Named & { body: string }) {
    return this.#run("addNote", args);
  }

  addSsh(args: Named & { privateKey: string }) {
    return this.#run("addSsh", args);
  }

  /** The network's name is the item's name. */
  addWifi(args: Named & { password: string }) {
    return this.#run("addWifi", args);
  }

  /** The library checks the number and keeps only a safe hint in view. */
  addCard(args: Named & { number: string; expiry: string; cvc: string; holder: string }) {
    return this.#run("addCard", args);
  }

  addProfile(args: Named & { profile: Partial<T.Profile> }) {
    return this.#run("addProfile", args);
  }

  /** Changes what is shown, and the secret only when one is given, after a touch. The old version stays in its history. */
  edit(args: Named & { meta: T.Meta; secret?: T.Secret }) {
    return this.#run("edit", args);
  }

  remove(args: Named) {
    return this.#run("remove", args);
  }

  /** Reverses this device's last change not undone yet, and resolves to the names of the items it changed back. */
  undo() {
    return this.#call<string[]>("undo");
  }

  history(args: Named) {
    return this.#call<T.Version[]>("history", args);
  }

  restore(args: Named & { version: number }) {
    return this.#run("restore", args);
  }

  /** After a touch. */
  reveal(args: Named) {
    return this.#call<T.Secret>("reveal", args);
  }

  /** A login's current code, after a touch. The setup key never leaves the broker. */
  code(args: Named) {
    return this.#call<T.Code>("code", args);
  }

  removeCode(args: Named) {
    return this.#run("removeCode", args);
  }

  /** Cards that run out soon. Never asks for a touch. */
  expiring() {
    return this.#call<T.Item[]>("expiring");
  }

  autofillIdentities() {
    return this.#call<T.AutofillIdentity[]>("autofillIdentities");
  }

  /** `origin` is what the system or browser reports, never the page. */
  fillOptions(args: { origin: string }) {
    return this.#call<T.FillOption[]>("fillOptions", args);
  }

  /** After a touch naming the item and the site. */
  fill(args: { space: string; name: string; origin: string }) {
    return this.#call<T.Filled>("fill", args);
  }

  async icon(args: Space & { url: string }): Promise<T.Icon | null> {
    const icon = await this.#call<{ width: number; height: number; rgba: number[] } | null>("icon", args);
    return icon && { ...icon, rgba: Uint8Array.from(icon.rgba) };
  }

  /** The first icon saved for a site stays. */
  saveIcon({ png, ...args }: Space & { url: string; png: Uint8Array }) {
    return this.#run("saveIcon", { ...args, png: Buffer.from(png).toString("base64") });
  }

  generatePassword(args: { length?: number; symbols?: boolean } = {}) {
    return this.#call<string>("generatePassword", args);
  }

  /** Random bytes, in hex. */
  generateSecret(args: { bytes: 32 | 64 }) {
    return this.#call<string>("generateSecret", args);
  }

  /** Lets an env var be sent to `host`, after a touch. */
  allow(args: Named & { host: string }) {
    return this.#run("allow", args);
  }

  /** Reads a file into memory and says what is in it. Nothing touches the vault. */
  importRead(args: { path: string }) {
    return this.#call<T.ImportPreview>("importRead", args);
  }

  /** Writes what `importRead` found, as one batch. */
  importFinish(args: Space = {}) {
    return this.#call<T.Imported>("importFinish", args);
  }

  devices() {
    return this.#call<T.Device[]>("devices");
  }

  /** Finds a joining device, at `address` or on this network, and returns the words to compare. */
  pairBegin(args: { address?: string } = {}) {
    return this.#call<[string, string, string]>("pairBegin", args);
  }

  /** The words match. Returns the new device's name. */
  pairConfirm(args: { recovery?: string } = {}) {
    return this.#call<string>("pairConfirm", args);
  }

  /** Returns the names of everything that device could read. */
  removeDevice(args: { name: string; recovery?: string }) {
    return this.#call<string[]>("removeDevice", args);
  }

  /** Starts replacing the recovery key. Confirm with the other `rotation` calls, then `rotationFinish`. */
  rotationBegin() {
    return this.#run("rotationBegin");
  }

  rotationWords() {
    return this.#call<string>("rotationWords");
  }

  rotationPositions() {
    return this.#call<[number, number, number]>("rotationPositions");
  }

  rotationCheckWord(args: { position: number; answer: string }) {
    return this.#call<boolean>("rotationCheckWord", args);
  }

  rotationFinish(args: { recovery?: string } = {}) {
    return this.#run("rotationFinish", args);
  }

  exportArchive(args: { path: string }) {
    return this.#run("exportArchive", args);
  }

  exportPlaintext(args: { path: string; recovery?: string }) {
    return this.#run("exportPlaintext", args);
  }

  /** iCloud Drive's folder, when it is in use. */
  icloudDrive() {
    return this.#call<string | null>("icloudDrive");
  }

  addBackup(args: { folder: string }) {
    return this.#run("addBackup", args);
  }

  removeBackup(args: { folder: string }) {
    return this.#run("removeBackup", args);
  }

  verifyBackup(args: { folder: string }) {
    return this.#call<T.BackupReport>("verifyBackup", args);
  }

  syncNow() {
    return this.#call<T.SyncReport>("syncNow");
  }

  resolveConflict(args: { words: string }) {
    return this.#call<number>("resolveConflict", args);
  }

  wipe(args: { deviceName: string }) {
    return this.#run("wipe", args);
  }

  audit() {
    return this.#call<T.AuditEvent[]>("audit");
  }
}
