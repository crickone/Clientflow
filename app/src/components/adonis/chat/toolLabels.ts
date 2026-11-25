/**
 * What each tool is called in the steps panel: plain words for what Adonis
 * is doing. A tool missing from the map is shown with its name in words
 * ("list_social_posts" becomes "List social posts"); chats saved by an older
 * page hold the label itself, which passes through unchanged.
 */

export const TOOL_LABEL: Record<string, string> = {
  business_overview: "Reading the business overview",
  list_recent_messages: "Scanning recent messages",
  search_messages: "Searching messages",
  list_invoices: "Finding invoices",
  bundle_invoices: "Bundling invoices",
  upload_invoices_to_drive: "Uploading to Google Drive",
  financial_summary: "Adding up the numbers",
  list_appointments: "Checking the diary",
  get_client: "Looking up the client",
  get_client_nutrition: "Reading the nutrition plan",
  create_calendar_event: "Adding to the calendar",
  create_client: "Creating the client",
  create_appointment: "Booking the appointment",
  log_payment: "Logging the payment",
  send_client_email: "Sending the email",
  add_food: "Adding the food",
  create_nutrition_plan: "Building the nutrition plan",
  add_exercise: "Adding the exercise",
  create_workout_program: "Building the workout program",
  assign_nutrition_plan: "Assigning the nutrition plan",
  assign_workout_program: "Assigning the workout program",
  create_lead: "Adding the lead",
  assign_membership: "Assigning the membership",
  list_classes: "Checking the timetable",
  create_class: "Creating the class",
  book_client_into_class: "Booking into the class",
  update_client: "Updating the client",
  cancel_appointment: "Cancelling the appointment",
  reschedule_appointment: "Rescheduling the appointment",
  cancel_class: "Cancelling the class",
  cancel_booking: "Cancelling the booking",
  cancel_membership: "Cancelling the membership",
  assign_package: "Assigning the package",
  create_form: "Building the form",
  list_leads: "Checking the pipeline",
  get_lead_health: "Checking lead health",
  draft_lead_reply: "Drafting a reply",
  send_whatsapp: "Sending the WhatsApp",
  set_lead_stage: "Updating the pipeline stage",
  log_lead_touch: "Logging a touch",
  list_no_shows: "Finding no-shows",
  list_lapsed_members: "Finding members gone quiet",
  plan_campaign: "Planning the campaign",
  create_campaign: "Creating the campaign",
  draft_campaign_asset: "Drafting the next asset",
  approve_campaign_asset: "Saving the asset",
  get_campaign: "Checking the campaign",
  launch_campaign: "Launching the campaign",
  list_blog_posts: "Checking the blog",
  draft_blog_post: "Drafting the blog post",
  draft_carousel: "Drafting the carousel",
  list_social_posts: "Checking the social posts",
  list_schedule: "Checking the schedule",
  list_website_pages: "Checking the website",
  read_website_page: "Reading the page",
  list_website_images: "Checking the images",
  list_ad_campaigns: "Checking the ad campaigns",
  search_ad_audience: "Searching the audience",
  get_ad_results: "Reading the ad results",
  get_ad_account_performance: "Checking the ads",
  get_social_metrics: "Reading the social numbers",
  get_google_metrics: "Reading the Google numbers",
  list_google_reviews: "Reading Google reviews",
  map_find: "Searching the business",
  map_get: "Reading the record",
  map_follow: "Following the links",
  map_count: "Counting",
  load_skill: "Reading a skill",
};

export function toolLabel(name: string): string {
  // Own keys only: "constructor" or "toString" must not read Object.prototype.
  if (Object.hasOwn(TOOL_LABEL, name)) return TOOL_LABEL[name];
  if (!name.includes("_")) return name;
  const words = name.replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
