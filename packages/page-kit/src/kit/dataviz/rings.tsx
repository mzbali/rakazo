import { useId } from "react";
import { seriesColor, text } from "./shared.js";

type Marker = { ring: number; label: string };

const CENTER = { x: 160, y: 113 };
const OUTSIDE = 100;
const STEP = 19;

/** Nested zones around a destination, with up to two locations marked in their bands. */
export function Rings({
  rings,
  center,
  markers,
}: {
  rings?: string[];
  center?: string;
  markers?: Marker[];
}) {
  const titleId = useId();
  const bands = (Array.isArray(rings) ? rings : []).slice(0, 4).map(text);
  if (bands.length < 2) return null;
  const locations = (Array.isArray(markers) ? markers : [])
    .filter((marker) => marker && Number.isInteger(marker.ring) && bands[marker.ring] !== undefined)
    .slice(0, 2);
  const description = [
    text(center),
    ...bands.map(text),
    ...locations.map((marker) => `${text(marker.label)} (${text(bands[marker.ring])})`),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <svg className="rk-rings rk-frame" viewBox="0 0 320 226" role="img" aria-labelledby={titleId}>
      <title id={titleId}>{description}</title>
      {bands.map((label, index) => {
        const radius = OUTSIDE - index * STEP;
        return (
          <g key={index}>
            <circle className="rk-rings-band" cx={CENTER.x} cy={CENTER.y} r={radius} />
            <text className="rk-rings-label" x={CENTER.x} y={CENTER.y - radius + 13}>
              {text(label)}
            </text>
          </g>
        );
      })}
      <circle className="rk-rings-center" cx={CENTER.x} cy={CENTER.y} r={3} />
      <text x={CENTER.x} y={CENTER.y - 11}>
        {text(center)}
      </text>
      {locations.map((marker, index) => {
        const radius = OUTSIDE - (marker.ring + 0.5) * STEP;
        const x = CENTER.x + radius * (index === 0 ? -0.8 : 0.8);
        const y = CENTER.y + radius * 0.6;
        return (
          <g key={index}>
            <line className="rk-rings-guide" x1={CENTER.x} y1={CENTER.y} x2={x} y2={y} />
            <circle cx={x} cy={y} r={5} className="rk-rings-pin" fill={seriesColor(index)} />
            <text className="rk-rings-location" x={x} y={y + 20}>
              {text(marker.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
