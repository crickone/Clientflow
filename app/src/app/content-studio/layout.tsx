import type { ReactNode } from "react";
import { ContentStudioTabs } from "@/components/content-studio/ContentStudioTabs";

export default function ContentStudioLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="app-page">
      <ContentStudioTabs />
      {children}
    </div>
  );
}
