// Hourly temperature chart — projection math + SVG renderer.
//
// Two layers in one file:
//   1. PURE projection: (samples[], options) → ChartGeometry. No DOM.
//      Unit-tested in `hourly-chart.test.ts` per STORY-003 Acceptance Criteria
//      ("расчёт точек кривой ... покрыт unit-тестами").
//   2. DOM RENDERER: ChartGeometry → SVGSVGElement (+ a precipitation row).
//      Built with `document.createElementNS` only — never `innerHTML`
//      (CLAUDE.md › Security, mirrors `src/ui/icons.ts`).
//
// No chart libraries (CLAUDE.md › Tech Stack). The curve uses a Catmull-Rom →
// Bezier conversion so the line is smooth like the Google-widget reference
// without any non-determinism (still a pure function of the inputs).

import type { OpenMeteoHourly } from '../weather/types';
import { formatPercent, formatPrecipMm, formatTemperature, formatTime } from './format';

// --- Public types -----------------------------------------------------------

export interface HourlySample {
  readonly time: string;
  readonly tempC: number;
  readonly precipMm?: number;
  readonly precipProb?: number;
}

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly tempC: number;
  readonly time: string;
  readonly precipMm: number;
  readonly precipProb: number;
}

export interface ChartOptions {
  readonly width?: number;
  readonly height?: number;
  readonly paddingTop?: number;
  readonly paddingBottom?: number;
  readonly paddingX?: number;
}

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
  readonly paddingX: number;
  readonly points: ReadonlyArray<ChartPoint>;
  readonly pathD: string;
  readonly areaPathD: string;
  readonly minTemp: number;
  readonly maxTemp: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULT_OPTIONS: Required<ChartOptions> = {
  width: 600,
  height: 140,
  paddingTop: 28, // room for value labels above the curve
  paddingBottom: 24, // room for time labels below
  paddingX: 24,
};

// --- Pure projection --------------------------------------------------------

/**
 * Pick up to `count` evenly-spaced samples from the first 24 hourly slots.
 *
 * Defensive against:
 *   - parallel arrays of different lengths (uses the shortest)
 *   - empty input
 *   - non-finite temperature values (still emitted; the projector filters)
 *
 * Returned samples preserve the original time strings and any precipitation
 * fields present in the hourly data.
 */
export function selectHourlySamples(
  hourly: OpenMeteoHourly,
  count = 8,
): ReadonlyArray<HourlySample> {
  const len = Math.min(
    hourly.time.length,
    hourly.temperature_2m.length,
    24,
  );
  if (len === 0 || count <= 0) return [];
  if (count === 1) {
    const time = hourly.time[0];
    const tempC = hourly.temperature_2m[0];
    if (time === undefined || tempC === undefined) return [];
    return [
      {
        time,
        tempC,
        precipMm: hourly.precipitation[0] ?? 0,
        precipProb: hourly.precipitation_probability[0] ?? 0,
      },
    ];
  }
  const out: HourlySample[] = [];
  const effectiveCount = Math.min(count, len);
  // Step computed so first sample is index 0 and last is index len-1.
  for (let i = 0; i < effectiveCount; i += 1) {
    const idx =
      effectiveCount === 1
        ? 0
        : Math.round((i * (len - 1)) / (effectiveCount - 1));
    const time = hourly.time[idx];
    const tempC = hourly.temperature_2m[idx];
    if (time === undefined || tempC === undefined) continue;
    out.push({
      time,
      tempC,
      precipMm: hourly.precipitation[idx] ?? 0,
      precipProb: hourly.precipitation_probability[idx] ?? 0,
    });
  }
  return out;
}

/**
 * Project hourly samples into SVG coordinates and path data.
 *
 * Coordinate system:
 *   - x grows left → right; first point at `paddingX`, last at `width - paddingX`.
 *   - y grows top → bottom (SVG convention): higher temperature ⇒ smaller y.
 *
 * Y range pads min/max by 1°C each side so the curve never touches the frame.
 * Flat data (all temps equal) is treated as a 2°C span centered on the value.
 *
 * Non-finite temperatures are filtered out at the boundary. If fewer than 2
 * valid points remain, `pathD` and `areaPathD` are empty strings — callers
 * (the renderer) detect this and render a friendly fallback rather than
 * crashing.
 */
export function projectHourlyChart(
  samples: ReadonlyArray<HourlySample>,
  options?: ChartOptions,
): ChartGeometry {
  const opts: Required<ChartOptions> = {
    width: options?.width ?? DEFAULT_OPTIONS.width,
    height: options?.height ?? DEFAULT_OPTIONS.height,
    paddingTop: options?.paddingTop ?? DEFAULT_OPTIONS.paddingTop,
    paddingBottom: options?.paddingBottom ?? DEFAULT_OPTIONS.paddingBottom,
    paddingX: options?.paddingX ?? DEFAULT_OPTIONS.paddingX,
  };

  const valid = samples.filter(
    (s): s is HourlySample => Number.isFinite(s.tempC),
  );

  if (valid.length < 2) {
    return {
      width: opts.width,
      height: opts.height,
      paddingTop: opts.paddingTop,
      paddingBottom: opts.paddingBottom,
      paddingX: opts.paddingX,
      points: [],
      pathD: '',
      areaPathD: '',
      minTemp: 0,
      maxTemp: 0,
    };
  }

  const temps = valid.map((s) => s.tempC);
  const rawMin = Math.min(...temps);
  const rawMax = Math.max(...temps);

  let minTemp = rawMin - 1;
  let maxTemp = rawMax + 1;
  if (maxTemp - minTemp < 2) {
    // Flat or near-flat data: enforce 2°C span centered on the value.
    const mid = (rawMin + rawMax) / 2;
    minTemp = mid - 1;
    maxTemp = mid + 1;
  }
  const span = maxTemp - minTemp;

  const usableWidth = opts.width - 2 * opts.paddingX;
  const usableHeight = opts.height - opts.paddingTop - opts.paddingBottom;

  const xStep = usableWidth / (valid.length - 1);

  const points: ChartPoint[] = valid.map((s, i) => {
    const x = opts.paddingX + i * xStep;
    const ratio = (s.tempC - minTemp) / span;
    const y = opts.paddingTop + (1 - ratio) * usableHeight;
    return {
      x: roundTo(x, 2),
      y: roundTo(y, 2),
      tempC: s.tempC,
      time: s.time,
      precipMm: Number.isFinite(s.precipMm ?? NaN) ? (s.precipMm ?? 0) : 0,
      precipProb: Number.isFinite(s.precipProb ?? NaN) ? (s.precipProb ?? 0) : 0,
    };
  });

  const pathD = buildSmoothPath(points);
  const baselineY = opts.height - opts.paddingBottom;
  const areaPathD = buildAreaPath(points, baselineY);

  return {
    width: opts.width,
    height: opts.height,
    paddingTop: opts.paddingTop,
    paddingBottom: opts.paddingBottom,
    paddingX: opts.paddingX,
    points,
    pathD,
    areaPathD,
    minTemp,
    maxTemp,
  };
}

// --- Path helpers (pure) ----------------------------------------------------

function roundTo(n: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}

/**
 * Build a smooth open path through `points` using Catmull-Rom → cubic Bezier
 * conversion (tension = 0.5, standard recipe). Deterministic, no randomness.
 * Returns "" for fewer than 2 points (the projector already short-circuits,
 * but we double-check defensively).
 */
function buildSmoothPath(points: ReadonlyArray<ChartPoint>): string {
  if (points.length < 2) return '';
  const first = points[0];
  if (first === undefined) return '';

  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
      continue;
    }
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${roundTo(cp1x, 2)} ${roundTo(cp1y, 2)} ${roundTo(cp2x, 2)} ${roundTo(
      cp2y,
      2,
    )} ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Closed area under the curve (down to `baselineY`). Used for the soft fill
 * behind the line, like the reference image's pale band.
 */
function buildAreaPath(points: ReadonlyArray<ChartPoint>, baselineY: number): string {
  const line = buildSmoothPath(points);
  if (line === '') return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return '';
  return `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

// --- DOM renderer -----------------------------------------------------------

function svgEl(
  tag: string,
  attrs: Readonly<Record<string, string>>,
): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}

export interface RenderChartOptions {
  readonly ariaLabel?: string;
}

/**
 * Render `ChartGeometry` into an `<svg>` element.
 *
 * Empty geometry (no valid points) renders an empty SVG with `aria-hidden` —
 * the caller decides whether to surface a friendly fallback message.
 */
export function renderHourlyChart(
  geometry: ChartGeometry,
  options?: RenderChartOptions,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'detail-chart-svg');
  svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (options?.ariaLabel !== undefined) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', options.ariaLabel);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = options.ariaLabel;
    svg.appendChild(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  if (geometry.points.length < 2) {
    return svg;
  }

  // Area fill under the curve.
  svg.appendChild(
    svgEl('path', {
      d: geometry.areaPathD,
      class: 'detail-chart-area',
    }),
  );

  // The line itself.
  svg.appendChild(
    svgEl('path', {
      d: geometry.pathD,
      class: 'detail-chart-line',
      fill: 'none',
    }),
  );

  // Per-point temperature labels (above) and time labels (below the baseline).
  const baselineY = geometry.height - geometry.paddingBottom;
  for (const p of geometry.points) {
    const tempLabel = svgEl('text', {
      x: String(p.x),
      y: String(Math.max(12, p.y - 8)),
      class: 'detail-chart-label-temp',
      'text-anchor': 'middle',
    });
    tempLabel.textContent = formatTemperature(p.tempC);
    svg.appendChild(tempLabel);

    const timeLabel = svgEl('text', {
      x: String(p.x),
      y: String(baselineY + 16),
      class: 'detail-chart-label-time',
      'text-anchor': 'middle',
    });
    timeLabel.textContent = formatTime(p.time);
    svg.appendChild(timeLabel);
  }

  return svg;
}

/**
 * Below-the-chart row: one cell per sampled hour, showing precipitation when
 * present (mm + %). Cells use a CSS grid with `repeat(N, 1fr)` so they align
 * with the chart's X positions visually (approximately — pixel-perfect
 * alignment is not required, the chart already labels its own ticks).
 */
export function renderPrecipRow(geometry: ChartGeometry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'detail-precip-row';
  row.style.setProperty('--precip-cols', String(Math.max(1, geometry.points.length)));

  for (const p of geometry.points) {
    const cell = document.createElement('div');
    cell.className = 'detail-precip-cell';

    const hasMm = p.precipMm > 0;
    const hasProb = p.precipProb > 0;

    if (hasMm) {
      cell.appendChild(buildDropIcon());
      const mm = document.createElement('span');
      mm.className = 'detail-precip-mm';
      mm.textContent = formatPrecipMm(p.precipMm);
      cell.appendChild(mm);
    }
    if (hasProb) {
      const prob = document.createElement('span');
      prob.className = 'detail-precip-prob';
      prob.textContent = formatPercent(p.precipProb);
      cell.appendChild(prob);
    }
    if (!hasMm && !hasProb) {
      // Keep the cell present so columns stay aligned; render nothing visible.
      cell.classList.add('detail-precip-cell--empty');
    }

    row.appendChild(cell);
  }

  return row;
}

function buildDropIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 12 16');
  svg.setAttribute('class', 'detail-precip-drop');
  svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(
    svgEl('path', {
      d: 'M 6 1 Q 1 8 1 11 a 5 5 0 0 0 10 0 Q 11 8 6 1 z',
      class: 'detail-precip-drop-shape',
    }),
  );
  return svg;
}
