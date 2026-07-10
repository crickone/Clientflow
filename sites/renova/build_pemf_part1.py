#!/usr/bin/env python3
"""
Part 1: Build PEMF section HTML (structure, ads table, analysis)
and inject into the existing OHR report in Renova folder.
"""
import json, re, html as html_mod

REPORT = '/sessions/festive-zen-babbage/mnt/Renova/OHR_HBOT_Ad_Library_Full_Report.html'
ads = json.load(open('/sessions/festive-zen-babbage/pemf_ads.json'))

content = open(REPORT).read()
orig_len = len(content)

# ── 1. UPDATE switchTherapy() to handle 'pemf' ────────────────────────────────
OLD_SWITCH = """function switchTherapy(t) {
  const hbot = document.getElementById('hbot-section');
  const ir = document.getElementById('ir-section');
  const btnH = document.getElementById('btn-hbot');
  const btnI = document.getElementById('btn-ir');
  if (t === 'hbot') {
    hbot.style.display = ''; ir.style.display = 'none';
    btnH.style.background = '#1c3a5c'; btnH.style.borderColor = '#58a6ff'; btnH.style.color = '#58a6ff';
    btnI.style.background = '#21262d'; btnI.style.borderColor = '#30363d'; btnI.style.color = '#8b949e';
  } else {
    hbot.style.display = 'none'; ir.style.display = '';
    btnI.style.background = '#3a1c0d'; btnI.style.borderColor = '#f0883e'; btnI.style.color = '#f0883e';
    btnH.style.background = '#21262d'; btnH.style.borderColor = '#30363d'; btnH.style.color = '#8b949e';
  }
}"""

NEW_SWITCH = """function switchTherapy(t) {
  const secs = {hbot:'hbot-section',ir:'ir-section',pemf:'pemf-section'};
  const btns = {hbot:'btn-hbot',ir:'btn-ir',pemf:'btn-pemf'};
  const active = {
    hbot:{bg:'#1c3a5c',bc:'#58a6ff',col:'#58a6ff'},
    ir:  {bg:'#3a1c0d',bc:'#f0883e',col:'#f0883e'},
    pemf:{bg:'#1c0a33',bc:'#a855f7',col:'#a855f7'}
  };
  Object.keys(secs).forEach(k => {
    const sec = document.getElementById(secs[k]);
    const btn = document.getElementById(btns[k]);
    if (k === t) {
      sec.style.display = '';
      btn.style.background = active[k].bg;
      btn.style.borderColor = active[k].bc;
      btn.style.color = active[k].col;
    } else {
      sec.style.display = 'none';
      btn.style.background = '#21262d';
      btn.style.borderColor = '#30363d';
      btn.style.color = '#8b949e';
    }
  });
}"""

content = content.replace(OLD_SWITCH, NEW_SWITCH, 1)

# ── 2. ADD PEMF JS functions after filterIRScripts ───────────────────────────
PEMF_JS = """
function showPEMFTab(id, el) {
  document.querySelectorAll('#pemf-section .pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#pemf-tabs .tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  el.classList.add('active');
}
function filterPEMFTable(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#pemfAdsTable tbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function filterPEMFScripts(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#pemfScriptCards > div').forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
"""
content = content.replace('function filterIRScripts(q) {',
                           PEMF_JS + 'function filterIRScripts(q) {', 1)

# ── 3. ADD PEMF BUTTON to therapy-switcher ───────────────────────────────────
OLD_BTN = '  <button id="btn-ir" onclick="switchTherapy(\'ir\')" style="background:#21262d;border:1px solid #30363d;color:#8b949e;padding:8px 20px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">🔴 Infrared Therapy</button>'
NEW_BTN = OLD_BTN + '\n  <button id="btn-pemf" onclick="switchTherapy(\'pemf\')" style="background:#21262d;border:1px solid #30363d;color:#8b949e;padding:8px 20px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">⚡ PEMF Therapy</button>'
content = content.replace(OLD_BTN, NEW_BTN, 1)

# ── 4. Build ads table rows ───────────────────────────────────────────────────
def esc(s): return html_mod.escape(str(s or ''))

def ad_rows(ads_list):
    rows = []
    for i, a in enumerate(ads_list):
        body = (a['body'] or '').replace('\n', ' ')[:300]
        rows.append(
            '<tr>'
            f'<td style="padding:8px 12px;color:#8b949e;font-size:12px">{i+1}</td>'
            f'<td style="padding:8px 12px;color:#a855f7;font-size:13px;font-weight:600">{esc(a["page"])}</td>'
            f'<td style="padding:8px 12px;color:#e6edf3;font-size:13px;max-width:480px">{esc(body)}</td>'
            f'<td style="padding:8px 12px;color:#8b949e;font-size:12px">{esc(a["cta"])}</td>'
            f'<td style="padding:8px 12px;color:#8b949e;font-size:12px">{esc(a["impressions"])}</td>'
            '</tr>'
        )
    return '\n'.join(rows)

# ── 5. Advertiser breakdown ───────────────────────────────────────────────────
pages = {}
for a in ads:
    pages[a['page']] = pages.get(a['page'], 0) + 1

adv_rows = []
for p, c in sorted(pages.items(), key=lambda x: -x[1]):
    bar_w = int(c / max(pages.values()) * 120)
    adv_rows.append(
        f'<tr><td style="padding:8px 12px;color:#a855f7;font-size:13px;font-weight:600">{esc(p)}</td>'
        f'<td style="padding:8px 12px"><div style="background:#a855f7;height:8px;border-radius:4px;width:{bar_w}px"></div></td>'
        f'<td style="padding:8px 12px;color:#e6edf3;font-size:13px;font-weight:700">{c}</td></tr>'
    )

# ── 6. Hook analysis cards ───────────────────────────────────────────────────
hooks = [
    ("⏳ Scarcity / Limited Batch", "#f0883e",
     "Therafy runs 36 ads almost exclusively on 'current batch running low' scarcity. "
     "This is their entire funnel — urgency replaces benefit copy entirely. "
     "<span class='highlight'>OHR angle: limited appointment slots or intro-offer deadlines.</span>"),
    ("⚡ Cellular Penetration Science", "#a855f7",
     "'PEMF at 7.83Hz penetrates through your entire body' — Therafy uses the Schumann resonance frequency as a credibility hook. "
     "10,000+ clinical studies. 'Medical-grade' positioning. "
     "<span class='highlight'>OHR angle: clinical-grade equipment vs consumer home mats.</span>"),
    ("😴 Sleep & Recovery", "#2ed8c3",
     "MiraMate and Omnipemf both lead with sleep: '30 minutes before bed', 'Delta waves naturally', 'wake up refreshed'. "
     "50,000+ users cited by Omnipemf. Sleep is the #1 entry-point benefit. "
     "<span class='highlight'>OHR angle: PEMF as drug-free sleep solution.</span>"),
    ("💪 Pain Relief Stack", "#58a6ff",
     "Elaris Body: 'Less pain. More energy. Better sleep.' — a perfect 3-benefit stack in one line. "
     "Blue Wave leads with bone/joint regeneration for fractures and osteoporosis. "
     "<span class='highlight'>OHR angle: mirror the 3-benefit stack for chronic pain audiences.</span>"),
    ("🧠 Nervous System Reset", "#f0883e",
     "Scieneldn and Rē Precision Health position PEMF as 'nervous system reset' and 'anti-inflammatory cellular energy'. "
     "Sciene's 3-session £110 intro offer drives trial. "
     "<span class='highlight'>OHR angle: PEMF as stress/burnout reset — target corporate workers.</span>"),
    ("🏥 Multi-Modality Bundle", "#a855f7",
     "The Oxygen Temple and Livbetter both sell HBOT + Red Light + PEMF bundles (£100 welcome offer). "
     "'This isn't a spa treatment — it's a cellular-level approach.' "
     "<span class='highlight'>OHR angle: OHR's 4-modality combination is a key differentiator.</span>"),
    ("🐾 Pet PEMF (Petspemf / HorseHalo)", "#2ed8c3",
     "7 Petspemf + 5 HorseHalo ads target the pet/equine wellness market. "
     "'20,000 dogs have experienced more comfort.' Drug-free positioning. "
     "<span class='highlight'>OHR angle: not directly relevant, but shows breadth of PEMF market awareness.</span>"),
    ("🔄 Body Reset Hook", "#58a6ff",
     "Megelin: 'If your body had a reset button… this is it.' — simple, aspirational, no jargon. "
     "Stacks with red light: 'the ultimate chill-out ritual.' "
     "<span class='highlight'>OHR angle: 'reset your cells in 30 minutes' — position a session as a reset ritual.</span>"),
]

hook_cards = ''
for title, color, text in hooks:
    hook_cards += (
        f'<div class="insight-card" style="border-color:{color}33">'
        f'<h3 style="color:{color}">{title}</h3>'
        f'<p>{text}</p>'
        f'</div>\n'
    )

# ── 7. Longevity / top ads section ───────────────────────────────────────────
top_ads = [
    ("Therafy", "Current Batch Running Low", "Scarcity + free gifts bundle ($144+)", "36 variants running"),
    ("Elaris Body", "Less Pain. More Energy. Better Sleep.", "3-benefit stack, zero jargon", "5 active"),
    ("The Oxygen Temple", "Oxygen, Light & Energy Suite — £100", "Multi-modality intro offer", "5 active"),
    ("Livbetter", "Premium Recovery & Wellness Space", "Multi-modality + 7-day trial offer", "6 active"),
    ("Omnipemf NeoRhythm", "50,000+ Users — Sleep, Stress, Focus", "Social proof lead, 3 benefits", "2 active"),
    ("Rē Precision Health", "5/10/21 Day Nervous System Programs", "High-ticket retreat with PEMF included", "10 active"),
    ("MiraMate", "30 Minutes Before Bed = Better Sleep", "Simple use case, drug-free positioning", "3 active"),
    ("Scieneldn", "The Vault — 3 Sessions £110", "Founder story + intro-offer CTA", "2 active"),
    ("Blue Wave PEMF", "Advanced Cellular Recovery — Enfield", "Local clinic, condition-specific claims", "1 active"),
    ("Petspemf", "20,000 Dogs More Comfortable", "Social proof, drug-free, pet niche", "7 active"),
]

lon_rows = ''.join(
    f'<tr>'
    f'<td style="padding:8px 12px;color:#8b949e;font-size:12px">{i+1}</td>'
    f'<td style="padding:8px 12px;color:#a855f7;font-size:13px;font-weight:600">{esc(adv)}</td>'
    f'<td style="padding:8px 12px;color:#e6edf3;font-size:13px">{esc(hook)}</td>'
    f'<td style="padding:8px 12px;color:#8b949e;font-size:13px">{esc(why)}</td>'
    f'<td style="padding:8px 12px;color:#2ed8c3;font-size:12px;font-weight:600">{esc(status)}</td>'
    f'</tr>'
    for i, (adv, hook, why, status) in enumerate(top_ads)
)

# ── 8. OHR Strategy pane ─────────────────────────────────────────────────────
strategy_cards = [
    ("#a855f7", "Priority 1: Lead with the 3-Benefit Stack",
     "Elaris Body's 'Less pain. More energy. Better sleep.' is the simplest, highest-converting hook in the PEMF space. "
     "Adapt for OHR: 'Less pain. More energy. Better sleep. — in 30 minutes of PEMF at OHR.' "
     "Use as primary creative for cold audiences."),
    ("#58a6ff", "Priority 2: Sleep as the Entry-Point Benefit",
     "Sleep difficulty is the #1 symptom that drives people to try alternative therapies. "
     "MiraMate and Omnipemf both lead with sleep. OHR should run a dedicated sleep-focused PEMF campaign targeting ages 35-60."),
    ("#2ed8c3", "Priority 3: Multi-Modality Bundling",
     "The Oxygen Temple and Livbetter both sell PEMF as part of a £100 bundle (HBOT + Red Light + PEMF). "
     "OHR's 4-modality advantage (HBOT + Infrared + PEMF + Red Light) is unique in Tipperary. "
     "Build a 'Complete Recovery Session' package and advertise the bundle price."),
    ("#f0883e", "Priority 4: Nervous System Reset for Burnout Market",
     "Scieneldn and Rē Precision Health target high-achieving professionals dealing with burnout. "
     "'Anti-inflammatory. Nervous system reset. Cellular energy.' "
     "OHR should target Clonmel/Tipperary professionals with a 'Reset Session' — PEMF + Infrared in one visit."),
    ("#a855f7", "Priority 5: Clinical-Grade Positioning",
     "Consumer PEMF mats (Elaris, MiraMate, Megelin) are flooding the market. "
     "OHR's clinic-grade PEMF equipment is significantly more powerful. "
     "Run copy contrasting home devices vs. clinical sessions: 'Your mat is 50 Gauss. Ours is 2,000.'"),
    ("#58a6ff", "Priority 6: Condition-Specific Campaigns",
     "Blue Wave PEMF leads with specific conditions: fractures, osteoporosis, chronic nerve pain, back pain. "
     "OHR should test condition-specific ads for the highest-prevalence local conditions: "
     "arthritis, back pain, post-surgery recovery, and fibromyalgia."),
]

strat_html = ''
for color, title, text in strategy_cards:
    strat_html += (
        f'<div class="insight-card" style="border-left:4px solid {color};border-color:{color}44;margin-bottom:16px">'
        f'<h3 style="color:{color};margin-bottom:8px">{title}</h3>'
        f'<p style="color:#8b949e;line-height:1.7">{text}</p>'
        f'</div>\n'
    )

# ── 9. Assemble the full PEMF section ────────────────────────────────────────

pemf_section = '''
<div id="pemf-section" style="display:none">
<div id="pemf-tabs" class="tabs">
  <div class="tab active" onclick="showPEMFTab('pemf-overview',this)">Overview</div>
  <div class="tab" onclick="showPEMFTab('pemf-all-ads',this)">All 93 Ads</div>
  <div class="tab" onclick="showPEMFTab('pemf-advertisers',this)">Advertisers</div>
  <div class="tab" onclick="showPEMFTab('pemf-hooks',this)">Hooks &amp; Copy</div>
  <div class="tab" onclick="showPEMFTab('pemf-longevity',this)">Longevity Ranking</div>
  <div class="tab" onclick="showPEMFTab('pemf-strategy',this)">OHR Strategy</div>
  <div class="tab" onclick="showPEMFTab('pemf-scripts',this)">&#9997; Ad Copy (93)</div>
</div>

<!-- OVERVIEW -->
<div id="pemf-overview" class="pane active">
  <div class="kpi-grid">
    <div class="kpi"><div class="val" style="color:#a855f7">93</div><div class="label">Total Ads</div></div>
    <div class="kpi"><div class="val" style="color:#a855f7">18</div><div class="label">Advertisers</div></div>
    <div class="kpi"><div class="val" style="color:#a855f7">36</div><div class="label">Therafy Ads</div></div>
    <div class="kpi"><div class="val" style="color:#a855f7">7</div><div class="label">UK Clinics Active</div></div>
    <div class="kpi"><div class="val" style="color:#a855f7">8</div><div class="label">Key Hook Types</div></div>
    <div class="kpi"><div class="val" style="color:#a855f7">93</div><div class="label">OHR Scripts</div></div>
  </div>
  <div class="section">
    <h2>Key Takeaways — PEMF Ad Landscape</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
      <div class="insight-card" style="border-color:#a855f733">
        <h3 style="color:#a855f7">Therafy Dominates Volume</h3>
        <p>Therafy runs <span class="highlight">36 of 93 ads</span> (39%) — almost exclusively using scarcity ("current batch running low") + free gifts. Their repetition strategy suggests this hook converts. OHR should test a scarcity angle around limited appointment slots.</p>
      </div>
      <div class="insight-card" style="border-color:#58a6ff33">
        <h3 style="color:#58a6ff">Sleep is the #1 Entry Hook</h3>
        <p>MiraMate, Omnipemf, and Elaris all lead with sleep. <span class="highlight">"30 minutes before bed"</span> is a concrete, low-commitment use case that drives trial. Sleep is the easiest condition to advertise without clinical claims.</p>
      </div>
      <div class="insight-card" style="border-color:#2ed8c333">
        <h3 style="color:#2ed8c3">Multi-Modality Bundles Win</h3>
        <p>The Oxygen Temple and Livbetter sell PEMF as part of a <span class="highlight">£100 bundle</span> (HBOT + Red Light + PEMF). OHR's 4-modality suite is a unique competitive advantage — bundle pricing will outperform single-therapy ads.</p>
      </div>
      <div class="insight-card" style="border-color:#f0883e33">
        <h3 style="color:#f0883e">Nervous System Reset Positioning</h3>
        <p>Scieneldn and Rē Precision Health target <span class="highlight">high-achieving burnout</span> with PEMF as a "nervous system reset." This is an underserved angle in Irish wellness — OHR can own this positioning in Tipperary.</p>
      </div>
    </div>
  </div>
</div>

<!-- ALL ADS -->
<div id="pemf-all-ads" class="pane">
  <div class="section">
    <h2>All 93 PEMF Competitor Ads</h2>
    <input class="search-box" placeholder="Search ads by page, copy, CTA..." oninput="filterPEMFTable(this.value)">
    <table id="pemfAdsTable">
      <thead><tr>
        <th>#</th><th>Advertiser</th><th>Ad Copy (preview)</th><th>CTA</th><th>Impressions</th>
      </tr></thead>
      <tbody>
''' + ad_rows(ads) + '''
      </tbody>
    </table>
  </div>
</div>

<!-- ADVERTISERS -->
<div id="pemf-advertisers" class="pane">
  <div class="section">
    <h2>Advertisers by Ad Count</h2>
    <table>
      <thead><tr><th>Advertiser</th><th>Volume</th><th>Ad Count</th></tr></thead>
      <tbody>
''' + '\n'.join(adv_rows) + '''
      </tbody>
    </table>
  </div>
</div>

<!-- HOOKS -->
<div id="pemf-hooks" class="pane">
  <div class="section">
    <h2>Winning Hooks &amp; Copy Patterns</h2>
''' + hook_cards + '''
  </div>
</div>

<!-- LONGEVITY -->
<div id="pemf-longevity" class="pane">
  <div class="section">
    <h2>Top Performing Ads — Longevity &amp; Reach</h2>
    <table>
      <thead><tr><th>#</th><th>Advertiser</th><th>Hook / Angle</th><th>Why It Works</th><th>Status</th></tr></thead>
      <tbody>
''' + lon_rows + '''
      </tbody>
    </table>
  </div>
</div>

<!-- OHR STRATEGY -->
<div id="pemf-strategy" class="pane">
  <div class="section">
    <h2>OHR PEMF — Advertising Strategy</h2>
''' + strat_html + '''
  </div>
</div>

<!-- AD COPY SCRIPTS — placeholder, filled by part2 -->
<div id="pemf-scripts" class="pane">
  <div class="section">
    <h2>PEMF Therapy Ad Copy &mdash; 93 Scripts</h2>
    <p style="color:#8b949e;margin-bottom:16px">93 OHR-ready PEMF ad copy scripts. Each includes a DATA INSIGHT block showing the competitor hook that inspired it.</p>
    <input class="search-box" placeholder="Search scripts by condition, angle, keyword..." oninput="filterPEMFScripts(this.value)">
    <div id="pemfScriptCards">
    </div>
  </div>
</div>

</div><!-- end pemf-section -->
'''

# ── 10. Inject PEMF section after end of IR section ──────────────────────────
END_IR = '</div><!-- end ir-section -->'
idx = content.rfind(END_IR)
if idx == -1:
    print('ERROR: could not find end of ir-section')
    exit(1)

insert_pos = idx + len(END_IR)
content = content[:insert_pos] + '\n' + pemf_section + content[insert_pos:]

open(REPORT, 'w').write(content)
print(f'Part 1 done. File: {len(content):,} chars (was {orig_len:,})')
print(f'Injected PEMF section ({len(pemf_section):,} chars)')
