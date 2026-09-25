'use client';

// The bill being built lives on the phone (localStorage), never on the server:
// it survives refresh, the browser being killed, or an expired login, and it
// keeps saving even when the internet is down. One draft per user, so on a
// shared phone one salesman's half-built bill never shows up for another.

const MAX_AGE_MS = 12 * 60 * 60 * 1000; // yesterday's abandoned bill shouldn't reappear

const keyFor = userId => `masterji_draft_${userId}`;

export function loadDraft(userId) {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft?.savedAt || Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(userId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(userId, data) {
  if (!userId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch { /* storage full or blocked: the bill still works, it just isn't saved */ }
}

export function clearDraft(userId) {
  if (!userId || typeof window === 'undefined') return;
  try { localStorage.removeItem(keyFor(userId)); } catch {}
}

export function hasDraft(userId) {
  const d = loadDraft(userId);
  return !!(d && (d.items?.length || d.replaces));
}
