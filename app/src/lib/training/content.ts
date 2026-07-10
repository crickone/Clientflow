/**
 * Sales Agent Training content for Renova Cellular Health.
 * Adapted from the legacy OHR training manual — all brand references
 * rebranded to "Renova".
 */

export type Therapy = "HBOT" | "INFRARED" | "PEMF" | "MASSAGE";

export interface Lesson {
  slug: string;
  number: string;
  title: string;
  summary: string;
  durationMin: number;
  sections: Section[];
  keyTakeaways: string[];
  quiz: QuizQuestion[];
}

export interface Section {
  heading: string;
  kind?: "prose" | "list" | "scripts" | "callout" | "table";
  paragraphs?: string[];
  bullets?: string[];
  scripts?: Script[];
  tone?: "do" | "dont" | "info";
  callout?: { label: string; body: string };
  table?: { headers: string[]; rows: string[][] };
}

export interface Script {
  label: string;
  body: string;
}

export interface QuizQuestion {
  q: string;
  choices: string[];
  answer: number;
  explain: string;
}

export interface ConditionRow {
  category: string;
  name: string;
  therapies: Therapy[];
  leadWith: string;
}

export interface TherapyProfile {
  name: string;
  short: string;
  oneLiner: string;
  duration: string;
  course: string;
  bestFor: string[];
  feels: string;
  keyPoints: string[];
  accent: "hbot" | "ir" | "pemf" | "massage";
}

export interface Flashcard {
  id: string;
  category: "opening" | "discovery" | "validate" | "recommend" | "close" | "objection" | "condition";
  prompt: string;
  answer: string;
  hint?: string;
}

export interface RoleplayScenario {
  id: string;
  title: string;
  setup: string;
  difficulty: "easy" | "medium" | "hard";
  start: string;
  nodes: Record<string, RoleplayNode>;
}

export interface RoleplayNode {
  caller?: string;
  narrator?: string;
  end?: { result: "success" | "partial" | "fail"; feedback: string };
  choices?: RoleplayChoice[];
}

export interface RoleplayChoice {
  label: string;
  text: string;
  next: string;
  tag?: "best" | "ok" | "bad";
  note?: string;
}

/* ----------------------------------------------------------------------- */
/*  THERAPY PROFILES                                                        */
/* ----------------------------------------------------------------------- */

export const THERAPIES: TherapyProfile[] = [
  {
    name: "Hyperbaric Oxygen Therapy",
    short: "HBOT",
    accent: "hbot",
    oneLiner:
      "You sit in a comfortable pressurised chamber breathing high-concentration oxygen. The pressure means your body absorbs far more oxygen than it normally would — and that oxygen reaches damaged, inflamed, or poorly supplied tissue that's been struggling to heal.",
    duration: "50–60 minutes per session",
    course: "5–10 sessions. Most people notice a change from session 3–5 onwards.",
    bestFor: [
      "Post-surgical recovery",
      "Wound healing",
      "Concussion / TBI",
      "Long COVID",
      "Chronic fatigue",
      "Brain fog",
      "Systemic inflammation",
    ],
    feels:
      "Most people describe it as quiet and relaxing — a bit like the pressure change when a plane is descending. We walk you through everything. Most people nap.",
    keyPoints: [
      "The oxygen reaches tissue that your normal blood supply can't adequately get to — that's the key.",
      "Athletes use it for exactly this reason — faster healing, less downtime.",
      "It's non-invasive. You don't do anything. You just breathe normally.",
      "Most clients describe it as the best 50 minutes of forced rest they get in the week.",
      "We have a limited number of slots per day — it's worth getting booked in sooner rather than later.",
    ],
  },
  {
    name: "Infrared Bed Therapy",
    short: "INFRARED",
    accent: "ir",
    oneLiner:
      "Infrared light penetrates 3 to 4 centimetres below the surface of the skin — so it's not just warming you on the outside, it's reaching the tissue, the joints, the muscles where the problem actually is.",
    duration: "12 minutes per session",
    course: "5–10 sessions. Benefits are cumulative — they build with each session.",
    bestFor: [
      "Joint pain",
      "Arthritis",
      "Tendinitis",
      "Skin conditions (psoriasis / eczema)",
      "Scar healing",
      "Sleep",
      "Muscle pain",
      "Post-surgical tissue recovery",
    ],
    feels:
      "A gentle, warm light — not a hot sauna. You lie comfortably, it's non-invasive. Most people find it very soothing.",
    keyPoints: [
      "The difference between infrared and a heat pad is depth. A heat pad warms the surface. Infrared reaches the tissue underneath.",
      "For arthritis or joint pain — infrared goes directly to where the inflammation lives.",
      "For skin conditions like psoriasis — it works in the dermal layer, not just on the surface.",
      "Sessions are only 12 minutes, so it's easy to fit into your week.",
      "We often combine it with PEMF for joint conditions — they work well together.",
    ],
  },
  {
    name: "PEMF Therapy",
    short: "PEMF",
    accent: "pemf",
    oneLiner:
      "PEMF uses gentle magnetic pulses that pass through the body and create tiny electrical signals in your cells — helping them function and recover more efficiently. It recharges the cell's natural electrical balance.",
    duration: "25–30 minutes per session",
    course: "5–10 sessions. Most clients notice less stiffness and better sleep within the first few sessions.",
    bestFor: [
      "Pelvic floor / bladder confidence",
      "Bone density / osteoporosis",
      "Nerve pain / sciatica",
      "Chronic pain",
      "Sleep disorders",
      "Fracture healing",
    ],
    feels:
      "Completely non-invasive — you sit comfortably in the PEMF chair, fully clothed. Some people feel a gentle warmth or tingling, but most feel nothing beyond a deep sense of relaxation.",
    keyPoints: [
      "For pelvic floor / bladder: fully clothed, completely private — the pulses stimulate the muscle from outside without any invasive element.",
      "PEMF is FDA-cleared for bone healing — it's not a new or untested technology.",
      "It works at a cellular level — addressing the biology of the problem, not just the symptom.",
      "For nerve pain — it reduces the excitability of the nerve itself, not just blocking the signal.",
      "For sleep: it entrains the brain towards slow-wave activity that actually restores you.",
    ],
  },
  {
    name: "Massage Therapy",
    short: "MASSAGE",
    accent: "ir",
    oneLiner:
      "Massage works on the muscles, fascia and soft tissue directly — releasing tension, improving circulation, and helping your body shift out of the stress response. We use it as a standalone therapy and in combination with our other treatments for faster, deeper results.",
    duration: "60 minutes per session",
    course: "Works as a one-off or as a regular course. Most clients with chronic tension or stress notice a significant difference after 3–4 sessions.",
    bestFor: [
      "Chronic back and neck pain",
      "Muscle tension",
      "Stress and burnout",
      "Sports recovery",
      "Myofascial trigger points",
      "Headaches",
      "Post-exercise soreness",
    ],
    feels:
      "Exactly what you'd expect — but done therapeutically, not just for relaxation. Our therapist works into the specific areas causing your problem. You'll often feel the difference immediately.",
    keyPoints: [
      "Massage is often the fastest way to feel immediate relief — combine it with Infrared or PEMF and the results last much longer.",
      "For back or neck pain — massage releases the muscle holding the problem in place. PEMF then calms the nerve underneath.",
      "For stress and burnout — massage is one of the few things that genuinely moves you out of fight-or-flight.",
      "For myofascial pain or trigger points — massage is the primary treatment, and very effective combined with infrared.",
      "For athletes — a sports massage before HBOT or PEMF can accelerate recovery significantly.",
    ],
  },
];

/* ----------------------------------------------------------------------- */
/*  CONDITION → THERAPY GUIDE                                               */
/* ----------------------------------------------------------------------- */

export const CONDITIONS: ConditionRow[] = [
  // PAIN, JOINTS & INFLAMMATION
  { category: "Pain, Joints & Inflammation", name: "Osteoarthritis", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "Lead with Infrared (deep joint heat). PEMF for bone/cartilage. HBOT if systemic. Massage for surrounding muscle tension." },
  { category: "Pain, Joints & Inflammation", name: "Rheumatoid arthritis", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "HBOT for systemic inflammation. Infrared for joint comfort. PEMF calms flares. Gentle massage for muscle tension." },
  { category: "Pain, Joints & Inflammation", name: "Chronic back pain", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Massage + PEMF first (muscle/nerve). Infrared for deep tissue. Combine for best results." },
  { category: "Pain, Joints & Inflammation", name: "Neck/shoulder pain", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Massage for muscle tension and trigger points. Infrared for depth. PEMF for nerve pain." },
  { category: "Pain, Joints & Inflammation", name: "Sciatica / nerve pain", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "PEMF calms nerve excitability. Infrared for microcirculation. Massage for piriformis/glute tension." },
  { category: "Pain, Joints & Inflammation", name: "Fibromyalgia", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "All four — HBOT for fatigue/cognition, Infrared for pain, PEMF for nerve sensitivity, massage for tender points." },
  { category: "Pain, Joints & Inflammation", name: "Tendinitis (Achilles, rotator cuff, tennis elbow)", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared penetrates tendon tissue. PEMF stimulates collagen repair. Massage for surrounding muscle." },
  { category: "Pain, Joints & Inflammation", name: "Plantar fasciitis", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared + PEMF + massage (calf/foot). Improve circulation and reduce fascial inflammation." },
  { category: "Pain, Joints & Inflammation", name: "Bursitis", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared reduces inflammation. PEMF calms local pain. Massage for surrounding muscle guarding." },
  { category: "Pain, Joints & Inflammation", name: "Carpal tunnel syndrome", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "PEMF for nerve calming. Infrared for microcirculation. Massage for forearm muscle tension." },
  { category: "Pain, Joints & Inflammation", name: "TMJ pain / jaw pain", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared for heat. PEMF for nerve pain. Massage for jaw/neck muscle tension." },
  { category: "Pain, Joints & Inflammation", name: "Hip pain / joint stiffness", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared penetrates deep into the hip joint. PEMF for cartilage. Massage for hip flexor/glute tension." },
  { category: "Pain, Joints & Inflammation", name: "Myofascial pain / trigger points", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Massage #1 — direct trigger point release. Infrared + PEMF for deeper tissue and nerve support." },
  // RECOVERY & HEALING
  { category: "Recovery & Healing", name: "Post-surgical recovery", therapies: ["HBOT", "INFRARED", "PEMF"], leadWith: "HBOT #1 — accelerates tissue healing dramatically. Infrared for scar/collagen. PEMF for pain. (Massage post-clearance only.)" },
  { category: "Recovery & Healing", name: "Ligament / tendon tear or repair", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared stimulates fibroblasts. PEMF promotes collagen. Massage for surrounding muscle when healing allows." },
  { category: "Recovery & Healing", name: "Fracture recovery", therapies: ["PEMF"], leadWith: "PEMF — FDA-cleared for bone stimulation. Promotes osteoblast activity." },
  { category: "Recovery & Healing", name: "Diabetic foot ulcer / slow-healing wound", therapies: ["HBOT", "INFRARED"], leadWith: "HBOT #1 — super-oxygenates ischaemic tissue. Infrared boosts microcirculation." },
  { category: "Recovery & Healing", name: "Scar tissue / post-surgical scarring", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared remodels collagen. PEMF reduces scar stiffness. Massage breaks down adhesions when cleared." },
  { category: "Recovery & Healing", name: "Sports injury", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Massage + Infrared + PEMF. All three address soft tissue. HBOT if systemic or longer-term." },
  { category: "Recovery & Healing", name: "Post-exercise recovery (athletes)", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "HBOT for systemic oxygen. Infrared for muscle. PEMF for tissue. Massage for recovery flush." },
  { category: "Recovery & Healing", name: "Long COVID / post-viral fatigue", therapies: ["HBOT", "INFRARED"], leadWith: "HBOT #1 — most evidence for neuroinflammation and energy. Infrared for mitochondrial support." },
  { category: "Recovery & Healing", name: "ME / Chronic fatigue syndrome", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "HBOT + Infrared for cellular energy. PEMF for sleep. Gentle massage for pain and nervous system." },
  // NEUROLOGICAL
  { category: "Neurological & Cognitive", name: "Concussion / traumatic brain injury", therapies: ["HBOT"], leadWith: "HBOT #1 — strongest evidence base. Reduces neuroinflammation." },
  { category: "Neurological & Cognitive", name: "Brain fog", therapies: ["HBOT", "INFRARED", "PEMF"], leadWith: "HBOT primary. Infrared for thyroid/nervous system. PEMF for neural function." },
  { category: "Neurological & Cognitive", name: "Cognitive decline / memory", therapies: ["HBOT", "PEMF"], leadWith: "HBOT + PEMF. Both address brain oxygenation and neural circuit function." },
  { category: "Neurological & Cognitive", name: "Peripheral neuropathy", therapies: ["INFRARED", "PEMF"], leadWith: "Infrared improves microcirculation. PEMF calms nerve excitability." },
  { category: "Neurological & Cognitive", name: "Multiple sclerosis (supportive)", therapies: ["HBOT", "PEMF"], leadWith: "HBOT for hypoxic neurological tissue. PEMF for nerve environment. Always GP-guided." },
  { category: "Neurological & Cognitive", name: "Parkinson's (supportive)", therapies: ["HBOT", "INFRARED", "PEMF"], leadWith: "Supportive only. Combine HBOT, Infrared and PEMF for neuroprotection — always GP-guided." },
  { category: "Neurological & Cognitive", name: "Migraine / headaches", therapies: ["INFRARED", "MASSAGE"], leadWith: "Massage for neck/shoulder tension. Infrared for circulation. PEMF as adjunct." },
  // WOMEN'S HEALTH
  { category: "Women's Health", name: "Bladder leakage / stress incontinence", therapies: ["PEMF"], leadWith: "PEMF #1 — electromagnetic pelvic floor rehab. Be sensitive, reassuring, use 'bladder confidence'." },
  { category: "Women's Health", name: "Pelvic floor weakness", therapies: ["PEMF"], leadWith: "PEMF — restores tone, nerve-muscle signalling. Non-invasive, fully clothed, private." },
  { category: "Women's Health", name: "Post-partum recovery", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared for tissue repair. PEMF for pelvic floor. Massage for postnatal recovery. All complement physio." },
  { category: "Women's Health", name: "Menopause symptoms", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "All four can support — Infrared for sleep/joints, PEMF for bones, HBOT for energy, massage for stress." },
  { category: "Women's Health", name: "Endometriosis / pelvic pain", therapies: ["INFRARED", "PEMF"], leadWith: "Infrared penetrates pelvic tissue. PEMF calms inflammation. Highly sensitive topic." },
  { category: "Women's Health", name: "Menstrual cramping", therapies: ["INFRARED", "MASSAGE"], leadWith: "Infrared for pelvic inflammation. Massage for lower back/abdominal muscle tension." },
  { category: "Women's Health", name: "Post C-section recovery", therapies: ["INFRARED", "PEMF"], leadWith: "Infrared for scar/tissue healing. PEMF for comfort and pelvic floor. (Massage only post-clearance.)" },
  // SKIN
  { category: "Skin & Dermatology", name: "Eczema / psoriasis", therapies: ["HBOT", "INFRARED", "PEMF"], leadWith: "Infrared for dermal inflammation. PEMF for immune modulation. HBOT for systemic inflammation." },
  { category: "Skin & Dermatology", name: "Acne", therapies: ["INFRARED", "PEMF"], leadWith: "Infrared reduces sebum/inflammation. PEMF for microcirculation and cellular repair." },
  { category: "Skin & Dermatology", name: "Rosacea", therapies: ["INFRARED"], leadWith: "Infrared reduces vascular inflammation. Gentle approach." },
  { category: "Skin & Dermatology", name: "Collagen / skin ageing", therapies: ["INFRARED"], leadWith: "Infrared stimulates fibroblasts and collagen production. Key selling point for this audience." },
  { category: "Skin & Dermatology", name: "Wound healing / surgical scars", therapies: ["HBOT", "INFRARED", "PEMF"], leadWith: "HBOT for oxygenation. Infrared for collagen remodelling. PEMF for tissue quality." },
  // BONE & CIRCULATION
  { category: "Bone Health & Circulation", name: "Osteoporosis / bone density", therapies: ["PEMF"], leadWith: "PEMF — stimulates osteoblasts. FDA-cleared for bone healing. Great standalone angle." },
  { category: "Bone Health & Circulation", name: "Raynaud's phenomenon", therapies: ["INFRARED", "PEMF"], leadWith: "Infrared opens circulation in extremities. PEMF supports vascular tone." },
  { category: "Bone Health & Circulation", name: "Poor circulation / lymphoedema", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared + PEMF for microcirculation. Lymphatic massage for drainage and fluid movement." },
  { category: "Bone Health & Circulation", name: "Radiation injury (oncology aftercare)", therapies: ["HBOT"], leadWith: "HBOT #1 — specific evidence for radiation cystitis, proctitis, osteoradionecrosis. Always GP-guided." },
  // SLEEP, STRESS, MENTAL
  { category: "Sleep, Stress & Mental Clarity", name: "Insomnia / sleep disruption", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Infrared for parasympathetic activation. PEMF for neural sleep states. Massage for relaxation and wind-down." },
  { category: "Sleep, Stress & Mental Clarity", name: "Chronic stress / burnout", therapies: ["INFRARED", "PEMF", "MASSAGE"], leadWith: "Massage for immediate nervous system relief. Infrared cortisol reduction. PEMF for regulation." },
  { category: "Sleep, Stress & Mental Clarity", name: "Anxiety / depression (supportive)", therapies: ["HBOT", "PEMF", "MASSAGE"], leadWith: "HBOT for neuroinflammation. PEMF for mood regulation. Massage for parasympathetic activation. Supportive only." },
  { category: "Sleep, Stress & Mental Clarity", name: "Thyroid dysfunction (Hashimoto's)", therapies: ["HBOT", "INFRARED"], leadWith: "HBOT for systemic immune regulation. Infrared for thyroid area circulation. Supportive only." },
  { category: "Sleep, Stress & Mental Clarity", name: "Low energy / fatigue (general)", therapies: ["HBOT", "INFRARED", "PEMF", "MASSAGE"], leadWith: "HBOT for cellular energy. Infrared for mitochondrial support. PEMF for ATP. Massage for recovery and relaxation." },
];

/* ----------------------------------------------------------------------- */
/*  PRICING                                                                 */
/* ----------------------------------------------------------------------- */

export const PRICING = {
  packs: [
    { therapy: "Infrared", fivePack: "€225", fiveWas: "€250", tenPack: "€400", tenWas: "€450", per5: "€45", per10: "€40" },
    { therapy: "HBOT", fivePack: "€400", fiveWas: "€600", tenPack: "€800", tenWas: "€1,200", per5: "€80", per10: "€80" },
    { therapy: "PEMF", fivePack: "€270", fiveWas: "€325", tenPack: "€500", tenWas: "€700", per5: "€54", per10: "€50" },
    { therapy: "Massage", fivePack: "Confirm", fiveWas: "—", tenPack: "Confirm", tenWas: "—", per5: "—", per10: "—" },
  ],
  memberships: [
    { plan: "Starter", price: "€169/month", includes: "1× HBOT, 2× Infrared, 2× PEMF", bestFor: "First month, busy workers, gentle intro" },
    { plan: "Standard", price: "€299/month", includes: "2× HBOT, 4× Infrared, 4× PEMF", bestFor: "Consistent users, parents, desk workers" },
    { plan: "Premium", price: "€399/month", includes: "4× HBOT, 6× Infrared, 6× PEMF", bestFor: "Heavy training, high-stress, sleep focus" },
  ],
};

/* ----------------------------------------------------------------------- */
/*  LESSON MODULES                                                          */
/* ----------------------------------------------------------------------- */

export const LESSONS: Lesson[] = [
  {
    slug: "philosophy",
    number: "01",
    title: "The Renova Philosophy",
    summary: "How we sell — trusted guide, not salesperson. 80% listening, 20% talking.",
    durationMin: 6,
    sections: [
      {
        heading: "How we sell",
        kind: "prose",
        paragraphs: [
          "We don't sell sessions. We help people find solutions to problems they've often been living with for years. The moment a call feels like a sales pitch, we've lost. The moment it feels like a conversation with someone who genuinely understands their situation and knows how to help — we've won.",
          "Your role on a call is 80% listening, 20% talking. You are a trusted guide, not a salesperson. The goal is to understand what someone is dealing with, match them to the right therapy or combination, and give them the confidence to take a step they've probably been putting off.",
        ],
      },
      {
        heading: "The Three Principles",
        kind: "list",
        bullets: [
          "Ask more than you tell. Every question you ask shows the client you care about their specific situation.",
          "Validate before recommending. People need to feel heard before they're ready to hear a solution.",
          "Educate, don't pressure. A client who understands why a therapy works is far more likely to commit — and to return.",
        ],
      },
      {
        heading: "What we are NOT",
        kind: "list",
        tone: "dont",
        bullets: [
          "We are not a spa. Never describe our therapies as \"relaxing\" or \"pampering\" — these are clinical tools.",
          "We are not a gym. We are not selling motivation or lifestyle. We are solving health problems.",
          "We are not a GP. We do not diagnose, prescribe or treat medical conditions. We support and complement.",
          "We are not pushy. We do not pressure. A client who feels pressured will not return — and will not refer.",
        ],
      },
      {
        heading: "The mindset before every call",
        kind: "callout",
        callout: {
          label: "Centre yourself",
          body: "\"This person has taken the time to contact us. Something in their life isn't working the way they need it to. My job is to find out what that is, whether we can help, and if so — to make it easy for them to get started.\"",
        },
      },
    ],
    keyTakeaways: [
      "80% listening, 20% talking",
      "Validate before recommending",
      "We are clinical — not a spa",
      "Never pressure — pressured clients don't return or refer",
    ],
    quiz: [
      {
        q: "On a Renova call, what's the listening-to-talking ratio?",
        choices: ["50% / 50%", "80% listening / 20% talking", "20% listening / 80% talking", "Whatever feels natural"],
        answer: 1,
        explain: "We listen 80% of the time. Every question we ask shows the client we care about their specific situation.",
      },
      {
        q: "Which of these is NOT how Renova positions itself?",
        choices: ["A clinical wellness provider", "A spa offering relaxation", "A support for medical care", "A non-invasive recovery clinic"],
        answer: 1,
        explain: "We are not a spa. Our therapies are clinical tools — never described as 'relaxing' or 'pampering'.",
      },
      {
        q: "Before recommending a therapy, what must you do first?",
        choices: ["Quote the price", "Validate what the client has told you", "Offer a discount", "Close the booking"],
        answer: 1,
        explain: "People need to feel heard before they're ready to hear a solution. Validation comes first.",
      },
    ],
  },
  {
    slug: "call-framework",
    number: "02",
    title: "The Call Framework",
    summary: "Every call follows the same 5 stages: Warm Opening → Discovery → Validate/Educate → Recommend → Close.",
    durationMin: 10,
    sections: [
      {
        heading: "Stage 1 — Warm Opening (0–60s)",
        kind: "prose",
        paragraphs: [
          "Your first job is to make them feel glad they called. Keep it warm, human, and brief. No scripts. No robotic greetings.",
        ],
      },
      {
        heading: "Stage 1 Scripts",
        kind: "scripts",
        scripts: [
          { label: "Opening", body: "Hi [Name], thanks so much for getting in touch with us. How can I help you today?" },
          { label: "If they enquired online", body: "Hi [Name], I'm calling back about your enquiry on the website — is now a good time for a quick chat?" },
        ],
      },
      {
        heading: "What to avoid in the opening",
        kind: "list",
        tone: "dont",
        bullets: [
          "Don't launch into a therapy description before you've heard their situation.",
          "Don't read from a script — they will hear it and the trust evaporates.",
          "Don't say 'we have a great offer on right now' in the first 30 seconds.",
          "Don't sound transactional — 'How can I take your booking?' is not an opening.",
        ],
      },
      {
        heading: "Stage 2 — Discovery (3–8 mins)",
        kind: "prose",
        paragraphs: [
          "The most important stage. You are trying to understand three things: what they're dealing with, how long it's been going on, and what they've already tried. The more you understand, the more specifically you can help — and the more trust you build.",
        ],
      },
      {
        heading: "The 5 Core Discovery Questions",
        kind: "scripts",
        scripts: [
          { label: "Opener", body: "So, tell me a little bit about what's been going on — what made you reach out to us today?" },
          { label: "Duration", body: "How long has this been affecting you?" },
          { label: "Tried before", body: "What have you tried so far, and how has that gone for you?" },
          { label: "Impact", body: "How is it affecting your day-to-day life — work, sleep, activity, that kind of thing?" },
          { label: "Goal", body: "What would a good outcome look like for you — what would 'better' feel like?" },
        ],
      },
      {
        heading: "Dig-deeper follow-ups",
        kind: "list",
        bullets: [
          "On a scale of 1–10, how much is it limiting what you can do?",
          "Is this something your GP or consultant has looked at?",
          "Have you ever come across [therapy] before, or is this the first time?",
          "Is it the physical side or the fatigue/sleep/mood side that's the main issue?",
          "Are you currently on medication for this — or is that something you'd prefer to manage without?",
        ],
      },
      {
        heading: "Stage 3 — Validate & Educate (2–4 mins)",
        kind: "scripts",
        scripts: [
          { label: "Validate", body: "That makes complete sense — what you're describing is really common with [condition]. And it's often because [brief explanation of mechanism]. A lot of our clients come to us after trying physio / medication / rest and finding it helps but not enough." },
          { label: "Educate", body: "What we've found works really well for people in your situation is [therapy]. The reason it's relevant to what you're describing is [one sentence on mechanism]. We've had great results with clients dealing with exactly this." },
        ],
      },
      {
        heading: "Stage 4 — Recommendation (1–2 mins)",
        kind: "scripts",
        scripts: [
          { label: "Recommend", body: "Based on what you've told me, I'd really suggest starting with [therapy]. For your situation — [their specific condition] — we'd typically recommend starting with a course of 5 or 10 sessions. Most clients start to notice a change within the first 3 to 5 sessions, and a full course gives the tissue time to respond properly." },
          { label: "Package intro", body: "We have two options for getting started — a 5-session block and a 10-session block. The 10-session is better value if you're committed to a proper course, and honestly it's where most people see the real results." },
        ],
      },
      {
        heading: "Stage 5 — Close (1–2 mins)",
        kind: "scripts",
        scripts: [
          { label: "Soft close", body: "The easiest thing to do would be to get your first session booked in — that way you can experience it for yourself and we can answer any more questions in person. It's pretty relaxed, there's no pressure. Would that work for you?" },
          { label: "Offer callback", body: "Even if you want to have a think about it, would it help if I sent over a bit of information by email in the meantime? And then I can give you a ring in a day or two if you have any questions." },
          { label: "Direct close", body: "Shall we get something in the diary? We have availability [this week / next week] — I can have you booked in today." },
        ],
      },
    ],
    keyTakeaways: [
      "Five stages: Warm Opening → Discovery → Validate/Educate → Recommend → Close",
      "Never skip a stage; adapt the language but keep the order",
      "Discovery is the most important stage — at least 3–8 minutes of it",
      "Always validate the client's experience before educating or recommending",
    ],
    quiz: [
      {
        q: "What is the correct order of the call framework?",
        choices: [
          "Opening → Price → Recommendation → Close",
          "Opening → Discovery → Validate/Educate → Recommendation → Close",
          "Discovery → Opening → Pitch → Close",
          "Opening → Recommendation → Discovery → Close",
        ],
        answer: 1,
        explain: "Warm Opening → Discovery → Validate & Educate → Recommendation → Close. Never skip a stage.",
      },
      {
        q: "Which is NOT one of the 5 core discovery questions?",
        choices: ["What made you reach out today?", "How long has it been affecting you?", "What's your budget?", "What have you tried so far?"],
        answer: 2,
        explain: "Budget never comes up in discovery. The core five are: opener, duration, tried before, impact, and goal.",
      },
      {
        q: "How long should the discovery stage typically last?",
        choices: ["30 seconds", "1–2 minutes", "3–8 minutes", "15+ minutes"],
        answer: 2,
        explain: "Discovery should take 3–8 minutes. The more you understand, the more specifically you can help.",
      },
      {
        q: "Which close style assumes the booking is already happening?",
        choices: ["The soft close", "The assumption close", "The low-pressure close", "The discount close"],
        answer: 1,
        explain: "The assumption close — 'We have Tuesday or Thursday available, which works better?' — removes the decision pressure.",
      },
    ],
  },
  {
    slug: "facebook-leads",
    number: "03",
    title: "Facebook Lead Calls",
    summary: "How to handle warm-but-not-hot Facebook leads — opening, follow-up cadence, and ad-to-call mapping.",
    durationMin: 8,
    sections: [
      {
        heading: "What you know going in",
        kind: "list",
        bullets: [
          "Their name and phone number",
          "Possibly which ad they responded to (skin, pain, women's health, etc.)",
          "Something in the ad caught their attention — they didn't click by accident",
        ],
      },
      {
        heading: "The Facebook lead mindset",
        kind: "prose",
        paragraphs: [
          "Facebook leads are warm, not hot. They showed interest, but they may have scrolled past dozens of ads that day. Some will be eager. Some will have half-forgotten they clicked. A small number will be slightly defensive ('where did you get my number?').",
        ],
      },
      {
        heading: "Standard FB lead opening",
        kind: "scripts",
        scripts: [
          { label: "Opening", body: "Hi [Name], it's [Your Name] calling from Renova in Clonmel. You came across one of our ads on Facebook recently and left your details — I just wanted to give you a quick call to see if there's anything we might be able to help with. Is now an okay time?" },
          { label: "If they say yes", body: "Great. So the ad you saw was about [skin / pain / women's health / recovery]. Can I ask — what was it that caught your eye, or is there something you've been dealing with that made you click?" },
          { label: "If it's a bad time", body: "No problem at all — when would be a better time to catch you? I'll drop a text first so you know it's me." },
        ],
      },
      {
        heading: "Common situations",
        kind: "scripts",
        scripts: [
          { label: "I don't remember signing up / where did you get my number?", body: "Totally understand — you may have seen one of our Facebook ads and filled in a short form. It would have been about [topic]. Your details came through to us so I just wanted to reach out. No worries at all if it's not the right time — but can I ask, is that something you've been looking into at all?" },
          { label: "What is it you actually do?", body: "So we're a wellness clinic in Clonmel — we work with four therapies: hyperbaric oxygen, infrared bed therapy, PEMF, and massage. They're all non-invasive, and we use them to help people with chronic pain, recovery, energy, sleep, skin conditions — depending on what someone needs. Can I ask, is there something specific you've been trying to get on top of?" },
          { label: "I was just curious / browsing", body: "That's completely fine — honestly, most people who end up coming to us started out just curious. Can I ask what the ad was about that made you stop scrolling? Even if you're not sure yet, I might be able to tell you if it's something that could genuinely help." },
        ],
      },
      {
        heading: "Unresponsive lead — follow-up protocol",
        kind: "table",
        table: {
          headers: ["Attempt", "Timing", "Method", "Note"],
          rows: [
            ["1st", "Same day as lead comes in", "Call", "No voicemail on first attempt"],
            ["2nd", "2–4 hours later", "Call + text if no answer", "\"Hi [Name], tried to reach you earlier — I'll try again later. – [Your Name], Renova\""],
            ["3rd", "Next day", "Call", "Leave voicemail if no answer"],
            ["4th", "3 days later", "Call or text", "Final attempt — keep it warm, not desperate"],
          ],
        },
      },
      {
        heading: "Voicemail script",
        kind: "scripts",
        scripts: [
          { label: "Voicemail", body: "Hi [Name], it's [Your Name] calling from Renova in Clonmel. You came across one of our Facebook ads recently — I just wanted to reach out and see if there's something we could help with. No pressure at all. Give me a call back when you get a chance, or I'll try you again in a couple of days. Take care." },
        ],
      },
      {
        heading: "Ad-to-opening map",
        kind: "table",
        table: {
          headers: ["They saw an ad about…", "Open with…"],
          rows: [
            ["Skin / psoriasis / eczema", "The ad was about how infrared light therapy can help with skin conditions like psoriasis or eczema — is that something you've been dealing with?"],
            ["Women's health / pelvic floor", "The ad was about pelvic floor therapy using PEMF — it's non-invasive, fully clothed. Is that something you've been looking into?"],
            ["Chronic pain / joint pain", "The ad was about chronic pain relief — we work with people dealing with arthritis, back pain, nerve pain. Is that relevant to you?"],
            ["Recovery / sport", "The ad was about recovery — we work with a lot of people who are trying to get back to full form after injury or training harder. Is that where you're at?"],
            ["Brain / fatigue / long COVID", "The ad was about energy, brain fog, fatigue — things like long COVID or chronic fatigue. Has that been something you've been experiencing?"],
            ["Bone / joint / nerve (PEMF)", "The ad was about PEMF therapy for things like bone density, nerve pain, or joint issues. Is any of that relevant to what you've been dealing with?"],
          ],
        },
      },
    ],
    keyTakeaways: [
      "FB leads are warm, not hot — open low-pressure",
      "4-attempt follow-up: same day → 2–4hr later → next day → 3 days later",
      "Never leave voicemail on first attempt",
      "Match the opening to the ad they saw",
    ],
    quiz: [
      {
        q: "When should you leave a voicemail on a Facebook lead?",
        choices: ["First attempt", "Second attempt", "Third attempt onwards", "Never"],
        answer: 2,
        explain: "No voicemail on the first attempt — leave one from the 3rd attempt (next day) if there's still no answer.",
      },
      {
        q: "A FB lead says 'where did you get my number?' — best opening response?",
        choices: [
          "Apologise and end the call",
          "Explain calmly: 'You may have seen one of our Facebook ads and filled in a short form…'",
          "Tell them they signed up so it's their fault",
          "Offer a discount immediately to defuse",
        ],
        answer: 1,
        explain: "Stay calm and explain factually. People scroll fast and sometimes forget clicking — make it easy for them.",
      },
      {
        q: "What's the right tone for a FB lead caller?",
        choices: [
          "High-energy and urgent — they need a strong push",
          "Warm, low-pressure, curious — calling to help, not sell",
          "Brief and transactional — they're already half-sold",
          "Detailed and educational — start with all the science",
        ],
        answer: 1,
        explain: "FB leads are warm, not hot. Your tone is warm, low-pressure, and curious.",
      },
    ],
  },
  {
    slug: "conditions",
    number: "04",
    title: "Condition → Treatment Guide",
    summary: "The reference table. For any condition a caller mentions, find the right therapy combo and how to lead with it.",
    durationMin: 12,
    sections: [
      {
        heading: "How to use this section",
        kind: "prose",
        paragraphs: [
          "When a caller mentions a condition, your job is to instantly map it to the right therapy combination. Use the interactive Condition Lookup tool (in the left sidebar of /training) to drill into any of 45+ conditions, with the exact lead-with line for each.",
          "Below is a quick refresher of the top conditions you'll hear most often on calls.",
        ],
      },
      {
        heading: "Top-10 conditions you'll hear most",
        kind: "table",
        table: {
          headers: ["They say…", "Recommend", "Key line"],
          rows: [
            ["I had a knee/hip/shoulder operation", "HBOT + Infrared", "HBOT accelerates tissue healing at the cellular level — used in post-surgical recovery specifically."],
            ["I have arthritis", "Infrared + PEMF (+ HBOT)", "Infrared penetrates directly into the joint — not surface heat, it's reaching where the inflammation is."],
            ["Chronic back / neck pain", "PEMF + Infrared (+ Massage)", "PEMF calms the nerve. Infrared releases deep muscle tissue."],
            ["I leak when I cough / run", "PEMF", "PEMF restores pelvic floor tone — fully clothed, completely private."],
            ["Haven't been right since COVID", "HBOT", "HBOT has the strongest evidence base for post-viral fatigue."],
            ["Can't sleep / always exhausted", "Infrared + PEMF", "Infrared shifts your nervous system into a parasympathetic state."],
            ["Psoriasis / eczema", "Infrared + PEMF", "Infrared reaches the dermal layer — 3 to 4cm below the skin surface."],
            ["Osteoporosis", "PEMF", "PEMF is FDA-cleared for bone stimulation — activates osteoblasts."],
            ["Diabetic wound won't heal", "HBOT + Infrared", "HBOT super-oxygenates poorly perfused tissue — one of the most evidence-backed tools for wound closure."],
            ["Brain fog / memory issues", "HBOT + PEMF", "HBOT increases oxygen to brain tissue. PEMF stimulates neural circuit function."],
          ],
        },
      },
      {
        heading: "Red flags — always ask GP first",
        kind: "list",
        tone: "dont",
        bullets: [
          "Current active infection or fever",
          "Pregnancy (HBOT — always needs GP clearance)",
          "Recent surgery within 2 weeks — check before booking",
          "Claustrophobia — mention the familiarisation option for HBOT",
          "Implanted devices (pacemakers, cochlear implants) — check before PEMF",
          "Ear or sinus problems — affects HBOT",
          "Active cancer treatment (chemo/radiation ongoing) — always GP-guided",
        ],
      },
    ],
    keyTakeaways: [
      "Map condition → therapy combo instantly",
      "Lead with the strongest match, mention adjuncts second",
      "Always check red flags — refer to GP when in doubt",
      "Use the Condition Lookup tool to drill into 45+ specific cases",
    ],
    quiz: [
      {
        q: "A client says 'I leak when I cough.' Primary recommendation?",
        choices: ["HBOT", "Infrared", "PEMF", "Massage"],
        answer: 2,
        explain: "PEMF is the primary therapy for pelvic floor / bladder confidence. Fully clothed, completely private.",
      },
      {
        q: "A client recovering from a knee replacement two weeks ago. What's the lead therapy?",
        choices: ["Massage", "HBOT", "PEMF only", "Sauna"],
        answer: 1,
        explain: "HBOT accelerates post-surgical tissue healing. Massage is only post-clearance.",
      },
      {
        q: "A long-COVID caller with brain fog and fatigue. Lead with?",
        choices: ["Massage", "HBOT", "Infrared only", "Wait until they've fully recovered"],
        answer: 1,
        explain: "HBOT has the strongest evidence base for post-viral fatigue and neuroinflammation.",
      },
      {
        q: "A client mentions they have a pacemaker. What do you do first?",
        choices: [
          "Recommend PEMF — it's gentle",
          "Refuse all therapies",
          "Flag the red flag — check with their GP/cardiologist before PEMF",
          "Offer only HBOT",
        ],
        answer: 2,
        explain: "Pacemakers and cochlear implants are PEMF red flags. Always check before booking.",
      },
    ],
  },
  {
    slug: "therapies",
    number: "05",
    title: "Therapy Explainers",
    summary: "Plain-language one-liners and key points for HBOT, Infrared, PEMF and Massage.",
    durationMin: 10,
    sections: [
      {
        heading: "How to use these",
        kind: "prose",
        paragraphs: [
          "Keep explanations short — one or two sentences. If they want more detail, expand. If they're sold, move on. Open the Roleplay or Flashcards tab to drill these until they roll off the tongue.",
        ],
      },
    ],
    keyTakeaways: [
      "One-liner per therapy — short, plain English",
      "HBOT 50–60min · Infrared 12min · PEMF 25–30min · Massage 60min",
      "Always link mechanism to the caller's specific problem",
    ],
    quiz: [
      {
        q: "How deep does infrared penetrate?",
        choices: ["Surface only", "1cm", "3–4cm below the skin", "10cm+"],
        answer: 2,
        explain: "Infrared penetrates 3–4cm below the surface — the depth where joint and dermal inflammation lives.",
      },
      {
        q: "Which therapy is FDA-cleared for bone healing?",
        choices: ["HBOT", "Infrared", "PEMF", "Massage"],
        answer: 2,
        explain: "PEMF is FDA-cleared for bone stimulation and fracture healing.",
      },
      {
        q: "How long is a single HBOT session?",
        choices: ["12 minutes", "25–30 minutes", "50–60 minutes", "Two hours"],
        answer: 2,
        explain: "HBOT sessions are 50–60 minutes. Most clients describe it as the best forced rest of their week.",
      },
    ],
  },
  {
    slug: "pricing",
    number: "06",
    title: "Pricing & Packages",
    summary: "Current packs, memberships, and how to present price without apologising for it.",
    durationMin: 7,
    sections: [
      {
        heading: "Rule #1: never lead with price",
        kind: "prose",
        paragraphs: [
          "Always establish the value and the relevance first. When pricing comes up, present it confidently and simply. Don't apologise for it. Don't over-explain it.",
        ],
      },
      {
        heading: "How to present pricing on a call",
        kind: "scripts",
        scripts: [
          { label: "Frame first", body: "Before I tell you the price, let me just confirm what the package includes — because it's worth understanding what you're getting for it." },
          { label: "Give the price cleanly", body: "A course of 5 HBOT sessions is €400 — that's currently discounted from €600. And a course of 10 is €800. Most people in your situation would start with 10, because that's where the real results happen." },
          { label: "Offer membership", body: "If you think you'd want to come in regularly — maybe once or twice a week — we also have a monthly membership option which works out much better value. The Standard plan is €299 a month and includes sessions across all four therapies." },
        ],
      },
      {
        heading: "Pricing — what to avoid",
        kind: "list",
        tone: "dont",
        bullets: [
          "Don't say 'it's quite expensive but…' — you've lost them before they've heard the number.",
          "Don't offer a discount before they've objected to the price.",
          "Don't list every package option at once — recommend one, and explain why.",
          "Don't apologise for the price. State it, then reinforce the value.",
        ],
      },
    ],
    keyTakeaways: [
      "Never lead with price — establish value first",
      "Present the number cleanly, no apology, no hedging",
      "Recommend ONE option (usually 10-pack) and explain why",
      "Membership = better value for regulars",
    ],
    quiz: [
      {
        q: "When should you offer a discount?",
        choices: ["Immediately to soften the price", "Only after they've genuinely objected on price", "Never", "When the call is going slowly"],
        answer: 1,
        explain: "Don't offer discounts before objections. If they hesitate on price, reinforce value first — only discount after a real price objection.",
      },
      {
        q: "How should you frame a 5- vs 10-session pack?",
        choices: [
          "List both and let them pick",
          "Recommend the 10-pack and explain why — better value, real results",
          "Always push the 5-pack as easier",
          "Quote per-session price and let them maths it",
        ],
        answer: 1,
        explain: "Recommend the 10-pack and explain why. The 5-pack is the fallback if they hesitate.",
      },
      {
        q: "What's the price of a 10-pack of HBOT?",
        choices: ["€400", "€500", "€800", "€1,200"],
        answer: 2,
        explain: "10× HBOT is €800 (discounted from €1,200). 5× HBOT is €400 (was €600).",
      },
    ],
  },
  {
    slug: "objections",
    number: "07",
    title: "Objection Handling",
    summary: "Five objection categories — price, uncertainty, time, scepticism, 'let me think'.",
    durationMin: 9,
    sections: [
      {
        heading: "An objection is not a 'no'",
        kind: "prose",
        paragraphs: [
          "An objection is a request for more information or reassurance. Your job is to understand what's behind the objection and address it calmly, without pressure.",
        ],
      },
      {
        heading: "Objection 1 — Price",
        kind: "scripts",
        scripts: [
          { label: "They say", body: "It's a bit expensive. / I wasn't expecting it to cost that much." },
          { label: "Response", body: "I completely understand — it's an investment. The reason people commit is because they've usually been spending money on things that help a bit, but not enough. What we offer works at a level most people haven't experienced before. Can I ask — roughly how much have you spent on physio / medication / other treatments over the last year?" },
          { label: "If still hesitant", body: "If it helps, the 5-session option is a great way to start — it gives your body enough time to respond and tell you whether it's working. Most people have their answer within 3 sessions." },
        ],
      },
      {
        heading: "Objection 2 — Will it work for me?",
        kind: "scripts",
        scripts: [
          { label: "They say", body: "I'm not sure if this is something that would help me. / Has it worked for people with my condition?" },
          { label: "Response", body: "That's a completely fair question — and honestly, I'd be cautious if we claimed it worked for everyone. What I can tell you is that for people with [their specific condition], the results we see are [specific outcome]. The reason it works is [one-sentence mechanism]. It's not a guarantee, but it's a clinically supported approach — and it works on the biology, not just the symptom." },
          { label: "Use a client story", body: "We had a client recently — similar situation to you — [brief story in one or two sentences]. That's a real person, not a testimonial we've dressed up. I wouldn't be recommending it if I didn't think it was relevant." },
        ],
      },
      {
        heading: "Objection 3 — I'm very busy",
        kind: "scripts",
        scripts: [
          { label: "They say", body: "I don't know when I'd fit it in. / I'm really busy." },
          { label: "Response", body: "I hear that a lot — and honestly, it's often why people put it off longer than they should. The good news is our sessions are designed to fit around a busy life. Infrared is 12 minutes. PEMF is 25–30. Even HBOT — 50–60 minutes, but it's also the most forced rest most people get in their week." },
          { label: "Then ask", body: "What days tend to work best for you? We have early morning slots and evening availability — we can usually find something that fits." },
        ],
      },
      {
        heading: "Objection 4 — Scepticism / is it proven?",
        kind: "scripts",
        scripts: [
          { label: "They say", body: "I've never heard of this. / Is this actually evidence-based?" },
          { label: "Response", body: "Completely fair to ask. HBOT has been used in medical settings for decades — established clinical treatment for wound healing, radiation injury, and post-surgical recovery. PEMF is FDA-cleared for bone healing. Infrared has a strong research base in pain management and tissue repair. These aren't new or untested — they're just not widely talked about in the mainstream yet." },
          { label: "If very sceptical", body: "Would it help if I sent you a bit of information before you make a decision? I can drop you a brief email with some background — no pressure. And you're always welcome to speak to your GP about it." },
        ],
      },
      {
        heading: "Objection 5 — Let me think about it",
        kind: "scripts",
        scripts: [
          { label: "They say", body: "I'd like to think about it. / Can I call you back?" },
          { label: "Acknowledge first", body: "Of course — this isn't something you need to decide on the spot. Can I ask — is there a specific part of it you're unsure about? Sometimes it helps to talk through whatever's making you hesitate." },
          { label: "Genuine need to think", body: "No problem at all. Would it help if I sent you over a short summary by email — just the key points about the therapy and what a course looks like? And I can give you a ring in a couple of days." },
          { label: "Keep the door open", body: "There's genuinely no pressure. The most important thing is that you make the right call for yourself. Just know that availability does fill up — so if you do decide to go ahead, it's worth getting in touch sooner rather than later." },
        ],
      },
    ],
    keyTakeaways: [
      "Five categories: price, uncertainty, time, scepticism, 'let me think'",
      "Always acknowledge before addressing",
      "On price: invite them to maths what they've already spent",
      "On uncertainty: use a real client story",
      "On 'let me think': ask one diagnostic question before letting go",
    ],
    quiz: [
      {
        q: "A caller says 'it's a bit expensive'. Best opening line?",
        choices: [
          "OK, I can give you 10% off if you book today.",
          "It's actually really good value if you compare it…",
          "I completely understand — it's an investment. Can I ask how much you've spent on physio / medication over the last year?",
          "Sorry, our prices are fixed.",
        ],
        answer: 2,
        explain: "Acknowledge, frame as investment, then invite them to maths what they've already spent on partial solutions.",
      },
      {
        q: "A sceptical caller asks 'is this scientifically proven?' What's the strongest opening?",
        choices: [
          "Yes, totally — trust me.",
          "Completely fair to ask. HBOT has been used clinically for decades, PEMF is FDA-cleared for bone healing, infrared has strong research in pain management.",
          "You can read about it online.",
          "It works for some people.",
        ],
        answer: 1,
        explain: "Validate the question, then anchor specific clinical credibility points per therapy.",
      },
      {
        q: "A caller says 'let me think about it.' First thing you do?",
        choices: [
          "Push harder — they're nearly there",
          "Drop the price",
          "Acknowledge, then ask: 'Is there a specific part of it you're unsure about?'",
          "Tell them availability is filling fast",
        ],
        answer: 2,
        explain: "Acknowledge first, then one diagnostic question. Most 'I'll think about it' = an unresolved doubt you can address.",
      },
    ],
  },
  {
    slug: "sensitive",
    number: "08",
    title: "Sensitive Situations",
    summary: "Pelvic floor, serious diagnoses, emotional distress — handle with calm matter-of-factness.",
    durationMin: 6,
    sections: [
      {
        heading: "Pelvic floor / bladder leakage",
        kind: "prose",
        paragraphs: [
          "One of the most sensitive topics. The caller has often been living with this for years and is embarrassed to even be making the call. Handle with calm matter-of-factness — not over-empathy, not clinical coldness.",
        ],
      },
      {
        heading: "Pelvic floor — tone & language",
        kind: "list",
        bullets: [
          "Always say 'bladder confidence' or 'pelvic health' — avoid 'incontinence' unless they use the word.",
          "Emphasise: fully clothed, completely private, non-invasive.",
          "Never make them feel like they have to explain or justify.",
          "Move quickly from the topic to what we can do.",
        ],
      },
      {
        heading: "Opening line for pelvic floor",
        kind: "scripts",
        scripts: [
          { label: "Reassuring opener", body: "This is something we work with a lot. It's more common than most people realise, and there's a lot that can be done — so you're in the right place." },
        ],
      },
      {
        heading: "Serious medical conditions",
        kind: "prose",
        paragraphs: [
          "If someone mentions cancer, MS, Parkinson's, or another serious diagnosis, tread carefully. We are supportive, complementary, and always work alongside their medical team.",
        ],
      },
      {
        heading: "Serious conditions — key lines",
        kind: "scripts",
        scripts: [
          { label: "Key line", body: "We work very much alongside whatever medical care you're already receiving — we're not replacing anything, we're adding to it. It's always worth having a chat with your consultant or GP first, and we can provide information to help with that conversation if it's useful." },
        ],
      },
      {
        heading: "Critical language rules",
        kind: "list",
        tone: "dont",
        bullets: [
          "Never say 'this will treat your [condition].' Always say 'this can support your recovery / management.'",
          "If they're mid-treatment (chemo, active infection, post-op within 2 weeks), suggest GP clearance before booking.",
          "If they seem unsure about suitability — offer to send information for their GP.",
        ],
      },
      {
        heading: "Callers in emotional distress",
        kind: "scripts",
        scripts: [
          { label: "Slow down — acknowledge first", body: "I can hear how hard this has been. That kind of ongoing [pain / fatigue / uncertainty] is exhausting — and it makes sense that you're looking for something different. Let's talk about what might help." },
        ],
      },
      {
        heading: "Red flags — refer to GP first",
        kind: "list",
        tone: "dont",
        bullets: [
          "Current active infection or fever",
          "Pregnancy (HBOT — always needs GP clearance)",
          "Recent surgery (within 2 weeks)",
          "Claustrophobia — mention HBOT familiarisation option",
          "Implanted devices (pacemakers, cochlear implants) — check before PEMF",
          "Ear or sinus problems — affects HBOT",
          "Active cancer treatment (chemo / radiation ongoing) — GP-guided only",
        ],
      },
    ],
    keyTakeaways: [
      "Pelvic floor: 'bladder confidence', fully clothed, no need to explain",
      "Serious conditions: support / complement, never 'treat'",
      "Emotional callers: slow down, acknowledge, then move forward",
      "Know the red-flag list — when in doubt, GP first",
    ],
    quiz: [
      {
        q: "A caller mentions bladder leakage. Which word do you use?",
        choices: ["'Incontinence'", "'Leakage problem'", "'Bladder confidence' or 'pelvic health'", "'Weak bladder'"],
        answer: 2,
        explain: "Always say 'bladder confidence' or 'pelvic health' — never 'incontinence' unless they use the word first.",
      },
      {
        q: "A caller has stage 2 cancer, currently mid-chemotherapy. Best response?",
        choices: [
          "Book them in — HBOT will treat the cancer",
          "Refuse outright",
          "Recommend it as supportive, suggest they speak to their consultant/GP first; offer to send information",
          "Tell them to come back when they're cured",
        ],
        answer: 2,
        explain: "Active cancer treatment = always GP-guided. We're supportive, complementary — never claim to treat. Offer to send info for the consultant.",
      },
      {
        q: "A caller breaks down in tears about chronic pain. First thing you do?",
        choices: [
          "Push past it — quote them a price",
          "Slow down, acknowledge ('I can hear how hard this has been…'), then move forward gently",
          "End the call",
          "Offer a discount to cheer them up",
        ],
        answer: 1,
        explain: "Acknowledge before anything else. Slow down, validate the difficulty, then gently move into what might help.",
      },
    ],
  },
  {
    slug: "closing",
    number: "09",
    title: "Closing — Natural, Not Pushy",
    summary: "Three close types and the golden rules. By the close, the booking should feel obvious.",
    durationMin: 6,
    sections: [
      {
        heading: "By the time you close…",
        kind: "prose",
        paragraphs: [
          "…the client should already feel like the decision to book is obvious — because you've done the discovery and education stages well. A good close feels like a natural next step, not a sales moment.",
        ],
      },
      {
        heading: "Close type 1 — Assumption",
        kind: "scripts",
        scripts: [
          { label: "Use when clearly interested", body: "Great — let me get something in the diary for you. We have [day] or [day] available this week — which works better for you?" },
        ],
      },
      {
        heading: "Close type 2 — Step (foot in the door)",
        kind: "scripts",
        scripts: [
          { label: "Use when almost there", body: "The easiest way to start is just to get a first session on the books. No commitment to a full course — it just gives you a chance to experience it and see how your body responds. Shall we do that?" },
        ],
      },
      {
        heading: "Close type 3 — Low-pressure",
        kind: "scripts",
        scripts: [
          { label: "Use when they need to think", body: "Completely fine — take your time. Can I ask, is there anything specific holding you back? Sometimes there's something simple I can answer that makes the decision easier. And if not — I'll send you a quick email and you can come back to me whenever you're ready." },
        ],
      },
      {
        heading: "After the booking",
        kind: "list",
        tone: "do",
        bullets: [
          "Confirm the date, time, and which therapy — repeat back clearly.",
          "Tell them what to wear / bring: 'Comfortable clothes, well-hydrated. No perfumes, lotions or oily products for HBOT.'",
          "Set expectation: 'You'll be met at reception, walked through everything before you start — no need to prep.'",
          "End warmly: 'Really looking forward to meeting you — hope you start to feel the difference quickly.'",
        ],
      },
      {
        heading: "Golden rules of closing",
        kind: "list",
        bullets: [
          "Only close when you've genuinely matched them to the right therapy — premature closes feel like pressure.",
          "Always give two time options, never an open 'What day?' — 'Tuesday or Thursday?' is much easier.",
          "After you name a price and propose the booking — stay quiet. Let them respond. Don't fill the silence.",
          "Never offer a discount to close. If they hesitate on price, remind them of value — don't drop the price.",
          "A 'no' today is not forever. Leave every call with a follow-up agreed.",
        ],
      },
    ],
    keyTakeaways: [
      "Three closes: Assumption, Step, Low-pressure",
      "Always give two time options, not one open question",
      "After proposing — stay quiet. The silence does the work.",
      "Never discount to close. Reinforce value instead.",
    ],
    quiz: [
      {
        q: "Best two-option close phrasing?",
        choices: [
          "What day would you like to come in?",
          "Want to book in?",
          "We have Tuesday or Thursday this week — which works better?",
          "Let me know whenever.",
        ],
        answer: 2,
        explain: "Two specific options removes decision paralysis — they only choose between A and B, not whether to book at all.",
      },
      {
        q: "After proposing the booking and giving the price, what should you do?",
        choices: ["Keep talking to fill the silence", "Add a discount", "Stay quiet — let them respond", "Restate the price"],
        answer: 2,
        explain: "Stay silent. Filling silence after a price quote signals weakness. Let them respond.",
      },
      {
        q: "A caller hesitates on price. What do you NOT do?",
        choices: [
          "Reinforce the value",
          "Invite them to maths what they've already spent",
          "Offer to send info",
          "Drop the price to close",
        ],
        answer: 3,
        explain: "Never offer a discount to close. Reinforce value, don't compete on price — that erodes trust and margin.",
      },
    ],
  },
];

/* ----------------------------------------------------------------------- */
/*  FLASHCARDS                                                              */
/* ----------------------------------------------------------------------- */

export const FLASHCARDS: Flashcard[] = [
  // OPENINGS
  { id: "o1", category: "opening", prompt: "Standard call opening (inbound enquiry)", answer: "Hi [Name], thanks so much for getting in touch with us. How can I help you today?" },
  { id: "o2", category: "opening", prompt: "Calling back an online enquiry", answer: "Hi [Name], I'm calling back about your enquiry on the website — is now a good time for a quick chat?" },
  { id: "o3", category: "opening", prompt: "Standard Facebook lead opening", answer: "Hi [Name], it's [Your Name] calling from Renova in Clonmel. You came across one of our ads on Facebook recently and left your details — I just wanted to give you a quick call to see if there's anything we might be able to help with. Is now an okay time?" },
  { id: "o4", category: "opening", prompt: "Bad time response", answer: "No problem at all — when would be a better time to catch you? I'll drop a text first so you know it's me." },
  { id: "o5", category: "opening", prompt: "Voicemail script", answer: "Hi [Name], it's [Your Name] from Renova in Clonmel. You came across one of our Facebook ads recently — I just wanted to reach out and see if there's something we could help with. No pressure at all. Give me a call back when you get a chance, or I'll try you again in a couple of days. Take care." },
  // DISCOVERY
  { id: "d1", category: "discovery", prompt: "Discovery opener", answer: "So, tell me a little bit about what's been going on — what made you reach out to us today?" },
  { id: "d2", category: "discovery", prompt: "Discovery: duration question", answer: "How long has this been affecting you?" },
  { id: "d3", category: "discovery", prompt: "Discovery: tried before", answer: "What have you tried so far, and how has that gone for you?" },
  { id: "d4", category: "discovery", prompt: "Discovery: impact", answer: "How is it affecting your day-to-day life — work, sleep, activity, that kind of thing?" },
  { id: "d5", category: "discovery", prompt: "Discovery: goal", answer: "What would a good outcome look like for you — what would 'better' feel like?" },
  // VALIDATE
  { id: "v1", category: "validate", prompt: "Validation line", answer: "That makes complete sense — what you're describing is really common with [condition]. A lot of our clients come to us after trying physio / medication / rest and finding it helps but not enough." },
  { id: "v2", category: "validate", prompt: "Bridge into education", answer: "What we've found works really well for people in your situation is [therapy]. The reason it's relevant to what you're describing is [one-sentence mechanism]." },
  // RECOMMEND
  { id: "r1", category: "recommend", prompt: "Therapy recommendation", answer: "Based on what you've told me, I'd really suggest starting with [therapy]. We'd typically recommend a course of 5 or 10 sessions — most clients notice a change within 3 to 5." },
  { id: "r2", category: "recommend", prompt: "Package intro", answer: "We have two options for getting started — a 5-session block and a 10-session block. The 10-session is better value if you're committed to a proper course, and honestly it's where most people see the real results." },
  // CLOSE
  { id: "c1", category: "close", prompt: "Soft close", answer: "The easiest thing to do would be to get your first session booked in — that way you can experience it for yourself and we can answer any more questions in person. Would that work for you?" },
  { id: "c2", category: "close", prompt: "Direct (assumption) close", answer: "Great — let me get something in the diary for you. We have [day] or [day] available this week — which works better for you?" },
  { id: "c3", category: "close", prompt: "Step close (foot in the door)", answer: "The easiest way to start is just to get a first session on the books. No commitment to a full course — it gives you a chance to experience it and see how your body responds. Shall we do that?" },
  { id: "c4", category: "close", prompt: "Callback offer (need to think)", answer: "Even if you want to have a think about it, would it help if I sent over a bit of information by email in the meantime? And I can give you a ring in a day or two if you have any questions." },
  // OBJECTIONS
  { id: "obj1", category: "objection", prompt: "Objection: 'It's expensive'", answer: "I completely understand — it's an investment. The reason people commit is because they've usually been spending money on things that help a bit but not enough. Can I ask — roughly how much have you spent on physio / medication over the last year?" },
  { id: "obj2", category: "objection", prompt: "Objection: 'Will it work for me?'", answer: "That's a completely fair question — and honestly, I'd be cautious if we claimed it worked for everyone. For people with [their condition], the results we see are [specific outcome]. It works on the biology, not just the symptom." },
  { id: "obj3", category: "objection", prompt: "Objection: 'I'm busy'", answer: "I hear that a lot — and it's often why people put it off longer than they should. Infrared is 12 minutes. PEMF is 25–30. Even HBOT is the most forced rest most people get in their week. What days work best for you?" },
  { id: "obj4", category: "objection", prompt: "Objection: 'Is it scientifically proven?'", answer: "Completely fair to ask. HBOT has been used clinically for decades. PEMF is FDA-cleared for bone healing. Infrared has a strong research base in pain management. These aren't new or untested — just not widely talked about yet." },
  { id: "obj5", category: "objection", prompt: "Objection: 'Let me think about it'", answer: "Of course — this isn't something you need to decide on the spot. Can I ask — is there a specific part of it you're unsure about? Sometimes it helps to talk through whatever's making you hesitate." },
  // CONDITIONS
  { id: "co1", category: "condition", prompt: "Pelvic floor / bladder leakage — recommend?", answer: "PEMF. Lead line: 'PEMF restores pelvic floor tone through electromagnetic stimulation — fully clothed, completely private.'" },
  { id: "co2", category: "condition", prompt: "Long COVID / post-viral fatigue — recommend?", answer: "HBOT. Lead line: 'HBOT has the strongest evidence base for post-viral fatigue — it addresses the neuroinflammation and cellular energy deficit.'" },
  { id: "co3", category: "condition", prompt: "Osteoporosis — recommend?", answer: "PEMF. Lead line: 'PEMF is FDA-cleared for bone stimulation — it activates osteoblasts, the cells that lay down new bone.'" },
  { id: "co4", category: "condition", prompt: "Chronic back pain — recommend?", answer: "PEMF + Infrared (+ Massage). 'PEMF calms the nerve. Infrared releases the deep muscle tissue. Massage releases the muscle holding it in place.'" },
  { id: "co5", category: "condition", prompt: "Psoriasis / eczema — recommend?", answer: "Infrared (+ PEMF). 'Infrared reaches the dermal layer — 3 to 4cm below the skin — where the inflammation actually is.'" },
  { id: "co6", category: "condition", prompt: "Diabetic wound not healing — recommend?", answer: "HBOT + Infrared. 'HBOT super-oxygenates poorly perfused tissue — one of the most evidence-backed tools for wound closure.'" },
  { id: "co7", category: "condition", prompt: "Post-knee-replacement (>2 weeks) — recommend?", answer: "HBOT + Infrared. 'HBOT accelerates tissue healing at the cellular level — it's used in post-surgical recovery specifically.'" },
  { id: "co8", category: "condition", prompt: "Brain fog / memory — recommend?", answer: "HBOT + PEMF. 'HBOT increases oxygen to brain tissue. PEMF stimulates neural circuit function. Both address it from different angles.'" },
];

/* ----------------------------------------------------------------------- */
/*  ROLEPLAY SCENARIOS                                                      */
/* ----------------------------------------------------------------------- */

export const ROLEPLAYS: RoleplayScenario[] = [
  {
    id: "fb-skin",
    title: "Facebook lead — psoriasis enquiry",
    setup: "A FB lead came in via the skin/eczema ad. Female, 40s, didn't answer the first call. You're calling back 3 hours later.",
    difficulty: "easy",
    start: "n1",
    nodes: {
      n1: {
        narrator: "Caller picks up on the second ring.",
        caller: "Hello?",
        choices: [
          { label: "A", text: "Hi Sarah, it's Megan from Renova in Clonmel. You came across one of our ads on Facebook about skin conditions and left your details — I just wanted to give you a quick call to see if there's anything we might be able to help with. Is now an okay time?", next: "n2", tag: "best" },
          { label: "B", text: "Hi Sarah, calling about the booking enquiry — when can you come in?", next: "nBad1", tag: "bad" },
          { label: "C", text: "Hi, this is Megan from Renova. We've got an amazing offer on infrared therapy right now — would you like to hear about it?", next: "nBad1", tag: "bad" },
        ],
      },
      nBad1: {
        narrator: "Sarah goes quiet. She sounds confused or a bit cold.",
        caller: "Sorry, where did you say you got my number?",
        choices: [
          { label: "A", text: "Totally understand — you may have seen one of our Facebook ads about skin conditions like psoriasis and eczema, and filled in a short form. Your details came through to us. No worries at all if it's not the right time — but can I ask, is that something you've been looking into at all?", next: "n2", tag: "best" },
          { label: "B", text: "You signed up — it's on our system.", next: "nFail", tag: "bad" },
        ],
      },
      n2: {
        caller: "Oh right — yeah, I did see something about psoriasis. I've had it on my elbows and scalp for years, nothing really shifts it.",
        choices: [
          { label: "A", text: "I'm really glad you reached out. Before I tell you what we can do — can I ask, how long have you been dealing with it, and what have you tried so far?", next: "n3", tag: "best" },
          { label: "B", text: "Great — so we have a 5-pack of infrared for €225 right now, would you like to book in?", next: "nBad2", tag: "bad" },
          { label: "C", text: "Perfect, infrared light therapy is the answer. It reaches 3 to 4cm below the skin surface.", next: "n3ok", tag: "ok" },
        ],
      },
      nBad2: {
        narrator: "Sarah goes a little quiet — she feels pitched.",
        caller: "Oh, I was really just looking for information first…",
        choices: [
          { label: "A", text: "Sorry, that was me jumping ahead. Can I rewind and ask you a bit more about what's been going on — how long have you been dealing with it?", next: "n3", tag: "best" },
          { label: "B", text: "No problem — I'll send you a brochure. Bye.", next: "nFail", tag: "bad" },
        ],
      },
      n3: {
        caller: "It's been about 15 years on and off. I've tried steroid creams, coal tar, even some private dermatology — it calms down but it always comes back. It's worst on my elbows and scalp. Affects what I wear in summer.",
        choices: [
          { label: "A", text: "That makes complete sense — psoriasis is so common and most people we see have been through that same loop. What we use is infrared bed therapy — it's a gentle light that penetrates 3 to 4 centimetres below the skin, working in the dermal layer where the inflammation actually lives. It's not just surface heat. We've had really good results with clients with long-standing psoriasis.", next: "n4", tag: "best" },
          { label: "B", text: "OK, so the price for 10 sessions is €400 — that's discounted from €450 — when can you come in?", next: "nBad2", tag: "bad" },
        ],
      },
      n3ok: {
        caller: "Hmm OK — but I don't want to waste my money if it's not going to do anything.",
        choices: [
          { label: "A", text: "That's a completely fair concern. The reason it works for skin like yours is it reaches the dermal layer — the cellular level where the inflammation lives. It's not a guarantee, but for people with long-standing psoriasis, we typically see softening and reduced flare-ups by sessions 3 to 5. Can I ask what you've tried so far?", next: "n3", tag: "ok" },
          { label: "B", text: "I'll knock 10% off if you book now.", next: "nFail", tag: "bad" },
        ],
      },
      n4: {
        caller: "OK… and how long are the sessions? I'm working full-time so I can't really do long appointments.",
        choices: [
          { label: "A", text: "That's actually the good news — infrared sessions are 12 minutes. You can fit it in on a lunch break easy. Most people start with a 5- or 10-session course — the 10-pack is where you really see the result settle in. Would you like me to talk you through the options?", next: "n5", tag: "best" },
          { label: "B", text: "About 50–60 minutes — same as our HBOT.", next: "nFail", tag: "bad" },
        ],
      },
      n5: {
        caller: "Yeah, go on…",
        choices: [
          { label: "A", text: "So a 5-session block is €225 (down from €250) and the 10-session is €400 (down from €450). For someone with long-standing psoriasis I'd honestly suggest the 10-pack — that's where we see real change. The easiest thing to do would be to get your first session in the diary — we've got Tuesday or Thursday this week. Which works better?", next: "nWin", tag: "best" },
          { label: "B", text: "Well, the price is €400 for 10 but it's a lot of money, isn't it? You could just try one and see…", next: "nPartial", tag: "bad" },
        ],
      },
      nPartial: {
        caller: "Yeah… I'll think about it.",
        end: { result: "partial", feedback: "You apologised for the price and undermined the value. They booked nothing. Never apologise for the price — state it confidently and propose the next step." },
      },
      nWin: {
        caller: "Tuesday after work — say 6pm if that works?",
        end: { result: "success", feedback: "Excellent. Warm opening, full discovery, validation, mechanism-anchored education, two-option close with confident pricing. Confirm the time, what to wear ('comfortable clothes, well-hydrated'), and end warmly." },
      },
      nFail: {
        end: { result: "fail", feedback: "Trust evaporated. Common causes: jumping to price too early, sounding scripted, undermining value, or discounting reflexively. Rewind — try again with discovery before recommendation." },
      },
    },
  },
  {
    id: "fb-pelvic",
    title: "Facebook lead — pelvic floor (sensitive)",
    setup: "A FB lead came in via the pelvic floor / PEMF ad. Female, late 50s. She sounds nervous.",
    difficulty: "medium",
    start: "n1",
    nodes: {
      n1: {
        narrator: "Caller answers, voice slightly hushed.",
        caller: "Hello? Yes, this is Mary…",
        choices: [
          { label: "A", text: "Hi Mary, it's Megan from Renova in Clonmel. You came across one of our ads on Facebook recently — I just wanted to give you a quick call. Is now an okay time?", next: "n2", tag: "best" },
          { label: "B", text: "Hi Mary, calling about your incontinence enquiry — when can you come in?", next: "nFail", tag: "bad" },
        ],
      },
      n2: {
        caller: "Um… yes, I think I clicked something about… pelvic… I'm not sure exactly. I'm in work, can you keep it quick?",
        choices: [
          { label: "A", text: "Of course — totally understand. The ad was about pelvic floor therapy using PEMF. It's non-invasive, fully clothed, completely private. This is something we work with a lot — it's more common than most people realise. Would it suit better if I rang you in the evening so we can chat properly?", next: "n3", tag: "best" },
          { label: "B", text: "It's PEMF therapy for incontinence — it's a chair you sit on. Want to book in?", next: "nBad1", tag: "bad" },
          { label: "C", text: "OK, well — quickly — how bad is the leakage? Daily?", next: "nBad1", tag: "bad" },
        ],
      },
      nBad1: {
        caller: "I'd rather not get into it right now if that's alright.",
        choices: [
          { label: "A", text: "Of course, I'm so sorry — I shouldn't have asked like that. Can I call you back this evening when you have a bit more space? I'll keep it really brief and there's absolutely no pressure.", next: "n3", tag: "ok" },
          { label: "B", text: "OK, well give me a ring if you're interested.", next: "nFail", tag: "bad" },
        ],
      },
      n3: {
        caller: "Yes, that would be better. About 7?",
        narrator: "[Later, 7pm — you call back]",
        choices: [
          { label: "A", text: "Hi Mary, it's Megan again. Thanks for taking the call. Whenever you're ready — tell me a little bit about what's been going on, and what made you click on the ad. Take your time.", next: "n4", tag: "best" },
          { label: "B", text: "Hi Mary, so — about the bladder leakage thing — how long has it been going on?", next: "n4hard", tag: "bad" },
        ],
      },
      n4: {
        caller: "Well… I've had it for about 5 years really, since my second baby. It got worse after the menopause. I leak when I run, when I sneeze sometimes. I've been doing the kegels but they don't really do much. I'm 58 and I just feel like I shouldn't have to put up with this anymore.",
        choices: [
          { label: "A", text: "Mary, you absolutely shouldn't have to put up with it — and what you're describing is so, so common. The good news is PEMF therapy is specifically designed for this. It works by using gentle electromagnetic pulses that stimulate the pelvic floor muscle from outside the body — you stay fully clothed, sit in a chair, it takes about 25 to 30 minutes. The pulses retrain the muscle in a way that exercises alone often can't, especially post-menopause when the tissue itself has thinned.", next: "n5", tag: "best" },
          { label: "B", text: "Yeah, that's standard stress incontinence. We have a PEMF package for €270.", next: "nFail", tag: "bad" },
        ],
      },
      n4hard: {
        narrator: "Mary goes quiet for a moment, sounds slightly defensive.",
        caller: "I really don't like that word. Can we not call it that?",
        choices: [
          { label: "A", text: "Mary I'm really sorry — I should have said pelvic health or bladder confidence. Let's start again. How long has it been affecting you?", next: "n4", tag: "ok" },
          { label: "B", text: "OK sorry, but you can see I've got to ask.", next: "nFail", tag: "bad" },
        ],
      },
      n5: {
        caller: "And it actually works? I've seen so many things online…",
        choices: [
          { label: "A", text: "That's such a fair question. PEMF is FDA-cleared for pelvic floor — it's not new or untested. Most of our clients see noticeable improvement by session 3 or 4, and the full course of 10 is where we see the long-term retraining stick. It's the closest thing to physio for the inside of the muscle. Would you like me to talk you through the options?", next: "n6", tag: "best" },
          { label: "B", text: "Yes — definitely. Trust me.", next: "n6", tag: "ok" },
        ],
      },
      n6: {
        caller: "Yes please.",
        choices: [
          { label: "A", text: "A 5-session block is €270 and the 10 is €500. For your situation — long-standing, post-menopausal — I'd really suggest the 10-pack. That gives the muscle proper time to retrain. The easiest thing is to get your first session in the diary so you can experience it. Would Tuesday morning or Friday afternoon suit you?", next: "nWin", tag: "best" },
          { label: "B", text: "Look, normally it's €270 for 5 sessions but if you book today I'll do it for €240, OK?", next: "nFail", tag: "bad" },
        ],
      },
      nWin: {
        caller: "Friday afternoon — 3 o'clock?",
        end: { result: "success", feedback: "Beautifully done. You moved the call to a private time, used 'pelvic health' language, gave the mechanism, anchored credibility (FDA-cleared), and closed with two options confidently. Confirm clothing ('come as you are, you stay fully clothed') and what to expect at reception." },
      },
      nFail: {
        end: { result: "fail", feedback: "On sensitive topics, language is everything. 'Bladder confidence', 'pelvic health' — never 'incontinence'. Never discount reflexively. Slow down, give the caller dignity, then mechanism + credibility." },
      },
    },
  },
  {
    id: "objection-price",
    title: "The 'it's a bit expensive' caller",
    setup: "Mid-call. You've recommended a 10-pack of HBOT (€800) for a post-COVID fatigue caller. He's hesitating.",
    difficulty: "medium",
    start: "n1",
    nodes: {
      n1: {
        caller: "€800 — that's… a bit expensive, isn't it? I wasn't expecting that.",
        choices: [
          { label: "A", text: "I completely understand — it is an investment. The reason people commit is because they've usually been spending money on things that help a bit but not enough. Can I ask — roughly how much have you spent on things like physio, supplements, GP visits for this over the last year?", next: "n2", tag: "best" },
          { label: "B", text: "OK — I can do 10% off if you book today, so €720.", next: "nFail", tag: "bad" },
          { label: "C", text: "Yeah it's pretty pricey but it really works.", next: "nFail", tag: "bad" },
        ],
      },
      n2: {
        caller: "Hmm… probably €600 on physio, the GP visits and bloods were maybe another €400, and supplements every month — probably another €500-something. So… more than €800 already this year, I suppose.",
        choices: [
          { label: "A", text: "And you're saying those have helped a bit but you're still not back to where you were before COVID. That's exactly why people end up here. €800 isn't a one-off — it's an investment in the actual mechanism behind why your energy is low. The reason HBOT works for post-COVID is it addresses the neuroinflammation and cellular oxygen deficit directly. Would the 5-pack be a better starting point if the 10 feels like a lot at once?", next: "n3", tag: "best" },
          { label: "B", text: "Exactly — so it's actually cheaper.", next: "n3ok", tag: "ok" },
        ],
      },
      n3: {
        caller: "Maybe — the 5-pack is what?",
        choices: [
          { label: "A", text: "€400, down from €600. It gives your body enough time to respond and tell you whether it's working. Most people have their answer within 3 sessions. If it's helping, you can roll into a follow-up block — and we credit you for the difference if you commit to the 10 before session 5. The easiest thing is to get your first session in the diary — we've got Wednesday morning or Friday afternoon. Which works better?", next: "nWin", tag: "best" },
          { label: "B", text: "€400 but the 10 is much better value really.", next: "nPartial", tag: "ok" },
        ],
      },
      n3ok: {
        caller: "I'd still want to start with the 5 just to see.",
        choices: [
          { label: "A", text: "Completely understandable — that's exactly what the 5-pack is designed for. €400, 5 sessions, you'll know by session 3 whether it's working. Want me to get your first session booked? We have Wednesday or Friday this week.", next: "nWin", tag: "best" },
          { label: "B", text: "OK well let me know.", next: "nFail", tag: "bad" },
        ],
      },
      nWin: {
        caller: "Friday — yeah, let's do it.",
        end: { result: "success", feedback: "Strong objection handling. You acknowledged, invited him to maths what he's already spent, anchored mechanism (neuroinflammation), de-risked with the 5-pack, and closed with two options. Confirm the time, what to wear, and send a reminder text." },
      },
      nPartial: {
        caller: "OK… I'll have a think.",
        end: { result: "partial", feedback: "Almost — you trailed off into 'better value really' instead of proposing the next step. Once you've offered the 5-pack as the lower-risk entry, ask for the booking immediately ('Want to grab a slot Wednesday or Friday?')." },
      },
      nFail: {
        end: { result: "fail", feedback: "Two classic mistakes: reflexive discount, and weak language ('pretty pricey'). On price: never apologise, never discount before they object further. Invite them to maths what they've already spent." },
      },
    },
  },
  {
    id: "post-op",
    title: "Post-knee-replacement caller",
    setup: "Inbound call. Male, 60s, had a knee replacement 5 weeks ago. Recovery is slow.",
    difficulty: "easy",
    start: "n1",
    nodes: {
      n1: {
        caller: "Hi — yes — I saw something on Facebook about HBOT for recovery? I had a knee replacement 5 weeks ago and I'm not progressing as fast as I'd hoped.",
        choices: [
          { label: "A", text: "Hi there — thanks so much for calling. Sorry to hear the recovery's been slow. Tell me a bit more — what's the physio saying, and what specifically is bothering you — swelling, range of movement, pain?", next: "n2", tag: "best" },
          { label: "B", text: "Great — HBOT is brilliant for that. We can get you in this week. €800 for 10 sessions.", next: "nBad", tag: "bad" },
        ],
      },
      n2: {
        caller: "Range of movement is the worst — physio's a bit worried I'm stiff. Swelling is OK now, pain manageable. I'm just slow to bend it.",
        choices: [
          { label: "A", text: "That makes complete sense post-knee-replacement, especially at 5 weeks. The tissue around the joint is still healing and the cells aren't getting enough oxygen to repair quickly enough — that's the bit HBOT addresses directly. We've had really good results with post-surgical clients on exactly this. Has your surgeon given you the all-clear to add complementary therapy?", next: "n3", tag: "best" },
          { label: "B", text: "Don't worry — HBOT will fix it.", next: "nBad2", tag: "bad" },
        ],
      },
      n3: {
        caller: "Yeah, the surgeon said anything non-invasive is fine.",
        choices: [
          { label: "A", text: "Perfect. So what we'd typically do is a course of 10 HBOT sessions — that's where we see the real acceleration in soft-tissue healing — and pair it with infrared for the joint itself. HBOT is 50–60 minutes, infrared is just 12. Would you like me to talk you through how that looks?", next: "n4", tag: "best" },
          { label: "B", text: "Cool — I'll book you in for 10 HBOT sessions, see you Tuesday.", next: "n4ok", tag: "ok" },
        ],
      },
      n4: {
        caller: "Yes — what's the cost?",
        choices: [
          { label: "A", text: "10 HBOT sessions is €800, currently discounted from €1,200. Many post-op clients add a 5-pack of infrared as well — that's €225 — and we'd recommend starting both in the same week so they work together. The easiest first step is to get your first HBOT session in the diary. We've got Tuesday at 10am or Thursday at 4pm — which suits?", next: "nWin", tag: "best" },
          { label: "B", text: "It's €800 — sorry, it's not cheap.", next: "nPartial", tag: "bad" },
        ],
      },
      n4ok: {
        caller: "OK… what about price?",
        choices: [
          { label: "A", text: "10 HBOT sessions is €800 — that's discounted from €1,200. Most post-op clients also add a 5-pack of infrared. The first session is the easiest place to start — we have Tuesday or Thursday this week.", next: "nWin", tag: "best" },
        ],
      },
      nPartial: {
        caller: "Hmm. €800 is a lot. I'll think.",
        end: { result: "partial", feedback: "You apologised for the price ('sorry, it's not cheap'). Don't. State it confidently and propose the next step. Try again." },
      },
      nWin: {
        caller: "Tuesday 10am works.",
        end: { result: "success", feedback: "Textbook. Discovery first, validated the specific problem (range of movement), linked the mechanism (oxygen to healing tissue), checked surgeon clearance, then closed with two specific time options. Confirm the time and tell him: comfortable clothes, well-hydrated, no perfumes or oily products before HBOT." },
      },
      nBad: {
        end: { result: "fail", feedback: "You jumped straight to price without any discovery. The caller has no reason yet to commit. Always discover first — what specifically is bothering them, what the surgeon has said, where they are in recovery." },
      },
      nBad2: {
        end: { result: "fail", feedback: "Never say 'HBOT will fix it' for a medical condition. We support and complement — we don't treat. Phrase it as: 'HBOT accelerates the tissue-healing process post-surgery.'" },
      },
    },
  },
  {
    id: "sceptic",
    title: "The sceptical caller",
    setup: "FB lead, female, 40s. Pain enquiry. First minute in. She sounds guarded.",
    difficulty: "hard",
    start: "n1",
    nodes: {
      n1: {
        caller: "Look, honestly, I clicked on that ad on a whim. I'm pretty cynical about this kind of stuff. Is this actually proven, or is it another wellness fad?",
        choices: [
          { label: "A", text: "Completely fair to ask — I'd ask the same. HBOT has been used in clinical medicine for decades for wound healing, post-surgical recovery, radiation injury. PEMF is FDA-cleared specifically for bone healing. Infrared has a strong research base in pain management and tissue repair. These aren't new or untested — they're just not widely talked about in the mainstream. Can I ask what you're dealing with that made you click?", next: "n2", tag: "best" },
          { label: "B", text: "Yes — 100% proven. Don't worry.", next: "nFail", tag: "bad" },
          { label: "C", text: "It works for some people — I can send you our brochure?", next: "nFail", tag: "bad" },
        ],
      },
      n2: {
        caller: "Chronic back pain. Five years. Had physio, MRI, the lot. Disc bulge, nothing surgical they say.",
        choices: [
          { label: "A", text: "That makes complete sense — and a disc-related back issue is exactly the kind of thing where physio gets you partway but doesn't change the actual nerve or tissue environment. For your situation we typically combine PEMF — which calms the nerve and FDA-cleared for nerve and tissue work — with infrared to release the deep muscle around it, and often massage as well. It's not a guarantee but the mechanism actually targets your specific issue.", next: "n3", tag: "best" },
          { label: "B", text: "Great — €500 for 10 PEMF sessions, can you come in Friday?", next: "nBad", tag: "bad" },
        ],
      },
      n3: {
        caller: "OK, that actually makes more sense than I expected. What about evidence? Can I read anything?",
        choices: [
          { label: "A", text: "Yes — I can send you a short summary by email with a couple of the key references for PEMF in nerve pain and infrared in chronic back pain. And of course you're always welcome to speak to your GP about it. No pressure at all on the call. Would you like me to send that over now and ring you back in a day or two?", next: "n4", tag: "best" },
          { label: "B", text: "Just trust me on this one — it works.", next: "nFail", tag: "bad" },
        ],
      },
      n4: {
        caller: "Yes please — and you can call me Thursday.",
        end: { result: "success", feedback: "Sceptics need credibility, not enthusiasm. You validated the question, anchored evidence (FDA-cleared, decades of clinical use), linked the mechanism to her specific case (disc → nerve/tissue), offered written info, and didn't push for the booking. The follow-up is the close." },
      },
      nBad: {
        end: { result: "fail", feedback: "Hard pivot to price kills sceptics. They need information first — credible mechanism, real evidence, low-pressure follow-up. Try again." },
      },
      nFail: {
        end: { result: "fail", feedback: "'Trust me' is the worst phrase you can use with a sceptic. Anchor real credibility points (FDA-cleared, clinical use, peer-reviewed research) and offer written information they can verify themselves." },
      },
    },
  },
  {
    id: "let-me-think",
    title: "The 'let me think about it' caller",
    setup: "End of call. You've done discovery and education well. They're at the close.",
    difficulty: "medium",
    start: "n1",
    nodes: {
      n1: {
        caller: "OK… I think I'd just like to think about it for a few days. I'll let you know.",
        choices: [
          { label: "A", text: "Of course — this isn't something you need to decide on the spot. Can I just ask — is there a specific part of it you're unsure about? Sometimes there's something simple I can answer that makes the decision easier.", next: "n2", tag: "best" },
          { label: "B", text: "OK — call me back if you're interested. Bye.", next: "nFail", tag: "bad" },
          { label: "C", text: "Look, if you book today I can give you 10% off.", next: "nFail", tag: "bad" },
        ],
      },
      n2: {
        caller: "Honestly? I think it's the cost. And whether I can really commit to coming in regularly with my schedule.",
        choices: [
          { label: "A", text: "Both completely fair. On the cost — that's exactly why we have a 5-session option, so people can test it without going all-in. And on the schedule — sessions are 25 to 30 minutes for PEMF, so they fit lunch breaks easily. Would it help if I sent you a quick summary by email and rang you in a couple of days when you've had a chance to think? No pressure at all.", next: "n3", tag: "best" },
          { label: "B", text: "OK so the 5-pack is €270 — much easier?", next: "n3ok", tag: "ok" },
        ],
      },
      n3: {
        caller: "Yes — please send the email. Wednesday for a follow-up call?",
        end: { result: "success", feedback: "Exactly right. Acknowledge, diagnose the real concern, address each one briefly, offer a soft follow-up. Sometimes the right close is the next call, not this one. Now: send a tight email today, ring Wednesday, don't lead with price." },
      },
      n3ok: {
        caller: "Yeah maybe… still want to think.",
        end: { result: "partial", feedback: "You jumped to price before addressing both her concerns (cost AND schedule). Address the surface concern but also de-risk: 'It fits lunch breaks.' Then offer the soft follow-up." },
      },
      nFail: {
        end: { result: "fail", feedback: "Two cardinal sins: letting them go without a follow-up, or discounting reflexively. A 'no' today isn't forever — always leave the call with a follow-up agreed." },
      },
    },
  },
];

/* ----------------------------------------------------------------------- */
/*  CONDITION CATEGORIES — derived helper                                   */
/* ----------------------------------------------------------------------- */

export const CONDITION_CATEGORIES = Array.from(
  new Set(CONDITIONS.map((c) => c.category)),
);
