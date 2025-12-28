
export type Vec2 = { x: number; y: number };

export type GradientType = 'linear' | 'radial' | 'conic';

export type InteractionMode = 'idle' | 'panning' | 'dragging-layer' | 'dragging-gradient' | 'resizing' | 'drawing';

export type GradientStop = {
  id: string;
  offset: number; // 0 to 1
  color: string;
  opacity: number;
  midpoint?: number; // 0 to 1 relative to next stop, default 0.5
};

export type Gradient = {
  type: GradientType;
  stops: GradientStop[];
  angle: number; // In degrees, for linear/conic
  center: Vec2; // 0-1, for radial/conic
  
  // Explicit handles
  start?: Vec2; // Linear gradient start point (0-1)
  end?: Vec2;   // Linear gradient end point (0-1)
  radius?: number; // Radial gradient radius (0-1)
  ratio?: number; // Radial gradient aspect ratio (Ry/Rx), default 1
};

export type LayerType = 'artboard' | 'rectangle' | 'circle';

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  fill: string | Gradient;
  borderRadius?: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type Tool = 'select' | 'pan' | 'rectangle' | 'circle' | 'artboard';
