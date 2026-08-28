const UUID_KEY = "yatouch.deviceUuid";

function genUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // uuid v4 fallback (non-secure contexts where randomUUID is missing)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/** 9-digit temporary id. */
export function genTempId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(100_000_000 + (n % 900_000_000));
}

function read(key: string): string | null {
  return localStorage.getItem(key);
}
function write(key: string, value: string): void {
  localStorage.setItem(key, value);
}

/**
 * This device's permanent identity (uuid4). Generated on first run and
 * persisted. It is the registration id on the signaling server and the
 * basis of every P2P connection. Never shown to the user.
 */
export const deviceUuid: string = (() => {
  const existing = read(UUID_KEY);
  if (existing) return existing;
  const id = genUuid();
  write(UUID_KEY, id);
  return id;
})();
