
import { create } from 'zustand';
import { Layer, Viewport, Gradient, Tool, GradientStop, InteractionMode, GradientType } from './types';
import { generateId, fixGradientBanding, oklchToHex } from './utils';
import { generateMassiveGradients } from './colorExtraction';
import { GoogleGenAI, Type } from "@google/genai";

interface GridPreferences {
  style: 'none' | 'linear' | 'dot';
  density: 'sparse' | 'medium' | 'dense';
  opacity: number;
}

interface EditorState {
  viewport: Viewport;
  layers: Record<string, Layer>;
  layerOrder: string[];
  selectedIds: string[];
  activeTool: Tool;
  interactionMode: InteractionMode;
  history: {
    past: string[];
    future: string[];
  };
  theme: 'light' | 'dark';
  gridPreferences: GridPreferences;
  sourceImage: string | null;
  extractedColors: string[];
  generatedGradients: Gradient[];
  aiGradients: Gradient[];
  isGenerating: boolean;
  palette: string[];
  
  // Live API State
  isLiveActive: boolean;
  liveTranscription: { text: string; role: 'user' | 'model' }[];

  setViewport: (v: Partial<Viewport>) => void;
  panCanvas: (dx: number, dy: number) => void;
  zoomCanvas: (delta: number, center: { x: number; y: number }) => void;
  setZoom: (zoom: number) => void;
  fitContent: (targetIds?: string[], paddingScale?: number) => void;
  centerView: () => void;
  centerOnSelection: () => void;
  addLayer: (layer: Layer) => void;
  updateLayer: (id: string, updates: Partial<Layer>, recordHistory?: boolean) => void;
  setSelection: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  setInteractionMode: (mode: InteractionMode) => void;
  undo: () => void;
  redo: () => void;
  saveSnapshot: () => void;
  toggleTheme: () => void;
  setGridPreferences: (prefs: Partial<GridPreferences>) => void;
  updateLayerGradient: (layerId: string, gradientUpdates: Partial<Gradient>, recordHistory?: boolean) => void;
  addGradientStop: (layerId: string, offset: number, color?: string) => void;
  removeGradientStop: (layerId: string, stopId: string) => void;
  updateGradientStop: (layerId: string, stopId: string, updates: Partial<GradientStop>) => void;
  randomizeLayerGradient: (layerId: string) => void;
  smoothLayerGradient: (layerId: string) => void;
  setSourceImage: (url: string | null) => void;
  setExtractedColors: (colors: string[]) => void;
  setGeneratedGradients: (gradients: Gradient[]) => void;
  generateAIGradients: (prompt: string) => Promise<void>;
  setPalette: (colors: string[]) => void;
  
  // Live API Actions
  setLiveActive: (active: boolean) => void;
  addLiveTranscription: (text: string, role: 'user' | 'model') => void;
}

const MAX_HISTORY = 50;
const INITIAL_PALETTE = ['#00EBE5', '#DAA3FF', '#F9AB3E'];

const INITIAL_GRADIENT: Gradient = {
    type: 'linear',
    angle: 135,
    stops: [
        { id: 'init-1', offset: 0, color: '#00EBE5', opacity: 1 },
        { id: 'init-2', offset: 0.5, color: '#DAA3FF', opacity: 1 },
        { id: 'init-3', offset: 1, color: '#F9AB3E', opacity: 1 }
    ],
    center: { x: 0.5, y: 0.5 }
};

export const useStore = create<EditorState>((set, get) => ({
  viewport: { x: 0, y: 0, zoom: 0.8 },
  layers: {
    'artboard-1': {
      id: 'artboard-1',
      type: 'artboard',
      name: 'Main Board',
      x: 100,
      y: 100,
      width: 1200,
      height: 800,
      rotation: 0,
      visible: true,
      fill: INITIAL_GRADIENT, 
    }
  },
  layerOrder: ['artboard-1'],
  selectedIds: ['artboard-1'],
  activeTool: 'select',
  interactionMode: 'idle',
  history: { past: [], future: [] },
  theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'dark',
  gridPreferences: { style: 'linear', density: 'medium', opacity: 0.1 },
  sourceImage: null,
  extractedColors: INITIAL_PALETTE,
  generatedGradients: generateMassiveGradients(INITIAL_PALETTE),
  aiGradients: [],
  isGenerating: false,
  palette: INITIAL_PALETTE,
  
  isLiveActive: false,
  liveTranscription: [],

  saveSnapshot: () => {
    set((state) => {
      const current = JSON.stringify({ layers: state.layers, layerOrder: state.layerOrder });
      return { history: { past: [...state.history.past, current].slice(-MAX_HISTORY), future: [] } };
    });
  },
  setViewport: (v) => set((state) => ({ viewport: { ...state.viewport, ...v } })),
  panCanvas: (dx, dy) => set((state) => ({ viewport: { ...state.viewport, x: state.viewport.x + dx, y: state.viewport.y + dy } })),
  zoomCanvas: (delta, center) => set((state) => {
    const { x, y, zoom } = state.viewport;
    const newZoom = Math.min(Math.max(zoom * (1 - delta * 0.0015), 0.05), 50);
    const scale = newZoom / zoom;
    return { viewport: { x: center.x - (center.x - x) * scale, y: center.y - (center.y - y) * scale, zoom: newZoom } };
  }),
  setZoom: (zoom) => set((state) => {
      const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const scale = zoom / state.viewport.zoom;
      return { viewport: { x: center.x - (center.x - state.viewport.x) * scale, y: center.y - (center.y - state.viewport.y) * scale, zoom }};
  }),
  fitContent: (targetIds, paddingScale = 0.85) => set((state) => {
      const ids = targetIds || state.layerOrder;
      if (ids.length === 0) return state;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ids.forEach(id => {
          const l = state.layers[id];
          if (l) {
              minX = Math.min(minX, l.x); minY = Math.min(minY, l.y);
              maxX = Math.max(maxX, l.x + l.width); maxY = Math.max(maxY, l.y + l.height);
          }
      });
      const cw = maxX - minX, ch = maxY - minY;
      const aw = window.innerWidth, ah = window.innerHeight - 200;
      const zoom = Math.min(aw/cw, ah/ch) * paddingScale;
      return { viewport: { x: (aw - cw * zoom) / 2 - minX * zoom, y: 60 + (ah - ch * zoom) / 2 - minY * zoom, zoom }};
  }),
  centerView: () => set({ viewport: { x: window.innerWidth/2 - 500, y: window.innerHeight/2 - 400, zoom: 1 }}),
  centerOnSelection: () => get().fitContent(get().selectedIds),
  addLayer: (layer) => {
    get().saveSnapshot();
    set((state) => ({ layers: { ...state.layers, [layer.id]: layer }, layerOrder: [...state.layerOrder, layer.id], selectedIds: [layer.id] }));
  },
  updateLayer: (id, updates, recordHistory = true) => {
    if (recordHistory) get().saveSnapshot();
    set((state) => ({ layers: { ...state.layers, [id]: { ...state.layers[id], ...updates } } }));
  },
  setSelection: (ids) => set({ selectedIds: ids }),
  setTool: (tool) => set({ activeTool: tool }),
  setInteractionMode: (mode) => set({ interactionMode: mode }),
  undo: () => set((state) => {
    if (state.history.past.length === 0) return state;
    const previous = state.history.past.pop()!;
    const current = JSON.stringify({ layers: state.layers, layerOrder: state.layerOrder });
    const parsed = JSON.parse(previous);
    return { layers: parsed.layers, layerOrder: parsed.layerOrder, history: { past: state.history.past, future: [current, ...state.history.future] } };
  }),
  redo: () => set((state) => {
    if (state.history.future.length === 0) return state;
    const next = state.history.future.shift()!;
    const current = JSON.stringify({ layers: state.layers, layerOrder: state.layerOrder });
    const parsed = JSON.parse(next);
    return { layers: parsed.layers, layerOrder: parsed.layerOrder, history: { past: [...state.history.past, current], future: state.history.future } };
  }),
  toggleTheme: () => set((state) => {
    const next = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    return { theme: next };
  }),
  setGridPreferences: (prefs) => set((state) => ({ gridPreferences: { ...state.gridPreferences, ...prefs } })),
  updateLayerGradient: (layerId, gradientUpdates, recordHistory = true) => {
    if (recordHistory) get().saveSnapshot();
    set((state) => {
      const layer = state.layers[layerId];
      const fill = typeof layer.fill === 'string' ? { ...INITIAL_GRADIENT, ...gradientUpdates } : { ...layer.fill, ...gradientUpdates };
      return { layers: { ...state.layers, [layerId]: { ...layer, fill } } };
    });
  },
  randomizeLayerGradient: (layerId) => {
    get().saveSnapshot();
    const stops = [{ id: generateId(), offset: 0, color: oklchToHex({ L: 0.7, C: 0.2, H: Math.random() * 360 }), opacity: 1 }, { id: generateId(), offset: 1, color: oklchToHex({ L: 0.4, C: 0.2, H: Math.random() * 360 }), opacity: 1 }];
    get().updateLayerGradient(layerId, { stops, type: 'linear', angle: Math.random() * 360 });
  },
  smoothLayerGradient: (layerId) => {
    get().saveSnapshot();
    set((state) => {
      const layer = state.layers[layerId];
      if (!layer || typeof layer.fill === 'string') return state;
      return { layers: { ...state.layers, [layerId]: { ...layer, fill: { ...layer.fill, stops: fixGradientBanding(layer.fill.stops) } } } };
    });
  },
  addGradientStop: (layerId, offset, color) => {
    get().saveSnapshot();
    set((state) => {
      const layer = state.layers[layerId];
      if (!layer || typeof layer.fill === 'string') return state;
      const stops = [...layer.fill.stops, { id: generateId(), offset, color: color || '#ffffff', opacity: 1 }].sort((a, b) => a.offset - b.offset);
      return { layers: { ...state.layers, [layerId]: { ...layer, fill: { ...layer.fill, stops } } } };
    });
  },
  removeGradientStop: (layerId, stopId) => {
    get().saveSnapshot();
    set((state) => {
      const layer = state.layers[layerId];
      if (!layer || typeof layer.fill === 'string' || layer.fill.stops.length <= 2) return state;
      return { layers: { ...state.layers, [layerId]: { ...layer, fill: { ...layer.fill, stops: layer.fill.stops.filter(s => s.id !== stopId) } } } };
    });
  },
  updateGradientStop: (layerId, stopId, updates) => {
    set((state) => {
      const layer = state.layers[layerId];
      if (!layer || typeof layer.fill === 'string') return state;
      const stops = layer.fill.stops.map(s => s.id === stopId ? { ...s, ...updates } : s).sort((a, b) => a.offset - b.offset);
      return { layers: { ...state.layers, [layerId]: { ...layer, fill: { ...layer.fill, stops } } } };
    });
  },
  generateAIGradients: async (prompt: string) => {
    set({ isGenerating: true });
    try {
      // Fix: Use direct access to process.env.API_KEY as per guidelines
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate 5 professional gradients: "${prompt}".`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                angle: { type: Type.NUMBER },
                stops: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { offset: { type: Type.NUMBER }, color: { type: Type.STRING } } } }
              }
            }
          }
        }
      });
      const data = JSON.parse(response.text || "[]");
      set({ aiGradients: data.map((g: any) => ({ ...g, center: { x: 0.5, y: 0.5 }, stops: g.stops.map((s: any) => ({ ...s, id: generateId(), opacity: 1 })) })), isGenerating: false });
    } catch { set({ isGenerating: false }); }
  },
  setSourceImage: (url) => set({ sourceImage: url }),
  setExtractedColors: (colors) => set({ extractedColors: colors }),
  setGeneratedGradients: (gradients) => set({ generatedGradients: gradients }),
  setPalette: (colors) => set({ palette: colors }),
  
  // Live API Actions
  setLiveActive: (active) => set({ isLiveActive: active }),
  addLiveTranscription: (text, role) => set((state) => ({ 
    liveTranscription: [...state.liveTranscription, { text, role }].slice(-20) 
  })),
}));