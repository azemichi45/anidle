/**
 * AniList backend helpers (UIなし)
 * - localStorage の設定からユーザー×ステータスの MediaList を取得
 * - AND/OR で候補集合を作る
 * - ランダムに 1つ animeId を返す
 */

// ===============================
// localStorage 設定
// ===============================
const SETTINGS_KEY = "anidle_settings_v3";

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    // デフォルト（必要なら変えてOK）
    return {
      anilistUsernames: [],
      listMode: "OR", // "AND" | "OR"
      statuses: ["CURRENT", "COMPLETED"], // AniList MediaListStatus
      dedupe: true,
      yearMin: null,
      yearMax: null,
      popularityMin: null,
      popularityMax: null,
    };
  }
  try {
    const obj = JSON.parse(raw);
    const toOptionalInt = (value) => {
      if (value == null || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };
    return {
      anilistUsernames: Array.isArray(obj.anilistUsernames)
        ? obj.anilistUsernames
        : [],
      listMode: obj.combine === "AND" ? "AND" : "OR",
      statuses: Array.isArray(obj.statuses)
        ? obj.statuses
        : ["CURRENT", "COMPLETED"],
      dedupe: obj.dedupe !== false,
      yearMin: toOptionalInt(obj.yearMin),
      yearMax: toOptionalInt(obj.yearMax),
      popularityMin: toOptionalInt(obj.popularityMin),
      popularityMax: toOptionalInt(obj.popularityMax),
    };
  } catch {
    // 壊れてたらデフォルト
    return {
      anilistUsernames: [],
      listMode: "OR",
      statuses: ["CURRENT", "COMPLETED"],
      dedupe: true,
      yearMin: null,
      yearMax: null,
      popularityMin: null,
      popularityMax: null,
    };
  }
}

// ===============================
// AniList GraphQL
// ===============================
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

/**
 * UI側で "WATCHING" などを保存してしまってても救えるようにマップ
 * 400 を避けるため、必ず AniList enum に直す
 */
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
  // 空なら最低限
  return out.length ? [...new Set(out)] : ["CURRENT", "COMPLETED"];
}

async function anilistRequest(query, variables) {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || json?.errors) {
    const msg = json?.errors?.[0]?.message || `HTTP ${res.status}`;
    const detail = json ? JSON.stringify(json) : "";
    throw new Error(
      `AniList request failed: ${msg}${detail ? " " + detail : ""}`,
    );
  }
  return json.data;
}

/**
 * 1ユーザー分の animeId セットを取得（MediaListStatus複数指定可）
 * - タイトルなどは取らず id のみ
 * - paginate して全件集める
 */
async function fetchUserAnimeIdSet({
  username,
  statuses,
  yearMin,
  yearMax,
  popularityMin,
  popularityMax,
}) {
  const query = `
    query ($userName: String!) {
      MediaListCollection(userName: $userName, type: ANIME) {
        lists {
          entries {
            status
            media {
              id
              format
              startDate { year }
              popularity
            }
          }
        }
      }
    }
  `;

  const st = normalizeStatuses(statuses);
  const stSet = new Set(st);

  const data = await anilistRequest(query, { userName: username });

  const idSet = new Set();

  const lists = data?.MediaListCollection?.lists ?? [];
  for (const lst of lists) {
    const entries = lst?.entries ?? [];
    for (const e of entries) {
      const status = String(e?.status ?? "").toUpperCase();
      if (!stSet.has(status)) continue;

      // ★ TV以外を除外
      if (e?.media?.format !== "TV") continue;

      const year = e?.media?.startDate?.year;
      const popularity = e?.media?.popularity;
      if (yearMin != null && (!year || year < yearMin)) continue;
      if (yearMax != null && (!year || year > yearMax)) continue;
      if (popularityMin != null && (!popularity || popularity < popularityMin)) {
        continue;
      }
      if (popularityMax != null && (!popularity || popularity > popularityMax)) {
        continue;
      }

      const id = e?.media?.id;
      if (typeof id === "number") idSet.add(id);
    }
  }

  return idSet;
}

// ===============================
// 集合演算 AND / OR
// ===============================
function unionSets(sets) {
  const out = new Set();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

function intersectSets(sets) {
  if (!sets.length) return new Set();
  // 小さい集合から始めると速い
  const sorted = [...sets].sort((a, b) => a.size - b.size);
  const [first, ...rest] = sorted;
  const out = new Set();
  for (const v of first) {
    let ok = true;
    for (const s of rest) {
      if (!s.has(v)) {
        ok = false;
        break;
      }
    }
    if (ok) out.add(v);
  }
  return out;
}

function pickRandomFromSet(set) {
  const n = set.size;
  if (n === 0) return null;
  const idx = Math.floor(Math.random() * n);
  let i = 0;
  for (const v of set) {
    if (i === idx) return v;
    i++;
  }
  return null;
}

// ===============================
// メイン：答えの animeId を1つ返す
// ===============================
/**
 * @returns {Promise<number>} animeId
 */
async function getRandomAnswerAnimeIdFromLocalStorage() {
  const s = loadSettings();
  console.log(s);

  const usernames = (s.anilistUsernames || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  if (usernames.length === 0) {
    throw new Error("No AniList usernames in settings.");
  }

  const statuses = normalizeStatuses(s.statuses);
  const mode = s.listMode === "AND" ? "AND" : "OR";

  // 1) 各ユーザーのID集合を取得（並列）
  const sets = await Promise.all(
    usernames.map((u) =>
      fetchUserAnimeIdSet({
        username: u,
        statuses,
        yearMin: s.yearMin,
        yearMax: s.yearMax,
        popularityMin: s.popularityMin,
        popularityMax: s.popularityMax,
      }),
    ),
  );

  // 2) AND / OR
  const pool = mode === "AND" ? intersectSets(sets) : unionSets(sets);
  console.log(pool);
  console.log("test");

  // 3) ランダムに1つ
  const picked = pickRandomFromSet(pool);
  if (picked == null) {
    throw new Error(
      `No anime found. mode=${mode}, statuses=${statuses.join(",")}`,
    );
  }

  return picked;
}

export {
  getRandomAnswerAnimeIdFromLocalStorage,
};
// ===============================
// 使い方例（UIなし）
// ===============================
// (async () => {
//   try {
//     const animeId = await getRandomAnswerAnimeIdFromLocalStorage();
//     console.log("ANSWER animeId:", animeId);
//   } catch (e) {
//     console.error(e);
//   }
// })();
