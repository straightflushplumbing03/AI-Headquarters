// Signage drawn on canvas so the scene needs no external fonts or images beyond the company logo.
import * as THREE from "three";

const FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";

export function textTexture(lines: { text: string; size: number; color: string; weight?: number }[],
  w = 1024, h = 256, bg = "#16213E", align: CanvasTextAlign = "center"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const total = lines.reduce((a, l) => a + l.size * 1.15, 0);
  let y = (h - total) / 2;
  g.textAlign = align; g.textBaseline = "top";
  for (const l of lines) {
    g.font = `${l.weight ?? 600} ${l.size}px ${FONT}`;
    g.fillStyle = l.color;
    g.fillText(l.text, align === "center" ? w / 2 : 40, y, w - 60);
    y += l.size * 1.15;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Main building sign: real logo on the left, company name on the right. */
export function signTexture(logo: HTMLImageElement | null): THREE.CanvasTexture {
  const w = 2048, h = 360;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#16213E"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#D9432E"; g.fillRect(0, h - 18, w, 18);
  let x = 50;
  if (logo && logo.complete && logo.naturalWidth) {
    const lh = h - 90, lw = lh * (logo.naturalWidth / logo.naturalHeight);
    g.fillStyle = "#FFFFFF";
    g.fillRect(x - 14, 30, lw + 28, lh + 28);
    g.drawImage(logo, x, 44, lw, lh);
    x += lw + 70;
  }
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = "#FFFFFF"; g.font = `700 150px ${FONT}`;
  g.fillText("STRAIGHT FLUSH", x, 185, w - x - 40);
  g.fillStyle = "#C9D3E3"; g.font = `500 84px ${FONT}`;
  g.fillText("Plumbing & Leak Detection", x, 292, w - x - 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
