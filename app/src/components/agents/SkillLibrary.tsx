"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Pencil, Plus, Trash2, X } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import {
  MAX_SKILL_BODY,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  type SkillLoadMode,
} from "@/lib/agents/skills.parse";
import { addSkill, editSkill, fetchSkillFrom, removeSkill } from "@/app/agents/actions";

export interface SkillRow {
  id: number;
  name: string;
  description: string;
  body: string;
  loadMode: SkillLoadMode;
}

/**
 * The tenant's skill library: the blocks of instruction an agent can be given.
 *
 * Creating one here does NOT switch it on anywhere. That is deliberate -- a
 * skill added to the account must not start rewriting every agent's prompt on
 * its own. It appears in each agent's Skills list, off, until someone turns it
 * on there.
 */
export function SkillLibrary({ skills }: { skills: SkillRow[] }) {
  const [editing, setEditing] = useState<SkillRow | "new" | null>(null);

  return (
    <div style={{ marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
            Skills
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "4px 0 0", maxWidth: 640, lineHeight: 1.5 }}>
            Reusable instructions for this account. Switch one on for an agent from that
            agent&apos;s page — adding it here makes it available, nothing more.
          </p>
        </div>
        {editing === null && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus size={14} />
            New skill
          </Button>
        )}
      </div>

      {editing !== null ? (
        <SkillForm
          initial={editing === "new" ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Card>
          {skills.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
              No skills yet. A good first one is a house writing style, or the rules you keep
              repeating to an agent by hand.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {skills.map((s, i) => (
                <li
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, lineHeight: 1.45 }}>
                      {s.description || "No description"} · {s.body.length.toLocaleString()} chars ·{" "}
                      {s.loadMode === "always" ? "always on" : "when needed"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(s)}
                      aria-label={`Edit the ${s.name} skill`}
                      title={`Edit the ${s.name} skill`}
                    >
                      <Pencil size={13} />
                    </Button>
                    <DeleteSkillButton skill={s} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function DeleteSkillButton({ skill }: { skill: SkillRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Delete the ${skill.name} skill`}
      title={`Delete the ${skill.name} skill`}
      onClick={() => {
        // Deleting takes it off every agent that had it on, so it is worth a
        // confirmation even though nothing else is lost.
        if (!window.confirm(`Delete the "${skill.name}" skill? It will be removed from every agent using it.`)) return;
        startTransition(async () => {
          try {
            await removeSkill(skill.id);
            toast.success(`Deleted "${skill.name}".`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete that skill.");
          }
        });
      }}
    >
      <Trash2 size={13} />
    </Button>
  );
}

function SkillForm({ initial, onDone }: { initial: SkillRow | null; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [loadMode, setLoadMode] = useState<SkillLoadMode>(initial?.loadMode ?? "always");
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
          <Button onClick={save} disabled={pending}>
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
