
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { getGradientCoords, getLocalPoint, interpolateColor, degreesToRadians, canvasToScreen } from '../../utils';
import { Vec2, GradientStop, Layer, Viewport } from '../../types';
import { Trash2, RotateCw } from 'lucide-react';
import { ColorPicker } from '../UI/ColorPicker';

interface GradientOverlayProps {
  layerId: string;
}

type DragState = 
  | { type: 'move-start'; id: string } 
  | { type: 'move-end'; id: string }   
  | { type: 'move-stop'; id: string } 
  | { type: 'move-midpoint'; stopId: string; startStopOffset: number; endStopOffset: number }
  | { type: 'potential-stop'; startX: number; startY: number; t: number; valid: boolean }
  | { type: 'rotate'; center: Vec2; isPointBased: boolean; currentLen: number; startAngle: number } 
  | { type: 'move-center' };

const getGradientColorAt = (t: number, stops: GradientStop[]): string => {
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    if (sorted.length === 0) return '#000000';
    if (t <= sorted[0].offset) return sorted[0].color;
    if (t >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].color;
    for (let i = 0; i < sorted.length - 1; i++) {
        const s1 = sorted[i];
        const s2 = sorted[i+1];
        if (t >= s1.offset && t <= s2.offset) {
            const range = s2.offset - s1.offset;
            if (range === 0) return s1.color;
            const factor = (t - s1.offset) / range;
            return interpolateColor(s1.color, s2.color, factor);
        }
    }
    return sorted[0].color;
};

const getStopScreenPosition = (localPos: Vec2, layer: Layer, viewport: Viewport) => {
  const lx = localPos.x * layer.width;
  const ly = localPos.y * layer.height;
  
  const rad = degreesToRadians(layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  
  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;
  
  const cx = layer.x + rx;
  const cy = layer.y + ry;
  
  return canvasToScreen({ x: cx, y: cy }, viewport);
};

// --- Rewritten Portal Popup Component (Robust Positioning) ---
interface StopPopupProps {
  x: number;
  y: number;
  color: string;
  onChange: (c: string) => void;
  onDelete?: () => void;
}

const StopPopup: React.FC<StopPopupProps> = ({ x, y, color, onChange, onDelete }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);
    
    // We store arrow configuration in state to ensure it re-renders if placement changes
    const [arrowState, setArrowState] = useState({
        className: "absolute w-3 h-3 bg-zinc-900/95 border-zinc-700/50 rotate-45 transform",
        style: { left: 0, top: 0, display: 'none' } as React.CSSProperties
    });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;

        // Reset for measurement if needed, though usually not necessary if we are just moving it.
        // We do this logic in a ResizeObserver callback to handle content changes too.
        
        const updatePosition = () => {
            const rect = el.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;

            if (w === 0 && h === 0) return;

            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;
            const gap = 16;
            const margin = 12;

            let top = y - h - gap;
            let left = x - w / 2;
            let placement = 'top';

            // 1. Prefer Top
            if (top < margin) {
                // 2. Try Bottom
                if (y + gap + h <= viewportH - margin) {
                    placement = 'bottom';
                    top = y + gap;
                    left = x - w / 2;
                } 
                // 3. Try Right
                else if (x + gap + w <= viewportW - margin) {
                    placement = 'right';
                    left = x + gap;
                    top = y - h / 2;
                }
                // 4. Try Left
                else if (x - gap - w >= margin) {
                    placement = 'left';
                    left = x - gap - w;
                    top = y - h / 2;
                }
                // 5. Fallback: Force Top (clamped)
                else {
                    placement = 'top';
                    top = margin;
                    left = x - w / 2;
                }
            }

            // Clamp to Viewport
            if (placement === 'top' || placement === 'bottom') {
                left = Math.max(margin, Math.min(left, viewportW - w - margin));
            } else {
                top = Math.max(margin, Math.min(top, viewportH - h - margin));
            }

            // Apply directly to DOM for instant update without React render cycle delay
            el.style.top = `${top}px`;
            el.style.left = `${left}px`;

            // Calculate Arrow
            const halfArrow = 6;
            let arrowClass = "absolute w-3 h-3 bg-zinc-900/95 border-zinc-700/50 rotate-45 transform";
            let arrowStyle: React.CSSProperties = { display: 'block' };

            if (placement === 'top') {
                arrowClass += " border-b border-r -bottom-1.5";
                arrowStyle.left = x - left - halfArrow;
            } else if (placement === 'bottom') {
                arrowClass += " border-t border-l -top-1.5";
                arrowStyle.left = x - left - halfArrow;
            } else if (placement === 'right') {
                arrowClass += " border-b border-l -left-1.5";
                arrowStyle.top = y - top - halfArrow;
            } else if (placement === 'left') {
                arrowClass += " border-t border-r -right-1.5";
                arrowStyle.top = y - top - halfArrow;
            }

            // Update arrow state if changed
            setArrowState(prev => {
                if (prev.className !== arrowClass || prev.style.left !== arrowStyle.left || prev.style.top !== arrowStyle.top) {
                    return { className: arrowClass, style: arrowStyle };
                }
                return prev;
            });

            // Reveal
            if (!isVisible) setIsVisible(true);
        };

        updatePosition();

        const observer = new ResizeObserver(() => updatePosition());
        observer.observe(el);

        return () => observer.disconnect();
    }, [x, y, color]); // Dependencies to re-run positioning

    return createPortal(
      <div 
        ref={ref}
        className="fixed z-[100] flex flex-col items-center transition-opacity duration-150 ease-out"
        style={{ 
            opacity: isVisible ? 1 : 0,
            pointerEvents: isVisible ? 'auto' : 'none',
            // Default off-screen to prevent flash at 0,0 before layout effect runs
            top: -9999, 
            left: -9999
        }}
        onMouseDown={e => e.stopPropagation()}
      >
         <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl shadow-2xl p-4 border border-zinc-700/50 relative">
             <ColorPicker color={color} onChange={onChange} />
             
             {onDelete && (
                <div className="mt-3 pt-3 border-t border-zinc-800 flex justify-between items-center">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Actions</span>
                    <button 
                        onClick={onDelete}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors"
                    >
                        <Trash2 size={12} /> Delete Stop
                    </button>
                </div>
             )}
             <div className={arrowState.className} style={arrowState.style}></div>
         </div>
      </div>,
      document.body
    );
};

export const GradientOverlay: React.FC<GradientOverlayProps> = ({ layerId }) => {
  const { 
      layers, viewport, interactionMode,
      updateLayerGradient, updateGradientStop, addGradientStop, removeGradientStop, 
      setInteractionMode
  } = useStore();
  const layer = layers[layerId];
  
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);
  const [previewStop, setPreviewStop] = useState<{ x: number, y: number, color: string } | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  
  const [isRotating, setIsRotating] = useState(false);
  const [isHoveringRotationZone, setIsHoveringRotationZone] = useState(false);
  
  const dragRef = useRef<{
    active: boolean;
    hasMoved: boolean;
    startPos: { x: number; y: number };
    state: DragState | null;
  }>({ active: false, hasMoved: false, startPos: {x:0, y:0}, state: null });

  useEffect(() => {
     if (!layer || typeof layer.fill === 'string') {
         setSelectedStopId(null);
     } else {
         if (selectedStopId && !layer.fill.stops.find(s => s.id === selectedStopId)) {
             setSelectedStopId(null);
         }
     }
  }, [layer, selectedStopId]);

  useEffect(() => {
      const handleGlobalClick = (e: MouseEvent) => {
          if ((e.target as Element).closest('.gradient-overlay') === null && (e.target as Element).closest('.fixed') === null) {
              setSelectedStopId(null);
          }
      };
      window.addEventListener('mousedown', handleGlobalClick);
      return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, []);

  if (!layer || typeof layer.fill === 'string') return null;
  const gradient = layer.fill;

  const minDim = Math.min(layer.width, layer.height);
  const conicRadius = minDim * 0.35; 

  let start = gradient.start;
  let end = gradient.end;
  
  const derivedCoords = getGradientCoords(gradient.angle);
  const renderStart = start || { x: derivedCoords.x1, y: derivedCoords.y1 };
  const renderEnd = end || { x: derivedCoords.x2, y: derivedCoords.y2 };

  const center = gradient.center;
  const radius = gradient.radius !== undefined ? gradient.radius : 0.5;
  
  const radialAngleRad = degreesToRadians(gradient.angle - 90);
  const radiusPos = { 
      x: center.x + radius * Math.cos(radialAngleRad), 
      y: center.y + radius * Math.sin(radialAngleRad) 
  };

  let rotHandlePos = { x: 0, y: 0 };
  let rotCenter = { x: 0, y: 0 };
  let triggerZonePos = { x: 0, y: 0 };

  const rotationOffsetPx = 32 / viewport.zoom; 

  if (gradient.type === 'linear') {
      const sx = renderStart.x * layer.width;
      const sy = renderStart.y * layer.height;
      const ex = renderEnd.x * layer.width;
      const ey = renderEnd.y * layer.height;
      
      rotCenter = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
      triggerZonePos = { x: ex, y: ey };
      
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.sqrt(dx*dx + dy*dy);
      
      if (len > 0.001) {
          rotHandlePos = {
              x: ex + (dx / len) * rotationOffsetPx,
              y: ey + (dy / len) * rotationOffsetPx
          };
      } else {
          rotHandlePos = { x: ex, y: ey - rotationOffsetPx };
      }
  } else if (gradient.type === 'conic') {
      rotCenter = { x: center.x * layer.width, y: center.y * layer.height };
      const rad = degreesToRadians(gradient.angle - 90);
      const r = conicRadius;
      
      triggerZonePos = {
          x: rotCenter.x + r * Math.cos(rad),
          y: rotCenter.y + r * Math.sin(rad)
      };

      rotHandlePos = {
          x: rotCenter.x + (r + rotationOffsetPx) * Math.cos(rad),
          y: rotCenter.y + (r + rotationOffsetPx) * Math.sin(rad)
      };
  } else if (gradient.type === 'radial') {
      rotCenter = { x: center.x * layer.width, y: center.y * layer.height };
      const rx = radiusPos.x * layer.width;
      const ry = radiusPos.y * layer.height;
      
      triggerZonePos = { x: rx, y: ry };

      const dx = rx - rotCenter.x;
      const dy = ry - rotCenter.y;
      const len = Math.sqrt(dx*dx + dy*dy);
      
      if (len > 0.001) {
          rotHandlePos = {
              x: rx + (dx / len) * rotationOffsetPx,
              y: ry + (dy / len) * rotationOffsetPx
          };
      } else {
          rotHandlePos = { x: rx, y: ry - rotationOffsetPx };
      }
  }

  const getPosOnGradient = (offset: number): Vec2 => {
    if (gradient.type === 'conic') {
        const angleDeg = gradient.angle + offset * 360 - 90;
        const rad = degreesToRadians(angleDeg);
        return {
            x: center.x + (conicRadius / layer.width) * Math.cos(rad),
            y: center.y + (conicRadius / layer.height) * Math.sin(rad)
        };
    }
    if (gradient.type === 'radial') {
       const rad = degreesToRadians(gradient.angle - 90);
       return {
         x: center.x + offset * radius * Math.cos(rad),
         y: center.y + offset * radius * Math.sin(rad)
       };
    }
    return {
      x: renderStart.x + (renderEnd.x - renderStart.x) * offset,
      y: renderStart.y + (renderEnd.y - renderStart.y) * offset
    };
  };

  const getProjectionT = (mx: number, my: number) => {
      if (gradient.type === 'conic') {
           const dx = mx - center.x * layer.width;
           const dy = my - center.y * layer.height;
           let angleRad = Math.atan2(dy, dx); 
           let angleDeg = (angleRad * 180 / Math.PI) + 90; 
           angleDeg = (angleDeg + 360) % 360; 
           let relativeDeg = angleDeg - gradient.angle;
           relativeDeg = (relativeDeg + 360) % 360;
           return relativeDeg / 360;
      }

      let ax, ay, bx, by;
      if (gradient.type === 'radial') {
          ax = center.x * layer.width;
          ay = center.y * layer.height;
          bx = radiusPos.x * layer.width;
          by = radiusPos.y * layer.height;
      } else {
          ax = renderStart.x * layer.width;
          ay = renderStart.y * layer.height;
          bx = renderEnd.x * layer.width;
          by = renderEnd.y * layer.height;
      }
      
      const abx = bx - ax;
      const aby = by - ay;
      const apx = mx - ax;
      const apy = my - ay;
      
      const lenSq = abx*abx + aby*aby;
      if (lenSq === 0) return 0;
      return (apx * abx + apy * aby) / lenSq;
  };

  const handlePointerDown = (e: React.PointerEvent, id: string | null, type: 'stop' | 'midpoint' | 'line' | 'rotate' | 'center', extraData?: any) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setInteractionMode('dragging-gradient');

    let state: DragState | null = null;

    if (type === 'rotate') {
        const isPointBased = gradient.type === 'linear' && !!gradient.start && !!gradient.end;
        const dx = (renderEnd.x - renderStart.x) * layer.width;
        const dy = (renderEnd.y - renderStart.y) * layer.height;
        const currentLen = Math.sqrt(dx*dx + dy*dy);

        state = { 
            type: 'rotate', 
            center: rotCenter,
            isPointBased,
            currentLen,
            startAngle: gradient.angle
        };
        setIsRotating(true);
    } else if (type === 'center') {
        state = { type: 'move-center' };
    } else if (type === 'stop') {
        const offset = extraData as number;
        if (gradient.type !== 'conic') {
             if (Math.abs(offset - 0) < 0.001) state = { type: 'move-start', id: id! };
             else if (Math.abs(offset - 1) < 0.001) state = { type: 'move-end', id: id! };
             else state = { type: 'move-stop', id: id! };
        } else {
             state = { type: 'move-stop', id: id! };
        }
        if (id) setSelectedStopId(id);

    } else if (type === 'midpoint') {
        state = { type: 'move-midpoint', stopId: id!, ...extraData };
    } else if (type === 'line') {
        const mousePos = getLocalPoint({ x: e.clientX, y: e.clientY }, viewport, layer);
        const mx = mousePos.x * layer.width;
        const my = mousePos.y * layer.height;
        const t = Math.max(0.01, Math.min(0.99, getProjectionT(mx, my)));
        state = { type: 'potential-stop', startX: e.clientX, startY: e.clientY, t, valid: true };
    }

    dragRef.current = { 
        active: true, 
        hasMoved: false,
        startPos: { x: e.clientX, y: e.clientY },
        state 
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active || !dragRef.current.state) return;
    e.stopPropagation();
    e.preventDefault();

    const dx = e.clientX - dragRef.current.startPos.x;
    const dy = e.clientY - dragRef.current.startPos.y;
    if (dx*dx + dy*dy > 16) dragRef.current.hasMoved = true;

    const mousePos = getLocalPoint({ x: e.clientX, y: e.clientY }, viewport, layer);
    const mx = mousePos.x * layer.width;
    const my = mousePos.y * layer.height;

    const state = dragRef.current.state;

    if (state.type === 'rotate') {
        const dX = mx - state.center.x;
        const dY = my - state.center.y;
        
        const rad = Math.atan2(dY, dX);
        let cssDeg = (rad * 180 / Math.PI) + 90;
        cssDeg = (cssDeg + 360) % 360;

        const updates: Partial<any> = { angle: cssDeg };

        if (state.isPointBased && gradient.type === 'linear') {
            const halfLen = state.currentLen / 2;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            
            const vx = cos * halfLen;
            const vy = sin * halfLen;
            
            const nsx = state.center.x - vx;
            const nsy = state.center.y - vy;
            const nex = state.center.x + vx;
            const ney = state.center.y + vy;
            
            updates.start = { x: nsx / layer.width, y: nsy / layer.height };
            updates.end = { x: nex / layer.width, y: ney / layer.height };
        }
        updateLayerGradient(layerId, updates);
        return;
    }

    if (state.type === 'potential-stop') {
        if (dragRef.current.hasMoved) state.valid = false;
        return;
    }

    if (state.type === 'move-center') {
        updateLayerGradient(layerId, { center: mousePos });
        return;
    }

    if (state.type === 'move-start') {
        if (gradient.type === 'linear') {
            updateLayerGradient(layerId, { start: mousePos, end: end });
        } else if (gradient.type === 'radial') {
            updateLayerGradient(layerId, { center: mousePos });
        }
        return;
    }

    if (state.type === 'move-end') {
        if (gradient.type === 'linear') {
            updateLayerGradient(layerId, { end: mousePos, start: start });
        } else if (gradient.type === 'radial') {
             const distPx = Math.sqrt(Math.pow(mx - center.x * layer.width, 2) + Math.pow(my - center.y * layer.height, 2));
             const newRadius = distPx / layer.width;
             updateLayerGradient(layerId, { radius: newRadius });
        }
        return;
    }

    let t = getProjectionT(mx, my);

    if (state.type === 'move-stop') {
         if (gradient.type !== 'conic') {
             t = Math.max(0.01, Math.min(0.99, t)); 
         }
         updateGradientStop(layerId, state.id, { offset: t });

    } else if (state.type === 'move-midpoint') {
         let range = state.endStopOffset - state.startStopOffset;
         let localT = 0.5;
         if (gradient.type === 'conic') {
             if (range < 0) range += 1;
             let relT = t - state.startStopOffset;
             if (relT < 0) relT += 1;
             localT = relT / range;
         } else {
             if (range > 0.001) localT = (t - state.startStopOffset) / range;
         }
         localT = Math.max(0.1, Math.min(0.9, localT));
         updateGradientStop(layerId, state.stopId, { midpoint: localT });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current.active) {
        const { state, hasMoved } = dragRef.current;
        if (!hasMoved && state) {
            if (state.type === 'move-stop' || state.type === 'move-start' || state.type === 'move-end') {
                setSelectedStopId(state.id);
            } else if (state.type === 'potential-stop' && state.valid) {
                 const color = getGradientColorAt(state.t, gradient.stops);
                 addGradientStop(layerId, state.t, color);
            }
        }
        dragRef.current = { active: false, hasMoved: false, startPos: {x:0, y:0}, state: null };
        (e.target as Element).releasePointerCapture(e.pointerId);
        setInteractionMode('idle');
        setIsRotating(false);
    }
  };

  const handleLineHover = (e: React.PointerEvent) => {
      if (dragRef.current.active) {
          if (previewStop) setPreviewStop(null);
          return;
      }
      const mousePos = getLocalPoint({ x: e.clientX, y: e.clientY }, viewport, layer);
      const mx = mousePos.x * layer.width;
      const my = mousePos.y * layer.height;
      let t = getProjectionT(mx, my);
      if (gradient.type !== 'conic') t = Math.max(0.01, Math.min(0.99, t));
      const color = getGradientColorAt(t, gradient.stops);
      const pos = getPosOnGradient(t); 
      setPreviewStop({ x: pos.x, y: pos.y, color });
  };

  const handleLineLeave = () => setPreviewStop(null);
  
  const handleDeleteStop = (id: string) => {
      removeGradientStop(layerId, id);
      setSelectedStopId(null);
  };

  const stopRadius = 8 / viewport.zoom; 
  const strokeWidth = 2 / viewport.zoom;
  const lineTouchWidth = 20 / viewport.zoom;
  const triggerZoneRadius = 40 / viewport.zoom;
  const rotIconSize = 24 / viewport.zoom;

  const showRotationControl = isRotating || isHoveringRotationZone;

  const selectedStop = selectedStopId ? gradient.stops.find(s => s.id === selectedStopId) : null;
  let popupElement = null;

  if (selectedStop && interactionMode === 'idle') {
      const pos = getPosOnGradient(selectedStop.offset);
      const screenPos = getStopScreenPosition(pos, layer, viewport);
      const isEndpoint = (gradient.type !== 'conic') && (Math.abs(selectedStop.offset) < 0.001 || Math.abs(selectedStop.offset - 1) < 0.001);

      popupElement = (
          <StopPopup 
              key={selectedStop.id}
              x={screenPos.x}
              y={screenPos.y}
              color={selectedStop.color}
              onChange={(c: string) => updateGradientStop(layerId, selectedStop.id, { color: c })}
              onDelete={!isEndpoint ? () => handleDeleteStop(selectedStop.id) : undefined}
          />
      );
  }

  return (
    <>
        <g 
            className="gradient-overlay"
            transform={`translate(${layer.x}, ${layer.y}) rotate(${layer.rotation})`}
        >
            {gradient.type === 'conic' && (
                <ellipse
                    cx={center.x * layer.width}
                    cy={center.y * layer.height}
                    rx={conicRadius}
                    ry={conicRadius}
                    fill="none"
                    stroke="white"
                    strokeWidth={strokeWidth}
                    className="drop-shadow-sm"
                />
            )}
            
            {gradient.type === 'conic' && (
                <ellipse
                    cx={center.x * layer.width}
                    cy={center.y * layer.height}
                    rx={conicRadius}
                    ry={conicRadius}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={lineTouchWidth}
                    cursor="copy"
                    onPointerDown={(e) => handlePointerDown(e, null, 'line')}
                    onPointerMove={(e) => { handlePointerMove(e); handleLineHover(e); }}
                    onPointerLeave={handleLineLeave}
                    onPointerUp={handlePointerUp}
                />
            )}

            {(gradient.type === 'linear' || gradient.type === 'radial') && (
                <line
                    x1={gradient.type === 'radial' ? center.x * layer.width : renderStart.x * layer.width}
                    y1={gradient.type === 'radial' ? center.y * layer.height : renderStart.y * layer.height}
                    x2={gradient.type === 'radial' ? radiusPos.x * layer.width : renderEnd.x * layer.width}
                    y2={gradient.type === 'radial' ? radiusPos.y * layer.height : renderEnd.y * layer.height}
                    stroke="transparent"
                    strokeWidth={lineTouchWidth}
                    cursor="copy"
                    onPointerDown={(e) => handlePointerDown(e, null, 'line')}
                    onPointerMove={(e) => { handlePointerMove(e); handleLineHover(e); }}
                    onPointerLeave={handleLineLeave}
                    onPointerUp={handlePointerUp}
                />
            )}
            
            {(gradient.type === 'linear' || gradient.type === 'radial') && (
                <>
                    {gradient.type === 'radial' && (
                        <ellipse
                            cx={center.x * layer.width}
                            cy={center.y * layer.height}
                            rx={radius * layer.width}
                            ry={radius * layer.height}
                            fill="none"
                            stroke="white"
                            strokeWidth={strokeWidth * 0.5}
                            strokeDasharray={`${4/viewport.zoom} ${4/viewport.zoom}`}
                            opacity={0.6}
                            pointerEvents="none"
                            transform={`rotate(${gradient.angle}, ${center.x * layer.width}, ${center.y * layer.height})`}
                        />
                    )}
                    <line
                        x1={gradient.type === 'radial' ? center.x * layer.width : renderStart.x * layer.width}
                        y1={gradient.type === 'radial' ? center.y * layer.height : renderStart.y * layer.height}
                        x2={gradient.type === 'radial' ? radiusPos.x * layer.width : renderEnd.x * layer.width}
                        y2={gradient.type === 'radial' ? radiusPos.y * layer.height : renderEnd.y * layer.height}
                        stroke="white"
                        strokeWidth={strokeWidth}
                        pointerEvents="none"
                        className="drop-shadow-sm"
                    />
                </>
            )}
            
            {(gradient.type === 'radial' || gradient.type === 'conic') && (
                <circle
                    cx={center.x * layer.width}
                    cy={center.y * layer.height}
                    r={stopRadius}
                    fill="white"
                    stroke="black"
                    strokeWidth={1}
                    cursor="move"
                    onPointerDown={(e) => handlePointerDown(e, null, 'center')}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                />
            )}

            <g>
                <circle
                    cx={triggerZonePos.x}
                    cy={triggerZonePos.y}
                    r={triggerZoneRadius}
                    fill="transparent"
                    onPointerEnter={() => setIsHoveringRotationZone(true)}
                    onPointerLeave={() => setIsHoveringRotationZone(false)}
                    style={{ pointerEvents: isRotating ? 'none' : 'auto' }}
                />

                <g 
                    style={{ 
                        opacity: showRotationControl ? 1 : 0, 
                        transition: 'opacity 0.2s ease-out',
                        pointerEvents: showRotationControl ? 'auto' : 'none'
                    }}
                >
                    <line
                        x1={triggerZonePos.x}
                        y1={triggerZonePos.y}
                        x2={rotHandlePos.x}
                        y2={rotHandlePos.y}
                        stroke="white"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        opacity={0.5}
                        pointerEvents="none"
                    />
                    
                    <foreignObject
                        x={rotHandlePos.x - (rotIconSize / 2)}
                        y={rotHandlePos.y - (rotIconSize / 2)}
                        width={rotIconSize}
                        height={rotIconSize}
                        style={{ overflow: 'visible', pointerEvents: 'none' }}
                    >
                        <div 
                            className="w-full h-full bg-white dark:bg-zinc-800 rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.2)] border border-zinc-200 dark:border-zinc-600 flex items-center justify-center text-zinc-700 dark:text-zinc-200"
                            style={{ transform: 'scale(1)' }}
                        >
                            <RotateCw size={rotIconSize * 0.6} strokeWidth={2.5} />
                        </div>
                    </foreignObject>
                    
                    <circle
                            cx={rotHandlePos.x}
                            cy={rotHandlePos.y}
                            r={rotIconSize}
                            fill="transparent"
                            style={{ cursor: isRotating ? 'grabbing' : 'grab' }}
                            onPointerDown={(e) => handlePointerDown(e, null, 'rotate')}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerEnter={() => setIsHoveringRotationZone(true)}
                            onPointerLeave={() => setIsHoveringRotationZone(false)}
                    />

                    {isRotating && (
                        <foreignObject 
                            x={rotHandlePos.x + (16 / viewport.zoom)} 
                            y={rotHandlePos.y - (12 / viewport.zoom)} 
                            width={100} height={40}
                            style={{ overflow: 'visible', pointerEvents: 'none' }}
                        >
                            <div 
                                className="bg-black/80 backdrop-blur text-white font-medium px-2 py-1 rounded-full shadow-lg whitespace-nowrap border border-white/10 flex items-center justify-center"
                                style={{ 
                                    transform: `scale(${1/viewport.zoom})`,
                                    transformOrigin: 'top left',
                                    fontSize: '11px'
                                }}
                            >
                                {Math.round(gradient.angle)}°
                            </div>
                        </foreignObject>
                    )}
                </g>
            </g>

            {previewStop && !dragRef.current.active && (
                <g pointerEvents="none">
                    <circle
                        cx={previewStop.x * layer.width}
                        cy={previewStop.y * layer.height}
                        r={stopRadius}
                        fill={previewStop.color}
                        stroke="white"
                        strokeWidth={strokeWidth}
                        opacity={0.8}
                    />
                </g>
            )}

            {gradient.stops.map((stop, i) => {
                const pos = getPosOnGradient(stop.offset);
                let midElement = null;
                if (i < gradient.stops.length - 1) {
                    const next = gradient.stops[i+1];
                    const mid = stop.midpoint !== undefined ? stop.midpoint : 0.5;
                    const absoluteMidOffset = stop.offset + (next.offset - stop.offset) * mid;
                    const midPos = getPosOnGradient(absoluteMidOffset);
                    midElement = (
                        <g 
                            key={`mid-${stop.id}`}
                            transform={`translate(${midPos.x * layer.width}, ${midPos.y * layer.height}) rotate(45)`}
                            className="cursor-move group"
                            onPointerDown={(e) => handlePointerDown(e, stop.id, 'midpoint', { startStopOffset: stop.offset, endStopOffset: next.offset })}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                        >
                            <rect x={-stopRadius*0.7} y={-stopRadius*0.7} width={stopRadius*1.4} height={stopRadius*1.4} fill="#3b82f6" stroke="white" strokeWidth={strokeWidth} />
                        </g>
                    );
                }

                const isEndpoint = (gradient.type !== 'conic') && (Math.abs(stop.offset) < 0.001 || Math.abs(stop.offset - 1) < 0.001);
                const isSelected = selectedStopId === stop.id;

                return (
                    <React.Fragment key={stop.id}>
                        {midElement}
                        <g key={stop.id}>
                            <circle
                                cx={pos.x * layer.width} cy={pos.y * layer.height}
                                r={isEndpoint ? stopRadius * 1.2 : stopRadius}
                                fill={stop.color} stroke={isSelected ? "#3b82f6" : "white"} strokeWidth={isSelected ? strokeWidth * 2.5 : strokeWidth}
                                pointerEvents="none"
                            />
                            <circle
                                cx={pos.x * layer.width} cy={pos.y * layer.height} r={20 / viewport.zoom} 
                                fill="transparent" cursor="move"
                                onPointerDown={(e) => handlePointerDown(e, stop.id, 'stop', stop.offset)}
                                onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
                                onMouseEnter={() => setHoveredHandle(stop.id)} onMouseLeave={() => setHoveredHandle(null)}
                            />
                        </g>
                    </React.Fragment>
                );
            })}
        </g>
        {popupElement}
    </>
  );
};
