// suggestBox.js
export function createSuggestBox({
  inputEl,
  suggestEl,
  // data: [{id, romaji, english}] みたいな配列 or それを返す関数
  data,
  limit = 20,
  onSelect, // ({id, text}) => void
}) {
  let animeIndex = [];
  let activeIndex = -1;
  let lastRanked = [];
  let debounceTimer = null;

  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  async function ensureDataLoaded() {
    const arr = typeof data === "function" ? await data() : data;
    animeIndex = (arr || [])
      .filter((x) => x && typeof x.id !== "undefined")
      .map((x) => {
        const romaji = (x.romaji || "").trim();
        const english = (x.english || "").trim();
        return {
          id: Number(x.id),
          romaji,
          english,
          nRomaji: norm(romaji),
          nEnglish: norm(english),
        };
      });
  }

  function closeSuggest() {
    suggestEl.classList.remove("show");
    suggestEl.innerHTML = "";
    activeIndex = -1;
    lastRanked = [];
  }

  function setActive(index) {
    const items = Array.from(suggestEl.querySelectorAll(".sitem"));
    if (!items.length) return;
    activeIndex = Math.max(0, Math.min(index, items.length - 1));
    items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
    items[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function chooseActive() {
    if (activeIndex < 0 || activeIndex >= lastRanked.length) return false;
    const s = lastRanked[activeIndex];
    inputEl.value = s.text;
    closeSuggest();
    onSelect?.({ id: s.id, text: s.text });
    return true;
  }

  function rankSuggestLocal(q) {
    const nq = norm(q);
    if (!nq) return [];

    const prefix = [];
    const contains = [];

    for (const it of animeIndex) {
      if (it.nEnglish) {
        if (it.nEnglish.startsWith(nq)) prefix.push({ id: it.id, kind: "english", text: it.english, len: it.nEnglish.length });
        else if (it.nEnglish.includes(nq)) contains.push({ id: it.id, kind: "english", text: it.english, len: it.nEnglish.length });
      }
      if (it.nRomaji) {
        if (it.nRomaji.startsWith(nq)) prefix.push({ id: it.id, kind: "romaji", text: it.romaji, len: it.nRomaji.length });
        else if (it.nRomaji.includes(nq)) contains.push({ id: it.id, kind: "romaji", text: it.romaji, len: it.nRomaji.length });
      }
    }

    const sortKey = (a, b) => a.len - b.len || a.text.localeCompare(b.text);
    prefix.sort(sortKey);
    contains.sort(sortKey);

    const out = [];
    const seen = new Set();
    for (const x of [...prefix, ...contains]) {
      const k = x.id + "|" + norm(x.text);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
      if (out.length >= limit) break;
    }
    return out;
  }

  function renderSuggest(ranked) {
    lastRanked = ranked;
    suggestEl.innerHTML = "";

    for (let i = 0; i < ranked.length; i++) {
      const s = ranked[i];
      const div = document.createElement("div");
      div.className = "sitem";
      div.dataset.index = String(i);

      div.innerHTML = `
        <div class="stitle">${escapeHtml(s.text)}</div>
        <div class="ssub">${s.kind === "english" ? "English" : "Romaji"} • ID:${s.id}</div>
      `;

      div.addEventListener("mouseenter", () => setActive(i));
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        inputEl.value = s.text;
        closeSuggest();
        onSelect?.({ id: s.id, text: s.text });
      });

      suggestEl.appendChild(div);
    }

    if (ranked.length) {
      suggestEl.classList.add("show");
      activeIndex = 0;
      setActive(0);
    } else {
      closeSuggest();
    }
  }

  async function onType() {
    const q = inputEl.value.trim();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      const ranked = rankSuggestLocal(q);
      renderSuggest(ranked);
    }, 60);
  }

  // public API
  async function init() {
    await ensureDataLoaded();

    inputEl.addEventListener("input", onType);
    inputEl.addEventListener("focus", () => {
      if (suggestEl.children.length) suggestEl.classList.add("show");
    });
    inputEl.addEventListener("blur", () => setTimeout(closeSuggest, 120));

    inputEl.addEventListener("keydown", (e) => {
      const isOpen = suggestEl.classList.contains("show");
      const items = Array.from(suggestEl.querySelectorAll(".sitem"));
      if (isOpen && items.length) {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIndex + 1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIndex - 1); return; }
        if (e.key === "Enter") { e.preventDefault(); chooseActive(); return; }
        if (e.key === "Escape") { e.preventDefault(); closeSuggest(); return; }
      }
    });
  }

  return { init, closeSuggest };
}
