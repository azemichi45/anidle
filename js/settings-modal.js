// js/settings-modal.js
import { loadSettings, saveSettings } from "./settings-store.js";
const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const normalizeUserName = (name) =>
  String(name || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\s+/g, "");

const uniq = (arr) => Array.from(new Set(arr));
const MAX_USERS = 10;

async function injectModalHtml() {
  if (document.getElementById("backdrop")) return;

  const res = await fetch("./settings-modal.html");
  if (!res.ok) throw new Error("Failed to load settings modal HTML");

  const html = await res.text();
  document.body.insertAdjacentHTML("beforeend", html);
}

async function anilistUserExists(username) {
  const query = `
    query ($name: String!) {
      User(name: $name) { id }
    }
  `;

  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { name: username } }),
    });

    if (!res.ok) {
      if (res.status === 429) return { ok: false, reason: "rate_limit" };
      return { ok: false, reason: "http_error", status: res.status };
    }

    const json = await res.json();
    if (json?.errors?.length) return { ok: false, reason: "graphql_error" };
    return { ok: true, exists: !!json?.data?.User };
  } catch (e) {
    console.error("AniList check failed", e);
    return { ok: false, reason: "network" };
  }
}

export async function initSettingsModal({
  // 保存後に「ページ側のsummary再描画」をしたいときに渡す
  onSaved = null,
} = {}) {

  await injectModalHtml();

  const el = (id) => document.getElementById(id);
  const backdrop = el("backdrop");

  let settings = loadSettings();
  let draft = structuredClone(settings);

  function setToast(msg, type = "info", keepMs = 2400) {
    const toastEl = el("toast");
    const msgEl = el("toastMsg");
    msgEl.textContent = msg || "";
    toastEl.className = `toast ${type}`;
    if (!msg) return;
    window.clearTimeout(setToast._t);
    setToast._t = window.setTimeout(() => {
      msgEl.textContent = "";
      toastEl.className = "toast";
    }, keepMs);
  }

  function statusCheckboxes() {
    return Array.from(
      backdrop.querySelectorAll('input[type="checkbox"][value]'),
    );
  }

  const YEAR_MIN_DEFAULT = 1960;
  const YEAR_MAX_DEFAULT = 2026;
  const POP_MIN = 0;
  const POP_MAX = 500000;
  let yearBounds = { min: YEAR_MIN_DEFAULT, max: YEAR_MAX_DEFAULT };
  const yearBoundsCache = new Map();
  let yearSlider = null;
  let popularitySlider = null;

  function readRangeInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  }

  function normalizeStatuses(inputStatuses) {
    const map = {
      WATCHING: "CURRENT",
      CURRENT: "CURRENT",
      COMPLETED: "COMPLETED",
      PLAN_TO_WATCH: "PLANNING",
      PLANNING: "PLANNING",
      PAUSED: "PAUSED",
      DROPPED: "DROPPED",
      REPEATING: "REPEATING",
    };
    const out = [];
    for (const s of inputStatuses || []) {
      const key = String(s || "")
        .trim()
        .toUpperCase();
      if (map[key]) out.push(map[key]);
    }
    return out.length ? [...new Set(out)] : ["CURRENT", "COMPLETED"];
  }

  async function fetchYearRangeForUser({ username, statuses }) {
    const query = `
      query ($userName: String!) {
        MediaListCollection(userName: $userName, type: ANIME) {
          lists {
            entries {
              status
              media {
                format
                startDate { year }
              }
            }
          }
        }
      }
    `;

    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { userName: username } }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.errors) {
      return null;
    }

    const st = new Set(normalizeStatuses(statuses));
    let min = Infinity;
    let max = -Infinity;
    const lists = json?.data?.MediaListCollection?.lists ?? [];
    for (const lst of lists) {
      const entries = lst?.entries ?? [];
      for (const e of entries) {
        const status = String(e?.status ?? "").toUpperCase();
        if (!st.has(status)) continue;
        if (e?.media?.format !== "TV") continue;
        const year = e?.media?.startDate?.year;
        if (!year) continue;
        if (year < min) min = year;
        if (year > max) max = year;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  }

  async function resolveYearBounds(usernames, statuses) {
    const key = `${usernames.join(",")}|${statuses.join(",")}`;
    if (yearBoundsCache.has(key)) return yearBoundsCache.get(key);
    const results = await Promise.all(
      usernames.map((u) => fetchYearRangeForUser({ username: u, statuses })),
    );
    let min = Infinity;
    let max = -Infinity;
    for (const r of results) {
      if (!r) continue;
      if (r.min < min) min = r.min;
      if (r.max > max) max = r.max;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const bounds = { min, max };
    yearBoundsCache.set(key, bounds);
    return bounds;
  }

  function formatRange(min, max) {
    if (min == null && max == null) return "(any)";
    if (min != null && max != null) return `${min} - ${max}`;
    if (min != null) return `>= ${min}`;
    return `<= ${max}`;
  }

  function applyYearBounds(bounds) {
    yearBounds = bounds || { min: YEAR_MIN_DEFAULT, max: YEAR_MAX_DEFAULT };
    if (draft) {
      if (draft.yearMin != null && draft.yearMin < yearBounds.min) {
        draft.yearMin = null;
      }
      if (draft.yearMax != null && draft.yearMax > yearBounds.max) {
        draft.yearMax = null;
      }
    }
    yearSlider?.setBounds(yearBounds.min, yearBounds.max);
  }

  function createDualSlider({
    sliderId,
    minInputId,
    maxInputId,
    step,
    boundsMin,
    boundsMax,
    onChange,
  }) {
    const slider = el(sliderId);
    const minInput = el(minInputId);
    const maxInput = el(maxInputId);
    const selection = slider.querySelector(".slider-selection");
    const minHandle = slider.querySelector(".min-slider-handle");
    const maxHandle = slider.querySelector(".max-slider-handle");
    let minVal = boundsMin;
    let maxVal = boundsMax;

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const snap = (v) => Math.round(v / step) * step;
    const span = () => boundsMax - boundsMin || 1;

    function valueFromClientX(clientX) {
      const rect = slider.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      return snap(boundsMin + pct * span());
    }

    function setValues(nextMin, nextMax, fire = true) {
      minVal = clamp(snap(nextMin), boundsMin, boundsMax);
      maxVal = clamp(snap(nextMax), boundsMin, boundsMax);
      if (minVal > maxVal) {
        if (Math.abs(nextMin - minVal) < Math.abs(nextMax - maxVal)) {
          maxVal = minVal;
        } else {
          minVal = maxVal;
        }
      }
      minInput.value = String(minVal);
      maxInput.value = String(maxVal);
      render();
      if (fire) onChange?.();
    }

    function render() {
      const minPct = ((minVal - boundsMin) / span()) * 100;
      const maxPct = ((maxVal - boundsMin) / span()) * 100;
      minHandle.style.left = `${minPct}%`;
      maxHandle.style.left = `${maxPct}%`;
      selection.style.left = `${minPct}%`;
      selection.style.width = `${Math.max(0, maxPct - minPct)}%`;
    }

    let active = null;
    function pickHandle(val) {
      return Math.abs(val - minVal) <= Math.abs(val - maxVal) ? "min" : "max";
    }

    slider.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const val = valueFromClientX(e.clientX);
      active = e.target?.dataset?.handle || pickHandle(val);
      if (active === "min") setValues(val, maxVal);
      else setValues(minVal, val);
      slider.setPointerCapture(e.pointerId);
    });
    slider.addEventListener("pointermove", (e) => {
      if (!active) return;
      const val = valueFromClientX(e.clientX);
      if (active === "min") setValues(val, maxVal);
      else setValues(minVal, val);
    });
    slider.addEventListener("pointerup", () => {
      active = null;
    });
    slider.addEventListener("pointercancel", () => {
      active = null;
    });

    return {
      setBounds(min, max) {
        boundsMin = min;
        boundsMax = max;
        setValues(
          clamp(minVal, boundsMin, boundsMax),
          clamp(maxVal, boundsMin, boundsMax),
          false,
        );
        render();
      },
      setValues,
      getValues() {
        return { min: minVal, max: maxVal };
      },
      render,
    };
  }

  function updateFilterLabels() {
    el("valYearRange").textContent = formatRange(
      draft.yearMin,
      draft.yearMax,
    );
    el("valPopularityRange").textContent = formatRange(
      draft.popularityMin,
      draft.popularityMax,
    );
    el("valYearMin").textContent =
      draft.yearMin == null ? yearBounds.min : draft.yearMin;
    el("valYearMax").textContent =
      draft.yearMax == null ? yearBounds.max : draft.yearMax;
    el("valPopularityMin").textContent =
      draft.popularityMin == null ? POP_MIN : draft.popularityMin;
    el("valPopularityMax").textContent =
      draft.popularityMax == null ? POP_MAX : draft.popularityMax;
  }

  function syncFilterFromInputs() {
    const yearMinRaw = readRangeInt(el("inpYearMin").value, yearBounds.min);
    const yearMaxRaw = readRangeInt(el("inpYearMax").value, yearBounds.max);
    const popMinRaw = readRangeInt(el("inpPopularityMin").value, POP_MIN);
    const popMaxRaw = readRangeInt(el("inpPopularityMax").value, POP_MAX);

    draft.yearMin = yearMinRaw <= yearBounds.min ? null : yearMinRaw;
    draft.yearMax = yearMaxRaw >= yearBounds.max ? null : yearMaxRaw;
    draft.popularityMin = popMinRaw <= POP_MIN ? null : popMinRaw;
    draft.popularityMax = popMaxRaw >= POP_MAX ? null : popMaxRaw;
    updateFilterLabels();
  }

  function renderModal() {
    el("valCombine").textContent = draft.combine;
    for (const r of document.querySelectorAll('input[name="combine"]')) {
      r.checked = r.value === draft.combine;
    }

    const selected = new Set(draft.statuses || []);
    for (const cb of statusCheckboxes()) {
      cb.checked = selected.has(cb.value);
    }
    el("valStatuses").textContent = draft.statuses.length
      ? draft.statuses.join(", ")
      : "(none)";

    applyYearBounds(yearBounds);
    yearSlider?.setValues(
      draft.yearMin ?? yearBounds.min,
      draft.yearMax ?? yearBounds.max,
      false,
    );
    popularitySlider?.setValues(
      draft.popularityMin ?? POP_MIN,
      draft.popularityMax ?? POP_MAX,
      false,
    );
    updateFilterLabels();

    const list = el("userList");
    list.innerHTML = "";
    if (!draft.anilistUsernames.length) {
      const div = document.createElement("div");
      div.className = "user-item";
      div.innerHTML = `<div class="name" style="color: var(--muted)">(no users)</div>`;
      list.appendChild(div);
    } else {
      draft.anilistUsernames.forEach((u, idx) => {
        const row = document.createElement("div");
        row.className = "user-item";
        row.innerHTML = `
          <div class="name">${escapeHtml(u)}</div>
          <div class="meta">#${idx + 1}</div>
          <button class="mini-btn danger" data-del="${idx}">Remove</button>
        `;
        list.appendChild(row);
      });
    }
  }

  function openModal() {
    settings = loadSettings();
    draft = structuredClone(settings);
    renderModal();
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    el("inpUser").value = "";
    setToast("", "info");

    const usernames = (draft.anilistUsernames || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!usernames.length) return;
    const statuses = normalizeStatuses(draft.statuses);
    resolveYearBounds(usernames, statuses)
      .then((bounds) => {
        if (!bounds) return;
        applyYearBounds(bounds);
        renderModal();
      })
      .catch(() => {});
  }

  function closeModal() {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    setToast("", "info");
  }

  // ===== ここが「他画面でも開ける」ための公開API =====
  window.openSettingsModal = openModal; // どのページでも使えるようにしておく（好みでexportだけでもOK）
  window.closeSettingsModal = closeModal;

  // close handlers（重複登録を避けるため once）
  if (!initSettingsModal._wired) {
    initSettingsModal._wired = true;

    yearSlider = createDualSlider({
      sliderId: "yearSlider",
      minInputId: "inpYearMin",
      maxInputId: "inpYearMax",
      step: 1,
      boundsMin: yearBounds.min,
      boundsMax: yearBounds.max,
      onChange: syncFilterFromInputs,
    });
    popularitySlider = createDualSlider({
      sliderId: "popularitySlider",
      minInputId: "inpPopularityMin",
      maxInputId: "inpPopularityMax",
      step: 1000,
      boundsMin: POP_MIN,
      boundsMax: POP_MAX,
      onChange: syncFilterFromInputs,
    });

    el("closeBtn").addEventListener("click", closeModal);
    el("btnCancel").addEventListener("click", closeModal);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // add user loading
    function setAddUserLoading(isLoading) {
      const btn = el("btnAddUser");
      const spin = el("spinAddUser");
      const lbl = el("lblAddUser");
      btn.disabled = isLoading;
      spin.classList.toggle("show", isLoading);
      lbl.textContent = isLoading ? "Checking…" : "Add";
    }

    async function addUserFromInput() {
      const input = el("inpUser");
      const raw = input.value;
      const name = normalizeUserName(raw);

      if (draft.anilistUsernames.length >= MAX_USERS) {
        setToast(`You can add up to ${MAX_USERS} users.`, "warn", 4000);
        input.focus();
        return;
      }
      if (!name) {
        setToast("Please enter a username.", "warn");
        input.focus();
        return;
      }
      if (draft.anilistUsernames.includes(name)) {
        setToast("That user is already in the list.", "warn");
        input.value = "";
        input.focus();
        return;
      }

      setAddUserLoading(true);
      setToast("Checking if the user exists on AniList…", "info", 999999);

      try {
        const res = await anilistUserExists(name);

        if (!res.ok) {
          if (res.reason === "rate_limit") {
            setToast(
              "AniList is rate-limiting requests right now. Please wait and try again.",
              "warn",
              5000,
            );
            return;
          }
          if (res.reason === "network") {
            setToast("Network error. Please try again.", "err", 5000);
            return;
          }
          setToast("AniList check failed. Please try again.", "err", 5000);
          return;
        }

        if (!res.exists) {
          setToast("User not found. Please check spelling.", "warn", 5000);
          input.focus();
          input.select?.();
          return;
        }

        draft.anilistUsernames = [...draft.anilistUsernames, name];
        input.value = "";
        renderModal();
        setToast("User added.", "ok");
      } finally {
        setAddUserLoading(false);
      }
    }

    el("btnAddUser").addEventListener("click", addUserFromInput);
    el("inpUser").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addUserFromInput();
    });

    el("userList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      const idx = Number(btn.getAttribute("data-del"));
      if (!Number.isFinite(idx)) return;
      draft.anilistUsernames.splice(idx, 1);
      renderModal();
      setToast("User removed.", "ok");
    });

    for (const r of document.querySelectorAll('input[name="combine"]')) {
      r.addEventListener("change", () => {
        if (r.checked) {
          draft.combine = r.value;
          renderModal();
        }
      });
    }

    for (const cb of statusCheckboxes()) {
      cb.addEventListener("change", () => {
        const cur = new Set(draft.statuses);
        if (cb.checked) cur.add(cb.value);
        else cur.delete(cb.value);
        draft.statuses = Array.from(cur);
        renderModal();
      });
    }

    el("btnSave").addEventListener("click", () => {
      const picked = document.querySelector('input[name="combine"]:checked')
        ?.value;
      if (picked === "OR" || picked === "AND") draft.combine = picked;

      syncFilterFromInputs();

      draft.anilistUsernames = uniq(
        draft.anilistUsernames.map(normalizeUserName),
      ).filter(Boolean);

      if (draft.anilistUsernames.length > MAX_USERS) {
        setToast(`Please keep users to ${MAX_USERS} or fewer.`, "warn", 5000);
        return;
      }
      if (!draft.statuses.length) {
        setToast("Please select at least one status.", "warn", 5000);
        return;
      }
      if (
        draft.yearMin != null &&
        draft.yearMax != null &&
        draft.yearMin > draft.yearMax
      ) {
        setToast("Year range is invalid (min > max).", "warn", 5000);
        return;
      }
      if (
        draft.popularityMin != null &&
        draft.popularityMax != null &&
        draft.popularityMin > draft.popularityMax
      ) {
        setToast("Popularity range is invalid (min > max).", "warn", 5000);
        return;
      }

      saveSettings(draft);
      setToast("Saved.", "ok");
      closeModal();

      // ページ側のsummary更新など
      onSaved?.(draft);
    });
  }

  return { openModal, closeModal };
}
