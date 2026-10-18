import { deviceRepo, eventRepo } from "./db";
import {
  MAX_CONNECTION_EVENTS,
  type ConnectionEvent,
  type CoreProtocol,
  type DeviceRecord,
} from "./db";
import { HostInfo } from "./hostinfo";

/** Connection registration input. */
export interface RecordConnectionInput {
  uuid: string;
  direction: "in" | "out";
  protocol: CoreProtocol;
  /** Initiating extension id. */
  extension: string;
  /** System info reported by the peer's hello handshake. */
  hostInfo: HostInfo;
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
   * Load full data once.
   * 
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
   * Patch a device profile with peer-reported hello info.
   * 
   * Null fields keep the existing value.
   */
  async updateHello(uuid: string, hello: HostInfo): Promise<void> {
    await this.init();
    const patch: Partial<Omit<DeviceRecord, "uuid">> = {};
    if (hello.name !== null) patch.name = hello.name;
    if (hello.platform !== null) patch.platform = hello.platform;
    if (hello.os !== null) patch.os = hello.os;
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

  /** Record a connection to db. */
  async recordConnection(input: RecordConnectionInput): Promise<void> {
    await this.init();
    const { device, event } = await eventRepo.recordConnection(
      {
        uuid: input.uuid,
        direction: input.direction,
        extension: input.extension,
        time: Date.now(),
        protocol: input.protocol,
      },
      input.hostInfo
    );
    const devices = [
      ...this.snapshot.devices.filter((d) => d.uuid !== device.uuid),
      device,
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
      devices,
      events: events.sort((a, b) => a.time - b.time),
    };
    console.info(
      `[devices] store ready: ${devices.length} devices, ${events.length} events`
    );
    this.emit();
  }

  /** Apply a device profile update to the snapshot. */
  private applyDevice(device: DeviceRecord): void {
    this.snapshot = {
      ...this.snapshot,
      devices: this.snapshot.devices.map((d) =>
        d.uuid === device.uuid ? device : d
      ),
    };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const deviceStore = new DeviceStore();
