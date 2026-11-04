'use client';

import { useRef, useState } from 'react';
import { fileUrl } from '@/lib/prediction/api';
import type { Point } from '@/lib/prediction/geometry';

type Props = {
  projectId: string;
  floor: any;
  crosshair?: boolean;
  zoom: number;
  onPoint?: (point: Point, event: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onMove?: (point: Point) => void;
  onRelease?: (point: Point) => void;
  children?: React.ReactNode;
};

/** The plan image with an SVG in its own pixel coordinates. All geometry is drawn in those. */
export function PlanView({ projectId, floor, crosshair, zoom, onPoint, onDoubleClick, onMove, onRelease, children }: Props) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  function toPixels(event: React.MouseEvent): Point {
    const rect = svg.current!.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * size!.width, ((event.clientY - rect.top) / rect.height) * size!.height];
  }

  if (!floor?.plan_document_id) {
    return <div className="card muted">לקומה זו לא נבחרה תוכנית.</div>;
  }

  return (
    <div className="plan-frame">
      <div className={`plan-stage ${crosshair ? 'crosshair' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fileUrl(`/projects/${projectId}/documents/${floor.plan_document_id}/pages/${floor.plan_page}.png`)}
          alt="תוכנית"
          draggable={false}
          style={size ? { width: size.width * zoom, height: size.height * zoom } : undefined}
          onLoad={(event) => {
            const image = event.currentTarget;
            setSize({ width: image.naturalWidth, height: image.naturalHeight });
          }}
        />
        {size && (
          <svg
            ref={svg}
            viewBox={`0 0 ${size.width} ${size.height}`}
            data-testid="plan-svg"
            onClick={(event) => {
              // The second click of a double-click ends a shape; it adds no vertex.
              if (event.detail < 2) onPoint?.(toPixels(event), event);
            }}
            onDoubleClick={onDoubleClick}
            onMouseMove={(event) => onMove?.(toPixels(event))}
            onMouseUp={(event) => onRelease?.(toPixels(event))}
          >
            {children}
          </svg>
        )}
      </div>
    </div>
  );
}
