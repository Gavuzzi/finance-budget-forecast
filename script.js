let trendChart;
let currentLens = "fy"; // "fy" | "rolling"

const THEME_COLORS = {
  dark: { text: "#93a1b8", grid: "#28344a", budget: "#7aa3e0", actual: "#5cb88a", forecast: "#d9a647" },
  light: { text: "#647189", grid: "#dde4ee", budget: "#3461a8", actual: "#2f9e6a", forecast: "#b6841f" },
};

function companyMonthlyBudget(month) {
  if (month < 1 || month > FY_MONTHS) return null;
  return COST_CENTERS.reduce((s, cc) => s + monthlyBudgetFor(cc, month), 0);
}

function lensMonthRange() {
  if (currentLens === "rolling") {
    const { start, end } = rollingWindow();
    const months = [];
    for (let m = start; m <= end; m++) months.push(m);
    return months;
  }
  const months = [];
  for (let m = 1; m <= FY_MONTHS; m++) months.push(m);
  return months;
}

function renderStats() {
  const statsRow = document.getElementById("statsRow");

  if (currentLens === "fy") {
    const fy = companyFySummary();
    let bookedActual = 0;
    for (let m = 1; m <= CLOSE_MONTH; m++) bookedActual += companyMonthAmount(m);
    const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;
    const cls = varianceClass(fy.variance, fy.budget);

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Annual Budget (FY2026)</span>
        <span class="stat-value">${fmtMkr(fy.budget)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Booked Actuals</span>
        <span class="stat-value">${fmtMkr(bookedActual)}</span>
        <span class="stat-sub">through ${monthLabel(CLOSE_MONTH)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Full-Year Total</span>
        <span class="stat-value">${fmtMkr(fy.total)}</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">Variance vs Budget</span>
        <span class="stat-value ${cls}">${fmtMkrSigned(fy.variance)}</span>
        <span class="stat-sub ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
      </div>
    `;
  } else {
    const { start, end } = rollingWindow();
    const rolling = companyRollingSummary();
    const monthsBeyondBudget = lensMonthRange().filter((m) => m > FY_MONTHS).length;

    statsRow.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Rolling 12 Total</span>
        <span class="stat-value">${fmtMkr(rolling.total)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Window</span>
        <span class="stat-value small">${monthLabel(start)} – ${monthLabel(end)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Avg Monthly Run-Rate</span>
        <span class="stat-value">${fmtMkr(rolling.total / 12)}</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">Months Without FY Budget</span>
        <span class="stat-value">${monthsBeyondBudget}</span>
        <span class="stat-sub">next year's budget isn't set yet</span>
      </div>
    `;
  }
}

function renderTable() {
  const table = document.getElementById("budgetTable");

  if (currentLens === "fy") {
    let html = `
      <div class="budget-row header">
        <span class="cc-name">Cost Center</span>
        <span class="num">Budget</span>
        <span class="num">FY2026 Total</span>
        <span class="num">Variance</span>
      </div>
    `;

    for (const cc of COST_CENTERS) {
      const fy = fySummary(cc);
      const cls = varianceClass(fy.variance, fy.budget);
      const pct = fy.budget ? (fy.variance / fy.budget) * 100 : 0;

      html += `
        <div class="budget-row">
          <span class="cc-name">${cc.name}</span>
          <span class="num" data-label="Budget">${fmtMkr(fy.budget)}</span>
          <span class="num" data-label="FY2026 Total">${fmtMkr(fy.total)}</span>
          <span class="variance-cell ${cls}" data-label="Variance">
            ${fmtMkrSigned(fy.variance)}
            <span class="variance-pill ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
          </span>
        </div>
      `;
    }

    const t = companyFySummary();
    const totalCls = varianceClass(t.variance, t.budget);
    const totalPct = t.budget ? (t.variance / t.budget) * 100 : 0;
    html += `
      <div class="budget-row total">
        <span class="cc-name">Total</span>
        <span class="num" data-label="Budget">${fmtMkr(t.budget)}</span>
        <span class="num" data-label="FY2026 Total">${fmtMkr(t.total)}</span>
        <span class="variance-cell ${totalCls}" data-label="Variance">
          ${fmtMkrSigned(t.variance)}
          <span class="variance-pill ${totalCls}">${totalPct > 0 ? "+" : ""}${totalPct.toFixed(1)}%</span>
        </span>
      </div>
    `;
    table.innerHTML = html;
  } else {
    let html = `
      <div class="budget-row header rolling">
        <span class="cc-name">Cost Center</span>
        <span class="num">Rolling 12 Total</span>
      </div>
    `;

    for (const cc of COST_CENTERS) {
      const r = rollingSummary(cc);
      html += `
        <div class="budget-row rolling">
          <span class="cc-name">${cc.name}</span>
          <span class="num" data-label="Rolling 12 Total">${fmtMkr(r.total)}</span>
        </div>
      `;
    }

    const t = companyRollingSummary();
    html += `
      <div class="budget-row total rolling">
        <span class="cc-name">Total</span>
        <span class="num" data-label="Rolling 12 Total">${fmtMkr(t.total)}</span>
      </div>
    `;
    table.innerHTML = html;
  }
}

function renderChart() {
  const colors = THEME_COLORS[getTheme()];
  const months = lensMonthRange();
  const labels = months.map(monthLabel);

  const budgetSeries = months.map((m) => companyMonthlyBudget(m));
  const actualSeries = months.map((m) => (m <= CLOSE_MONTH ? companyMonthAmount(m) : null));
  const forecastSeries = months.map((m, i) => {
    if (m === CLOSE_MONTH) return companyMonthAmount(m); // connect at the seam
    return m > CLOSE_MONTH ? companyMonthAmount(m) : null;
  });

  document.getElementById("chartTitle").textContent =
    currentLens === "fy" ? "Spend — Budget vs Actual vs Forecast (FY2026)" : "Spend — Rolling 12 Months (Actual + Forecast)";

  const ctx = document.getElementById("trendChart");
  const datasets = [
    {
      label: "Budget",
      data: budgetSeries,
      borderColor: colors.budget,
      borderDash: [4, 4],
      backgroundColor: "transparent",
      tension: 0.2,
      pointRadius: 0,
      spanGaps: false,
    },
    {
      label: "Actual",
      data: actualSeries,
      borderColor: colors.actual,
      backgroundColor: "transparent",
      tension: 0.25,
      pointRadius: 3,
    },
    {
      label: "Forecast",
      data: forecastSeries,
      borderColor: colors.forecast,
      borderDash: [6, 3],
      backgroundColor: "transparent",
      tension: 0.25,
      pointRadius: 3,
    },
  ];

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: colors.text } } },
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
        y: {
          ticks: { color: colors.text, callback: (v) => (v / 1_000_000).toFixed(1) + " mkr" },
          grid: { color: colors.grid },
        },
      },
    },
  });
}

function renderAll() {
  const sections = document.querySelectorAll(".lens-controls, .stats-row, .main-row, .table-panel");
  let empty = document.getElementById("emptyState");

  if (COST_CENTERS.length === 0) {
    sections.forEach((el) => (el.style.display = "none"));
    if (!empty) {
      empty = document.createElement("div");
      empty.id = "emptyState";
      document.querySelector(".app-main").appendChild(empty);
    }
    empty.innerHTML = emptyOrgHtml();
    empty.style.display = "";
    return;
  }

  sections.forEach((el) => (el.style.display = ""));
  if (empty) empty.style.display = "none";
  renderStats();
  renderTable();
  renderChart();
}

function initLensControls() {
  document.querySelectorAll(".lens-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentLens = btn.dataset.lens;
      document.querySelectorAll(".lens-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    });
  });
}

// Redraw the chart when the theme flips (the sidebar owns the toggle) and
// re-render everything when a month is closed from the sidebar.
window.onThemeChanged = () => {
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
    renderChart();
  }
};
window.refreshAfterPeriodChange = renderAll;

// Entry point — called by the auth bootstrap (lib.js) after login + data load.
window.initPage = () => {
  initLensControls();
  renderAll();
};
