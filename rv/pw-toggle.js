/* Adds a show/hide eye to every password box on the page (login, sign-up, reset password),
   so people can check what they typed before they submit. Self-contained: styles are added here. */
(function () {
  "use strict";
  var css = ".rv-pw{position:relative;display:block;width:100%}.rv-pw>input{width:100%;box-sizing:border-box;padding-right:46px !important}" +
    ".rv-pw-btn{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:38px;height:38px;border:0;background:transparent;color:#8c887c;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:8px}" +
    ".rv-pw-btn:hover,.rv-pw-btn:focus-visible{color:#1877F2;outline:none}.rv-pw-btn svg{pointer-events:none}";
  var EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  function wrap(input) {
    if (input.dataset.rvPw) return;
    input.dataset.rvPw = "1";
    var box = document.createElement("div"); box.className = "rv-pw";
    input.parentNode.insertBefore(box, input); box.appendChild(input);
    var b = document.createElement("button"); b.type = "button"; b.className = "rv-pw-btn";
    b.setAttribute("aria-label", "Show password"); b.setAttribute("aria-pressed", "false"); b.innerHTML = EYE;
    b.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      b.innerHTML = show ? EYE_OFF : EYE;
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      b.setAttribute("aria-pressed", show ? "true" : "false");
      input.focus({ preventScroll: true });
    });
    box.appendChild(b);
  }
  function init() {
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    document.querySelectorAll('input[type="password"]').forEach(wrap);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
