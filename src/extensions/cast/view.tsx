import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import { Button, PageHeader, PeerDeviceSearch } from "../../api";
import {
  castStore,
  setViewer,
  stopSharing,
  stopWatching,
  watch,
  type StreamTile,
} from "./api";
import { CastSettings } from "./settings";

/** How long the watch controls linger without input. */
const IDLE_MS = 3000;

export default function CastView() {
  const state = useSyncExternalStore(castStore.subscribe, castStore.get);
  const { devices, watching, sharing, error } = state;
  const isWatching = watching !== null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controls, setControls] = useState(true);
  const hideAt = useRef(Date.now() + IDLE_MS);

  /** Flip the watch controls, restarting the idle timer when they come out. */
  const toggleControls = () => {
    if (controls) {
      setControls(false);
    } else {
      hideAt.current = Date.now() + IDLE_MS;
      setControls(true);
    }
  };

  // Fade the watch controls when nothing has happened for a while, but keep
  // them up while settings are open.
  useEffect(() => {
    if (!isWatching) return;
    if (!settingsOpen) hideAt.current = Date.now() + IDLE_MS;
    const id = window.setInterval(() => {
      if (!settingsOpen && Date.now() > hideAt.current) setControls(false);
    }, 250);
    return () => window.clearInterval(id);
  }, [isWatching, settingsOpen]);

  // A fresh watch starts with settings closed.
  useEffect(() => {
    if (!isWatching) setSettingsOpen(false);
  }, [isWatching]);

  // Hand frame batches to the canvas. Registered once and the ref is resolved at
  // draw time so the viewer can mount later.
  useEffect(() => {
    let queued: StreamTile[][] = [];
    let drawing = false;
    let screen = { width: 0, height: 0 };

    async function pump(): Promise<void> {
      if (drawing) return;
      drawing = true;
      try {
        while (queued.length > 0) {
          const tiles = queued.shift()!;
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) continue;
          const bitmaps = await Promise.all(
            tiles.map((tile) =>
              createImageBitmap(
                new Blob([tile.data as Uint8Array<ArrayBuffer>], {
                  type: "image/webp",
                })
              )
            )
          );
          tiles.forEach((tile, i) => {
            ctx.drawImage(bitmaps[i], tile.x, tile.y);
            bitmaps[i].close();
          });
        }
      } catch (e) {
        console.error("[cast] draw failed", e);
      } finally {
        drawing = false;
      }
    }

    setViewer({
      resize(width, height) {
        screen = { width, height };
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }
      },
      draw(tiles) {
        const full = tiles.some(
          (t) =>
            t.x === 0 &&
            t.y === 0 &&
            t.width >= screen.width &&
            t.height >= screen.height
        );
        queued = full ? [tiles] : [...queued, tiles];
        void pump();
      },
    });
    return () => setViewer(null);
  }, []);

  // Leaving the page ends the watch: there is no canvas left to draw into.
  useEffect(() => () => stopWatching(), []);

  // Size up front when the view mounts after the announce already arrived.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && watching?.info) {
      canvas.width = watching.info.width;
      canvas.height = watching.info.height;
    }
  }, [watching?.info]);

  if (watching) {
    return (
      <div className="relative h-full overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ objectFit: "contain" }}
          onClick={toggleControls}
        />

        <div
          className={`absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-3 text-xs text-gray-200 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${controls || settingsOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
        >
          <span className="truncate">
            {watching.peerId}
            {!watching.info && " · connecting…"}
          </span>
          {sharing && <span className="text-gray-400">· sharing your screen</span>}
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            Settings
          </Button>
          <Button variant="danger" onClick={stopWatching}>
            Stop
          </Button>
        </div>

        <div
          className={`absolute inset-0 z-10 bg-black/40 transition-opacity duration-300 ${settingsOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          onClick={() => setSettingsOpen(false)}
        />

        <div
          className={`absolute top-0 right-0 z-30 h-full w-80 max-w-full flex flex-col bg-white dark:bg-gray-900 shadow-xl transition-transform duration-300 ${settingsOpen ? "translate-x-0" : "translate-x-full"
            }`}
        >
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Settings
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <CastSettings />
          </div>
        </div>
      </div>
    );
  }

  const selected = devices.find((d) => d.uuid === selectedUuid);

  return (
    <div className="p-6 max-w-lg flex flex-col gap-4">
      <PageHeader title="Cast" subtitle="Watch another device's screen" />

      {error && <p className="text-xs text-red-500">{error}</p>}

      {sharing && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Sharing this screen
          </span>
          <Button variant="danger" onClick={stopSharing}>
            Stop
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <PeerDeviceSearch
          devices={devices}
          selectedUuid={selectedUuid}
          text={text}
          onTextChange={(t) => {
            setText(t);
            setSelectedUuid(null);
          }}
          onSelect={(uuid, label) => {
            setSelectedUuid(uuid);
            setText(label);
          }}
        />
        <Button
          onClick={() => {
            if (selected) {
              void watch(
                selected.uuid,
                selected.remark ?? selected.name ?? "Unknown device"
              );
            }
          }}
          disabled={!selected}
        >
          Watch
        </Button>
      </div>
    </div>
  );
}
