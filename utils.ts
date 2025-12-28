
import { Vec2, Viewport, Gradient, GradientStop } from './types';

export const generateId = () => Math.random().toString(36).substr(2, 9);

export const screenToCanvas = (
  screenPos: Vec2,
  viewport: Viewport
): Vec2 => {
  return {
    x: (screenPos.x - viewport.x) / viewport.zoom,
    y: (screenPos.y - viewport.y) / viewport.zoom,
  };
};

export const canvasToScreen = (
  canvasPos: Vec2,
  viewport: Viewport
): Vec2 => {
  return {
    x: canvasPos.x * viewport.zoom + viewport.x,
    y: canvasPos.y * viewport.zoom + viewport.y,
  };
};

export const clamp = (num: number, min: number, max: number) =>
  Math.min(Math.max(num, min), max);

export const degreesToRadians = (deg: number) => (deg * Math.PI) / 180;

export const snapToGrid = (value: number, gridSize: number = 8) => {
  return Math.round(value / gridSize) * gridSize;
};

// Helper to calculate linear gradient coords from angle
export const getGradientCoords = (angleDeg: number) => {
  const angleRad = degreesToRadians(angleDeg - 90); 
  const x1 = 0.5 - 0.5 * Math.cos(angleRad);
  const y1 = 0.5 - 0.5 * Math.sin(angleRad);
  const x2 = 0.5 + 0.5 * Math.cos(angleRad);
  const y2 = 0.5 + 0.5 * Math.sin(angleRad);
  return { x1, y1, x2, y2 };
};

export const getLocalPoint = (
  screenPos: Vec2,
  viewport: Viewport,
  layer: { x: number; y: number; width: number; height: number; rotation: number }
): Vec2 => {
  const cp = screenToCanvas(screenPos, viewport);
  // Translate to layer origin (top-left)
  const dx = cp.x - layer.x;
  const dy = cp.y - layer.y;
  
  // Rotate around top-left (0,0 of the layer local space)
  const rad = -degreesToRadians(layer.rotation);
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  
  // Normalize
  return {
    x: lx / layer.width,
    y: ly / layer.height
  };
};

// Robust hex interpolation supporting 6 and 8 digit hex codes
export const interpolateColor = (color1: string, color2: string, factor: number = 0.5): string => {
  const parseHex = (c: string) => {
      // Normalize to 6 or 8 digits
      const hex = c.replace('#', '');
      let r = 0, g = 0, b = 0, a = 1;
      
      if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16);
          g = parseInt(hex[1] + hex[1], 16);
          b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
      } else if (hex.length === 8) {
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
          a = parseInt(hex.substring(6, 8), 16) / 255;
      }
      return { r, g, b, a };
  };

  const c1 = parseHex(color1);
  const c2 = parseHex(color2);

  const r = Math.round(c1.r + (c2.r - c1.r) * factor);
  const g = Math.round(c1.g + (c2.g - c1.g) * factor);
  const b = Math.round(c1.b + (c2.b - c1.b) * factor);
  const a = c1.a + (c2.a - c1.a) * factor;

  const toHex = (n: number) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
  
  // If both were opaque (or near opaque), return 6 digit, otherwise 8 digit
  if (a >= 0.999) {
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } else {
      return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(Math.round(a * 255))}`;
  }
};

// Calculate t (0-1) on a gradient line given a local point
export const getGradientT = (mx: number, my: number, gradient: Gradient, layerWidth: number, layerHeight: number) => {
    // Basic Geometry for Projection
    const center = gradient.center;
    let radiusPos = { x: 0.5, y: 1 }; // Default
    if (gradient.radius !== undefined) {
         const rad = degreesToRadians(gradient.angle - 90);
         radiusPos = { 
             x: center.x + gradient.radius * Math.cos(rad), 
             y: center.y + gradient.radius * Math.sin(rad) 
         };
    }

    if (gradient.type === 'conic') {
         const dx = mx - center.x * layerWidth;
         const dy = my - center.y * layerHeight;
         let angleRad = Math.atan2(dy, dx); 
         let angleDeg = (angleRad * 180 / Math.PI) + 90; 
         angleDeg = (angleDeg + 360) % 360; 
         let relativeDeg = angleDeg - gradient.angle;
         relativeDeg = (relativeDeg + 360) % 360;
         return relativeDeg / 360;
    }

    // Determine Start/End Points in Pixels
    let ax, ay, bx, by;
    if (gradient.type === 'radial') {
        ax = center.x * layerWidth;
        ay = center.y * layerHeight;
        bx = radiusPos.x * layerWidth;
        by = radiusPos.y * layerHeight;
    } else {
        // Linear
        let start = gradient.start;
        let end = gradient.end;
        if (!start || !end) {
             const coords = getGradientCoords(gradient.angle);
             start = { x: coords.x1, y: coords.y1 };
             end = { x: coords.x2, y: coords.y2 };
        }
        ax = start.x * layerWidth;
        ay = start.y * layerHeight;
        bx = end.x * layerWidth;
        by = end.y * layerHeight;
    }
    
    // Project Point onto Vector AB
    const abx = bx - ax;
    const aby = by - ay;
    const apx = mx - ax;
    const apy = my - ay;
    
    const lenSq = abx*abx + aby*aby;
    if (lenSq === 0) return 0;
    
    const t = (apx * abx + apy * aby) / lenSq;
    return Math.max(0, Math.min(1, t)); // Clamp 0-1
};

// --- OKLCH COLOR MATH (Björn Ottosson / CSS Color 4) ---

const EPS = 1e-10;

export type RGB = { r: number; g: number; b: number }; // 0..1
export type OKLab = { L: number; a: number; b: number }; 
export type OKLCH = { L: number; C: number; H: number };

function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }
function cbrt(x: number): number { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3); }

// sRGB Transfer Functions
export function srgbToLinear(u: number): number {
  if (u <= 0.04045) return u / 12.92;
  return Math.pow((u + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(u: number): number {
  if (u <= 0.0031308) return 12.92 * u;
  return 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
}

// Linear sRGB -> XYZ (D65)
export function linearSrgbToXyz(rgbLin: RGB): { X: number; Y: number; Z: number } {
  const r = rgbLin.r, g = rgbLin.g, b = rgbLin.b;
  return {
    X: 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    Y: 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    Z: 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  };
}

// XYZ (D65) -> Linear sRGB
export function xyzToLinearSrgb(xyz: { X: number; Y: number; Z: number }): RGB {
  const X = xyz.X, Y = xyz.Y, Z = xyz.Z;
  return {
    r:  3.2409699419 * X - 1.5373831776 * Y - 0.4986107603 * Z,
    g: -0.9692436363 * X + 1.8759675015 * Y + 0.0415550574 * Z,
    b:  0.0556300797 * X - 0.2039769589 * Y + 1.0569715142 * Z,
  };
}

// XYZ <-> OKLab
export function xyzToOklab(xyz: { X: number; Y: number; Z: number }): OKLab {
  const X = xyz.X, Y = xyz.Y, Z = xyz.Z;
  const l = 0.8189330101 * X + 0.3618667424 * Y - 0.1288597137 * Z;
  const m = 0.0329845436 * X + 0.9293118715 * Y + 0.0361456387 * Z;
  const s = 0.0482003018 * X + 0.2643662691 * Y + 0.6338517070 * Z;
  const l_ = cbrt(l);
  const m_ = cbrt(m);
  const s_ = cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

export function oklabToXyz(lab: OKLab): { X: number; Y: number; Z: number } {
  const L = lab.L, a = lab.a, b = lab.b;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    X:  1.2270138511 * l - 0.5577999807 * m + 0.2812561490 * s,
    Y: -0.0405801784 * l + 1.1122568696 * m - 0.0716766787 * s,
    Z: -0.0763812845 * l - 0.4214819784 * m + 1.5861632204 * s,
  };
}

// OKLab <-> OKLCH
export function oklabToOklch(lab: OKLab): OKLCH {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let H = 0;
  if (C > EPS) {
    H = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    if (H < 0) H += 360;
  }
  return { L: lab.L, C, H };
}

export function oklchToOklab(lch: OKLCH): OKLab {
  const hRad = (lch.H * Math.PI) / 180;
  return {
    L: lch.L,
    a: lch.C * Math.cos(hRad),
    b: lch.C * Math.sin(hRad),
  };
}

// Top-level Converters
export function srgbEncodedToOklch(rgb: RGB): OKLCH {
  const lin: RGB = {
    r: srgbToLinear(rgb.r),
    g: srgbToLinear(rgb.g),
    b: srgbToLinear(rgb.b),
  };
  const xyz = linearSrgbToXyz(lin);
  const lab = xyzToOklab(xyz);
  return oklabToOklch(lab);
}

export function oklchToSrgbEncoded(lch: OKLCH): RGB {
  const lab = oklchToOklab(lch);
  const xyz = oklabToXyz(lab);
  const lin = xyzToLinearSrgb(xyz);
  return {
    r: linearToSrgb(lin.r),
    g: linearToSrgb(lin.g),
    b: linearToSrgb(lin.b),
  };
}

export function isInGamutSrgbEncoded(rgb: RGB): boolean {
  const e = 0.00005;
  return rgb.r >= -e && rgb.r <= 1+e && 
         rgb.g >= -e && rgb.g <= 1+e && 
         rgb.b >= -e && rgb.b <= 1+e;
}

// Gamut Map: Reduce Chroma until it fits sRGB
export function clampOklchToSrgbGamut(lch: OKLCH, maxIter = 20): OKLCH {
  const encoded = oklchToSrgbEncoded(lch);
  if (isInGamutSrgbEncoded(encoded)) return lch;

  let lo = 0;
  let hi = lch.C;
  let best = 0;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const test: OKLCH = { L: lch.L, C: mid, H: lch.H };
    const rgb = oklchToSrgbEncoded(test);

    if (isInGamutSrgbEncoded(rgb)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return { ...lch, C: best };
}

export function oklchToHex(lch: OKLCH, alpha: number = 1): string {
    const clamped = clampOklchToSrgbGamut(lch);
    const rgb = oklchToSrgbEncoded(clamped);
    const r = Math.round(clamp01(rgb.r) * 255);
    const g = Math.round(clamp01(rgb.g) * 255);
    const b = Math.round(clamp01(rgb.b) * 255);
    
    const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

    if (alpha >= 0.999) return hex;
    const aVal = Math.round(clamp01(alpha) * 255);
    return `${hex}${toHex(aVal)}`;
}

// Helper: Hex String to RGB Struct (0..1)
function hexToRgbStruct(hex: string): RGB {
    const h = hex.replace('#', '');
    let r = 0, g = 0, b = 0;
    if (h.length === 3) {
        r = parseInt(h[0]+h[0], 16) / 255;
        g = parseInt(h[1]+h[1], 16) / 255;
        b = parseInt(h[2]+h[2], 16) / 255;
    } else {
        r = parseInt(h.substring(0, 2), 16) / 255;
        g = parseInt(h.substring(2, 4), 16) / 255;
        b = parseInt(h.substring(4, 6), 16) / 255;
    }
    return { r, g, b };
}

// --- Rebuilt Anti-Banding / Smoothing (Linear RGB Interpolation) ---
// This avoids the "Gray Dead Zone" of sRGB without shifting hue like OKLCH can.
// It also strictly preserves the original colors at their stops.

export const fixGradientBanding = (stops: GradientStop[]): GradientStop[] => {
    // 1. Sort copies of stops to ensure correct processing order
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    if (sorted.length < 2) return stops;

    const result: GradientStop[] = [];
    const MIN_OFFSET_DIFF = 0.005; // 0.5% threshold for "Hard Edge"

    for (let i = 0; i < sorted.length - 1; i++) {
        const start = sorted[i];
        const end = sorted[i+1];

        // Always add the start stop
        result.push(start);

        const range = end.offset - start.offset;

        // SKIP smoothing if stops are too close (Hard Edge Preservation)
        if (range < MIN_OFFSET_DIFF) continue;

        // Convert to Linear RGB
        const rgb1 = hexToRgbStruct(start.color);
        const rgb2 = hexToRgbStruct(end.color);
        
        const lin1 = { r: srgbToLinear(rgb1.r), g: srgbToLinear(rgb1.g), b: srgbToLinear(rgb1.b) };
        const lin2 = { r: srgbToLinear(rgb2.r), g: srgbToLinear(rgb2.g), b: srgbToLinear(rgb2.b) };

        // Check distance to see if we even need smoothing
        const dist = Math.abs(rgb1.r - rgb2.r) + Math.abs(rgb1.g - rgb2.g) + Math.abs(rgb1.b - rgb2.b);
        if (dist < 0.05) continue; // Too similar to need steps

        // Use fixed 8 steps for standard smoothing. 
        // We do linear interpolation in Linear Light space to remove dark bands.
        const steps = 8;

        for (let k = 1; k < steps; k++) {
            const t = k / steps; 

            // Linear Interpolation in Linear Space
            const rLin = lin1.r + (lin2.r - lin1.r) * t;
            const gLin = lin1.g + (lin2.g - lin1.g) * t;
            const bLin = lin1.b + (lin2.b - lin1.b) * t;

            // Convert back to sRGB (Gamma Corrected)
            const r = linearToSrgb(rLin);
            const g = linearToSrgb(gLin);
            const b = linearToSrgb(bLin);

            const rHex = Math.round(clamp01(r) * 255).toString(16).padStart(2, '0').toUpperCase();
            const gHex = Math.round(clamp01(g) * 255).toString(16).padStart(2, '0').toUpperCase();
            const bHex = Math.round(clamp01(b) * 255).toString(16).padStart(2, '0').toUpperCase();

            const hex = `#${rHex}${gHex}${bHex}`;
            const opacity = start.opacity + (end.opacity - start.opacity) * t;

            result.push({
                id: generateId(),
                offset: start.offset + range * t,
                color: hex,
                opacity
            });
        }
    }

    // Always add the final stop
    result.push(sorted[sorted.length - 1]);

    return result;
};
