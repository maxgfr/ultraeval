import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "ultraeval");
const raw = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

describe("SKILL.md packaging", () => {
  it("has a frontmatter block", () => {
    expect(fm).toBeTruthy();
  });

  it("frontmatter name matches the package", () => {
    expect(fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim()).toBe("ultraeval");
  });

  it("description is present and <= 1000 chars (matcher headroom)", () => {
    const desc = (fm?.[1]?.match(/^description:\s*(.+)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(1000);
  });

  it("every reference SKILL.md links actually ships", () => {
    for (const m of raw.matchAll(/references\/[A-Za-z0-9_./-]+\.md/g)) {
      expect(existsSync(join(SKILL_DIR, m[0]))).toBe(true);
    }
  });
});
