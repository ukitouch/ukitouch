import { useEffect, useRef, useState } from "react";
import { createScreenMonitor, type ScreenInfo, type Disposable } from "../../api";

/** How often the on-screen counters refresh, in ms. */
const STATS_INTERVAL = 500;

export default function CastView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<ScreenInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [stats, setStats] = useState({ frames: 0, rects: 0, bytes: 0 });

  // Counted in refs so a change arrives without forcing a render per frame.
  const counters = useRef({ frames: 0, rects: 0, bytes: 0 });

  useEffect(() => {
    let cancelled = false;
    let monitor: { stop(): Promise<void> } | null = null;
    let sub: Disposable | null = null;

    void (async () => {
      const started = await createScreenMonitor();
      if (!started.ok) {
        if (!cancelled) {
          setError(
            started.detail ? `${started.reason}: ${started.detail}` : started.reason
          );
        }
        return;
      }
      // StrictMode mounts twice in development; the first monitor is stopped by
      // the cleanup below rather than being left running.
      if (cancelled) {
        void started.monitor.stop();
        return;
      }
      monitor = started.monitor;
      setInfo(started.monitor.info);
      started.monitor.onStop((reason) => setStopReason(reason ?? "stopped"));

      sub = started.monitor.onDamage((frames) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        for (const f of frames) {
          const px = new Uint8ClampedArray(
            f.data.buffer as ArrayBuffer,
            f.data.byteOffset,
            f.data.length
          );
          ctx.putImageData(new ImageData(px, f.width, f.height), f.x, f.y);
        }

        const c = counters.current;
        c.frames += 1;
        c.rects += frames.length;
        for (const f of frames) c.bytes += f.data.length;
      });
    })();

    return () => {
      cancelled = true;
      sub?.dispose();
      void monitor?.stop();
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setStats({ ...counters.current }), STATS_INTERVAL);
    return () => clearInterval(t);
  }, []);

  // Damage is incremental, the backing store has to match the screen exactly
  // for the rectangle coordinates to land where they belong.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !info) return;
    canvas.width = info.width;
    canvas.height = info.height;
  }, [info]);

  return (
    <div className="h-full flex flex-col bg-black">
      <div className="flex items-center gap-3 px-3 py-1 text-xs text-gray-400 shrink-0">
        {info ? (
          <span>
            {info.width}x{info.height} {info.format}
          </span>
        ) : (
          <span>{error ? `capture failed — ${error}` : "starting…"}</span>
        )}
        {stopReason && <span className="text-red-400">stopped: {stopReason}</span>}
        {info && (
          <>
            <span>
              {stats.frames} frames / {stats.rects} rects
            </span>
            <span>{(stats.bytes / 1024).toFixed(0)} KiB</span>
          </>
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
