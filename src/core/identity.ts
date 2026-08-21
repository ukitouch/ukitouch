const STORAGE_KEY = "yatouch.deviceId";

// 9-digit numeric id
function newId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(100_000_000 + (n % 900_000_000));
}

/**
 * This device's persistent identity. Generated on first run and stored in localStorage
 * Doubles as the device's address on the signaling server.
 */
export const deviceId: string = (() => {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = newId();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
})();
