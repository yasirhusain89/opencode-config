// Shared number/date formatting (mirrors the old generate.py helpers).
export function fmt(n) {
  n = n || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

export function money(x) {
  return "$" + (x || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function hrs(m) {
  m = m || 0;
  return m >= 60 ? (m / 60).toFixed(1) + " h" : Math.round(m) + " min";
}

export function durMin(ms) {
  return hrs((ms || 0) / 60000);
}

export function durShort(ms) {
  ms = ms || 0;
  if (ms >= 3600000) return (ms / 3600000).toFixed(1) + " h";
  if (ms >= 60000) return Math.round(ms / 60000) + " min";
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
}

const pad = (n) => String(n).padStart(2, "0");

export function fmtDT(ms) {
  if (!ms) return "–";
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDay(ms) {
  if (!ms) return "?";
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const CAT_COLORS = {
  Read: "#4c9aff",
  "Lexical search": "#36b37e",
  "Graph search": "#7c5cff",
  "Structural search": "#00b8d9",
  Versioning: "#ff5630",
  Container: "#0065ff",
  "Build/package": "#ffab00",
  DB: "#6554c0",
  "Net/Cloud": "#00a3bf",
  Write: "#36b37e",
  Delegate: "#8777d9",
  Skill: "#ff7452",
  Interaction: "#de350b",
  Web: "#0052cc",
  "Wait/idle": "#8e8e93",
  "Meta/tooling": "#97a0af",
};

export const catColor = (c) => CAT_COLORS[c] || "#97a0af";
