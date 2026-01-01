// js/settings-store.js
export const STORAGE_KEY = "anidle_settings_v3";

export function defaultSettings() {
  return {
    anilistUsernames: [],
    combine: "OR", // "OR" | "AND"
    statuses: ["CURRENT", "COMPLETED", "PLANNING"],
    yearMin: null,
    yearMax: null,
    popularityMin: null,
    popularityMax: null,
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function resetSettings() {
  localStorage.removeItem(STORAGE_KEY);
}

export function ensureSettingsInitialized() {
  if (!localStorage.getItem(STORAGE_KEY)) {
    saveSettings(defaultSettings());
  }
}
