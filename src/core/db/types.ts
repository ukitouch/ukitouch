/*
 * Storage-layer data model and public contracts.
 *
 * Physical storage: IndexedDB (database `ukitouch`).
 */

import { Platform } from "../types";

/** Store names that can be operated. */
export type StoreName = "devices" | "connectionEvents";

/** IndexedDB database name and current schema version. */
export const DB_NAME = "ukitouch";
export const DB_VERSION = 1;
/** Bounded event-log cap (FIFO trim). */
export const MAX_CONNECTION_EVENTS = 500;

/** Core transport protocol. */
export type CoreProtocol = "p2p" | "usb" | "ble";

/**
 * Device profile.
 */
export interface DeviceRecord {
  /** Permanent identity, primary key. */
  uuid: string;
  /** Hostname reported by the peer, nullable. */
  name: string | null;
  /**
   * User remark, nullable.
   * 
   * Display priority: remark \> name \> "Unknown device".
   */
  remark: string | null;
  platform: Platform | null;
  /** OS description, e.g. "Windows 11". */
  os: string | null;
  /** First connected time (epoch ms). */
  firstSeen: number;
  /** Last connection time (epoch ms). */
  lastSeen: number | null;
  /** {@link CoreProtocol} of the last connection. */
  protocol: CoreProtocol | null;
}

/** Connection event log. */
export interface ConnectionEvent {
  /** log id */
  id: number;
  uuid: string;
  /** 'in' (inbound) / 'out' (outbound) */
  direction: "in" | "out";
  /** Initiating extension id. */
  extension: string;
  /** Epoch ms. */
  time: number;
  /** Core protocol used by this connection. */
  protocol: CoreProtocol;
}

/** Input shape for appending/recording a connection. */
export type NewConnectionEvent = Omit<ConnectionEvent, "id">;
