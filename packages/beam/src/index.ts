// State bundle: /data packed as tar.gz, encrypted with AES-256-GCM, addressed by sha256.
import { bytesToHex, hexToBytes } from "@scut/protocol";

const EXCLUDES = ["./.host", "./chrome/Singleton*", "./chrome/*/Cache", "./chrome/*/Code Cache", "./tmp"];

export async function packDir(dir: string): Promise<Uint8Array> {
  const args = ["tar", "-C", dir, ...EXCLUDES.flatMap((e) => ["--exclude", e]), "-czf", "-", "."];
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const out = new Uint8Array(await new Response(p.stdout).arrayBuffer());
  const code = await p.exited;
  // tar exit 1 = "file changed as we read it" — acceptable after quiesce
  if (code > 1) throw new Error(`tar pack failed (${code}): ${await new Response(p.stderr).text()}`);
  return out;
}

export async function unpackDir(dir: string, tgz: Uint8Array): Promise<void> {
  await Bun.$`mkdir -p ${dir}`.quiet();
  const p = Bun.spawn(["tar", "-C", dir, "-xzf", "-"], { stdin: "pipe", stderr: "pipe" });
  p.stdin.write(tgz);
  await p.stdin.end();
  const code = await p.exited;
  if (code !== 0) throw new Error(`tar unpack failed (${code}): ${await new Response(p.stderr).text()}`);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

/** Encrypt: output = iv(12) || ciphertext+tag. */
export async function encrypt(plain: Uint8Array): Promise<{ cipher: Uint8Array; key: string; hash: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const cipher = new Uint8Array(12 + ct.length);
  cipher.set(iv, 0);
  cipher.set(ct, 12);
  return { cipher, key: bytesToHex(raw), hash: await sha256Hex(cipher) };
}

export async function decrypt(cipher: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: cipher.slice(0, 12) }, key, cipher.slice(12)));
}

export async function makeBundle(dir: string) {
  const tgz = await packDir(dir);
  const enc = await encrypt(tgz);
  return { ...enc, plainSize: tgz.length };
}

export async function openBundle(dir: string, cipher: Uint8Array, keyHex: string, expectHash?: string) {
  const hash = await sha256Hex(cipher);
  if (expectHash && hash !== expectHash) throw new Error(`bundle hash mismatch: ${hash} != ${expectHash}`);
  await unpackDir(dir, await decrypt(cipher, keyHex));
}
