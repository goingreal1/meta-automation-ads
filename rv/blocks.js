/* Revora website builder: design system (BASE_CSS), widgets (blocks) and page templates.
   Blocks are plain HTML that rely on BASE_CSS classes, so they stay clean, responsive and
   consistent; users restyle individual elements with the style panel (saved as id rules). */
(function (global) {
  "use strict";

  /* ---------- Theme ---------- */
  var FONTS = {
    "Inter": "Inter:wght@400;500;600;700;800",
    "Poppins": "Poppins:wght@400;500;600;700;800",
    "Montserrat": "Montserrat:wght@400;500;600;700;800",
    "DM Sans": "DM+Sans:wght@400;500;600;700",
    "Plus Jakarta Sans": "Plus+Jakarta+Sans:wght@400;500;600;700;800",
    "Playfair Display": "Playfair+Display:wght@500;600;700;800",
    "Fraunces": "Fraunces:wght@500;600;700",
    "Lora": "Lora:wght@400;500;600;700",
    "Nunito": "Nunito:wght@400;600;700;800",
    "Roboto": "Roboto:wght@400;500;700;900"
  };
  var DEFAULT_THEME = { primary: "#1a7a5e", heading: "Poppins", body: "Inter", radius: 12 };

  function fontsUrl(t) {
    var fams = {}; fams[t.heading] = 1; fams[t.body] = 1;
    var q = Object.keys(fams).filter(function (f) { return FONTS[f]; }).map(function (f) { return "family=" + FONTS[f]; });
    return q.length ? "https://fonts.googleapis.com/css2?" + q.join("&") + "&display=swap" : "";
  }
  function themeCss(t) {
    t = Object.assign({}, DEFAULT_THEME, t || {});
    return ":root{--p:" + t.primary + ";--r:" + (t.radius | 0) + "px;--fh:'" + t.heading + "',system-ui,sans-serif;--fb:'" + t.body + "',system-ui,sans-serif}\n";
  }

  var BASE_CSS = [
    ":root{--pd:color-mix(in srgb,var(--p) 78%,#000);--pl:color-mix(in srgb,var(--p) 10%,#fff);--ink:#14130f;--ink2:#55524a;--line:#e7e3da}",
    "*{box-sizing:border-box}",
    "body{margin:0;font-family:var(--fb);color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased;line-height:1.6;overflow-x:hidden}",
    "h1,h2,h3,h4{font-family:var(--fh);margin:0}",
    "img{max-width:100%;height:auto;display:block}",
    "a{color:var(--p)}",
    ".rv-sec{padding:76px 20px}",
    ".rv-sec.alt{background:#f7f6f2}.rv-sec.pl{background:var(--pl)}.rv-sec.dark{background:#14130f;color:#fff}.rv-sec.dark .rv-lead,.rv-sec.dark .rv-p{color:#c9c5b8}",
    ".rv-sec.tight{padding:44px 20px}",
    ".rv-wrap{max-width:1080px;margin:0 auto}.rv-wrap.narrow{max-width:760px}",
    ".rv-center{text-align:center}.rv-center .rv-lead{margin-left:auto;margin-right:auto;max-width:640px}",
    ".rv-eyebrow{display:inline-block;font-size:13px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--p);margin:0 0 12px}",
    ".rv-h1{font-size:clamp(32px,5.4vw,56px);line-height:1.08;font-weight:800;letter-spacing:-.025em;margin:0 0 18px}",
    ".rv-h2{font-size:clamp(26px,3.8vw,40px);line-height:1.15;font-weight:800;letter-spacing:-.02em;margin:0 0 14px}",
    ".rv-h3{font-size:20px;line-height:1.3;font-weight:700;margin:0 0 8px}",
    ".rv-lead{font-size:clamp(16px,2vw,19px);color:var(--ink2);line-height:1.65;margin:0 0 26px}",
    ".rv-p{font-size:16px;color:var(--ink2);margin:0 0 14px}",
    ".rv-btn{display:inline-block;background:var(--p);color:#fff!important;text-decoration:none;padding:16px 34px;border-radius:var(--r);font-weight:700;font-size:17px;line-height:1.2;text-align:center;box-shadow:0 10px 24px -12px var(--p);transition:transform .15s,background .15s}",
    ".rv-btn:hover{background:var(--pd);transform:translateY(-1px)}",
    ".rv-btn.ghost{background:transparent;color:var(--p)!important;box-shadow:inset 0 0 0 2px var(--p)}",
    ".rv-btn.block{display:block;width:100%}",
    ".rv-sub{font-size:13.5px;color:var(--ink2);margin:12px 0 0}",
    ".rv-cols{display:grid;gap:32px;align-items:center}",
    ".rv-cols.c2{grid-template-columns:1fr 1fr}.rv-cols.c3{grid-template-columns:repeat(3,1fr)}.rv-cols.c4{grid-template-columns:repeat(4,1fr)}",
    ".rv-cols.top{align-items:start}",
    ".rv-card{background:#fff;border:1px solid var(--line);border-radius:calc(var(--r) + 4px);padding:26px;box-shadow:0 1px 2px rgba(20,19,15,.04),0 18px 40px -26px rgba(20,19,15,.25)}",
    ".rv-ico{width:50px;height:50px;border-radius:14px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:25px;margin:0 0 14px}",
    ".rv-center .rv-ico{margin-left:auto;margin-right:auto}",
    ".rv-img{width:100%;border-radius:calc(var(--r) + 6px);object-fit:cover;background:#ece9e0}",
    ".rv-list{list-style:none;margin:0 0 22px;padding:0}.rv-list li{position:relative;padding:8px 0 8px 36px;font-size:17px;color:var(--ink)}",
    ".rv-list li::before{content:'\\2713';position:absolute;left:0;top:9px;width:24px;height:24px;border-radius:50%;background:var(--p);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}",
    ".rv-stars{color:#f5a623;letter-spacing:3px;font-size:18px;margin:0 0 10px}",
    ".rv-quote{font-size:16px;color:var(--ink);margin:0 0 16px}",
    ".rv-who{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--ink2)}.rv-who b{display:block;color:var(--ink);font-size:15px}",
    ".rv-av{width:44px;height:44px;border-radius:50%;background:var(--pl);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--p)}",
    ".rv-faq details{border:1px solid var(--line);border-radius:var(--r);padding:0;margin:0 0 12px;background:#fff}",
    ".rv-faq summary{cursor:pointer;font-weight:700;font-size:17px;list-style:none;display:flex;justify-content:space-between;gap:16px;padding:18px 22px}",
    ".rv-faq summary::-webkit-details-marker{display:none}.rv-faq summary::after{content:'+';font-size:24px;line-height:1;color:var(--p);font-weight:400}",
    ".rv-faq details[open] summary::after{content:'\\2013'}.rv-faq details p{margin:0;padding:0 22px 20px;color:var(--ink2)}",
    ".rv-top{background:var(--p);color:#fff;text-align:center;padding:11px 16px;font-size:14px;font-weight:600}",
    ".rv-price{text-align:center}.rv-price .was{text-decoration:line-through;color:#9a968a;font-size:20px;margin-right:8px}.rv-price .now{font-family:var(--fh);font-size:clamp(40px,7vw,56px);font-weight:800;color:var(--p);line-height:1.1}",
    ".rv-badge{display:inline-block;background:var(--pl);color:var(--pd);font-weight:700;font-size:13px;padding:6px 14px;border-radius:999px;margin:0 0 14px}",
    ".rv-pill{display:inline-flex;gap:8px;align-items:center;font-size:14px;color:var(--ink2);margin:0 16px 8px 0}",
    ".rv-cd{display:flex;gap:12px;justify-content:center;margin:0 0 18px}.rv-cd .b{min-width:72px;padding:12px 8px;border-radius:var(--r);background:#14130f;color:#fff;text-align:center}",
    ".rv-cd .b strong{display:block;font-family:var(--fh);font-size:30px;line-height:1.1}.rv-cd .b span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#bdb9ad}",
    ".rv-steps{counter-reset:s}.rv-step{position:relative;padding:0 0 0 64px;margin:0 0 26px}.rv-step::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:0;width:44px;height:44px;border-radius:50%;background:var(--p);color:#fff;font-weight:800;font-size:19px;display:flex;align-items:center;justify-content:center}",
    ".rv-stat{text-align:center}.rv-stat strong{display:block;font-family:var(--fh);font-size:clamp(30px,5vw,46px);font-weight:800;color:var(--p);line-height:1.1}.rv-stat span{color:var(--ink2);font-size:15px}",
    ".rv-guar{display:flex;gap:18px;align-items:center;background:var(--pl);border-radius:calc(var(--r) + 6px);padding:26px;border:1px dashed var(--p)}.rv-guar .em{font-size:44px}",
    ".rv-sticky{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#fff;border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:14px;align-items:center;justify-content:space-between;box-shadow:0 -10px 30px -18px rgba(0,0,0,.25)}",
    ".rv-sticky b{font-size:15px}.rv-sticky .rv-btn{padding:12px 22px;font-size:15px}",
    ".rv-wa{position:fixed;right:16px;bottom:18px;z-index:60;width:58px;height:58px;border-radius:50%;background:#25d366;color:#fff!important;display:flex;align-items:center;justify-content:center;font-size:30px;text-decoration:none;box-shadow:0 10px 24px -8px rgba(37,211,102,.7)}",
    ".rv-footer{background:#14130f;color:#bdb9ad;padding:44px 20px;text-align:center;font-size:14px}.rv-footer a{color:#fff}",
    ".rv-sp{height:48px}.rv-hr{border:0;border-top:1px solid var(--line);margin:0}",
    ".rv-hero-bg{background:linear-gradient(135deg,var(--pl),#fff 60%)}",
    ".rv-video{position:relative;width:100%;aspect-ratio:16/9;border-radius:calc(var(--r) + 6px);overflow:hidden;background:#000}.rv-video iframe,.rv-video video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}",
    ".rv-video[data-ratio='9:16']{aspect-ratio:9/16;max-width:380px;margin-left:auto;margin-right:auto}.rv-video[data-ratio='1:1']{aspect-ratio:1/1;max-width:560px;margin-left:auto;margin-right:auto}.rv-video[data-ratio='4:3']{aspect-ratio:4/3}",
    ".rv-map{position:relative;width:100%;height:380px;border-radius:calc(var(--r) + 6px);overflow:hidden;background:#e8e6df}.rv-map iframe{position:absolute;inset:0;width:100%;height:100%;border:0}",
    ".rv-gal{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.rv-gal img{aspect-ratio:1/1;object-fit:cover;border-radius:var(--r);width:100%}",
    ".rv-car{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:4px 2px 14px}.rv-car>*{flex:0 0 min(86%,380px);scroll-snap-align:start}.rv-car img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:calc(var(--r) + 4px)}",
    ".rv-plan{text-align:center;position:relative}.rv-plan.hot{border:2px solid var(--p);transform:translateY(-6px)}.rv-plan .tag{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:var(--p);color:#fff;font-size:12px;font-weight:700;padding:4px 14px;border-radius:99px;white-space:nowrap}",
    ".rv-plan .amt{font-family:var(--fh);font-size:40px;font-weight:800;color:var(--p);margin:6px 0 14px;line-height:1.1}.rv-plan .rv-list{text-align:left;display:inline-block}",
    ".rv-logos{display:flex;flex-wrap:wrap;gap:22px 40px;align-items:center;justify-content:center;opacity:.75}.rv-logos span{font-family:var(--fh);font-weight:800;font-size:20px;color:var(--ink2);letter-spacing:.02em}",
    ".rv-social{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.rv-social a{width:44px;height:44px;border-radius:50%;background:var(--pl);color:var(--p);display:flex;align-items:center;justify-content:center;font-weight:800;text-decoration:none;font-size:15px}",
    ".rv-contact{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.rv-contact .rv-btn{display:inline-flex;align-items:center;gap:8px}",
    ".rv-note{padding:16px 20px;border-radius:var(--r);background:var(--pl);border-left:4px solid var(--p);color:var(--ink);font-size:15.5px}.rv-note.warn{background:#fff6e5;border-left-color:#f5a623}",
    ".rv-bar{height:12px;border-radius:99px;background:#e9e6dd;overflow:hidden;margin:6px 0 14px}.rv-bar i{display:block;height:100%;background:var(--p);border-radius:99px}.rv-barl{display:flex;justify-content:space-between;font-weight:600;font-size:14px}",
    ".rv-cmp{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:#fff}.rv-cmp th,.rv-cmp td{padding:14px 16px;text-align:left;border-bottom:1px solid var(--line);font-size:15px}.rv-cmp th{background:var(--pl);font-family:var(--fh)}.rv-cmp tr:last-child td{border-bottom:0}",
    ".rv-nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;background:#fff;border-bottom:1px solid var(--line);position:relative}.rv-nav .logo{font-family:var(--fh);font-weight:800;font-size:21px;color:var(--ink);text-decoration:none}.rv-nav nav{display:flex;gap:22px;align-items:center}.rv-nav nav a{color:var(--ink2);text-decoration:none;font-weight:600;font-size:15px}.rv-nav nav .rv-btn{padding:10px 20px;font-size:15px;color:#fff}.rv-nav .rv-t{display:none}.rv-nav .rv-burger{display:none;font-size:26px;cursor:pointer;line-height:1}",
    ".rv-hero-img{background:#222 center/cover no-repeat;color:#fff;position:relative}.rv-hero-img::before{content:'';position:absolute;inset:0;background:rgba(10,10,10,.55)}.rv-hero-img>*{position:relative}.rv-hero-img .rv-lead{color:#e5e2d8}",
    ".rv-prod{text-align:center}.rv-prod .rv-img{aspect-ratio:1/1;margin-bottom:14px}",
    ".rv-tabs{max-width:860px;margin:0 auto}.rv-tablist{display:flex;gap:6px;flex-wrap:wrap;border-bottom:2px solid var(--line);margin-bottom:22px}.rv-tablist button{background:none;border:0;padding:13px 20px;font:inherit;font-weight:700;font-size:16px;color:var(--ink2);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}.rv-tablist button.on{color:var(--p);border-bottom-color:var(--p)}.rv-tabpanel{display:none}.rv-tabpanel.on{display:block}",
    ".rv-popup{position:fixed;inset:0;z-index:2000;background:rgba(10,10,10,.6);display:none;align-items:center;justify-content:center;padding:20px}.rv-popup.open{display:flex}.rv-popup-box{position:relative;background:#fff;border-radius:calc(var(--r) + 6px);padding:34px 28px;max-width:480px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.4);text-align:center}.rv-popup-x{position:absolute;top:10px;right:14px;background:none;border:0;font-size:28px;line-height:1;cursor:pointer;color:#8c887c}",
    ".rv-waform{max-width:480px;margin:0 auto}.rv-waform input,.rv-waform textarea{width:100%;margin:0 0 12px;padding:14px;border:1.5px solid var(--line);border-radius:var(--r);font:inherit;font-size:16px}.rv-waform .rv-btn{width:100%;border:0;cursor:pointer;background:#25d366;box-shadow:0 10px 24px -12px #25d366}",
    ".rv-banner{background:var(--pd);color:#fff;text-align:center;padding:30px 16px}.rv-bh{font-family:var(--fh);font-size:clamp(26px,6.4vw,50px);font-weight:800;line-height:1.14;text-transform:uppercase;margin:0}",
    ".rv-big{font-family:var(--fh);font-size:clamp(26px,6vw,46px);font-weight:800;line-height:1.15;text-transform:uppercase;text-align:center;margin:0;color:#000}",
    ".rv-red{color:var(--p)}.rv-up{text-transform:uppercase}",
    ".rv-story .rv-p{font-size:clamp(19px,4.4vw,22px);line-height:1.6;color:var(--ink);margin:0 0 20px}.rv-story .rv-h2{font-size:clamp(26px,6vw,40px);text-transform:uppercase;margin:0 0 22px}",
    ".rv-vcard{background:#2f4b94;border-radius:var(--r);padding:18px;margin:0 0 18px}.rv-vcard .rv-stars{margin:0 0 6px}.rv-vcard .rv-h3{color:#fff;text-align:center;font-size:24px;margin:0 0 12px}.rv-vcard .rv-video{border-radius:calc(var(--r) - 4px)}",
    ".rv-sticky.rv-float{background:none;border:0;box-shadow:none;padding:10px 16px 14px;justify-content:center}.rv-sticky.rv-float .rv-btn{width:100%;max-width:640px;display:block;box-shadow:0 12px 28px -12px rgba(0,0,0,.45)}",
    "@media(max-width:767px){.rv-gal{grid-template-columns:repeat(2,1fr)}.rv-plan.hot{transform:none}.rv-nav nav{display:none;position:absolute;top:100%;left:0;right:0;background:#fff;flex-direction:column;align-items:flex-start;padding:16px 20px;border-bottom:1px solid var(--line);z-index:30;gap:14px}.rv-nav .rv-burger{display:block}.rv-nav .rv-t:checked~nav{display:flex}.rv-map{height:300px}}",
    "@media(max-width:767px){.rv-sec{padding:50px 18px}.rv-sec.tight{padding:32px 18px}.rv-cols.c2,.rv-cols.c3,.rv-cols.c4{grid-template-columns:1fr;gap:22px}.rv-cols.rev>:first-child{order:2}.rv-guar{flex-direction:column;text-align:center}.rv-btn{width:100%;display:block}.rv-sticky .rv-btn{width:auto;display:inline-block}.rv-cd .b{min-width:62px}}"
  ].join("\n");

  /* ---------- Icons for the widget tiles ---------- */
  function ic(path) { return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>"; }
  var I = {
    section: ic('<rect x="3" y="5" width="18" height="14" rx="2"/>'),
    c2: ic('<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>'),
    c3: ic('<rect x="2.5" y="5" width="5.2" height="14" rx="1.2"/><rect x="9.4" y="5" width="5.2" height="14" rx="1.2"/><rect x="16.3" y="5" width="5.2" height="14" rx="1.2"/>'),
    space: ic('<path d="M12 4v16M8 7l4-3 4 3M8 17l4 3 4-3"/>'),
    hr: ic('<path d="M4 12h16"/>'),
    heading: ic('<path d="M6 5v14M18 5v14M6 12h12"/>'),
    text: ic('<path d="M5 6h14M5 10h14M5 14h14M5 18h9"/>'),
    image: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
    button: ic('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>'),
    video: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
    list: ic('<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4 7l1 1 2-2M4 12l1 1 2-2M4 17l1 1 2-2"/>'),
    hero: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10h10M9 14h6"/>'),
    split: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h5M7 13h4"/><rect x="14" y="8" width="4" height="7" rx="1"/>'),
    grid: ic('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    star: ic('<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6L12 16.7 6.5 19.6l1.2-6L3.2 9.4l6.1-.8z"/>'),
    quote: ic('<path d="M7 17c-2 0-3-1.3-3-3.5C4 10 6 8 9 7M17 17c-2 0-3-1.3-3-3.5 0-3.5 2-5.5 5-6.5"/>'),
    tag: ic('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
    faq: ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 015 .8c0 1.7-2.5 2.2-2.5 3.7M12 17.5v.1"/>'),
    shield: ic('<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    steps: ic('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M10 6h10M10 18h10M6 8.5v7"/>'),
    stats: ic('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
    bar: ic('<rect x="3" y="15" width="18" height="5" rx="1.5"/><path d="M3 5h18"/>'),
    chat: ic('<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>'),
    footer: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>'),
    form: ic('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    bank: ic('<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
    check: ic('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
    map: ic('<path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    code: ic('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>'),
    megaphone: ic('<path d="M4 10v4l12 5V5zM16 9a3 3 0 010 6"/>')
  };

  var PH = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#ece9e0"/><g fill="none" stroke="#b9b4a4" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><rect x="300" y="230" width="200" height="140" rx="14"/><circle cx="360" cy="285" r="16"/><path d="M500 345l-60-60-90 85"/></g><text x="400" y="430" font-family="Arial,sans-serif" font-size="26" fill="#9a958a" text-anchor="middle">Double-click to add your image</text></svg>');

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var countdownScript = function () {
          var el = this, hrs = parseFloat(el.getAttribute("data-rv-countdown")) || 24, key = "rv_cd_" + location.pathname, end;
          try { end = parseInt(localStorage.getItem(key), 10); } catch (e) {}
          if (!end || end < Date.now()) { end = Date.now() + hrs * 3600000; try { localStorage.setItem(key, end); } catch (e) {} }
          function pad(n) { return n < 10 ? "0" + n : "" + n; }
          function tick() {
            var d = Math.max(0, end - Date.now()), h = Math.floor(d / 3600000), m = Math.floor(d % 3600000 / 60000), s = Math.floor(d % 60000 / 1000);
            var set = function (u, v) { var n = el.querySelector('[data-u="' + u + '"]'); if (n) n.textContent = v; };
            set("h", pad(h)); set("m", pad(m)); set("s", pad(s));
          }
          tick(); setInterval(tick, 1000);
        };



  var tabsScript = function () {
    var el = this, btns = el.querySelectorAll(".rv-tablist button"), panels = el.querySelectorAll(".rv-tabpanel");
    for (var i = 0; i < btns.length; i++) (function (i) {
      btns[i].addEventListener("click", function () {
        for (var j = 0; j < btns.length; j++) { btns[j].classList.toggle("on", j === i); if (panels[j]) panels[j].classList.toggle("on", j === i); }
      });
    })(i);
  };
  var popupScript = function () {
    var el = this, key = "rv_popup_" + location.pathname, delay = parseFloat(el.getAttribute("data-delay")), exit = el.getAttribute("data-exit") === "1", once = el.getAttribute("data-once") !== "0";
    function seen() { try { return once && sessionStorage.getItem(key); } catch (e) { return false; } }
    function open() { if (seen()) return; el.classList.add("open"); try { sessionStorage.setItem(key, "1"); } catch (e) {} }
    function close() { el.classList.remove("open"); }
    el.addEventListener("click", function (e) { if (e.target === el || (e.target.closest && e.target.closest(".rv-popup-x"))) close(); });
    document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest('a[href="#rv-popup"]'); if (a) { e.preventDefault(); el.classList.add("open"); } });
    if (delay >= 0) setTimeout(open, delay * 1000);
    if (exit) document.addEventListener("mouseout", function (e) { if (e.clientY <= 0 && !e.relatedTarget) open(); });
  };
  var waformScript = function () {
    var el = this, f = el.querySelector("form"); if (!f) return;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var num = (el.getAttribute("data-number") || "").replace(/\D/g, ""), n = f.elements.name.value.trim(), p = f.elements.phone.value.trim(), m = f.elements.msg.value.trim();
      if (!n || !p) return;
      var text = "Hi, my name is " + n + " (" + p + "). " + (m || "I would like to know more.");
      window.open("https://wa.me/" + num + "?text=" + encodeURIComponent(text), "_blank");
    });
  };

  /* ---------- Video & map embeds ---------- */
  function videoEmbed(url, o) {
    o = o || {}; url = String(url || "").trim();
    var auto = o.autoplay ? 1 : 0, mute = (o.mute || o.autoplay) ? 1 : 0, loop = o.loop ? 1 : 0, ctr = o.controls === false ? 0 : 1, m;
    var attrs = ' allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen loading="lazy"';
    if (!url) return '<iframe src="about:blank" title="Video"></iframe>';
    var ifr = /^<iframe[\s\S]*?src=["']([^"']+)["']/i.exec(url); if (ifr) url = ifr[1];
    if ((m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url)))
      return '<iframe src="https://www.youtube-nocookie.com/embed/' + m[1] + "?rel=0&modestbranding=1&playsinline=1&autoplay=" + auto + "&mute=" + mute + "&controls=" + ctr + (loop ? "&loop=1&playlist=" + m[1] : "") + '" title="Video"' + attrs + "></iframe>";
    if ((m = /vimeo\.com\/(?:video\/|channels\/\w+\/|groups\/\w+\/videos\/)?(\d+)/.exec(url)))
      return '<iframe src="https://player.vimeo.com/video/' + m[1] + "?autoplay=" + auto + "&muted=" + mute + "&loop=" + loop + '&title=0&byline=0" title="Video"' + attrs + "></iframe>";
    if (/facebook\.com\/.+\/(videos|reel)|fb\.watch|facebook\.com\/watch|facebook\.com\/reel/.test(url))
      return '<iframe src="https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(url) + "&show_text=false&autoplay=" + auto + "&mute=" + mute + '" title="Video"' + attrs + "></iframe>";
    if ((m = /tiktok\.com\/.*\/video\/(\d+)/.exec(url)))
      return '<iframe src="https://www.tiktok.com/embed/v2/' + m[1] + '" title="Video"' + attrs + "></iframe>";
    if ((m = /instagram\.com\/(reel|reels|p|tv)\/([\w-]+)/.exec(url)))
      return '<iframe src="https://www.instagram.com/' + (m[1] === "reels" ? "reel" : m[1]) + "/" + m[2] + '/embed" title="Video"' + attrs + "></iframe>";
    if ((m = /loom\.com\/(?:share|embed)\/(\w+)/.exec(url)))
      return '<iframe src="https://www.loom.com/embed/' + m[1] + "?autoplay=" + auto + '" title="Video"' + attrs + "></iframe>";
    if ((m = /wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/(\w+)/.exec(url)))
      return '<iframe src="https://fast.wistia.net/embed/iframe/' + m[1] + "?autoPlay=" + (auto ? "true" : "false") + '" title="Video"' + attrs + "></iframe>";
    if ((m = /dailymotion\.com\/video\/(\w+)/.exec(url)))
      return '<iframe src="https://www.dailymotion.com/embed/video/' + m[1] + "?autoplay=" + auto + '" title="Video"' + attrs + "></iframe>";
    if ((m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url)))
      return '<iframe src="https://drive.google.com/file/d/' + m[1] + '/preview" title="Video"' + attrs + "></iframe>";
    if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url))
      return '<video src="' + esc(url) + '" playsinline preload="metadata"' + (ctr ? " controls" : "") + (auto ? " autoplay" : "") + (mute ? " muted" : "") + (loop ? " loop" : "") + "></video>";
    return '<iframe src="' + esc(url) + '" title="Video"' + attrs + "></iframe>";
  }
  function videoRatioFor(url) { return /tiktok\.com|instagram\.com\/(reel|reels)|youtube\.com\/shorts|facebook\.com\/reel/.test(url || "") ? "9:16" : "16:9"; }
  function mapEmbed(q) { return '<iframe src="https://maps.google.com/maps?q=' + encodeURIComponent(q || "Lagos, Nigeria") + '&output=embed" title="Map" loading="lazy"></iframe>'; }

  /* ---------- Blocks ---------- */
  // ctx: { product: 'Herbal Tea', price: '₦19,000', whatsapp: '2348012345678' }
  function build(ctx) {
    ctx = ctx || {};
    var P = ctx.product || "Your Product", PRICE = ctx.price || "₦19,000";
    var wa = String(ctx.whatsapp || "").replace(/\D/g, "");
    var waHref = wa ? "https://wa.me/" + wa : "https://wa.me/234";
    var B = [];
    function add(id, label, cat, icon, content, extra) {
      // widget = a bare element that can sit inside any column (the builder wraps it in a section when dropped at page level)
      // top = a full-width section / fixed bar that only ever lives at page level
      var top = !(extra && extra.widget) && typeof content === "string" && /^\s*<(section|header|footer)\b|^\s*<div class="rv-(top|sticky|popup)|^\s*<a class="rv-wa/.test(content);
      B.push(Object.assign({ id: id, label: label, category: cat, media: icon, content: content, widget: false, top: top }, extra || {}));
    }

    /* Layout */
    add("section", "Section", "Layout", I.section, '<section class="rv-sec"><div class="rv-wrap"><h2 class="rv-h2">Section title</h2><p class="rv-p">Drop widgets here or edit this text.</p></div></section>');
    add("cols2", "2 Columns", "Layout", I.c2, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-cols c2"><div><h3 class="rv-h3">Left column</h3><p class="rv-p">Add anything here.</p></div><div><h3 class="rv-h3">Right column</h3><p class="rv-p">Add anything here.</p></div></div></div></section>');
    add("cols3", "3 Columns", "Layout", I.c3, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-cols c3 top"><div><h3 class="rv-h3">Column one</h3><p class="rv-p">Short supporting text.</p></div><div><h3 class="rv-h3">Column two</h3><p class="rv-p">Short supporting text.</p></div><div><h3 class="rv-h3">Column three</h3><p class="rv-p">Short supporting text.</p></div></div></div></section>');
    add("spacer", "Spacer", "Layout", I.space, '<div class="rv-sp"></div>');
    add("divider", "Divider", "Layout", I.hr, '<hr class="rv-hr">');

    /* Basic */
    add("heading", "Heading", "Basic", I.heading, '<h2 class="rv-h2">Your heading goes here</h2>', { widget: true });
    add("text", "Text", "Basic", I.text, '<p class="rv-p">Write something persuasive. Double-click to edit this text, select words to make them bold or add a link.</p>', { widget: true });
    add("image", "Image", "Basic", I.image, { type: "image", attributes: { src: PH, alt: "", class: "rv-img" }, activeOnRender: 0 }, { widget: true });
    add("button", "Button", "Basic", I.button, '<a class="rv-btn" href="#order">Order now</a>', { widget: true });
    add("video", "Video", "Media", I.video, '<div class="rv-video" data-src="" data-ratio="16:9">' + videoEmbed("") + "</div>", { widget: true });
    add("checklist", "Checklist", "Basic", I.list, '<ul class="rv-list"><li>First benefit your customer gets</li><li>Second benefit that removes a doubt</li><li>Third benefit with a clear result</li></ul>', { widget: true });

    /* Sections */
    add("announce", "Announcement bar", "Sections", I.megaphone, '<div class="rv-top">🔥 Pay on delivery &middot; Free delivery in Lagos &middot; Limited stock</div>');
    add("hero-center", "Hero - centered", "Sections", I.hero,
      '<section class="rv-sec rv-hero-bg rv-center"><div class="rv-wrap narrow"><span class="rv-badge">New &middot; Pay on delivery</span><h1 class="rv-h1">The simple way to get ' + esc(P) + '</h1><p class="rv-lead">One clear sentence that explains the result your customer wants and why they can trust you to deliver it.</p><a class="rv-btn" href="#order">Order now &mdash; ' + esc(PRICE) + '</a><p class="rv-sub">✔ Pay on delivery &nbsp; ✔ Fast delivery &nbsp; ✔ Money-back promise</p></div></section>');
    add("hero-split", "Hero - with image", "Sections", I.split,
      '<section class="rv-sec rv-hero-bg"><div class="rv-wrap"><div class="rv-cols c2"><div><span class="rv-badge">Bestseller</span><h1 class="rv-h1">Say hello to ' + esc(P) + '</h1><p class="rv-lead">Explain the biggest result in one or two lines. Be specific, be honest, and speak the way your customers speak.</p><a class="rv-btn" href="#order">Order now &mdash; ' + esc(PRICE) + '</a><p class="rv-sub">✔ Pay on delivery &nbsp; ✔ Delivery nationwide</p></div><div><img class="rv-img" src="' + PH + '" alt=""></div></div></div></section>');
    add("features", "Features (3 cards)", "Sections", I.grid,
      '<section class="rv-sec"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Why people love it</span><h2 class="rv-h2">Everything you need, nothing you don\'t</h2><p class="rv-lead">A short line that sets up the three reasons below.</p></div><div class="rv-cols c3 top"><div class="rv-card rv-center"><div class="rv-ico">⚡</div><h3 class="rv-h3">Fast results</h3><p class="rv-p">Describe the first benefit in plain words.</p></div><div class="rv-card rv-center"><div class="rv-ico">🌿</div><h3 class="rv-h3">Quality you can trust</h3><p class="rv-p">Describe the second benefit in plain words.</p></div><div class="rv-card rv-center"><div class="rv-ico">🚚</div><h3 class="rv-h3">Delivered to your door</h3><p class="rv-p">Describe the third benefit in plain words.</p></div></div></div></section>');
    add("benefits", "Benefits + image", "Sections", I.split,
      '<section class="rv-sec alt"><div class="rv-wrap"><div class="rv-cols c2 rev"><div><img class="rv-img" src="' + PH + '" alt=""></div><div><span class="rv-eyebrow">What you get</span><h2 class="rv-h2">Made to make your life easier</h2><ul class="rv-list"><li>Benefit one in a few words</li><li>Benefit two in a few words</li><li>Benefit three in a few words</li><li>Benefit four in a few words</li></ul><a class="rv-btn" href="#order">Get yours today</a></div></div></div></section>');
    add("steps", "How it works", "Sections", I.steps,
      '<section class="rv-sec"><div class="rv-wrap narrow"><div class="rv-center"><span class="rv-eyebrow">Simple process</span><h2 class="rv-h2">How it works</h2></div><div class="rv-steps"><div class="rv-step"><h3 class="rv-h3">Fill the short form</h3><p class="rv-p">Tell us your name, phone number and where to deliver.</p></div><div class="rv-step"><h3 class="rv-h3">We call to confirm</h3><p class="rv-p">A team member confirms your order and delivery details.</p></div><div class="rv-step"><h3 class="rv-h3">Receive and pay</h3><p class="rv-p">Your order arrives and you pay only when you are satisfied.</p></div></div></div></section>');
    add("testimonials", "Testimonials", "Sections", I.quote,
      '<section class="rv-sec alt"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Real customers</span><h2 class="rv-h2">What people are saying</h2></div><div class="rv-cols c3 top"><div class="rv-card"><div class="rv-stars">★★★★★</div><p class="rv-quote">“A short, believable quote about the result they got. Use their real words.”</p><div class="rv-who"><div class="rv-av">A</div><div><b>Adaeze O.</b>Lagos</div></div></div><div class="rv-card"><div class="rv-stars">★★★★★</div><p class="rv-quote">“A short, believable quote about the result they got. Use their real words.”</p><div class="rv-who"><div class="rv-av">T</div><div><b>Tunde A.</b>Abuja</div></div></div><div class="rv-card"><div class="rv-stars">★★★★★</div><p class="rv-quote">“A short, believable quote about the result they got. Use their real words.”</p><div class="rv-who"><div class="rv-av">F</div><div><b>Fatima B.</b>Kano</div></div></div></div></div></section>');
    add("offer", "Offer / price card", "Sections", I.tag,
      '<section class="rv-sec pl"><div class="rv-wrap narrow"><div class="rv-card rv-center"><span class="rv-badge">Today\'s offer</span><h2 class="rv-h2">' + esc(P) + '</h2><div class="rv-price"><span class="was">₦30,000</span><span class="now">' + esc(PRICE) + '</span></div><ul class="rv-list" style="display:inline-block;text-align:left;margin-top:18px"><li>Pay on delivery</li><li>Fast delivery to your door</li><li>Money-back promise</li></ul><div><a class="rv-btn" href="#order">Order now</a></div></div></div></section>');
    add("stats", "Numbers", "Sections", I.stats,
      '<section class="rv-sec tight"><div class="rv-wrap"><div class="rv-cols c3"><div class="rv-stat"><strong>5,000+</strong><span>Happy customers</span></div><div class="rv-stat"><strong>4.9/5</strong><span>Average rating</span></div><div class="rv-stat"><strong>24hrs</strong><span>Delivery in Lagos</span></div></div></div></section>');
    add("guarantee", "Guarantee", "Sections", I.shield,
      '<section class="rv-sec tight"><div class="rv-wrap narrow"><div class="rv-guar"><div class="em">🛡️</div><div><h3 class="rv-h3">Our promise to you</h3><p class="rv-p" style="margin:0">Order, receive, then pay. If it is not what we promised, tell us and we will make it right.</p></div></div></div></section>');
    add("faq", "FAQ", "Sections", I.faq,
      '<section class="rv-sec"><div class="rv-wrap narrow rv-faq"><div class="rv-center"><span class="rv-eyebrow">Questions</span><h2 class="rv-h2">Frequently asked questions</h2></div><details><summary>How does pay on delivery work?</summary><p>You place your order, we call to confirm, and you pay when it arrives.</p></details><details><summary>How long does delivery take?</summary><p>Lagos: 24 to 48 hours. Other states: 2 to 4 working days.</p></details><details><summary>What if I have a problem with my order?</summary><p>Message us on WhatsApp and we will sort it out quickly.</p></details></div></section>');
    add("countdown", "Countdown offer", "Sections", I.clock,
      '<section class="rv-sec tight rv-center"><div class="rv-wrap narrow"><span class="rv-badge">⏰ Offer ends soon</span><div class="rv-cd" data-rv-countdown="24"><div class="b"><strong data-u="h">00</strong><span>Hours</span></div><div class="b"><strong data-u="m">00</strong><span>Mins</span></div><div class="b"><strong data-u="s">00</strong><span>Secs</span></div></div><a class="rv-btn" href="#order">Claim this offer</a></div></section>');
    add("sticky", "Sticky order bar", "Sections", I.bar, '<div class="rv-sticky"><b>' + esc(P) + ' &middot; ' + esc(PRICE) + '</b><a class="rv-btn" href="#order">Order now</a></div>');
    add("whatsapp", "WhatsApp button", "Sections", I.chat, '<a class="rv-wa" href="' + waHref + '" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">💬</a>');
    add("footer", "Footer", "Sections", I.footer, '<footer class="rv-footer"><p style="margin:0 0 6px">&copy; <span data-rv-year>2026</span> ' + esc(ctx.siteName || "Your Business") + '. All rights reserved.</p><p style="margin:0"><a href="#">Contact us</a></p></footer>');

    /* Order & payment (these connect to your Orders tab) */
    add("order-form", "Order form", "Order & Payment", I.form,
      '<section class="rv-sec alt" id="order"><div class="rv-wrap narrow"><div class="rv-center"><span class="rv-eyebrow">Order now</span><h2 class="rv-h2">Get ' + esc(P) + ' delivered</h2></div><div data-rv-form="1"></div></div></section>');
    add("order-form-only", "Order form (only)", "Order & Payment", I.form, { type: "rv-form" }, { widget: true });
    add("bank-card", "Bank transfer details", "Order & Payment", I.bank, { type: "rv-bank" }, { widget: true });
    add("thanks-hero", "Thank-you message", "Order & Payment", I.check,
      '<section class="rv-sec rv-center"><div class="rv-wrap narrow"><div class="rv-ico" style="width:72px;height:72px;font-size:36px;border-radius:50%">✓</div><h1 class="rv-h2">Thank you, your order is in!</h1><p class="rv-lead">A team member will contact you shortly to confirm your order and delivery details.</p><div data-rv-bank="1"></div><p class="rv-sub">Reference: <b data-rv-ref="1"></b></p></div></section>');

    /* Media */
    add("video-vertical", "Video - vertical", "Media", I.video, '<div class="rv-video" data-src="" data-ratio="9:16">' + videoEmbed("") + "</div>", { widget: true });
    add("gallery", "Image gallery", "Media", I.grid, '<div class="rv-gal">' + [1, 2, 3, 4, 5, 6].map(function () { return '<img src="' + PH + '" alt="">'; }).join("") + "</div>", { widget: true });
    add("carousel", "Image slider", "Media", I.image, '<div class="rv-car">' + [1, 2, 3, 4, 5].map(function () { return '<div><img src="' + PH + '" alt=""></div>'; }).join("") + "</div>", { widget: true });
    add("map", "Map", "Media", I.map, '<div class="rv-map" data-q="Ikeja, Lagos, Nigeria">' + mapEmbed("Ikeja, Lagos, Nigeria") + "</div>", { widget: true });
    add("embed", "Custom HTML / embed", "Media", I.code, '<div class="rv-custom" data-rv-html="1"><div class="rv-note">Custom HTML area. Paste your HTML, a form, a widget or any embed in the “HTML code” box on the right.</div></div>', { widget: true });

    /* Bold sales page (headline-first, image-led, big red order buttons) */
    var CTA = "🛒 CLICK HERE TO ORDER NOW !!!";
    add("sp-banner", "Red headline banner", "Sales page", I.megaphone, '<section class="rv-banner"><div class="rv-wrap narrow"><h1 class="rv-bh">Struggling with blurry or tired eyes? Your eyes may need more than glasses</h1></div></section>');
    add("sp-headline", "Big centered headline", "Sales page", I.heading, '<section class="rv-sec tight"><div class="rv-wrap narrow"><h2 class="rv-big">Here is a 7 day remedy for all eye defect &mdash; ' + esc(P) + '</h2></div></section>');
    add("sp-image", "Full-width image", "Sales page", I.image, '<section class="rv-sec tight"><div class="rv-wrap"><img class="rv-img" src="' + PH + '" alt=""></div></section>');
    add("sp-cta", "Big order button", "Sales page", I.button, '<section class="rv-sec tight"><div class="rv-wrap narrow"><a class="rv-btn block" href="#order">' + CTA + '</a></div></section>');
    add("sp-story", "Story text (left aligned)", "Sales page", I.text, '<section class="rv-sec"><div class="rv-wrap narrow rv-story"><h2 class="rv-h2">It starts with a little problem&hellip; then it never feels the same again.</h2><p class="rv-p">Maybe you have noticed it already. Describe the problem the way your customer feels it, in their own words.</p><p class="rv-p">At first it is easy to brush it off. But when it keeps coming back, everyday things start to feel like a struggle.</p><p class="rv-p">Then introduce the solution and why now is the time to act.</p></div></section>');
    add("sp-reviews", "Review screenshots (2)", "Sales page", I.quote, '<section class="rv-sec tight"><div class="rv-wrap"><h2 class="rv-big rv-red" style="font-size:clamp(24px,5.4vw,40px);margin-bottom:22px;text-transform:none">Check our customers honest review</h2><div class="rv-cols c2 top"><img class="rv-img" src="' + PH + '" alt=""><img class="rv-img" src="' + PH + '" alt=""></div></div></section>');
    add("sp-warning", "Red warning line", "Sales page", I.megaphone, '<section class="rv-sec tight"><div class="rv-wrap narrow"><p class="rv-red rv-up" style="text-align:center;font-weight:800;font-size:clamp(18px,4.4vw,26px);line-height:1.3;margin:0">Please stop gambling with your life. Act now before it gets worse&hellip;</p></div></section>');
    add("sp-video-card", "Video testimonial card", "Sales page", I.video, '<section class="rv-sec tight"><div class="rv-wrap narrow"><div class="rv-vcard"><div class="rv-stars">★★★★★</div><h3 class="rv-h3">Happy customer</h3><div class="rv-video" data-src="" data-ratio="16:9">' + videoEmbed("") + "</div></div></div></section>");
    add("sp-float", "Floating order button", "Sales page", I.bar, '<div class="rv-sticky rv-float"><a class="rv-btn block" href="#order">' + CTA + "</a></div>");

    /* More sections */
    add("navbar", "Header / menu", "Sections", I.bar, '<header class="rv-nav"><a class="logo" href="#">' + esc(ctx.siteName || "Your Brand") + '</a><input type="checkbox" id="rvnav" class="rv-t"><label for="rvnav" class="rv-burger">☰</label><nav><a href="#features">Features</a><a href="#reviews">Reviews</a><a href="#faq">FAQ</a><a class="rv-btn" href="#order">Order now</a></nav></header>');
    add("hero-image", "Hero - image background", "Sections", I.hero, '<section class="rv-sec rv-hero-img rv-center" style="background-image:linear-gradient(135deg,#2b3a35,#0f1413);padding:120px 20px"><div class="rv-wrap narrow"><h1 class="rv-h1">A bold headline over your photo</h1><p class="rv-lead">Pick a background image in the Style tab &rarr; Background.</p><a class="rv-btn" href="#order">Order now &mdash; ' + esc(PRICE) + "</a></div></section>");
    add("pricing", "Pricing table", "Sections", I.tag, '<section class="rv-sec alt"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Packages</span><h2 class="rv-h2">Choose your package</h2></div><div class="rv-cols c3 top"><div class="rv-card rv-plan"><h3 class="rv-h3">Starter</h3><div class="amt">₦19,000</div><ul class="rv-list"><li>1 piece</li><li>Pay on delivery</li></ul><a class="rv-btn block" href="#order">Order</a></div><div class="rv-card rv-plan hot"><span class="tag">Best value</span><h3 class="rv-h3">Family</h3><div class="amt">₦45,000</div><ul class="rv-list"><li>3 pieces</li><li>Free delivery</li><li>Pay on delivery</li></ul><a class="rv-btn block" href="#order">Order</a></div><div class="rv-card rv-plan"><h3 class="rv-h3">Business</h3><div class="amt">₦70,000</div><ul class="rv-list"><li>5 pieces</li><li>Free delivery</li><li>Priority support</li></ul><a class="rv-btn block" href="#order">Order</a></div></div></div></section>');
    add("product-card", "Product showcase", "Sections", I.image, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-cols c3 top">' + [1, 2, 3].map(function (n) { return '<div class="rv-card rv-prod"><img class="rv-img" src="' + PH + '" alt=""><h3 class="rv-h3">Product ' + n + '</h3><p class="rv-p">Short description</p><div class="rv-price"><span class="now" style="font-size:28px">' + esc(PRICE) + '</span></div><a class="rv-btn block" href="#order">Order now</a></div>'; }).join("") + "</div></div></section>");
    add("logos", "Logo / press strip", "Sections", I.stats, '<section class="rv-sec tight"><div class="rv-wrap"><p class="rv-sub rv-center" style="margin:0 0 16px">As seen on</p><div class="rv-logos"><span>BRAND ONE</span><span>Brand Two</span><span>BRAND THREE</span><span>Brand Four</span></div></div></section>');
    add("compare", "Comparison table", "Sections", I.grid, '<section class="rv-sec"><div class="rv-wrap narrow"><div class="rv-center"><h2 class="rv-h2">Why choose us</h2></div><table class="rv-cmp"><tr><th></th><th>Us</th><th>Others</th></tr><tr><td>Pay on delivery</td><td>✅</td><td>❌</td></tr><tr><td>Fast delivery</td><td>✅</td><td>❌</td></tr><tr><td>Money-back promise</td><td>✅</td><td>❌</td></tr></table></div></section>');
    add("progress", "Stock / progress bars", "Sections", I.stats, '<section class="rv-sec tight"><div class="rv-wrap narrow"><div class="rv-barl"><span>Stock left</span><span>Only 7 left</span></div><div class="rv-bar"><i style="width:18%"></i></div><div class="rv-barl"><span>Orders today</span><span>83%</span></div><div class="rv-bar"><i style="width:83%"></i></div></div></section>');
    add("notice", "Notice box", "Basic", I.megaphone, '<div class="rv-note"><b>Good to know:</b> Delivery takes 24 to 48 hours in Lagos.</div>', { widget: true });
    add("contact", "Contact buttons", "Sections", I.chat, '<section class="rv-sec tight rv-center"><div class="rv-wrap narrow"><h2 class="rv-h2">Questions? Talk to us</h2><div class="rv-contact"><a class="rv-btn" href="tel:+' + (wa || "234") + '">📞 Call us</a><a class="rv-btn ghost" href="' + waHref + '" target="_blank" rel="noopener">💬 WhatsApp</a><a class="rv-btn ghost" href="mailto:hello@example.com">✉️ Email</a></div></div></section>');
    add("social", "Social icons", "Basic", I.chat, '<div class="rv-social"><a href="https://facebook.com" target="_blank" rel="noopener">f</a><a href="https://instagram.com" target="_blank" rel="noopener">ig</a><a href="https://tiktok.com" target="_blank" rel="noopener">tt</a><a href="https://youtube.com" target="_blank" rel="noopener">yt</a><a href="' + waHref + '" target="_blank" rel="noopener">wa</a></div>', { widget: true });
    add("iconbox-row", "Icon boxes (4)", "Sections", I.grid, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-cols c4 top"><div class="rv-center"><div class="rv-ico">🚚</div><h3 class="rv-h3">Fast delivery</h3><p class="rv-p">Nationwide</p></div><div class="rv-center"><div class="rv-ico">💳</div><h3 class="rv-h3">Pay on delivery</h3><p class="rv-p">No risk</p></div><div class="rv-center"><div class="rv-ico">🔒</div><h3 class="rv-h3">Secure</h3><p class="rv-p">Private details</p></div><div class="rv-center"><div class="rv-ico">💬</div><h3 class="rv-h3">Support</h3><p class="rv-p">On WhatsApp</p></div></div></div></section>');

    /* Interactive */
    add("tabs", "Tabs", "Interactive", I.faq, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-tabs" data-rv-tabs="1"><div class="rv-tablist"><button class="on">Overview</button><button>Ingredients</button><button>How to use</button></div><div class="rv-tabpanel on"><h3 class="rv-h3">Overview</h3><p class="rv-p">Explain what the product is and who it is for.</p></div><div class="rv-tabpanel"><h3 class="rv-h3">Ingredients</h3><p class="rv-p">List what is inside and why it matters.</p></div><div class="rv-tabpanel"><h3 class="rv-h3">How to use</h3><p class="rv-p">Give simple, numbered steps.</p></div></div></div></section>');
    add("popup", "Popup offer", "Interactive", I.megaphone, '<div class="rv-popup" data-rv-popup="1" data-delay="8" data-exit="1" data-once="1"><div class="rv-popup-box"><button class="rv-popup-x" aria-label="Close">×</button><span class="rv-badge">Wait! Special offer</span><h2 class="rv-h2">Get ' + esc(P) + ' today</h2><p class="rv-p">Order now and pay on delivery. Limited stock.</p><a class="rv-btn block" href="#order">Order now</a></div></div>');
    add("wa-form", "WhatsApp quick form", "Interactive", I.chat, '<section class="rv-sec tight alt"><div class="rv-wrap narrow rv-center"><h2 class="rv-h2">Chat with us on WhatsApp</h2><div class="rv-waform" data-rv-waform="1" data-number="' + (wa || "234") + '"><form><input name="name" placeholder="Your name" required><input name="phone" type="tel" placeholder="Your phone number" required><textarea name="msg" rows="3" placeholder="How can we help?"></textarea><button type="submit" class="rv-btn">💬 Continue on WhatsApp</button></form></div></div></section>');
    return B;
  }

  /* ---------- Page templates ---------- */
  var TEMPLATES = [
    { id: "product-cod", name: "Product - pay on delivery", desc: "Hero, benefits, reviews, offer, FAQ and order form", kind: "page",
      blocks: ["announce", "hero-split", "stats", "features", "benefits", "testimonials", "offer", "guarantee", "faq", "order-form", "footer", "whatsapp"] },
    { id: "product-short", name: "Product - short page", desc: "A fast, focused page: hero, proof and the order form", kind: "page",
      blocks: ["announce", "hero-center", "features", "testimonials", "order-form", "footer", "sticky"] },
    { id: "bold-sales", name: "Bold sales page", desc: "Red headline banner, big image, story, review screenshots, video testimonials and a floating order button", kind: "page", theme: { primary: "#e03a24", heading: "Roboto", body: "Montserrat" },
      blocks: ["sp-banner", "sp-headline", "sp-image", "sp-cta", "sp-story", "sp-cta", "sp-reviews", "sp-warning", "sp-video-card", "sp-video-card", "sp-cta", "order-form", "footer", "sp-float"] },
    { id: "service", name: "Service - bank transfer", desc: "Sell a service: steps, proof, FAQ and a form that shows your bank details", kind: "page",
      blocks: ["announce", "hero-center", "steps", "features", "testimonials", "guarantee", "faq", "order-form", "footer", "whatsapp"] },
    { id: "thanks", name: "Thank-you page", desc: "Shown after an order; includes bank details when relevant", kind: "thanks",
      blocks: ["thanks-hero", "footer"] },
    { id: "blank", name: "Blank page", desc: "Start from scratch", kind: "page", blocks: [] }
  ];

  function templateHtml(tpl, ctx) {
    var byId = {}; build(ctx).forEach(function (b) { byId[b.id] = b; });
    return tpl.blocks.map(function (id) { var c = byId[id] && byId[id].content; return typeof c === "string" ? c : ""; }).join("\n");
  }

  global.RVBlocks = { build: build, BASE_CSS: BASE_CSS, FONTS: FONTS, DEFAULT_THEME: DEFAULT_THEME, themeCss: themeCss, fontsUrl: fontsUrl, TEMPLATES: TEMPLATES, templateHtml: templateHtml, PLACEHOLDER: PH, countdownScript: countdownScript, tabsScript: tabsScript, popupScript: popupScript, waformScript: waformScript, videoEmbed: videoEmbed, videoRatioFor: videoRatioFor, mapEmbed: mapEmbed };
})(window);
