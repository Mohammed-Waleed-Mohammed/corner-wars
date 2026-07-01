// Shared steering primitive: move an actor toward a point, stopping at `contact`
// distance. Frame-rate independent (uses dt via speed). Returns true once within contact.

export interface Mover {
  x: number;
  y: number;
  speed: number;
}

export function approach(
  m: Mover,
  tx: number,
  ty: number,
  dt: number,
  contact: number,
  speed = m.speed, // override (e.g. Battle Frenzy)
): boolean {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= contact) return true;
  const step = speed * dt;
  if (step >= dist - contact) {
    const t = (dist - contact) / dist;
    m.x += dx * t;
    m.y += dy * t;
    return true;
  }
  m.x += (dx / dist) * step;
  m.y += (dy / dist) * step;
  return false;
}
