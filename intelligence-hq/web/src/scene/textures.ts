// Signage and holographic panels drawn on canvas: no external fonts or images beyond the company logo.
import * as THREE from "three";

export const DISPLAY = "'Chakra Petch', 'Barlow Condensed', sans-serif";

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Text on a transparent or solid background. Holographic panels pass bg=null and a glow colour. */
export function textTexture(lines: { text: string; size: number; color: string; weight?: number }[],
  w = 1024, h = 256, bg: string | null = "#16213E", glow?: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  const total = lines.reduce((a, l) => a + l.size * 1.18, 0);
  let y = (h - total) / 2;
  g.textAlign = "center"; g.textBaseline = "top";
  for (const l of lines) {
    g.font = `${l.weight ?? 600} ${l.size}px ${DISPLAY}`;
    g.fillStyle = l.color;
    if (glow) { g.shadowColor = glow; g.shadowBlur = l.size * 0.35; }
    g.fillText(l.text, w / 2, y, w - 60);
    y += l.size * 1.18;
  }
  return finish(c);
}

/** Holographic screen: scanlines, a frame and corner ticks behind the text. */
export function holoTexture(lines: { text: string; size: number; color: string; weight?: number }[],
  w = 1024, h = 576, tint = "#22D3EE"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(10, 40, 70, 0.55)");
  grad.addColorStop(1, "rgba(5, 15, 40, 0.35)");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.045)";
  for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
  g.strokeStyle = tint; g.lineWidth = 4; g.globalAlpha = 0.9;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.lineWidth = 10;
  for (const [x, y, dx, dy] of [[10, 10, 1, 1], [w - 10, 10, -1, 1], [10, h - 10, 1, -1], [w - 10, h - 10, -1, -1]]) {
    g.beginPath(); g.moveTo(x, y + dy * 60); g.lineTo(x, y); g.lineTo(x + dx * 60, y); g.stroke();
  }
  g.globalAlpha = 1;
  const total = lines.reduce((a, l) => a + l.size * 1.2, 0);
  let y = (h - total) / 2;
  g.textAlign = "center"; g.textBaseline = "top";
  for (const l of lines) {
    g.font = `${l.weight ?? 600} ${l.size}px ${DISPLAY}`;
    g.shadowColor = l.color; g.shadowBlur = 18;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y, w - 80);
    y += l.size * 1.2;
  }
  return finish(c);
}

/** Floating building sign: real logo on a light plate, company name glowing beside it. */
export function signTexture(logo: HTMLImageElement | null): THREE.CanvasTexture {
  const w = 2048, h = 380;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  let x = 40;
  if (logo && logo.complete && logo.naturalWidth) {
    const lh = h - 70, lw = lh * (logo.naturalWidth / logo.naturalHeight);
    g.fillStyle = "#FFFFFF";
    g.shadowColor = "#7FD8FF"; g.shadowBlur = 40;
    g.fillRect(x, 35, lw + 30, lh);
    g.shadowBlur = 0;
    g.drawImage(logo, x + 15, 45, lw, lh - 20);
    x += lw + 90;
  }
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.shadowColor = "#FF5A3C"; g.shadowBlur = 30;
  g.fillStyle = "#FFFFFF"; g.font = `700 160px ${DISPLAY}`;
  g.fillText("STRAIGHT FLUSH", x, 200, w - x - 30);
  g.shadowColor = "#22D3EE"; g.shadowBlur = 24;
  g.fillStyle = "#BDF4FF"; g.font = `500 82px ${DISPLAY}`;
  g.fillText("Plumbing & Leak Detection", x, 315, w - x - 30);
  return finish(c);
}

/** Repeating stripe used to make water visibly flow through the glass pipes. */
export function flowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 8;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, "rgba(34,211,238,0.05)");
  grad.addColorStop(0.45, "rgba(34,211,238,0.15)");
  grad.addColorStop(0.5, "rgba(190,250,255,1)");
  grad.addColorStop(0.58, "rgba(34,211,238,0.2)");
  grad.addColorStop(1, "rgba(34,211,238,0.05)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
