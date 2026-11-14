import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// CHANGELOG.md follows Claude Code's changelog shape: `## <version>` headings,
// newest first, under an `## Unreleased` section that collects changes until
// the next release; each entry is one user-facing line that starts with a verb.

const ROOT = new URL("..", import.meta.url).pathname;
const changelog = readFileSync(`${ROOT}CHANGELOG.md`, "utf8");
const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as { version: string };

const VERBS = ["Added", "Improved", "Changed", "Fixed", "Removed", "Deprecated"];

type Section = { heading: string; entries: string[] };

function sections(text: string): Section[] {
  const out: Section[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) out.push({ heading: line.slice(3).trim(), entries: [] });
    else if (line.startsWith("- ") && out.length > 0) out.at(-1)!.entries.push(line.slice(2));
  }
  return out;
}

function semver(v: string): number[] {
  return v.split(".").map(Number);
}

function newer(a: string, b: string): boolean {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

describe("CHANGELOG.md", () => {
  const all = sections(changelog);
  const released = all.filter((s) => s.heading !== "Unreleased");

  test("starts with Unreleased, then versions newest first", () => {
    expect(all[0]?.heading).toBe("Unreleased");
    for (const s of released) expect(s.heading).toMatch(/^\d+\.\d+\.\d+$/);
    for (let i = 1; i < released.length; i++) {
      expect(newer(released[i - 1]!.heading, released[i]!.heading)).toBe(true);
    }
  });

  test("the newest version is package.json's", () => {
    expect(released[0]?.heading).toBe(pkg.version);
  });

  test("each entry is one line that starts with a verb", () => {
    for (const s of all) {
      for (const e of s.entries) {
        expect(VERBS.some((v) => e.startsWith(`${v} `)), `${s.heading}: ${e}`).toBe(true);
      }
    }
  });
});
