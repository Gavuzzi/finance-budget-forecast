// Simulated budget/forecast data for the Almgren Industrier AB demo —
// a fictional mid-size Swedish manufacturer's finance "budget book".
// In a real deployment this is the data a controller currently keeps in Excel:
// annual budget per cost center, actuals booked so far, and the latest full-year forecast.
// Replaced in production by a pull from the accounting/ERP system (or a managed import).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_MONTH = 6; // Jan–Jun are actuals; Jul–Dec are forecast

// Each cost center: annual budget, actuals booked Jan–Jun, and the base full-year forecast.
// Costs over budget are unfavourable (red); under budget is favourable (green).
const COST_CENTERS = [
  { name: "Production", budget: 28000000, actualYTD: 14600000, baseForecast: 27200000 },
  { name: "Sales & Marketing", budget: 12000000, actualYTD: 6800000, baseForecast: 13100000 },
  { name: "R&D", budget: 9000000, actualYTD: 4900000, baseForecast: 9800000 },
  { name: "Administration", budget: 6000000, actualYTD: 3050000, baseForecast: 6100000 },
  { name: "IT", budget: 5000000, actualYTD: 2300000, baseForecast: 4700000 },
];

// Company-wide monthly figures for the trend chart.
// Budget is the plan; actuals exist only up to CURRENT_MONTH.
const MONTHLY_BUDGET = [5.0, 5.0, 5.2, 5.0, 5.1, 5.2, 5.0, 5.0, 5.1, 5.3, 5.1, 5.0].map((n) => n * 1_000_000);
const MONTHLY_ACTUAL = [5.1, 4.9, 5.4, 5.2, 5.3, 5.5].map((n) => n * 1_000_000); // Jan–Jun only

// reforecastPct flexes the H2 (forecast) spend up or down to model a re-forecast scenario.
function costCenterForecast(cc, reforecastPct = 0) {
  const h1Actual = cc.actualYTD;
  const h2Base = cc.baseForecast - cc.actualYTD;
  const h2Adjusted = h2Base * (1 + reforecastPct / 100);
  return h1Actual + h2Adjusted;
}

function costCenterVariance(cc, reforecastPct = 0) {
  const forecast = costCenterForecast(cc, reforecastPct);
  return forecast - cc.budget; // positive = over budget (unfavourable)
}

function computeTotals(reforecastPct = 0) {
  const totalBudget = COST_CENTERS.reduce((s, cc) => s + cc.budget, 0);
  const actualYTD = COST_CENTERS.reduce((s, cc) => s + cc.actualYTD, 0);
  const budgetYTD = MONTHLY_BUDGET.slice(0, CURRENT_MONTH).reduce((s, n) => s + n, 0);
  const fullYearForecast = COST_CENTERS.reduce((s, cc) => s + costCenterForecast(cc, reforecastPct), 0);
  const variance = fullYearForecast - totalBudget;
  const variancePct = totalBudget ? (variance / totalBudget) * 100 : 0;

  return { totalBudget, actualYTD, budgetYTD, fullYearForecast, variance, variancePct };
}

function monthlyForecastSeries(reforecastPct = 0) {
  // Actuals for elapsed months, reforecast-adjusted budget for remaining months.
  return MONTHLY_BUDGET.map((budget, i) => {
    if (i < CURRENT_MONTH) return MONTHLY_ACTUAL[i];
    return budget * (1 + reforecastPct / 100);
  });
}
