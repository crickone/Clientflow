/**
 * Turning something an operator pasted into a skill they can review.
 * ZERO RUNTIME IMPORTS — the fetch lives in the server action; this is the
 * parsing, which is where all the ways it can go wrong live.
 *
 * WHAT GETS PASTED IS NOT TIDY. The thing in front of someone is usually an
 * install line copied off a README, not a URL: `uv tool install
 * git+https://github.com/owner/repo.git`. Asking them to extract the URL
 * themselves is asking them to do the easy half of the job by hand, so the
 * URL is pulled out of whatever arrives.
 *
 * A SKILL HERE IS TEXT, NOT A PROGRAM. `uv tool install` installs a Python
 * CLI; this app's skills are instructions appended to a system prompt. The
 * two are not the same thing, and the line being a valid uv command says
 * nothing about whether the repo behind it holds a SKILL.md. All this does is
 * find the repository and read the markdown; nothing is executed, ever.
 */

/** github.com and its raw host, and nothing else. See candidateUrls. */
const GITHUB_HOSTS = new Set(["github.com", "www.github.com", "raw.githubusercontent.com"]);

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/** The first URL in a pasted line, whatever surrounds it. */
export function urlFrom(pasted: string): string | null {
  const text = pasted.trim();
  if (!text) return null;
  // `git+https://…` is how pip/uv spell a git source; the prefix is theirs,
  // not part of the address.
  const match = /(?:git\+)?(https?:\/\/[^\s"'<>)\]]+)/i.exec(text);
  if (!match) return null;
  return match[1].replace(/[.,;]+$/, "");
}

/**
 * The raw URLs worth trying, in order, for whatever was pasted.
 *
 * Returns [] for anything not on GitHub. That is the SSRF guard and the reason
 * it lives in the parser rather than the fetcher: a caller cannot forget to
 * apply it, because there is no list to fetch without it.
 *
 * A repo address becomes the conventional places a SKILL.md sits. A direct
 * file link is converted to its raw form and used as given.
 */
export function candidateUrls(pasted: string): string[] {
  const raw = urlFrom(pasted);
  if (!raw) return [];

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" || !GITHUB_HOSTS.has(url.hostname)) return [];

  if (url.hostname === "raw.githubusercontent.com") return [url.toString()];

  const parts = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
  const [owner, repo, ...rest] = parts;
  if (!owner || !repo) return [];

  // A link to a file in the GitHub UI: /owner/repo/blob/<ref>/<path>
  if (rest[0] === "blob" && rest.length > 2) {
    const ref = rest[1];
    const path = rest.slice(2).join("/");
    return [`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`];
  }

  // A repository. Try where a skill conventionally lives, main before master.
  const out: string[] = [];
  for (const ref of ["main", "master"]) {
    out.push(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/SKILL.md`);
    out.push(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/skills/${repo}/SKILL.md`);
    out.push(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/.claude/skills/${repo}/SKILL.md`);
  }
  return out;
}

/**
 * A SKILL.md into the three fields the form holds.
 *
 * The frontmatter is YAML in principle and two known keys in practice, so it
 * is read by line rather than by pulling in a parser: `name:` and
 * `description:`, quoted or not. Anything else in there is ignored rather than
 * rejected — a file with extra keys is still a skill.
 *
 * Returns null only when there is no usable body. A skill with no frontmatter
 * is fine: it keeps its whole text and the operator names it.
 */
export function parseSkillMarkdown(text: string): ParsedSkill | null {
  const normalised = text.replace(/\r\n/g, "\n");
  let name = "";
  let description = "";
  let body = normalised;

  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(normalised);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const kv = /^(name|description)\s*:\s*(.*)$/i.exec(line.trim());
      if (!kv) continue;
      const value = kv[2].trim().replace(/^["']|["']$/g, "");
      if (kv[1].toLowerCase() === "name") name = value;
      else description = value;
    }
    body = normalised.slice(fm[0].length);
  }

  body = body.trim();
  if (!body) return null;

  // No frontmatter name: fall back to the first markdown heading, then leave
  // it empty for the operator rather than inventing one.
  if (!name) {
    const heading = /^#\s+(.+)$/m.exec(body);
    if (heading) name = heading[1].trim();
  }
  return { name, description, body };
}
