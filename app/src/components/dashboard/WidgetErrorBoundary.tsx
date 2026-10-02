"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

function Retry({ onRetry }: { onRetry: () => void }) {
  const router = useRouter();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "var(--text-tertiary)", fontSize: 13 }}>
      <span>Couldn&rsquo;t load this widget.</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onRetry();
          router.refresh();
        }}
      >
        <RotateCw size={13} /> Retry
      </Button>
    </div>
  );
}

export class WidgetErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Retry onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
