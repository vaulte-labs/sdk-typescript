// Lets deploy-bot use the Personal space for an hour, after a touch, then looks at the vault as the agent.
import { Vault } from "@vaulte/sdk";

const vault = new Vault();
if (await vault.needsPassphrase()) await vault.connect({ passphrase: prompt("Passphrase:") ?? "" });
const { token } = await vault.grant({ space: "Personal", agent: "deploy-bot", seconds: 3600, reason: "deploy the site" });

// The agent's side, usually another process, which `vlt` gets as LV_SESSION.
const agent = new Vault();
await agent.connect({ session: token });
console.log(await agent.items());
