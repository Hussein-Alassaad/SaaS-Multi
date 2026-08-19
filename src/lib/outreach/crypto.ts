/**
 * AES-256-GCM encryption for secrets stored at rest (currently: OutreachAccount
 * proxy passwords -- see prisma/schema.prisma's proxyPasswordEnc comment).
 * The original single-tenant app stored proxy_password in plaintext; this
 * rebuild has multiple real tenants sharing the accounts table, so
 * credentials must actually be encrypted, not just column-renamed.
 *
 * OUTREACH_ENCRYPTION_KEY is a 32-byte key, base64-encoded (generate with
 * `openssl rand -base64 32`). Base64 was picked over hex only because
 * that's what `openssl rand -base64 32` prints by default -- either would
 * work, this just avoids an extra `xxd`/`--hex` step for whoever sets it.
 *
 * Storage format: "iv:authTag:ciphertext", each hex-encoded, colon-joined --
 * self-contained in one string so decryption never needs a second lookup.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function loadKey(): Buffer {
  const raw = process.env.OUTREACH_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "OUTREACH_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in your environment before encrypting secrets."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `OUTREACH_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`
    );
  }
  return key;
}

/**
 * Encrypts a plaintext secret. Only throws (missing/invalid key) when
 * actually called with something to encrypt -- never at module load time,
 * so pages/tests that don't touch proxy passwords are unaffected by an
 * unset key.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

/**
 * Decrypts a value produced by encryptSecret(). Returns null instead of
 * throwing on any failure (missing key, malformed stored value, tampered
 * ciphertext) -- callers treat "can't decrypt" the same as "nothing set"
 * rather than crashing a page render over it.
 */
export function decryptSecret(ciphertext: string): string | null {
  try {
    const key = loadKey();
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, dataHex] = parts;
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
