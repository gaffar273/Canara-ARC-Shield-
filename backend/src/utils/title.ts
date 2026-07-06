/**
 * Title hygiene shared by intake (seeding) and the orchestrator (write-back).
 *
 * A circular's title must be human-readable: never mojibake (replacement chars
 * from an undecodable PDF font), never an opaque id/hash (an upload named
 * NT153AC48B7D5...). These guards mirror Node 1's `sanitize_title`.
 */

/** A bare hash/opaque-id token unfit to be a title (SHA fragment, hashy upload name). */
export function isHashLike(token: string): boolean {
  const t = token.trim();
  if (!t || /\s/.test(t)) return false;
  if (t.length >= 24 && /^[0-9A-Fa-f]+$/.test(t)) return true;
  if (t.length >= 20 && /^[A-Za-z0-9]+$/.test(t)) {
    const digits = (t.match(/\d/g) ?? []).length;
    return digits / t.length >= 0.25;
  }
  return false;
}

/** Whether a candidate is a clean, human-readable title (not empty/mojibake/hash). */
export function looksLikeTitle(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length < 4 || v.includes("�") || isHashLike(v)) return false;
  const letters = [...v].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return false;
  const ascii = letters.filter((c) => c.charCodeAt(0) < 128).length;
  return ascii / letters.length >= 0.7;
}

/**
 * A clean title from the best available source: a candidate if usable, else the
 * filename stem (unless hash-like), else the ref number, else a generic label.
 */
export function deriveTitle(
  candidate: string | null | undefined,
  filename: string,
  refNumber: string | null,
): string {
  if (looksLikeTitle(candidate)) return candidate!.trim().slice(0, 160);
  const stem = filename.replace(/\.pdf$/i, "");
  if (looksLikeTitle(stem)) return stem.slice(0, 160);
  if (refNumber) return refNumber;
  return "Untitled circular";
}
