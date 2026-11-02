# Vaulte TypeScript SDK

> **[Vaulte](https://vaulte.caeser.workers.dev) is the password manager for you and your agents.** The Mac
> app, browser extension and `vlt` CLI, with end-to-end encrypted sync across your devices, in one
> subscription. **[Get Vaulte →](https://vaulte.caeser.workers.dev)**

Use [Vaulte](https://vaulte.caeser.workers.dev) from TypeScript: give an agent a time-boxed grant,
add and list secrets, fill logins and read 2FA codes, with each approval going to the person. The
package is `@vaulte/sdk`. It runs on [Bun](https://bun.sh), over the
[C SDK](https://github.com/vaulte-labs/sdk-c)'s ABI.

| SDK | Repository |
|---|---|
| TypeScript, for Bun | this one |
| C and Swift | [sdk-c](https://github.com/vaulte-labs/sdk-c) |

```ts
import { Vault } from "@vaulte/sdk";

// Lets deploy-bot use the Personal space for an hour, after a touch.
const vault = new Vault();
const { token } = await vault.grant({ space: "Personal", agent: "deploy-bot", seconds: 3600, reason: "deploy the site" });

// The agent's side, usually another process.
const agent = new Vault();
await agent.connect({ session: token });
console.log(await agent.items());
```

Each `Vault` runs its calls one at a time on a thread of its own, so a call waiting for a person
holds up the next; use a second `Vault` to run calls side by side. Policy stays in the
broker, so nothing here can do more than the person allowed. A failure rejects with a `VaulteError`
whose `code` says why. Every method is typed in [src/vault.ts](src/vault.ts).

## Install

Not on npm yet. Install it from GitHub:

```sh
bun add github:vaulte-labs/sdk-typescript
```

It needs two things from the [C SDK](https://github.com/vaulte-labs/sdk-c), built as its README says:

- `libvaulty.dylib` (or `.so`) where the dynamic loader finds it, such as `/usr/local/lib`, or passed
  as `new Vault({ library: "/path/to/libvaulty.dylib" })`.
- `lvd`, the broker that holds the keys, on `PATH`.

## Develop

Clone [libvault](https://github.com/vaulte-labs/libvault) and
[sdk-c](https://github.com/vaulte-labs/sdk-c) beside this repository. You need Bun (pinned in
`mise.toml`), Rust, and on a Mac, Xcode 26 or its Command Line Tools.

```sh
bun run check    # builds the C SDK and lvd with test hooks, type-checks, and runs every test
```

It must pass before every commit.

## Contributing and security

See [CONTRIBUTING.md](https://github.com/vaulte-labs/.github/blob/main/CONTRIBUTING.md). Report a
vulnerability privately from the **Security** tab, as
[SECURITY.md](https://github.com/vaulte-labs/.github/blob/main/SECURITY.md) explains.

## License

[AGPL-3.0-only](LICENSE). If its terms don't suit you, a [commercial license](COMMERCIAL.md) is
available.
