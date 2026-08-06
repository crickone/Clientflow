"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, style, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(className)}
    style={{
      display: "flex",
      gap: 4,
      borderBottom: "1px solid var(--grid)",
      // Tab strips (e.g. the 8-tab client profile) scroll horizontally instead of
      // overflowing the page on mobile.
      overflowX: "auto",
      scrollbarWidth: "none",
      ...style,
    }}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, style, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn("tab-trigger", className)}
    style={{
      padding: "12px 16px",
      cursor: "pointer",
      fontFamily: "var(--font-mono), ui-monospace, monospace",
      fontSize: 12,
      fontWeight: 400,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      background: "transparent",
      border: "none",
      borderBottom: "1px solid transparent",
      whiteSpace: "nowrap",
      flexShrink: 0,
      marginBottom: -1,
      transition: "color 0.18s var(--ease), border-color 0.18s var(--ease)",
      ...style,
    }}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, style, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(className)}
    style={{ paddingTop: 24, ...style }}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
