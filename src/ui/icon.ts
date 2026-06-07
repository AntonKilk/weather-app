import type { WeatherIconKey } from '../weather/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderIconSvg(iconKey: WeatherIconKey, ariaLabel: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '36');
  svg.setAttribute('height', '36');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);
  svg.setAttribute('class', `weather-icon weather-icon--${iconKey}`);

  for (const child of shapesFor(iconKey)) {
    svg.appendChild(child);
  }
  return svg;
}

function shapesFor(iconKey: WeatherIconKey): SVGElement[] {
  switch (iconKey) {
    case 'clear':
      return [sun(12, 12, 5)];
    case 'mostly-clear':
      return [sun(9, 9, 4), cloud(14, 15)];
    case 'partly-cloudy':
      return [sun(8, 8, 3.5), cloud(14, 15)];
    case 'cloudy':
      return [cloud(12, 13)];
    case 'fog':
      return [cloud(12, 10), line(4, 17, 20, 17), line(6, 20, 18, 20)];
    case 'drizzle':
      return [cloud(12, 10), droplet(9, 18), droplet(15, 18)];
    case 'rain':
      return [cloud(12, 10), droplet(8, 18), droplet(12, 19), droplet(16, 18)];
    case 'freezing-rain':
      return [cloud(12, 10), droplet(9, 18), asterisk(15, 18)];
    case 'snow':
      return [cloud(12, 10), asterisk(8, 18), asterisk(12, 19), asterisk(16, 18)];
    case 'snow-showers':
      return [cloud(12, 10), asterisk(10, 18), asterisk(14, 19)];
    case 'thunderstorm':
      return [cloud(12, 10), bolt(11, 14)];
    case 'unknown':
    default:
      return [questionMark()];
  }
}

function sun(cx: number, cy: number, r: number): SVGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'icon-sun');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(r));
  circle.setAttribute('fill', '#f7b500');
  g.appendChild(circle);
  // Eight rays.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * (r + 1);
    const y1 = cy + Math.sin(angle) * (r + 1);
    const x2 = cx + Math.cos(angle) * (r + 3);
    const y2 = cy + Math.sin(angle) * (r + 3);
    g.appendChild(line(x1, y1, x2, y2, '#f7b500', 1.2));
  }
  return g;
}

function cloud(cx: number, cy: number): SVGElement {
  const path = document.createElementNS(SVG_NS, 'path');
  // Simple stylised cloud (three bumps + flat base) centred on (cx, cy).
  const d = [
    `M ${cx - 6} ${cy + 2}`,
    `a 3 3 0 0 1 0 -5`,
    `a 4 4 0 0 1 7 -1`,
    `a 3.5 3.5 0 0 1 5 6`,
    `Z`,
  ].join(' ');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#c9d3dd');
  path.setAttribute('stroke', '#94a3b1');
  path.setAttribute('stroke-width', '0.5');
  return path;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke = '#94a3b1', width = 1): SVGElement {
  const el = document.createElementNS(SVG_NS, 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linecap', 'round');
  return el;
}

function droplet(cx: number, cy: number): SVGElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', `M ${cx} ${cy} l -1 2 a 1 1 0 1 0 2 0 Z`);
  path.setAttribute('fill', '#3b82f6');
  return path;
}

function asterisk(cx: number, cy: number): SVGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'icon-snowflake');
  g.appendChild(line(cx - 1.2, cy, cx + 1.2, cy, '#60a5fa', 0.8));
  g.appendChild(line(cx, cy - 1.2, cx, cy + 1.2, '#60a5fa', 0.8));
  g.appendChild(line(cx - 0.9, cy - 0.9, cx + 0.9, cy + 0.9, '#60a5fa', 0.8));
  g.appendChild(line(cx - 0.9, cy + 0.9, cx + 0.9, cy - 0.9, '#60a5fa', 0.8));
  return g;
}

function bolt(cx: number, cy: number): SVGElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', `M ${cx} ${cy} l -2 4 l 2 0 l -1 3 l 3 -4 l -2 0 l 1 -3 Z`);
  path.setAttribute('fill', '#f59e0b');
  return path;
}

function questionMark(): SVGElement {
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '12');
  text.setAttribute('y', '17');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '14');
  text.setAttribute('fill', '#94a3b1');
  text.textContent = '?';
  return text;
}
