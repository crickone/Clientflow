#!/usr/bin/env python3
"""Part 2: Generate and inject 93 OHR PEMF ad copy scripts."""
import html as html_mod

REPORT = '/sessions/festive-zen-babbage/mnt/Renova/OHR_HBOT_Ad_Library_Full_Report.html'
LOCATION_LINE = "\n\n📍 Optimal Health & Recovery | Ard Gaoithe Business Park, Clonmel, Co. Tipperary\n🌐 optimalhealthatinspire.ie | ☎ 083 867 2844"

def esc(s): return html_mod.escape(str(s))

_card_id = [0]
def sc(num, angle, title, type_, dur, place, insight, primary, headline, cta):
    _card_id[0] += 1
    cid = f'pc{_card_id[0]}'
    full_text = primary.strip() + LOCATION_LINE
    preview = full_text[:180].replace('\n','  ') + ('…' if len(full_text)>180 else '')
    return (
        f'<div style="background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:20px;margin-bottom:16px">'
        f'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px">'
        f'<div><span style="color:#a855f7;font-weight:700;font-size:14px">#{num}</span>'
        f' <span style="color:#e6edf3;font-weight:600;font-size:14px">{esc(title)}</span></div>'
        f'<div style="display:flex;gap:6px;flex-wrap:wrap">'
        f'<span style="background:#1c0a33;color:#a855f7;font-size:11px;padding:2px 8px;border-radius:12px;border:1px solid #a855f733">{esc(angle)}</span>'
        f'<span style="background:#161b22;color:#8b949e;font-size:11px;padding:2px 8px;border-radius:12px;border:1px solid #30363d">{esc(type_)}</span>'
        f'<span style="background:#161b22;color:#8b949e;font-size:11px;padding:2px 8px;border-radius:12px;border:1px solid #30363d">{esc(dur)}</span>'
        f'</div></div>'
        f'<div style="background:#0a1628;border:1px solid #a855f722;border-radius:6px;padding:10px 14px;margin-bottom:12px">'
        f'<div style="color:#a855f7;font-size:10px;font-weight:700;letter-spacing:.8px;margin-bottom:4px">DATA INSIGHT</div>'
        f'<div style="color:#8b949e;font-size:12px;line-height:1.5">{esc(insight)}</div>'
        f'</div>'
        f'<div class="bp" id="{cid}p" style="white-space:pre-wrap;color:#8b949e;font-size:12px;line-height:1.6">{esc(preview)}</div>'
        f'<div class="bf" id="{cid}f" style="display:none;white-space:pre-wrap;color:#e6edf3;font-size:13px;line-height:1.7">{esc(full_text)}</div>'
        f'<div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'
        f'<div style="color:#8b949e;font-size:12px">📍 {esc(place)} &nbsp;|&nbsp; CTA: <strong style="color:#e6edf3">{esc(cta)}</strong>'
        f' &nbsp;|&nbsp; Headline: <em style="color:#e6edf3">{esc(headline)}</em></div>'
        f'<button class="tb" onclick="tog(\'{cid}\')" style="background:#1c0a33;border:1px solid #a855f7;color:#a855f7;padding:4px 14px;border-radius:4px;font-size:12px;cursor:pointer">Show Full Script</button>'
        f'</div></div>'
    )

scripts = []

# ── Scripts 1–15: Core conditions ─────────────────────────────────────────────
scripts.append(sc(1,'Joint Pain','Joints That Wake You Up at Night','Image','N/A','Facebook Feed / Instagram',
'Elaris Body runs "Less pain. More energy. Better sleep." — a 3-benefit stack that dominates their entire creative. Blue Wave PEMF leads with bone & joint regeneration for fractures and osteoporosis.',
'''Are your joints waking you up at night? 😔

That stiffness the moment you sit up. The ache before your feet hit the floor.

It's not just part of getting older. It's inflammation — and PEMF therapy works directly at the cellular level to reduce it.

At Optimal Health & Recovery, our clinical-grade PEMF mat sends pulsed electromagnetic pulses deep into your tissue — stimulating the cells that repair cartilage, reduce swelling, and restore circulation.

No drugs. No needles. Just 30–45 minutes on the mat.

Most clients notice a difference after their first session.

✅ Clinically researched
✅ Non-invasive
✅ Safe for daily use

DM us or book online — first sessions available this week.''',
'Stop Waking Up in Pain — Try PEMF at OHR','Book a session'))

scripts.append(sc(2,'Back Pain','The Drug-Free Solution for Back Pain','Image / Short Video','30s','Facebook Feed',
'Blue Wave PEMF Therapy (Enfield) explicitly lists "Chronic Nerve & Back Pain Relief" and "Deep Tissue Inflammation Reduction" as their top use cases in their local clinic ad.',
'''Chronic back pain doesn't have to be managed with pills forever. 💊

PEMF therapy — Pulsed Electromagnetic Field — reaches the deep tissue layers that massage and physio can't touch.

At OHR in Clonmel, we use clinical-grade PEMF equipment that delivers therapeutic electromagnetic pulses deep into the spine, discs, and surrounding muscle tissue.

This stimulates:
⚡ Cellular repair
⚡ Reduced inflammation
⚡ Improved circulation to the damaged area

No injections. No surgery. No side effects.

Just your body doing what it was designed to do — heal — with the right support.

One 30-minute session. See how your back feels.''',
'Back Pain Relief Without Medication — Book in Clonmel','Book a PEMF session'))

scripts.append(sc(3,'Chronic Pain',"You've Tried Everything. Try This.",'Video','45s','Facebook Feed / Instagram Reels',
'Rē Precision Health\'s standout ad: "Not another wellness retreat. The result of 15 years of research." — directly addresses the exhausted, sceptical chronic pain sufferer who has tried everything.',
'''If you've been living with pain for years... you already know the story.

Physio. Painkillers. Cortisone. Acupuncture. Some things help for a while. Nothing sticks.

Here's what most people don't know: chronic pain is often driven by cellular-level inflammation that none of those treatments actually reach.

PEMF therapy — used in hospitals and professional sports clinics worldwide — sends targeted electromagnetic pulses into the tissue at a cellular level.

It doesn't mask the pain. It works on the cause.

At OHR in Clonmel, we've helped people with:
✅ Arthritis
✅ Fibromyalgia
✅ Post-injury chronic pain
✅ Nerve pain and sciatica

If you're ready to try something that actually works differently — we're here.

Book a consultation this week. First-timers always welcome.''',
"The Chronic Pain Solution Most Doctors Don't Mention",'Book now'))

scripts.append(sc(4,'Arthritis','Arthritis Relief — Without More Medication','Image','N/A','Facebook Feed',
'Omnipemf cites "Relief from pain and tension" and "50,000+ individuals worldwide" as their social proof anchor. Elaris leads with pain as the #1 benefit before energy and sleep.',
'''Arthritis flare-ups are exhausting. 😞

The swelling. The stiffness. The way the weather seems to know before you do.

PEMF therapy doesn't replace your treatment plan — but it does something your anti-inflammatories can't: it works at the cellular level to reduce the inflammatory response in your joints.

Clinical studies show PEMF therapy can:
✅ Reduce joint swelling and stiffness
✅ Improve range of motion
✅ Decrease pain perception
✅ Support cartilage maintenance

One 30-minute session at OHR in Clonmel and most clients step off the mat feeling noticeably lighter.

No commitment. Book a single session and feel the difference.''',
'Arthritis Pain Relief — Cellular-Level Results','Book a session at OHR'))

scripts.append(sc(5,'Fibromyalgia','Fibromyalgia: When Pain Is Everywhere','Video','40s','Facebook Feed / Instagram',
'Therafy\'s "penetrates through your entire body" mechanism claim directly maps to fibromyalgia sufferers who experience widespread pain with no identifiable local source.',
'''Fibromyalgia is one of the most misunderstood conditions in medicine.

The pain is real. The fatigue is real. The brain fog is real.

But because there's no visible injury or inflammation on a scan, people are too often dismissed.

PEMF therapy works differently. It doesn't need a scan to find the problem. It delivers electromagnetic pulses system-wide — stimulating cellular repair, reducing the inflammatory signals that drive widespread pain, and supporting the nervous system.

Clients with fibromyalgia report:
😌 Reduced pain intensity after consistent sessions
😌 Better sleep (a key driver of fibro flares)
😌 Less morning stiffness

At OHR in Clonmel, we're familiar with complex chronic conditions. We'll talk through your history and build a plan that works for you.

You deserve to be taken seriously. Let's start there.''',
'Fibromyalgia Support — PEMF Therapy at OHR Clonmel','Book a consultation'))

scripts.append(sc(6,'Sleep','Fall Asleep Faster — No Medication Needed','Image','N/A','Facebook Feed / Instagram',
'MiraMate leads with "Struggling with restless nights? 30 minutes before bed can help you fall asleep faster." Omnipemf: "Deeper, uninterrupted sleep — activate Delta waves naturally." Sleep is the highest-converting single benefit in PEMF advertising.',
'''Struggling to fall asleep? 😴 Waking at 3am with a busy mind?

PEMF therapy works by gently entraining your brain into Delta wave frequency — the state your body needs for deep, restorative sleep.

Just 30 minutes on our clinical-grade PEMF mat before your evening session and most clients report:

💤 Falling asleep faster
💤 Staying asleep longer
💤 Waking up actually refreshed

No medication. No melatonin dependence. No grogginess.

It's your nervous system being reset to its natural rhythm.

OHR in Clonmel is one of the few clinics in Tipperary with clinical-grade PEMF equipment. Evening appointments available.

DM us to book. Your best night's sleep might be closer than you think.''',
'Better Sleep in 30 Minutes — PEMF at OHR','Book an evening session'))

scripts.append(sc(7,'Fatigue / Energy',"Exhausted by Midday? Here's Why.",'Image','N/A','Facebook Feed',
'MiraMate: "Tired and low on energy? PEMF therapy works at the cellular level, helping you recharge." Omnipemf: "Sustained energy and productivity throughout the day." Cellular energy (ATP production) is the science behind the energy benefit.',
'''You're sleeping (sort of). You're eating okay. You're doing the right things.

But by midday, you're running on empty. ⚡

Here's what most GPs won't tell you: chronic low energy is often a cellular problem. Your mitochondria — the power stations of your cells — aren't producing enough ATP.

PEMF therapy directly stimulates mitochondrial function, boosting ATP production at a cellular level.

The result? More energy. Clearer thinking. Better recovery.

At OHR in Clonmel, clients often describe their first few sessions as "like someone switched the lights back on."

If you're tired of being tired — book a PEMF session this week.

30–45 minutes. Clinical-grade equipment. Real results.''',
'More Energy — Without Caffeine or Supplements','Book a session at OHR'))

scripts.append(sc(8,'Brain Fog',"Brain Fog Isn\'t Normal. Fix It.",'Image / Video','30s','Facebook Feed / Instagram',
'Omnipemf leads with "Enhanced focus and mental clarity — optimize" as one of 5 PEMF benefits. Scieneldn positions PEMF as "nervous system reset. Cellular energy." — targeting the high-achiever with declining cognitive performance.',
'''You used to be sharp. Focused. You could hold 10 things in your head.

Now you walk into a room and forget why. You re-read sentences. You lose your train of thought mid-meeting.

Brain fog is not just stress. It's often inflammation — in your nervous system, in your gut, in your cells.

PEMF therapy crosses the blood-brain barrier. Electromagnetic pulses stimulate blood flow, reduce neuroinflammation, and help your brain return to its natural operating frequency.

Clients using PEMF for cognitive support report:
🧠 Clearer thinking
🧠 Better focus and recall
🧠 Reduced mental fatigue

One session at OHR in Clonmel. Let your brain breathe.''',
'Clear the Brain Fog — PEMF Therapy Clonmel','Book your first session'))

scripts.append(sc(9,'Inflammation','Inflammation is the Root of It All','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Deep Tissue Inflammation Reduction" listed as a primary use case. Elaris: "reduce inflammation, ease tension, and support your body\'s natural recovery." Inflammation is the common thread across all PEMF condition copy.',
'''Pain. Fatigue. Poor sleep. Weight that won't budge. Mood swings.

What if they all had the same root cause?

Chronic systemic inflammation is now linked to almost every major health complaint seen in GP surgeries today.

PEMF therapy works directly at the cellular level to:
⚡ Reduce pro-inflammatory cytokines
⚡ Stimulate cellular repair
⚡ Improve circulation and waste removal
⚡ Support the body's natural anti-inflammatory response

It's not a supplement. It's not a lifestyle change. It's a direct electromagnetic intervention — clinically researched and non-invasive.

At OHR in Clonmel, we use clinical-grade PEMF equipment — significantly more powerful than anything available for home use.

Book a session. Start at the root.''',
'Target Inflammation at the Cellular Level','Book a PEMF session'))

scripts.append(sc(10,'Bone Health','Osteoporosis & Bone Density — PEMF Can Help','Image','N/A','Facebook Feed',
'Blue Wave PEMF explicitly lists "Bone & Joint Regeneration (Fractures/Osteoporosis)" as their #1 use case — the only ad in the dataset to lead with bone health. This is an underserved angle with a highly motivated audience.',
'''Did you know PEMF therapy was first approved by the FDA for non-union bone fractures?

Long before it became a wellness tool, PEMF was used in hospitals to stimulate bone healing in fractures that wouldn't knit.

Today, clinical research shows PEMF can:
✅ Stimulate osteoblast activity (bone-building cells)
✅ Improve bone mineral density over time
✅ Support fracture recovery
✅ Reduce the pain of osteoporosis

If you've been told your bone density is declining, or you're recovering from a fracture, PEMF therapy is worth a serious conversation.

OHR in Clonmel — clinical-grade PEMF for bone and joint health.

Consultations available. Ask us about our bone health sessions.''',
'Support Bone Density — PEMF Therapy at OHR','Book a consultation'))

scripts.append(sc(11,'Stress / Cortisol','Reset Your Stress Response — In 30 Minutes','Image','N/A','Facebook Feed / Instagram',
'Scieneldn: "Anti-inflammatory. Nervous system reset. Cellular energy." Rē Precision Health runs 5/10/21-day programs specifically to "unwind the chronic stress response." Stress is positioned as a physical (not just mental) problem that needs physical intervention.',
'''Stress isn't just in your head. 🧠

Chronic stress floods your body with cortisol — driving inflammation, disrupting sleep, suppressing immunity, and accelerating cellular aging.

PEMF therapy works on the nervous system directly. Clinical research shows it activates the parasympathetic response — your body's "rest and repair" mode.

In just 30–45 minutes on the mat at OHR:
😌 Heart rate slows
😌 Cortisol levels drop
😌 Nervous system shifts from fight-or-flight to rest-and-digest

Think of it as pressing reset on your stress response.

OHR Clonmel. Walk in wound up, walk out reset.

Evening and weekend appointments available.''',
'Switch Off Stress — PEMF Nervous System Reset at OHR','Book a reset session'))

scripts.append(sc(12,'Athletic Recovery','Recover Faster. Train More. Perform Better.','Video','35s','Instagram / Facebook Feed',
'The Oxygen Temple and Livbetter both target athletes: "Recover faster. Reduce inflammation. Improve energy and performance." X-CELLr8 targets HYROX and pitch athletes. Recovery speed is the #1 athlete benefit.',
'''The difference between athletes who stay at the top and those who break down?

Recovery.

PEMF therapy accelerates recovery by:
⚡ Flushing lactic acid faster
⚡ Reducing muscle micro-tear inflammation
⚡ Stimulating tissue repair at a cellular level
⚡ Supporting sleep quality for deeper recovery

Used by professional sports teams across Europe. Now available in Clonmel.

At OHR, we work with GAA players, runners, cyclists, and gym athletes who want to train harder without breaking down.

30–45 minute PEMF session. Feel the difference in your next training session.

Book online or DM us.''',
'Train Harder. Recover Faster. PEMF at OHR Clonmel','Book a recovery session'))

scripts.append(sc(13,'Post-Injury','Still Not Fully Healed? PEMF Can Help.','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Enhanced Micro-circulation & Healing" — positioning PEMF as an accelerator for tissue healing post-injury. Omnipemf cites "relief from pain and tension" across injury-related pain types.',
'''Some injuries heal in weeks. Others linger for months — or years.

If you're still not fully recovered from a soft tissue injury, tendon tear, or post-surgical procedure, it may be because your tissue hasn't received the right environment to repair properly.

PEMF therapy creates that environment:
✅ Increases local blood flow and oxygenation
✅ Stimulates fibroblast activity (tissue repair cells)
✅ Reduces residual inflammation
✅ Accelerates cellular regeneration

At OHR in Clonmel, we work with clients who've exhausted physio and still aren't right. PEMF is often the missing piece.

Book a consultation. Let's assess where you are and build a targeted plan.''',
'Heal Stubborn Injuries — PEMF Therapy at OHR','Book a consultation'))

scripts.append(sc(14,'Sciatica','Sciatica Pain — When the Shooting Stops','Image / Video','30s','Facebook Feed',
'Blue Wave PEMF lists "Chronic Nerve & Back Pain Relief" as a primary use case. Therafy\'s cellular penetration mechanism copy maps directly to nerve pain — "reaches cells at the deepest level."',
'''That shooting pain down your leg. The tingling. The burning.

Sciatica is one of the most debilitating conditions we see at OHR — and one of the most responsive to PEMF therapy.

PEMF's electromagnetic pulses penetrate deep into the lumbar spine and surrounding tissue, reducing the inflammation that compresses the sciatic nerve and triggering the body's natural nerve repair process.

Clients with sciatica typically report:
✅ Reduced intensity of shooting pain
✅ Less numbness and tingling
✅ Improved mobility and posture

Results improve with consistency — but most clients feel something after their first session.

OHR Clonmel. Book this week.''',
'Sciatica Relief Without Surgery — Book PEMF at OHR','Book a session'))

scripts.append(sc(15,'Headaches / Migraines',"Migraines — When Painkillers Aren\'t Enough",'Image','N/A','Facebook Feed',
'Omnipemf: "Reduced stress and nervous system tension" and "Relief from pain and tension" are top-listed benefits. Neurological pain (headaches, migraines) maps directly to PEMF\'s nervous system modulation mechanism.',
'''If you get regular migraines or tension headaches, you already know the cycle:

Prodrome. Pain. Recovery. Repeat. 😔

Painkillers manage the symptom. They don't address the underlying vascular inflammation, nervous system sensitivity, or cortisol dysregulation that drives migraines.

PEMF therapy works on all three:
⚡ Reduces cerebrovascular inflammation
⚡ Calms the sensitised nervous system
⚡ Normalises cortisol patterns that trigger hormonal migraines

Most clients who use PEMF consistently report fewer headaches per month — not just less severe ones.

OHR Clonmel. Let's break the cycle.

Book a consultation today.''',
'Fewer Migraines. Less Pain. PEMF at OHR.','Book now'))

# ── Scripts 16–30: Mechanism & Education ──────────────────────────────────────
scripts.append(sc(16,'Education','What Is PEMF Therapy? (Explained Simply)','Image + Caption','N/A','Facebook Feed / Instagram',
'Omnipemf uses a clear educational approach: "PEMF therapy works gently with your body\'s natural rhythms." Therafy explains the 7.83Hz Schumann resonance mechanism. Educational content builds awareness before conversion.',
'''PEMF stands for Pulsed Electromagnetic Field therapy.

Here's what that means in plain English:

Your body's cells communicate using tiny electromagnetic signals. When cells are damaged, inflamed, or fatigued — those signals get disrupted.

PEMF therapy sends pulsed electromagnetic pulses into your tissue that:

⚡ Re-energise depleted cells
⚡ Reduce cellular inflammation
⚡ Stimulate natural repair processes
⚡ Support the nervous system's recovery state

Think of it as a charger for your cells.

It's been researched in over 10,000 clinical studies. It's used in hospitals, sports clinics, and recovery centres worldwide.

And now it's available in Clonmel at Optimal Health & Recovery.

Questions? DM us or book a free 10-minute discovery call.''',
'PEMF Explained — What It Is and How It Works','Learn more'))

scripts.append(sc(17,'Science','The Cellular Science Behind PEMF','Image','N/A','Facebook Feed',
'Therafy\'s most-run creative: "Medical-grade PEMF backed by 10,000+ studies. 7.83Hz frequency proven for cellular response." Science-credentialing is their second primary hook after scarcity.',
'''Every cell in your body is essentially a tiny battery. 🔋

Healthy cells hold a charge of -70 to -90 millivolts.
Inflamed, damaged, or fatigued cells? They drop to -50 mV or lower.

PEMF therapy — Pulsed Electromagnetic Field — recharges those depleted cells.

The electromagnetic pulse:
1. Restores the cell's natural membrane potential
2. Opens ion channels for nutrient absorption
3. Stimulates ATP (energy) production
4. Triggers the cellular repair cascade

This is why PEMF works across such a wide range of conditions — it operates at the level where all healing begins.

10,000+ clinical studies. Used in hospitals since the 1970s.

OHR Clonmel — clinical-grade PEMF. Book a session.''',
'The Science of PEMF — Cellular Healing Explained','Book a session'))

scripts.append(sc(18,'vs Painkillers','PEMF vs Painkillers — No Contest','Image','N/A','Facebook Feed / Instagram',
'Blue Wave PEMF: "non-invasive and drug-free" as a primary positioning statement. Elaris: "No appointments. No medication. Just lie down and let it work." The drug-free angle is prominent across 6+ advertisers.',
'''Painkillers manage pain. They don't heal anything.

And over time: dependency, gut damage, liver stress, reduced effectiveness.

PEMF therapy works on the cause — not the symptom.

By reducing inflammation and stimulating cellular repair, it addresses the biological reason you're in pain in the first place.

✅ No medication
✅ No dependency
✅ No side effects
✅ Works on the underlying cause

At OHR in Clonmel, we work with clients who are trying to reduce their reliance on anti-inflammatories and painkillers — or who simply want a drug-free alternative.

Your body is capable of healing. Sometimes it just needs the right signal.

Book a PEMF session. See for yourself.''',
'Drug-Free Pain Relief — PEMF at OHR Clonmel','Book now'))

scripts.append(sc(19,'vs Home Devices',"Clinic PEMF vs Home Mats — What\'s the Difference?",'Image','N/A','Facebook Feed',
'Multiple consumer PEMF mat brands active in the market (Elaris Body, MiraMate, Megelin, Omnipemf). Consumer mats typically deliver 50–200 Gauss. Clinical devices deliver 2,000–10,000+ Gauss. This is a key differentiator for clinic-based PEMF.',
'''You may have seen PEMF mats online. £300–£1,000 for a home device.

Here's what they don't tell you on the product page:

Consumer PEMF mats typically deliver 50–200 Gauss of intensity.

Clinical-grade PEMF equipment — the kind we use at OHR — delivers up to 10,000+ Gauss.

That's not a small difference. It's the difference between a gentle signal and a therapeutic one that reaches deep tissue, bone, and the nervous system.

Home mats are fine for maintenance and relaxation.

For actual therapeutic results — especially for chronic pain, injury recovery, or bone health — you need clinical power.

OHR Clonmel. Come and feel what real PEMF feels like.

Single sessions and packages available.''',
'Clinical PEMF vs Home Devices — Know the Difference','Book a clinical session'))

scripts.append(sc(20,'Session Experience','What Happens During a PEMF Session at OHR?','Image / Reel','N/A','Instagram / Facebook',
'The Oxygen Temple: "This isn\'t a spa treatment. It\'s a cellular-level approach." — sets realistic expectations. MiraMate: "Just 30 minutes before bed." Easy, low-barrier session experience copy converts hesitant first-timers.',
'''First time hearing about PEMF? Here's what a session at OHR looks like:

1️⃣ You arrive, get a brief consultation (we listen first)
2️⃣ You lie down fully clothed on our PEMF mat
3️⃣ The session runs 30–45 minutes
4️⃣ You feel a gentle warmth and pulsing sensation — or sometimes nothing at all
5️⃣ You leave

That's it.

No needles. No undressing. No recovery time.

Most clients describe it as relaxing. Some fall asleep on the mat. Some notice a difference immediately; others feel it the next morning.

OHR Clonmel — taking the unknown out of PEMF.

Book your first session online.''',
'Your First PEMF Session — Here\'s What to Expect','Book your first session'))

scripts.append(sc(21,'NASA / Research','Backed by NASA, Hospitals, and 10,000+ Studies','Image','N/A','Facebook Feed',
'Therafy: "Medical-grade PEMF backed by 10,000+ studies." Spooky2: "Built on Royal Rife\'s original design." Authority and research credentials are a recurring credibility hook across the highest-spending PEMF brands.',
'''PEMF therapy wasn't invented by a wellness influencer. 📚

It was developed in the 1950s and first approved by the FDA in the 1970s for non-union bone fractures.

NASA subsequently used PEMF research in their space programme to prevent bone loss and muscle atrophy in astronauts.

Today, over 10,000 clinical studies have been published on PEMF therapy's effects on:
• Pain and inflammation
• Bone density and healing
• Sleep and the nervous system
• Athletic recovery
• Cellular energy and ageing

OHR's clinical-grade PEMF equipment is built on this research — not on wellness trends.

Book a session in Clonmel. Experience what the science is about.''',
'Researched by NASA. Used in Hospitals. Now in Clonmel.','Book a PEMF session'))

scripts.append(sc(22,'PEMF + Infrared','PEMF + Infrared — The Combination That Works','Image','N/A','Facebook Feed',
'The Oxygen Temple and Livbetter both sell HBOT + Red Light + PEMF as a bundle. Megelin explicitly says "Stack it with your PEMF mat for the ultimate chill-out ritual." Combination therapy is a growing trend.',
'''One therapy is good. Two working together is different. ⚡🔴

At OHR in Clonmel, we offer both PEMF and Infrared Therapy — and many clients choose to combine them in the same session.

Here's why they work so well together:

🔴 Infrared Therapy:
→ Warms the tissue, increases circulation, opens cells to repair signals

⚡ PEMF Therapy:
→ Sends electromagnetic pulses deep into tissue, reducing inflammation at a cellular level

When combined, infrared prepares the tissue and PEMF does the deep work.

Clients report:
✅ Faster pain relief
✅ Deeper muscle relaxation
✅ Better recovery from training or injury

Ask us about our combination session packages.

OHR Clonmel — where therapies work together.''',
'PEMF + Infrared Combination Sessions at OHR','Book a combination session'))

scripts.append(sc(23,'PEMF + HBOT',"OHR\'s Most Powerful Recovery Combination",'Image','N/A','Facebook Feed',
'The Oxygen Temple\'s top-performing ad: HBOT + Red Light + PEMF for £100. Livbetter offers the same multi-modality bundle (plus infrared sauna, compression therapy, cold plunge). OHR\'s 4-modality advantage is the strongest differentiator in Tipperary.',
'''Recovery at the cellular level. Recovery at the tissue level. Recovery at the oxygen level.

At OHR in Clonmel, we offer three of the most clinically advanced recovery therapies under one roof:

🫁 HBOT (Hyperbaric Oxygen Therapy)
→ Floods your cells with pure oxygen under pressure

⚡ PEMF Therapy
→ Stimulates cellular repair and reduces inflammation electromagnetically

🔴 Infrared Therapy
→ Deep tissue warmth that relaxes muscle and improves circulation

Combine two — or all three — in a single visit.

This is the kind of protocol used by professional athletes and recovery clinics charging €300+ per session abroad.

At OHR Clonmel — it's available to you now.

Ask us about our multi-therapy packages.''',
'HBOT + PEMF + Infrared — OHR\'s Complete Recovery Suite','Ask about packages'))

scripts.append(sc(24,'Non-Invasive','No Needles. No Drugs. Just Results.','Image','N/A','Facebook Feed / Instagram',
'Every PEMF brand in the dataset uses "non-invasive" and "drug-free" as credibility anchors. Blue Wave: "non-invasive and drug-free, specifically designed to support..." Elaris: "No appointments. No medication."',
'''No injections. No prescriptions. No recovery time.

PEMF therapy is one of the few therapeutic interventions that achieves real clinical results with zero invasiveness.

You lie down, fully clothed. The electromagnetic field does its work through your clothes, through your skin, into your cells.

30–45 minutes later you walk out.

No side effects. No downtime. No dependency.

Just your body responding to a stimulus it was designed to respond to — the natural electromagnetic field it's been bathed in since before birth.

At OHR in Clonmel, we make world-class recovery accessible to everyone in Tipperary.

Book a session this week.''',
'Non-Invasive. Drug-Free. PEMF at OHR Clonmel.','Book now'))

scripts.append(sc(25,'Clinical Grade',"Consumer Mat vs Clinical PEMF — A Client\'s Story",'Video / Image','40s','Facebook Feed',
'Consumer PEMF mat brands (Elaris, MiraMate, Megelin) are spending heavily, creating mass awareness of PEMF — but also consumer confusion about effectiveness. This is an opportunity to position OHR\'s clinical equipment as categorically different.',
'''"I bought a PEMF mat online. It was fine. Relaxing. But the pain was still there."

We hear this a lot at OHR.

Home mats are a great starting point. But when you're dealing with chronic pain, a stubborn injury, or a serious health goal, relaxation isn't enough.

At OHR Clonmel, our clinical-grade PEMF delivers therapeutic-level electromagnetic intensity — the kind used in hospital-affiliated rehabilitation programmes.

One session on our equipment typically delivers more therapeutic input than a week of home mat use.

If you've tried a home PEMF mat and weren't impressed — you haven't tried PEMF properly yet.

Come in and feel the difference.''',
'Clinical PEMF vs Home Mat — Experience the Difference','Book a clinical session'))

scripts.append(sc(26,'Vagus Nerve','Vagus Nerve + PEMF — The Gut-Brain Reset','Image','N/A','Facebook Feed',
'Scieneldn positions PEMF as "nervous system reset. Cellular energy." Rē Precision Health includes "GutRēset Protocol" alongside PEMF in their multi-modal programs, suggesting gut-brain axis awareness in their marketing.',
'''Your vagus nerve is the longest nerve in your body — running from your brainstem to your gut.

It controls your stress response, your digestion, your immune function, and your mood.

When it's dysregulated — from chronic stress, poor sleep, or inflammation — everything suffers.

PEMF therapy directly stimulates vagal tone. The electromagnetic pulse activates the parasympathetic nervous system, calming the stress response and improving gut-brain communication.

Clients with:
🔵 Anxiety and nervous system dysregulation
🔵 IBS or gut sensitivity linked to stress
🔵 Chronic fatigue with no clear cause
🔵 Low heart rate variability

...often find PEMF to be the missing piece.

OHR Clonmel. Book a vagus nerve reset session.''',
'Vagus Nerve & Gut Health — PEMF Therapy at OHR','Book now'))

scripts.append(sc(27,'Immunity','Your Immune System Needs This in Winter','Image','N/A','Facebook Feed',
'Omnipemf: "Over 50,000 individuals worldwide have already experienced meaningful benefits." Cellular energy and reduced inflammation both directly support immune function — an underused PEMF benefit in advertising.',
'''Picking up every bug going around this winter? 😷

Chronic low-grade inflammation suppresses your immune system — making you more susceptible to illness, slower to recover, and more prone to recurring infections.

PEMF therapy:
⚡ Reduces systemic inflammation
⚡ Boosts cellular energy (ATP)
⚡ Supports lymphatic circulation
⚡ Activates the body's natural repair response

Think of it as a service for your immune system.

30–45 minutes at OHR in Clonmel. Book before the next wave hits.''',
'Support Your Immune System — PEMF Therapy at OHR','Book a session'))

scripts.append(sc(28,'Longevity','Age Better. Live Longer. Start at the Cell.','Image','N/A','Facebook Feed',
'Rē Precision Health: "A synergistic blend of modalities to address the physical, mental, emotional...factors that affect wellbeing and quality of life." Livbetter: "performance, longevity, and feeling your absolute best." Longevity is an emerging premium positioning angle.',
'''The secret to ageing well isn't a supplement. It's not a diet.

It's cellular health. 🔬

As we age, our cells produce less ATP, accumulate more oxidative damage, and become less efficient at repairing themselves.

PEMF therapy works directly on this process:
⚡ Stimulates mitochondrial function (energy at the cellular level)
⚡ Reduces cellular oxidative stress
⚡ Supports DNA repair mechanisms
⚡ Maintains cellular membrane integrity

Regular PEMF sessions are becoming a cornerstone of longevity protocols worldwide — alongside quality sleep, movement, and nutrition.

OHR Clonmel — longevity-focused recovery. Book your session.''',
'Cellular Longevity — PEMF as an Anti-Ageing Protocol','Book a longevity session'))

scripts.append(sc(29,'Wound Healing','Post-Surgery Recovery — Heal Faster with PEMF','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Enhanced Micro-circulation & Healing" as a primary benefit. FDA initially approved PEMF for bone fractures — the wound healing mechanism is well-established and a compelling post-surgical hook.',
'''Recovering from surgery? 🏥

PEMF therapy has been used in rehabilitation settings for decades to:
✅ Accelerate tissue healing post-operatively
✅ Reduce post-surgical inflammation and swelling
✅ Improve local circulation to the healing site
✅ Support bone knitting after orthopaedic procedures

Whether you've had a knee replacement, a hip procedure, a spinal surgery, or any soft tissue repair — PEMF can be a powerful addition to your post-operative rehabilitation.

Always cleared with your consultant first — and we'll work alongside your physio and medical team.

OHR Clonmel. Helping Tipperary recover smarter.''',
'Post-Surgery Recovery — PEMF Therapy at OHR Clonmel','Book a consultation'))

scripts.append(sc(30,'Circulation','Cold Hands, Circulation Problems — PEMF Helps','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Enhanced Micro-circulation & Healing." Omnipemf: "recovery, calm, and co..." — circulation improvement is a secondary but important PEMF benefit for conditions like Raynaud\'s and peripheral vascular issues.',
'''Cold hands and feet? Tingling? Poor circulation that no one seems to be able to fix?

PEMF therapy improves microcirculation — the flow of blood through your smallest capillaries — which is often the root cause of:

🔵 Persistent cold extremities
🔵 Numbness and tingling
🔵 Slow-healing skin wounds
🔵 Raynaud's phenomenon
🔵 Peripheral neuropathy symptoms

The electromagnetic pulse vasodilates (widens) the micro-vessels and stimulates red blood cell flexibility, improving delivery of oxygen and nutrients to peripheral tissue.

OHR Clonmel. Book a circulation session — and feel the warmth return.''',
'Poor Circulation — PEMF Therapy at OHR Clonmel','Book a session'))

# ── Scripts 31–45: Audience-specific ──────────────────────────────────────────
scripts.append(sc(31,'Athletes','Pre-Event PEMF — Prime Your Body Before You Compete','Video','30s','Instagram / Facebook',
'The Oxygen Temple and Livbetter both target athletes with "Recover faster. Improve energy and performance." X-CELLr8 targets HYROX and pitch athletes. Pre-event priming is an angle no local PEMF clinic currently runs.',
'''The morning before a big race, match, or competition.

Most athletes focus on nutrition and sleep. Elite athletes add one more thing: PEMF.

Pre-event PEMF priming:
⚡ Increases cellular energy (ATP) availability
⚡ Reduces background inflammation before the stress of competition
⚡ Improves neuromuscular signalling and reaction time
⚡ Supports optimal circulation to working muscles

30 minutes on the mat before your event — and your body enters the start line more prepared.

OHR Clonmel is open early. DM us to book a pre-event session.''',
'Pre-Event PEMF Priming — OHR Clonmel','Book a pre-event session'))

scripts.append(sc(32,'Runners','Runners: Fix the Issue Before It Becomes an Injury','Image','N/A','Facebook / Instagram',
'HorseHalo uses the hook "if your horse is stiff, sore, or not moving like they used to" — translates directly to runners dealing with niggles and tightness that haven\'t yet become full injuries.',
'''Every runner knows the feeling. 🏃

A niggle in the knee. Tightness in the IT band. A heel that's not quite right.

You carry on. You stretch more. You ice it.

And then one day it becomes a real injury.

PEMF therapy addresses soft tissue inflammation before it becomes structural damage.

30–45 minutes on the mat at OHR:
✅ Reduces tendon and fascia inflammation
✅ Accelerates micro-tear repair between runs
✅ Improves circulation to repetitive-strain areas

Clonmel runners — come in between training blocks. Your knees, IT band, and Achilles will thank you.

Book online or DM us.''',
'Runners — Fix Niggles Before They Become Injuries','Book a session at OHR'))

scripts.append(sc(33,'GAA Players','GAA Season Takes a Toll. Recover Smarter.','Image','N/A','Facebook Feed',
'X-CELLr8 targets "smashing HYROX training, pushing your limits on the pitch" — the pitch athlete is an explicit PEMF target. GAA-specific copy is a major local opportunity for OHR in Tipperary.',
'''Championship season. Back-to-back matches. Training Tuesday, Thursday, Sunday. 🏐

Your body is taking a battering — and the standard recovery (ice bath, sleep, ibuprofen) isn't cutting it anymore.

PEMF therapy is used by professional rugby, soccer, and GAA performance teams to:
⚡ Flush out lactic acid and metabolic waste faster
⚡ Reduce muscle damage inflammation overnight
⚡ Repair soft tissue micro-tears between sessions
⚡ Support joint health through a long season

30–45 minutes at OHR in Clonmel. You'll feel it in your next session.

Tipperary clubs — ask us about team recovery packages.''',
'GAA Recovery — PEMF Therapy at OHR Clonmel','Book a recovery session'))

scripts.append(sc(34,'Over 60s','60+ and Feeling It? Your Cells Need Support.','Image','N/A','Facebook Feed',
'Omnipemf targets "sleep better, stress less, and focus more" for a general adult audience. The over-60 demographic has the highest concentration of PEMF-treatable conditions: arthritis, osteoporosis, poor sleep, fatigue.',
'''Getting older doesn't have to mean hurting more. 🌿

After 60, your cells naturally produce less energy, recover more slowly, and accumulate more inflammation. It's not inevitable — it's cellular.

PEMF therapy gives older cells the electromagnetic signal they need to:
✅ Reduce joint inflammation and stiffness
✅ Support bone density and structure
✅ Improve circulation and tissue healing
✅ Enhance sleep quality
✅ Boost daily energy levels

Gentle. Non-invasive. Fully clothed. No impact on medications.

OHR Clonmel — trusted by Tipperary clients of all ages.

Book a consultation and let's talk about what PEMF can do for you.''',
'PEMF for Over 60s — Gentle, Effective, Drug-Free','Book a consultation'))

scripts.append(sc(35,"Women\'s Health",'Hormonal Pain? PEMF Works on the Cause.','Image','N/A','Facebook Feed / Instagram',
'Rē Precision Health runs female-targeted wellness programs. Therafy\'s breast cancer ads show willingness to target women with specific health concerns. Hormonal pain (period pain, endometriosis, menopause) is an underserved PEMF angle.',
'''Period pain. Endometriosis. Menopause-related joint aches. PCOS inflammation.

These are conditions that are under-researched, under-treated, and frequently dismissed.

PEMF therapy works on the underlying biological driver most of them share: inflammation.

For women dealing with:
🌸 Chronic pelvic pain and period cramps
🌸 Endometriosis-related inflammation
🌸 Menopausal joint pain and fatigue
🌸 PCOS-related systemic inflammation

PEMF reduces the inflammatory load at a cellular level — without hormones, without drugs.

OHR Clonmel — a safe, evidence-informed space for women's health.

Book a consultation. Let's talk properly.''',
'PEMF for Women\'s Health — OHR Clonmel','Book a consultation'))

scripts.append(sc(36,'Menopause','Menopause Is Hard Enough. Let PEMF Help.','Image','N/A','Facebook / Instagram',
'The menopause wellness market is growing rapidly in Ireland. No PEMF brand in the dataset specifically targets menopause — this is a clear gap OHR can own locally in Tipperary.',
'''Hot flushes. Joint pain. Brain fog. Broken sleep. Mood swings.

Menopause isn't just hormonal — it drives a systemic inflammatory shift that affects every tissue in the body.

PEMF therapy supports menopausal women by:
⚡ Reducing inflammatory joint and muscle pain
⚡ Improving sleep architecture (Delta wave support)
⚡ Supporting bone density (critical post-menopause)
⚡ Calming the nervous system and cortisol response

It won't replace your HRT conversation with your GP — but it's a powerful complementary tool that many women find transformative.

OHR Clonmel — Tipperary's clinical-grade PEMF clinic.

Book a women's health consultation.''',
'Menopause Support — PEMF Therapy at OHR Clonmel','Book now'))

scripts.append(sc(37,'Postpartum','Postpartum Recovery — Give Your Body What It Needs','Image','N/A','Facebook / Instagram',
'Rē Precision Health\'s multi-modality approach to full-body recovery maps to postpartum recovery. No PEMF brand targets new mothers directly — a significant gap for OHR to fill locally.',
'''Having a baby is one of the most physically demanding things a body can go through.

Months later, many new mothers are still dealing with:
😔 Pelvic floor inflammation and healing
😔 Back and hip pain from pregnancy posture
😔 Exhaustion that sleep alone doesn't fix
😔 Hormonal inflammation affecting joints and mood

PEMF therapy supports postpartum recovery by:
✅ Accelerating soft tissue healing
✅ Reducing pelvic and spinal inflammation
✅ Boosting cellular energy to fight exhaustion
✅ Calming the nervous system for better sleep

Safe. Non-invasive. No drugs.

OHR Clonmel — because mothers deserve recovery too.

Book a postpartum consultation.''',
'Postpartum PEMF Recovery at OHR Clonmel','Book a consultation'))

scripts.append(sc(38,'Office Workers','Desk Job? Your Body is Paying the Price.','Image','N/A','Facebook Feed',
'Scieneldn targets "women and men in their 30s, 40s, 50s, already doing the work" — the motivated professional. Office worker posture-related pain (back, neck, shoulder) is one of the largest chronic pain demographics.',
'''8 hours a day at a desk. Shoulders creeping toward your ears. Lower back tightening. Neck that clicks every time you turn. 😬

Sedentary posture compresses your spinal discs, restricts blood flow to soft tissue, and creates the perfect environment for chronic inflammation to build.

PEMF therapy is uniquely effective for desk-related conditions:
✅ Deep spinal tissue that's too compressed for massage to reach
✅ Nerve irritation from disc pressure
✅ Muscle holding patterns from prolonged static posture
✅ Circulation restriction to the upper back and shoulders

30–45 minutes on the mat at OHR after your workday.

You'll notice the difference within a session.''',
'Desk Workers — PEMF for Back, Neck & Shoulder Pain at OHR','Book a session'))

scripts.append(sc(39,'Manual Workers','Builders, Farmers, Trades — Your Body is Your Business.','Image','N/A','Facebook Feed',
'Blue Wave PEMF targets physical recovery for tissue damage broadly. Livbetter targets athletes but the copy ("your body does the work, now give it the recovery") applies equally to manual workers.',
'''Your body is your livelihood. You can't afford to be off.

Years of physical work — lifting, digging, bending, carrying — creates cumulative micro-damage in joints, tendons, and the spine.

PEMF therapy helps your body stay in the game:
⚡ Reduces joint inflammation before it becomes structural
⚡ Supports tendon and ligament health under load
⚡ Accelerates recovery from hard physical days
⚡ Addresses back and knee pain before it becomes chronic

At OHR Clonmel, we see farmers, builders, tradespeople, and physical workers who want to keep working — not end up on the operating table.

This is an investment in your career and your quality of life.

Book a session. Keep yourself operational.''',
'Built for People Who Use Their Bodies — PEMF at OHR','Book a session'))

scripts.append(sc(40,'Busy Parents','For the Parent Who Puts Everyone Else First','Image','N/A','Facebook / Instagram',
'Elaris Body\'s "No appointments. No medication. Just lie down and let it work." removes every friction point that busy parents face. The caregiver-giving-to-self angle is used in IR scripts and equally relevant here.',
'''You put the kids first. Always.

But when was the last time you gave your body 45 minutes?

If you're a parent running on empty — managing pain, poor sleep, stress, and exhaustion — PEMF therapy might be the most productive 45 minutes you spend this month.

One session at OHR:
✅ Lie down, fully clothed
✅ Let the electromagnetic field do the work
✅ Walk out with less pain and more energy

No prep. No recovery. No commitment.

You spend all day taking care of everyone else.

One session at OHR is how you take care of yourself.

Saturday morning slots available. Book online.''',
'You Give Everything. Give Yourself 45 Minutes. OHR PEMF.','Book a Saturday session'))

scripts.append(sc(41,'Night Shift Workers','Night Shift Wrecking Your Body? PEMF Helps.','Image','N/A','Facebook Feed',
'MiraMate and Omnipemf both target disrupted sleep patterns. Night shift workers have disrupted circadian rhythms, higher inflammation, and poorer cellular recovery — making them an ideal PEMF audience.',
'''Night shift destroys your circadian rhythm. Your cells know it. ⏰

Sleep deprivation drives:
• Elevated cortisol and inflammation
• Suppressed immune function
• Accelerated cellular aging
• Chronic fatigue that doesn't lift with "recovery days"

PEMF therapy helps night workers by:
⚡ Supporting cellular recovery despite disrupted sleep cycles
⚡ Reducing systemic inflammation caused by circadian disruption
⚡ Improving sleep quality during daytime rest periods
⚡ Boosting cellular energy when your body is running on deficit

One session at OHR Clonmel, booked around your schedule.

We have early morning and evening slots. Night workers welcome.''',
'Night Shift Recovery — PEMF at OHR Clonmel','Book around your schedule'))

scripts.append(sc(42,'Students','Exam Stress and Sleep Deprivation — Try This Instead of Energy Drinks','Image','N/A','Facebook / Instagram',
'Omnipemf: "Enhanced focus and mental clarity" and "deeper, uninterrupted sleep." Student exam stress is a combination of sleep disruption, nervous system overload, and cognitive fatigue — all PEMF-targetable.',
'''Exam season. Late nights. Bad sleep. Brain fog you're masking with caffeine. 📚

Here's the problem: stress and sleep deprivation literally impair memory consolidation. Your brain can't learn and retain when it's in cortisol overload.

A 30-minute PEMF session at OHR:
✅ Activates the parasympathetic (rest) nervous system
✅ Reduces the cortisol response
✅ Supports Delta and Theta wave patterns for deep memory consolidation
✅ Leaves you clearer and more focused than a coffee ever could

One session before your next study block. See what your brain can do when it's properly recovered.

OHR Clonmel. Student rates available — ask us.''',
'Exam Season Support — PEMF at OHR Clonmel','Book a student session'))

scripts.append(sc(43,'Caregivers',"Caregivers — You Can\'t Pour From an Empty Cup",'Image','N/A','Facebook Feed / Instagram',
'Rē Precision Health\'s programs are described by clients as "the best gift I have ever given myself." The caregiver-giving-to-self angle resonates strongly with a demographic that consistently de-prioritises their own health.',
'''You look after a parent. A spouse. A child with complex needs.

You carry the physical and emotional weight of it every single day.

But chronic stress, broken sleep, and physical strain are taking a toll on your body too — and nobody's asking how you are.

One 45-minute PEMF session at OHR is not a luxury. It's maintenance.

It reduces the inflammation that stress builds. It resets the nervous system you're running on empty. It gives your cells the energy signal they've been missing.

Book it for yourself. Guilt-free.

OHR Clonmel — flexible appointments around your caring schedule.''',
'Caregivers — PEMF Recovery at OHR Clonmel','Book a session for yourself'))

scripts.append(sc(44,'Corporate / Burnout','Burning Out at Work? Your Body Is Already in Crisis.','Image','N/A','Facebook / LinkedIn',
'Scieneldn founder Jane Beaman: "the people I was seeing, women and men in their 30s, 40s, 50s, were already doing the work... They didn\'t want a fix. They wanted to keep going." This is the corporate burnout audience perfectly described.',
'''You're not lazy. You're not weak.

You're a high-performing professional who's been running on cortisol for too long.

Burnout is a biological state — chronic sympathetic nervous system activation that depletes cellular energy, suppresses immunity, disrupts sleep, and erodes cognitive performance.

PEMF therapy is the clinical reset your body needs:
🔵 Activates the parasympathetic "rest and repair" response
🔵 Reduces cortisol-driven inflammation
🔵 Restores cellular ATP production
🔵 Supports sleep depth and quality

One 45-minute session at OHR. Come in wound up. Leave reset.

Clonmel and surrounding Tipperary — weekday and Saturday appointments available.''',
'Corporate Burnout — Nervous System Reset at OHR','Book a reset session'))

scripts.append(sc(45,'Weekend Warriors','Weekend Warriors — Protect the Body You Rely On','Image','N/A','Facebook / Instagram',
'Livbetter and The Oxygen Temple target gym-goers and athletes with "your body does the work, now give it the recovery it deserves." Weekend athletes often undertrain recovery relative to their training volume.',
'''5 days a week at a desk. Saturday morning 10k. Sunday morning football.

Your body is working harder than it's being given credit for.

Weekend warrior syndrome — sporadic high-intensity effort with inadequate recovery — leads to overuse injuries, stubborn soreness, and eventually time off.

PEMF therapy between sessions:
⚡ Clears inflammation from intense weekend effort
⚡ Accelerates soft tissue repair mid-week
⚡ Prepares the body for the next bout before it's ready on its own

30–45 minutes at OHR. Book Wednesday. Feel right for the weekend.''',
'Weekend Warriors — Mid-Week PEMF Recovery at OHR','Book a Wednesday session'))

# ── Scripts 46–60: Specific conditions ────────────────────────────────────────
scripts.append(sc(46,'Plantar Fasciitis','Plantar Fasciitis — When Every Step Hurts','Image','N/A','Facebook Feed',
'Blue Wave PEMF targets "Deep Tissue Inflammation Reduction" and soft tissue healing. Plantar fasciitis is one of the most prevalent and frustrating musculoskeletal conditions, with few effective conservative treatments.',
'''That first step out of bed in the morning.

Sharp. Stabbing. Like walking on broken glass. 😔

Plantar fasciitis is notoriously stubborn because the fascia has poor blood supply — and without blood supply, it can't heal properly.

PEMF therapy addresses this directly:
✅ Dramatically increases local microcirculation to the fascia
✅ Reduces the inflammatory load at the attachment point
✅ Stimulates fibroblast activity for tissue repair
✅ Breaks the pain-inflammation cycle without surgery

Clients with plantar fasciitis often report improvement faster with PEMF than months of rest and orthotics.

OHR Clonmel. Book a foot pain consultation.''',
'Plantar Fasciitis Relief — PEMF at OHR Clonmel','Book a foot consultation'))

scripts.append(sc(47,'Shoulder Pain','Rotator Cuff and Shoulder Pain — Fix It Properly','Image','N/A','Facebook Feed',
'Omnipemf: "Relief from pain and tension — target key areas with PEMF therapy." Shoulder injuries (rotator cuff, impingement, frozen shoulder) are among the most common reasons people seek non-surgical interventions.',
'''Shoulder pain that interrupts your sleep. Can't reach above your head. Can't lie on that side.

Rotator cuff injuries, impingement, and frozen shoulder are among the most stubborn musculoskeletal conditions because the shoulder joint has complex blood supply patterns and heals slowly.

PEMF therapy supports shoulder recovery by:
⚡ Penetrating deep into the joint capsule and rotator cuff tissue
⚡ Reducing the local inflammatory burden
⚡ Stimulating collagen production for tendon repair
⚡ Supporting circulation in a naturally low-vascularity area

OHR Clonmel. Let's assess your shoulder and build a PEMF plan.''',
'Shoulder Pain Relief — Clinical PEMF at OHR Clonmel','Book a shoulder consultation'))

scripts.append(sc(48,'Knee Pain','Knee Pain Without the Surgery','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Bone & Joint Regeneration" as top use case. Knee pain is one of the highest-volume conditions seeking non-surgical intervention, particularly in the 40-65 age group.',
'''Your GP says "lose weight and come back in a year."
Your physio gives you exercises that hurt.
Surgery is mentioned but you're not ready for that.

There's a step most people skip: PEMF therapy.

Clinical research on PEMF for knee conditions shows:
✅ Significant reduction in joint inflammation
✅ Improved cartilage nutrition (critical for degeneration)
✅ Measurable decrease in pain scores
✅ Improved function and range of motion

PEMF doesn't rebuild a destroyed joint — but for most people with knee pain, the joint isn't destroyed yet. It's inflamed, compressed, and crying out for cellular support.

OHR Clonmel. Come in before you book the surgery consultation.''',
'Knee Pain Without Surgery — PEMF at OHR Clonmel','Book a knee consultation'))

scripts.append(sc(49,'Hip Pain','Hip Pain — Walk Pain-Free Again','Image','N/A','Facebook Feed',
'Blue Wave PEMF and Omnipemf both speak to joint pain broadly. Hip pain (bursitis, impingement, OA) is a primary driver of reduced mobility and quality of life in the 50+ demographic.',
'''Hip pain that makes you think twice before getting up from the sofa.

That grinding, aching feeling with every step.

Whether it's bursitis, hip impingement, or early osteoarthritis — PEMF therapy can address the root driver: inflammation.

Electromagnetic pulses reach deep into the hip joint capsule and surrounding tissue:
⚡ Reducing synovial inflammation
⚡ Supporting cartilage cell health
⚡ Improving local circulation
⚡ Easing the muscle tension that develops as compensation

Most clients notice reduced stiffness within 3–5 sessions. Many notice it after the first.

OHR Clonmel. Walk in sore, walk out with a plan.''',
'Hip Pain Relief — PEMF Therapy at OHR Clonmel','Book a hip consultation'))

scripts.append(sc(50,'Neck Pain','Neck Pain and Stiffness — 30 Minutes on the Mat','Image','N/A','Facebook / Instagram',
'Omnipemf: "Relief from pain and tension." Blue Wave: "Chronic Nerve & Back Pain Relief." Neck pain is a near-universal complaint that often doesn\'t respond fully to massage or physio because the underlying inflammation isn\'t addressed.',
'''That neck stiffness that makes reversing the car painful. 😬

The headache that starts in your shoulders and travels up.

Neck pain is rarely just muscular — it often involves disc inflammation, nerve irritation, and the deep cervical tissue that massage barely touches.

PEMF therapy reaches where hands can't:
✅ Deep cervical disc and joint inflammation
✅ Compressed nerve root irritation
✅ Cervicogenic headache patterns
✅ Tension that builds in thoracic posture

30 minutes on the mat at OHR and most clients walk out with measurably less tension.

Book this week — cervical conditions respond well to PEMF.''',
'Neck Pain Relief — PEMF at OHR Clonmel','Book a neck pain session'))

scripts.append(sc(51,'Tennis Elbow',"Tennis Elbow — When Rest Alone Isn\'t Enough",'Image','N/A','Facebook Feed',
'The IR section of the OHR report covers "tennis elbow/chronic injury" as a major IR angle. PEMF has well-documented research for lateral epicondylitis and tendinopathy, making this a crossover opportunity.',
'''6 months of rest. Icing. A brace. Physio. And it's still there.

Tennis elbow (lateral epicondylitis) is stubborn because tendons have poor blood supply. Without adequate circulation, the inflammatory cycle never fully resolves.

PEMF therapy breaks this cycle by:
⚡ Dramatically increasing local microcirculation
⚡ Reducing tendon inflammatory markers
⚡ Stimulating tenocyte (tendon cell) regeneration
⚡ Accelerating healing that rest alone can't deliver

Clinical trials on PEMF for tendinopathy show significant improvement in pain and function versus rest-alone protocols.

OHR Clonmel. Let's end the tennis elbow cycle properly.''',
'Tennis Elbow Relief — PEMF at OHR Clonmel','Book a consultation'))

scripts.append(sc(52,'CFS / ME','Chronic Fatigue Syndrome — Finally, Something That Works at the Cell','Image','N/A','Facebook Feed',
'Omnipemf: "Over 50,000 individuals worldwide... feel more balanced, focused, and at ease." MiraMate: "Boosts cellular energy." CFS/ME patients are one of the most underserved groups, and ATP/mitochondrial function is directly relevant.',
'''If you have CFS or ME, you already know the explanations and the dismissals.

"It's just tiredness." "Exercise more." "Have you tried therapy?"

What the research increasingly shows is that CFS involves mitochondrial dysfunction — your cells genuinely cannot produce enough energy.

PEMF therapy is one of the few non-pharmacological interventions that directly stimulates mitochondrial function and ATP production.

Clients with CFS at OHR report:
✅ Improved energy windows
✅ Reduced post-exertional fatigue
✅ Better quality sleep
✅ Reduced background pain

We work at your pace. No pushing. No pressure.

OHR Clonmel. A clinic that takes CFS seriously.''',
'CFS/ME Support — PEMF Therapy at OHR Clonmel','Book a CFS consultation'))

scripts.append(sc(53,'MS','MS Support — Managing Fatigue and Inflammation','Image','N/A','Facebook Feed',
'Omnipemf and Blue Wave both speak to nervous system and neurological conditions. PEMF has published research on MS symptom management, particularly fatigue and spasticity — an underserved but highly motivated niche.',
'''Living with MS means managing a nervous system that's working against itself.

The fatigue. The spasticity. The inflammation that fluctuates with every stress and season.

PEMF therapy is being studied and used adjunctively in MS management for:
✅ Neurological fatigue reduction
✅ Muscle spasticity relief
✅ Systemic inflammatory load reduction
✅ Sleep improvement (disrupted in most MS patients)

We always recommend discussing with your neurologist before starting — and we're happy to provide literature to support that conversation.

OHR Clonmel — a safe, evidence-informed space for complex conditions.

Book a consultation.''',
'MS Symptom Support — PEMF Therapy at OHR','Book a consultation'))

scripts.append(sc(54,'Skin / Collagen','Skin Glow From the Inside Out — PEMF','Image','N/A','Instagram / Facebook',
'The IR report covered collagen/skin heavily. For PEMF, circulation improvement drives skin health. No PEMF brand in the dataset leads with skin — making this a differentiated angle for OHR.',
'''The wellness industry sells you skincare from the outside in.

PEMF works from the inside out. 🌿

By stimulating circulation and cellular repair, PEMF therapy:
⚡ Increases oxygen and nutrient delivery to skin cells
⚡ Stimulates fibroblast activity (collagen production)
⚡ Reduces the inflammatory signals that cause skin flares
⚡ Supports lymphatic drainage and waste removal

The result? Skin that looks healthier because it actually is healthier at the cellular level.

No topical products. No treatments. Just your own biology doing what it was designed to do.

OHR Clonmel. Book a skin health PEMF session.''',
'Skin Health and Collagen — PEMF at OHR Clonmel','Book now'))

scripts.append(sc(55,"Raynaud\'s",'Raynaud\'s — Finally, Warm Hands','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Enhanced Micro-circulation & Healing." Raynaud\'s phenomenon is directly driven by impaired microvascular circulation — a primary PEMF mechanism. Very niche but highly motivated audience.',
'''If you have Raynaud's, you know the drill. 🧊

Cold room. Stress. A slight breeze. And your fingers go white, then blue, then red — and the burning starts.

Raynaud's is a microvascular condition. Your smallest blood vessels overreact to stimuli, spasming and cutting off circulation.

PEMF therapy works directly on microvascular function:
✅ Improves endothelial health (the lining of your blood vessels)
✅ Reduces the vasospasm response
✅ Supports peripheral circulation throughout the body
✅ Over time, many clients experience milder and less frequent episodes

OHR Clonmel. We've seen results with Raynaud's. Book a circulation consultation.''',
'Raynaud\'s Syndrome — PEMF Circulation Support at OHR','Book a consultation'))

# ── Scripts 56–70: Hooks & Formats ────────────────────────────────────────────
scripts.append(sc(56,'Question Hook','Still Taking Anti-Inflammatories Every Day?','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "non-invasive and drug-free" — positioned directly against medication. Question hooks outperform statement hooks in cold audience cold-stop testing, based on Therafy\'s volume testing (36 variants).',
'''Still taking ibuprofen every morning just to function? 💊

Anti-inflammatories treat the symptom — and they do it well, short-term.

But long-term daily NSAID use is associated with:
⚠️ Gut lining damage and ulcers
⚠️ Elevated cardiovascular risk
⚠️ Kidney strain over time
⚠️ Reduced effectiveness (tolerance)

PEMF therapy doesn't block inflammation signals. It addresses the cellular environment producing them.

Clinical-grade. Non-invasive. No side effects.

If you've been managing chronic inflammation with pills for months or years — it might be time to try something that works on the cause.

OHR Clonmel. Book a consultation this week.''',
'There\'s a Better Way Than Daily Anti-Inflammatories','Book a consultation'))

scripts.append(sc(57,'Stat Hook',"10,000+ Clinical Studies. Here\'s What They Found.",'Image','N/A','Facebook Feed',
'Therafy\'s "Medical-grade PEMF backed by 10,000+ studies" is their most repeated credibility hook — appearing in their science-focused creative variants. Stat hooks build instant authority for a therapy most people haven\'t heard of.',
'''10,000+.

That's how many clinical studies have been published on PEMF therapy since the 1970s.

Here's what they consistently show:
✅ Significant pain reduction in arthritis and chronic pain
✅ Accelerated fracture healing and bone density support
✅ Improved sleep quality and depth
✅ Reduced inflammation markers at a cellular level
✅ Enhanced athletic recovery and performance
✅ Neurological and nervous system support

This isn't a wellness trend. It's half a century of clinical research.

OHR Clonmel now offers clinical-grade PEMF for Tipperary.

Book your first session and add the research to your own experience.''',
'The Clinical Science Behind PEMF — 10,000+ Studies','Book now'))

scripts.append(sc(58,'Empathy Hook',"Your Doctor Probably Didn\'t Mention This",'Image','N/A','Facebook Feed',
'Rē Precision Health: "Not another wellness retreat. The result of 15 years of research." — positions as insider knowledge. Empathy + authority hooks ("what they didn\'t tell you") are strong for chronic condition audiences who feel dismissed.',
'''Your doctor has 8 minutes with you.

They're doing their best — but there's a protocol to follow.

Painkillers for the pain. Physio for the physio. Come back if it doesn't improve.

What often doesn't come up: PEMF therapy.

Clinically researched since the 1970s. FDA-cleared in the US for bone conditions. Used in hospital rehab settings across Europe.

But it's not in the prescription pad system. So most patients never hear about it.

Now you have.

OHR Clonmel — where you get access to what's working in clinical recovery worldwide.

Book a session.''',
'What Most GPs Don\'t Have Time to Tell You — PEMF at OHR','Book a session'))

scripts.append(sc(59,'Before / After','From Barely Walking to Back on the Pitch — PEMF','Video / Image','45s','Facebook Feed / Instagram',
'Rē Precision Health testimonial ad leads with 10 back-to-back client quotes: "literally walked out a changed person", "best decision I have ever made." Testimonial-format is the highest-trust ad format in wellness.',
'''"I came in barely walking. My knee had been wrong for two years.

I'd done physio. I'd done injections. I was looking at surgery.

After 6 sessions of PEMF at OHR, I was back on the training pitch.

I'm not saying it's magic. I'm saying it worked when nothing else did."

— [Name withheld for privacy, Tipperary]

PEMF therapy. Clinical-grade. Available in Clonmel.

If you're dealing with a stubborn injury or chronic condition, let's talk.

Book a free 10-minute discovery call at OHR.''',
'Real Results from PEMF — Client Story at OHR Clonmel','Book a free call'))

scripts.append(sc(60,'Objection Handling',"Tried Everything? You Haven\'t Tried This Yet.",'Image','N/A','Facebook Feed',
'Rē Precision Health\'s "Not another wellness retreat" directly handles the sceptic objection. This objection-handling approach is most effective for exhausted chronic condition sufferers who\'ve been burned by previous therapies.',
'''"I've tried everything."

We hear this often at OHR. And we believe you.

Physio. Acupuncture. Chiro. Cortisone. Supplements. Surgery consultations.

If you're still in pain despite all of that — you haven't tried PEMF therapy. Not properly.

Consumer PEMF mats, maybe. But not clinical-grade PEMF delivered at therapeutic intensity, targeted to your specific condition.

There's a reason PEMF is used in hospital-affiliated recovery programmes worldwide.

It works differently from everything else — at the cellular level, not the symptomatic level.

One session at OHR. Come in as a sceptic. We welcome that.''',
'Nothing Has Worked? Try PEMF — Clinical-Grade at OHR','Book a session'))

scripts.append(sc(61,'Retargeting',"You Saw Us. You Were Interested. Here\'s Why Now.",'Image','N/A','Facebook / Instagram',
'Therafy\'s "⏳ Limited batch. When it\'s gone, you\'re waiting months for the next one." is their retargeting hook — creating urgency for people who\'ve already considered the product. Retargeting ads should acknowledge the hesitation and remove the remaining barrier.',
'''You looked us up. Maybe you were curious.

Maybe you've been managing pain for a while and something finally made you wonder if there's another way.

Here's what's stopping most people: the unknown.

"What is it exactly?" "Will it work for my condition?" "Is it worth it?"

We get it. That's why we offer a free 10-minute discovery call before any session.

No hard sell. No pressure. Just a proper conversation about whether PEMF is right for you.

You were curious for a reason. Let's explore it.

OHR Clonmel. Book a free call this week.''',
'Still Thinking About It? Book a Free Call First.','Book a free discovery call'))

scripts.append(sc(62,'Minimalist','30 Minutes. Clinical-Grade PEMF. OHR Clonmel.','Image','N/A','Facebook / Instagram',
'Elaris Body\'s minimalist creative "Less pain. More energy. Better sleep. / No appointments. No medication. Just lie down and let it work." strips everything back. Minimalist copy consistently wins in saturated feeds.',
'''Lie down. Fully clothed.

30–45 minutes.

Get up with less pain, more energy, and better sleep.

That's PEMF therapy at Optimal Health & Recovery in Clonmel.

No needles. No drugs. No prep. No recovery time.

10,000+ clinical studies.

Clinical-grade equipment.

Available in Tipperary now.

→ Book online at optimalhealthatinspire.ie''',
'Less Pain. More Energy. Better Sleep. — OHR PEMF','Book online'))

scripts.append(sc(63,'Problem-Agitate-Solve','You\'re Not Getting Older. You\'re Getting More Inflamed.','Image','N/A','Facebook Feed',
'Therafy\'s science-heavy copy and Blue Wave\'s condition-specific approach both use problem awareness as the entry point. The PAS (Problem-Agitate-Solve) framework is one of the highest-converting structures in wellness advertising.',
'''You're not getting older. Your inflammation is getting worse.

The morning stiffness. The energy crash by 2pm. The sleep that doesn't recover you. The weight that won't budge no matter what you eat.

These aren't signs of age. They're signs of chronic cellular inflammation — and it compounds over time if nothing addresses it.

PEMF therapy is the intervention that works at the cellular level to break the cycle.

Not a supplement. Not a lifestyle adjustment. An electromagnetic intervention that stimulates your cells to do what they were designed to do.

OHR Clonmel — clinical-grade PEMF for Tipperary.

Book a session. Address what's actually happening.''',
'It\'s Not Age. It\'s Inflammation. Fix It with PEMF at OHR.','Book now'))

scripts.append(sc(64,'What If Hook','What If You Woke Up Without Pain Tomorrow?','Image','N/A','Facebook / Instagram',
'Omnipemf\'s vision-forward copy: "Help those you care about sleep better, stress less, and focus more" — aspirational future-state hooks. "What if" hooks are effective for chronic pain audiences who have stopped imagining life without pain.',
'''What if you woke up tomorrow and the pain was 30% less?

Not gone. Not cured. Just... less.

What would you do that you haven't been doing?

Walk the dog without thinking about your knee. Play with the grandkids on the floor. Make it through the day without reaching for ibuprofen.

PEMF therapy doesn't promise miracles. It works through consistent, targeted cellular intervention.

But the people who book that first session at OHR are usually the ones who, 6 sessions later, remember the question: "What if it actually works?"

What if it does? Book and find out.''',
'What If You Woke Up With Less Pain? — OHR PEMF','Book your first session'))

scripts.append(sc(65,'FAQ Format','Your PEMF Questions — Answered','Image / Carousel','N/A','Facebook Feed',
'Scieneldn uses a founder-voice educational approach: "Sciene exists because the people I was seeing..." FAQ-format content builds trust with undecided audiences and reduces pre-purchase anxiety.',
'''Q: Does PEMF therapy hurt?
A: No. Most people feel nothing, or a gentle warmth and pulsing. Many fall asleep on the mat.

Q: How many sessions do I need?
A: Some people feel a difference after one session. For chronic conditions, we typically recommend a course of 6–10.

Q: Is it safe?
A: Yes. PEMF has a 50+ year safety record. It's contraindicated for people with pacemakers or active implants — ask us if you're unsure.

Q: How is it different from home PEMF mats?
A: Clinical intensity. Our equipment is 10–50x more powerful than consumer devices.

Q: Can I combine it with other therapies?
A: Yes — PEMF combined with Infrared or HBOT at OHR produces excellent results.

Book your first session at OHR Clonmel. Questions welcome — always.''',
'PEMF Therapy FAQs — Everything You Need to Know','Book now or DM us'))

# ── Scripts 66–80: Offers & Angles ────────────────────────────────────────────
scripts.append(sc(66,'Intro Offer','Try PEMF This Week — First Session Available','Image','N/A','Facebook Feed',
'The Oxygen Temple intro offer (£100 welcome bundle) and Livbetter\'s "7-day trial, 8 credits" both use low-friction entry offers to drive first-time bookings. Intro offers consistently outperform full-price first-session ads.',
'''Curious about PEMF therapy but not sure if it's for you?

Book a single introductory session at OHR Clonmel this week.

Lie down. Fully clothed. 30–45 minutes.

Clinical-grade electromagnetic therapy — the kind used in hospital rehabilitation programmes and professional sports recovery.

No commitment beyond a single session.

If you feel a difference — and most people do — we'll talk about what a plan looks like for your specific goals.

If you don't — you've spent 45 minutes lying down. You'll survive.

Book online. Spaces are limited this week.''',
'Try PEMF at OHR — Single Session Available This Week','Book a session now'))

scripts.append(sc(67,'Package','Commit to a Course — PEMF Gets Better with Consistency','Image','N/A','Facebook Feed',
'MiraMate: "Experience the future of wellness today." Omnipemf\'s large user base (50,000+) implies consistent use. PEMF results compound with regular sessions — package messaging converts clients who are already interested.',
'''One PEMF session can relieve pain and boost energy.

Six to ten sessions can change how your body functions at baseline.

PEMF works best with consistency:
⚡ Each session builds on the last
⚡ The cellular repair cascade deepens over time
⚡ Anti-inflammatory effects become cumulative
⚡ Sleep, energy, and pain all improve progressively

At OHR Clonmel, we offer course packages for clients who are ready to commit to results.

Better value. Better outcomes. A plan that's personalised to your condition.

DM us or book a consultation to discuss our PEMF courses.''',
'PEMF Course Packages at OHR — Commit to Real Results','Ask about packages'))

scripts.append(sc(68,'Gift Voucher','Give the Gift of No More Pain','Image','N/A','Facebook / Instagram',
'The Oxygen Temple welcome offer is priced for gifting (£100). Wellness experience vouchers are one of the fastest-growing gift categories. Positioning PEMF as a gift removes the price objection for the buyer.',
'''What do you give someone who's been in pain for years?

A PEMF session at OHR Clonmel.

Whether it's a parent with arthritis, a partner with back pain, a friend who's been running on empty — an OHR PEMF gift voucher is a gift that actually helps.

Clinical-grade. Fully clothed. No prep. No side effects.

They book it when they're ready. You give it now.

Gift vouchers available online at optimalhealthatinspire.ie or in clinic.

Give something that actually works.''',
'OHR PEMF Gift Vouchers — The Gift of Real Recovery','Get a gift voucher'))

scripts.append(sc(69,'New Year','New Year, New Baseline — Start with Your Cells','Image','N/A','Facebook / Instagram',
'Livbetter\'s January framing: "Your body does the work, now give it the recovery it deserves." New Year health resolution audiences are high-intent but need to be differentiated from generic gym messaging.',
'''New year. Same inflammation.

The gym memberships and the green smoothies are great. But if your cells are inflamed, exhausted, and under-resourced — the results will plateau.

This January, start one level deeper.

PEMF therapy resets the cellular environment:
⚡ Reduces systemic inflammation
⚡ Boosts ATP energy production
⚡ Supports deep sleep for real recovery
⚡ Prepares your body to respond to the other things you're doing

OHR Clonmel — start the year right. Book a January PEMF session.

Limited spaces in the first two weeks — book now.''',
'New Year PEMF Reset — Start at the Cellular Level','Book a January session'))

scripts.append(sc(70,'Summer Prep','Summer Is Coming — Get Your Body Ready','Image','N/A','Facebook / Instagram',
'Seasonal urgency (summer, New Year) consistently lifts conversion rates in wellness advertising. No PEMF brand in the dataset uses seasonal angles — a clear differentiation opportunity for OHR.',
'''8 weeks to summer. Your joints are stiff, your energy is low, and you haven't moved like you want to in months.

Before you push your body into a summer training programme — prepare it.

PEMF therapy:
✅ Reduces the inflammation that makes exercise harder
✅ Supports joint health before increased load
✅ Boosts cellular energy for better training adaptation
✅ Improves sleep quality for faster recovery

Think of it as the pre-season service before your summer push.

OHR Clonmel — book your May/June PEMF sessions now. Spaces are filling up.''',
'Get Summer-Ready — PEMF Prep at OHR Clonmel','Book a summer prep session'))

scripts.append(sc(71,'Recovery Bundle','The Complete Recovery Session — One Visit, Three Therapies','Image','N/A','Facebook Feed',
'The Oxygen Temple\'s most-run creative: HBOT + Red Light + PEMF for £100 welcome offer. Livbetter offers all 6 therapies with a 7-day trial pack. OHR\'s multi-modality advantage is the strongest local differentiator.',
'''What if you could hit three recovery goals in one visit? ⚡

At OHR Clonmel, our Complete Recovery Session combines:

🫁 HBOT — Floods cells with pure oxygen under pressure
⚡ PEMF — Reduces inflammation at the cellular level
🔴 Infrared — Deep tissue warmth and circulation support

Three clinically researched therapies. One visit. Maximum impact.

Used by professional athletes and high-performance recovery centres across Europe.

Now available in Tipperary.

Ask us about our Complete Recovery Session package — and experience what your body is capable of with the right support.''',
'Complete Recovery at OHR — HBOT + PEMF + Infrared in One Visit','Ask about the bundle'))

scripts.append(sc(72,'vs Other Clinics','Why OHR? Clinical-Grade Makes the Difference.','Image','N/A','Facebook Feed',
'The Oxygen Temple: "Advanced cellular recovery." Blue Wave: "clinical-grade equipment." Rē Precision Health: "the result of 15 years of research and $500,000+ spent on specialists." Trust and credential-building are key conversion drivers for first-time clinic visitors.',
'''PEMF is now everywhere. Wellness centres. Beauty clinics. Home mats.

Not all PEMF is the same.

At Optimal Health & Recovery in Clonmel:

✅ Clinical-grade equipment — therapeutic intensity, not consumer-level
✅ Full consultation before every session
✅ Personalised protocols for your condition
✅ Qualified therapists, not just technicians
✅ Combined access to HBOT and Infrared in the same visit

We're not a beauty clinic that added a PEMF mat. We're a dedicated recovery and health optimisation centre.

If you want PEMF that actually performs — book at OHR.''',
'Why OHR — Clinical PEMF Done Properly in Clonmel','Book at OHR'))

scripts.append(sc(73,'Diabetes','Type 2 Diabetes — PEMF and Circulation','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Enhanced Micro-circulation & Healing." Microvascular damage is a primary driver of Type 2 diabetes complications. PEMF\'s circulation and anti-inflammatory mechanism has direct relevance — and this audience is large, motivated, and underserved by wellness advertising.',
'''Type 2 diabetes doesn't just affect blood sugar.

It progressively damages your microvascular system — the smallest blood vessels that deliver oxygen and nutrients to your feet, kidneys, eyes, and nerves.

PEMF therapy works directly on microcirculation:
⚡ Stimulates blood vessel function and flexibility
⚡ Improves tissue oxygenation in peripheral areas
⚡ Reduces inflammatory markers associated with insulin resistance
⚡ Supports nerve health in the extremities

For people managing Type 2 diabetes who want to protect their vascular and nerve health long-term — PEMF is worth a serious conversation.

Always discussed with your GP or endocrinologist. We're happy to provide clinical literature.

OHR Clonmel. Book a consultation.''',
'Diabetes & Circulation Support — PEMF at OHR Clonmel','Book a consultation'))

scripts.append(sc(74,'Anxiety','Anxiety and the Body — PEMF as a Nervous System Tool','Image','N/A','Facebook / Instagram',
'Omnipemf: "Reduced stress and anxiety — calm your mind in minutes." Scieneldn and Rē Precision Health both position PEMF within nervous system regulation programs. Anxiety has a strong somatic (body-based) component that PEMF addresses directly.',
'''Anxiety lives in the body as much as the mind.

The tight chest. The shallow breathing. The muscle tension you carry without realising. The cortisol that stays elevated hours after the stressor has passed.

PEMF therapy works on the physical substrate of anxiety:
⚡ Activates the parasympathetic "rest" response
⚡ Reduces cortisol and adrenaline through electromagnetic nervous system modulation
⚡ Calms the sympathetic overdrive that keeps you in fight-or-flight
⚡ Improves sleep quality — the first casualty of chronic anxiety

This isn't therapy. It's not a replacement for psychological support.

But for many people, calming the body allows the mind to follow.

OHR Clonmel. Book a nervous system reset session.''',
'Anxiety Relief Through the Body — PEMF at OHR Clonmel','Book a reset session'))

scripts.append(sc(75,'Lyme Disease','Lyme Disease Recovery — PEMF for Persistent Symptoms','Image','N/A','Facebook Feed',
'Rē Precision Health\'s multi-modal approach targets "the physical, mental, emotional, nutritional and existential factors." Post-treatment Lyme disease syndrome presents with fatigue, pain, and neurological symptoms — all PEMF-targetable.',
'''Post-treatment Lyme disease leaves many people with:

😔 Persistent fatigue that doesn't respond to rest
😔 Joint and muscle pain that moves around
😔 Brain fog and memory issues
😔 Disrupted sleep despite exhaustion

These are driven by ongoing neuroinflammation and immune dysregulation.

PEMF therapy is being explored as a supportive intervention for PTLDS because it:
✅ Reduces neurological inflammation
✅ Supports mitochondrial energy production
✅ Calms the immune-nervous system interaction
✅ Improves sleep architecture

We take complex cases seriously at OHR. Book a detailed consultation.''',
'Post-Lyme Recovery Support — PEMF at OHR Clonmel','Book a consultation'))

# ── Scripts 76–93: Final stretch ───────────────────────────────────────────────
scripts.append(sc(76,'PCOS','PCOS — Addressing the Inflammation Underneath','Image','N/A','Facebook / Instagram',
'Women\'s hormonal health is an emerging PEMF application. PCOS is fundamentally an inflammatory and endocrine condition — and no PEMF brand in the dataset targets it directly. Local gap for OHR.',
'''PCOS isn't just a hormonal condition. It's an inflammatory one.

Chronic low-grade inflammation is a primary driver of:
• Insulin resistance in PCOS
• Elevated androgens
• Disrupted ovulation
• Fatigue and mood instability

PEMF therapy reduces systemic inflammatory load — the biological environment that worsens PCOS symptoms.

It won't replace your endocrinologist. But for women managing PCOS who want to address the inflammation underneath — PEMF is a drug-free, evidence-supported tool.

OHR Clonmel. Women's health consultations available.

DM us or book online.''',
'PCOS Inflammation Support — PEMF at OHR Clonmel','Book a women\'s health consultation'))

scripts.append(sc(77,'Endometriosis','Endometriosis — You Deserve More Than "Just Manage It"','Image','N/A','Facebook / Instagram',
'Therafy\'s cancer-adjacent copy shows willingness to address serious conditions directly. Endometriosis involves significant inflammatory tissue — and no PEMF advertiser in the dataset targets it. Major gap for OHR.',
'''"Just manage the pain."
"Come back if it gets worse."
"Have you considered the pill?"

If you have endometriosis, you know the script. 😔

PEMF therapy doesn't treat endometriosis — but it addresses the inflammatory environment that drives its symptoms:

⚡ Reduces pelvic inflammatory markers
⚡ Supports circulation to the pelvic region
⚡ Calms the nervous system hypersensitisation that worsens pain perception
⚡ Improves sleep disrupted by chronic pain

Many women with endo find PEMF meaningfully reduces their pain intensity, particularly in the week before and during their cycle.

OHR Clonmel — a safe, evidence-informed space.

Book a women's health consultation.''',
'Endometriosis Pain Relief — PEMF Support at OHR','Book a consultation'))

scripts.append(sc(78,'Thyroid','Thyroid and PEMF — What the Research Shows','Image','N/A','Facebook Feed',
'Rē Precision Health targets thyroid and hormonal conditions within their multi-modal program. Thyroid dysfunction drives fatigue, inflammation, poor sleep, and cognitive symptoms — all PEMF-targetable. Motivated audience.',
'''Hypothyroidism and Hashimoto's aren't just thyroid problems.

They're systemic inflammatory conditions that affect:
• Energy and fatigue
• Cognitive function
• Joint and muscle pain
• Immune regulation
• Sleep quality

PEMF therapy works on the systemic inflammation that worsens thyroid autoimmunity and amplifies its symptoms.

Some research suggests PEMF may also directly support thyroid tissue circulation — though this is an area of ongoing study.

If you're managing a thyroid condition and the medication isn't fixing all of it — PEMF is worth a conversation.

OHR Clonmel. Book a consultation.''',
'Thyroid Support — PEMF Therapy at OHR Clonmel','Book a consultation'))

scripts.append(sc(79,'Autoimmune','Autoimmune Conditions — Calming the Immune Fire','Image','N/A','Facebook Feed',
'Rē Precision Health\'s programs address "the physical, mental, emotional, nutritional and existential factors." Autoimmune conditions involve immune dysregulation driving inflammation — PEMF\'s primary mechanism. Large, underserved audience.',
'''Rheumatoid arthritis. Lupus. Ankylosing spondylitis. Psoriatic arthritis.

What all autoimmune conditions share: your immune system producing inflammatory signals that damage your own tissue.

PEMF therapy modulates this immune response:
✅ Reduces pro-inflammatory cytokine production
✅ Supports regulatory T-cell function
✅ Decreases local and systemic inflammatory load
✅ Complements (not replaces) your immunosuppressant therapy

Many clients with autoimmune conditions use PEMF to reduce flare frequency and intensity, and to maintain function between medical appointments.

Always in consultation with your rheumatologist.

OHR Clonmel. Complex conditions welcome.''',
'Autoimmune Inflammation Support — PEMF at OHR','Book a consultation'))

scripts.append(sc(80,'Weight Management','Inflammation Is Making It Harder to Lose Weight','Image','N/A','Facebook Feed',
'Rē Precision Health includes "Anti-inflammatory Diet" and metabolic support in their programs. Chronic inflammation directly impairs insulin sensitivity and metabolic function — an angle no PEMF brand currently uses in ads.',
'''You're eating right. You're exercising. The weight still isn't moving.

Here's what most personal trainers don't address: chronic inflammation directly impairs your metabolism.

Inflammatory cytokines:
• Increase insulin resistance
• Disrupt leptin signalling (hunger hormone)
• Impair mitochondrial function
• Make fat cells more resistant to lipolysis

PEMF therapy reduces systemic inflammation — improving the biological environment for metabolic function.

It's not a fat loss therapy. It's a cellular environment reset that makes your other efforts more effective.

OHR Clonmel. Book a consultation and let's talk about the full picture.''',
'Stubborn Weight? The Inflammation Angle — OHR PEMF','Book a consultation'))

scripts.append(sc(81,'Cancer Recovery','Cancer Recovery — Supporting Your Body Through Treatment','Image','N/A','Facebook Feed',
'Therafy runs multiple cancer-adjacent ads (breast cancer, electromagnetic cancer therapy). Cancer recovery support (fatigue, inflammation from treatment) is a highly motivated audience that benefits from very careful, supportive copy.',
'''Cancer treatment saves lives. It also exhausts the body in ways that take months — sometimes years — to fully recover from.

Post-treatment fatigue. Inflammation from chemotherapy. Joint pain from hormone therapies. Disrupted sleep.

PEMF therapy is being explored as a supportive intervention in cancer rehabilitation:
✅ Addressing treatment-related fatigue at the cellular level
✅ Reducing inflammatory side effects of chemotherapy
✅ Supporting immune function during recovery
✅ Improving sleep quality and quality of life

We always work alongside your oncology team and request GP clearance.

OHR Clonmel — a compassionate space for complex health journeys.

Book a consultation. We'll listen properly.''',
'Cancer Recovery Support — PEMF at OHR Clonmel','Book a consultation'))

scripts.append(sc(82,'Psoriasis','Psoriasis — The Inflammation That Reaches the Surface','Image','N/A','Facebook / Instagram',
'Therafy\'s cancer copy shows willingness to address dermatological/systemic conditions. Psoriasis is a systemic inflammatory condition with skin manifestations — PEMF\'s anti-inflammatory mechanism is directly relevant and no local clinic targets it.',
'''Psoriasis is a skin condition. But it starts inside.

The plaques, the itching, the flaking — these are the visible symptoms of a systemic inflammatory condition driven by immune dysregulation.

PEMF therapy addresses the underlying biology:
⚡ Modulates the immune-inflammatory response
⚡ Reduces the cytokine signals that trigger skin cell overproduction
⚡ Supports circulation and skin tissue health
⚡ Improves sleep often disrupted by psoriasis discomfort

No topicals. No UV. Just electromagnetic support for your immune system.

OHR Clonmel. Book a skin health consultation.''',
'Psoriasis Support — PEMF Therapy at OHR Clonmel','Book a skin health consultation'))

scripts.append(sc(83,'Restless Legs',"Restless Legs — The Night Disruption That\'s Draining You",'Image','N/A','Facebook Feed',
'MiraMate leads with sleep disruption: "Struggling with restless nights? Tossing and turning." Restless legs syndrome is a specific sleep-disrupting condition driven by dopaminergic and circulatory mechanisms — both PEMF-targetable.',
'''Lying down. Legs that need to move. Can't stop them. Can't sleep. 😔

Restless legs syndrome is one of the most frustrating and underappreciated sleep disruptors.

PEMF therapy has been studied for RLS because:
✅ It improves peripheral circulation — addressing the microvascular component
✅ It supports dopaminergic nervous system balance
✅ It reduces the neurological excitability that drives the urge to move
✅ It improves overall sleep architecture

Many RLS sufferers find PEMF before bed significantly reduces episode intensity and frequency.

OHR Clonmel has evening appointments for exactly this reason.

Book a sleep consultation.''',
'Restless Legs — PEMF Therapy for Better Sleep at OHR','Book an evening session'))

scripts.append(sc(84,'Gut Health','Gut Issues? PEMF Works on the Vagal-Gut Axis','Image','N/A','Facebook Feed',
'Rē Precision Health includes "GutRēset Protocol" alongside PEMF. The gut-brain-nervous system connection is a growing area of wellness marketing. Gut inflammation and vagal tone are both directly PEMF-relevant.',
'''Bloating. IBS. Gut sensitivity that flares with stress.

Your gut and your nervous system are in constant conversation via the vagus nerve.

When the nervous system is dysregulated — stuck in chronic stress, cortisol overload, or trauma responses — your gut suffers.

PEMF therapy directly stimulates vagal tone, shifting the nervous system from sympathetic (fight-or-flight) to parasympathetic (rest-and-digest).

For many people with gut conditions linked to stress or nervous system dysregulation:
✅ Improved vagal tone → better gut motility
✅ Reduced systemic inflammation → less gut reactivity
✅ Better sleep → improved gut-lining repair overnight

OHR Clonmel. Book a gut-brain consultation.''',
'Gut Health and PEMF — Vagus Nerve Reset at OHR','Book a consultation'))

scripts.append(sc(85,'Athlete Missing Piece','Why Athletes Hit a Recovery Ceiling — And How to Break It','Image / Video','35s','Facebook / Instagram',
'Livbetter: "your body does the work, now give it the recovery it deserves." X-CELLr8 lists PEMF alongside HBOT, red light, altitude training, VO₂ max — positioning PEMF as part of elite athlete recovery. "The missing piece" hook converts motivated athletes.',
'''You train smart. You sleep well. You eat right.

But you've hit a recovery ceiling. Every season, you're dealing with the same niggles. The same slow weeks. The same plateau.

The missing piece is cellular.

Your muscles recover. Your joints recover. But at the cellular level — the inflammatory debris, the mitochondrial depletion, the micro-damage to tissue — it accumulates.

PEMF therapy is the missing piece that works at that level.

Used by professional European sports teams. Now available at OHR Clonmel.

30–45 minutes on the mat. Feel what you've been missing.''',
'The Athlete\'s Missing Piece — PEMF at OHR Clonmel','Book a performance session'))

scripts.append(sc(86,'Consistency','Make PEMF a Habit — Monthly Membership at OHR','Image','N/A','Facebook Feed',
'Livbetter\'s "7-day trial, 8 credits" and Omnipemf\'s "50,000+ users" imply ongoing, habitual use. PEMF delivers compounding benefits with regular sessions — a membership model drives retention and lifetime value.',
'''The people who see the best PEMF results?

They come consistently. 🗓️

One session relieves acute pain.
A month of sessions shifts your baseline.
Three months and your body is operating at a different level.

OHR monthly PEMF membership:
✅ Regular sessions at a better rate
✅ Personalised protocol that evolves with you
✅ Priority booking and appointment flexibility
✅ Progress check-ins with our team

This is how PEMF becomes a health investment, not just an appointment.

DM us or ask at reception about our membership options.''',
'PEMF Monthly Membership at OHR Clonmel','Ask about membership'))

scripts.append(sc(87,'Full OHR Offering','Four Therapies. One Clinic. One Tipperary.','Image','N/A','Facebook Feed',
'The Oxygen Temple: HBOT + Red Light + PEMF. Livbetter: HBOT + Red Light + Cold Plunge + Infrared + Compression + PEMF. OHR\'s 4-modality combination (HBOT + Infrared + PEMF + Red Light) is the strongest multi-therapy positioning available.',
'''In London, Dublin, or Manchester, you'd visit four different clinics for this.

In Clonmel, you come to OHR.

⚡ PEMF Therapy — Cellular inflammation reset
🔴 Infrared Therapy — Deep tissue warmth and tissue repair
🫁 HBOT — High-pressure oxygen for cellular energy
💡 Red Light Therapy — Cellular photobiomodulation

Four of the most clinically researched recovery therapies. One clinic. One team. One Tipperary.

Whether you need one therapy or all four, OHR has Tipperary's most comprehensive recovery suite.

Book a consultation. Let's build your personalised protocol.''',
'Four World-Class Therapies — One Clinic in Clonmel','Book a protocol consultation'))

scripts.append(sc(88,'Stress Test','Is Your Body in Chronic Stress? Take the Signs Test.','Image','N/A','Facebook / Instagram',
'Scieneldn founder hook: "women and men in their 30s, 40s, 50s, were already doing the work... They didn\'t want a fix. They wanted to keep going." This audience is self-aware and high-performing. A self-diagnosis quiz hook draws them in.',
'''Signs your body is in chronic sympathetic overload:

❌ Wake up tired even after 8 hours
❌ Can't switch off at night
❌ Persistent muscle tension (jaw, shoulders, lower back)
❌ Catch every bug going around
❌ Energy crashes mid-afternoon
❌ Irritable or anxious without clear reason

If you ticked 3 or more — your nervous system is stuck in overdrive.

PEMF therapy is a direct intervention for the parasympathetic nervous system — the biological reset switch.

30–45 minutes at OHR Clonmel.

Walk in wired. Walk out recovered.

Book your nervous system reset.''',
'Signs You\'re in Chronic Stress Mode — PEMF Reset at OHR','Book a nervous system reset'))

scripts.append(sc(89,'Immune Support 2','Before the Next Bug Hits — Strengthen Your Cellular Defence','Image','N/A','Facebook Feed',
'Omnipemf: "meaningful benefits with the support of PEMF therapy — helping them feel more balanced, focused, and at ease." Immunity is one of the least-marketed PEMF benefits with one of the highest audience sizes, especially in spring/autumn.',
'''You can't afford to be sick.

Not with everything on your plate.

PEMF therapy supports immune resilience by:
⚡ Reducing the chronic inflammation that suppresses immune function
⚡ Boosting cellular energy (your immune cells need ATP to function)
⚡ Supporting lymphatic circulation and waste clearance
⚡ Improving sleep — where 70% of immune regeneration happens

The best time to support your immunity is before you need to.

OHR Clonmel. Book before the next wave. Stay operational.''',
'Immune Resilience — PEMF Therapy at OHR Clonmel','Book a session this week'))

scripts.append(sc(90,'Sleep 2',"The 30-Minute Fix for the Worst Night\'s Sleep of Your Life",'Image','N/A','Facebook / Instagram',
'MiraMate: "Struggling with restless nights? 30 minutes before bed." Omnipemf: "Deeper, uninterrupted sleep — activate Delta waves naturally." Sleep is the highest-converting PEMF benefit. Second sleep script focuses on the acute, specific problem.',
'''You know the worst kind of tiredness.

Not sleepy-tired. Exhausted-but-can't-sleep tired. Brain racing, body tense, clock watching. 😔

Insomnia driven by an overactivated nervous system isn't fixed by melatonin. It's fixed by actually switching your nervous system off.

PEMF therapy at the right frequency activates your brain's Delta wave state — the frequency your brain needs to initiate deep, restorative sleep.

30–45 minutes in our clinic in Clonmel — ideally in the early evening.

Book an evening session at OHR. Then go home and sleep.''',
'Insomnia Solution — Evening PEMF at OHR Clonmel','Book an evening session'))

scripts.append(sc(91,'Energy 2','Cellular Energy — The PEMF Angle No One Talks About','Image','N/A','Facebook Feed',
'MiraMate: "Boosts cellular energy." Omnipemf: "Sustained energy and productivity throughout the day." The ATP/mitochondrial mechanism is the energy explanation — most PEMF ads hint at it but none explain it properly. OHR can own this angle.',
'''Your energy doesn't come from coffee. It comes from your mitochondria. ⚡

Every cell in your body contains hundreds of mitochondria — tiny power stations that convert nutrients into ATP (cellular energy).

When they're inflamed, damaged, or under-resourced, your energy tanks. No amount of sleep, caffeine, or supplements can fully compensate.

PEMF therapy directly stimulates mitochondrial function. The electromagnetic pulse signals mitochondria to increase ATP production.

The result isn't a spike. It's sustained, cellular-level energy — the kind you notice in your second week of sessions.

OHR Clonmel. Book your energy reset.''',
'Mitochondrial Energy — The Real PEMF Benefit at OHR','Book an energy session'))

scripts.append(sc(92,'Nerve Pain','Neuropathy — When the Nerves Themselves Are in Pain','Image','N/A','Facebook Feed',
'Blue Wave PEMF: "Chronic Nerve & Back Pain Relief." Peripheral neuropathy (from diabetes, chemotherapy, injury, or unknown cause) is a large, underserved condition with few effective conservative treatments.',
'''Burning. Tingling. Numbness. Electric shocks that come from nowhere.

Peripheral neuropathy is one of the most difficult pain conditions to live with — and one of the least responsive to standard treatments.

PEMF therapy is being researched for neuropathic pain because:
✅ It reduces neuroinflammation at the nerve root and along the nerve path
✅ Supports Schwann cell function (the cells that maintain nerve sheaths)
✅ Improves microcirculation to nerve tissue (critical for nerve health)
✅ Reduces the central sensitisation that amplifies pain signals

No needles. No medication adjustments. No side effects.

OHR Clonmel. If your nerve pain has nowhere left to go — come and talk to us.''',
'Neuropathy and Nerve Pain — PEMF at OHR Clonmel','Book a consultation'))

scripts.append(sc(93,'Trust / Why OHR','Why 1000+ Tipperary Clients Choose OHR for Recovery','Image','N/A','Facebook Feed',
'Rē Precision Health\'s top testimonial ad: "The protocols and the staff are beyond words. It will exceed your expectations." Trust, credentials, and proven track record are the final conversion driver for undecided first-timers.',
'''Optimal Health & Recovery in Clonmel isn't a beauty salon that added a wellness device.

We're a dedicated health optimisation and recovery clinic — built for people who take their health seriously.

Why clients choose OHR for PEMF:

✅ Clinical-grade equipment — not consumer-level
✅ Qualified therapists who understand your condition
✅ Full consultation before every course of treatment
✅ Evidence-based protocols, personalised to you
✅ Access to HBOT, Infrared, and PEMF under one roof
✅ Located in Clonmel — serving all of Tipperary

We've helped hundreds of Tipperary clients recover from pain, chronic conditions, poor sleep, and fatigue.

You deserve the same.

Book a consultation at OHR. Let's build your protocol.''',
'Why OHR — Tipperary\'s Clinical Recovery Centre','Book a consultation'))

# ── Assemble all script cards ─────────────────────────────────────────────────
cards_html = '\n'.join(scripts)

# ── Inject into report ────────────────────────────────────────────────────────
content = open(REPORT).read()
orig_len = len(content)

start_marker = '<div id="pemfScriptCards">'
start_idx = content.find(start_marker)
if start_idx == -1:
    print('ERROR: pemfScriptCards not found')
    exit(1)

after_start = content[start_idx + len(start_marker):]
end_marker = '</div>\n  </div>\n</div>\n\n</div><!-- end pemf-section -->'
end_idx = after_start.find(end_marker)
if end_idx == -1:
    # Try simpler end
    end_marker = '</div>\n</div>\n\n</div><!-- end pemf-section -->'
    end_idx = after_start.find(end_marker)

if end_idx == -1:
    # Just find </div><!-- end pemf-section -->
    end_marker = '</div><!-- end pemf-section -->'
    end_idx = after_start.find(end_marker)
    if end_idx == -1:
        print('ERROR: could not find pemf-section end')
        # Show what's there
        print(repr(content[content.rfind('pemfScriptCards'):content.rfind('pemfScriptCards')+500]))
        exit(1)
    # Walk back to the enclosing divs
    before_end = after_start[:end_idx]
    # Remove trailing closing divs
    stripped = before_end.rstrip()
    # We'll replace everything in pemfScriptCards up to end-pemf-section
    new_content = (
        content[:start_idx + len(start_marker)] +
        '\n' + cards_html + '\n    ' +
        content[start_idx + len(start_marker) + end_idx:]
    )
else:
    new_content = (
        content[:start_idx + len(start_marker)] +
        '\n' + cards_html + '\n    ' +
        content[start_idx + len(start_marker) + end_idx:]
    )

open(REPORT, 'w').write(new_content)
card_count = new_content.count('id="pemfScript') + new_content.count('class="sc"')
# Count by unique pattern in our cards
pc_count = new_content.count('id="pc')
print(f'Part 2 done. File: {len(new_content):,} chars (was {orig_len:,})')
print(f'Script card count (id=pc*): {pc_count}')
print(f'Expected: 93')
