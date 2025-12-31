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

function tplModal() {
  return `
  <div class="backdrop" id="backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="modal-header">
        <div class="left">
          <div class="pill">Settings</div>
        </div>
        <button class="icon-btn" id="closeBtn" aria-label="Close">×</button>
      </div>

      <div class="modal-body">
        <div class="content">
          <section class="section">
            <div class="section-title">
              <h3>AniList Users</h3>
              <div class="hint">Multiple users allowed (username only)</div>
            </div>

            <div class="field">
              <div class="field-head">
                <label>Add a user</label>
                <span class="value">Enter / Add</span>
              </div>
              <div class="row">
                <input class="text-input" id="inpUser" autocomplete="off"
                  placeholder="Type an AniList username…" />
                <button class="mini-btn" id="btnAddUser">
                  <span class="spinner" id="spinAddUser" aria-hidden="true"></span>
                  <span id="lblAddUser">Add</span>
                </button>
              </div>

              <div class="help" id="userHelp">
                Tip: If it fails, try the exact spelling.
              </div>

              <div class="user-list" id="userList"></div>
            </div>
          </section>

          <section class="section">
            <div class="section-title">
              <h3>Pool Rule</h3>
              <div class="hint">Combine all users by AND / OR</div>
            </div>

            <div class="grid">
              <div class="field">
                <div class="field-head">
                  <label>Combine method</label>
                  <span class="value" id="valCombine">OR</span>
                </div>
                <div class="row">
                  <label class="check" style="margin: 0">
                    <input type="radio" name="combine" value="OR" />
                    <span>OR (Union)</span>
                  </label>
                  <label class="check" style="margin: 0">
                    <input type="radio" name="combine" value="AND" />
                    <span>AND (Intersection)</span>
                  </label>
                </div>
              </div>

              <div class="field">
                <div class="field-head">
                  <label>Target statuses</label>
                  <span class="value" id="valStatuses">WATCHING…</span>
                </div>

                <label class="check">
                  <input type="checkbox" value="CURRENT" />
                  <span>Watching (CURRENT)</span>
                </label>
                <label class="check">
                  <input type="checkbox" value="COMPLETED" />
                  <span>Completed (COMPLETED)</span>
                </label>
                <label class="check">
                  <input type="checkbox" value="PLANNING" />
                  <span>Plan to Watch (PLANNING)</span>
                </label>
                <label class="check">
                  <input type="checkbox" value="PAUSED" />
                  <span>Paused (PAUSED)</span>
                </label>
                <label class="check">
                  <input type="checkbox" value="DROPPED" />
                  <span>Dropped (DROPPED)</span>
                </label>
                <label class="check">
                  <input type="checkbox" value="REPEATING" />
                  <span>Rewatching (REPEATING)</span>
                </label>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="footer">
        <div class="left">
          <span class="toast" id="toast">
            <span class="dot" aria-hidden="true"></span>
            <span class="msg" id="toastMsg"></span>
          </span>
        </div>
        <div class="right">
          <button class="mini-btn" id="btnCancel">Cancel</button>
          <button class="mini-btn" id="btnSave">Save</button>
        </div>
      </div>
    </div>
  </div>
  `;
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

export function initSettingsModal({
  // 保存後に「ページ側のsummary再描画」をしたいときに渡す
  onSaved = null,
} = {}) {
  // 既に注入済みなら二重に作らない
  if (!document.getElementById("backdrop")) {
    document.body.insertAdjacentHTML("beforeend", tplModal());
  }

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

      draft.anilistUsernames = uniq(
        draft.anilistUsernames.map(normalizeUserName),
      ).filter(Boolean);

      if (!draft.statuses.length) {
        setToast("Please select at least one status.", "warn", 5000);
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
