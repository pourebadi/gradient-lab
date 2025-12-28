
import React, { useState, useRef } from 'react';
import { Layer, Gradient, GradientStop } from '../../types';
import { interpolateColor, clamp } from '../../utils';
import { generateASE, generatePhotoshopJSX } from './adobeUtils';
import JSZip from 'jszip';
import { 
  Code2, 
  Image as ImageIcon, 
  PenTool, 
  Smartphone, 
  Copy, 
  Check, 
  Download, 
  FileJson, 
  Palette,
  Monitor,
  Instagram,
  Facebook,
  Linkedin,
  Type,
  FileCode,
  Package
} from 'lucide-react';

interface ExportPanelProps {
  layer: Layer;
}

type Destination = 'web' | 'figma' | 'adobe' | 'social';

// --- Generators ---

const getCSSGradient = (gradient: Gradient) => {
    const stops = [...gradient.stops].sort((a, b) => a.offset - b.offset)
      .map(s => {
          let color = s.color;
          if (s.opacity !== undefined && s.opacity < 1) {
              // Simple hex to rgba conversion for CSS
              const r = parseInt(color.slice(1, 3), 16);
              const g = parseInt(color.slice(3, 5), 16);
              const b = parseInt(color.slice(5, 7), 16);
              color = `rgba(${r}, ${g}, ${b}, ${s.opacity})`;
          }
          return `${color} ${Math.round(s.offset * 100)}%`;
      })
      .join(', ');
    
    if (gradient.type === 'linear') return `linear-gradient(${gradient.angle}deg, ${stops})`;
    if (gradient.type === 'radial') return `radial-gradient(circle at ${Math.round(gradient.center.x*100)}% ${Math.round(gradient.center.y*100)}%, ${stops})`;
    if (gradient.type === 'conic') return `conic-gradient(from ${gradient.angle}deg at ${Math.round(gradient.center.x*100)}% ${Math.round(gradient.center.y*100)}%, ${stops})`;
    return '';
};

const getJSONTokens = (gradient: Gradient) => {
    return JSON.stringify({
        type: gradient.type,
        angle: gradient.angle,
        center: gradient.center,
        stops: gradient.stops.map(s => ({
            color: s.color,
            offset: s.offset,
            opacity: s.opacity
        }))
    }, null, 2);
};

const getSVG = (gradient: Gradient, width: number, height: number): string | null => {
    // For Conic gradients, we use a foreignObject workaround since SVG 1.1 doesn't support them natively.
    if (gradient.type === 'conic') {
         const css = getCSSGradient(gradient);
         return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:${css};"></div>
    </foreignObject>
</svg>`.trim();
    }

    const stops = [...gradient.stops].sort((a, b) => a.offset - b.offset);
    const id = "grad_" + Math.random().toString(36).substr(2, 9);
    
    let defs = '';
    if (gradient.type === 'linear') {
        const rad = (gradient.angle - 90) * (Math.PI / 180);
        const x1 = 50 - 50 * Math.cos(rad);
        const y1 = 50 - 50 * Math.sin(rad);
        const x2 = 50 + 50 * Math.cos(rad);
        const y2 = 50 + 50 * Math.sin(rad);
        
        defs = `
        <linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
            ${stops.map(s => `<stop offset="${s.offset * 100}%" stop-color="${s.color}" stop-opacity="${s.opacity ?? 1}" />`).join('')}
        </linearGradient>`;
    } else if (gradient.type === 'radial') {
        defs = `
        <radialGradient id="${id}" cx="${gradient.center.x * 100}%" cy="${gradient.center.y * 100}%" r="${(gradient.radius || 0.5) * 100}%">
             ${stops.map(s => `<stop offset="${s.offset * 100}%" stop-color="${s.color}" stop-opacity="${s.opacity ?? 1}" />`).join('')}
        </radialGradient>`;
    }

    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${defs}</defs>
    <rect width="100%" height="100%" fill="url(#${id})" />
</svg>`.trim();
};

const getGradientStepsText = (gradient: Gradient) => {
    const typeStr = gradient.type.charAt(0).toUpperCase() + gradient.type.slice(1);
    const angleStr = gradient.type === 'linear' || gradient.type === 'conic' ? `Angle: ${gradient.angle}°` : 'Angle: N/A';
    
    let stopsStr = gradient.stops
        .sort((a, b) => a.offset - b.offset)
        .map(s => {
            const pct = Math.round(s.offset * 100) + '%';
            const hex = s.color.toUpperCase();
            const op = s.opacity !== undefined ? `(Opacity ${Math.round(s.opacity * 100)}%)` : '';
            return `${pct.padEnd(6)} ${hex}  ${op}`;
        })
        .join('\n');
        
    return `Type: ${typeStr}\n${angleStr}\n\nStops:\n${stopsStr}`;
};

// Canvas Renderer for PNG/Blob
const renderToCanvas = async (gradient: Gradient, width: number, height: number): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // Draw
    if (gradient.type === 'linear') {
        const rad = (gradient.angle - 90) * (Math.PI / 180);
        const length = Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad));
        const cx = width / 2;
        const cy = height / 2;
        const x1 = cx - Math.cos(rad) * length / 2;
        const y1 = cy - Math.sin(rad) * length / 2;
        const x2 = cx + Math.cos(rad) * length / 2;
        const y2 = cy + Math.sin(rad) * length / 2;
        
        const gr = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.stops.forEach(s => gr.addColorStop(s.offset, s.color));
        ctx.fillStyle = gr;
    } else if (gradient.type === 'radial') {
        const cx = gradient.center.x * width;
        const cy = gradient.center.y * height;
        const r = (gradient.radius || 0.5) * Math.max(width, height);
        
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.stops.forEach(s => gr.addColorStop(s.offset, s.color));
        ctx.fillStyle = gr;
    } else if (gradient.type === 'conic') {
        const cx = gradient.center.x * width;
        const cy = gradient.center.y * height;
        const gr = ctx.createConicGradient((gradient.angle * Math.PI) / 180, cx, cy);
        gradient.stops.forEach(s => gr.addColorStop(s.offset, s.color));
        ctx.fillStyle = gr;
    }

    ctx.fillRect(0, 0, width, height);
    return canvas;
};

const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = name;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// --- Components ---

const ActionRow = ({ 
    icon: Icon, 
    label, 
    sublabel, 
    onClick, 
    onCopy,
    secondary,
    loading = false,
    disabled = false
}: { 
    icon?: any; 
    label: string; 
    sublabel?: string; 
    onClick?: () => void; 
    onCopy?: string;
    secondary?: boolean;
    loading?: boolean;
    disabled?: boolean;
}) => {
    const [copied, setCopied] = useState(false);

    const handleClick = async () => {
        if (disabled) return;
        if (onCopy) {
            try {
                await navigator.clipboard.writeText(onCopy);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch {}
        }
        if (onClick) onClick();
    };

    return (
        <button 
            onClick={handleClick}
            disabled={disabled}
            className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all border ${
                secondary 
                ? 'bg-transparent border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5' 
                : 'bg-zinc-50 dark:bg-white/5 border-transparent hover:bg-zinc-100 dark:hover:bg-white/10'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            <div className={`p-2 rounded-lg ${secondary ? 'bg-zinc-100 dark:bg-white/10 text-zinc-500' : 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'}`}>
                {loading ? <div className="animate-spin w-[18px] h-[18px] border-2 border-current border-t-transparent rounded-full" /> : (Icon ? <Icon size={18} /> : (copied ? <Check size={18} /> : <Copy size={18} />))}
            </div>
            <div className="flex-1">
                <div className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    {label}
                    {copied && <span className="text-[10px] bg-green-500 text-white px-1.5 rounded-full">Copied!</span>}
                </div>
                {sublabel && <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{sublabel}</div>}
            </div>
            {onCopy && !Icon && (
                <div className="text-zinc-400">
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                </div>
            )}
        </button>
    );
};

export const ExportPanel: React.FC<ExportPanelProps> = ({ layer }) => {
  const [activeTab, setActiveTab] = useState<Destination>('web');
  const [isPackaging, setIsPackaging] = useState(false);
  
  const gradient = typeof layer.fill === 'string' 
    ? { type: 'linear', angle: 0, stops: [{ offset:0, color: layer.fill }, { offset:1, color: layer.fill }], center: {x:0.5, y:0.5} } as Gradient 
    : layer.fill as Gradient;

  const tabs = [
      { id: 'web', label: 'Web', icon: Code2 },
      { id: 'adobe', label: 'Adobe', icon: PenTool },
      { id: 'figma', label: 'Figma', icon: ImageIcon },
      { id: 'social', label: 'Social', icon: Smartphone },
  ];

  // --- Handlers ---

  const handleDownloadPNG = async (scale: number = 1, overrideW?: number, overrideH?: number, suffix: string = '') => {
      const w = overrideW || layer.width;
      const h = overrideH || layer.height;
      const canvas = await renderToCanvas(gradient, w * scale, h * scale);
      canvas.toBlob(blob => {
          if (blob) downloadBlob(blob, `gradient-${suffix || 'export'}.png`);
      });
  };

  const handleDownloadSVG = () => {
      const svg = getSVG(gradient, layer.width, layer.height);
      if (!svg) return;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      downloadBlob(blob, 'gradient.svg');
  };

  const handleDownloadASE = () => {
      const blob = generateASE(gradient.stops);
      downloadBlob(blob, 'palette.ase');
  };

  const handleDownloadJSX = () => {
      const script = generatePhotoshopJSX(gradient);
      const blob = new Blob([script], { type: 'text/javascript' });
      downloadBlob(blob, 'import-gradient.jsx');
  };

  const handleDownloadPackage = async () => {
      setIsPackaging(true);
      try {
          const zip = new JSZip();
          const folder = zip.folder("Adobe Gradient Package");

          // 1. PNG Render
          const canvas = await renderToCanvas(gradient, layer.width, layer.height);
          const pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve));
          if (pngBlob && folder) folder.file("gradient.png", pngBlob);

          // 2. SVG (Supports all types now via fallback)
          const svg = getSVG(gradient, layer.width, layer.height);
          if (svg && folder) folder.file("gradient.svg", svg);

          // 3. ASE Palette
          const aseBlob = generateASE(gradient.stops);
          if (folder) folder.file("swatches.ase", aseBlob);

          // 4. JSX Script
          const jsx = generatePhotoshopJSX(gradient);
          if (folder) folder.file("photoshop-importer.jsx", jsx);

          // 5. Steps Text
          const steps = getGradientStepsText(gradient);
          if (folder) folder.file("gradient-steps.txt", steps);

          // Generate Zip
          const content = await zip.generateAsync({ type: "blob" });
          downloadBlob(content, "adobe-gradient-package.zip");

      } catch (err) {
          console.error("Failed to zip", err);
      } finally {
          setIsPackaging(false);
      }
  };

  const handleCopyPalette = async () => {
      const colors = gradient.stops.map(s => s.color).join(', ');
      await navigator.clipboard.writeText(colors);
  };

  return (
    <div className="flex flex-col h-full w-[400px] max-h-[500px]">
        {/* Header Tabs */}
        <div className="flex border-b border-zinc-100 dark:border-white/10 px-2 pt-2">
            {tabs.map(t => (
                <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as Destination)}
                    className={`flex-1 flex flex-col items-center gap-1.5 pb-2 border-b-2 transition-colors ${
                        activeTab === t.id 
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                        : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                    }`}
                >
                    <t.icon size={18} />
                    <span className="text-[10px] font-bold uppercase tracking-wide">{t.label}</span>
                </button>
            ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
            
            {activeTab === 'web' && (
                <>
                    <div className="space-y-2">
                        <div className="flex justify-between items-end">
                            <span className="text-xs font-bold text-zinc-500 uppercase">CSS Background</span>
                        </div>
                        <div className="p-3 bg-zinc-100 dark:bg-black/30 rounded-xl font-mono text-[10px] text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/5 break-all">
                             {getCSSGradient(gradient)}
                        </div>
                        <ActionRow 
                            label="Copy CSS" 
                            sublabel="Standard CSS gradient syntax"
                            onCopy={getCSSGradient(gradient)} 
                            icon={Code2}
                        />
                    </div>

                    <div className="space-y-2">
                         <span className="text-xs font-bold text-zinc-500 uppercase">Tokens</span>
                         <ActionRow 
                            label="Copy JSON Tokens" 
                            sublabel="For Design Systems / JS"
                            onCopy={getJSONTokens(gradient)} 
                            icon={FileJson}
                            secondary
                        />
                    </div>
                </>
            )}

            {activeTab === 'figma' && (
                <>
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-500/10 mb-4">
                        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                            <strong>Quick Tip:</strong> Figma doesn't support direct gradient imports yet. 
                            We recommend pasting the palette or using a high-res image.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <span className="text-xs font-bold text-zinc-500 uppercase">Image Assets</span>
                        <div className="grid grid-cols-3 gap-2">
                             <button onClick={() => handleDownloadPNG(1, undefined, undefined, '@1x')} className="py-2 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-xs font-bold transition-colors">PNG @1x</button>
                             <button onClick={() => handleDownloadPNG(2, undefined, undefined, '@2x')} className="py-2 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-xs font-bold transition-colors">PNG @2x</button>
                             <button onClick={() => handleDownloadPNG(3, undefined, undefined, '@3x')} className="py-2 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-xs font-bold transition-colors">PNG @3x</button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <span className="text-xs font-bold text-zinc-500 uppercase">Recreate in Figma</span>
                        <ActionRow 
                            label="Copy Color Palette" 
                            sublabel="HEX codes to paste into linear-gradient"
                            icon={Palette}
                            onClick={handleCopyPalette}
                            onCopy={gradient.stops.map(s => s.color).join(', ')}
                            secondary
                        />
                    </div>
                </>
            )}

            {activeTab === 'adobe' && (
                <>
                    {/* Primary Package Download */}
                    <div className="p-4 bg-zinc-900 dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/10 mb-2">
                        <div className="flex items-start gap-4 mb-4">
                            <div className="p-3 bg-blue-600 rounded-xl text-white">
                                <Package size={24} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white dark:text-white">Adobe Package</h3>
                                <p className="text-[11px] text-zinc-400 mt-1 leading-tight">
                                    Includes PNG, SVG, ASE Swatches, and Photoshop Script in one ZIP.
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={handleDownloadPackage}
                            disabled={isPackaging}
                            className="w-full py-2 bg-white text-zinc-900 rounded-lg text-xs font-bold hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2"
                        >
                            {isPackaging ? <div className="animate-spin w-3 h-3 border-2 border-zinc-900 border-t-transparent rounded-full" /> : <Download size={14} />}
                            Download ZIP Bundle
                        </button>
                    </div>

                    <div className="h-px bg-zinc-100 dark:bg-white/10 w-full" />

                    <div className="space-y-2">
                        <span className="text-xs font-bold text-zinc-500 uppercase">Assets</span>
                        <div className="grid grid-cols-2 gap-2">
                            <ActionRow 
                                label="Swatches" 
                                sublabel=".ASE File"
                                icon={Palette}
                                onClick={handleDownloadASE}
                                secondary
                            />
                            <ActionRow 
                                label="Script" 
                                sublabel=".JSX File"
                                icon={FileCode}
                                onClick={handleDownloadJSX}
                                secondary
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                             <ActionRow 
                                label="Image" 
                                sublabel="Transparent PNG"
                                icon={ImageIcon}
                                onClick={() => handleDownloadPNG(1)}
                                secondary
                            />
                            <ActionRow 
                                label="Vector" 
                                sublabel="SVG"
                                icon={PenTool}
                                onClick={handleDownloadSVG}
                                secondary
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                         <span className="text-xs font-bold text-zinc-500 uppercase">Manual Recreation</span>
                         <ActionRow 
                            label="Copy Gradient Steps" 
                            sublabel="Text snippet with positions & hex codes"
                            icon={Type}
                            onCopy={getGradientStepsText(gradient)}
                            secondary
                        />
                    </div>
                </>
            )}

            {activeTab === 'social' && (
                <>
                    <div className="space-y-3">
                        <span className="text-xs font-bold text-zinc-500 uppercase">Quick Export</span>
                        
                        <ActionRow 
                            label="Instagram Story / Reels" 
                            sublabel="1080 x 1920 • 9:16"
                            icon={Smartphone}
                            onClick={() => handleDownloadPNG(1, 1080, 1920, 'story')}
                        />
                         <ActionRow 
                            label="Social Post" 
                            sublabel="1080 x 1080 • 1:1"
                            icon={Instagram}
                            onClick={() => handleDownloadPNG(1, 1080, 1080, 'post')}
                        />
                        <ActionRow 
                            label="Cover / Banner" 
                            sublabel="1500 x 500 • 3:1"
                            icon={Monitor}
                            onClick={() => handleDownloadPNG(1, 1500, 500, 'cover')}
                        />
                    </div>
                </>
            )}
        </div>
    </div>
  );
};
