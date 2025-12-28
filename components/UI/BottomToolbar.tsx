import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { GradientType, Gradient } from '../../types';
import { clamp, interpolateColor } from '../../utils';
import { 
  Sparkles, Upload, Check, Plus, Moon, Sun, 
  Layout, Minus, MousePointer2, Hand,
  Ratio, Sliders, Share, Loader2, Send, Shuffle, Stars, Zap, Eye, MessageSquare
} from 'lucide-react';
import { extractRawColors, generateMassiveGradients } from '../../colorExtraction';
import { ColorPicker } from './ColorPicker';
import { ExportPanel } from './ExportPanel';
import { LiveInterface } from '../Live/LiveInterface';

const Popover = ({ isOpen, onClose, title, children, width = "w-72", anchorRect }: any) => {
  if (!isOpen || !anchorRect) return null;
  const bottom = window.innerHeight - anchorRect.top + 12;
  const left = Math.max(20, Math.min(anchorRect.left + anchorRect.width/2, window.innerWidth - 20));
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div className={`fixed ${width} bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl p-4 z-[9999] origin-bottom -translate-x-1/2`} style={{ bottom, left }}>
        <div className="flex justify-between items-center mb-4 border-b border-zinc-200 dark:border-white/5 pb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</span>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-white/10 rounded"><Minus size={14} /></button>
        </div>
        {children}
      </div>
    </>, document.body
  );
};

const ToolbarButton = ({ icon: Icon, label, isActive, onClick, primary, disabled, badge }: any) => (
  <button onClick={onClick} disabled={disabled} className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all border shrink-0 relative ${disabled ? 'opacity-40' : ''} ${primary ? 'bg-blue-600 border-blue-500 text-white' : isActive ? 'bg-blue-500/10 border-blue-500/50 text-blue-600' : 'bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-300'}`}>
    <Icon size={18} />
    {label && <span className="text-sm font-medium">{label}</span>}
  </button>
);

export const BottomToolbar = () => {
  const { 
    selectedIds, layers, viewport, activeTool, setTool, setZoom, theme, toggleTheme, 
    randomizeLayerGradient, generateAIGradients, aiGradients, isGenerating, 
    updateLayerGradient, extractedColors, setExtractedColors, setGeneratedGradients, 
    generatedGradients, setSourceImage, sourceImage,
    isLiveActive, setLiveActive
  } = useStore();
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const layer = selectedIds.length === 1 ? layers[selectedIds[0]] : null;

  const toggle = (id: string, e: any) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setActivePopover(activePopover === id ? null : id);
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSourceImage(url);
    const { allColors } = await extractRawColors(url);
    const hexes = allColors.map(c => c.hex);
    setExtractedColors(hexes);
    setGeneratedGradients(generateMassiveGradients(hexes));
    setActivePopover('suggestions');
  };

  return (
    <>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-[95vw] z-50 flex flex-col items-center">
        <div className="flex items-center gap-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl p-2 px-3 overflow-x-auto no-scrollbar">
          <button onClick={() => setTool('select')} className={`p-2 rounded-lg ${activeTool === 'select' ? 'bg-zinc-100 dark:bg-white/10' : 'text-zinc-400'}`}><MousePointer2 size={16} /></button>
          <button onClick={() => setTool('pan')} className={`p-2 rounded-lg ${activeTool === 'pan' ? 'bg-zinc-100 dark:bg-white/10' : 'text-zinc-400'}`}><Hand size={16} /></button>
          <button onClick={() => setTool('artboard')} className={`p-2 rounded-lg ${activeTool === 'artboard' ? 'bg-zinc-100 dark:bg-white/10' : 'text-zinc-400'}`}><Layout size={16} /></button>
          
          <div className="w-px h-6 bg-zinc-200 dark:bg-white/10 mx-1" />
          
          <ToolbarButton icon={Upload} label="Image" onClick={() => fileInputRef.current?.click()} />
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          
          <ToolbarButton icon={Sparkles} label="Colors" isActive={activePopover === 'suggestions'} onClick={(e:any) => toggle('suggestions', e)} />
          <ToolbarButton icon={Stars} label="AI" primary isActive={activePopover === 'ai'} onClick={(e:any) => toggle('ai', e)} />
          
          <div className="w-px h-6 bg-zinc-200 dark:bg-white/10 mx-1" />
          
          {/* Live API Toggle */}
          <ToolbarButton icon={MessageSquare} label="Live" isActive={isLiveActive} onClick={() => setLiveActive(!isLiveActive)} />
          
          <ToolbarButton icon={Shuffle} label="Random" onClick={() => layer && randomizeLayerGradient(layer.id)} disabled={!layer} />
          <ToolbarButton icon={Sliders} label="Edit" isActive={activePopover === 'edit'} onClick={(e:any) => toggle('edit', e)} disabled={!layer} />
          <ToolbarButton icon={Share} label="Export" isActive={activePopover === 'export'} onClick={(e:any) => toggle('export', e)} disabled={!layer} />
          
          <button onClick={toggleTheme} className="p-2 text-zinc-400">{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
        </div>

        <Popover isOpen={activePopover === 'ai'} anchorRect={anchorRect} onClose={() => setActivePopover(null)} title="AI Gradient Architect" width="w-[400px]">
          <div className="flex flex-col gap-4">
            <div className="relative">
              <input type="text" placeholder="Mood or theme..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && generateAIGradients(aiPrompt)} className="w-full bg-zinc-100 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm outline-none focus:ring-2 ring-blue-500" />
              <button onClick={() => generateAIGradients(aiPrompt)} disabled={isGenerating} className="absolute right-2 top-2 p-1.5 bg-blue-600 text-white rounded-lg">{isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {aiGradients.map((g, i) => (
                <button key={i} onClick={() => layer && updateLayerGradient(layer.id, g)} className="aspect-video rounded-lg border border-zinc-200 dark:border-white/10 overflow-hidden hover:ring-2 ring-blue-500 transition-all">
                  <div className="w-full h-full" style={{ background: `linear-gradient(${g.angle}deg, ${g.stops.map(s => `${s.color} ${s.offset*100}%`).join(', ')})` }} />
                </button>
              ))}
            </div>
          </div>
        </Popover>

        <Popover isOpen={activePopover === 'suggestions'} anchorRect={anchorRect} onClose={() => setActivePopover(null)} title="Extracted Gradients" width="w-[400px]">
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-2">
            {generatedGradients.map((g, i) => (
              <button key={i} onClick={() => layer && updateLayerGradient(layer.id, g)} className="aspect-video rounded-lg border border-zinc-200 dark:border-white/10 overflow-hidden">
                <div className="w-full h-full" style={{ background: `linear-gradient(${g.angle}deg, ${g.stops.map(s => `${s.color} ${s.offset*100}%`).join(', ')})` }} />
              </button>
            ))}
          </div>
        </Popover>

        <Popover isOpen={activePopover === 'export'} anchorRect={anchorRect} onClose={() => setActivePopover(null)} title="Export Design" width="w-[400px]">
          {layer && <ExportPanel layer={layer} />}
        </Popover>
      </div>
      {/* Live API Interface */}
      <LiveInterface />
    </>
  );
};