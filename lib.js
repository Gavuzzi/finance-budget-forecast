// lib.js — Supabase client + auth gate.
// Loaded after the supabase-js CDN script and after data.js.
// The publishable key is meant to live in client code; RLS is what protects the data.

const SUPABASE_URL = "https://cgqfiugjsiwlefhguqnc.supabase.co";
const SUPABASE_KEY = "sb_publishable_E8Ub9-ae-m9HPcS0EqTLPQ_KAklcqN9";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// If the session ends (token expired, or signed out in another tab), drop
// cleanly back to the login screen instead of leaving a half-broken app.
sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !new URLSearchParams(location.search).has("preview")) {
    location.reload();
  }
});

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
    <form class="login-card" id="loginForm">
      <div class="login-brand"><span class="sb-name">FP&amp;A</span> <span class="login-fpa">Planning</span></div>
      <p class="login-sub">Sign in to continue</p>
      <label>Email <input type="email" id="loginEmail" required autocomplete="username"></label>
      <label>Password <input type="password" id="loginPassword" required autocomplete="current-password"></label>
      <button type="submit">Sign in</button>
      <p class="login-error" id="loginError"></p>
    </form>`;
  document.body.appendChild(overlay);

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
  // Dev affordance: ?preview renders the UI with sample data, no login or DB.
  if (new URLSearchParams(location.search).has("preview")) {
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
