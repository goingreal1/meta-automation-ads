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

  var CART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>';
  var CART_URL = 'url("data:image/svg+xml,' + encodeURIComponent(CART_SVG) + '")';

  var BASE_CSS = [
    ":root{--cart:" + CART_URL + "}",
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
    ".rv-cols.c1{grid-template-columns:1fr}.rv-cols.c5{grid-template-columns:repeat(5,1fr)}.rv-cols.c6{grid-template-columns:repeat(6,1fr)}.rv-cols.auto{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}",
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
    ".rv-story .rv-p{font-size:clamp(19px,4.4vw,22px);line-height:1.6;color:var(--ink);margin:0 0 20px}.rv-story .rv-h2{font-family:var(--fb);font-size:clamp(24px,6vw,40px);font-weight:800;text-transform:uppercase;margin:0 0 22px}",
    ".rv-vcard{background:#2f4b94;border-radius:var(--r);padding:18px;margin:0 0 18px}.rv-vcard .rv-stars{margin:0 0 6px}.rv-vcard .rv-h3{color:#fff;text-align:center;font-size:24px;margin:0 0 12px}.rv-vcard .rv-video{border-radius:calc(var(--r) - 4px)}",
    ".rv-sticky.rv-float{background:none;border:0;box-shadow:none;padding:10px 16px 14px;justify-content:center}.rv-sticky.rv-float .rv-btn{width:min(86%,560px);display:block;border-radius:6px;font-size:clamp(15px,4.4vw,20px);font-weight:600;padding:14px 16px;text-transform:uppercase;box-shadow:0 12px 28px -12px rgba(0,0,0,.45)}",
    ".rv-top.stick{position:sticky;top:0;z-index:70}",
    ".rv-btn.cart::before{content:'';display:inline-block;width:1.15em;height:1.15em;margin-right:.55em;vertical-align:-.2em;background:currentColor;-webkit-mask:var(--cart) center/contain no-repeat;mask:var(--cart) center/contain no-repeat}",
    ".rv-btn.blue{background:linear-gradient(#3b56ff,#1b2cf0);border-radius:5px;box-shadow:none;font-weight:600;font-size:clamp(18px,5vw,23px);padding:17px 36px}.rv-btn.blue:hover{background:linear-gradient(#2e48f0,#1424d6);transform:none}",
    ".rv-btn.pill{display:flex;align-items:center;justify-content:center;border-radius:999px;background:#e04040;box-shadow:none;font-size:clamp(21px,5.4vw,30px);padding:20px 26px;text-transform:uppercase;font-weight:600;line-height:1.15;width:100%}.rv-btn.pill:hover{background:#c93232;transform:none}",
    ".rv-hc{font-family:var(--fh);font-weight:700;font-size:clamp(26px,7vw,40px);line-height:1.2;text-align:center;margin:0 0 16px;color:#000}.rv-hc.red{color:var(--p)}.rv-hc.up{text-transform:uppercase}.rv-hc.left{text-align:left}.rv-hc.sm{font-size:clamp(22px,5.8vw,32px)}.rv-hc.fb{font-family:var(--fb)}",
    ".rv-redsec{background:#d04943;color:#fff}.rv-redsec .rv-hc{color:#fff}.rv-redsec .rv-list{margin:0 0 6px}.rv-redsec .rv-list li{color:#fff;font-size:clamp(18px,4.9vw,22px);line-height:1.5;padding:9px 0 9px 40px}",
    ".rv-list.x li::before{content:'\\2715';background:none;color:#fff;width:24px;height:24px;top:11px;font-size:18px;font-weight:700}",
    ".rv-darksec{background:#000;color:#fff;text-align:center}.rv-darksec .rv-hc{color:#fff}.rv-darksec .rv-img{border-radius:0;max-width:520px;margin:0 auto 10px}",
    ".rv-pkg3{background:#fff;text-align:center;display:flex;flex-direction:column}.rv-pkg3 .bar{padding:4px 10px;font-family:var(--fh);font-weight:700;font-size:clamp(28px,7.4vw,38px);color:#2c4a35;text-transform:uppercase;line-height:1.2}",
    ".rv-pkg3 .q{font-family:var(--fh);font-weight:700;font-size:clamp(20px,5.4vw,24px);color:#2c4a35;text-transform:uppercase;margin:6px 0 8px}.rv-pkg3 .rv-img{border-radius:0}",
    ".rv-pkg3 ul{text-align:left;margin:14px 0 6px;padding-left:30px;font-size:clamp(18px,4.9vw,22px);line-height:1.5;color:#111}.rv-pkg3 .now{display:block;font-family:var(--fh);font-weight:700;font-size:clamp(40px,10.5vw,54px);color:#2e5e2e;line-height:1.1;margin:10px 0 0}",
    ".rv-pkg3 .was{display:block;font-family:var(--fh);font-weight:700;font-size:clamp(26px,6.8vw,36px);color:#f00;text-decoration:line-through;margin:0 0 14px}",
    ".rv-foot-dark{background:#000;color:#fff;text-align:center;padding:26px 18px}.rv-foot-dark p{margin:0 0 14px;font-size:clamp(16px,4.2vw,20px);line-height:1.35}.rv-foot-dark .rv-hc{color:var(--p);font-size:clamp(26px,7vw,34px);margin:0 0 12px}",
    ".rv-formbox{background:#d04943;color:#fff;text-align:center;border-radius:7px;padding:26px 18px;font-size:clamp(17px,4.6vw,21px);line-height:2}.rv-formbox p{margin:0 0 18px}.rv-formbox p:last-child{margin:0}",
    ".rv-pkg{position:relative;background:#fff;border:2px solid #14130f;border-radius:var(--r);overflow:hidden;text-align:center;display:flex;flex-direction:column}.rv-pkg.hot{border-color:var(--p);box-shadow:0 22px 44px -22px var(--p)}",
    ".rv-pkg-h{background:var(--pd);color:#fff;padding:14px 10px}.rv-pkg-h b{display:block;font-family:var(--fh);font-size:30px;line-height:1.1;letter-spacing:.05em}.rv-pkg-h span{display:block;font-weight:700;font-size:17px}.rv-pkg-h small{display:block;opacity:.85;font-size:13px}",
    ".rv-pkg .rv-img{border-radius:0;aspect-ratio:4/3}.rv-pkg-b{padding:16px 16px 20px;display:flex;flex-direction:column;gap:10px;align-items:center}.rv-pkg-b .rv-price .now{font-size:40px}.rv-pkg-b .rv-btn{width:100%}",
    ".rv-save{display:inline-block;background:#fde8e5;color:#b3261e;font-weight:800;padding:5px 14px;border-radius:99px;font-size:13px}.rv-pkg .tag{position:absolute;top:10px;right:-34px;transform:rotate(38deg);background:var(--p);color:#fff;font-size:11px;font-weight:800;padding:4px 40px;letter-spacing:.06em}",
    ".rv-pkg2{position:relative;background:#fff;border:3px solid #cfd8e3;border-radius:28px;padding:30px 22px 26px;text-align:center;display:flex;flex-direction:column}.rv-pkg2.hot{border-color:#4aa152}.rv-pkg2 .pill{position:absolute;top:-18px;left:50%;transform:translateX(-50%);background:#4aa152;color:#fff;font-weight:800;font-size:14.5px;padding:7px 18px;border-radius:99px;white-space:nowrap}",
    ".rv-pkg2 .t{color:#64748b;font-weight:800;font-size:21px;letter-spacing:.02em;text-transform:uppercase}.rv-pkg2.hot .t{color:#3f8f46}.rv-pkg2 .q{font-family:var(--fh);font-size:34px;font-weight:800;line-height:1.15;margin:10px 0 14px;color:#111}.rv-pkg2 .chip{background:#f1f5f9;border-radius:10px;padding:12px;font-weight:700;margin:0 0 16px;font-size:16px}.rv-pkg2 .rv-img{border-radius:12px;margin:0 0 16px}",
    ".rv-pkg2 .was{display:block;text-decoration:line-through;color:#64748b;font-weight:800;font-size:26px}.rv-pkg2 .big{display:block;font-family:var(--fh);font-weight:800;font-size:clamp(34px,8vw,46px);line-height:1.12;color:#111;margin:8px 0 14px}.rv-pkg2 .rv-save{background:#e3f6e6;color:#14301a;margin:0 auto 22px}.rv-pkg2 .rv-btn{margin-top:auto;width:100%}",
    ".rv-sidetab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:65;background:var(--pd);color:#fff!important;font-weight:800;letter-spacing:.05em;padding:16px 22px;border-radius:99px 0 0 99px;text-decoration:none;box-shadow:0 10px 26px -8px rgba(0,0,0,.55);animation:rvbeat 1.4s infinite}@keyframes rvbeat{0%,45%,100%{transform:translateY(-50%) scale(1)}12%{transform:translateY(-50%) scale(1.1)}28%{transform:translateY(-50%) scale(1.04)}}",
    ".rv-popup.side{justify-content:flex-end;align-items:stretch;padding:0}.rv-popup.side .rv-popup-box{max-width:440px;height:100%;max-height:none;border-radius:0;text-align:left;padding:30px 22px;animation:rvslide .3s ease-out}@keyframes rvslide{from{transform:translateX(100%)}to{transform:none}}",
    "@media(max-width:767px){.rv-gal{grid-template-columns:repeat(2,1fr)}.rv-plan.hot{transform:none}.rv-nav nav{display:none;position:absolute;top:100%;left:0;right:0;background:#fff;flex-direction:column;align-items:flex-start;padding:16px 20px;border-bottom:1px solid var(--line);z-index:30;gap:14px}.rv-nav .rv-burger{display:block}.rv-nav .rv-t:checked~nav{display:flex}.rv-map{height:300px}}",
    "@media(max-width:767px){.rv-sec{padding:50px 18px}.rv-sec.tight{padding:32px 18px}.rv-cols.c2,.rv-cols.c3,.rv-cols.c4,.rv-cols.c5,.rv-cols.c6{grid-template-columns:1fr;gap:22px}.rv-cols.rev>:first-child{order:2}.rv-cols.keep{grid-template-columns:repeat(2,1fr)!important;gap:10px}.rv-btn.fit{width:auto;display:inline-block}.rv-guar{flex-direction:column;text-align:center}.rv-btn{width:100%;display:block}.rv-sticky .rv-btn{width:auto;display:inline-block}.rv-cd .b{min-width:62px}}"
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

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function rvDate(fmt, off) {
    var d = new Date(Date.now() + (off || 0) * 86400000), p2 = function (n) { return (n < 10 ? "0" : "") + n; }, h12 = d.getHours() % 12 || 12;
    return String(fmt || "D, d M").replace(/[DlMFdjYHhiA]/g, function (c) {
      return { D: DAYS[d.getDay()].slice(0, 3), l: DAYS[d.getDay()], M: MONTHS[d.getMonth()].slice(0, 3), F: MONTHS[d.getMonth()], d: p2(d.getDate()), j: d.getDate(), Y: d.getFullYear(), H: p2(d.getHours()), h: p2(h12), i: p2(d.getMinutes()), A: d.getHours() < 12 ? "AM" : "PM" }[c];
    });
  }
  global.RVDate = rvDate;

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
    el.addEventListener("click", function (e) { if (e.target === el || (e.target.closest && e.target.closest(".rv-popup-x, [data-rv-tier]"))) close(); });
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

  /* ---------- Labelled picture slots: a grey box that says which photo goes there ---------- */
  function slot(label, w, h) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '"><rect width="' + w + '" height="' + h + '" fill="#ece9e0"/><g fill="none" stroke="#b9b4a4" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" transform="translate(' + (w / 2 - 60) + "," + (h / 2 - 95) + ')"><rect width="120" height="84" rx="10"/><circle cx="34" cy="28" r="9"/><path d="M120 66L88 38 40 78"/></g><text x="' + w / 2 + '" y="' + (h / 2 + 52) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="' + Math.round(Math.min(w, h) / 24) + '" fill="#7d786a">' + esc(label) + "</text></svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  /* ---------- Sales-page building pieces (shared by the widgets and the Zumifa template) ---------- */
  var CTA_TXT = "Click here to order now !!!";
  function zmBlue(label) { return '<section class="rv-sec tight rv-center" style="padding-top:22px;padding-bottom:22px"><div class="rv-wrap narrow"><a class="rv-btn blue cart fit" href="#order">' + label + "</a></div></section>"; }
  function zmHead(cls, text) { return '<section class="rv-sec tight"><div class="rv-wrap narrow"><h2 class="rv-hc ' + cls + '">' + text + "</h2></div></section>"; }
  function zmImg(label, w, h, st) { return '<section class="rv-sec tight" style="padding-top:8px;padding-bottom:8px"><div class="rv-wrap"><img class="rv-img" style="border-radius:0' + (st || "") + '" src="' + slot(label, w, h) + '" alt=""></div></section>'; }
  function zmProblems() {
    var items = ["Sensitivity to light: Bright lights cause discomfort, making you squint or struggle to keep your eyes open.", "Blurry vision: This can be a general haziness or a blurry area in the center of your vision.", "Double vision: Seeing double can be a sign of various underlying eye or neurological conditions.", "Cloudy or hazy vision: This can indicate a problem with the lens or other parts of the eye.", "Gradual loss of peripheral vision: if you notice that your side vision is shrinking, it may be a warning sign. Loss of peripheral vision can be an early sign of certain eye conditions.", "Halos around lights: Seeing rainbow-like rings around lights, especially at night, can indicate issues like cataract."];
    return '<section class="rv-sec rv-redsec" style="padding:34px 18px"><div class="rv-wrap narrow"><h2 class="rv-hc" style="margin-bottom:18px">Are You Experiencing Any Of These Eye Problems?</h2><ul class="rv-list x">' + items.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul></div></section>";
  }
  function zmGuarantee() {
    return '<section class="rv-sec rv-darksec" style="padding:30px 16px 36px"><div class="rv-wrap narrow"><h2 class="rv-hc up sm" style="font-weight:600">You are backed with our 30 days 100% money back guarantee if you are not satisfied with this product</h2><img class="rv-img" src="' + slot("Guarantee seal image (30 days money back)", 800, 800) + '" alt=""><h3 class="rv-hc sm">30-Day Money Back Guarantee! If you think you didn’t get value for your money</h3><p class="rv-hc up sm" style="font-weight:600;margin:0">Note: you will get refund if this product does not work for you as prescribed.</p></div></section>';
  }
  function zmCard(bar, barBg, qty, imgLabel, bullets, now, was, btn, idx) {
    return '<div class="rv-pkg3"><div class="bar" style="background:' + barBg + '">' + bar + '</div><div class="q">' + qty + '</div><img class="rv-img" src="' + slot(imgLabel, 800, 800) + '" alt=""><ul>' + bullets.map(function (b) { return "<li>" + b + "</li>"; }).join("") + '</ul><span class="now">' + now + '</span><span class="was">' + was + '</span><a class="rv-btn pill cart" href="#order" data-rv-tier="' + idx + '">' + btn + "</a></div>";
  }
  function zmPackages() {
    return '<section class="rv-sec tight" style="padding-top:18px"><div class="rv-wrap"><div class="rv-cols auto top" style="gap:44px">' +
      zmCard("Starter Pack", "#d3d78f", "1 Bottle", "Card 1 image: 1 bottle", ["30 Capsules", "Good for first time customers", "Supports healthy vision", "Cash on delivery"], "₦21,000", "₦39,000", "Get the Starter Pack now", 1) +
      zmCard("Most Popular", "#e8002d", "2 Bottles", "Card 2 image: buy 2 get 1 free", ["60 Capsules (2 BOTTLES)", "Comes with 1 free immune booster", "Free delivery", "Cash on delivery"], "₦33,500", "₦00,000", "Get the 2 Bottle deal", 2) +
      zmCard("Best Value", "#eee84a", "4 Bottles", "Card 3 image: buy 4 get 2 free", ["120 Capsules (4 BOTTLES)", "Maximum savings", "Comes with 2 free immune boosters", "Free delivery"], "₦57,000", "₦120,000", "Get the Best Value deal", 3) + "</div></div></section>";
  }
  function zmForm() {
    var fields = esc(JSON.stringify([{ label: "WhatsApp number", type: "tel", required: false, placeholder: "" }]));
    return '<section class="rv-sec tight" id="order" style="padding-top:34px"><div class="rv-wrap narrow"><h2 class="rv-hc red fb up" style="font-weight:800;font-size:clamp(28px,7.6vw,40px);margin-bottom:22px">Fill this form to order</h2><div class="rv-formbox"><p>Please be sure you are FULLY ready for the package &amp; have the money to pay at the point of delivery.</p><p>Due to huge demand from our advert, we are officially running low on this product – place your order while supplies last!</p></div><div style="height:26px"></div><div data-rv-form="1" data-rv-title="" data-rv-subtitle="" data-rv-button="Submit Form" data-rv-accent="#3b82f6" data-rv-fields="' + fields + '"></div></div></section>';
  }
  function zmFooter() {
    return '<footer class="rv-foot-dark" style="padding-bottom:96px"><p>Copyright © <span data-rv-year>2026</span> BEYCE WELLNESS Ltd. All rights reserved. Unauthorized use or reproduction of this content is prohibited.</p><h2 class="rv-hc">DISCLAIMER</h2><p style="margin:0">Not affiliated with or endorsed by Facebook/Meta. Facebook is a registered trademark of Meta Platforms, Inc.</p></footer>';
  }
  function zmStory() {
    return '<section class="rv-sec" style="padding-top:34px"><div class="rv-wrap narrow rv-story"><h2 class="rv-h2">It starts with a little blurriness… then your eyes never feel the same again.</h2><p class="rv-p">Maybe you’ve noticed that your eyes get tired faster than they used to. You struggle to focus on small words, your vision sometimes feels blurry, your eyes become dry or irritated, or you find yourself rubbing them after spending hours on your phone or computer.</p><p class="rv-p">At first, it’s easy to brush these signs off as ordinary tiredness. But when the discomfort keeps coming back, reading becomes harder, screen time becomes uncomfortable, and even simple everyday activities can start feeling like a struggle.</p><p class="rv-p">Your eyes work for you every single day. Isn’t it time you started giving them the support they deserve?</p></div></section>';
  }
  function zumifaHtml() {
    var blue = zmBlue("Click Here To Order");
    var vcard = '<section class="rv-sec tight" style="padding-top:8px;padding-bottom:8px"><div class="rv-wrap"><div class="rv-vcard" style="border-radius:0;padding:16px 20px 22px"><div class="rv-stars">★★★★★</div><h3 class="rv-hc" style="color:#0b0b0b;font-size:clamp(26px,7vw,36px);margin:6px 0 14px">Happy customer</h3><div class="rv-video" data-src="" data-ratio="16:9" style="border-radius:0">' + videoEmbed("") + "</div></div></div></section>";
    var shot = function (n, w, h) { return '<img class="rv-img" style="border-radius:0" src="' + slot("Testimonial screenshot " + n, w, h) + '" alt="">'; };
    return [
      '<section class="rv-banner" style="background:#a32a25;padding:30px 16px"><div class="rv-wrap narrow"><h1 class="rv-bh" style="color:#f2f2f2;font-weight:700">Struggling with blurry or tired eyes? Your eyes may need more than glasses</h1></div></section>',
      zmHead("up", "Here is a 7 day remedy for all eye defect<br>Zumifa Eye<br>Herbal Capsule"),
      zmImg("Hero image (product / patient photo)", 800, 800),
      zmStory(), blue,
      '<section class="rv-sec tight"><div class="rv-wrap"><h2 class="rv-hc red fb" style="margin-bottom:22px;font-weight:800">Check our customers honest review</h2><div class="rv-cols c2 keep top" style="gap:14px">' + shot(1, 600, 900) + shot(2, 600, 900) + "</div></div></section>",
      '<section class="rv-sec tight"><div class="rv-wrap narrow"><p class="rv-hc red up sm" style="margin:0">Please stop gambling with your life, end eye issue now before it leads to blindness....</p></div></section>',
      zmHead("", "Real Customer Experiences With Zumifa Herbal Capsules"), vcard, vcard,
      '<section class="rv-sec tight"><div class="rv-wrap narrow"><p class="rv-hc sm" style="font-weight:500;color:#1f2937">You can now Achieve Perfect Vision Naturally, Without Ever Needing Glasses, Contact Lenses or Expensive Surgeries…</p></div></section>',
      blue, zmProblems(),
      zmHead("red", "If These Symptoms Sound Familiar, It’s Time To Discover ZUMIFA HERBAL CAPSULES"),
      zmImg("Offer image: buy 2 bottles, get 1 free", 800, 800), blue,
      zmHead("up", "Important details you need to know about this product.."),
      zmImg("Product benefits image", 800, 800), blue,
      zmHead("red up", "Hear from few more of our happy customers"),
      '<section class="rv-sec tight"><div class="rv-wrap"><div class="rv-cols c2 keep top" style="gap:14px">' + shot(3, 600, 900) + shot(4, 600, 900) + shot(5, 600, 900) + shot(6, 600, 900) + "</div></div></section>",
      blue,
      zmImg("Product bottle image", 800, 800),
      zmHead("", "Powerful Herbal Care, Safe for Everyday Use"),
      zmImg("100% safe badge", 600, 600, ";max-width:300px;margin:0 auto"),
      zmHead("left fb sm", "Sounds Like Something You Want To Give A Try?"),
      zmGuarantee(), blue,
      zmHead("red up", "How much is the eyes treatment cost ?"),
      '<section class="rv-sec tight"><div class="rv-wrap narrow"><p class="rv-hc sm">Exclusive Launch SALES Promo Only For Just 5 People.</p><p class="rv-hc sm">(Promo Ends This Mid-Night)</p><p class="rv-hc sm">+ (EXCLUSIVE BONUSES WHEN YOU GET MORE THAN ONE BOTTLE OF ZUMIFA)</p></div></section>',
      zmImg("Cash on delivery stamp", 800, 500, ";max-width:380px;margin:0 auto"),
      '<section class="rv-sec tight"><div class="rv-wrap narrow"><p class="rv-hc red sm" style="margin:0">Please Order Only If You\'re Ready To Pay Upon Delivery. Our Stock is limited, and delivery takes less than 24 hours. NOTE - Don\'t have the money yet? Save this page and return when you\'re ready to place your order, we will be glad to serve you.</p></div></section>',
      zmPackages(), zmForm(), zmFooter(),
      '<div class="rv-sticky rv-float"><a class="rv-btn block cart" href="#order">' + CTA_TXT + "</a></div>"
    ].join("\n");
  }

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
      var top = !(extra && extra.widget) && typeof content === "string" && /^\s*<(section|header|footer)\b|^\s*<div class="rv-(top|sticky|popup)|^\s*<a class="rv-(wa|sidetab)/.test(content);
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

    /* Offers: package cards, side order tab + slide-in package drawer, sticky offer bar, delivery date */
    var d1 = rvDate("D, d M", 1);
    function pkg(tag, name, pack, note, was, now, save, idx, hot) {
      return '<div class="rv-pkg' + (hot ? " hot" : "") + '">' + (hot ? '<span class="tag">POPULAR</span>' : "") + '<div class="rv-pkg-h"><b>' + name + "</b><span>" + pack + "</span><small>" + note + '</small></div><img class="rv-img" src="' + PH + '" alt=""><div class="rv-pkg-b"><div class="rv-price"><span class="was">' + was + '</span><span class="now">' + now + '</span></div><span class="rv-save">' + save + '</span><a class="rv-btn block" href="#order" data-rv-tier="' + idx + '">Click to buy now</a></div></div>';
    }
    function pkg2(title, qty, chip, was, now, save, label, idx, hot) {
      return '<div class="rv-pkg2' + (hot ? " hot" : "") + '">' + (hot ? '<span class="pill">⭐ RECOMMENDED / MOST POPULAR</span>' : "") + '<div class="t">' + title + '</div><div class="q">' + qty + '</div><div class="chip">' + chip + '</div><img class="rv-img" src="' + PH + '" alt=""><span class="was">' + was + '</span><span class="big">' + now + ' ONLY</span><span class="rv-save">' + save + '</span><a class="rv-btn block" href="#order" data-rv-tier="' + idx + '">' + label + "</a></div>";
    }
    add("sp-packages2", "Package cards - clean (any number)", "Offers", I.tag, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Special offer</span><h2 class="rv-h2">Choose your package</h2></div><div class="rv-cols auto top" style="gap:34px">' +
      pkg2("Starter pack", "1 Bottle", "📦 15-Day Introductory Care", "₦44,000", "₦20,000", "SAVE ₦24,000 (55% OFF)", "ORDER STARTER PACK", 1, false) + pkg2("Recommended pack", "2 Bottles", "🎁 2 Bottles + 1 FREE Booster", "₦93,000", "₦32,500", "SAVE ₦60,500 (65% OFF)", "ORDER RECOMMENDED PACK", 2, true) + pkg2("Recovery pack", "4 Bottles", "🎁 4 Bottles + 2 FREE Boosters", "₦181,000", "₦57,000", "SAVE ₦124,000 (68% OFF)", "ORDER RECOVERY PACK", 3, false) + "</div></div></section>");
    add("sp-problems", "Problem list (red, ✕ icons)", "Sales page", I.list, zmProblems());
    add("sp-guarantee-dark", "Money-back guarantee (dark, seal)", "Sales page", I.shield, zmGuarantee());
    add("sp-packages3", "Package cards - flat bar + bullets", "Offers", I.tag, zmPackages());
    add("sp-form", "Order form with red notice", "Sales page", I.form, zmForm());
    add("sp-footer-dark", "Footer - dark, disclaimer", "Sales page", I.footer, zmFooter());
    add("sp-blue-button", "Blue order button (cart icon)", "Sales page", I.button, zmBlue("Click Here To Order"));
    add("sp-offerbar", "Sticky offer bar (top)", "Offers", I.megaphone, '<div class="rv-top stick">🚚 FAST NATIONWIDE DELIVERY (24–48 HRS) &nbsp;|&nbsp; 100% PAYMENT ON DELIVERY &nbsp;|&nbsp; NAFDAC REG. NO.: ______</div>');
    add("sp-packages", "Package cards (any number)", "Offers", I.tag, '<section class="rv-sec"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Buy more, save more</span><h2 class="rv-h2">Select your package</h2></div><div class="rv-cols auto top">' +
      pkg("", "STARTER", "15 Days Pack", "Less recommended", "₦44,000", "₦20,000", "SAVE ₦24,000", 1, false) + pkg("", "SILVER", "3 Months Pack", "Recommended", "₦93,000", "₦32,500", "SAVE ₦60,500", 2, true) + pkg("", "GOLD", "6 Months Pack", "Highly recommended", "₦126,000", "₦57,000", "SAVE ₦69,000", 3, false) + "</div></div></section>");
    add("sp-delivery", "Delivery date line", "Offers", I.clock, '<p class="rv-p rv-center" style="font-size:18px;color:var(--ink)">🚚 Order now &amp; get it by <b><u data-rv-date="1" data-rv-fmt="D, d M">' + d1 + '</u></b><br><b>Want FREE delivery?</b> Order before 11:59pm today</p>', { widget: true });
    add("sp-sidetab", "Side ORDER NOW tab (pulsing)", "Offers", I.chat, '<a class="rv-sidetab" href="#rv-popup">ORDER NOW</a>');
    add("sp-drawer", "Package drawer (slides in)", "Offers", I.bar, '<div class="rv-popup side" data-rv-popup="1" data-delay="-1" data-exit="0" data-once="0"><div class="rv-popup-box"><button class="rv-popup-x" aria-label="Close">×</button><span class="rv-badge">Special offer</span><h2 class="rv-h2" style="font-size:26px">Choose your package</h2><p class="rv-p">Pick a package and place your order today.</p>' +
      [["STARTER · 15 days", "₦44,000", "₦20,000", 1], ["SILVER · 3 months", "₦93,000", "₦32,500", 2], ["GOLD · 6 months", "₦181,000", "₦57,000", 3]].map(function (q) { return '<div class="rv-card" style="margin-bottom:14px;padding:18px;text-align:center"><b>' + q[0] + '</b><div class="rv-price"><span class="was">' + q[1] + '</span><span class="now" style="font-size:34px">' + q[2] + '</span></div><a class="rv-btn block" href="#order" data-rv-tier="' + q[3] + '">Order now</a></div>'; }).join("") + "</div></div>");

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
    { id: "offer-packages", name: "Offer page - packages & slide-in drawer", desc: "Sticky offer bar, story, video proof, reviews, guarantee, package cards that pick the package in the form, and a pulsing ORDER NOW tab with a slide-in drawer", kind: "page", theme: { primary: "#6d2a7f", heading: "Poppins", body: "Inter" },
      blocks: ["sp-offerbar", "sp-headline", "sp-image", "sp-delivery", "sp-cta", "sp-story", "sp-video-card", "sp-video-card", "iconbox-row", "testimonials", "guarantee", "sp-packages", "order-form", "faq", "footer", "sp-sidetab", "sp-drawer"] },
    { id: "zumifa", name: "Zumifa eye capsules - full sales page", desc: "Red banner, story, review screenshots, video cards, symptoms list, guarantee, 3 flat offer cards, order form and floating order button", kind: "page", theme: { primary: "#e0301e", heading: "Roboto", body: "Montserrat" }, html: zumifaHtml },
    { id: "service", name: "Service - bank transfer", desc: "Sell a service: steps, proof, FAQ and a form that shows your bank details", kind: "page",
      blocks: ["announce", "hero-center", "steps", "features", "testimonials", "guarantee", "faq", "order-form", "footer", "whatsapp"] },
    { id: "thanks", name: "Thank-you page", desc: "Shown after an order; includes bank details when relevant", kind: "thanks",
      blocks: ["thanks-hero", "footer"] },
    { id: "blank", name: "Blank page", desc: "Start from scratch", kind: "page", blocks: [] }
  ];

  function templateHtml(tpl, ctx) {
    if (typeof tpl.html === "function") return tpl.html(ctx);
    var byId = {}; build(ctx).forEach(function (b) { byId[b.id] = b; });
    return tpl.blocks.map(function (id) { var b = byId[id], c = b && b.content; if (typeof c !== "string") return ""; return b.widget ? '<section class="rv-sec tight"><div class="rv-wrap">' + c + "</div></section>" : c; }).join("\n");
  }

  global.RVBlocks = { build: build, BASE_CSS: BASE_CSS, FONTS: FONTS, DEFAULT_THEME: DEFAULT_THEME, themeCss: themeCss, fontsUrl: fontsUrl, TEMPLATES: TEMPLATES, templateHtml: templateHtml, PLACEHOLDER: PH, countdownScript: countdownScript, tabsScript: tabsScript, popupScript: popupScript, waformScript: waformScript, videoEmbed: videoEmbed, videoRatioFor: videoRatioFor, mapEmbed: mapEmbed };
})(window);
