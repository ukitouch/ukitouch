import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Select } from "../../api";
import { castStore, setViewer, startCast, stopCast } from "./api";

export default function CastView() {
  const state = useSyncExternalStore(castStore.subscribe, castStore.get);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedUuid, setSelectedUuid] = useState("");

  useEffect(() => {
    setViewer({
      resize(width, height) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }
      },
      draw(tile) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const pixels = new Uint8ClampedArray(
          tile.data.buffer,
          tile.data.byteOffset,
          tile.data.byteLength
        );
        ctx.putImageData(
          new ImageData(pixels, tile.width, tile.height),
          tile.x,
          tile.y
        );
      },
    });
    return () => setViewer(null);
  }, []);

  const { devices, sending, receiving, stats } = state;

  // Size up front when the view mounts after the stream's announce already
  // arrived.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && receiving) {
      canvas.width = receiving.width;
      canvas.height = receiving.height;
    }
  }, [receiving]);

  function toggle() {
    if (sending) {
      stopCast();
      return;
    }
    const dev = devices.find((d) => d.uuid === selectedUuid);
    if (dev) void startCast(dev.uuid, dev.remark ?? dev.name ?? "Unknown device");
  }

  return (
    <div className="h-full flex flex-col bg-black">
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 text-xs text-gray-400">
        {sending ? (
          <>
            <span>
              casting to {sending.peerId} — {sending.info.width}x
              {sending.info.height}
            </span>
            <Button onClick={toggle}>Stop</Button>
          </>
        ) : (
          <>
            <Select
              value={selectedUuid}
              options={devices.map((d) => ({
                value: d.uuid,
                label: d.remark ?? d.name ?? d.uuid,
              }))}
              onChange={setSelectedUuid}
              ariaLabel="Target device"
            />
            <Button onClick={toggle} disabled={!selectedUuid}>
              Cast
            </Button>
          </>
        )}
        {receiving && (
          <span>
            receiving {receiving.width}x{receiving.height} · {stats.tiles} tiles ·{" "}
            {(stats.bytes / 1024).toFixed(0)} KiB
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full"
          style={{ objectFit: "contain" }}
        />
      </div>
    </div>
  );
}
