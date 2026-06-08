import type { HourlyForecast } from '../weather/types';
import { formatHourLabel, formatTemperature } from './format';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STEP_HOURS = 3;
const TARGET_POINTS = 8;
const PRECIP_PROB_THRESHOLD = 20;

export interface ChartPoint {
  x: number;
  y: number;
  tempC: number;
  timeLabel: string;
  precipMm: number;
  precipProb: number;
}

export interface ChartGeometry {
  points: ChartPoint[];
  pathD: string;
  width: number;
  height: number;
  minTempC: number;
  maxTempC: number;
}

export interface ChartOptions {
  width: number;
  height: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  width: 320,
  height: 120,
  paddingX: 16,
  paddingTop: 22,
  paddingBottom: 30,
};

type HourlyInput = Pick<
  HourlyForecast,
  'time' | 'temperature_2m' | 'precipitation' | 'precipitation_probability'
>;

interface Sample {
  time: string;
  tempC: number;
  precipMm: number;
  precipProb: number;
}

function sample(hourly: HourlyInput): Sample[] {
  const out: Sample[] = [];
  const length = hourly.time.length;
  for (let n = 0; n < TARGET_POINTS; n++) {
    const i = n * STEP_HOURS;
    if (i >= length) {
      break;
    }
    const time = hourly.time[i];
    const tempC = hourly.temperature_2m[i];
    if (time === undefined || tempC === undefined || !Number.isFinite(tempC)) {
      continue;
    }
    const precipMm = hourly.precipitation[i];
    const precipProb = hourly.precipitation_probability[i];
    out.push({
      time,
      tempC,
      precipMm: Number.isFinite(precipMm) ? (precipMm as number) : 0,
      precipProb: Number.isFinite(precipProb) ? (precipProb as number) : 0,
    });
  }
  return out;
}

export function buildChartGeometry(
  hourly: HourlyInput,
  options?: Partial<ChartOptions>,
): ChartGeometry {
  const opts: ChartOptions = { ...DEFAULT_CHART_OPTIONS, ...options };
  const samples = sample(hourly);

  if (samples.length === 0) {
    return {
      points: [],
      pathD: '',
      width: opts.width,
      height: opts.height,
      minTempC: 0,
      maxTempC: 0,
    };
  }

  const temps = samples.map((s) => s.tempC);
  const minTempC = Math.min(...temps);
  const maxTempC = Math.max(...temps);
  const innerHeight = opts.height - opts.paddingTop - opts.paddingBottom;
  const innerWidth = opts.width - 2 * opts.paddingX;
  const midY = opts.paddingTop + innerHeight / 2;

  const points: ChartPoint[] = samples.map((s, i) => {
    const x =
      samples.length === 1
        ? opts.width / 2
        : opts.paddingX + (i * innerWidth) / (samples.length - 1);
    const y =
      maxTempC === minTempC
        ? midY
        : opts.paddingTop + (1 - (s.tempC - minTempC) / (maxTempC - minTempC)) * innerHeight;
    return {
      x,
      y,
      tempC: s.tempC,
      timeLabel: formatHourLabel(s.time),
      precipMm: s.precipMm,
      precipProb: s.precipProb,
    };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  return {
    points,
    pathD,
    width: opts.width,
    height: opts.height,
    minTempC,
    maxTempC,
  };
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function shouldShowPrecip(p: ChartPoint): boolean {
  return p.precipMm > 0 || p.precipProb >= PRECIP_PROB_THRESHOLD;
}

function precipLabel(p: ChartPoint): string {
  if (p.precipProb >= PRECIP_PROB_THRESHOLD) {
    return `${Math.round(p.precipProb)}%`;
  }
  return `${p.precipMm.toFixed(1)} mm`;
}

function buildDropIcon(): SVGElement {
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('class', 'precip-row__drop');
  svg.setAttribute('aria-hidden', 'true');
  const path = svgEl('path');
  path.setAttribute('d', 'M 6 1 C 3 5 2 7 2 8.5 a 4 4 0 0 0 8 0 C 10 7 9 5 6 1 Z');
  path.setAttribute('fill', '#3b82f6');
  svg.appendChild(path);
  return svg;
}

export function renderHourlyChart(
  hourly: HourlyForecast,
  options?: Partial<ChartOptions>,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'location-detail__chart';

  const geometry = buildChartGeometry(hourly, options);
  const { points, pathD, width, height } = geometry;

  if (points.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'location-detail__fallback';
    empty.textContent = 'Hourly data unavailable.';
    container.appendChild(empty);
    return container;
  }

  const svg = svgEl('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Hourly temperature');
  svg.setAttribute('class', 'hourly-chart');

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  if (firstPoint !== undefined && lastPoint !== undefined) {
    const fill = svgEl('path');
    const baseY = height - DEFAULT_CHART_OPTIONS.paddingBottom + 2;
    const fillD = `${pathD} L ${lastPoint.x} ${baseY} L ${firstPoint.x} ${baseY} Z`;
    fill.setAttribute('d', fillD);
    fill.setAttribute('class', 'hourly-chart__fill');
    svg.appendChild(fill);
  }

  const line = svgEl('path');
  line.setAttribute('d', pathD);
  line.setAttribute('class', 'hourly-chart__line');
  svg.appendChild(line);

  for (const p of points) {
    const valueText = svgEl('text');
    valueText.setAttribute('x', String(p.x));
    valueText.setAttribute('y', String(p.y - 8));
    valueText.setAttribute('text-anchor', 'middle');
    valueText.setAttribute('class', 'hourly-chart__value');
    valueText.textContent = formatTemperature(p.tempC);
    svg.appendChild(valueText);

    const timeText = svgEl('text');
    timeText.setAttribute('x', String(p.x));
    timeText.setAttribute('y', String(height - 14));
    timeText.setAttribute('text-anchor', 'middle');
    timeText.setAttribute('class', 'hourly-chart__time');
    timeText.textContent = p.timeLabel;
    svg.appendChild(timeText);
  }

  container.appendChild(svg);

  const precipRow = document.createElement('div');
  precipRow.className = 'precip-row';
  precipRow.style.setProperty('--cols', String(points.length));

  for (const p of points) {
    const cell = document.createElement('div');
    cell.className = 'precip-row__cell';
    if (shouldShowPrecip(p)) {
      cell.appendChild(buildDropIcon());
      const label = document.createElement('span');
      label.className = 'precip-row__label';
      label.textContent = precipLabel(p);
      cell.appendChild(label);
    } else {
      const blank = document.createElement('span');
      blank.setAttribute('aria-hidden', 'true');
      cell.appendChild(blank);
    }
    precipRow.appendChild(cell);
  }

  container.appendChild(precipRow);
  return container;
}
