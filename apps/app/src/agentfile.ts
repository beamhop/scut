// An agent in a file: the encrypted beam bundle plus the keys to open it, locked with a passphrase.
// Moving an agent "by file" lets it travel to another computer (or another person's Beamhop) with no network path
// between the two. The bundle is the same AES-256-GCM bundle a live beam sends; the agent key and bundle key are
// sealed with a key derived from the passphrase (PBKDF2-SHA256), so the file alone is useless without it.

const MAGIC = "BEAMHOP-AGENT-1\n";
const ITER = 310_000;

export interface AgentFileHeader {
  v: 1;
  id: string;
  name: string;
  mascot: string;
  harness: string;
  agentPubkey: string;
  model?: { baseUrl?: string; model: string };
  nostr?: boolean;
  hash: string; // sha256 of the encrypted bundle
  size: number;
  leaseSeq: number; // the lease number the file holds; the next host gets leaseSeq + 1
  exportedAt: number;
  kdf: { salt: string; iter: number };
  secrets: { iv: string; ct: string }; // AES-GCM over {bundleKey, agentSk}
}
export interface AgentSecrets { bundleKey: string; agentSk: string }

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function passKey(passphrase: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function writeAgentFile(h: Omit<AgentFileHeader, "v" | "kdf" | "secrets">, secrets: AgentSecrets, passphrase: string, bundle: Uint8Array): Promise<Uint8Array> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passKey(passphrase, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(secrets))));
  const header: AgentFileHeader = { v: 1, ...h, kdf: { salt: b64(salt), iter: ITER }, secrets: { iv: b64(iv), ct: b64(ct) } };
  const head = new TextEncoder().encode(MAGIC + JSON.stringify(header) + "\n");
  const out = new Uint8Array(head.length + bundle.length);
  out.set(head, 0);
  out.set(bundle, head.length);
  return out;
}

/** Parse without the passphrase: enough to show what's inside before asking for it. */
export function readAgentFileHeader(file: Uint8Array): { header: AgentFileHeader; bundle: Uint8Array } {
  const magic = new TextDecoder().decode(file.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error("That isn't a Beamhop agent file");
  const nl = file.indexOf(10, MAGIC.length);
  if (nl < 0) throw new Error("This agent file is damaged");
  const header = JSON.parse(new TextDecoder().decode(file.subarray(MAGIC.length, nl))) as AgentFileHeader;
  const bundle = file.subarray(nl + 1);
  if (bundle.length !== header.size) throw new Error("This agent file is incomplete (was the download cut short?)");
  return { header, bundle };
}

export async function openAgentFile(file: Uint8Array, passphrase: string): Promise<{ header: AgentFileHeader; bundle: Uint8Array; secrets: AgentSecrets }> {
  const { header, bundle } = readAgentFileHeader(file);
  const key = await passKey(passphrase, unb64(header.kdf.salt), header.kdf.iter);
  let secrets: AgentSecrets;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(header.secrets.iv) }, key, unb64(header.secrets.ct));
    secrets = JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error("Wrong passphrase");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bundle as Uint8Array<ArrayBuffer>));
  if (Buffer.from(digest).toString("hex") !== header.hash) throw new Error("This agent file is damaged");
  return { header, bundle, secrets };
}
