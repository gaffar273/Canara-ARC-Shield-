const MASTER_REF = /\bRBI\s*\/\s*\d{4}-\d{2}\s*\/\s*\d+\b/g;

// Department ref, e.g. DOR.STR.REC.12/21.04.048/2023-24 or legacy DBOD.No.BP.BC.9/...
// Anchored on the rigid <subject-code>/<year> tail; the prefix is the dotted
// department-code block ending in the circular's serial number.
const DEPT_REF = /\b[A-Z][A-Za-z0-9.()\-]*\d\s*\/\s*\d{2}\.\d{2}\.\d{3}\s*\/\s*\d{4}-\d{2}\b/g;

export function normalizeRef(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

function matchAll(text: string, re: RegExp): string[] {
  return (text.match(re) ?? []).map(normalizeRef);
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

export interface ExtractedRefs {
  refNumber: string | null;
  references: string[];
}

/**
 * Pull the circular's own ref and the refs it cites from extracted PDF text.
 * Deterministic, no AI. The own dept ref is preferred as the canonical key
 * because circular bodies cite each other by dept ref (not the RBI/yyyy/n
 * master number), so resolution must key on the dept form.
 */
export function extractRefs(text: string): ExtractedRefs {
  const masters = matchAll(text, MASTER_REF);
  const depts = matchAll(text, DEPT_REF);

  const ownMaster = masters[0] ?? null;
  const ownDept = depts[0] ?? null;
  const refNumber = ownDept ?? ownMaster;

  const self = new Set([ownMaster, ownDept].filter((r): r is string => r !== null));
  const references = distinct([...masters, ...depts]).filter((r) => !self.has(r));

  return { refNumber, references };
}
