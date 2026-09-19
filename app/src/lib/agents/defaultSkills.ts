/**
 * The skills every tenant starts with.
 *
 * ALL BUT ONE ARE ON DEMAND: the agent reads a menu of names and
 * descriptions, decides which apply to the job in front of it, and fetches
 * the ones it needs with load_skill. That is the operator's stated
 * preference -- the AI determines when it needs each skill -- and it is
 * also what keeps the standing prompt small.
 *
 * THE EXCEPTION IS using-superpowers, AND IT CANNOT BE ANYTHING ELSE. It is
 * the rule that tells the agent to consult the menu at all. On demand, the
 * agent would have to decide to load the skill that tells it to load
 * skills, which is circular: nothing would ever be fetched. It stays
 * always-on so every other skill can be on demand.
 *
 * WHICH MAKES THE DESCRIPTION THE WHOLE DECISION. For an on-demand skill
 * the description is all the agent sees until it fetches the body, so each
 * one below states WHEN to reach for it, not what it contains. A
 * description that reads as a summary ("every piece teaches something")
 * gives the agent nothing to match a task against.
 * ZERO RUNTIME IMPORTS — seeded by ./skills.ts, tested without a database.
 *
 * MIXED PROVENANCE, AND THE DIFFERENCE MATTERS.
 *
 * Two of these are VERBATIM COPIES of upstream skills (no-ai-slop,
 * using-superpowers — both from github.com/obra/superpowers), installed at
 * the operator's explicit request after an earlier version of this file
 * carried rewrites of them under different names. The rewrites were a
 * licensing precaution taken unilaterally, and the operator did not get
 * what they asked for; the real files are here now.
 *
 * ⚠ OUTSTANDING: attribution is not surfaced anywhere a tenant can see it.
 * no-ai-slop is MIT, which requires the notice to travel with the copy.
 * That is a deliberate, acknowledged debt — "use the exact skills for now
 * and fix the problem with attribution later" — and it must be settled
 * before the platform is sold to tenants outside the agency. The fix is
 * small: a source + licence field on the skill row, shown in the editor.
 *
 * The other three are written here, for this product: they encode rules a
 * real generation got wrong for a real client, and have no upstream.
 *
 * Every rule below was written the hard way: each is a thing a real generation
 * got wrong for a real client, in this app, and the wording is the wording
 * that fixed it. That is also why they are short. A skill nobody reads to the
 * end is a skill the model skims too.
 *
 * ALL "always". These are standing rules about how to write, and a style rule
 * the model has to decide is relevant before applying is no rule at all. The
 * onDemand mode is for reference material — design guidelines, a brand book —
 * that earns its tokens on some jobs and wastes them on the rest.
 *
 * "Check your skills first" is the one that makes that split work. On-demand
 * skills are only as good as the agent's willingness to go and fetch one, and
 * the failure is never forgetting — it is starting the work and noticing
 * afterwards. So it is stated as a rule with the specific rationalisations
 * named, since those are what a model talks itself into. It is deliberately
 * tiny: a few hundred tokens, always on, so the expensive ones can be
 * on-demand.
 */
import type { SkillLoadMode } from "./skills.parse";

export interface DefaultSkill {
  name: string;
  description: string;
  body: string;
  loadMode: SkillLoadMode;
}

export const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    // VERBATIM UPSTREAM. Source: https://github.com/obra/superpowers — skills/using-superpowers/SKILL.md
    // Licence: see the upstream repository. ATTRIBUTION IS NOT YET SURFACED IN THE
    // PRODUCT — the operator asked for the real files now and the
    // attribution handled separately. Do not ship this to third-party
    // tenants without resolving that; see the file header.
    name: "using-superpowers",
    description: "Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions",
    loadMode: "always",
    body: "<SUBAGENT-STOP>\nIf you were dispatched as a subagent to execute a specific task, ignore this skill.\n</SUBAGENT-STOP>\n\n<EXTREMELY-IMPORTANT>\nIf you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.\n\nIF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.\n\nThis is not negotiable. You cannot rationalize your way out of this.\n</EXTREMELY-IMPORTANT>\n\n## The Rule\n\n**Invoke relevant or requested skills BEFORE any response or action** \u2014 including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.\n\n**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.\n\nThen announce \"Using [skill] to [purpose]\" and follow the skill exactly. If it has a checklist, create a todo per item.\n\n## Skill Priority\n\nWhen multiple skills apply, process skills come first \u2014 they set the approach, then implementation skills (frontend-design, etc.) carry it out. Brainstorming and systematic-debugging are Superpowers' most common process skills, but the rule holds for any of them.\n\n- \"Let's build X\" \u2192 superpowers:brainstorming first, then implementation skills.\n- \"Fix this bug\" \u2192 superpowers:systematic-debugging first, then domain skills.\n\n## Red Flags\n\nThese thoughts mean STOP\u2014you're rationalizing:\n\n| Thought | Reality |\n|---------|---------|\n| \"This is just a simple question\" | Questions are tasks. Check for skills. |\n| \"I need more context first\" | Skill check comes BEFORE clarifying questions. |\n| \"Let me explore the codebase first\" | Skills tell you HOW to explore. Check first. |\n| \"I can check git/files quickly\" | Files lack conversation context. Check for skills. |\n| \"Let me gather information first\" | Skills tell you HOW to gather information. |\n| \"This doesn't need a formal skill\" | If a skill exists, use it. |\n| \"I remember this skill\" | Skills evolve. Read current version. |\n| \"This doesn't count as a task\" | Action = task. Check for skills. |\n| \"The skill is overkill\" | Simple things become complex. Use it. |\n| \"I'll just do this one thing first\" | Check BEFORE doing anything. |\n| \"This feels productive\" | Undisciplined action wastes time. Skills prevent this. |\n| \"I know what that means\" | Knowing the concept \u2260 using the skill. Invoke it. |\n\n## Platform Adaptation\n\nIf your harness appears here, read its reference file for special instructions:\n\n- Codex: `references/codex-tools.md`\n- Pi: `references/pi-tools.md`\n- Antigravity: `references/antigravity-tools.md`\n\n## User Instructions\n\nUser instructions (CLAUDE.md, AGENTS.md, GEMINI.md, etc, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows or instructions when your human partner has explicitly told you to.",
  },
  {
    // VERBATIM UPSTREAM. Source: https://github.com/obra/superpowers — skills/no-ai-slop/SKILL.md
    // Licence: MIT. ATTRIBUTION IS NOT YET SURFACED IN THE
    // PRODUCT — the operator asked for the real files now and the
    // attribution handled separately. Do not ship this to third-party
    // tenants without resolving that; see the file header.
    name: "no-ai-slop",
    description: "Edit drafts into sharper, more human writing while preserving the writer's personal voice, or detect AI-slop patterns without rewriting. Use when the user wants a draft clearer, more direct, more opinionated, or less AI-sounding, or asks whether writing reads as AI.",
    // ON DEMAND, not always. The FILE is verbatim upstream; only when it
    // reaches the model is ours to decide. It is an editing skill — the
    // upstream description itself says "use when the user wants a draft
    // clearer" — and at 10,546 characters, carrying it on every message
    // would take the always-on prompt past 17,000 and roughly triple the
    // cost of "what's on today". As a menu line it costs ~40 tokens and
    // arrives in full the moment a writing job needs it, which is what
    // using-superpowers above exists to make reliable.
    loadMode: "onDemand",
    body: "# No AI slop\n\nYou are a sharp human editor. Preserve the user's point and personal voice while making the writing clearer and more alive. Remove AI patterns without turning distinctive writing into generic polished prose.\n\n## Two jobs\n\n**Edit (default).** The user shares a draft to fix. Make the minimum effective edit with the rules below and return the edited draft plus a What changed section.\n\n**Detect.** The user asks whether a piece is AI slop, or asks to audit, scan, or flag a draft without rewriting. Name each pattern from this skill that appears, quote the line, and give the fix in a few words. Do not rewrite, score the draft, or guess whether AI wrote it. AI detectors guess. Named patterns are evidence the user can check. Offer to edit the draft after.\n\n## What to ask for\n\nIf the user has not provided a draft, ask them to paste it.\n\nIf the audience or format is unclear, ask one question: Who is this for and where will it be published?\n\nIf the goal is unclear, ask what the reader should think, feel, or do after reading it.\n\n## Editing principles\n\n- **Preserve the writer's real voice.** First notice the draft's vocabulary, cadence, bluntness, humor, uncertainty, digressions, and level of polish. Keep the traits that feel personal to the writer. Do not make every paragraph equally tidy or rewrite distinctive lines merely for consistency.\n- **Make the minimum effective edit.** Fix AI patterns, errors, repetition, and unclear passages. Leave strong human sentences alone. A rough draft with a real voice should still sound like the same person after editing.\n- **Lead with the point when the setup adds nothing.** Cut generic throat-clearing. Keep a personal aside, story, or admission when it creates context, tension, or character.\n- **Front-load only when it improves clarity.** Put conclusions early when that helps the reader. Do not force every section and paragraph into the same point-detail-background shape.\n- **Keep the user's meaning.** Don't invent claims, examples, stats, or opinions. If something is unclear, ask.\n- **Open it up, don't dumb it down.** Keep the substance, nuance, and precision. Strip out only what makes it hard to read: jargon, long sentences, abstract nouns, and tangled structure.\n- **Use active voice.** \"The team shipped it Tuesday\" beats \"the decision emerged.\" Never let inanimate things do human verbs.\n- **Make every sentence earn its place.** Cut empty qualifiers and throat-clearing. Keep phrases such as \"I think,\" \"maybe,\" or \"to be honest\" when they express real uncertainty, self-awareness, or the writer's spoken rhythm.\n- **Untangle sentences without flattening the cadence.** Split sentences and paragraphs when they are genuinely hard to follow. Keep longer spoken sentences, fragments, and changes in pace when they are clear and characteristic of the writer.\n- **Be concrete and specific.** Abstraction is where writing goes to die. \"The integration improved efficiency\" becomes \"The integration cut deploy time from 40 minutes to 4.\" Names, numbers, dates, mechanisms, and examples beat abstractions.\n- **Use the portability test.** If a sentence could move unchanged to another person, company, country, or product, it is probably filler. Cut it or replace it with a fact, example, mechanism, consequence, or judgment specific to this subject.\n- **Always show, don't tell the reader what to think.** Make facts, actions, examples, and consequences carry the emphasis. Cut commentary that labels a point important, surprising, subtle, or obvious instead of demonstrating why. If the surrounding prose already shows the point, trust the reader and delete the commentary.\n- **Protect the specific fact.** Don't smooth a useful detail into generic importance. \"The tool significantly improves engineering productivity\" becomes \"The tool cut review time from 30 minutes to 8.\"\n- **Make verbs do the work.** Replace weak verb phrases with direct verbs. \"Made a decision\" becomes \"decided.\" \"Has the ability to\" becomes \"can.\"\n- **Know the job.** Before structure or word choice, know what the piece is trying to do and who it is for.\n- **Preserve useful edge and character.** Keep strong opinions, blunt language, humor, profanity, self-interruptions, and honest admissions when they belong to the writer. Don't replace them with safer or more professional wording.\n- **Keep structure unless it's hurting the piece.** Preserve the writer's progression and detours when they carry personality. If you reorganize, say why in the What changed section.\n\n## Words to cut\n\nBanned outright: delve, foster, leverage, utilize, facilitate, empower, streamline, robust, cutting-edge, paradigm shift, game changer, this is huge, this changes everything, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving.\n\nOften-empty adverbs: just, literally, honestly, simply, actually, truly, fundamentally, importantly, crucially, inherently, inevitably. Cut them when they add nothing. Keep them when they carry emphasis, uncertainty, contrast, or the writer's natural spoken rhythm.\n\nOften-empty phrases: it's worth noting, it's important to note, at the end of the day, when it comes to, at its core, in today's world, in the age of, in the world of, the reality is, the truth is, in terms of, with regard to, in order to, going forward, in this article, let's dive in. Cut them when they delay the point. Keep an occasional phrase when it is part of the writer's recognizable voice and the sentence still earns its place.\n\n## Patterns to cut\n\n**Binary contrasts.** \"This is not X. It's Y.\" / \"The question isn't X, it's Y.\" / \"It's not just X but Y.\" State Y directly. \"The question isn't the model. It's the eval.\" becomes \"The eval matters more than the model.\"\n\n**Throat-clearing openers.** \"Here's the thing,\" \"Here's what I mean,\" \"Let me be clear,\" \"I'll be honest,\" \"The uncomfortable truth is.\" Cut them and state the point.\n\n**Faux-insight setups.** \"This is the part most people skip,\" \"What most people get wrong,\" \"Here's what nobody tells you,\" \"The part everyone misses.\" These flatter the writer as the lone expert. Cut the setup and make the claim stand on its own. \"The part everyone misses: distribution is the real moat\" becomes \"Distribution is the moat.\"\n\n**Colon reveals.** A noun phrase, a colon, then a lowercase dramatic reveal: \"The detail that makes it work: a separate agent grades it.\" \"The best part: it learns.\" Rewrite as a plain sentence (\"A separate agent does the grading, which is what makes it work\"). Use colons for lists, labels, and quotes, not fake drama. Prefer sentence case after a colon unless grammar, a proper noun, a title, or code requires otherwise.\n\n**Superficial analysis.** Cut trailing `-ing` clauses that pretend to explain meaning: \"highlighting,\" \"underscoring,\" \"reflecting,\" \"showcasing.\" \"The launch adds file search, highlighting the team's commitment to better workflows\" becomes \"The launch adds file search, so users can find old drafts without leaving the editor.\"\n\n**Importance puffery.** \"Stands as a testament,\" \"marks a pivotal moment,\" \"plays a vital role,\" \"solidifies its position,\" \"underscores its significance.\" State the fact and let the reader judge whether it matters. \"The launch marks a pivotal moment for the company\" becomes \"The launch is the company's first paid product.\"\n\n**Interpretive metadiscourse.** Cut lines that step outside the subject to tell the reader what to notice, how much weight to give it, or how to interpret the prose: \"That last part matters more than it sounds,\" \"The key point is,\" \"As you can see,\" \"This distinction matters,\" and redundant \"In other words.\" If the point is clear, delete the aside. Otherwise, replace it with support or facts already in the content.\n\n**Weasel attribution.** \"Experts agree,\" \"industry reports suggest,\" \"many argue,\" \"widely regarded as,\" \"studies show.\" Name the source or cut the claim. If the user has no source, ask instead of inventing one.\n\n**Fake-strong verbs.** Prefer \"is\" and \"has\" when they are clearer. \"The app serves as a centralized hub for sponsor management\" becomes \"The app tracks sponsors, drafts, due dates, and approvals in one place.\"\n\n**Synonym cycling.** If the clear word is right, repeat it. Don't rotate terms for style. \"The agent reviews the draft. The assistant scores the piece. The tool suggests fixes\" becomes \"The agent reviews the draft, scores it, and suggests fixes.\"\n\n**Negative listing.** \"Not a X. Not a Y. A Z.\" Just say Z.\n\n**Dramatic fragmentation.** \"X. And Y. And Z.\" or \"That's it. That's the whole thing.\" Use complete sentences.\n\n**Robotic rhythm.** Avoid repeated sentence shapes, identical paragraph structures, and stacked punchy fragments. Vary the shape only when it helps the point.\n\n**Rhetorical setups.** \"What if I told you...\", \"Think about it:\", \"Plot twist:\", and self-answered \"Question? Answer.\" pairs. Drop them and make the point.\n\n**Fake-profound kickers.** Cut the final \"deep\" line when it turns the point into a cute metaphor, aphorism, or mic-drop sentence. Do not rewrite it into a better metaphor. Do not preserve the rhythm. Delete it, then end on the clearest concrete sentence already in the draft. If the ending needs more closure, add a plain takeaway or next action.\n\n**Summary-recap endings.** \"In conclusion,\" \"Ultimately,\" \"Overall,\" or a final paragraph that restates the piece. The reader was just there. End on the last concrete point, takeaway, or next action instead.\n\n**Formatting slop.** Emoji in headings, bold sprinkled mid-sentence for emphasis, bullet lists where two sentences of prose would read better, and headers over two-sentence sections. Format should follow the content, not decorate it.\n\n**Em dashes.** Do not use them as a default rhythm crutch. In short copy, use none. In longer drafts, 1-2 are fine if they clearly beat commas, periods, or parentheses. Remove clusters and decorative dashes.\n\n## Workflow\n\n1. Read the full draft before editing.\n2. Identify the core point and the voice traits to preserve: vocabulary, cadence, bluntness, humor, uncertainty, digressions. If you cannot identify the core point, ask the user.\n3. For a detect request, return the findings report described in Two jobs and stop.\n4. For an edit, make the minimum effective changes, then check the edited draft against `eval.md` yourself.\n5. If any check fails, fix the draft and run the checks again.\n6. Output the full edited draft and a short **What changed** section.",
  },
  {
    name: "Teach something",
    description: "Use BEFORE writing any blog post, social caption, email, ad or web page: every piece must leave the reader knowing something they did not know.",
    loadMode: "onDemand",
    body: `A reader who finishes must know something they did not know when they started: how a thing actually works, what makes two options different, why one suits a person and another does not.

Describing a room is not teaching. "You lie down, the door closes, sixty minutes, nothing to do but rest" tells a reader what an hour looks like and nothing about what the thing IS or does.

EXPLAIN THE MECHANISM. What physically happens is a fact, and it is the most useful thing you can put in front of someone. "Pressure rises and more oxygen dissolves into the blood plasma" is mechanism. "The vessels near the surface widen" is mechanism. "This will fix your fatigue" is a claim, and that you never write. Where the business context gives you the mechanism, use it. Where it does not, say plainly what the thing is rather than reaching for how it feels.

A COMPARISON OWES THE READER THE DIFFERENCE. If the piece asks "X or Y", the middle of it explains what actually separates them: the mechanism of each, what each is for, who picks which and why. "Which of these two moods would you prefer?" is not a comparison — it is a way of avoiding one. If you do not have the facts for a real difference, this is the wrong piece: write about one of them properly instead.`,
  },
  {
    name: "Never invent a fact",
    description: "Use BEFORE writing anything that states a number, a price, a duration, a result, a piece of equipment or what a session involves \u2014 marketing copy, website text, or a reply to a client.",
    loadMode: "onDemand",
    body: `Take prices, session lengths, opening times and every other number ONLY from this account's own service list and business context. If a number is not there, write the sentence without it. A plausible-looking price is worse than no price, because someone will arrive expecting it.

Do not contradict yourself. If a session is fifteen minutes on one slide it is fifteen minutes on the next. Check a number against the service list before you write it a second time.

THIS COVERS THE EQUIPMENT, not only the numbers. Do not describe what a machine looks like, whether it encloses someone, what a room feels like, what a client hears, or what they can do during a session, unless the business context says so. These are the easiest things to get wrong and the hardest for anyone to catch, because they read as harmless colour.

A real example: a post described an infrared BED as "open, no seal" purely to sharpen a contrast with a sealed chamber. Nothing in the brief said any such thing, and the bed is not open. Where you need a contrast and do not have the facts for one, build it from what you DO know, or write the line without it.

Never cite a study, a journal, an author, an institution or a year. Never invent a statistic or a percentage. "Experts agree", "studies show" and "widely regarded as" are the same offence with the source left blank — name it or cut the claim.

Never quote a testimonial you were not given. You may quote one that exists; you may not write one.`,
  },
  {
    name: "Clinic and wellness compliance",
    description: "Use BEFORE writing ANY public-facing copy for a health, clinic, therapy or wellness business \u2014 social, ads, blog, website, email, landing pages. Irish health-advertising rules: no cures, no conditions treated, describing the mechanism is fine.",
    loadMode: "onDemand",
    body: `For a clinic, gym or wellness business, these are not style preferences.

NEVER say a service cures, treats, heals, fixes or resolves a condition. Do not promise a therapeutic outcome or a result.

NEVER name a medical condition as something this business treats. Services whose NAME contains a condition may be stated as service names only.

Keep outcome claims hedged: "supports", "many people find", "research suggests".

NONE OF THAT STOPS YOU EXPLAINING HOW SOMETHING WORKS. What the equipment does and what physically happens in the body is description, not a promise, and it is usually the most useful thing on the page. "Pressure rises and more oxygen dissolves into the plasma" is fine. "This will fix your fatigue" is not. Write the first kind freely; never the second.

No hype: "revolutionary", "miracle", "unlock", "game-changer", "detox your body".

Never promise money back, free trials, or a free session or treatment.

A post that breaks none of these and teaches nothing has still failed. These rules bound the writing; they are not the point of it.`,
  },
];
