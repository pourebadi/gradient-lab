
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { 
    formatHex, 
    converter, 
    parse 
} from 'https://esm.sh/culori@3.3.0';
import { useStore } from '../../store';
import { 
    srgbEncodedToOklch, 
    oklchToHex, 
    oklchToSrgbEncoded,
    clampOklchToSrgbGamut,
    OKLCH
} from '../../utils';

// --- Types ---
type ColorMode = 'HEX' | 'OKLCH' | 'HSL';

interface ColorPickerProps {
    color: string;
    onChange: (color: string) => void;
}

// NOTE: OKLCH Math functions have been moved to utils.ts to be shared 
// with the gradient smoothing algorithm, preventing duplication and errors.

// --- Converters (Culori kept for HSL/HSV standard) ---
const toHsl = converter('hsl');
const toHsv = converter('hsv');

// --- Helpers ---

const parseColorToState = (colorStr: string) => {
    const parsed = parse(colorStr) || { mode: 'rgb', r: 0, g: 0, b: 0, alpha: 1 };
    const alpha = parsed.alpha ?? 1;
    const opaque = { ...parsed, alpha: 1 };
    
    const hsv = toHsv(opaque);
    const hsl = toHsl(opaque);
    
    // OKLCH - Use our manual robust converter
    const r = typeof parsed.r === 'number' ? parsed.r : 0;
    const g = typeof parsed.g === 'number' ? parsed.g : 0;
    const b = typeof parsed.b === 'number' ? parsed.b : 0;
    const ok = srgbEncodedToOklch({ r, g, b });

    return {
        hsv: { h: hsv.h ?? 0, s: hsv.s ?? 0, v: hsv.v ?? 0 },
        hsl: { h: hsl.h ?? 0, s: hsl.s ?? 0, l: hsl.l ?? 0 },
        oklch: { l: ok.L, c: ok.C, h: ok.H },
        alpha
    };
};

// --- Helper Components ---

const SaturationBrightnessBox = ({ hue, saturation, brightness, onChange }: { hue: number, saturation: number, brightness: number, onChange: (s: number, b: number) => void }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);

    const handleMove = useCallback((e: PointerEvent | React.PointerEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        onChange(x, 1 - y);
    }, [onChange]);

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation(); 
        containerRef.current?.setPointerCapture(e.pointerId);
        isDragging.current = true;
        handleMove(e);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (isDragging.current) {
            e.stopPropagation();
            handleMove(e);
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (isDragging.current) {
            e.stopPropagation();
            isDragging.current = false;
            containerRef.current?.releasePointerCapture(e.pointerId);
        }
    };

    const bgColor = formatHex({ mode: 'hsv', h: hue, s: 1, v: 1, alpha: 1 });

    return (
        <div 
            ref={containerRef}
            className="w-full h-28 rounded-lg relative overflow-hidden cursor-crosshair shadow-inner border border-zinc-700/50 mb-2 touch-none"
            style={{ backgroundColor: bgColor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #fff, transparent)' }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000, transparent)' }} />
            
            <div 
                className="absolute w-4 h-4 rounded-full border-2 border-white shadow-[0_2px_4px_rgba(0,0,0,0.5)] pointer-events-none transform -translate-x-1/2 -translate-y-1/2 ring-1 ring-black/20"
                style={{ 
                    left: `${saturation * 100}%`, 
                    top: `${(1 - brightness) * 100}%`,
                    backgroundColor: formatHex({ mode: 'hsv', h: hue, s: saturation, v: brightness, alpha: 1 })
                }} 
            />
        </div>
    );
};

const Slider = ({ 
    label, 
    value, 
    min, 
    max, 
    step = 0.01, 
    onChange, 
    trackBackground, 
    checkered = false,
    thumbColor,
    disabled = false,
    displayValue
}: { 
    label?: string; 
    value: number; 
    min: number; 
    max: number; 
    step?: number; 
    onChange: (val: number) => void; 
    trackBackground: string;
    checkered?: boolean;
    thumbColor?: string;
    disabled?: boolean;
    displayValue?: string;
}) => {
    const stopPropagation = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

    return (
        <div 
            className={`flex flex-col gap-1 mb-1.5 ${disabled ? 'opacity-50 grayscale pointer-events-none' : ''}`} 
            onPointerDown={stopPropagation} 
            onMouseDown={stopPropagation}
        >
            {label && (
                <div className="flex justify-between items-center text-[10px]">
                    <span className="font-medium text-zinc-400">{label}</span>
                    <div className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-300 font-mono text-[9px]">
                        {displayValue !== undefined ? displayValue : value.toFixed(label === 'Hue' ? 0 : 2)}
                    </div>
                </div>
            )}
            <div className="relative h-3 w-full flex items-center group">
                <div 
                    className={`absolute inset-0 rounded-full h-1.5 my-auto border border-zinc-700/20 ${checkered ? 'checkerboard' : ''}`} 
                    style={{ background: checkered ? undefined : trackBackground }}
                >
                    {checkered && (
                        <div className="absolute inset-0 rounded-full" style={{ background: trackBackground }} />
                    )}
                </div>
                <input 
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                {!disabled && (
                    <div 
                        className="absolute h-3 w-3 bg-white rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.5)] border border-zinc-200 pointer-events-none"
                        style={{ 
                            left: `${((value - min) / (max - min)) * 100}%`, 
                            transform: 'translateX(-50%)',
                            backgroundColor: thumbColor || '#fff'
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export const ColorPicker = ({ color, onChange }: ColorPickerProps) => {
    const { extractedColors } = useStore();
    
    // Initial State Parsing
    const [initialState] = useState(() => parseColorToState(color));

    const [mode, setMode] = useState<ColorMode>('HEX');
    const [localHex, setLocalHex] = useState(color);
    const [isModeOpen, setIsModeOpen] = useState(false);
    
    // Internal States
    const [hsvState, setHsvState] = useState(initialState.hsv);
    const [oklchState, setOklchState] = useState(initialState.oklch);
    const [hslState, setHslState] = useState(initialState.hsl);
    const [alpha, setAlpha] = useState(initialState.alpha);

    // Derived States
    const isAchromatic = useMemo(() => {
        if (mode !== 'OKLCH') return false;
        return oklchState.c < 0.005; 
    }, [mode, oklchState.c]);

    // Sync from external prop
    useEffect(() => {
        if (color === localHex) return;

        setLocalHex(color);
        const newState = parseColorToState(color);
        
        setHsvState(newState.hsv);
        setHslState(newState.hsl);
        setAlpha(newState.alpha);
        
        // Preserve Hue logic for OKLCH if nearly achromatic
        let newH = newState.oklch.h;
        if (newState.oklch.c < 0.005) {
             // If new color is achromatic, keep old Hue to prevent jumping
             newH = oklchState.h;
        }
        setOklchState({ ...newState.oklch, h: newH });

    }, [color]); 

    useEffect(() => {
        if (isModeOpen) {
            const handleClick = () => setIsModeOpen(false);
            window.addEventListener('click', handleClick);
            return () => window.removeEventListener('click', handleClick);
        }
    }, [isModeOpen]);

    // --- Update Logic ---

    const emitHex = (hex: string) => {
        setLocalHex(hex);
        onChange(hex);
    };

    const updateFromHsv = (h: number, s: number, v: number, a: number) => {
        setHsvState({ h, s, v });
        setAlpha(a);
        
        const hex = formatHex({ mode: 'hsv', h, s, v, alpha: 1 });
        const final = hex + (a < 0.999 ? Math.round(a*255).toString(16).padStart(2,'0').toUpperCase() : '');
        emitHex(final);

        // Sync peers
        const hsvObj = { mode: 'hsv', h, s, v, alpha: 1 };
        
        const hsl = toHsl(hsvObj);
        setHslState({ h: hsl.h ?? 0, s: hsl.s ?? 0, l: hsl.l ?? 0 });

        // Update OKLCH state
        const rgb = parse(hex);
        if (rgb) {
            const ok = srgbEncodedToOklch({ r: rgb.r ?? 0, g: rgb.g ?? 0, b: rgb.b ?? 0 });
            setOklchState({ l: ok.L, c: ok.C, h: ok.H });
        }
    };

    const updateFromOklch = (l: number, c: number, h: number, a: number) => {
        setOklchState({ l, c, h });
        setAlpha(a);
        
        // Use the robust Gamut Mapping hex converter from utils
        const hex = oklchToHex({ L: l, C: c, H: h }, a);
        emitHex(hex);

        // Sync peers from the resulting (possibly clamped) color
        const parsed = parse(hex);
        if (parsed) {
            const opaque = { ...parsed, alpha: 1 };
            const hsv = toHsv(opaque);
            const hsl = toHsl(opaque);
            
            setHsvState({ h: hsv.h ?? 0, s: hsv.s ?? 0, v: hsv.v ?? 0 });
            setHslState({ h: hsl.h ?? 0, s: hsl.s ?? 0, l: hsl.l ?? 0 });
        }
    };

    const updateFromHsl = (h: number, s: number, l: number, a: number) => {
        setHslState({ h, s, l });
        setAlpha(a);

        const hex = formatHex({ mode: 'hsl', h, s, l, alpha: 1 });
        const final = hex + (a < 0.999 ? Math.round(a*255).toString(16).padStart(2,'0').toUpperCase() : '');
        emitHex(final);

        const hslObj = { mode: 'hsl', h, s, l, alpha: 1 };
        const hsv = toHsv(hslObj);
        setHsvState({ h: hsv.h ?? 0, s: hsv.s ?? 0, v: hsv.v ?? 0 });

        const rgb = parse(hex);
        if (rgb) {
            const ok = srgbEncodedToOklch({ r: rgb.r ?? 0, g: rgb.g ?? 0, b: rgb.b ?? 0 });
            setOklchState({ l: ok.L, c: ok.C, h: ok.H });
        }
    };

    const handleHexInput = (val: string) => {
        setLocalHex(val); 
        const parsed = parse(val);
        if (parsed) {
            const newAlpha = parsed.alpha ?? 1;
            setAlpha(newAlpha);
            
            const opaque = { ...parsed, alpha: 1 };
            const hsv = toHsv(opaque);
            const hsl = toHsl(opaque);
            
            setHsvState({ h: hsv.h ?? 0, s: hsv.s ?? 0, v: hsv.v ?? 0 });
            setHslState({ h: hsl.h ?? 0, s: hsl.s ?? 0, l: hsl.l ?? 0 });
            
            // RGB -> OKLCH
            const ok = srgbEncodedToOklch({ r: parsed.r ?? 0, g: parsed.g ?? 0, b: parsed.b ?? 0 });
            setOklchState({ l: ok.L, c: ok.C, h: ok.H });

            // Standardize output
            const hex = formatHex(opaque);
            const final = hex + (newAlpha < 0.999 ? Math.round(newAlpha*255).toString(16).padStart(2,'0').toUpperCase() : '');
            onChange(final);
        }
    };

    // --- Gradients ---
    const getGradient = (channel: string) => {
        const steps = 15;
        let stops = [];
        const a = 1; 
        
        if (mode === 'OKLCH') {
            const { l, c, h } = oklchState;
            for (let i=0; i<=steps; i++) {
                const t = i/steps;
                let color = '';
                if (channel === 'L') color = oklchToHex({ L: t, C: c, H: h }, a);
                if (channel === 'C') color = oklchToHex({ L: l, C: t * 0.4, H: h }, a); 
                // For Hue Gradient, show full spectrum at current L/C
                if (channel === 'H') color = oklchToHex({ L: l, C: Math.max(c, 0.1), H: t * 360 }, a); 
                stops.push(color);
            }
        } else if (mode === 'HSL') {
            const { h, s, l } = hslState;
            if (channel === 'H') for(let i=0; i<=steps; i++) stops.push(formatHex({ mode: 'hsl', h: (i/steps)*360, s, l, alpha: a }));
            if (channel === 'S') for(let i=0; i<=steps; i++) stops.push(formatHex({ mode: 'hsl', h, s: i/steps, l, alpha: a }));
            if (channel === 'L') for(let i=0; i<=steps; i++) stops.push(formatHex({ mode: 'hsl', h, s, l: i/steps, alpha: a }));
        } else {
            if (channel === 'H') for(let i=0; i<=steps; i++) stops.push(formatHex({ mode: 'hsv', h: (i/steps)*360, s: 1, v: 1, alpha: a }));
        }
        return `linear-gradient(to right, ${stops.join(', ')})`;
    };

    const getAlphaGradient = () => {
        const opaque = formatHex({ mode: 'hsv', h: hsvState.h, s: hsvState.s, v: hsvState.v, alpha: 1 });
        return `linear-gradient(to right, transparent, ${opaque})`;
    };

    // --- Shade Ramp ---
    const shades = useMemo(() => {
        const count = 9;
        const result = [];
        const { h, s } = hslState;
        for(let i=0; i<count; i++) {
            const l = 0.05 + (i / (count-1)) * 0.9;
            const hex = formatHex({ mode: 'hsl', h, s, l, alpha: 1 });
            const final = hex + (alpha < 0.999 ? Math.round(alpha*255).toString(16).padStart(2,'0').toUpperCase() : '');
            result.push(final);
        }
        return result;
    }, [hslState.h, hslState.s, alpha]);

    const stopPropagation = (e: React.MouseEvent | React.PointerEvent) => {
        e.stopPropagation();
    };

    return (
        <div 
            className="w-64 flex flex-col gap-2 text-white select-none"
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
        >
            
            {/* --- VISUAL PICKER (HEX MODE) --- */}
            {mode === 'HEX' && (
                <SaturationBrightnessBox 
                    hue={hsvState.h} 
                    saturation={hsvState.s} 
                    brightness={hsvState.v}
                    onChange={(s, v) => updateFromHsv(hsvState.h, s, v, alpha)}
                />
            )}

            {/* --- CONTROLS --- */}
            <div className="flex flex-col">
                {mode === 'OKLCH' && (
                    <>
                        <Slider 
                            label="Lightness" 
                            value={oklchState.l} min={0} max={1} 
                            trackBackground={getGradient('L')}
                            onChange={(v) => updateFromOklch(v, oklchState.c, oklchState.h, alpha)} 
                        />
                        <Slider 
                            label="Chroma" 
                            value={oklchState.c} min={0} max={0.4} step={0.001} 
                            trackBackground={getGradient('C')}
                            onChange={(v) => updateFromOklch(oklchState.l, v, oklchState.h, alpha)} 
                        />
                        <Slider 
                            label="Hue" 
                            value={oklchState.h} min={0} max={360} step={1} 
                            trackBackground={getGradient('H')}
                            disabled={isAchromatic}
                            displayValue={isAchromatic ? "—" : undefined}
                            onChange={(v) => updateFromOklch(oklchState.l, oklchState.c, v, alpha)} 
                        />
                    </>
                )}
                
                {mode === 'HSL' && (
                    <>
                        <Slider 
                            label="Hue" 
                            value={hslState.h} min={0} max={360} step={1} 
                            trackBackground={getGradient('H')}
                            onChange={(v) => updateFromHsl(v, hslState.s, hslState.l, alpha)} 
                        />
                        <Slider 
                            label="Saturation" 
                            value={hslState.s} min={0} max={1} 
                            trackBackground={getGradient('S')}
                            onChange={(v) => updateFromHsl(hslState.h, v, hslState.l, alpha)} 
                        />
                        <Slider 
                            label="Lightness" 
                            value={hslState.l} min={0} max={1} 
                            trackBackground={getGradient('L')}
                            onChange={(v) => updateFromHsl(hslState.h, hslState.s, v, alpha)} 
                        />
                    </>
                )}

                {mode === 'HEX' && (
                     <Slider 
                        value={hsvState.h} min={0} max={360} step={1} 
                        trackBackground={getGradient('H')}
                        onChange={(v) => updateFromHsv(v, hsvState.s, hsvState.v, alpha)} 
                     />
                )}

                {/* --- ALPHA SLIDER (ALL MODES) --- */}
                <Slider 
                    label={mode !== 'HEX' ? 'Opacity' : undefined}
                    value={alpha} min={0} max={1} step={0.01}
                    trackBackground={getAlphaGradient()}
                    checkered
                    thumbColor={formatHex({ mode: 'hsv', h: hsvState.h, s: hsvState.s, v: hsvState.v, alpha: 1 })}
                    onChange={(v) => {
                        if (mode === 'OKLCH') updateFromOklch(oklchState.l, oklchState.c, oklchState.h, v);
                        else if (mode === 'HSL') updateFromHsl(hslState.h, hslState.s, hslState.l, v);
                        else updateFromHsv(hsvState.h, hsvState.s, hsvState.v, v);
                    }}
                />
            </div>

            {/* --- HEX INPUT & MODE ROW --- */}
            {mode === 'HEX' && (
                <div className="flex gap-2 items-center">
                    {/* Mode Button */}
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsModeOpen(!isModeOpen); }}
                            className="flex items-center gap-1 px-2 py-1.5 bg-zinc-800 rounded-md text-[10px] font-bold text-zinc-400 hover:text-white transition-colors uppercase w-16 justify-between border border-zinc-700"
                        >
                            {mode} <ChevronDown size={10} />
                        </button>
                         {isModeOpen && (
                            <div className="absolute bottom-full left-0 mb-1 w-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-[9999]" onPointerDown={stopPropagation}>
                                {(['HEX', 'OKLCH', 'HSL'] as ColorMode[]).map(m => (
                                    <button 
                                        key={m}
                                        onClick={(e) => { e.stopPropagation(); setMode(m); setIsModeOpen(false); }}
                                        className={`w-full text-left px-2 py-1.5 text-[10px] hover:bg-zinc-700 ${mode === m ? 'text-white font-bold' : 'text-zinc-400'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Input */}
                    <div className="flex-1 bg-zinc-800 rounded-md p-0.5 flex items-center border border-zinc-700 focus-within:border-zinc-500 transition-colors">
                        <input 
                            type="text" 
                            value={localHex.toUpperCase()}
                            onChange={(e) => handleHexInput(e.target.value)}
                            className="w-full bg-transparent text-xs font-mono text-center text-white outline-none uppercase py-1"
                            spellCheck={false}
                        />
                    </div>
                    {/* Copy */}
                    <button 
                        onClick={() => navigator.clipboard.writeText(localHex)}
                        className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
                        title="Copy Hex"
                    >
                        <Copy size={12} />
                    </button>
                </div>
            )}

            {/* Shade Ramp - Larger */}
            <div className="h-6 w-full flex rounded-md overflow-hidden border border-zinc-700/50 shadow-sm cursor-pointer mt-1">
                {shades.map((shade, i) => (
                    <div 
                        key={i}
                        className="flex-1 hover:brightness-110 active:brightness-90 transition-all"
                        style={{ backgroundColor: shade }}
                        onClick={() => handleHexInput(shade)}
                        title={shade}
                    />
                ))}
            </div>

            {/* MAGIC COLORS GRID (Extracted Colors) */}
            {extractedColors.length > 0 && (
                 <div className="mt-2">
                     <div className="flex flex-wrap gap-2 justify-start">
                         {extractedColors.map(hex => (
                             <button 
                                key={hex}
                                onClick={() => handleHexInput(hex)}
                                className="w-6 h-6 rounded-full border border-white/10 hover:border-white hover:scale-110 transition-all shadow-sm"
                                style={{ backgroundColor: hex }}
                                title={hex}
                             />
                         ))}
                     </div>
                 </div>
            )}
            
            {/* Non-Hex Mode Switcher */}
            {mode !== 'HEX' && (
               <div className="relative pt-2 border-t border-zinc-700/50 flex justify-between items-center">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setIsModeOpen(!isModeOpen); }}
                        className="flex items-center gap-1 px-2 py-1 bg-zinc-800 rounded text-[10px] font-bold text-zinc-400 uppercase border border-zinc-700"
                    >
                        {mode} <ChevronDown size={10} />
                    </button>
                     {isModeOpen && (
                        <div className="absolute bottom-full left-0 mb-1 w-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-[9999]" onPointerDown={stopPropagation}>
                            {(['HEX', 'OKLCH', 'HSL'] as ColorMode[]).map(m => (
                                <button 
                                    key={m}
                                    onClick={(e) => { e.stopPropagation(); setMode(m); setIsModeOpen(false); }}
                                    className={`w-full text-left px-2 py-1.5 text-[10px] hover:bg-zinc-700 ${mode === m ? 'text-white font-bold' : 'text-zinc-400'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="font-mono text-[10px] text-zinc-300 uppercase">{localHex}</div>
               </div>
            )}

        </div>
    );
};
