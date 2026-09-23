"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, X } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import {
  MAX_SKILL_BODY,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  type SkillLoadMode,
} from "@/lib/agents/skills.parse";
import { addSkill, editSkill, fetchSkillFrom } from "@/app/agents/actions";

/**
 * The one skill editor.
 *
 * Skills used to be managed in two places: a library on the Agents index
 * (where the text lived) and a row of toggles on the agent's own page
 * (where they were switched on). An operator looking at a toggle had
 * nowhere to click to read what it actually said, and the two screens
 * disagreed about which was "the" skills page. This form is now opened
 * from the toggle itself, and the library screen is gone.
 *
 * A skill belongs to the ACCOUNT, not to the agent whose page it was
 * edited from: every agent that has it switched on sees the change.
 */
export interface SkillRow {
  id: number;
  name: string;
  description: string;
  body: string;
  loadMode: SkillLoadMode;
}

export function SkillForm({ initial, onDone }: { initial: SkillRow | null; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  // A NEW SKILL DEFAULTS TO ON DEMAND: the agent reads the menu and decides
  // when a skill applies. "Always" is the deliberate exception, for a rule
  // that must never be skipped even when the agent judges it irrelevant.
  const [loadMode, setLoadMode] = useState<SkillLoadMode>(initial?.loadMode ?? "onDemand");
  const [pending, startTransition] = useTransition();
  const [source, setSource] = useState("");
  const [importing, setImporting] = useState(false);
  const tooLong = body.length > MAX_SKILL_BODY;

  /**
   * Fetch a skill off GitHub into THIS FORM rather than straight into the
   * library. The body ends up in an agent's system prompt verbatim, so the
   * point of the round trip is that somebody reads it first — filling the
   * fields is the whole feature, saving is still a separate press.
   */
  async function pull() {
    const pasted = source.trim();
    if (!pasted) return;
    setImporting(true);
    try {
      const got = await fetchSkillFrom(pasted);
      if (got.name && !name.trim()) setName(got.name);
      if (got.description && !description.trim()) setDescription(got.description);
      setBody(got.body);
      toast.success(
        got.truncated
          ? "Fetched, but it was longer than the limit and has been cut — check the end."
          : "Fetched. Read it before you save it.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch that skill.");
    } finally {
      setImporting(false);
    }
  }

  function save() {
    if (!name.trim()) {
      toast.error("A skill needs a name.");
      return;
    }
    startTransition(async () => {
      try {
        if (initial) await editSkill(initial.id, { name, description, body, loadMode });
        else await addSkill({ name, description, body, loadMode });
        toast.success(initial ? `Saved "${name}".` : `Added "${name}".`);
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save that skill.");
      }
    });
  }

  return (
    <Card>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <Label htmlFor="skill-source">
            Install from GitHub — paste a repo, a SKILL.md link, or an install line
          </Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Input
                id="skill-source"
                value={source}
                placeholder="https://github.com/owner/repo"
                onChange={(e) => setSource(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void pull();
                  }
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void pull()}
              disabled={importing || !source.trim()}
            >
              <Download size={14} />
              {importing ? "Fetching…" : "Fetch"}
            </Button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6, lineHeight: 1.5 }}>
            Fills the fields below for you to read. Nothing is saved until you press
            Add skill, and nothing from the repo is ever run — only its SKILL.md is read.
          </div>
        </div>
        <div>
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={name}
            maxLength={MAX_SKILL_NAME}
            placeholder="House writing style"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="skill-description">
            Description — what it is, for the person reading the toggle list
          </Label>
          <Input
            id="skill-description"
            value={description}
            maxLength={MAX_SKILL_DESCRIPTION}
            placeholder="Cuts AI-sounding phrasing and keeps copy concrete"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="skill-body">
            Instructions — this goes into the agent&apos;s prompt verbatim
          </Label>
          <textarea
            id="skill-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            placeholder={"Write the rules as you would say them to a person.\n\nShort, specific and testable beats long and general."}
            style={{
              width: "100%",
              resize: "vertical",
              background: "var(--bg)",
              border: `1px solid ${tooLong ? "var(--danger)" : "var(--hairline)"}`,
              borderRadius: "var(--radius-sm)",
              padding: "10px 12px",
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              lineHeight: 1.5,
            }}
          />
          <div
            style={{
              fontSize: 11.5,
              color: tooLong ? "var(--danger)" : "var(--text-tertiary)",
              marginTop: 6,
            }}
          >
            {body.length.toLocaleString()} / {MAX_SKILL_BODY.toLocaleString()} characters
            {tooLong ? " — the rest will be cut when saved" : " · every one of these is sent on every message the agent handles"}
          </div>
        </div>
        <div>
          <Label htmlFor="skill-mode">When the agent reads it</Label>
          <select
            id="skill-mode"
            className="field"
            value={loadMode}
            onChange={(e) => setLoadMode(e.target.value as SkillLoadMode)}
            style={{ width: "100%" }}
          >
            <option value="always">Always — in every message this agent handles</option>
            <option value="onDemand">When needed — the agent fetches it for relevant work</option>
          </select>
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6, lineHeight: 1.5 }}>
            {loadMode === "always"
              ? "Right for standing rules — a writing style is no use if the agent has to decide it applies first. Costs its length on every message."
              : "Right for reference material — design guidelines, a brand book. Only its name and description are carried until a job needs it."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={save} loading={pending}>
            {pending ? "Saving…" : initial ? "Save skill" : "Add skill"}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={pending}>
            <X size={13} />
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
