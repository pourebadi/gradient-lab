
import React, { useRef, useState, useEffect } from 'react';
import { useStore } from '../../store';
import { degreesToRadians } from '../../utils';

interface ResizeHandlesProps {
  layerId: string;
}

const HANDLES = [
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5 },
  { id: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { id: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { id: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
];

export const ResizeHandles: React.FC<ResizeHandlesProps> = ({ layerId }) => {
  const { layers, viewport, updateLayer, setInteractionMode, saveSnapshot } = useStore();
  const layer = layers[layerId];

  const dragRef = useRef<{
    active: boolean;
    handle: string;
    startX: number;
    startY: number;
    initial: { x: number; y: number; width: number; height: number; rotation: number };
  } | null>(null);

  if (!layer) return null;

  const handlePointerDown = (e: React.PointerEvent, handleId: string) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    
    setInteractionMode('resizing');
    saveSnapshot(); // Save before start dragging

    dragRef.current = {
      active: true,
      handle: handleId,
      startX: e.clientX,
      startY: e.clientY,
      initial: {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation
      }
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current?.active) return;
    e.stopPropagation();
    e.preventDefault();

    const { startX, startY, initial, handle } = dragRef.current;
    
    // Calculate delta in screen space
    const dxScreen = e.clientX - startX;
    const dyScreen = e.clientY - startY;

    // Convert to canvas space
    const dxCanvas = dxScreen / viewport.zoom;
    const dyCanvas = dyScreen / viewport.zoom;

    // Rotate delta to align with layer's local axes
    // We rotate the delta vector by -rotation
    const rad = degreesToRadians(-initial.rotation);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dxLocal = dxCanvas * cos - dyCanvas * sin;
    const dyLocal = dxCanvas * sin + dyCanvas * cos;

    let newX = initial.x;
    let newY = initial.y;
    let newWidth = initial.width;
    let newHeight = initial.height;

    // Apply resizing based on handle
    if (handle.includes('e')) {
      newWidth = Math.max(1, initial.width + dxLocal);
    }
    if (handle.includes('w')) {
      const w = Math.max(1, initial.width - dxLocal);
      const deltaW = initial.width - w; // Amount width shrank (positive) or grew (negative)
      // If we shrink width, we must move x to the right. 
      // The shift in local space is (initial.width - newWidth, 0) if shrinking?
      // Actually simpler: 
      // width changed by -dxLocal. 
      // We need to shift the origin by dxLocal along the local X axis.
      
      // Calculate shift in Global space
      // Shift vector local: (dxLocal, 0) -> Global: rotate(dxLocal, 0) by +rotation
      const shiftRad = degreesToRadians(initial.rotation);
      const shiftX = dxLocal * Math.cos(shiftRad);
      const shiftY = dxLocal * Math.sin(shiftRad);
      
      newX += shiftX;
      newY += shiftY;
      newWidth = w;
    }

    if (handle.includes('s')) {
      newHeight = Math.max(1, initial.height + dyLocal);
    }
    if (handle.includes('n')) {
      const h = Math.max(1, initial.height - dyLocal);
      
      // Shift origin by dyLocal along local Y axis
      // Shift vector local: (0, dyLocal) -> Global
      const shiftRad = degreesToRadians(initial.rotation);
      // Rotated vector (0, y): x' = -y*sin, y' = y*cos
      const shiftX = -dyLocal * Math.sin(shiftRad);
      const shiftY = dyLocal * Math.cos(shiftRad);

      newX += shiftX;
      newY += shiftY;
      newHeight = h;
    }

    updateLayer(layerId, {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    }, false); // Don't record history on every frame
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.active) {
       (e.target as Element).releasePointerCapture(e.pointerId);
       setInteractionMode('idle');
       // Final commit could be done here if needed, but we saved snapshot at start
       // and updated live. We might want to ensure the final state is captured in a "clean" way 
       // but `updateLayer` false handles live updates. 
       // Usually we want to save snapshot BEFORE drag (done) and then the end state is just the current state.
       // The next action will create a new snapshot.
    }
    dragRef.current = null;
  };

  // Visual constants
  const handleSize = 8 / viewport.zoom;
  const borderSize = 1 / viewport.zoom;

  return (
    <g transform={`translate(${layer.x}, ${layer.y}) rotate(${layer.rotation})`}>
      {/* Bounding Box Outline (Optional enhancement over the standard selection ring) */}
      <rect 
        x={0} y={0} width={layer.width} height={layer.height}
        fill="none" stroke="#3b82f6" strokeWidth={borderSize} pointerEvents="none"
      />

      {HANDLES.map(h => {
        const hx = h.x * layer.width;
        const hy = h.y * layer.height;
        
        return (
          <rect
            key={h.id}
            x={hx - handleSize / 2}
            y={hy - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="white"
            stroke="#3b82f6"
            strokeWidth={borderSize}
            style={{ cursor: h.cursor }}
            onPointerDown={(e) => handlePointerDown(e, h.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        );
      })}
    </g>
  );
};
