export function clearProjectLocalKeys(id: string) {
  try {
    window.localStorage.removeItem(`tapnow-project-title:${id}`);
    const prefix = `tapnow:generation-submission:v1:${encodeURIComponent(id)}:`;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup; server-side tombstone remains authoritative.
  }
}
