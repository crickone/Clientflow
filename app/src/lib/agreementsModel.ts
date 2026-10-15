/**
 * What a member agrees to before they use a business's client app: our App
 * terms of use, a Privacy notice in the business's name, a consent to keep
 * their health information, and each of the business's own Terms &
 * Conditions (Forms > Terms). Pure, so the app, the staff page and the tests
 * read the same documents.
 *
 * A document's version is what an acceptance is recorded against. Ours carry
 * a written version (bumped by hand when the text changes); a business's
 * terms are versioned by a hash of their text, so any edit asks everyone
 * again. Every acceptance keeps a copy of the exact text agreed to.
 */

export interface AgreementDoc {
  /** "platform:terms", "platform:privacy", "platform:health", "form:<id>". */
  key: string;
  title: string;
  version: string;
  /** One line under the tick box. */
  summary: string;
  /** Plain text with "## " headings and "- " list lines. */
  body: string;
  /** Who wrote it: us, or the business. */
  owner: "platform" | "business";
}

export interface BusinessContact {
  name: string;
  email: string;
  phone: string;
}

export const PLATFORM_EFFECTIVE = "15 October 2026";

function contactLine(b: BusinessContact): string {
  const ways = [b.email && `email ${b.email}`, b.phone && `call ${b.phone}`].filter(Boolean).join(" or ");
  return ways ? `${b.name}: ${ways}.` : `${b.name}, at the front desk.`;
}

export function appTermsDoc(b: BusinessContact): AgreementDoc {
  return {
    key: "platform:terms",
    title: "App terms of use",
    version: "1.0",
    owner: "platform",
    summary: `The rules for using this app, which ${b.name} provides through AdonisAgent.`,
    body: `Effective ${PLATFORM_EFFECTIVE}. Version 1.0.

## Who provides the app
${b.name} gives you this app so you can book, see your membership and track your training. The app runs on AdonisAgent, a product of Vantaige Limited, a company registered in Ireland ("we", "us"). These terms are between you and Vantaige Limited and cover the app itself.

## Your agreement with ${b.name}
Your membership, prices, bookings, cancellations and refunds are between you and ${b.name}, under their own terms and conditions. We are not a party to that agreement and do not provide training, coaching, nutrition or health services.

## Your account
- You must be 16 or older. If you are under 18, a parent or guardian must agree to these terms for you.
- Keep your login to yourself. You are responsible for what is done with your account.
- Keep your details up to date.

## Health information in the app
- Calorie targets, meal estimates, body scan readings, workout records and suggestions in the app are general guidance. They are not medical advice, a diagnosis or treatment.
- Numbers worked out from a photo or a formula are estimates and can be wrong. Check them and change them if they look off.
- Talk to your doctor before you start a new exercise or eating plan, especially if you have a medical condition, an injury or are pregnant.
- Tell ${b.name} about any change in your health before you train.
- In an emergency, call 112 or 999.

## AI features
Some features use AI. When you photograph a meal, the photo is sent to an AI model to estimate what is in it. The result is an estimate for you to check. The AI provider does not use your photos to train its models.

## Using the app properly
Do not share your login, try to see anyone else's information, interfere with the app, copy it or take it apart, or use it for anything unlawful.

## What you add
Photos, logs and answers you add stay yours. You let us store them and show them to you and to ${b.name} so the app works. ${b.name} can see what you log.

## Availability and changes
We work to keep the app running but cannot promise it will always be available or free of errors. We may change or remove features.

## Ending
You can stop using the app at any time. ${b.name} can end your access, for example when your membership ends. To have your information deleted, ask ${b.name}; we act on their instructions.

## Our liability
We are not responsible for the services ${b.name} provides, or for decisions you make based on estimates in the app. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or any right you have as a consumer that cannot be limited by law.

## Changes to these terms
If we change these terms, the app will ask you to agree to the new version before you continue.

## Law
Irish law applies to these terms and the Irish courts deal with disputes. If you live elsewhere in the EU, you keep the consumer protections of the country you live in.

## Contact
Questions about your membership: ${contactLine(b)} Questions about the app: privacy@adonisagent.ie.`,
  };
}

export function privacyDoc(b: BusinessContact): AgreementDoc {
  return {
    key: "platform:privacy",
    title: "Privacy notice",
    version: "1.0",
    owner: "platform",
    summary: `What ${b.name} keeps about you in this app, why, who else sees it, and your rights.`,
    body: `Effective ${PLATFORM_EFFECTIVE}. Version 1.0.

## Who is responsible
${b.name} is the controller of your personal information: they decide what is kept and why. The app runs on AdonisAgent, a product of Vantaige Limited (Ireland), which processes your information for ${b.name} and only on their instructions.

## What is kept
- Your name, phone, email, date of birth, address and emergency contact.
- Bookings, attendance, memberships, packages and payments.
- Messages between you and ${b.name}.
- Your answers to their welcome questions.
- Health information you give or log: medical conditions and injuries you tell them about, body scan results if you turn scans on, your weight, height and goal, meals and meal photos, and workouts.
- Your app login, and technical records such as your IP address and browser, kept for security.
- A record of what you agreed to in the app and when.

## Why, and the legal basis
- To run your membership, bookings and payments: this is needed for your agreement with ${b.name}.
- To keep and use your health information to plan and run your training: your explicit consent, which you can withdraw at any time.
- To keep the app secure and working: legitimate interests.
- To keep payment and accounting records: a legal obligation.

## Who else sees it
${b.name}'s staff, and the providers that run the app for them under data processing terms:
- Vantaige Limited (AdonisAgent), which runs the app.
- Railway, which hosts the app and its databases.
- Anthropic, which reads meal photos to estimate what is in them. It does not use them to train its models.
- Mailgun and Resend, or ${b.name}'s own email account, to send you emails.
- Stripe, if you pay online. Card numbers are never stored in the app.
- InBody, if you use an InBody scanner and turn scans on.
Your information is never sold or used for advertising.

## Outside the EU
Some of these providers process information outside the European Economic Area. Where they do, an EU adequacy decision (including the EU-US Data Privacy Framework) or Standard Contractual Clauses protect it.

## How long it is kept
While you are a member. After you leave, ${b.name} deletes it or keeps only what the law requires, such as payment records for six years. Records of what you agreed to are kept for as long as needed to show it, up to six years after you leave.

## Your rights
You can ask to see, correct, delete or take a copy of your information, to restrict or object to its use, and withdraw your consent to health information at any time. Withdrawing it stops the features that use it, but does not affect what was done before. You can complain to the Data Protection Commission at dataprotection.ie.

## Contact
${contactLine(b)} About the app itself: privacy@adonisagent.ie.`,
  };
}

export function healthConsentDoc(b: BusinessContact): AgreementDoc {
  return {
    key: "platform:health",
    title: "Health information consent",
    version: "1.0",
    owner: "platform",
    summary: `Lets ${b.name} keep and use the health information you give them or log here.`,
    body: `I consent to ${b.name} keeping and using health information that I give them or log in this app, such as medical conditions, injuries, body scan results, my weight, meals and workouts, to plan and run my training.

I know I can withdraw this consent at any time by telling ${b.name}, and that the features that use this information will then stop.`,
  };
}

export function platformDocs(b: BusinessContact): AgreementDoc[] {
  return [appTermsDoc(b), privacyDoc(b), healthConsentDoc(b)];
}

/** A short, stable version for text the business wrote: any edit changes it. FNV-1a, 32-bit. */
export function textVersion(text: string): string {
  let h = 0x811c9dc5;
  const s = text.replace(/\r\n/g, "\n").trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function businessTermsDoc(form: { id: number; title: string; content: string }, businessName: string): AgreementDoc {
  return {
    key: `form:${form.id}`,
    title: form.title.trim() || "Terms & Conditions",
    version: textVersion(form.content),
    owner: "business",
    summary: `${businessName}'s own terms for your membership.`,
    body: form.content.trim(),
  };
}

export interface AcceptedRow {
  docKey: string;
  version: string;
  acceptedAt: number;
}

/** The documents still to agree to: never accepted, or accepted at an older version. */
export function pendingDocs(required: AgreementDoc[], accepted: AcceptedRow[]): AgreementDoc[] {
  return required.filter((d) => !accepted.some((a) => a.docKey === d.key && a.version === d.version));
}

/** Per document, the latest acceptance and whether it is of the current text. For the staff view. */
export function agreementStatus(required: AgreementDoc[], accepted: AcceptedRow[]): { doc: AgreementDoc; acceptedAt: number | null; current: boolean }[] {
  return required.map((doc) => {
    const mine = accepted.filter((a) => a.docKey === doc.key).sort((x, y) => y.acceptedAt - x.acceptedAt);
    const now = mine.find((a) => a.version === doc.version);
    return { doc, acceptedAt: (now ?? mine[0])?.acceptedAt ?? null, current: Boolean(now) };
  });
}

/** Split a document into blocks for rendering: headings, list items, paragraphs. */
export type Block = { kind: "h"; text: string } | { kind: "li"; text: string } | { kind: "p"; text: string };

export function toBlocks(body: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (h) {
      flush();
      out.push({ kind: "h", text: h[1] });
    } else if (li) {
      flush();
      out.push({ kind: "li", text: li[1] });
    } else para.push(line);
  }
  flush();
  return out;
}
