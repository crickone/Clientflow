import fs from "node:fs";
const ROOT = "c:/Users/truep/Desktop/Clients/Renova";

const T = {
  H:{name:"HBOT",href:"hbot.html",sub:"Hyperbaric oxygen for recovery, energy & repair."},
  I:{name:"Infrared",href:"infrared.html",sub:"Full-body infrared for recovery & circulation."},
  P:{name:"PEMF",href:"pemf.html",sub:"PEMF & the Emsella chair — recovery, pelvic floor & more."},
};

/* therapies: [code, explanation paragraph, [condition-specific points]] */
const CONDS = {
  "post-surgery-recovery":{
    name:"Post-surgery recovery", category:"Recovery", clinical:true,
    sub:"Support healing after an operation.",
    lead:"Give your body the support it needs to heal, recover and rebuild after surgery — gently, and completely non-invasively.",
    whatIs:"After an operation your body works hard to repair tissue, manage swelling and rebuild strength. The right support can help that natural healing along without adding strain. People use recovery therapy after orthopaedic surgery (knee, hip, shoulder), soft-tissue procedures and C-sections — once their surgeon is happy for them to begin.",
    therapies:[
      ["H","After surgery, healing tissue is hungry for oxygen — yet swelling and reduced blood flow can starve it of exactly what it needs. In the hyperbaric chamber you breathe near-pure oxygen under gentle pressure, dramatically increasing the amount dissolved in your blood and driven deep into the surgical site. That extra oxygen fuels the cells doing the repair work, helps the body manage post-operative swelling, and supports its natural ability to rebuild — which is why HBOT is so widely used to support post-surgical recovery.",
        ["Drives oxygen into tissue where swelling has reduced blood flow","Fuels the cells that rebuild tissue and close wounds","May help with post-operative swelling and bruising"]],
      ["I","Once you're healing, full-body infrared adds gentle, penetrating warmth that lifts circulation around the surgical area. Better blood flow brings nutrients in and helps clear the by-products of healing, while the warmth eases the stiffness and muscle guarding that builds up when you've been protecting a joint or incision. Infrared also supports healthy collagen — which matters for supple, well-formed scar tissue.",
        ["Boosts circulation to nourish healing tissue","Eases stiffness and muscle guarding around the site","Supports healthy collagen for better scar tissue"]],
    ],
    whatToExpect:"We'll always check your surgeon or GP is happy for you to start. Most people begin gently and build over a short course, fitting recovery around how they feel. Sessions are relaxing and non-invasive — many simply rest. (Hands-on massage only once you're fully cleared.)",
    faqs:[["When can I start after surgery?","Once your surgeon or GP is happy for you to begin — we always check first. [confirm typical timing]"],["Is it safe around a healing wound or scar?","Yes — the therapies are non-invasive. We work gently around healing tissue and follow your medical team's guidance."],["How many sessions will I need?","It depends on your procedure and how you're healing; we'll suggest a short course. [confirm]"],["Will it speed up my recovery?","It's designed to support your body's natural healing alongside your medical care — not to replace it."]],
    related:["slow-healing-wounds","arthritis"],
  },
  "arthritis":{
    name:"Arthritis", category:"Pain & joints", clinical:false,
    sub:"Calmer, more comfortable joints.",
    lead:"Ease stiff, aching joints and move more comfortably — with deep, soothing therapies that reach where the discomfort actually is.",
    whatIs:"Arthritis brings stiffness, swelling and aching that can make everyday movement harder — whether it's osteoarthritis 'wear and tear' or an inflammatory type. The goal is the same: calmer joints, easier movement and less day-to-day discomfort, without relying on medication alone.",
    therapies:[
      ["I","Arthritic joints are stiff and sore because inflammation and poor circulation settle deep inside the joint — somewhere a surface heat-pack never reaches. Infrared light penetrates several centimetres, warming the joint from within, opening up local circulation and easing the stiffness that makes movement hard. Many people find a session leaves the joint looser and more comfortable, and a regular rhythm helps keep it that way.",
        ["Deep warmth reaches inside the joint, not just the skin","Improves circulation to stiff, inflamed joints","Eases morning stiffness and improves range of movement"]],
      ["P","Arthritis pain is partly a nerve story — irritated joints keep firing pain signals. PEMF sends gentle pulsed fields through the joint that help calm that nerve excitability, while supporting the health of cartilage and the bone beneath it. What people describe is less of the nagging ache and easier, more confident movement — without medication.",
        ["Calms the nerve signalling behind joint pain","Supports cartilage and the underlying bone","A drug-free way to take the edge off daily aches"]],
      ["H","For inflammatory or whole-body arthritis the issue isn't one joint — it's systemic inflammation. By flooding the body with oxygen, HBOT supports its own anti-inflammatory balance and tissue repair, which can complement infrared and PEMF when arthritis is widespread or flaring.",
        ["Supports the body's whole-body inflammatory balance","Useful when arthritis is widespread or inflammatory","Pairs with infrared and PEMF in a combined plan"]],
    ],
    whatToExpect:"Most people combine infrared and PEMF, often building to a regular rhythm that keeps joints comfortable. Sessions are warm, relaxing and non-invasive. We'll help you find the routine that suits your joints and your week.",
    faqs:[["Which therapy is best for arthritis?","Usually infrared and PEMF together — infrared for deep joint warmth, PEMF for nerve comfort and joint support. We'll tailor it."],["Is it suitable for osteoarthritis and rheumatoid arthritis?","People use it for both. Inflammatory types are supported alongside your GP. [confirm]"],["Will it replace my medication?","No — it's a supportive, non-invasive addition to your care, not a replacement. Always keep your GP in the loop."],["How often should I come?","Many find a regular rhythm works best; we'll recommend a plan. [confirm]"]],
    related:["back-neck-pain","osteoporosis"],
  },
  "back-neck-pain":{
    name:"Chronic back & neck pain", category:"Pain & joints", clinical:false,
    sub:"Ease persistent back & neck pain.",
    lead:"Calm the irritated nerves and release the deep, tight muscle that keeps persistent back and neck pain going.",
    whatIs:"Ongoing back and neck pain — from desk work, old injuries or muscle tension — can wear you down and limit what you do. The aim is to calm the irritated nerves and release the tight, deep muscle that keeps the pain cycle turning.",
    therapies:[
      ["P","Long-standing back and neck pain often becomes a nerve problem as much as a muscle one — the nervous system stays 'switched on' and keeps the pain cycle going. PEMF delivers gentle pulses that help calm that over-excited nerve activity and support the discs, joints and soft tissue around the spine. Over a course of sessions, many people notice the constant background ache begin to settle.",
        ["Calms over-excited nerves that keep pain going","Supports the discs and soft tissue around the spine","Drug-free relief for persistent, nagging pain"]],
      ["I","Tight, deep muscle is usually feeding the problem — and it's hard to reach. Infrared warmth penetrates into those deep layers, relaxing the muscle, boosting circulation and helping release the tension and trigger points that pull on the spine. It pairs naturally with PEMF: infrared loosens the muscle, PEMF settles the nerve.",
        ["Releases deep muscle tension and trigger points","Warms and increases blood flow to stiff areas","Works hand-in-hand with PEMF"]],
    ],
    whatToExpect:"Many people pair PEMF and infrared, often alongside small changes to movement and posture. Sessions are relaxing and non-invasive. We'll build a plan around where your pain is and what sets it off.",
    faqs:[["What causes most chronic back pain?","Often a mix of muscle tension, nerve irritation and posture. Our therapies target the muscle and nerve side. [confirm]"],["Can it help sciatica?","Yes — PEMF for nerve calming and infrared for circulation are commonly used for sciatica and nerve pain."],["How soon might I feel a difference?","Everyone's different; many notice gradual change over a course of sessions. [confirm]"],["Do I need a referral?","No referral needed. If you have a diagnosed spinal condition, we'll work alongside your GP."]],
    related:["arthritis"],
  },
  "incontinence":{
    name:"Bladder leakage & incontinence", category:"Women's health", clinical:false,
    sub:"Restore pelvic-floor & bladder confidence.",
    lead:"Leaking when you laugh, cough or run is incredibly common — and very treatable. Rebuild pelvic-floor strength and bladder confidence, fully clothed.",
    whatIs:"Leaking when you laugh, cough, run or lift is incredibly common — and rarely talked about. It usually comes down to a pelvic floor that's lost strength and tone, often after pregnancy, birth or with age. The good news: it responds well to the right strengthening, and you don't have to just live with it.",
    therapies:[
      ["P","A leaky bladder almost always comes back to a pelvic floor that's lost strength and coordination — and doing enough effective Kegels to rebuild it is genuinely hard. The Emsella chair does the work for you: focused electromagnetic energy triggers thousands of supramaximal pelvic-floor contractions in a single 28-minute session — far more, and far stronger, than you could manage on your own. You sit fully clothed while it re-educates and re-strengthens the muscles that keep you in control. Most people do a short course and build real bladder confidence.",
        ["Thousands of pelvic-floor contractions per session","Rebuilds tone and control after pregnancy or with age","Fully clothed, private and completely non-invasive","Works for women and men"]],
    ],
    whatToExpect:"Emsella is usually done as a short course (often around six sessions over a few weeks). Each is about 28 minutes — you sit, fully clothed, while the chair does the work. It's private, comfortable and completely non-invasive, with no downtime. [confirm course]",
    faqs:[["Do I have to undress?","No — you stay fully clothed the whole time and simply sit on the chair."],["Is it just for women?","No — pelvic-floor strength and bladder control matter for men and women alike."],["How many sessions will I need?","Usually a course of around six over a few weeks; we'll recommend a plan. [confirm]"],["Is it safe with a metal implant or pacemaker?","Tell us in advance — it isn't suitable with some implants or a copper coil, so we'll check before you book."]],
    related:["osteoporosis"],
  },
  "long-covid-fatigue":{
    name:"Long COVID & fatigue", category:"Recovery", clinical:true,
    sub:"Support energy after viral illness.",
    lead:"Lingering fatigue and brain fog after a viral illness can be hard to shift — we support energy and recovery, gently and alongside your GP.",
    whatIs:"Lingering fatigue, brain fog and breathlessness after a viral illness can be exhausting and hard to shift. Long COVID and post-viral fatigue are increasingly recognised, and a growing body of research is looking at how oxygen and cellular-energy support may help people feel more like themselves again.",
    therapies:[
      ["H","Post-viral fatigue and long COVID involve low-grade inflammation and cells struggling to make energy — often with poor oxygen delivery to tissues and the brain. HBOT raises the oxygen carried in your blood many times over and drives it deep into tissue, supporting the mitochondria that produce your energy and helping calm neuroinflammation. It has one of the strongest emerging evidence bases of our therapies for this, which is why we lead with it — always gently, and always alongside your GP.",
        ["Massively increases oxygen reaching tired tissue and the brain","Supports the mitochondria behind cellular energy","May help calm the neuroinflammation linked to brain fog","Strongest emerging evidence base of our therapies [confirm]"]],
      ["I","On heavy-fatigue days, infrared offers gentle, restorative support — improving circulation and supporting cellular energy without the exertion of exercise, which many people simply can't tolerate yet. It's deeply relaxing and helps the nervous system settle, which often supports better sleep and recovery.",
        ["Supports circulation and cellular energy gently","No exertion required — ideal when energy is low","Calming; supports sleep and nervous-system recovery"]],
    ],
    whatToExpect:"We start gently — fatigue conditions need a careful, gradual approach — and build only as you tolerate it. Sessions are restful. We always recommend keeping your GP involved, especially with ongoing or new symptoms.",
    faqs:[["Can you cure long COVID?","No — we support recovery and energy alongside your medical care; we don't diagnose or treat. [confirm]"],["Why HBOT?","It's the most-researched of our therapies for post-viral fatigue and neuroinflammation. [confirm]"],["Will it make me crash?","We start low and slow to avoid over-doing it, and adjust to how you respond."],["Should I tell my GP?","Yes — please keep your GP involved, particularly with ongoing or new symptoms."]],
    related:["brain-fog","sleep-fatigue"],
  },
  "sleep-fatigue":{
    name:"Sleep & exhaustion", category:"Sleep & energy", clinical:false,
    sub:"Wind down and sleep deeper.",
    lead:"Poor sleep and constant tiredness feed each other. Gently shift your nervous system into a calmer state for deeper rest and steadier energy.",
    whatIs:"Poor sleep and constant tiredness feed each other — and affect everything from mood to immunity. Often the nervous system is stuck in 'on'. Gently shifting it into a calmer, parasympathetic state can help you wind down, sleep more deeply and wake with more in the tank.",
    therapies:[
      ["I","Poor sleep is often a nervous-system problem — you're stuck in 'fight or flight' and can't downshift. The deep, enveloping warmth of an infrared session helps switch you into the parasympathetic 'rest and digest' state, lowering tension and quietening a racing mind. Used in the evening it becomes a powerful wind-down ritual; many people report falling asleep faster and sleeping more deeply.",
        ["Shifts you into the calming parasympathetic state","A genuine evening wind-down ritual","Associated with falling asleep faster and deeper rest"]],
      ["P","PEMF gently supports the nervous system and the body's natural sleep rhythms, helping regulate an over-stimulated system. Beyond the night, it supports steadier daytime energy — so you're not running on empty. Many people pair it with infrared for the full wind-down effect.",
        ["Supports the nervous system and natural sleep states","Helps steady daytime energy, not just night-time sleep","Pairs well with infrared for wind-down"]],
    ],
    whatToExpect:"Many people use infrared and PEMF in a regular rhythm, often in the evening to wind down. Sessions are deeply relaxing — some drift off entirely. We'll help you build it into a routine that supports your sleep.",
    faqs:[["Which is better for sleep?","Infrared for wind-down, PEMF for the nervous system — many use both. We'll tailor it."],["When should I come?","Evening sessions suit winding down, but any time works. [confirm hours]"],["Will it help daytime energy too?","Better sleep and a calmer system often lift daytime energy over time."],["Is it a substitute for treating a sleep disorder?","No — if you have a diagnosed sleep disorder, please involve your GP; we support alongside."]],
    related:["brain-fog","long-covid-fatigue"],
  },
  "psoriasis-eczema":{
    name:"Psoriasis & eczema", category:"Skin", clinical:false,
    sub:"Calm inflammatory skin flares.",
    lead:"Support stubborn, itchy skin from the deeper layers — calming inflammation alongside your usual skincare.",
    whatIs:"Psoriasis and eczema are inflammatory skin conditions that can be itchy, sore and stubborn — and flare with stress. Supporting the skin from the deeper layers, calming inflammation and helping the body regulate can make flares easier to live with, alongside your usual skincare.",
    therapies:[
      ["I","Psoriasis and eczema flare from inflammation that lives in the deeper layers of the skin — not just the surface you can see. Infrared light reaches several millimetres down, into the dermis where these conditions begin, supporting circulation and helping calm the inflammation that drives redness, itch and plaques. It's a gentle, soothing warmth rather than harsh heat, and works alongside whatever your GP or dermatologist has you using.",
        ["Reaches the dermal layer where flares start","Supports circulation and calms deep inflammation","Gentle warmth; works alongside your usual skincare"]],
      ["P","PEMF supports the microcirculation and cellular repair that healthy skin depends on, and helps the body regulate the immune over-activity behind flares. Used regularly it's a calm, non-invasive way to support your skin from the inside.",
        ["Supports microcirculation and skin-cell repair","Helps regulate the immune activity behind flares","Non-invasive support between flare-ups"]],
      ["H","When skin inflammation is widespread or stubborn, the systemic oxygen boost from HBOT can support the body's overall inflammatory balance and skin repair — a useful addition when infrared and PEMF alone aren't enough.",
        ["Supports whole-body inflammatory balance","Useful for widespread or stubborn flares","Complements infrared and PEMF"]],
    ],
    whatToExpect:"We work alongside whatever your GP or dermatologist has you using. Most people build a gentle, regular rhythm. Sessions are warm and relaxing — and lots of people simply enjoy the calm. [confirm]",
    faqs:[["Will it clear my skin?","It's a supportive therapy that may help calm flares — not a cure, and best alongside your existing skincare and medical care. [confirm]"],["Is the heat irritating to skin?","Infrared is a gentle, deep warmth rather than harsh surface heat; we adjust to your comfort."],["Eczema and psoriasis both?","Yes — people use it for both inflammatory skin conditions."],["Can I keep using my creams?","Yes — keep your usual routine and your GP or dermatologist in the loop."]],
    related:[],
  },
  "osteoporosis":{
    name:"Osteoporosis", category:"Bone & circulation", clinical:true,
    sub:"Support bone health.",
    lead:"Support bone health alongside the diet, exercise and medical care your GP recommends.",
    whatIs:"Osteoporosis means bones have lost density and become more fragile, raising the risk of fractures. Alongside the diet, exercise and medical care your GP recommends, there's growing interest in how electromagnetic stimulation may support bone health.",
    therapies:[
      ["P","Bone is living tissue, constantly broken down and rebuilt by specialised cells. Pulsed electromagnetic fields are well known for stimulating the osteoblasts — the cells that build bone — and related PEMF technology is used in FDA-cleared bone-healing devices. Used regularly, alongside the diet, exercise and medical care your GP recommends, it's a gentle, non-invasive way to support bone health. You simply relax on the chair; there's nothing to feel and no downtime.",
        ["Stimulates the osteoblast cells that build bone","Related PEMF technology is FDA-cleared for bone healing [confirm]","Non-invasive support alongside your GP's plan","Relaxing — you simply sit or lie back"]],
    ],
    whatToExpect:"PEMF is relaxing and non-invasive — you simply sit or lie back. We always work alongside your GP and any prescribed treatment or bone-density monitoring, and build a regular rhythm. [confirm course]",
    faqs:[["Can PEMF reverse osteoporosis?","No — it's a supportive therapy used alongside your medical care, not a treatment or cure. [confirm]"],["Why PEMF for bone?","Pulsed electromagnetic fields are associated with stimulating bone-building cells; related technology is FDA-cleared for bone healing. [confirm]"],["Is it safe with my medication?","Generally yes, but always keep your GP informed, and tell us about any implants."],["How often should I come?","A regular rhythm tends to work best; we'll suggest a plan. [confirm]"]],
    related:["arthritis"],
  },
  "slow-healing-wounds":{
    name:"Slow-healing wounds", category:"Recovery", clinical:true,
    sub:"Oxygen support for stubborn wounds.",
    lead:"Stubborn wounds heal on oxygen and good circulation — we support both, always alongside your wound-care team.",
    whatIs:"Some wounds — particularly diabetic foot ulcers or wounds with poor blood supply — heal slowly and need extra support. Getting more oxygen and better circulation to the tissue is central to healing, which is where oxygen and infrared therapies come in — always alongside your medical wound care.",
    therapies:[
      ["H","Wounds heal on oxygen — and the wounds that won't close (diabetic foot ulcers, wounds with poor blood supply) are usually starved of it. HBOT super-saturates your blood with oxygen under pressure and forces it into the poorly-perfused tissue around the wound, fuelling the cells that rebuild and fight infection, and supporting the formation of new blood vessels. Supporting stubborn-wound healing is one of HBOT's most evidence-backed uses — always coordinated with your wound-care team.",
        ["Forces oxygen into tissue with poor blood supply","Fuels the cells that rebuild and protect the wound","Supports new blood-vessel formation","One of HBOT's most evidence-backed uses [confirm]"]],
      ["I","Infrared adds support by boosting microcirculation around the wound — and good local blood flow is exactly what healing depends on. It's a gentle complement to oxygen therapy and your medical wound care.",
        ["Boosts local circulation around the wound","Supports the blood flow healing depends on","Gentle complement to HBOT and medical care"]],
    ],
    whatToExpect:"This is always done alongside your GP, consultant or wound-care team — never instead of medical care. We'll coordinate around their plan and your monitoring. Sessions are calm and non-invasive. [confirm]",
    faqs:[["Is this a substitute for medical wound care?","No — it's strictly supportive, alongside your wound-care team and GP. [confirm]"],["Why is HBOT used for wounds?","It raises the oxygen reaching the tissue, which wound healing depends on; it's one of HBOT's most evidence-backed uses. [confirm]"],["Diabetic foot ulcers?","Yes — slow-healing diabetic wounds are a common reason people seek oxygen support, always GP-guided."],["Do I need clearance first?","Yes — we coordinate with your medical team before starting."]],
    related:["post-surgery-recovery"],
  },
  "brain-fog":{
    name:"Brain fog & memory", category:"Brain & focus", clinical:false,
    sub:"Lift the fog, sharpen focus.",
    lead:"That cloudy, can't-quite-focus feeling has many causes — we support oxygen and cellular energy in the brain to help lift it.",
    whatIs:"Brain fog — that cloudy, can't-quite-focus feeling, with memory slips and mental fatigue — has many causes, from stress and poor sleep to recovery after illness. Supporting oxygen and healthy cellular activity in the brain can help lift the fog and sharpen focus.",
    therapies:[
      ["H","Brain fog often comes down to the brain not getting the oxygen and energy it needs — whether from stress, poor sleep, hormones or recovery after illness. HBOT increases the oxygen carried to brain tissue many times over, supporting the energy-hungry neurons behind focus, memory and mental stamina, and helping calm any underlying neuroinflammation. People often describe the fog gradually lifting across a course of sessions.",
        ["Increases oxygen delivery to brain tissue","Supports the energy behind focus and memory","May help calm underlying neuroinflammation"]],
      ["P","PEMF supports healthy activity in the brain's cells and helps settle an over-stimulated nervous system — which matters, because stress and a 'wired' system are big drivers of fog. Calmer system, clearer head. It pairs well with HBOT: oxygen plus neural support.",
        ["Supports healthy neural-cell activity","Calms an over-stimulated nervous system","Pairs with HBOT for oxygen + neural support"]],
    ],
    whatToExpect:"Many people combine HBOT and PEMF over a course of sessions, often noticing clarity build gradually. Sessions are relaxing and non-invasive. If brain fog is persistent or new, we'll suggest keeping your GP involved.",
    faqs:[["What causes brain fog?","Often stress, poor sleep, hormones or recovery after illness. We support oxygen and cellular energy; persistent fog should be checked by your GP. [confirm]"],["Which therapy helps most?","Usually HBOT for oxygen and PEMF for neural support — many use both."],["How soon might I notice?","Clarity tends to build gradually across a course; everyone's different. [confirm]"],["Is this for diagnosed cognitive conditions?","Those are supported only alongside your GP and medical care; we don't diagnose or treat."]],
    related:["long-covid-fatigue","sleep-fatigue"],
  },
  "sports-recovery":{
    name:"Sports injury & recovery", category:"Recovery", clinical:false,
    sub:"Train hard, recover harder.",
    lead:"Bounce back faster from training and injury — and get more out of every session — with recovery built for active bodies.",
    whatIs:"Whether you're managing a strain, coming back from a soft-tissue injury, or just chasing faster recovery between hard sessions, the principles are the same: get blood, oxygen and the right repair signals to the tissue, and calm the inflammation so you can train again sooner. Athletes and weekend warriors alike use recovery therapy to shorten downtime and feel fresher.",
    therapies:[
      ["I","After hard training or a soft-tissue injury, muscles are inflamed, tight and clogged with metabolic by-products. Full-body infrared drives a deep, penetrating warmth that boosts circulation, flushes the tissue and relaxes the muscle — the classic 'recovery flush' — so you bounce back looser and sooner. It also makes an excellent pre-event warm-up.",
        ["Boosts circulation for a faster recovery flush","Relaxes tight, overworked muscle","Supports soft-tissue and tendon repair"]],
      ["P","PEMF supports the tissue itself — calming the nerves around an injury, supporting collagen in tendons and ligaments, and helping the cells repair. For nagging tendon issues and joint niggles that won't settle, it's a gentle, drug-free way to keep training.",
        ["Supports tendon, ligament and tissue repair","Calms pain around an injury","Keeps you training through niggles"]],
      ["H","For bigger setbacks, or whole-body fatigue from heavy training blocks, HBOT floods the system with oxygen to support repair and energy at the cellular level — used by athletes to accelerate recovery and get back to performance faster.",
        ["Whole-body oxygen for faster recovery","Supports energy through heavy training blocks","Used by athletes after bigger setbacks"]],
    ],
    whatToExpect:"We'll match the therapy to where you are — acute injury, recovery between sessions, or a performance block. Many athletes use infrared and PEMF regularly, adding HBOT around bigger events or setbacks. Sessions are easy and non-invasive; build them into your training week.",
    faqs:[["Can I come in straight after training?","Yes — infrared in particular is great as a recovery flush after a session."],["Will it help an old nagging injury?","Often — PEMF and infrared are well suited to stubborn soft-tissue and tendon issues. [confirm]"],["How often should I recover?","Many train-and-recover weekly or more; we'll suggest a rhythm around your schedule. [confirm]"],["Is massage available too?","Yes — once any acute injury is cleared, hands-on work complements the therapies. [confirm]"]],
    related:["back-neck-pain","post-surgery-recovery"],
  },
  "fibromyalgia":{
    name:"Fibromyalgia", category:"Pain & joints", clinical:true,
    sub:"Calm widespread pain & fatigue.",
    lead:"Widespread pain, fatigue and foggy days — fibromyalgia is hard to live with. We offer gentle, non-invasive support across all three therapies, alongside your GP.",
    whatIs:"Fibromyalgia brings widespread muscle and joint pain, deep fatigue, poor sleep and 'fibro fog' — with a nervous system that amplifies pain signals. There's no single switch to flip, so support tends to work best across several fronts at once: easing pain, calming the nervous system, supporting energy and improving sleep.",
    therapies:[
      ["H","Fibromyalgia involves a fatigue and cognitive fog many find as hard as the pain. HBOT raises oxygen to tissue and the brain, supporting cellular energy and helping calm the neuroinflammation linked to fibro fog — emerging research is promising. We always work alongside your GP.",
        ["Supports cellular energy and reduces fatigue","May help with fibro fog and concentration","Emerging evidence base [confirm]"]],
      ["I","The deep warmth of infrared eases widespread muscle pain and stiffness, boosts circulation and shifts the nervous system into a calmer state — which also helps with the poor sleep that drives fibromyalgia flares.",
        ["Eases widespread muscle pain and stiffness","Calms the nervous system","Supports better, deeper sleep"]],
      ["P","Because fibromyalgia is partly a pain-amplification problem, PEMF's calming effect on nerve excitability is a natural fit — gently turning down over-sensitive pain signalling for more settled days.",
        ["Calms over-sensitive nerve signalling","Drug-free support for daily pain","Helps settle flares"]],
    ],
    whatToExpect:"Fibromyalgia needs a gentle, patient approach — we start low and slow and build only as you tolerate it, often combining all three therapies over time. Sessions are restful. We always recommend keeping your GP involved.",
    faqs:[["Can you treat fibromyalgia?","No — we offer supportive, non-invasive therapy alongside your medical care; we don't diagnose or treat. [confirm]"],["Which therapy should I start with?","Often infrared for pain and sleep, adding PEMF and HBOT — we'll go gently and tailor it."],["Will it cause a flare?","We start low and slow specifically to avoid over-doing it, adjusting to how you respond."],["How long until I notice anything?","Fibromyalgia support builds gradually over a course; everyone's different. [confirm]"]],
    related:["back-neck-pain","sleep-fatigue"],
  },
  "sciatica":{
    name:"Sciatica & nerve pain", category:"Pain & joints", clinical:false,
    sub:"Calm the nerve, ease the leg.",
    lead:"That shooting, burning pain down the leg is exhausting. We focus on calming the irritated nerve and releasing the muscle that's pressing on it.",
    whatIs:"Sciatica is pain that travels along the sciatic nerve — often a shooting, burning or tingling sensation from the lower back into the buttock and down the leg. It's usually driven by an irritated or compressed nerve, frequently with tight glute and piriformis muscle adding to the squeeze. Calming the nerve and releasing that muscle is the way back to comfort.",
    therapies:[
      ["P","Sciatica is, at heart, an angry nerve. PEMF delivers gentle pulsed fields that help calm that nerve excitability and support the surrounding tissue — turning down the shooting, burning signals so the leg settles.",
        ["Calms the irritated sciatic nerve","Eases shooting, burning leg pain","Drug-free and non-invasive"]],
      ["I","Tight glute and piriformis muscle often compress the nerve. Infrared's deep warmth relaxes that muscle and boosts microcirculation along the nerve's path, easing the squeeze and supporting recovery. Paired with PEMF, it tackles both the muscle and the nerve.",
        ["Releases tight glute & piriformis muscle","Improves circulation along the nerve","Works with PEMF on muscle + nerve"]],
    ],
    whatToExpect:"Most people pair PEMF and infrared, often alongside gentle movement and stretching. Sessions are relaxing and non-invasive. If your sciatica is severe, sudden, or comes with leg weakness or numbness, please see your GP first — we'll work alongside them.",
    faqs:[["How is this different from a heat pack?","Infrared reaches far deeper than surface heat, into the muscle compressing the nerve; PEMF calms the nerve itself."],["How many sessions will I need?","Many notice gradual change over a course; we'll suggest a plan. [confirm]"],["Should I see a doctor too?","Yes if it's severe, sudden, or you have leg weakness or numbness — we support alongside your GP."],["Can it help other nerve pain?","Yes — PEMF and infrared are used for a range of nerve-pain issues."]],
    related:["back-neck-pain","arthritis"],
  },
  "menopause":{
    name:"Menopause support", category:"Women's health", clinical:false,
    sub:"Support through the change.",
    lead:"Hot flushes, broken sleep, aching joints, low energy and brain fog — menopause touches everything. Gentle, drug-free support for the symptoms that bother you most.",
    whatIs:"Menopause is a natural transition, but the drop in hormones can bring a wide mix of symptoms — disrupted sleep, joint and muscle aches, fatigue, mood changes, brain fog, and changes to bone and pelvic-floor health. There's no one-size-fits-all; the aim is to support the symptoms affecting your quality of life, alongside whatever care your GP provides.",
    therapies:[
      ["I","Infrared is a menopause all-rounder: the deep warmth eases aching joints and muscles, and by shifting the nervous system into a calmer state it supports better sleep and lower stress — two of the biggest quality-of-life wins through the change.",
        ["Eases menopausal joint and muscle aches","Supports deeper, less broken sleep","Calms stress and supports mood"]],
      ["P","Falling oestrogen affects bone and the pelvic floor. PEMF supports bone-building activity, and on the Emsella chair it rebuilds pelvic-floor strength and bladder confidence — common, rarely-discussed menopause issues. It also supports steadier energy.",
        ["Supports bone health as oestrogen falls","Emsella for pelvic-floor & bladder confidence","Supports energy and a calmer system"]],
      ["H","When fatigue and brain fog are the headline symptoms, HBOT's oxygen boost supports cellular energy and mental clarity — helping you feel more like yourself.",
        ["Supports energy when fatigue is heavy","Helps with menopausal brain fog","Whole-body cellular support"]],
    ],
    whatToExpect:"We'll focus on the symptoms that matter most to you — sleep, joints, energy, bone or pelvic floor — and build a combination around them. Sessions are relaxing and non-invasive, and complement anything your GP has you on.",
    faqs:[["Is this an alternative to HRT?","No — it's supportive and works alongside whatever your GP recommends, including HRT. [confirm]"],["Which symptoms can it help?","Most often sleep, joint aches, energy, brain fog, bone health and pelvic floor. We tailor it."],["Can it help with bladder leakage?","Yes — the Emsella chair (PEMF) is excellent for pelvic-floor and bladder confidence."],["How regularly should I come?","A regular rhythm tends to help most; we'll suggest a plan. [confirm]"]],
    related:["incontinence","osteoporosis","sleep-fatigue"],
  },
  "stress-burnout":{
    name:"Stress & burnout", category:"Sleep & energy", clinical:false,
    sub:"Switch off and recharge.",
    lead:"When you're running on empty and can't switch off, your nervous system needs a genuine reset — not just another coffee.",
    whatIs:"Chronic stress and burnout keep the body locked in 'fight or flight' — wired, tired and unable to properly rest or recover. Over time that drains energy, wrecks sleep and affects mood and immunity. The way out is to help the nervous system downshift into 'rest and digest', regularly enough that it becomes the new normal.",
    therapies:[
      ["I","An infrared session is one of the simplest ways to force a downshift: the deep, enveloping warmth activates the parasympathetic 'rest and digest' state, melts physical tension and quietens a busy mind. Many describe it as the most relaxed they've felt all week — a real reset.",
        ["Activates the calming parasympathetic state","Melts physical tension and quietens the mind","A genuine weekly reset"]],
      ["P","PEMF gently supports nervous-system regulation, helping an over-stimulated system settle — which supports better sleep, steadier mood and more reliable energy across the day.",
        ["Supports nervous-system regulation","Helps restore steadier daytime energy","Supports sleep and mood"]],
    ],
    whatToExpect:"Most people use infrared and PEMF in a regular rhythm — even once a week makes a difference. Sessions are deeply relaxing; many switch off completely. We'll help you build a sustainable reset into your routine.",
    faqs:[["I can never switch off — will this actually help?","That's exactly what it's for — the warmth and stillness make it much easier to downshift than trying to relax at home."],["How often should I come?","Even weekly helps; more often during heavy periods. We'll suggest a rhythm. [confirm]"],["Is this a substitute for mental-health care?","No — for anxiety, depression or burnout please involve your GP; we provide supportive relaxation alongside."],["Which is more relaxing?","Most people love infrared for pure switch-off; PEMF adds nervous-system support. Many use both."]],
    related:["sleep-fatigue","brain-fog"],
  },
};

/* ---- chrome from hbot.html ---- */
const base = fs.readFileSync(ROOT + "/hbot.html", "utf8");
const headEnd = base.indexOf("</header>") + "</header>".length;
const footStart = base.indexOf('<footer class="foot">');
if (headEnd < 20 || footStart < 0) throw new Error("could not split chrome");
let HEAD = base.slice(0, headEnd);
const FOOT = base.slice(footStart);

const EXTRA_CSS = `
/* condition pillar pages */
.thero h1.cond-h1{font-size:clamp(34px,5vw,66px)}
.chip-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.chip-row a{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  border:1px solid var(--line);border-radius:2px;padding:9px 13px;color:var(--ink);transition:.3s var(--ease)}
.chip-row a:hover{border-color:var(--accent);color:var(--accent)}
.how-therapy{border-top:1px solid var(--line);padding:clamp(26px,3.4vw,40px) 0}
.how-therapy:last-child{border-bottom:1px solid var(--line)}
.ht-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px;flex-wrap:wrap}
.ht-name{font-size:clamp(22px,2.6vw,30px);font-weight:400;text-transform:uppercase;letter-spacing:-.01em}
.ht-more{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);white-space:nowrap}
.ht-more:hover{text-decoration:underline}
.how-therapy p{margin-top:14px;color:var(--ink-dim);font-size:15.5px;line-height:1.7;max-width:70ch}
.ht-points{list-style:none;margin:18px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:9px 28px;max-width:820px}
.ht-points li{display:flex;gap:10px;font-size:13.5px;color:var(--ink);line-height:1.45}
.ht-points li::before{content:"\\2192";color:var(--accent);flex:none}
.cond-gp{margin-top:18px;font-size:14px;color:var(--accent);max-width:62ch}
@media(max-width:760px){.ht-points{grid-template-columns:1fr}}
`;

HEAD = HEAD.replace("</style>", EXTRA_CSS + "</style>");
HEAD = HEAD.replace(`<a class="lk active" href="index.html#therapies">Therapies`,
                    `<a class="lk" href="index.html#therapies">Therapies`);
HEAD = HEAD.replace(`<span class="lk lk-trigger" tabindex="0"`,
                    `<span class="lk lk-trigger active" tabindex="0"`);

function stripConfirm(t){ return t.replace(/\s*\[confirm[^\]]*\]/gi, ""); }
function esc(t){ return t.replace(/&/g,"&amp;").replace(/"/g,'\\"'); }
function flag(t){ return t.replace(/\[confirm[^\]]*\]/gi, m=>`<span style="color:var(--accent)">${m}</span>`); }

function buildPage(slug, c){
  const therapyChips = c.therapies.map(([code])=>`<a href="${T[code].href}">${T[code].name}</a>`).join("");
  const howBlocks = c.therapies.map(([code,para,points])=>{
    const pts = (points||[]).map(p=>`<li>${flag(p)}</li>`).join("");
    return `      <div class="how-therapy">
        <div class="ht-head"><span class="ht-name">${T[code].name}</span><a class="ht-more" href="${T[code].href}">Explore ${T[code].name} &rarr;</a></div>
        <p>${flag(para)}</p>
        ${pts?`<ul class="ht-points">${pts}</ul>`:""}
      </div>`;
  }).join("\n");
  const faqHtml = c.faqs.map(([q,a])=>
    `      <details><summary>${q} <span class="pm">+</span></summary><div class="ans">${flag(a)}</div></details>`).join("\n");
  const relTherapy = c.therapies.map(([code])=>
    `      <a class="rel-card" href="${T[code].href}" style="background:var(--bg);color:var(--ink);border-color:var(--bg)">
        <span class="circle"><span class="ph"></span></span>
        <div class="rc-txt"><h4>${T[code].name}</h4><p>${T[code].sub}</p></div>
        <span class="go">&rarr;</span>
      </a>`).join("\n");
  const relCond = (c.related||[]).map(rs=>{
    const rc = CONDS[rs];
    return `      <a class="rel-card" href="${rs}.html" style="background:var(--bg);color:var(--ink);border-color:var(--bg)">
        <span class="circle"><span class="ph"></span></span>
        <div class="rc-txt"><h4>${rc.name}</h4><p>${rc.sub}</p></div>
        <span class="go">&rarr;</span>
      </a>`;
  }).join("\n");
  const gpNote = c.clinical
    ? `\n        <p class="cond-gp">Important: we support and complement medical care — we never diagnose, prescribe or treat. For ${c.name.toLowerCase()} we always work alongside your GP and medical team.</p>`
    : "";
  const ld = {"@context":"https://schema.org","@type":"FAQPage",
    "mainEntity": c.faqs.map(([q,a])=>({"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":stripConfirm(a)}}))};
  const ldScript = `<script type="application/ld+json">\n${JSON.stringify(ld,null,2)}\n</script>\n</head>`;

  let head = HEAD
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${c.name} — How We Can Help | Renova Cellular Health, Clonmel</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(c.lead)} ${c.name} support at Renova Cellular Health, Clonmel — ${c.therapies.map(t=>T[t[0]].name).join(', ')}." />`)
    .replace("</head>", ldScript);

  const content = `<!-- ============ HERO ============ -->
<section class="thero">
  <div class="shell">
    <div class="crumbs"><a href="index.html">Home</a> <span>/</span> <span>Conditions</span> <span>/</span> <span>${c.name}</span></div>
    <div class="thero-grid">
      <div>
        <span class="eyebrow">Condition &middot; ${c.category}</span>
        <h1 class="display cond-h1">${c.name}</h1>
        <p class="lead">${c.lead}</p>
        <div class="chip-row">${therapyChips}</div>
        <div class="thero-cta">
          <a class="btn btn--solid" href="#book"><span>Book a session</span><span class="arw">&rarr;</span></a>
          <a class="btn" href="tel:0838672844"><span>083 867 2844</span><span class="arw">&#8599;</span></a>
        </div>
      </div>
      <div class="thero-visual"><span class="ring"></span><div class="ph"></div></div>
    </div>
  </div>
</section>

<!-- ============ WHAT IS ============ -->
<section class="section light" id="about">
  <div class="shell">
    <div class="sec-head io"><span class="eyebrow on-light">The condition</span><h2 class="display">What is ${c.name}?</h2></div>
    <div class="prose io"><p>${c.whatIs}</p></div>
  </div>
</section>

<!-- ============ HOW WE HELP ============ -->
<section class="section" id="how">
  <div class="shell">
    <div class="sec-head io"><span class="eyebrow">How we help</span><h2 class="display">How each therapy<br/>helps ${c.name.toLowerCase()}</h2><p>The recommended therapies for ${c.name.toLowerCase()}, and exactly how each one works for it — we'll tailor the right combination for you. <span style="color:var(--accent)">[confirm with clinical lead]</span></p></div>
    <div class="io">
${howBlocks}
    </div>
  </div>
</section>

<!-- ============ WHAT TO EXPECT ============ -->
<section class="section light" id="expect">
  <div class="shell">
    <div class="sec-head io"><span class="eyebrow on-light">Your visit</span><h2 class="display">What to expect</h2></div>
    <div class="prose io"><p>${c.whatToExpect}</p>${gpNote}</div>
  </div>
</section>

<!-- ============ FAQ ============ -->
<section class="section" id="faq">
  <div class="shell">
    <div class="sec-head io"><span class="eyebrow">Good to know</span><h2 class="display">FAQ</h2></div>
    <div class="faq io">
${faqHtml}
    </div>
  </div>
</section>

<!-- ============ RELATED ============ -->
<section class="section light" id="related">
  <div class="shell">
    <div class="sec-head io"><span class="eyebrow on-light">Explore more</span><h2 class="display">Related</h2></div>
    <div class="related io">
${relTherapy}
${relCond}
    </div>
  </div>
</section>

<!-- ============ CTA ============ -->
<section class="cta-band" id="book">
  <div class="shell cta-inner">
    <div>
      <span class="eyebrow" style="margin-bottom:16px;display:inline-flex">Ready when you are</span>
      <h2 class="display">Book a<br/>session</h2>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
      <a class="btn btn--solid" href="tel:0838672844"><span>083 867 2844</span><span class="arw">&rarr;</span></a>
      <a class="btn" href="index.html#visit"><span>Visit us</span><span class="arw">&#8599;</span></a>
    </div>
  </div>
</section>

`;
  return head + "\n" + content + FOOT;
}

let n=0;
for (const [slug,c] of Object.entries(CONDS)){
  fs.writeFileSync(ROOT + "/" + slug + ".html", buildPage(slug, c));
  n++; console.log("built", slug + ".html");
}
console.log("done", n);
