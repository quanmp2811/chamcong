const UNIT_HISTORY_KEY = "unitEditHistory";
const SHIFT_HISTORY_KEY = "shiftEditHistory";
const SCHEDULE_HISTORY_KEY = "scheduleEditHistory";

function safeParseArray(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString("vi-VN");
}

function getCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function buildEditor(user = getCurrentUser()) {
  return {
    editorName: user?.name || "Không rõ",
    editorEmail: user?.email || "",
    time: formatTimestamp()
  };
}

function appendHistory(storageKey, item) {
  const history = safeParseArray(localStorage.getItem(storageKey));
  history.push(item);
  localStorage.setItem(storageKey, JSON.stringify(history));
}

function stringifySummary(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
    .map(([key, entry]) => `${key}: ${entry}`)
    .join(" | ");
}

export function getUnitHistory() {
  return safeParseArray(localStorage.getItem(UNIT_HISTORY_KEY));
}

export function getShiftHistory() {
  return safeParseArray(localStorage.getItem(SHIFT_HISTORY_KEY));
}

export function getScheduleHistoryLocal() {
  return safeParseArray(localStorage.getItem(SCHEDULE_HISTORY_KEY));
}

export function appendUnitHistory({
  action,
  unitCode,
  unitName,
  region,
  before = "",
  after = ""
}) {
  appendHistory(UNIT_HISTORY_KEY, {
    type: "unit",
    action,
    unitCode,
    unitName,
    region,
    before: stringifySummary(before),
    after: stringifySummary(after),
    ...buildEditor()
  });
}

export function appendShiftHistory({
  action,
  shiftCode,
  shiftName,
  before = "",
  after = ""
}) {
  appendHistory(SHIFT_HISTORY_KEY, {
    type: "shift",
    action,
    shiftCode,
    shiftName,
    before: stringifySummary(before),
    after: stringifySummary(after),
    ...buildEditor()
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getEditorDisplay(item) {
  const name = String(item?.editorName || "").trim();
  const email = String(item?.editorEmail || "").trim();
  return [name, email].filter(Boolean).join(" - ");
}

export function getItemTimestamp(item) {
  const raw = String(item?.time || "").trim();
  const viMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (viMatch) {
    const [, hour, minute, second = "0", day, month, year] = viMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).getTime();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}
