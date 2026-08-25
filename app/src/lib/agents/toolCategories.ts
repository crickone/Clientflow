/**
 * User-facing grouping of Adonis's tools by what they DO, for the tool-access
 * toggles on the Agent detail page (/agents/[key]). This is presentation
 * metadata only — it does not affect what tools an agent has (that's
 * `ORCHESTRATOR_SPECIALIST.toolNames`, specialists/orchestrator.ts) or the
 * write-approval gate (WRITE_TOOLS, @/lib/assistant/tools).
 *
 * `toolCategories.test.ts` pins that these categories cover EXACTLY Adonis's
 * tool set — every tool in one category, no duplicates, nothing listed that
 * Adonis doesn't have — so a tool added to (or removed from) Adonis without a
 * category here is caught by the test, not silently dumped into "Other".
 */
export interface ToolCategory {
  key: string;
  label: string;
  tools: string[];
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    key: "leads",
    label: "Leads & follow-up",
    tools: ["list_leads", "get_lead_health", "create_lead", "draft_lead_reply", "set_lead_stage", "log_lead_touch"],
  },
  {
    key: "messaging",
    label: "Messaging",
    tools: ["list_recent_messages", "search_messages", "send_client_email", "send_whatsapp", "send_client_whatsapp"],
  },
  {
    key: "clients",
    label: "Clients",
    tools: ["get_client", "create_client", "update_client"],
  },
  {
    key: "money",
    label: "Money & invoices",
    tools: ["list_invoices", "bundle_invoices", "upload_invoices_to_drive", "financial_summary", "log_payment"],
  },
  {
    key: "appointments",
    label: "Appointments",
    tools: ["list_appointments", "create_calendar_event", "create_appointment", "cancel_appointment", "reschedule_appointment"],
  },
  {
    key: "classes",
    label: "Classes & attendance",
    tools: ["list_classes", "create_class", "book_client_into_class", "cancel_class", "cancel_booking", "list_no_shows", "list_lapsed_members"],
  },
  {
    key: "memberships",
    label: "Memberships & packages",
    tools: ["assign_membership", "cancel_membership", "assign_package"],
  },
  {
    key: "coaching",
    label: "Nutrition & workouts",
    tools: ["add_food", "create_nutrition_plan", "assign_nutrition_plan", "add_exercise", "create_workout_program", "assign_workout_program"],
  },
  {
    key: "content",
    label: "Content & campaigns",
    tools: [
      "list_blog_posts", "draft_blog_post", "save_blog_post", "publish_blog_post", "draft_carousel",
      "plan_campaign", "create_campaign", "draft_campaign_asset", "approve_campaign_asset", "launch_campaign",
    ],
  },
  {
    key: "general",
    label: "General",
    tools: ["business_overview", "create_form"],
  },
];

/**
 * Groups a specific agent's tool names into the categories above, preserving
 * category order and dropping empty categories. Any tool NOT in a category
 * falls into a trailing "Other" bucket so nothing is ever silently lost — the
 * coverage test keeps that bucket empty for Adonis, but it makes the grouping
 * safe for any tool set.
 */
export function groupToolsByCategory(
  toolNames: readonly string[],
): { key: string; label: string; tools: string[] }[] {
  const present = new Set(toolNames);
  const groups = TOOL_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    tools: c.tools.filter((t) => present.has(t)),
  })).filter((c) => c.tools.length > 0);

  const categorized = new Set(TOOL_CATEGORIES.flatMap((c) => c.tools));
  const other = [...toolNames].filter((t) => !categorized.has(t));
  if (other.length > 0) groups.push({ key: "other", label: "Other", tools: other });
  return groups;
}
