"use client";

import "./chat.css";
import type { ReactNode } from "react";
import { Download } from "lucide-react";

import type { ConvArtifact } from "@/lib/agents/conversationModel";

/** What an answer produced, as cards under it: files to download and, on the latest exchange, the campaign checklist. */
export function ResultCards({ artifacts, campaign }: { artifacts: ConvArtifact[]; campaign?: ReactNode }) {
  if (artifacts.length === 0 && !campaign) return null;
  return (
    <div className="ax-cards">
      {campaign && <div className="ax-card-wide">{campaign}</div>}
      {artifacts.map((a) => (
        <div className="ax-card" key={a.url}>
          <div className="ax-card-k">File</div>
          <div className="ax-card-t">{a.label || a.filename}</div>
          <div className="ax-card-m">{a.filename}</div>
          <div className="ax-card-btns">
            <a className="ax-pill ax-pill--solid" href={a.url} download={a.filename}>
              <Download size={13} strokeWidth={2} aria-hidden />
              Download
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
