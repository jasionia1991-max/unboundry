export function clearProjectLocalKeys(id: string, userId = "") {
  try {
    // v1 未按账号隔离的旧键，以及 v2 按当前账号隔离的新键都清理。
    window.localStorage.removeItem(`tapnow-project-title:${id}`);
    if (userId) {
      window.localStorage.removeItem(`tapnow-project-title:v2:${userId}:${id}`);
    }
    const prefixV2 = `tapnow:generation-submission:v2:${encodeURIComponent(userId)}:${encodeURIComponent(id)}:`;
    const prefix = `tapnow:generation-submission:v1:${encodeURIComponent(id)}:`;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix) || (userId && key?.startsWith(prefixV2))) {
        keys.push(key);
      }
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup; server-side tombstone remains authoritative.
  }
}
