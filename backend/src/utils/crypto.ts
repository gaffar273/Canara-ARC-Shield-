import { createHash, randomBytes } from "node:crypto";

export function sha256(input: Buffer | string): string {
  return "0x" + createHash("sha256").update(input).digest("hex");
}

export function sha256Of(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function shortHash(hash: string): string {
  const body = hash.startsWith("0x") ? hash.slice(2) : hash;
  return `0x${body.slice(0, 4)}...${body.slice(-4)}`;
}

export function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}
