// js/title.js
import {
  ensureSettingsInitialized,
  loadSettings,
  resetSettings,
} from "./settings-store.js";
import { initSettingsModal } from "./settings-modal.js";

const el = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function renderSummary() {
  const s = loadSettings();
  const users = s.anilistUsernames.length ? s.anilistUsernames.join(", ") : "(none)";
  const statuses = s.statuses.length ? s.statuses.join(", ") : "(none)";
  const formatRange = (min, max) => {
    if (min == null && max == null) return "(any)";
    if (min != null && max != null) return `${min} - ${max}`;
    if (min != null) return `>= ${min}`;
    return `<= ${max}`;
  };
  const yearRange = formatRange(s.yearMin, s.yearMax);
  const popularityRange = formatRange(s.popularityMin, s.popularityMax);
  el("summary").innerHTML = `
    <div class="chip">Users: ${escapeHtml(users)}</div>
    <div class="chip">Combine: ${escapeHtml(s.combine)}</div>
    <div class="chip">Statuses: ${escapeHtml(statuses)}</div>
    <div class="chip">Year: ${escapeHtml(yearRange || "(any)")}</div>
    <div class="chip">Popularity: ${escapeHtml(popularityRange || "(any)")}</div>
  `;
}

ensureSettingsInitialized();
// モーダル共通を初期化（保存後にsummary更新）
initSettingsModal({ onSaved: renderSummary });

el("btnSettings").addEventListener("click", () => window.openSettingsModal());
el("btnStart").addEventListener("click", () => (location.href = "game.html"));
el("btnReset").addEventListener("click", () => {
  resetSettings();
  ensureSettingsInitialized();
  renderSummary();
});

renderSummary();
