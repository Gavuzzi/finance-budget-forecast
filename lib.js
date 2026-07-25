// lib.js — Supabase client + auth gate.
// Loaded after the supabase-js CDN script and after data.js.
// The publishable key is meant to live in client code; RLS is what protects the data.

const SUPABASE_URL = "https://cgqfiugjsiwlefhguqnc.supabase.co";
const SUPABASE_KEY = "sb_publishable_E8Ub9-ae-m9HPcS0EqTLPQ_KAklcqN9";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Escape any user- or external-origin string before interpolating it into an
// innerHTML template. Numbers and our own formatted output never need this.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// If the session ends (token expired, or signed out in another tab), drop
// cleanly back to the login screen instead of leaving a half-broken app.
sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !isDemoMode()) {
    location.reload();
  }
});

// ---- Public demo mode ------------------------------------------------------
// A visitor can explore the whole app with sample data, no sign-up. It must
// survive navigation (plain page links don't carry ?preview), so a session flag
// keeps it on until they choose to sign in.
let DEMO_MODE = false;

function isDemoMode() {
  return new URLSearchParams(location.search).has("preview") || sessionStorage.getItem("demoMode") === "1";
}

// A chainable stand-in for the Supabase query builder. Every write "succeeds"
// against nothing: inserts echo their payload back with a fake id so the UI
// updates locally, updates/deletes just resolve. Nothing leaves the browser.
function demoWriteStub() {
  let payload = null;
  const builder = {
    insert(p) { payload = Array.isArray(p) ? p[0] : p; return builder; },
    upsert(p) { payload = Array.isArray(p) ? p[0] : p; return builder; },
    update(p) { payload = p; return builder; },
    delete() { return builder; },
    select() { return builder; },
    eq() { return builder; },
    single() { return builder; },
    then(onFulfilled, onRejected) {
      const data = payload ? { id: "demo-" + Math.random().toString(36).slice(2, 10), ...payload } : null;
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function enterDemoMode() {
  DEMO_MODE = true;
  sessionStorage.setItem("demoMode", "1");
  document.body.classList.add("demo-active");
  sb.from = () => demoWriteStub();
  sb.rpc = () => Promise.resolve({ data: null, error: { message: "Sign in to a live workspace to do that." } });
  showDemoBanner();
}

function showDemoBanner() {
  if (document.getElementById("demoBanner")) return;
  const el = document.createElement("div");
  el.id = "demoBanner";
  el.className = "demo-banner";
  el.innerHTML = `<span class="demo-dot"></span> <strong>Demo</strong> — ${t("demo_banner")} <button type="button" id="demoExit">${t("demo_banner_signin")}</button>`;
  document.body.appendChild(el);
  document.getElementById("demoExit").addEventListener("click", () => {
    sessionStorage.removeItem("demoMode");
    location.href = "app.html";
  });
}

function showLoading() {
  if (document.getElementById("loadingOverlay")) return;
  const el = document.createElement("div");
  el.id = "loadingOverlay";
  el.className = "loading-overlay";
  el.innerHTML = `<div class="loading-spinner"></div>`;
  document.body.appendChild(el);
}

function hideLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.remove();
}

function showLoadError(message) {
  const hint = /organization/i.test(message)
    ? "Your login isn't linked to an organization yet — run the membership step in <code>schema.sql</code>, then try again."
    : "Check your connection and try again.";
  document.body.innerHTML =
    `<div class="load-error">
      <h2>Couldn't load your data</h2>
      <p>${escapeHtml(message)}</p>
      <p class="load-error-hint">${hint}</p>
      <button type="button" onclick="location.reload()">Try again</button>
    </div>`;
}

function renderLogin(onSuccess) {
  // One form, two modes. Signing up is a first-class path (Phase 9.4): a new
  // customer creates an account here, confirms by email, and lands in the
  // "build your company" wizard — no invite, no SQL, no support ticket.
  let mode = "signin"; // "signin" | "signup"

  const overlay = document.createElement("div");
  overlay.className = "login-overlay";
  overlay.innerHTML = `
    <div class="login-card">
      <div class="login-brand"><span class="sb-name">FP&amp;A</span> <span class="login-fpa">Planning</span></div>
      <p class="login-tagline">${t("login_tagline")}</p>
      <button type="button" class="login-demo" id="demoBtn">${t("login_demo_btn")}</button>
      <p class="login-demo-sub">${t("login_demo_sub")}</p>
      <details class="login-signin">
        <summary id="loginSummary">${t("login_signin_summary")}</summary>
        <form id="loginForm">
          <label>${t("login_email")} <input type="email" id="loginEmail" required autocomplete="username"></label>
          <label>${t("login_password")} <input type="password" id="loginPassword" required autocomplete="current-password"></label>
          <button type="submit" id="loginSubmit">${t("login_submit")}</button>
          <button type="button" class="login-forgot" id="forgotBtn">${t("login_forgot")}</button>
          <p class="login-error" id="loginError"></p>
          <p class="login-switch">
            <span id="loginSwitchText">${t("login_switch_to_signup_text")}</span>
            <button type="button" id="loginSwitchBtn">${t("login_switch_to_signup_btn")}</button>
          </p>
        </form>
      </details>
    </div>`;
  document.body.appendChild(overlay);

  const el = (id) => document.getElementById(id);

  function applyMode() {
    const signup = mode === "signup";
    el("loginSummary").textContent = signup ? t("login_signup_summary") : t("login_signin_summary");
    el("loginSubmit").textContent = signup ? t("login_signup_submit") : t("login_submit");
    el("loginPassword").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    el("forgotBtn").hidden = signup;
    el("loginSwitchText").textContent = signup ? t("login_switch_to_signin_text") : t("login_switch_to_signup_text");
    el("loginSwitchBtn").textContent = signup ? t("login_switch_to_signin_btn") : t("login_switch_to_signup_btn");
    const errEl = el("loginError");
    errEl.textContent = "";
    errEl.classList.remove("error");
  }

  el("loginSwitchBtn").addEventListener("click", () => {
    mode = mode === "signup" ? "signin" : "signup";
    applyMode();
    el("loginEmail").focus();
  });

  el("demoBtn").addEventListener("click", () => {
    sessionStorage.setItem("demoMode", "1");
    location.reload();
  });

  el("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el("loginEmail").value.trim();
    const password = el("loginPassword").value;
    const errEl = el("loginError");
    errEl.classList.remove("error");

    if (mode === "signup") {
      if (password.length < 8) {
        errEl.textContent = t("login_password_too_short");
        errEl.classList.add("error");
        return;
      }
      errEl.textContent = t("login_creating");
      // Confirmation mail returns the user to this same app URL.
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add("error");
        return;
      }
      if (data.session) { overlay.remove(); onSuccess(); return; } // confirmation disabled
      errEl.textContent = t("login_check_email", email);           // confirmation required
      return;
    }

    errEl.textContent = t("login_signing_in");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.add("error");
      return;
    }
    overlay.remove();
    onSuccess();
  });

  document.getElementById("forgotBtn").addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value.trim();
    const errEl = document.getElementById("loginError");
    errEl.classList.remove("error");
    if (!email) {
      errEl.textContent = t("login_forgot_empty");
      errEl.classList.add("error");
      return;
    }
    errEl.textContent = t("login_forgot_sending");
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.add("error");
      return;
    }
    errEl.textContent = t("login_forgot_sent");
  });
}

// First screen of a brand-new account: no organization exists yet, so there is
// nothing to load and nothing to show — just the one action that matters.
// Opens the "build your company" wizard immediately (sidebar.js owns it, and
// its create path reloads straight into the real app); the card behind it
// keeps a way back in if they close the wizard, plus a way out.
function renderNoOrgWelcome() {
  document.body.innerHTML = `
    <div class="login-overlay">
      <div class="login-card">
        <div class="login-brand"><span class="sb-name">FP&amp;A</span> <span class="login-fpa">Planning</span></div>
        <h2 class="welcome-h2">${t("welcome_h2")}</h2>
        <p class="login-demo-sub">${t("welcome_sub")}</p>
        <button type="button" class="login-demo" id="welcomeStartBtn">${t("welcome_start_btn")}</button>
        <button type="button" class="login-forgot" id="welcomeSignOut">${t("sign_out")}</button>
      </div>
    </div>`;
  const open = () => (typeof openOrgWizard === "function" ? openOrgWizard() : null);
  document.getElementById("welcomeStartBtn").addEventListener("click", open);
  document.getElementById("welcomeSignOut").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.reload();
  });
  open();
}

// Gate the page: require a session, load the tenant's data, then run the page's init.
async function requireAuthAndLoad(initFn) {
  // Public demo: render the whole UI with sample data, no login, no live DB.
  // (?preview enters it; the session flag keeps it on across page navigation.)
  if (isDemoMode()) {
    enterDemoMode();
    loadPreviewData();
    initFn();
    return;
  }

  const start = async () => {
    showLoading();
    try {
      await loadData();
    } catch (e) {
      hideLoading();
      // A signed-in account with no organization is a NEW USER, not a failure:
      // send them to the wizard instead of a dead end. (It used to render a
      // developer error telling a customer to run schema.sql.)
      if (e.code === "NO_ORG") { renderNoOrgWelcome(); return; }
      showLoadError(e.message);
      return;
    }
    initFn();
    hideLoading();
  };

  const { data: { session } } = await sb.auth.getSession();
  if (session) start();
  else renderLogin(start);
}

// ---- Contextual "?" help (SAC-style, Tier 3) --------------------------------
// helpMark("key") renders a small ? button; clicking pops a one-liner from
// i18n key `help_<key>` right under it. Discipline: a ? only where genuinely
// non-obvious, ≤2 sentences — prefer a clearer label over a ? where possible.
function helpMark(key) {
  return `<button class="help-mark" type="button" data-help="${key}" aria-label="?">?</button>`;
}
document.addEventListener("click", (e) => {
  // Page-level help-mode toggle (SAC-style, Felix's #5): all marks are
  // invisible until the page's ? is switched on — the normal view carries
  // zero help chrome. Persists across pages until toggled off.
  const toggle = e.target.closest(".help-toggle");
  if (toggle) {
    const on = document.body.classList.toggle("help-on");
    localStorage.setItem("almgren-help-on", on ? "true" : "false");
    if (!on) { const p = document.querySelector(".help-pop"); if (p) p.remove(); }
    return;
  }

  const open = document.querySelector(".help-pop");
  const wasFor = open && open.dataset.for;
  if (open) open.remove();
  const btn = e.target.closest("[data-help]");
  if (!btn || wasFor === btn.dataset.help) return; // second click on the same ? just closes
  const pop = document.createElement("div");
  pop.className = "help-pop";
  pop.dataset.for = btn.dataset.help;
  pop.textContent = t("help_" + btn.dataset.help);
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 320))}px`;
});
if (localStorage.getItem("almgren-help-on") === "true") document.body.classList.add("help-on");

// ---- Client error logging (DIY Sentry — errors must not vanish silently) ----
// window errors + unhandled promise rejections → write-only client_errors
// table. Capped at 5 per page load, deduped by message, skipped in demo mode
// (no session to attribute), and the logger itself can NEVER throw. No build
// step means source is already readable file:line — no sourcemap machinery.
let _errLogged = 0;
const _errSeen = new Set();
function logClientError(message, source, stack) {
  try {
    if (typeof DEMO_MODE !== "undefined" && DEMO_MODE) return;
    const msg = String(message || "unknown").slice(0, 500);
    if (_errLogged >= 5 || _errSeen.has(msg)) return;
    _errSeen.add(msg); _errLogged++;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      return sb.from("client_errors").insert({
        org_id: typeof CURRENT_ORG_ID !== "undefined" && CURRENT_ORG_ID ? CURRENT_ORG_ID : null,
        user_id: session.user.id,
        message: msg,
        source: source ? String(source).slice(0, 300) : null,
        stack: stack ? String(stack).slice(0, 2000) : null,
        page: (location.pathname.split("/").pop() || "index.html") + location.search,
        user_agent: navigator.userAgent.slice(0, 200),
      });
    }).catch(() => {});
  } catch (_) { /* the error logger must never itself throw */ }
}
window.addEventListener("error", (e) =>
  logClientError(e.message, e.filename ? `${e.filename.split("/").pop()}:${e.lineno}:${e.colno}` : null, e.error && e.error.stack));
window.addEventListener("unhandledrejection", (e) =>
  logClientError((e.reason && e.reason.message) || String(e.reason), null, e.reason && e.reason.stack));
