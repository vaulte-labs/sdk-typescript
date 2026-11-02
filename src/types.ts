// What libvault sends back, with its field names in camelCase.

/** Stable across every Vaulte interface, so an agent can act on it. */
export type ErrorCode =
  | "error"
  | "locked"
  | "needs_passphrase"
  | "denied"
  | "not_found"
  | "needs_person"
  | "needs_host"
  /** The broker running is older than this library. Restarting it brings the new one. */
  | "outdated";

export type Kind = "login" | "card" | "env" | "note" | "ssh" | "passkey" | "wifi" | "profile" | "icon";

/** What is safe to show about an item. Lists never hold a secret. */
export interface Meta {
  kind: Kind;
  name: string;
  username?: string;
  /** Sites a login may fill on. */
  urls?: string[];
  /** Hosts an env var may be sent to through the proxy. */
  hosts?: string[];
  /** Safe to show in lists, such as a card's brand and last four digits. */
  hint?: string;
  twoFactor?: boolean;
  /** When a card runs out, as `2030-12`. */
  expires?: string;
}

export interface Item extends Meta {
  space: string;
  /** The other spaces this same item is in, when the caller may know of them. */
  alsoIn?: string[];
  /** The item's home, when this copy is one linked from there. */
  linkedFrom?: string;
}

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** As `1990-04-21`. */
  birthDate: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  /** A state, province or region. */
  region: string;
  postalCode: string;
  /** Two capital letters, as `US` or `DE`. */
  country: string;
}

export type Secret =
  | { type: "login"; password: string; totp?: string }
  | { type: "card"; number: string; expiry: string; cvc: string; holder: string }
  | { type: "env"; value: string }
  | { type: "note"; body: string }
  | { type: "ssh"; privateKey: string }
  | { type: "wifi"; password: string }
  | ({ type: "profile" } & Partial<Profile>)
  | { type: "icon"; png: string }
  | { type: "passkey"; rpId: string; userHandle: string; credentialId: string; privateKey: string };

export interface Status {
  unlocked: boolean;
  hardware: boolean;
  deviceCount: number;
  /** The port other devices reach this one on, while it is not the only device. */
  syncPort: number | null;
  backups: { path: string; lastOkMs: number | null; problem: string | null }[];
  /** When each other device was last heard from, since the broker started. */
  contacts: { device: string; lastOkMs: number | null }[];
  /** Nothing else holds this vault: no other device, and no backup that can be reached now. */
  lastCopy: boolean;
  problems: string[];
  /** This connection is one of the vault's own signed apps, so everyday use needs no touch while open. */
  trusted: boolean;
  /** Which build the broker is. */
  build: string;
  /** Changes whenever the vault does, from any caller or device. Only whether it changed means anything. */
  revision: number;
}

export interface Grant {
  id: string;
  agent: string;
  space: string;
  secondsLeft: number;
}

export interface Version {
  atMs: number;
  deleted: boolean;
}

export interface Code {
  code: string;
  secondsLeft: number;
}

/** One login's code, and where it is. */
export interface SpaceCode extends Code {
  space: string;
  name: string;
}

export type StayUnlocked = "five_minutes" | "ten_minutes" | "one_hour" | "two_hours" | "never";

/** When this device's vault locks by itself. */
export interface LockSettings {
  stayUnlocked: StayUnlocked;
  /** Whether locking the screen, or the device sleeping, locks the vault too. */
  withScreen: boolean;
}

/** Four bytes per pixel, red, green, blue and alpha, row by row from the top. */
export interface Icon {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** What a file holds, as counts. Row numbers point at what could not be read. */
export interface ImportPreview {
  logins: number;
  loginsWithCodes: number;
  variables: number;
  unreadable: number[];
}

/** Identical items are skipped and a clashing name gets a suffix, so nothing is overwritten. */
export interface Imported {
  added: number;
  skipped: number;
  renamed: number;
}

export interface Device {
  name: string;
  isThisDevice: boolean;
}

/** `current` is false when the copy has fallen behind this device. */
export interface BackupReport {
  devices: number;
  entries: number;
  current: boolean;
  problems: string[];
}

export interface SyncReport {
  peersReached: number;
  peersMissed: number;
  backupProblems: string[];
}

export interface AuditEvent {
  atMs: number;
  action: string;
  target: string;
  actor: string;
}

export interface FillOption {
  space: string;
  name: string;
  kind: Kind;
  username: string | null;
  hint: string | null;
}

/** A site and a username, never a secret. */
export interface AutofillIdentity {
  site: string;
  username: string | null;
  space: string;
  name: string;
}

/** A login carries its current code instead of its two-factor secret. */
export interface Filled {
  username: string | null;
  secret: Secret;
  code: string | null;
}

/** One history in a recovered copy: its devices and the newest items the words open there. */
export interface RecoveredHistory {
  devices: string[];
  newestItems: string[];
}
