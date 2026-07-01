// Reusable canvas path builders. Each only builds a path; the caller fills/strokes.

export function hexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  pointyTop = true,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - (pointyTop ? 90 : 0));
    const px = cx + r * Math.cos(ang);
    const py = cy + r * Math.sin(ang);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
