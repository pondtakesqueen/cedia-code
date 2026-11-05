#!/usr/bin/env bun
// Usage: bun evals/gate-report.ts                                  (in CI: reads the pull_request event)
//        bun evals/gate-report.ts --files <list.txt> --body <body.md>
//
// The free half of the regression gate in CI. The gate itself runs where a key and a quota are (your machine or a
// Claude session), and its report goes in the PR's "Eval gate" section. This check fails a pull request that changes
// what the model sees or how a run is scored when that section holds no gate report and no reason the gate is not
// needed, which is how #218, #222, #234 and #236 merged without a run. It never calls a model.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// The paths AGENTS.md means by "a prompt, a default, the loop, a tool or the trust layer", and what scores a run.
const GATED_FILES = new Set([
  "src/core/prompts.ts", "src/core/roles.ts", "src/core/config.ts", "src/core/profiles.ts", "src/core/side-model.ts",
  "src/cli.ts", "package.json", "bun.lock",
]);
const GATED_DIRS = [
  "src/core/loop/", "src/core/tools/", "src/core/trust/", "src/core/safety/", "src/core/context/", "src/core/session/",
  "src/core/memory/", "src/core/skills/", "src/core/providers/", "src/clients/headless/", "evals/gate/", "evals/tasks/",
];
// The checker and the gate's docs change nothing a run does.
const NOT_GATED = new Set(["evals/gate-report.ts", "evals/gate/README.md"]);

export function gatedFiles(files: string[]): string[] {
  return files.filter((f) => !NOT_GATED.has(f) && (GATED_FILES.has(f) || GATED_DIRS.some((d) => f.startsWith(d)) || /^evals\/[^/]+\.ts$/.test(f)));
}

// The text under the "Eval gate" heading, up to the next heading, without HTML comments (the template's hint).
export function gateSection(body: string): string | null {
  const lines = body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s*eval gate\b/i.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l.trim()) || /^---\s*$/.test(l.trim()));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

export type Verdict =
  | { ok: true; kind: "not-gated" | "report" | "not-needed"; message: string }
  | { ok: false; kind: "missing-section" | "no-report"; message: string };

// A report is what `bun evals/gate.ts` prints (a model's PASS, REGRESSED or INCONCLUSIVE line) or a gate result
// file. "Not needed" counts only with a reason after it, which the reviewer can then disagree with.
export function judge(files: string[], body: string): Verdict {
  const gated = gatedFiles(files);
  if (!gated.length) return { ok: true, kind: "not-gated", message: "No file the gate covers changed." };
  const shown = gated.slice(0, 5).join(", ") + (gated.length > 5 ? `, and ${gated.length - 5} more` : "");
  const section = gateSection(body);
  if (section === null) {
    return { ok: false, kind: "missing-section", message: `This PR changes ${shown}, and its description has no "## Eval gate" section. Run \`bun evals/gate.ts --estimate\`, then \`bun evals/gate.ts\`, and paste the report there, or write "Not needed" and why.` };
  }
  if (/\b(PASS|REGRESSED|INCONCLUSIVE)\b/.test(section) || /evals\/results\/\S*gate\S*\.jsonl/.test(section)) {
    return { ok: true, kind: "report", message: "The Eval gate section holds a gate report." };
  }
  const notNeeded = /^\W*not needed\b\W*(.*)$/is.exec(section);
  if (notNeeded && notNeeded[1]!.trim().length >= 10) {
    return { ok: true, kind: "not-needed", message: `The Eval gate section says the gate is not needed: ${section.replace(/\s+/g, " ").slice(0, 200)}` };
  }
  return { ok: false, kind: "no-report", message: `This PR changes ${shown}, and its Eval gate section holds no gate report. Run \`bun evals/gate.ts --estimate\`, then \`bun evals/gate.ts\`, and paste the report there, or write "Not needed" and why.` };
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: string[]): number {
  let files: string[];
  let body: string;
  const filesPath = arg(argv, "--files");
  if (filesPath) {
    files = readFileSync(filesPath, "utf8").split("\n").filter(Boolean);
    body = readFileSync(arg(argv, "--body") ?? "/dev/null", "utf8");
  } else {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) { console.error("gate-report: pass --files and --body, or run in a pull_request workflow"); return 2; }
    const pr = JSON.parse(readFileSync(eventPath, "utf8")).pull_request;
    if (!pr) { console.error("gate-report: the event has no pull_request"); return 2; }
    body = pr.body ?? "";
    files = execFileSync("git", ["diff", "--name-only", `${pr.base.sha}...${pr.head.sha}`], { encoding: "utf8" }).split("\n").filter(Boolean);
  }
  const v = judge(files, body);
  const ci = !!process.env.GITHUB_ACTIONS;
  console.log(ci ? `::${v.ok ? "notice" : "error"}::${v.message}` : v.message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Eval gate report: ${v.ok ? "ok" : "missing"}\n\n${v.message}\n`);
  return v.ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
