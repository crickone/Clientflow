// Run: npm test -- src/lib/agents/skillImport.test.ts
//
// Turning a pasted line into a skill. The host allowlist lives in
// candidateUrls rather than in the fetcher, so these checks are the SSRF guard
// as much as they are parsing tests: anything not on GitHub must produce no
// URLs at all, which leaves the caller with nothing to request.
import assert from "node:assert/strict";

import { candidateUrls, parseSkillMarkdown, urlFrom } from "./skillImport";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ---------------------------------------------------------------------------
// Pulling the URL out of whatever was pasted
// ---------------------------------------------------------------------------
check("a bare URL", urlFrom("https://github.com/o/r") === "https://github.com/o/r");
// The line an operator actually has in front of them, off a README.
check(
  "a uv install line -- git+ is pip's prefix, not part of the address",
  urlFrom("uv tool install git+https://github.com/NVIDIA/skillspector.git") ===
    "https://github.com/NVIDIA/skillspector.git",
);
check(
  "a pip install line",
  urlFrom("pip install git+https://github.com/o/r.git") === "https://github.com/o/r.git",
);
check("surrounding whitespace and text", urlFrom("  see https://github.com/o/r for more  ") === "https://github.com/o/r");
check("trailing punctuation is not part of the URL", urlFrom("try https://github.com/o/r.") === "https://github.com/o/r");
check("nothing to find is null", urlFrom("just some words") === null);
check("empty is null", urlFrom("   ") === null);

// ---------------------------------------------------------------------------
// The allowlist — this is the SSRF guard
// ---------------------------------------------------------------------------
check("an internal address yields nothing to fetch", candidateUrls("http://169.254.169.254/latest/meta-data/").length === 0);
check("localhost likewise", candidateUrls("http://localhost:3000/api/health").length === 0);
check("a file URL likewise", candidateUrls("file:///etc/passwd").length === 0);
check("another host on https likewise", candidateUrls("https://evil.example.com/SKILL.md").length === 0);
// http:// to github is still not allowed: the guard is protocol AND host.
check("plain http to github is refused", candidateUrls("http://github.com/o/r").length === 0);
check("a lookalike host is refused", candidateUrls("https://github.com.evil.example/o/r").length === 0);
check("nonsense is refused", candidateUrls("not a url at all").length === 0);

// ---------------------------------------------------------------------------
// Where to look for the file
// ---------------------------------------------------------------------------
{
  const urls = candidateUrls("https://github.com/petergyang/no-ai-slop");
  check("a repo produces candidates", urls.length > 0);
  check("every candidate is a raw github URL", urls.every((u) => u.startsWith("https://raw.githubusercontent.com/")));
  check("the repo root is tried first", urls[0] === "https://raw.githubusercontent.com/petergyang/no-ai-slop/main/SKILL.md");
  // Where the repo this was built against actually keeps it.
  check(
    "and the skills/<repo>/ layout is tried too",
    urls.includes("https://raw.githubusercontent.com/petergyang/no-ai-slop/main/skills/no-ai-slop/SKILL.md"),
  );
  check("main is tried before master", urls.findIndex((u) => u.includes("/main/")) < urls.findIndex((u) => u.includes("/master/")));
}
check(
  "a .git suffix is stripped rather than becoming part of the repo name",
  candidateUrls("git+https://github.com/o/r.git")[0] ===
    "https://raw.githubusercontent.com/o/r/main/SKILL.md",
);
check(
  "a link to the file in the GitHub UI is converted to raw and used as given",
  (() => {
    const u = candidateUrls("https://github.com/o/r/blob/main/skills/x/SKILL.md");
    return u.length === 1 && u[0] === "https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md";
  })(),
);
check(
  "a raw URL is used exactly as pasted",
  (() => {
    const u = candidateUrls("https://raw.githubusercontent.com/o/r/abc123/SKILL.md");
    return u.length === 1 && u[0] === "https://raw.githubusercontent.com/o/r/abc123/SKILL.md";
  })(),
);
check("an owner with no repo yields nothing", candidateUrls("https://github.com/owner").length === 0);

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------
const FILE = `---
name: no-ai-slop
description: Edit drafts into sharper, more human writing.
---

# No AI slop

You are a sharp human editor.
`;
{
  const p = parseSkillMarkdown(FILE)!;
  check("the name comes off the frontmatter", p.name === "no-ai-slop");
  check("so does the description", p.description === "Edit drafts into sharper, more human writing.");
  check("the body is everything after it", p.body.startsWith("# No AI slop") && p.body.includes("sharp human editor"));
  check("and the frontmatter is not in the body -- it is metadata, not instruction", !p.body.includes("description:"));
}
check(
  "quoted values are unquoted",
  parseSkillMarkdown('---\nname: "quoted"\n---\nbody here')!.name === "quoted",
);
check(
  "unknown frontmatter keys are ignored, not fatal -- a file with extras is still a skill",
  parseSkillMarkdown("---\nname: x\nlicense: MIT\nversion: 2\n---\nbody")!.name === "x",
);
check(
  "no frontmatter keeps the whole text and falls back to the first heading",
  (() => {
    const p = parseSkillMarkdown("# House style\n\nBe concrete.")!;
    return p.name === "House style" && p.body.startsWith("# House style") && p.description === "";
  })(),
);
check(
  "no frontmatter and no heading leaves the name for the operator rather than inventing one",
  parseSkillMarkdown("Just some instructions.")!.name === "",
);
check("windows line endings survive", parseSkillMarkdown("---\r\nname: w\r\n---\r\nbody")!.name === "w");
// Nothing to put in the prompt is the one real failure.
check("an empty file is null", parseSkillMarkdown("") === null);
check("frontmatter with no body is null", parseSkillMarkdown("---\nname: x\n---\n\n   ") === null);

console.log(`\nskillImport: ${passed} checks passed`);
