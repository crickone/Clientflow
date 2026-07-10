"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  label: string;
  resource: "appointments" | "clients" | "revenue";
  start: string;
  end: string;
}

export function ExportButton({ label, resource, start, end }: Props) {
  return (
    <a
      href={`/api/export?type=${resource}&start=${start}&end=${end}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Button variant="outline" size="sm">
        <Download size={14} />
        {label}
      </Button>
    </a>
  );
}
