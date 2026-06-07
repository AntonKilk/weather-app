// Tiny hand-rolled SVG weather icons.
//
// Built via `createElementNS` + `setAttribute` only — never `innerHTML`
// (CLAUDE.md › Security). Each icon is a simple, recognizable glyph at ~40 px
// and uses two CSS-friendly fill classes (`icon-warm` / `icon-cool`) so styling
// stays in one place.

import type { WeatherIconName } from '../weather/wmo';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface IconOptions {
  readonly size?: number;
  readonly title?: string;
}

interface IconShape {
  /** Calls happen against an SVG root already sized to a 64x64 viewBox. */
  build(svg: SVGSVGElement): void;
}

function el(tag: string, attrs: Readonly<Record<string, string>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}

// Reusable primitives ---------------------------------------------------------

function sunShape(svg: SVGSVGElement, cx: number, cy: number, r: number): void {
  // Rays
  const rays = [
    [cx, cy - r - 6, cx, cy - r - 12],
    [cx, cy + r + 6, cx, cy + r + 12],
    [cx - r - 6, cy, cx - r - 12, cy],
    [cx + r + 6, cy, cx + r + 12, cy],
    [cx - r - 4, cy - r - 4, cx - r - 9, cy - r - 9],
    [cx + r + 4, cy - r - 4, cx + r + 9, cy - r - 9],
    [cx - r - 4, cy + r + 4, cx - r - 9, cy + r + 9],
    [cx + r + 4, cy + r + 4, cx + r + 9, cy + r + 9],
  ] as const;
  for (const [x1, y1, x2, y2] of rays) {
    svg.appendChild(
      el('line', {
        x1: String(x1),
        y1: String(y1),
        x2: String(x2),
        y2: String(y2),
        'stroke-width': '3',
        'stroke-linecap': 'round',
        class: 'icon-warm-stroke',
      }),
    );
  }
  svg.appendChild(
    el('circle', {
      cx: String(cx),
      cy: String(cy),
      r: String(r),
      class: 'icon-warm',
    }),
  );
}

function cloudShape(svg: SVGSVGElement, cx: number, cy: number, scale = 1): void {
  // A bumpy cloud built from overlapping circles plus a base rect.
  const s = scale;
  svg.appendChild(el('circle', { cx: String(cx - 10 * s), cy: String(cy), r: String(9 * s), class: 'icon-cool' }));
  svg.appendChild(el('circle', { cx: String(cx), cy: String(cy - 8 * s), r: String(11 * s), class: 'icon-cool' }));
  svg.appendChild(el('circle', { cx: String(cx + 12 * s), cy: String(cy - 2 * s), r: String(10 * s), class: 'icon-cool' }));
  svg.appendChild(
    el('rect', {
      x: String(cx - 18 * s),
      y: String(cy),
      width: String(36 * s),
      height: String(10 * s),
      rx: String(5 * s),
      ry: String(5 * s),
      class: 'icon-cool',
    }),
  );
}

function dropShape(svg: SVGSVGElement, cx: number, cy: number): void {
  svg.appendChild(
    el('path', {
      d: `M ${cx} ${cy} q -3 4 -3 7 a 3 3 0 0 0 6 0 q 0 -3 -3 -7 z`,
      class: 'icon-cool-accent',
    }),
  );
}

function snowflakeShape(svg: SVGSVGElement, cx: number, cy: number): void {
  const lines = [
    [cx - 4, cy, cx + 4, cy],
    [cx, cy - 4, cx, cy + 4],
    [cx - 3, cy - 3, cx + 3, cy + 3],
    [cx - 3, cy + 3, cx + 3, cy - 3],
  ] as const;
  for (const [x1, y1, x2, y2] of lines) {
    svg.appendChild(
      el('line', {
        x1: String(x1),
        y1: String(y1),
        x2: String(x2),
        y2: String(y2),
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        class: 'icon-cool-stroke',
      }),
    );
  }
}

// Icon registry --------------------------------------------------------------

const SHAPES: Readonly<Record<WeatherIconName, IconShape>> = {
  sun: {
    build(svg) {
      sunShape(svg, 32, 32, 11);
    },
  },
  'sun-behind-cloud': {
    build(svg) {
      sunShape(svg, 22, 22, 8);
      cloudShape(svg, 36, 38, 1);
    },
  },
  cloud: {
    build(svg) {
      cloudShape(svg, 32, 32, 1.1);
    },
  },
  fog: {
    build(svg) {
      cloudShape(svg, 32, 22, 0.9);
      for (let i = 0; i < 3; i += 1) {
        svg.appendChild(
          el('line', {
            x1: '10',
            y1: String(42 + i * 6),
            x2: '54',
            y2: String(42 + i * 6),
            'stroke-width': '3',
            'stroke-linecap': 'round',
            class: 'icon-cool-stroke',
          }),
        );
      }
    },
  },
  drizzle: {
    build(svg) {
      cloudShape(svg, 32, 26, 1);
      dropShape(svg, 22, 46);
      dropShape(svg, 32, 48);
      dropShape(svg, 42, 46);
    },
  },
  'drizzle-freezing': {
    build(svg) {
      cloudShape(svg, 32, 26, 1);
      dropShape(svg, 22, 46);
      snowflakeShape(svg, 32, 50);
      dropShape(svg, 42, 46);
    },
  },
  rain: {
    build(svg) {
      cloudShape(svg, 32, 24, 1);
      for (let i = 0; i < 4; i += 1) {
        svg.appendChild(
          el('line', {
            x1: String(18 + i * 8),
            y1: '42',
            x2: String(16 + i * 8),
            y2: '54',
            'stroke-width': '2.5',
            'stroke-linecap': 'round',
            class: 'icon-cool-accent-stroke',
          }),
        );
      }
    },
  },
  'rain-freezing': {
    build(svg) {
      cloudShape(svg, 32, 24, 1);
      dropShape(svg, 22, 46);
      dropShape(svg, 42, 46);
      snowflakeShape(svg, 32, 50);
    },
  },
  'rain-showers': {
    build(svg) {
      sunShape(svg, 22, 18, 6);
      cloudShape(svg, 36, 28, 0.9);
      for (let i = 0; i < 3; i += 1) {
        svg.appendChild(
          el('line', {
            x1: String(26 + i * 7),
            y1: '46',
            x2: String(24 + i * 7),
            y2: '56',
            'stroke-width': '2.5',
            'stroke-linecap': 'round',
            class: 'icon-cool-accent-stroke',
          }),
        );
      }
    },
  },
  snow: {
    build(svg) {
      cloudShape(svg, 32, 24, 1);
      snowflakeShape(svg, 22, 48);
      snowflakeShape(svg, 32, 52);
      snowflakeShape(svg, 42, 48);
    },
  },
  'snow-showers': {
    build(svg) {
      sunShape(svg, 22, 18, 6);
      cloudShape(svg, 36, 28, 0.9);
      snowflakeShape(svg, 28, 50);
      snowflakeShape(svg, 40, 52);
    },
  },
  thunderstorm: {
    build(svg) {
      cloudShape(svg, 32, 24, 1);
      svg.appendChild(
        el('path', {
          d: 'M 30 38 L 24 50 L 30 50 L 26 60 L 38 46 L 32 46 L 36 38 Z',
          class: 'icon-warm',
        }),
      );
    },
  },
  'thunderstorm-hail': {
    build(svg) {
      cloudShape(svg, 32, 24, 1);
      svg.appendChild(
        el('path', {
          d: 'M 30 38 L 24 50 L 30 50 L 26 60 L 38 46 L 32 46 L 36 38 Z',
          class: 'icon-warm',
        }),
      );
      svg.appendChild(el('circle', { cx: '20', cy: '54', r: '2.5', class: 'icon-cool' }));
      svg.appendChild(el('circle', { cx: '44', cy: '54', r: '2.5', class: 'icon-cool' }));
    },
  },
};

export function createWeatherIcon(name: WeatherIconName, options?: IconOptions): SVGSVGElement {
  const size = options?.size ?? 40;
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', `weather-icon weather-icon--${name}`);
  svg.setAttribute('role', 'img');
  if (options?.title !== undefined) {
    svg.setAttribute('aria-label', options.title);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = options.title;
    svg.appendChild(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  SHAPES[name].build(svg);
  return svg;
}
