/**
 * Layout for a campaign landing page sitting inside the client's own
 * website design (getSiteChrome's head: their stylesheet and fonts). Same
 * rule as the blog's CHROME_CONTENT_CSS: no palette or typeface is named
 * here — text and headings take the site's own. The two colours the layout
 * needs to draw with (filled buttons, panels, rules) are the site's own page
 * background and text colour, read at load by the script in CampaignLanding
 * into --cl-paper / --cl-ink. The app's theme variables are re-pointed at
 * them inside .cl, so the enquiry form fits the site too.
 */
export const LANDING_CSS = `
.cl{--cl-ink:#1f1f1c;--cl-paper:#fafaf7;--cl-line:color-mix(in srgb,var(--cl-ink) 14%,transparent);--cl-soft:color-mix(in srgb,var(--cl-ink) 4%,var(--cl-paper));--cl-mute:color-mix(in srgb,var(--cl-ink) 62%,var(--cl-paper));
  --accent:var(--cl-ink);--accent-contrast:var(--cl-paper);--accent-soft:var(--cl-soft);--bg:var(--cl-paper);--surface-1:var(--cl-soft);--surface-2:var(--cl-soft);--hairline:var(--cl-line);--hairline-strong:color-mix(in srgb,var(--cl-ink) 30%,transparent);
  --text-primary:var(--cl-ink);--text-secondary:var(--cl-mute);--text-tertiary:color-mix(in srgb,var(--cl-ink) 45%,var(--cl-paper));--field-bg:var(--cl-paper);
  color:var(--cl-ink);background:var(--cl-paper);min-height:100vh;-webkit-font-smoothing:antialiased}
.cl *,.cl *::before,.cl *::after{box-sizing:border-box}
.cl-wrap{max-width:1200px;margin:0 auto;padding:0 clamp(18px,4.2vw,56px)}
.cl-eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--cl-mute);margin:0}
.cl h1,.cl h2,.cl h3{margin:0;color:var(--cl-ink);overflow-wrap:anywhere}
.cl p{margin:0}
.cl a:not(.cl-btn){color:inherit}
.cl a:focus-visible,.cl button:focus-visible,.cl summary:focus-visible{outline:2px solid var(--cl-ink);outline-offset:3px}

.cl-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid var(--cl-line)}
.cl-bar img{display:block;height:36px;width:auto;max-width:200px;object-fit:contain}
.cl-bar-name{font-weight:600;font-size:17px}
.cl-bar-right{display:flex;align-items:center;gap:18px}
.cl-tel{font-size:14px;letter-spacing:.04em;text-decoration:none;white-space:nowrap}
.cl-tel:hover{text-decoration:underline;text-underline-offset:4px}

.cl .cl-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 24px;border:1px solid var(--cl-ink);background:var(--cl-ink);color:var(--cl-paper);font:inherit;font-size:13px;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:background .2s ease,color .2s ease;border-radius:0}
.cl .cl-btn:hover{background:transparent;color:var(--cl-ink)}
.cl .cl-btn--ghost{background:transparent;color:var(--cl-ink)}
.cl .cl-btn--ghost:hover{background:var(--cl-ink);color:var(--cl-paper)}
.cl .cl-btn--sm{min-height:40px;padding:0 16px;font-size:12px}
.cl-btn[disabled]{opacity:.55;cursor:progress}
@media(max-width:560px){.cl-bar .cl-btn{display:none}}

.cl-hero{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:clamp(28px,5vw,72px);align-items:center;padding:clamp(36px,6vw,80px) 0 clamp(48px,7vw,96px)}
.cl-hero h1{font-size:clamp(38px,5.4vw,76px);line-height:.98;letter-spacing:-.02em;margin:18px 0 0}
.cl-hero-sub{font-size:clamp(16px,1.6vw,19px);line-height:1.6;color:var(--cl-mute);max-width:46ch;margin-top:22px !important}
.cl-hero-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.cl-hero-photo{position:relative;aspect-ratio:4/5;overflow:hidden;background:var(--cl-soft)}
.cl-hero-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.cl-hero--nophoto{grid-template-columns:minmax(0,1fr)}
.cl-hero--nophoto h1{max-width:16ch}
@media(max-width:860px){.cl-hero{grid-template-columns:1fr}.cl-hero-photo{order:-1;aspect-ratio:4/3;margin:0 calc(-1*clamp(18px,4.2vw,56px))}}

.cl-thanks{margin-top:30px;padding:22px 24px;border:1px solid var(--cl-ink);max-width:520px}
.cl-thanks h2{font-size:22px;margin-bottom:8px}
.cl-thanks p{line-height:1.6;color:var(--cl-mute)}

.cl-section{padding:clamp(56px,8vw,112px) 0;border-top:1px solid var(--cl-line)}
.cl-section-head{display:grid;gap:12px;margin-bottom:clamp(28px,4vw,48px);max-width:640px}
.cl-section-head h2{font-size:clamp(28px,3.6vw,46px);line-height:1.05;letter-spacing:-.01em}
.cl-section-head p{line-height:1.6;color:var(--cl-mute)}

.cl-menu{list-style:none;margin:0;padding:0;border-top:1px solid var(--cl-ink)}
.cl-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px 28px;padding:20px 0;border-bottom:1px solid var(--cl-line)}
.cl-item-name{font-size:clamp(17px,1.6vw,20px);line-height:1.3}
.cl-item-meta{display:block;font-size:13px;color:var(--cl-mute);margin-top:4px;letter-spacing:.02em}
.cl-price{display:flex;align-items:baseline;gap:12px;justify-content:flex-end;font-variant-numeric:tabular-nums;white-space:nowrap}
.cl-price-now{font-size:clamp(20px,2vw,24px);font-weight:600}
.cl-price-was{font-size:15px;color:var(--cl-mute);text-decoration:line-through}
.cl-item-closed{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--cl-mute)}
.cl-item-error{grid-column:1/-1;font-size:13.5px;margin:0}
@media(max-width:640px){.cl-item{grid-template-columns:minmax(0,1fr) auto;gap:10px 16px;padding:16px 0}.cl-price{grid-column:2;grid-row:1}.cl-item .cl-btn,.cl-item-closed{grid-column:2;grid-row:2;justify-self:end}.cl-item>div:first-child{grid-row:1/span 2;align-self:start}}
.cl-facts{display:flex;flex-wrap:wrap;gap:8px 28px;margin-top:22px;font-size:13.5px;color:var(--cl-mute)}
.cl-facts span{display:inline-flex;align-items:center;gap:8px}
.cl-terms{margin-top:14px !important;font-size:13px;line-height:1.6;color:var(--cl-mute);max-width:70ch}

.cl-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1.2vw,16px)}
.cl-strip figure{margin:0;aspect-ratio:3/4;overflow:hidden;background:var(--cl-soft)}
.cl-strip img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .9s cubic-bezier(.2,.7,.3,1)}
.cl-strip figure:hover img{transform:scale(1.04)}
.cl-strip--2{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:640px){.cl-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.cl-strip figure:nth-child(3){display:none}}

.cl-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 clamp(24px,4vw,64px)}
.cl-list li{padding:18px 0;border-top:1px solid var(--cl-line);line-height:1.6}
@media(max-width:760px){.cl-list{grid-template-columns:1fr}}

.cl-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(20px,3vw,40px)}
.cl-steps li{border-top:1px solid var(--cl-ink);padding-top:18px;display:grid;gap:10px;align-content:start}
.cl-step-n{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--cl-mute)}
.cl-steps h3{font-size:clamp(19px,1.8vw,22px);line-height:1.25}
.cl-steps p{line-height:1.6;color:var(--cl-mute)}
@media(max-width:760px){.cl-steps{grid-template-columns:1fr}}

.cl-why h3{font-size:clamp(18px,1.7vw,21px)}
.cl-strip{margin-bottom:clamp(8px,2vw,24px)}
.cl-faqs{border-top:1px solid var(--cl-ink);max-width:860px}
.cl-faq{border-bottom:1px solid var(--cl-line)}
.cl-faq summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 0;cursor:pointer;font-size:clamp(16px,1.5vw,19px)}
.cl-faq summary::-webkit-details-marker{display:none}
.cl-faq-icon{flex-shrink:0;transition:transform .25s ease}
.cl-faq[open] .cl-faq-icon{transform:rotate(45deg)}
.cl-faq p{padding:0 0 22px;line-height:1.65;color:var(--cl-mute);max-width:68ch}
@media(prefers-reduced-motion:reduce){.cl-faq-icon{transition:none}}
.cl-ask{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:clamp(28px,5vw,72px);align-items:start}
.cl-ask-form{background:var(--cl-soft);padding:clamp(20px,3vw,36px)}
.cl-visit{display:grid;gap:6px;margin-top:26px;line-height:1.6}
.cl-visit a{text-underline-offset:4px}
@media(max-width:860px){.cl-ask{grid-template-columns:1fr}}

.cl-foot{border-top:1px solid var(--cl-line);padding:28px 0 40px;font-size:13px;color:var(--cl-mute);display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between}

@media(prefers-reduced-motion:reduce){.cl-strip img,.cl-btn{transition:none}.cl-strip figure:hover img{transform:none}}
`;
