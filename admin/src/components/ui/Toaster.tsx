"use client";

import { Toaster as Sonner } from "sonner";

/** Bottom right, dark, styled with the console's tokens (see .toast in globals.css). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="dark"
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "toast",
          title: "toast-title",
          description: "toast-desc",
          actionButton: "toast-action",
          closeButton: "toast-close",
          success: "toast--ok",
          error: "toast--fail",
        },
      }}
    />
  );
}
