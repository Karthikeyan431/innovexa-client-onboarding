// Canvas signature pad.
//
// Strokes are kept as normalised vector points (0–1 of the box), not as canvas
// pixels. That fixes the original prototype's bug where re-entering the review
// step (or rotating a phone) resized the canvas and silently erased the
// drawing while the form still believed it was signed. The bitmap is always
// re-rendered from the strokes, and the exported PNG is rendered fresh too.

interface Point { x: number; y: number; p: number }
type Stroke = Point[];

const INK = '#14213a';
const MIN_LENGTH_PX = 40; // anything shorter is a tap, not a signature

export class SignaturePad {
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private observer: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private onChange: () => void) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    // Keep iOS Safari from scrolling/zooming while signing.
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
  }

  /** Matches the bitmap to the displayed size × devicePixelRatio, then redraws. */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return; // hidden step; keep strokes
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.round(r.width * ratio);
    this.canvas.height = Math.round(r.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.redraw();
  }

  private point(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    // Pen pressure when available; mouse/touch report 0 or 0.5.
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, p };
  }

  private down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    if (this.cssW === 0) this.resize();
    this.canvas.setPointerCapture(e.pointerId);
    this.current = [this.point(e)];
    this.strokes.push(this.current);
    this.redraw();
  };

  private move = (e: PointerEvent) => {
    if (!this.current) return;
    e.preventDefault();
    // Coalesced events give smooth lines on high-frequency pens/touchscreens.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) this.current.push(this.point(ev));
    this.redraw();
  };

  private up = (e: PointerEvent) => {
    if (!this.current) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.current = null;
    this.onChange();
  };

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, ox = 0, oy = 0) {
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.strokes) {
      const pts = s.map((pt) => ({ x: pt.x * w - ox, y: pt.y * h - oy, p: pt.p }));
      const width = (pp: number) => (1.4 + pp * 2.2) * scale;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, width(pts[0].p) / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Quadratic curves through midpoints give a smooth, natural line.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const prevMid = i === 1 ? a : { x: (pts[i - 2].x + a.x) / 2, y: (pts[i - 2].y + a.y) / 2 };
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.lineWidth = width((a.p + b.p) / 2);
        ctx.beginPath();
        ctx.moveTo(prevMid.x, prevMid.y);
        ctx.quadraticCurveTo(a.x, a.y, i === pts.length - 1 ? b.x : mid.x, i === pts.length - 1 ? b.y : mid.y);
        ctx.stroke();
      }
    }
  }

  private redraw() {
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
    this.paint(this.ctx, this.cssW, this.cssH, 1);
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.redraw();
    this.onChange();
  }

  undo() {
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  /** Total drawn length in CSS pixels at the current box size. */
  private length(): number {
    const w = this.cssW || 600;
    const h = this.cssH || 180;
    let len = 0;
    for (const s of this.strokes) {
      for (let i = 1; i < s.length; i++) len += Math.hypot((s[i].x - s[i - 1].x) * w, (s[i].y - s[i - 1].y) * h);
    }
    return len;
  }

  isEmpty(): boolean {
    return this.strokes.length === 0 || this.length() < MIN_LENGTH_PX;
  }

  hasStrokes(): boolean {
    return this.strokes.length > 0;
  }

  /**
   * Renders the signature to a fresh transparent PNG, cropped to the ink with
   * padding. Returns null when there is no real signature, so callers can never
   * claim a signature was captured when it was not.
   */
  toPNG(): string | null {
    if (this.isEmpty()) return null;
    // Render at a fixed, high resolution independent of the screen.
    const aspect = (this.cssW || 600) / (this.cssH || 180);
    const H = 400;
    const W = Math.round(H * aspect);
    const scale = H / 180;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.strokes) for (const pt of s) {
      minX = Math.min(minX, pt.x * W); maxX = Math.max(maxX, pt.x * W);
      minY = Math.min(minY, pt.y * H); maxY = Math.max(maxY, pt.y * H);
    }
    const pad = 24 * scale / 2;
    const outW = Math.max(240, Math.round(maxX - minX + pad * 2));
    const outH = Math.max(96, Math.round(maxY - minY + pad * 2));
    const ox = minX - (outW - (maxX - minX)) / 2;
    const oy = minY - (outH - (maxY - minY)) / 2;

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d')!;
    this.paint(ctx, W, H, scale, ox, oy);
    const url = out.toDataURL('image/png');
    return url.startsWith('data:image/png;base64,') && url.length > 200 ? url : null;
  }

  toJSON(): Stroke[] {
    return this.strokes;
  }

  load(strokes: unknown) {
    if (!Array.isArray(strokes)) return;
    this.strokes = strokes
      .filter(Array.isArray)
      .map((s: unknown[]) => s.filter((p): p is Point => !!p && typeof (p as Point).x === 'number' && typeof (p as Point).y === 'number')
        .map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)), p: typeof p.p === 'number' ? p.p : 0.5 })))
      .filter((s) => s.length > 0)
      .slice(0, 200);
    this.redraw();
    this.onChange();
  }
}
