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

function confirmDialog(message, opts = {}) {
  const {
    title = "Confirm",
    okText = "OK",
    cancelText = "Cancel",
  } = opts;
  const backdrop = el("confirmBackdrop");
  const msgEl = el("confirmMsg");
  const okBtn = el("confirmOk");
  const cancelBtn = el("confirmCancel");
  const titleEl = backdrop.querySelector(".confirm-title");

  msgEl.textContent = message;
  titleEl.textContent = title;
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;

  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    const cleanup = (val) => {
      backdrop.classList.remove("open");
      backdrop.setAttribute("aria-hidden", "true");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdrop);
      window.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === backdrop) cleanup(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdrop);
    window.addEventListener("keydown", onKey);
  });
}

ensureSettingsInitialized();
// モーダル共通を初期化（保存後にsummary更新）
initSettingsModal({ onSaved: renderSummary });

el("btnSettings").addEventListener("click", () => window.openSettingsModal());
el("btnStart").addEventListener("click", () => (location.href = "game.html"));
el("btnReset").addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Reset settings to default?\nThis will clear users and filters.",
    { okText: "Reset", cancelText: "Cancel" },
  );
  if (!ok) return;
  resetSettings();
  ensureSettingsInitialized();
  renderSummary();
});

renderSummary();
