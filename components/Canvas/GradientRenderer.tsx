
import React from 'react';
import { getGradientCoords, interpolateColor } from '../../utils';
import { Gradient as GradientType, GradientStop } from '../../types';

interface GradientRendererProps {
  id: string; // Unique ID for the definition
  gradient: GradientType;
  width: number;
  height: number;
}

// Helper to inject midpoints into a stop list
const processStops = (stops: GradientStop[]): GradientStop[] => {
    const processed: GradientStop[] = [];
    for (let i = 0; i < stops.length; i++) {
        const current = stops[i];
        processed.push(current);
        if (i < stops.length - 1) {
            const next = stops[i+1];
            const mid = current.midpoint !== undefined ? current.midpoint : 0.5;
            if (Math.abs(mid - 0.5) > 0.01) {
                const midOffset = current.offset + (next.offset - current.offset) * mid;
                const midColor = interpolateColor(current.color, next.color, 0.5);
                processed.push({
                    id: `mid-${current.id}-${next.id}`,
                    offset: midOffset,
                    color: midColor,
                    opacity: (current.opacity + next.opacity) / 2
                });
            }
        }
    }
    return processed;
};

export const GradientRenderer: React.FC<GradientRendererProps> = ({ id, gradient, width, height }) => {
  const { type, stops, angle, center, start, end, radius } = gradient;
  const processedStops = processStops(stops);

  if (type === 'linear') {
    let coords;
    // For Linear, we stick to objectBoundingBox (%) for simplicity as it handles resizing gracefully 
    // without needing constant re-renders of the defs for every pixel change, 
    // unless we want strict angle preservation on non-square ratios (which gets complex).
    // The current "Overlay" logic compensates for this by adjusting start/end points during interaction.
    if (start && end) {
      coords = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    } else {
      coords = getGradientCoords(angle);
    }

    return (
      <linearGradient
        id={id}
        x1={`${coords.x1 * 100}%`}
        y1={`${coords.y1 * 100}%`}
        x2={`${coords.x2 * 100}%`}
        y2={`${coords.y2 * 100}%`}
      >
        {processedStops.map((stop) => (
          <stop
            key={stop.id}
            offset={`${stop.offset * 100}%`}
            stopColor={stop.color}
            stopOpacity={stop.opacity}
          />
        ))}
      </linearGradient>
    );
  }

  if (type === 'radial') {
    // For Radial, we use userSpaceOnUse to properly handle Rotation + Aspect Ratio stretching
    const cx = center.x * width;
    const cy = center.y * height;
    const r = (radius !== undefined ? radius : 0.5) * width; // Base radius on width
    
    // Calculate aspect ratio scale
    const sy = height / width;
    
    // Transform: Rotate around center, then Scale around center (to match aspect ratio)
    // Order applied to coordinate system: Translate -> Rotate -> Scale -> TranslateBack
    const transform = `rotate(${angle}, ${cx}, ${cy}) translate(${cx}, ${cy}) scale(1, ${sy}) translate(${-cx}, ${-cy})`;

    return (
      <radialGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        cx={cx}
        cy={cy}
        r={r}
        fx={cx}
        fy={cy}
        gradientTransform={transform}
      >
        {processedStops.map((stop) => (
          <stop
            key={stop.id}
            offset={`${stop.offset * 100}%`}
            stopColor={stop.color}
            stopOpacity={stop.opacity}
          />
        ))}
      </radialGradient>
    );
  }

  return null; 
};

export const ComplexGradientRenderer: React.FC<{ gradient: GradientType; width: number; height: number; borderRadius?: number }> = ({ gradient, width, height, borderRadius }) => {
  const processedStops = processStops(gradient.stops);
  
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: borderRadius || 0,
  };

  if (gradient.type === 'conic') {
    const stopString = processedStops
      .map(s => `${s.color} ${s.offset * 100}%`)
      .join(', ');
    style.background = `conic-gradient(from ${gradient.angle}deg at ${gradient.center.x * 100}% ${gradient.center.y * 100}%, ${stopString})`;
  }

  return (
    <foreignObject width={width} height={height} style={{ overflow: 'visible' }}>
      <div style={style} />
    </foreignObject>
  );
};
