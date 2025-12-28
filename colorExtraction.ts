
import { Gradient, GradientStop } from './types';
import { generateId, srgbEncodedToOklch, oklchToHex, OKLCH, interpolateColor } from './utils';

// --- Types ---

export interface RawColor {
  hex: string;
  lab: { L: number; a: number; b: number };
}

export interface ExtractionResult {
  allColors: RawColor[]; 
  workingSet: string[];
}

// --- RGB / Color Helpers ---

const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0');
};

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

const getOklch = (hex: string) => {
    const rgb = hexToRgb(hex);
    return srgbEncodedToOklch({ r: rgb.r/255, g: rgb.g/255, b: rgb.b/255 });
};

// --- Improved Extraction Logic (Frequency + Distance) ---

const getColorDistance = (c1: {r:number, g:number, b:number}, c2: {r:number, g:number, b:number}) => {
    return Math.sqrt(
        Math.pow(c1.r - c2.r, 2) + 
        Math.pow(c1.g - c2.g, 2) + 
        Math.pow(c1.b - c2.b, 2)
    );
};

export const extractRawColors = async (imageSrc: string): Promise<ExtractionResult> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (!ctx) {
            resolve({ allColors: [], workingSet: [] });
            return;
        }

        // Resize to small dimension for performance (e.g., 150px)
        const scale = Math.min(1, 150 / Math.max(img.width, img.height));
        const w = Math.floor(img.width * scale);
        const h = Math.floor(img.height * scale);
        
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        
        // Frequency Map
        const colorCounts: Record<string, number> = {};
        
        // Sample pixels
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const a = data[i+3];
            
            // Skip transparent or very dark/white noise if possible, 
            // but we need to be careful not to exclude black/white images.
            if (a < 128) continue;

            // Quantize slightly to group similar colors (round to nearest 8)
            const qr = Math.round(r / 8) * 8;
            const qg = Math.round(g / 8) * 8;
            const qb = Math.round(b / 8) * 8;

            const key = `${qr},${qg},${qb}`;
            colorCounts[key] = (colorCounts[key] || 0) + 1;
        }

        // Convert to array and sort by frequency
        const sortedColors = Object.entries(colorCounts)
            .map(([key, count]) => {
                const [r, g, b] = key.split(',').map(Number);
                return { r, g, b, count, hex: rgbToHex(r, g, b) };
            })
            .sort((a, b) => b.count - a.count);

        // Select distinct colors
        const distinctColors: typeof sortedColors = [];
        const MIN_DIST = 40; // RGB Distance threshold

        for (const c of sortedColors) {
            let tooClose = false;
            for (const existing of distinctColors) {
                if (getColorDistance(c, existing) < MIN_DIST) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) {
                distinctColors.push(c);
            }
            if (distinctColors.length >= 10) break; 
        }

        // If we didn't get enough, lower threshold
        if (distinctColors.length < 5) {
             for (const c of sortedColors) {
                if (distinctColors.includes(c)) continue;
                let tooClose = false;
                for (const existing of distinctColors) {
                    if (getColorDistance(c, existing) < 20) {
                        tooClose = true;
                        break;
                    }
                }
                if (!tooClose) distinctColors.push(c);
                if (distinctColors.length >= 10) break;
            }
        }

        // Prioritize vibrancy? 
        // For now, frequency is safest to represent the image "look".
        // But we can sort the FINAL result by "interest" (e.g. saturation) so the UI shows nice colors first.
        const finalColors = distinctColors.sort((a, b) => {
             const satA = Math.max(a.r, a.g, a.b) - Math.min(a.r, a.g, a.b);
             const satB = Math.max(b.r, b.g, b.b) - Math.min(b.r, b.g, b.b);
             return satB - satA; // Vivid first
        });

        const resultRaw: RawColor[] = finalColors.map(c => ({
            hex: c.hex,
            lab: { L: 0, a: 0, b: 0 } // Dummy lab, we don't strictly need it for UI anymore
        }));

        resolve({
            allColors: resultRaw,
            workingSet: resultRaw.map(c => c.hex)
        });
    };
    img.onerror = () => {
        resolve({ allColors: [], workingSet: [] });
    };
    img.src = imageSrc;
  });
};

// --- Strict Gradient Generator ---

const createStop = (color: string, offset: number): GradientStop => ({
  id: generateId(),
  offset,
  color,
  opacity: 1
});

// Modify Lightness only (Strict Hue preservation)
const modifyLightness = (c: OKLCH, lDiff: number) => {
    return { 
        ...c, 
        L: Math.max(0.02, Math.min(0.98, c.L + lDiff)) 
    };
};

export const generateMassiveGradients = (inputHexes: string[]): Gradient[] => {
  if (inputHexes.length === 0) return [];

  const results: Gradient[] = [];
  const uniqueKeys = new Set<string>();

  const add = (type: 'linear'|'radial'|'conic', angle: number, stops: string[], center?: {x:number,y:number}) => {
      const key = stops.join('-');
      if (uniqueKeys.has(key)) return;
      uniqueKeys.add(key);

      results.push({
          type, 
          angle, 
          center: center || { x: 0.5, y: 0.5 },
          stops: stops.map((c, i) => createStop(c, i / (stops.length - 1))),
          radius: type === 'radial' ? 0.8 : undefined
      });
  };

  const colors = inputHexes.slice(0, 12); // Cap processing
  const baseOklch = colors.map(h => ({ hex: h, ...getOklch(h) }));

  // 1. Monochromatic (Strict) - High utility
  // We produce a Lighter and a Darker version of each input color
  baseOklch.forEach(c => {
      // Light Fade
      const light = oklchToHex(modifyLightness(c, 0.25));
      add('linear', 180, [c.hex, light]);
      add('linear', 135, [light, c.hex]);
      
      // Dark Fade
      const dark = oklchToHex(modifyLightness(c, -0.3));
      add('linear', 180, [c.hex, dark]);
      add('radial', 0, [c.hex, dark]);
  });

  // 2. Direct Pairs (Combinatorial)
  // Only mix colors that are actually in the input.
  for (let i = 0; i < colors.length; i++) {
      for (let j = 0; j < colors.length; j++) {
          if (i === j) continue;
          add('linear', 135, [colors[i], colors[j]]);
          add('linear', 90, [colors[i], colors[j]]);
          add('radial', 0, [colors[i], colors[j]]);
      }
  }

  // 3. Trios (If we have enough)
  if (colors.length >= 3) {
      for (let i = 0; i < colors.length; i++) {
          const c1 = colors[i];
          const c2 = colors[(i+1) % colors.length];
          const c3 = colors[(i+2) % colors.length];
          
          add('linear', 120, [c1, c2, c3]);
          add('conic', 0, [c1, c2, c3, c1]);
      }
  }

  // 4. Interpolated Smooth Pairs (Soft)
  // Create a midpoint that is mathematically between two colors to smooth the transition
  for (let i = 0; i < Math.min(colors.length, 5); i++) {
      for (let j = i + 1; j < Math.min(colors.length, 5); j++) {
          const c1 = colors[i];
          const c2 = colors[j];
          const mid = interpolateColor(c1, c2, 0.5);
          
          add('linear', 45, [c1, mid, c2]);
      }
  }

  // Shuffle slightly but prioritize the first generated ones (Monochromes & Pairs)
  // We want the user to see "Safe" options first.
  return results; 
};
