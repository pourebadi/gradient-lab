
import React, { useRef, useState, useEffect } from 'react';
import { useStore } from '../../store';
import { screenToCanvas, generateId, snapToGrid, clamp, getLocalPoint, getGradientT } from '../../utils';
import { GradientRenderer, ComplexGradientRenderer } from './GradientRenderer';
import { Layer } from '../../types';
import { GradientOverlay } from './GradientOverlay';
import { ResizeHandles } from './ResizeHandles';

export const InfiniteCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { 
    viewport, panCanvas, zoomCanvas, 
    layers, layerOrder, activeTool, addLayer, 
    selectedIds, setSelection, updateLayer, theme,
    interactionMode, setInteractionMode, setTool,
    addGradientStop, updateLayerGradient,
    gridPreferences
  } = useStore();

  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 }); // Canvas coordinates
  const dragStartScreenPos = useRef({ x: 0, y: 0 }); // Screen coordinates for accurate delta
  const dragTarget = useRef<string | null>(null);
  const dragInitialLayerPos = useRef({ x: 0, y: 0 }); // Snapshot of layer position at start
  
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  
  // Temporary drawing state
  const [drawingRect, setDrawingRect] = useState<{x:number, y:number, w:number, h:number} | null>(null);

  // --- Gesture Prevention & Keyboard Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !e.repeat && (e.target as HTMLElement).tagName !== 'INPUT') {
            setSpacePressed(true);
        }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') setSpacePressed(false);
    };

    // Prevent Safari/Chrome "Pinch to Zoom Page" gestures
    const preventDefault = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', preventDefault);
    document.addEventListener('gesturechange', preventDefault);
    document.addEventListener('gestureend', preventDefault);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        document.removeEventListener('gesturestart', preventDefault);
        document.removeEventListener('gesturechange', preventDefault);
        document.removeEventListener('gestureend', preventDefault);
    };
  }, []);

  // --- Wheel Handling (Modernized) ---
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.ctrlKey || e.metaKey) {
       const zoomIntensity = 2.5; 
       zoomCanvas(e.deltaY * zoomIntensity, { x: e.clientX, y: e.clientY });
    } else {
       panCanvas(-e.deltaX, -e.deltaY);
    }
  };

  // --- Drag & Drop (Colors) ---
  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault(); 
      e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const color = e.dataTransfer.getData('color');
      if (!color) return;

      const canvasPos = screenToCanvas({ x: e.clientX, y: e.clientY }, viewport);

      // Hit test layers
      let hitId = null;
      for (let i = layerOrder.length - 1; i >= 0; i--) {
        const layer = layers[layerOrder[i]];
        if (
          canvasPos.x >= layer.x &&
          canvasPos.x <= layer.x + layer.width &&
          canvasPos.y >= layer.y &&
          canvasPos.y <= layer.y + layer.height
        ) {
          hitId = layer.id;
          break;
        }
      }

      if (hitId) {
          const layer = layers[hitId];
          if (typeof layer.fill === 'string') {
               // Convert solid to basic linear and add stop at drop projected position (roughly)
               // Simple default: Linear 135deg.
               updateLayerGradient(hitId, { 
                   type: 'linear', 
                   angle: 135,
                   stops: [
                       { id: generateId(), offset: 0, color: layer.fill, opacity: 1 },
                       { id: generateId(), offset: 1, color: color, opacity: 1 }
                   ]
               });
          } else {
               // Existing gradient: calculate projection T
               const localPos = getLocalPoint({ x: e.clientX, y: e.clientY }, viewport, layer);
               const t = getGradientT(
                   localPos.x * layer.width, 
                   localPos.y * layer.height, 
                   layer.fill, 
                   layer.width, 
                   layer.height
               );
               addGradientStop(hitId, t, color);
          }
          setSelection([hitId]);
      }
  };


  // --- Pointer Interaction ---
  const handlePointerDown = (e: React.PointerEvent) => {
    if (interactionMode !== 'idle') return;

    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    dragStartScreenPos.current = { x: e.clientX, y: e.clientY };
    
    const canvasPos = screenToCanvas({ x: e.clientX, y: e.clientY }, viewport);
    dragStartPos.current = canvasPos;

    if (spacePressed || activeTool === 'pan' || e.button === 1) {
        dragTarget.current = 'pan';
        setInteractionMode('panning');
        return;
    }

    if (activeTool === 'artboard') {
        setInteractionMode('drawing');
        setDrawingRect({ x: canvasPos.x, y: canvasPos.y, w: 0, h: 0 });
        setSelection([]); 
        return;
    }

    let hitId = null;
    for (let i = layerOrder.length - 1; i >= 0; i--) {
      const layer = layers[layerOrder[i]];
      const labelHeight = layer.type === 'artboard' ? (24 / viewport.zoom) : 0;
      
      if (
        canvasPos.x >= layer.x &&
        canvasPos.x <= layer.x + layer.width &&
        canvasPos.y >= layer.y - labelHeight &&
        canvasPos.y <= layer.y + layer.height
      ) {
        hitId = layer.id;
        break;
      }
    }

    if (hitId) {
        setSelection([hitId]); 
        dragTarget.current = hitId;
        
        const targetLayer = layers[hitId];
        dragInitialLayerPos.current = { x: targetLayer.x, y: targetLayer.y };

        setInteractionMode('dragging-layer');
        (e.target as Element).setPointerCapture(e.pointerId);
    } else {
        setSelection([]); 
        dragTarget.current = 'pan'; 
        setInteractionMode('panning');
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const canvasPos = screenToCanvas({ x: e.clientX, y: e.clientY }, viewport);

    if (interactionMode === 'idle' && !spacePressed) {
        let hitId = null;
        for (let i = layerOrder.length - 1; i >= 0; i--) {
            const layer = layers[layerOrder[i]];
            const labelHeight = layer.type === 'artboard' ? (24 / viewport.zoom) : 0;
            if (
                canvasPos.x >= layer.x &&
                canvasPos.x <= layer.x + layer.width &&
                canvasPos.y >= layer.y - labelHeight &&
                canvasPos.y <= layer.y + layer.height
            ) {
                hitId = layer.id;
                break;
            }
        }
        setHoveredLayerId(hitId);
    }

    if (!isDragging.current) return;

    const screenDx = e.clientX - dragStartScreenPos.current.x;
    const screenDy = e.clientY - dragStartScreenPos.current.y;
    
    if (interactionMode === 'panning') {
        const frameDx = e.clientX - lastMousePos.current.x;
        const frameDy = e.clientY - lastMousePos.current.y;
        panCanvas(frameDx, frameDy);
    } 
    else if (interactionMode === 'dragging-layer' && dragTarget.current) {
        const canvasDx = screenDx / viewport.zoom;
        const canvasDy = screenDy / viewport.zoom;
        
        const newX = dragInitialLayerPos.current.x + canvasDx;
        const newY = dragInitialLayerPos.current.y + canvasDy;

        updateLayer(dragTarget.current, {
            x: newX,
            y: newY
        }, false);
    }
    else if (interactionMode === 'drawing') {
        const x = Math.min(dragStartPos.current.x, canvasPos.x);
        const y = Math.min(dragStartPos.current.y, canvasPos.y);
        const w = Math.abs(canvasPos.x - dragStartPos.current.x);
        const h = Math.abs(canvasPos.y - dragStartPos.current.y);
        setDrawingRect({ x, y, w, h });
    }

    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    
    if (interactionMode === 'dragging-layer' && dragTarget.current) {
        updateLayer(dragTarget.current, {}, true); // Save snapshot
        (e.target as Element).releasePointerCapture(e.pointerId);
    }
    else if (interactionMode === 'drawing' && drawingRect) {
        if (drawingRect.w > 10 && drawingRect.h > 10) {
            const newId = generateId();
            addLayer({
                id: newId,
                type: 'artboard',
                name: 'New Artboard',
                x: drawingRect.x,
                y: drawingRect.y,
                width: drawingRect.w,
                height: drawingRect.h,
                rotation: 0,
                visible: true,
                fill: '#ffffff'
            });
        }
        setDrawingRect(null);
        setTool('select');
    }

    isDragging.current = false;
    dragTarget.current = null;
    setInteractionMode('idle');
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      const canvasPos = screenToCanvas({ x: e.clientX, y: e.clientY }, viewport);
      
      let hit = false;
      for (const id of layerOrder) {
          const l = layers[id];
          const labelHeight = l.type === 'artboard' ? (24 / viewport.zoom) : 0;
          if (
              canvasPos.x >= l.x && 
              canvasPos.x <= l.x + l.width &&
              canvasPos.y >= l.y - labelHeight && 
              canvasPos.y <= l.y + l.height
          ) {
              hit = true; 
              break;
          }
      }

      if (!hit) {
          const width = 800;
          const height = 600;
          const newId = generateId();
          addLayer({
              id: newId,
              type: 'artboard',
              name: 'New Artboard',
              x: canvasPos.x - width/2,
              y: canvasPos.y - height/2,
              width, height,
              rotation: 0,
              visible: true,
              fill: '#ffffff'
          });
      }
  };

  let cursor = 'default';
  if (spacePressed || activeTool === 'pan' || interactionMode === 'panning') {
      cursor = interactionMode === 'panning' ? 'grabbing' : 'grab';
  } else if (activeTool === 'artboard') {
      cursor = 'crosshair';
  } else if (interactionMode === 'dragging-layer') {
      cursor = 'move';
  } else if (hoveredLayerId && activeTool === 'select' && interactionMode === 'idle') {
      cursor = 'default';
  }

  // --- Grid Logic ---
  const { style: gridStyle, density, opacity: gridOpacity } = gridPreferences;
  
  let gridSize = 100; // default medium
  if (density === 'sparse') gridSize = 200;
  if (density === 'dense') gridSize = 50;
  
  // Base color matches theme text color roughly
  const baseGridColor = theme === 'dark' ? "255,255,255" : "0,0,0"; 
  const finalGridColor = `rgba(${baseGridColor}, ${gridOpacity})`;

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-zinc-200 dark:bg-zinc-850 relative overflow-hidden touch-none transition-colors duration-200"
      style={{ cursor }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <svg
        className="w-full h-full pointer-events-none absolute top-0 left-0"
      >
        <defs>
          <pattern id="grid" width={gridSize * viewport.zoom} height={gridSize * viewport.zoom} patternUnits="userSpaceOnUse">
            {gridStyle === 'linear' && (
                <path 
                    d={`M ${gridSize * viewport.zoom} 0 L 0 0 0 ${gridSize * viewport.zoom}`} 
                    fill="none" 
                    stroke={finalGridColor} 
                    strokeWidth="1"
                />
            )}
            {gridStyle === 'dot' && (
                <circle 
                    cx={1 * viewport.zoom} 
                    cy={1 * viewport.zoom} 
                    r={1.5 * viewport.zoom} 
                    fill={finalGridColor} 
                />
            )}
          </pattern>
          <pattern id="checkerboard" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
             <rect x="0" y="0" width="20" height="20" fill="#ffffff" />
             <rect x="0" y="0" width="10" height="10" fill="#e5e5e5" />
             <rect x="10" y="10" width="10" height="10" fill="#e5e5e5" />
          </pattern>
        </defs>

        {gridStyle !== 'none' && (
            <rect width="100%" height="100%" fill="url(#grid)" />
        )}

        <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
          {layerOrder.map((layerId) => {
            const layer = layers[layerId];
            const isSelected = selectedIds.includes(layerId);
            const isHovered = hoveredLayerId === layerId && !isSelected && interactionMode === 'idle' && activeTool === 'select';
            const isGradient = typeof layer.fill !== 'string';
            const gradientId = `grad-${layer.id}`;
            const complexGradient = isGradient && (layer.fill.type === 'conic' || layer.fill.type === 'freeform');

            return (
              <g key={layerId} transform={`translate(${layer.x}, ${layer.y}) rotate(${layer.rotation})`}>
                
                {isGradient && !complexGradient && (
                  <defs>
                    <GradientRenderer id={gradientId} gradient={layer.fill as any} width={layer.width} height={layer.height} />
                  </defs>
                )}

                <rect
                  width={layer.width}
                  height={layer.height}
                  fill="url(#checkerboard)"
                  className="drop-shadow-2xl transition-shadow" 
                />

                <rect
                  width={layer.width}
                  height={layer.height}
                  fill={
                    complexGradient 
                      ? 'none' 
                      : (isGradient ? `url(#${gradientId})` : (layer.fill as string))
                  }
                  stroke="none"
                  pointerEvents="all" 
                />

                {complexGradient && (
                  <ComplexGradientRenderer 
                    gradient={layer.fill as any} 
                    width={layer.width} 
                    height={layer.height} 
                    borderRadius={0} 
                  />
                )}

                {isHovered && (
                    <rect
                      width={layer.width} height={layer.height}
                      fill="none" stroke="#3b82f6" strokeWidth={2/viewport.zoom} strokeOpacity={0.5}
                      pointerEvents="none"
                    />
                )}

                {isSelected && (
                  <rect
                      x="-1" y="-1"
                      width={layer.width + 2}
                      height={layer.height + 2}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={2 / viewport.zoom}
                      pointerEvents="none"
                  />
                )}
                
                {layer.type === 'artboard' && (
                  <text 
                    x="0" y="-10" 
                    fill={isSelected ? "#3b82f6" : (theme === 'dark' ? "#71717a" : "#71717a")}
                    fontWeight={isSelected ? "bold" : "normal"}
                    fontSize={12 / viewport.zoom} 
                    fontFamily="sans-serif"
                    pointerEvents="none"
                  >
                    {layer.name}
                  </text>
                )}
              </g>
            );
          })}
          
          {drawingRect && (
              <rect 
                x={drawingRect.x} y={drawingRect.y} width={drawingRect.w} height={drawingRect.h}
                fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth={1/viewport.zoom}
              />
          )}

          {selectedIds.length === 1 && (
            <g style={{ pointerEvents: 'auto' }}>
                <ResizeHandles layerId={selectedIds[0]} />
                <GradientOverlay layerId={selectedIds[0]} />
            </g>
          )}

        </g>
      </svg>
    </div>
  );
};
