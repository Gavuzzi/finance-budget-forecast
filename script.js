let trendChart;
let reforecastPct = 0;

const THEME_COLORS = {
  dark: { text: "#93a1b8", grid: "#28344a", budget: "#7aa3e0", actual: "#5cb88a", forecast: "#d9a647" },
  light: { text: "#647189", grid: "#dde4ee", budget: "#3461a8", actual: "#2f9e6a", forecast: "#b6841f" },
};

function fmtMkr(n) {
  return (n / 1_000_000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mkr";
}

function fmtMkrSigned(n) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + fmtMkr(Math.abs(n));
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeToggle").textContent = theme === "light" ? "☀️" : "🌙";
  localStorage.setItem("almgren-budget-theme", theme);
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
    renderChart();
  }
}

function initTheme() {
  const saved = localStorage.getItem("almgren-budget-theme") || "dark";
  applyTheme(saved);
  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(getTheme() === "light" ? "dark" : "light");
  });
}

function varianceClass(variance, budget) {
  const pct = budget ? (variance / budget) * 100 : 0;
  if (pct > 1) return "over";
  if (pct < -1) return "under";
  return "neutral";
}

function renderStats() {
  const t = computeTotals(reforecastPct);

  document.getElementById("totalBudget").textContent = fmtMkr(t.totalBudget);
  document.getElementById("actualYTD").textContent = fmtMkr(t.actualYTD);
  document.getElementById("fullYearForecast").textContent = fmtMkr(t.fullYearForecast);
  document.getElementById("variance").textContent = fmtMkrSigned(t.variance);

  const ytdVar = t.actualYTD - t.budgetYTD;
  const ytdEl = document.getElementById("ytdVariance");
  ytdEl.textContent = fmtMkrSigned(ytdVar) + " vs budget";
  ytdEl.className = "stat-sub " + (ytdVar > 0 ? "over" : ytdVar < 0 ? "under" : "");

  const varPctEl = document.getElementById("variancePct");
  const pctStr = (t.variancePct > 0 ? "+" : "") + t.variancePct.toFixed(1) + "% vs budget";
  varPctEl.textContent = pctStr;
  varPctEl.className = "stat-sub " + (t.variancePct > 0.1 ? "over" : t.variancePct < -0.1 ? "under" : "");
}

function renderTable() {
  const table = document.getElementById("budgetTable");
  let html = `
    <div class="budget-row header">
      <span class="cc-name">Cost Center</span>
      <span class="num">Budget</span>
      <span class="num">Actual YTD</span>
      <span class="num">Forecast</span>
      <span class="num">Variance</span>
    </div>
  `;

  for (const cc of COST_CENTERS) {
    const forecast = costCenterForecast(cc, reforecastPct);
    const variance = costCenterVariance(cc, reforecastPct);
    const cls = varianceClass(variance, cc.budget);
    const pct = cc.budget ? (variance / cc.budget) * 100 : 0;

    html += `
      <div class="budget-row">
        <span class="cc-name">${cc.name}</span>
        <span class="num" data-label="Budget">${fmtMkr(cc.budget)}</span>
        <span class="num" data-label="Actual YTD">${fmtMkr(cc.actualYTD)}</span>
        <span class="num" data-label="Forecast">${fmtMkr(forecast)}</span>
        <span class="variance-cell ${cls}" data-label="Variance">
          ${fmtMkrSigned(variance)}
          <span class="variance-pill ${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>
        </span>
      </div>
    `;
  }

  const t = computeTotals(reforecastPct);
  const totalCls = varianceClass(t.variance, t.totalBudget);
  html += `
    <div class="budget-row total">
      <span class="cc-name">Total</span>
      <span class="num" data-label="Budget">${fmtMkr(t.totalBudget)}</span>
      <span class="num" data-label="Actual YTD">${fmtMkr(t.actualYTD)}</span>
      <span class="num" data-label="Forecast">${fmtMkr(t.fullYearForecast)}</span>
      <span class="variance-cell ${totalCls}" data-label="Variance">
        ${fmtMkrSigned(t.variance)}
        <span class="variance-pill ${totalCls}">${t.variancePct > 0 ? "+" : ""}${t.variancePct.toFixed(1)}%</span>
      </span>
    </div>
  `;

  table.innerHTML = html;
}

function renderChart() {
  const colors = THEME_COLORS[getTheme()];
  const forecastSeries = monthlyForecastSeries(reforecastPct);

  // Split the combined actual+forecast series into two datasets so the
  // forecast portion can render dashed, connected to the last actual point.
  const actualData = MONTHS.map((_, i) => (i < CURRENT_MONTH ? forecastSeries[i] : null));
  const forecastData = MONTHS.map((_, i) => {
    if (i === CURRENT_MONTH - 1) return forecastSeries[i]; // connect at the seam
    return i >= CURRENT_MONTH ? forecastSeries[i] : null;
  });

  const ctx = document.getElementById("trendChart");

  if (!trendChart) {
    trendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: MONTHS,
        datasets: [
          {
            label: "Budget",
            data: MONTHLY_BUDGET,
            borderColor: colors.budget,
            borderDash: [4, 4],
            backgroundColor: "transparent",
            tension: 0.2,
            pointRadius: 0,
          },
          {
            label: "Actual",
            data: actualData,
            borderColor: colors.actual,
            backgroundColor: "transparent",
            tension: 0.25,
            pointRadius: 3,
          },
          {
            label: "Forecast",
            data: forecastData,
            borderColor: colors.forecast,
            borderDash: [6, 3],
            backgroundColor: "transparent",
            tension: 0.25,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.text } } },
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: {
            ticks: {
              color: colors.text,
              callback: (v) => (v / 1_000_000).toFixed(1) + " mkr",
            },
            grid: { color: colors.grid },
          },
        },
      },
    });
  } else {
    trendChart.data.datasets[1].data = actualData;
    trendChart.data.datasets[2].data = forecastData;
    trendChart.update();
  }
}

function renderAll() {
  renderStats();
  renderTable();
  renderChart();
}

function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("sv-SE");
}

function initReforecastSlider() {
  const slider = document.getElementById("reforecastSlider");
  const label = document.getElementById("reforecastValue");
  slider.addEventListener("input", () => {
    reforecastPct = Number(slider.value);
    label.textContent = (reforecastPct > 0 ? "+" : "") + reforecastPct;
    renderStats();
    renderTable();
    renderChart();
  });
}

initTheme();
initReforecastSlider();
tickClock();
renderAll();
setInterval(tickClock, 1000);
