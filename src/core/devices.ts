/**
 * DeviceStore — facade over the storage layer (data substrate for the
 * plugin-facing device context).
 *
 * - Single source of truth: IndexedDB via the store repositories;
 * - In-memory snapshot + change subscription (pub/sub); the UI consumes it
 *   through useSyncExternalStore;
 * - Write operations persist first, then refresh the snapshot and notify.
 *
 * Derived state (`online`) is carried in the public DeviceRecord but never
 * persisted; it is null (Unknown) until an online tracker lands.
 */
import { deviceRepo, eventRepo } from "./db";
import {
  MAX_CONNECTION_EVENTS,
  type ConnectionEvent,
  type CoreProtocol,
  type DeviceRecord,
  type StoredDevice,
} from "./db";
import { HostInfo } from "./hostinfo";

/** Connection registration input. `protocol` is required: it tags the core protocol the connection ran on. */
export interface RecordConnectionInput {
  uuid: string;
  direction: "in" | "out";
  protocol: CoreProtocol;
  /** Initiating extension id; omit for core (handshake) connections. */
  extension?: string | null;
  /** Connection time (epoch ms), defaults to now. */
  time?: number;
  /** System info reported by the peer's hello handshake, optional. */
  hostInfo?: HostInfo;
}

export interface DeviceStoreSnapshot {
  devices: DeviceRecord[];
  events: ConnectionEvent[];
}

class DeviceStore {
  private snapshot: DeviceStoreSnapshot = { devices: [], events: [] };
  private listeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;

  /**
   * Idempotent initialization: load full data once (safe to call repeatedly).
   * A failed load resets the promise so a later call can retry.
   */
  init(): Promise<void> {
    this.initPromise ??= this.load().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DeviceStoreSnapshot => this.snapshot;

  /** Write a remark (null = clear it, falling back to hostname / "Unknown device"). */
  async setRemark(uuid: string, remark: string | null): Promise<void> {
    await this.init();
    const next = await deviceRepo.patchDevice(uuid, { remark });
    if (next) this.applyDevice(next);
  }

  /**
   * Patch a device profile with peer-reported hello info (late-arriving or
   * re-reported hello). Undefined fields keep the existing value.
   */
  async updateHello(uuid: string, hello: HostInfo): Promise<void> {
    await this.init();
    const patch: Partial<Omit<StoredDevice, "uuid">> = {};
    if (hello.name !== undefined) patch.name = hello.name;
    if (hello.platform !== undefined) patch.platform = hello.platform;
    if (hello.os !== undefined) patch.os = hello.os;
    if (Object.keys(patch).length === 0) return;
    const next = await deviceRepo.patchDevice(uuid, patch);
    if (next) this.applyDevice(next);
  }

  /** Delete a device profile and its associated event log. */
  async removeDevice(uuid: string): Promise<void> {
    await this.init();
    await deviceRepo.removeDevice(uuid);
    this.snapshot = {
      devices: this.snapshot.devices.filter((d) => d.uuid !== uuid),
      events: this.snapshot.events.filter((e) => e.uuid !== uuid),
    };
    this.emit();
  }

  /** Record a connection: event (fact source) + device profile projection, atomically persisted. */
  async recordConnection(input: RecordConnectionInput): Promise<void> {
    await this.init();
    const { device, event } = await eventRepo.recordConnection(
      {
        uuid: input.uuid,
        direction: input.direction,
        extension: input.extension ?? null,
        time: input.time ?? Date.now(),
        protocol: input.protocol,
      },
      input.hostInfo
    );
    const devices = [
      ...this.snapshot.devices.filter((d) => d.uuid !== device.uuid),
      this.materialize(device),
    ];
    const events = [...this.snapshot.events, event]
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_CONNECTION_EVENTS);
    this.snapshot = { devices, events };
    console.info(
      `[devices] connection recorded: ${input.direction} via ${input.protocol} (${input.uuid})`
    );
    this.emit();
  }

  private async load(): Promise<void> {
    const [devices, events] = await Promise.all([
      deviceRepo.listDevices(),
      eventRepo.listAllEvents(),
    ]);
    this.snapshot = {
      devices: devices.map((d) => ({ ...d, online: null })),
      events: events.sort((a, b) => a.time - b.time),
    };
    console.info(
      `[devices] store ready: ${devices.length} devices, ${events.length} events`
    );
    this.emit();
  }

  /** Rebuild the public shape from the stored shape, keeping any derived online status. */
  private materialize(stored: StoredDevice): DeviceRecord {
    const prev = this.snapshot.devices.find((d) => d.uuid === stored.uuid);
    return { ...stored, online: prev?.online ?? null };
  }

  private applyDevice(stored: StoredDevice): void {
    this.snapshot = {
      ...this.snapshot,
      devices: this.snapshot.devices.map((d) =>
        d.uuid === stored.uuid ? this.materialize(stored) : d
      ),
    };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const deviceStore = new DeviceStore();
