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
    ".rv-video{position:relative;padding-bottom:56.25%;height:0;border-radius:calc(var(--r) + 6px);overflow:hidden;background:#14130f}.rv-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}",
    ".rv-guar{display:flex;gap:18px;align-items:center;background:var(--pl);border-radius:calc(var(--r) + 6px);padding:26px;border:1px dashed var(--p)}.rv-guar .em{font-size:44px}",
    ".rv-sticky{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#fff;border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:14px;align-items:center;justify-content:space-between;box-shadow:0 -10px 30px -18px rgba(0,0,0,.25)}",
    ".rv-sticky b{font-size:15px}.rv-sticky .rv-btn{padding:12px 22px;font-size:15px}",
    ".rv-wa{position:fixed;right:16px;bottom:18px;z-index:60;width:58px;height:58px;border-radius:50%;background:#25d366;color:#fff!important;display:flex;align-items:center;justify-content:center;font-size:30px;text-decoration:none;box-shadow:0 10px 24px -8px rgba(37,211,102,.7)}",
    ".rv-footer{background:#14130f;color:#bdb9ad;padding:44px 20px;text-align:center;font-size:14px}.rv-footer a{color:#fff}",
    ".rv-sp{height:48px}.rv-hr{border:0;border-top:1px solid var(--line);margin:0}",
    ".rv-hero-bg{background:linear-gradient(135deg,var(--pl),#fff 60%)}",
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

  /* ---------- Blocks ---------- */
  // ctx: { product: 'Herbal Tea', price: '₦19,000', whatsapp: '2348012345678' }
  function build(ctx) {
    ctx = ctx || {};
    var P = ctx.product || "Your Product", PRICE = ctx.price || "₦19,000";
    var wa = String(ctx.whatsapp || "").replace(/\D/g, "");
    var waHref = wa ? "https://wa.me/" + wa : "https://wa.me/234";
    var B = [];
    function add(id, label, cat, icon, content, extra) { B.push(Object.assign({ id: id, label: label, category: cat, media: icon, content: content }, extra || {})); }

    /* Layout */
    add("section", "Section", "Layout", I.section, '<section class="rv-sec"><div class="rv-wrap"><h2 class="rv-h2">Section title</h2><p class="rv-p">Drop widgets here or edit this text.</p></div></section>');
    add("cols2", "2 Columns", "Layout", I.c2, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-cols c2"><div><h3 class="rv-h3">Left column</h3><p class="rv-p">Add anything here.</p></div><div><h3 class="rv-h3">Right column</h3><p class="rv-p">Add anything here.</p></div></div></div></section>');
    add("cols3", "3 Columns", "Layout", I.c3, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-cols c3 top"><div><h3 class="rv-h3">Column one</h3><p class="rv-p">Short supporting text.</p></div><div><h3 class="rv-h3">Column two</h3><p class="rv-p">Short supporting text.</p></div><div><h3 class="rv-h3">Column three</h3><p class="rv-p">Short supporting text.</p></div></div></div></section>');
    add("spacer", "Spacer", "Layout", I.space, '<div class="rv-sp"></div>');
    add("divider", "Divider", "Layout", I.hr, '<hr class="rv-hr">');

    /* Basic */
    add("heading", "Heading", "Basic", I.heading, '<h2 class="rv-h2">Your heading goes here</h2>');
    add("text", "Text", "Basic", I.text, '<p class="rv-p">Write something persuasive. Double-click to edit this text, select words to make them bold or add a link.</p>');
    add("image", "Image", "Basic", I.image, { type: "image", attributes: { src: PH, alt: "", class: "rv-img" }, activeOnRender: 0 });
    add("button", "Button", "Basic", I.button, '<a class="rv-btn" href="#order">Order now</a>');
    add("video", "Video", "Basic", I.video, '<div class="rv-video"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen loading="lazy"></iframe></div>');
    add("checklist", "Checklist", "Basic", I.list, '<ul class="rv-list"><li>First benefit your customer gets</li><li>Second benefit that removes a doubt</li><li>Third benefit with a clear result</li></ul>');

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
    add("order-form-only", "Order form (only)", "Order & Payment", I.form, { type: "rv-form" });
    add("bank-card", "Bank transfer details", "Order & Payment", I.bank, { type: "rv-bank" });
    add("thanks-hero", "Thank-you message", "Order & Payment", I.check,
      '<section class="rv-sec rv-center"><div class="rv-wrap narrow"><div class="rv-ico" style="width:72px;height:72px;font-size:36px;border-radius:50%">✓</div><h1 class="rv-h2">Thank you, your order is in!</h1><p class="rv-lead">A team member will contact you shortly to confirm your order and delivery details.</p><div data-rv-bank="1"></div><p class="rv-sub">Reference: <b data-rv-ref="1"></b></p></div></section>');
    return B;
  }

  /* ---------- Page templates ---------- */
  var TEMPLATES = [
    { id: "product-cod", name: "Product - pay on delivery", desc: "Hero, benefits, reviews, offer, FAQ and order form", kind: "page",
      blocks: ["announce", "hero-split", "stats", "features", "benefits", "testimonials", "offer", "guarantee", "faq", "order-form", "footer", "whatsapp"] },
    { id: "product-short", name: "Product - short page", desc: "A fast, focused page: hero, proof and the order form", kind: "page",
      blocks: ["announce", "hero-center", "features", "testimonials", "order-form", "footer", "sticky"] },
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

  global.RVBlocks = { build: build, BASE_CSS: BASE_CSS, FONTS: FONTS, DEFAULT_THEME: DEFAULT_THEME, themeCss: themeCss, fontsUrl: fontsUrl, TEMPLATES: TEMPLATES, templateHtml: templateHtml, PLACEHOLDER: PH, countdownScript: countdownScript };
})(window);
