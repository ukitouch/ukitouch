import { useEffect, useRef } from "react";
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { watchPinch } from "../core/utils/pinch";

/** Where a {@link PinchArea}'s content sits after a gesture. */
export interface PinchTransform {
  /** content scale */
  scale: number;
  /** content offset from the area's top-left corner */
  x: number;
  /** content offset from the area's top-left corner */
  y: number;
}

export interface PinchAreaProps {
  /** lower scale bound, defaults to `1` */
  min?: number;
  /** upper scale bound, Defaults to `8` */
  max?: number;
  /**
   * Called once after the pinch ends.
   */
  onCommit?: (t: PinchTransform) => void;
  className?: string;
  children?: ReactNode;
  /**
   * Take over pointer handling.
   */
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

interface Point {
  x: number;
  y: number;
}

const IDENTITY: PinchTransform = { scale: 1, x: 0, y: 0 };

const LAYER_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  transformOrigin: "0 0",
  willChange: "transform",
};

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const distance = (a: Point, b: Point): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Pinch-to-zoom area.
 *
 * @param onCommit - Callback after the pinch ends
 */
export function PinchArea({
  min = 1,
  max = 8,
  onCommit,
  className = "",
  children,
  onPointerDown: handedDown,
  onPointerMove: handedMove,
  onPointerUp: handedUp,
  onPointerCancel: handedCancel,
}: PinchAreaProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** live pointers in area coordinates */
  const pointers = useRef(new Map<number, Point>());
  /** transform at the start of the current pointer combination */
  const base = useRef<PinchTransform>(IDENTITY);
  /** pointer positions when `base` was taken */
  const origin = useRef(new Map<number, Point>());
  /** transform the layer currently shows */
  const view = useRef<PinchTransform>(IDENTITY);
  /** transform when the first finger of the gesture landed */
  const started = useRef<PinchTransform | null>(null);
  const rect = useRef<DOMRect | null>(null);
  /** area box in area pixels */
  const area = useRef({ w: 0, h: 0 });
  /** content box: size plus its layout offset inside the layer */
  const box = useRef({ w: 0, h: 0, ox: 0, oy: 0 });
  /** the transform and pinch origin a native gesture started from */
  const native = useRef<{ t: PinchTransform; from: Point } | null>(null);
  /** set once the native source has fired; touches belong to it from then on */
  const nativeSeen = useRef(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const measure = () => {
    const root = rootRef.current;
    const child = layerRef.current?.firstElementChild as HTMLElement | null;
    if (!root || !child) return;
    area.current = { w: root.clientWidth, h: root.clientHeight };
    box.current = {
      w: child.offsetWidth,
      h: child.offsetHeight,
      ox: child.offsetLeft,
      oy: child.offsetTop,
    };
  };

  const apply = (t: PinchTransform) => {
    view.current = t;
    const { ox, oy } = box.current;
    if (layerRef.current)
      layerRef.current.style.transform = `translate3d(${t.x - ox * t.scale}px, ${t.y - oy * t.scale}px, 0) scale(${t.scale})`;
  };

  const clamp = (t: PinchTransform): PinchTransform => {
    const { w, h } = area.current;
    const scale = Math.min(Math.max(t.scale, min), max);
    const spanX = box.current.w * scale;
    const spanY = box.current.h * scale;
    return {
      scale,
      x: spanX <= w ? (w - spanX) / 2 : Math.min(0, Math.max(t.x, w - spanX)),
      y: spanY <= h ? (h - spanY) / 2 : Math.min(0, Math.max(t.y, h - spanY)),
    };
  };

  /** Move `from` to `to` while scaling about it. */
  const gesture = (
    from: Point,
    to: Point,
    scale: number,
    base: PinchTransform
  ): PinchTransform => {
    const ratio = scale / base.scale;
    return clamp({
      scale,
      x: to.x - (from.x - base.x) * ratio,
      y: to.y - (from.y - base.y) * ratio,
    });
  };

  /** Close the running gesture, reporting it when it moved. */
  const settle = () => {
    const from = started.current;
    started.current = null;
    rect.current = null;
    const now = view.current;
    if (from && (from.scale !== now.scale || from.x !== now.x || from.y !== now.y))
      commit.current?.(now);
  };

  /** Take the pointers and transform as they are now. */
  const rebase = () => {
    base.current = view.current;
    origin.current = new Map(pointers.current);
  };

  const update = () => {
    const ids = [...pointers.current.keys()];
    if (ids.length >= 2) {
      const [a0, b0] = ids.slice(0, 2).map((id) => origin.current.get(id)!);
      const [a, b] = ids.slice(0, 2).map((id) => pointers.current.get(id)!);
      const span = distance(a0, b0);
      if (span < 1) return;
      const scale = Math.min(
        Math.max((base.current.scale * distance(a, b)) / span, min),
        max
      );
      apply(gesture(midpoint(a0, b0), midpoint(a, b), scale, base.current));
      return;
    }
    if (ids.length === 1) {
      const p = pointers.current.get(ids[0])!;
      const p0 = origin.current.get(ids[0])!;
      apply(
        clamp({
          scale: base.current.scale,
          x: base.current.x + p.x - p0.x,
          y: base.current.y + p.y - p0.y,
        })
      );
    }
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (nativeSeen.current && e.pointerType !== "mouse") return;
    measure();
    const frame = (rect.current = e.currentTarget.getBoundingClientRect());
    if (!started.current) started.current = view.current;
    pointers.current.set(e.pointerId, {
      x: e.clientX - frame.left,
      y: e.clientY - frame.top,
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    rebase();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const frame = rect.current ?? e.currentTarget.getBoundingClientRect();
    pointers.current.set(e.pointerId, {
      x: e.clientX - frame.left,
      y: e.clientY - frame.top,
    });
    update();
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size) {
      rebase();
      return;
    }
    settle();
  };

  // for WebkitGTK
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return watchPinch(root, (pinch) => {
      nativeSeen.current = true;
      if (pinch.phase === "end") {
        native.current = null;
        settle();
        return;
      }
      measure();
      const frame = (rect.current = root.getBoundingClientRect());
      const to = { x: pinch.x - frame.left, y: pinch.y - frame.top };
      if (!native.current) {
        native.current = { t: view.current, from: to };
        started.current = view.current;
        return;
      }
      const { t, from } = native.current;
      apply(gesture(from, to, Math.min(Math.max(t.scale * pinch.scale, min), max), t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  // Center the content up front, and again whenever the area or the content box
  // changes size without a pointer being involved.
  useEffect(() => {
    const root = rootRef.current;
    const child = layerRef.current?.firstElementChild;
    if (!root) return;
    measure();
    apply(clamp(view.current));
    const observer = new ResizeObserver(() => {
      measure();
      if (pointers.current.size === 0) apply(clamp(view.current));
    });
    observer.observe(root);
    if (child) observer.observe(child);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden select-none touch-none ${className}`}
      onPointerDown={handedDown ?? onPointerDown}
      onPointerMove={handedMove ?? onPointerMove}
      onPointerUp={handedUp ?? onPointerEnd}
      onPointerCancel={handedCancel ?? onPointerEnd}
    >
      <div ref={layerRef} style={LAYER_STYLE}>
        {children}
      </div>
    </div>
  );
}
