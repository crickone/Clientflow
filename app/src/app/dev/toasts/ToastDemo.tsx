"use client";
import { useEffect } from "react";
import { toast } from "sonner";
export function ToastDemo() {
  useEffect(() => {
    const t = setTimeout(() => {
    toast.success("Ad text saved");
    toast.error("Couldn't publish the post", { description: "Meta says the access token expired. Reconnect Facebook and try again.", action: { label: "Retry", onClick: () => {} } });
    toast.info("Adonis is writing your ad");
    toast.warning("Your AI spend is at 90% of this month's cap");
    }, 700);
    return () => clearTimeout(t);
  }, []);
  return <div style={{ padding: 40 }}>Toast demo</div>;
}
