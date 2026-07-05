// lib.js — Supabase client + auth gate.
// Loaded after the supabase-js CDN script and after data.js.
// The publishable key is meant to live in client code; RLS is what protects the data.

const SUPABASE_URL = "https://cgqfiugjsiwlefhguqnc.supabase.co";
const SUPABASE_KEY = "sb_publishable_E8Ub9-ae-m9HPcS0EqTLPQ_KAklcqN9";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
  el.innerHTML = `<span class="demo-dot"></span> <strong>Demo</strong> — sample data, nothing you change is saved. <button type="button" id="demoExit">Sign in ↗</button>`;
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
      <p>${message}</p>
      <p class="load-error-hint">${hint}</p>
      <button type="button" onclick="location.reload()">Try again</button>
    </div>`;
}

function renderLogin(onSuccess) {
  const overlay = document.createElement("div");
  overlay.className = "login-overlay";
  overlay.innerHTML = `
    <div class="login-card">
      <div class="login-brand"><span class="sb-name">FP&amp;A</span> <span class="login-fpa">Planning</span></div>
      <p class="login-tagline">Budget, forecast, and track spend for growing companies — driver-based, so one change flows through every number instead of breaking a spreadsheet.</p>
      <button type="button" class="login-demo" id="demoBtn">Explore the live demo →</button>
      <p class="login-demo-sub">Full app, a sample company, no sign-up.</p>
      <details class="login-signin">
        <summary>Sign in to your workspace</summary>
        <form id="loginForm">
          <label>Email <input type="email" id="loginEmail" required autocomplete="username"></label>
          <label>Password <input type="password" id="loginPassword" required autocomplete="current-password"></label>
          <button type="submit">Sign in</button>
          <p class="login-error" id="loginError"></p>
        </form>
      </details>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("demoBtn").addEventListener("click", () => {
    sessionStorage.setItem("demoMode", "1");
    location.reload();
  });

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errEl = document.getElementById("loginError");
    errEl.classList.remove("error");
    errEl.textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.add("error");
      return;
    }
    overlay.remove();
    onSuccess();
  });
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
