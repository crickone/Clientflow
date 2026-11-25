/**
 * Ready-made flow copy for one business, keyed by tenant slug, the same way
 * lib/design/presets.ts and lib/cms/enquiry.ts keep per-business sets. Pure.
 *
 * This is what the /automations editor shows and what the engine sends
 * until the business saves its own messages. Every other business gets the
 * neutral DEFAULT_MESSAGES. The business phone is never typed in: it is
 * [BUSINESS_PHONE], filled from the business profile when a lead enrols.
 */
import { DEFAULT_MESSAGES, type Channel, type IntervalUnit, type MessageInput } from "@/lib/automationModel";

function m(
  channel: Channel,
  subject: string | null,
  template: string,
  delayValue = 0,
  delayUnit: IntervalUnit = "days",
  matchInterest: string | null = null,
): MessageInput {
  return { channel, subject, template, attachmentFilename: null, attachmentOriginal: null, delayValue, delayUnit, matchInterest };
}

const HBOT = "hbot, hyperbaric, oxygen";
const INFRARED = "infrared, red light";
const HIFEM = "hifem, pemf";
const MASSAGE = "massage, reflexology, lava";
const GENERAL = "other";

const OPTIMAL_HEALTH: Record<string, MessageInput[]> = {
  new_lead: [
    m(
      "whatsapp",
      null,
      "Hi [FIRST_NAME], thanks for getting in touch with Optimal Health. We offer hyperbaric oxygen (HBOT), infrared, PEMF and massage at Ard Gaoithe Business Park, Clonmel, with free parking. What would you like help with? Reply with a good time and we'll ring you, or call us on [BUSINESS_PHONE].",
    ),
    m(
      "email",
      "Thanks for getting in touch with Optimal Health",
      "Hi [FIRST_NAME],\n\nThanks for your enquiry. We'll be in touch by WhatsApp or phone to talk about what you're looking for and which therapy suits. If you'd rather talk now, ring [BUSINESS_PHONE].\n\nOptimal Health",
    ),
    m("whatsapp", null, "Hi [FIRST_NAME], just checking you saw our message. Is there a good time to give you a call?", 2),
    m("whatsapp", null, "If you have any questions about the therapies, how a session works or what to bring, ask here and we'll answer.", 4),
    m("whatsapp", null, "We have sessions free this week. Tell us a day that suits and we'll book you in.", 5),
    m("whatsapp", null, "We'll leave it there for now. If you'd like to book later, message here or ring [BUSINESS_PHONE]. Optimal Health", 7),
  ],
  lead_no_answer: [
    m("whatsapp", null, "Hi [FIRST_NAME], we tried to ring you about your enquiry with Optimal Health but couldn't get through. When's a good time to call you back?"),
    m("whatsapp", null, "Hi [FIRST_NAME], happy to talk whenever suits you. Tell us a day and time and we'll ring you then. Optimal Health", 2),
  ],
  lead_call_back: [
    m("whatsapp", null, "Hi [FIRST_NAME], following up from our chat the other day. Would you be free for a call today?", 2),
    m("whatsapp", null, "Hi [FIRST_NAME], happy to talk whenever suits you. Tell us a day and time and we'll ring you then. Optimal Health", 4),
  ],
  lead_call_booked: [
    m(
      "whatsapp",
      null,
      "Hi [FIRST_NAME], you're booked for a call with Optimal Health on [CALL_DAY] at [CALL_TIME]. We'll ring you on this number. If you need to change it, reply here.",
    ),
    m("whatsapp", null, "Hi [FIRST_NAME], a reminder that we'll ring you at [CALL_TIME] today. Optimal Health", 1, "hours"),
  ],
  lead_thinking: [
    m("whatsapp", null, "Hi [FIRST_NAME], following up from our chat. No rush. Have you any questions, or would you like to book a session?", 5),
    m("whatsapp", null, "Hi [FIRST_NAME], one last check: would you like to book in for a session? If now isn't the time, message us whenever suits. Optimal Health", 10),
  ],
  lead_nurture: [
    // Week 1
    m(
      "email",
      "What we do at Optimal Health",
      [
        "Hi [FIRST_NAME],",
        "Thanks again for getting in touch. Here is what we do, in short.",
        "We are a recovery clinic inside Inspire at Ard Gaoithe Business Park, Clonmel, with free parking on site. We have four therapies under one roof:",
        "- Hyperbaric oxygen (HBOT): you rest in a pressurised chamber for 60 minutes.\n- Infrared: 12 minutes on a full-body infrared bed. No UV, so no tanning.\n- HIFEM: 30 minutes in a PEMF chair. You stay fully dressed.\n- Massage: Swedish, deep tissue, sports, reflexology and more, from 30 minutes.",
        "Every session is guided. Someone shows you in, sets you up and stays available the whole time.",
        "You don't need to know which therapy you want. Ring us on [BUSINESS_PHONE], tell us what you'd like help with, and we'll recommend one.",
        "Optimal Health",
      ].join("\n\n"),
    ),
    // Week 2, one version per treatment
    m(
      "email",
      "What a hyperbaric oxygen session is like",
      [
        "Hi [FIRST_NAME],",
        "You asked about hyperbaric oxygen, so here is what a session involves.",
        "You sit or lie in the chamber in comfortable everyday clothes. The pressure rises slowly and you breathe oxygen for 60 minutes. You can bring a book. Phones and other electronics stay outside.",
        "A few things help: arrive well hydrated, and skip oily lotions, hairspray and perfume beforehand. If you have a cold, we'll move your session, because congestion makes it hard to clear your ears.",
        "If you're worried about feeling closed in, we can arrange a trial sit-in first, with no pressure. You can talk to us at any point, and we can pause.",
        "A single session is €80. Ring [BUSINESS_PHONE] to book, or reply here with any questions.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      HBOT,
    ),
    m(
      "email",
      "What an infrared session is like",
      [
        "Hi [FIRST_NAME],",
        "You asked about infrared, so here is what a session involves.",
        "You lie on a full-body infrared bed for 12 minutes, on your own in the room. It is not a sunbed: there is no UV, so no tanning or burning. The less you wear, the more of your skin the light reaches, and underwear is fine.",
        "Most people fit it into a lunch break or before training. You go straight back to your day afterwards.",
        "If you have a heart condition, heat intolerance, light sensitivity, or take medication that makes you sensitive to light, check with your GP first and tell us when you book.",
        "A single session is €50. Ring [BUSINESS_PHONE] to book, or reply here with any questions.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      INFRARED,
    ),
    m(
      "email",
      "What a HIFEM session is like",
      [
        "Hi [FIRST_NAME],",
        "You asked about HIFEM, so here is what a session involves.",
        "You sit fully dressed in the HIFEM chair for 30 minutes. The chair uses a pulsed electromagnetic field (PEMF). You feel it working, and you can read or rest while it runs.",
        "There is nothing to prepare. Anyone with a pacemaker or another implanted electronic device must not use HIFEM, so tell us about any implants when you book.",
        "A single session is €70. Ring [BUSINESS_PHONE] to book, or reply here with any questions.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      HIFEM,
    ),
    m(
      "email",
      "Which massage to book",
      [
        "Hi [FIRST_NAME],",
        "You asked about massage, so here is a quick guide to what we offer.",
        "- Swedish: long strokes at a steady, moderate pressure. A good first booking if you're not sure.\n- Deep tissue: firmer pressure, agreed with you before and during the session.\n- Sports: firmer massage and stretching on the areas your training works hardest.\n- Reflexology: pressure on the feet. Only your shoes and socks come off.\n- Hot lava shells: massage using warmed shells as well as hands, so you get heat and pressure together.",
        "Most are 60 minutes, and Swedish, deep tissue and sports also come as 30-minute sessions from €50.",
        "Irish Life and Laya may pay back part of a massage, and VHI part of reflexology, depending on your plan. We'll give you a receipt.",
        "Ring [BUSINESS_PHONE] to book, or reply here and tell us what you'd like help with.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      MASSAGE,
    ),
    m(
      "email",
      "How to choose a therapy",
      [
        "Hi [FIRST_NAME],",
        "If you're not sure which therapy suits you, that's normal. Most people aren't when they first get in touch.",
        "The quickest way is to ring us on [BUSINESS_PHONE] and tell us what you'd like help with: sleep, recovery from training, aches that won't settle, or simply feeling better. We'll recommend one, and if we don't think a therapy suits you, we'll say so.",
        "Every therapy has a single-session price, so you can try one before you commit. Many people combine therapies, and we can help you space them out around your week.",
        "Reply here if you'd rather ask by email.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      GENERAL,
    ),
    // Week 3, one version per treatment
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about hyperbaric oxygen? Ask here and we'll answer. Optimal Health", 14, "days", HBOT),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about infrared? Ask here and we'll answer. Optimal Health", 14, "days", INFRARED),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about HIFEM? Ask here and we'll answer. Optimal Health", 14, "days", HIFEM),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about massage? Ask here and we'll answer. Optimal Health", 14, "days", MASSAGE),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about our therapies? Ask here and we'll answer. Optimal Health", 14, "days", GENERAL),
    // Week 6
    m(
      "email",
      "What happens on your first visit",
      [
        "Hi [FIRST_NAME],",
        "If you've never been to a place like ours, here is what your first visit looks like.",
        "1. You park free on site at Ard Gaoithe Business Park and come into Optimal Health, inside Inspire.\n2. We ask a few health questions to make sure the therapy suits you. If you have any conditions, tell us here.\n3. We show you to the room and set you up. You are never left to work out the equipment yourself.\n4. Your session runs: 12 minutes for infrared, 30 for HIFEM, 60 for HBOT, 30 to 90 for massage.\n5. You go straight back to your day. There is nothing to recover from.",
        "We're open Monday, Tuesday and Thursday 9am to 7pm, Wednesday and Friday 9am to 5pm, and Saturday 9am to 2pm.",
        "Ring [BUSINESS_PHONE] to book your first session.",
        "Optimal Health",
      ].join("\n\n"),
      35,
    ),
    // Week 8
    m(
      "email",
      "Questions people ask us",
      [
        "Hi [FIRST_NAME],",
        "The questions we're asked most, answered.",
        "Is it a medical treatment?\nNo. These are wellness sessions. We don't diagnose or treat medical conditions. If you're under a doctor's care, follow their advice and tell us before you book.",
        "What do I wear?\nEveryday clothes for HBOT and HIFEM. Underwear is fine for infrared. For massage you lie under towels.",
        "Can I try one session first?\nYes. Every therapy has a single-session price. Blocks cost less per session.",
        "Can I bring someone?\nRing us and we'll arrange it.",
        "Can I combine therapies or train the same day?\nYes, many people do. We'll help you space them out.",
        "Who should check with a GP first?\nAnyone pregnant, and anyone with ear, sinus, heart or breathing conditions, implanted devices or recent surgery. Tell us when you book.",
        "Anything else, reply here or ring [BUSINESS_PHONE].",
        "Optimal Health",
      ].join("\n\n"),
      49,
    ),
    // Week 10
    m("whatsapp", null, "Hi [FIRST_NAME], we have a few sessions free next week. Would you like one? Tell us a day that suits and we'll book you in. Optimal Health", 63),
    // Week 12
    m(
      "email",
      "Still thinking about it?",
      [
        "Hi [FIRST_NAME],",
        "This is the last email in this series, so no more of these after today.",
        "If you've been putting it off, that's fine. If something has been bothering you for a while, a first session is a simple way to see if we can help: one therapy, one visit, no block to buy.",
        "Ring [BUSINESS_PHONE] or reply to this email with a day that suits, and we'll take it from there.",
        "We'll still send the occasional offer and news. You can unsubscribe at any time with the link below.",
        "Optimal Health",
      ].join("\n\n"),
      77,
    ),
  ],
};

export const FLOW_PRESETS: Record<string, Record<string, MessageInput[]>> = {
  "optimal-health": OPTIMAL_HEALTH,
};

/** The starter messages for a trigger in this business: its preset, else the neutral default. Always a copy. */
export function defaultMessagesFor(triggerKey: string, tenantSlug: string | null | undefined): MessageInput[] {
  const preset = tenantSlug ? FLOW_PRESETS[tenantSlug]?.[triggerKey] : undefined;
  return (preset ?? DEFAULT_MESSAGES[triggerKey] ?? []).map((x) => ({ ...x }));
}
