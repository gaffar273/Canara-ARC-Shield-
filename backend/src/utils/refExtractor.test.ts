import { describe, it, expect } from "vitest";
import { normalizeRef, extractRefs } from "./refExtractor.js";

describe("normalizeRef", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeRef("rbi/2023-24/45")).toBe("RBI/2023-24/45");
    expect(normalizeRef("DOR.STR.REC.12 / 21.04.048 / 2023-24")).toBe(
      "DOR.STR.REC.12/21.04.048/2023-24",
    );
  });

  it("is idempotent", () => {
    const once = normalizeRef("DBOD.No.BP.BC.9 /21.04.048/ 2014-15");
    expect(normalizeRef(once)).toBe(once);
  });
});

describe("extractRefs", () => {
  it("extracts master + dept own refs and prefers the dept ref as canonical", () => {
    const text = `RBI/2023-24/45
      DOR.STR.REC.12/21.04.048/2023-24
      July 1, 2023
      Madam / Sir, ...`;
    const { refNumber, references } = extractRefs(text);
    expect(refNumber).toBe("DOR.STR.REC.12/21.04.048/2023-24");
    expect(references).toEqual([]);
  });

  it("extracts cited refs and excludes the circular's own refs", () => {
    const text = `RBI/2023-24/45
      DOR.STR.REC.12/21.04.048/2023-24
      In supersession of our circular DBOD.No.BP.BC.9/21.04.048/2014-15 dated
      July 1, 2014 and read with RBI/2018-19/100.`;
    const { refNumber, references } = extractRefs(text);
    expect(refNumber).toBe("DOR.STR.REC.12/21.04.048/2023-24");
    expect(references).toContain("DBOD.NO.BP.BC.9/21.04.048/2014-15");
    expect(references).toContain("RBI/2018-19/100");
    expect(references).not.toContain("DOR.STR.REC.12/21.04.048/2023-24");
    expect(references).not.toContain("RBI/2023-24/45");
  });

  it("dedupes repeated citations", () => {
    const text = `DOR.STR.REC.12/21.04.048/2023-24
      see DBOD.No.BP.BC.9/21.04.048/2014-15 ... again DBOD.No.BP.BC.9/21.04.048/2014-15`;
    const { references } = extractRefs(text);
    expect(references.filter((r) => r === "DBOD.NO.BP.BC.9/21.04.048/2014-15")).toHaveLength(1);
  });

  it("returns nulls/empties for a document with no refs", () => {
    expect(extractRefs("This circular has no recognizable reference numbers.")).toEqual({
      refNumber: null,
      references: [],
    });
  });

  it("falls back to master ref when no dept ref is present", () => {
    const { refNumber } = extractRefs("RBI/2023-24/45 and nothing else structured");
    expect(refNumber).toBe("RBI/2023-24/45");
  });
});
