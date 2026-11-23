// localStorage that never throws: private windows, blocked storage and full
// quotas all fall back to "nothing saved".

export function loadJSON<T>(key: string, fallback: T, valid: (x: unknown) => boolean = () => true): T {
  try {
    const text = window.localStorage.getItem(key)
    if (!text) return fallback
    const value: unknown = JSON.parse(text)
    return valid(value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable or full: the page keeps working without saving
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // nothing to do
  }
}
