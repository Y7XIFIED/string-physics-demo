// pretext.js only needed for prepareWithSegments (used indirectly via measureCtx)
// layoutWithLines removed — line structure now derived from layoutPositions to avoid dual-engine mismatch

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Letter {
  ch: string;
  w: number;
  x: number; y: number;
  ox: number; oy: number;
  px: number; py: number;
  readingIdx: number;
  locked: boolean;
}

interface DragState {
  idx: number;
  offsetX: number;
  offsetY: number;
}

interface Position {
  x: number;
  y: number;
  w: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FULL_TEXT = "Beyond the edge of the observable universe lies a silence no signal has ever crossed. Stars are born in clouds of gas and dust, burn for millions of years, then collapse into darkness. Black holes warp the fabric of spacetime itself, bending light around their infinite gravity. Neutron stars spin hundreds of times per second, dense enough that a teaspoon of their matter weighs a billion tons. We are made of the same atoms forged in stellar cores. We are, quite literally, children of exploded stars drifting through an endless cosmic ocean.";
const SHORT_TEXT = "Beyond the edge of the observable universe lies a silence no signal has ever crossed. Stars are born in clouds of gas and dust, burn for millions of years, then collapse into darkness. Black holes warp the fabric of spacetime itself, bending light around their infinite gravity.";
const TEXT: string = window.innerWidth < 600 ? SHORT_TEXT : FULL_TEXT;
const FONT = '20px Nasalization';
const LINE_HEIGHT = 28;
const CONSTRAINT_DIST = 1.2;
const UNLOCK_THRESHOLD = 1;
const ITERATIONS = 12;
const DAMPING = 0.97;
const GRAVITY = 0.15;

// ---------------------------------------------------------------------------
// Mutable simulation state
// ---------------------------------------------------------------------------

let gravityOn = true;
let unraveling = false;
let unravelIdx = -1;

// ---------------------------------------------------------------------------
// DOM & measurement setup
// ---------------------------------------------------------------------------

const container = document.getElementById('container') as HTMLElement;
const measureCtx = (document.createElement('canvas') as HTMLCanvasElement)
  .getContext('2d') as CanvasRenderingContext2D;
measureCtx.font = FONT;

await document.fonts.load(FONT);
await document.fonts.ready;

// `prepared` removed — zig-zag mapping now uses positions[] directly
const MARGIN = 20;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function getMaxWidth(): number {
  return container.getBoundingClientRect().width - MARGIN * 2;
}

// Measure all graphemes once — widths never change
const allGraphemes: string[] = [...segmenter.segment(TEXT)].map(s => s.segment);
const graphemeWidths: number[] = allGraphemes.map(g => measureCtx.measureText(g).width);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Compute reading-order pixel positions for every grapheme at a given wrap width.
 * Line-breaking spaces are placed at the end of the line they belong to, then
 * the cursor resets to x=0 on the next line.
 */
function layoutPositions(maxWidth: number): Position[] {
  const rawPositions: Position[] = [];
  let x = 0;
  let lineY = 0;

  for (let gi = 0; gi < allGraphemes.length; gi++) {
    const g = allGraphemes[gi];
    const w = graphemeWidths[gi];

    if (g === ' ' && x > 0) {
      let wordW = 0;
      for (let j = gi + 1; j < allGraphemes.length && allGraphemes[j] !== ' '; j++) {
        wordW += graphemeWidths[j];
      }
      if (x + w + wordW > maxWidth) {
        rawPositions.push({ x: x + MARGIN, y: lineY, w });
        x = 0;
        lineY += LINE_HEIGHT;
        continue;
      }
    }

    rawPositions.push({ x: x + MARGIN, y: lineY, w });
    x += w;
  }

  // Offset the block downward so it sits roughly 30% from the top of the viewport
  const totalHeight = lineY + LINE_HEIGHT;
  const containerRect = container.getBoundingClientRect();
  const offsetY = Math.max(0, (window.innerHeight - containerRect.top - totalHeight) * 0.3);

  return rawPositions.map(p => ({ x: p.x, y: p.y + offsetY, w: p.w }));
}

const positions: Position[] = layoutPositions(getMaxWidth());

/**
 * Build the zig-zag (snake) string-order mapping: stringOrder[i] = readingIndex.
 * Derives line groupings from the already-computed positions[] array by grouping
 * graphemes that share the same y-coordinate — guaranteeing both layout and
 * chain-order always use the exact same line breaks with no dual-engine mismatch.
 */
function buildZigzagMapping(pos: Position[]): number[] {
  // Group reading indices by rounded y value (same line = same y after offsetY)
  const lineMap = new Map<number, number[]>();
  for (let i = 0; i < pos.length; i++) {
    const y = Math.round(pos[i].y);
    if (!lineMap.has(y)) lineMap.set(y, []);
    lineMap.get(y)!.push(i);
  }

  // Sort lines top-to-bottom, each line is already in reading order (left-to-right)
  const lines = [...lineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, indices]) => indices);

  // Flip alternating lines so the last line always reads L→R
  const lastLineIdx = lines.length - 1;
  const needFlip = lastLineIdx % 2 === 1;
  const stringOrder: number[] = [];
  for (let li = 0; li < lines.length; li++) {
    const reversed = needFlip ? (li % 2 === 0) : (li % 2 === 1);
    if (reversed) {
      stringOrder.push(...[...lines[li]].reverse());
    } else {
      stringOrder.push(...lines[li]);
    }
  }

  return stringOrder;
}

const stringOrder: number[] = buildZigzagMapping(positions);

// Build the letters array in string (zig-zag) order
const letters: Letter[] = stringOrder.map(ri => {
  const p = positions[ri];
  return {
    ch: allGraphemes[ri],
    w: p.w,
    x: p.x, y: p.y,
    ox: p.x, oy: p.y,
    px: p.x, py: p.y,
    readingIdx: ri,
    locked: true,
  };
});

/** Compute the rest length for each consecutive pair in string order. */
function computeRestLengths(): number[] {
  const rests: number[] = [];
  for (let i = 0; i < letters.length - 1; i++) {
    const a = letters[i], b = letters[i + 1];
    const dist = Math.hypot(
      (b.ox + b.w / 2) - (a.ox + a.w / 2),
      (b.oy + LINE_HEIGHT / 2) - (a.oy + LINE_HEIGHT / 2),
    );
    rests.push(dist * CONSTRAINT_DIST);
  }
  return rests;
}

const restLengths: number[] = computeRestLengths();

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const els: HTMLSpanElement[] = [];
for (const l of letters) {
  const span = document.createElement('span');
  span.className = 'letter';
  span.textContent = l.ch;
  container.appendChild(span);
  els.push(span);
}

// Unlock the last 6 letters so the user can start dragging immediately
const lastIdx = letters.length - 1;
for (let i = lastIdx; i > lastIdx - 6; i--) {
  letters[i].locked = false;
  els[i].classList.add('draggable');
}

// "DRAG ME" hint image
const hint = document.createElement('img');
hint.src = new URL('/drag.png', import.meta.url).href;
hint.style.cssText = 'position:absolute;top:0;left:0;width:60px;pointer-events:none;opacity:0;transition:opacity 0.8s;';
container.appendChild(hint);

function positionHint(): void {
  const last = letters[lastIdx];
  hint.style.transform = `translate(${last.ox - 30}px, ${last.oy + LINE_HEIGHT + 2}px)`;
}
positionHint();
setTimeout(() => { hint.style.opacity = '1'; }, 500);

// ---------------------------------------------------------------------------
// Event handlers
// (registered after hint / letters are initialised to avoid forward-ref issues)
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'f' || e.key === 'F') {
    gravityOn = !gravityOn;
    if (gravityOn && !unraveling) {
      unraveling = true;
      hint.style.opacity = '0';
      unravelIdx = letters.length - 1;
      while (unravelIdx >= 0 && !letters[unravelIdx].locked) unravelIdx--;
    }
  }
});

window.addEventListener('resize', () => {
  const newPositions = layoutPositions(getMaxWidth());
  for (let i = 0; i < letters.length; i++) {
    const np = newPositions[letters[i].readingIdx];
    if (letters[i].locked) {
      letters[i].x  = np.x;
      letters[i].y  = np.y;
      letters[i].ox = np.x;
      letters[i].oy = np.y;
      letters[i].px = np.x;
      letters[i].py = np.y;
    } else {
      letters[i].ox = np.x;
      letters[i].oy = np.y;
    }
  }
  // Rest lengths stay fixed — the string length doesn't change on resize
  positionHint();
});

// ---------------------------------------------------------------------------
// Drag — multitouch: one DragState per active pointer
// ---------------------------------------------------------------------------

const drags = new Map<number, DragState>();

function isDragged(idx: number): boolean {
  for (const d of drags.values()) if (d.idx === idx) return true;
  return false;
}

container.addEventListener('pointerdown', (e: PointerEvent) => {
  const idx = els.indexOf(e.target as HTMLSpanElement);
  if (idx === -1 || letters[idx].locked) return;
  if (isDragged(idx)) return;
  const rect = container.getBoundingClientRect();
  drags.set(e.pointerId, {
    idx,
    offsetX: e.clientX - rect.left - letters[idx].x,
    offsetY: e.clientY - rect.top  - letters[idx].y,
  });
  els[idx].classList.add('dragging');
  (e.target as Element).setPointerCapture(e.pointerId);
  e.preventDefault();
});

window.addEventListener('pointermove', (e: PointerEvent) => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  const rect = container.getBoundingClientRect();
  const l = letters[d.idx];
  l.x  = e.clientX - rect.left - d.offsetX;
  l.y  = e.clientY - rect.top  - d.offsetY;
  l.px = l.x;
  l.py = l.y;
  l.locked = false;
});

window.addEventListener('pointerup', (e: PointerEvent) => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  els[d.idx].classList.remove('dragging');
  drags.delete(e.pointerId);
});

window.addEventListener('pointercancel', (e: PointerEvent) => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  els[d.idx].classList.remove('dragging');
  drags.delete(e.pointerId);
});

// ---------------------------------------------------------------------------
// Physics simulation (Verlet integration)
// ---------------------------------------------------------------------------

function simulate(): void {
  // Unravel: unlock one letter per tick when gravity is re-enabled
  if (unraveling) {
    if (!gravityOn || unravelIdx < 0) {
      unraveling = false;
    } else if (letters[unravelIdx].locked) {
      letters[unravelIdx].locked = false;
      letters[unravelIdx].px = letters[unravelIdx].x;
      letters[unravelIdx].py = letters[unravelIdx].y - 0.5;
      unravelIdx--;
    } else {
      unravelIdx--;
    }
  }

  // Propagate unlock: a locked letter is freed when its unlocked neighbour
  // has moved further away than the rest length allows
  for (let i = letters.length - 2; i >= 0; i--) {
    if (letters[i].locked && !letters[i + 1].locked) {
      const a = letters[i], b = letters[i + 1];
      const dx = (b.x + b.w / 2) - (a.ox + a.w / 2);
      const dy = (b.y + LINE_HEIGHT / 2) - (a.oy + LINE_HEIGHT / 2);
      if (Math.hypot(dx, dy) > restLengths[i] + UNLOCK_THRESHOLD) {
        a.locked = false;
        a.px = a.x;
        a.py = a.y;
        hint.style.opacity = '0';
      }
    }
  }

  // Verlet integration
  for (let i = 0; i < letters.length; i++) {
    const l = letters[i];
    if (l.locked || isDragged(i)) continue;
    const vx = (l.x - l.px) * DAMPING;
    const vy = (l.y - l.py) * DAMPING;
    l.px = l.x;
    l.py = l.y;
    l.x += vx;
    l.y += vy + (gravityOn ? GRAVITY : 0);
  }

  // Distance constraints (XPBD-style iterative solver)
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < letters.length - 1; i++) {
      const a = letters[i], b = letters[i + 1];
      if (a.locked && b.locked) continue;
      const ax = a.x + a.w / 2, ay = a.y + LINE_HEIGHT / 2;
      const bx = b.x + b.w / 2, by = b.y + LINE_HEIGHT / 2;
      const dx = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy) || 0.001;
      const diff = (dist - restLengths[i]) / dist;
      const aFixed = a.locked || isDragged(i);
      const bFixed = b.locked || isDragged(i + 1);
      if (aFixed && !bFixed) {
        b.x -= dx * diff; b.y -= dy * diff;
      } else if (!aFixed && bFixed) {
        a.x += dx * diff; a.y += dy * diff;
      } else if (!aFixed && !bFixed) {
        a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
        b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
      }
    }
  }

  // Simple circle-circle collision between non-adjacent unlocked letters
  const RADIUS = 7;
  for (let i = 0; i < letters.length; i++) {
    if (letters[i].locked) continue;
    const a = letters[i];
    const acx = a.x + a.w / 2, acy = a.y + LINE_HEIGHT / 2;
    for (let j = i + 1; j < letters.length; j++) {
      if (letters[j].locked) continue;
      if (Math.abs(i - j) === 1) continue;
      const b = letters[j];
      const bcx = b.x + b.w / 2, bcy = b.y + LINE_HEIGHT / 2;
      const dx = bcx - acx, dy = bcy - acy;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist < RADIUS * 2) {
        const overlap = (RADIUS * 2 - dist) / dist * 0.5;
        if (isDragged(i)) {
          b.x += dx * overlap; b.y += dy * overlap;
        } else if (isDragged(j)) {
          a.x -= dx * overlap; a.y -= dy * overlap;
        } else {
          a.x -= dx * overlap; a.y -= dy * overlap;
          b.x += dx * overlap; b.y += dy * overlap;
        }
      }
    }
  }

  // Boundary: bounce off viewport edges
  const cRect = container.getBoundingClientRect();
  const minX = -cRect.left;
  const minY = 60 - cRect.top;
  const maxX = window.innerWidth  - cRect.left;
  const maxY = window.innerHeight - 50 - cRect.top;
  const bounce = 0.4;
  for (let i = 0; i < letters.length; i++) {
    const l = letters[i];
    if (l.locked || isDragged(i)) continue;
    if (l.x < minX)            { l.x = minX;            l.px = l.x + (l.x - l.px) * bounce; }
    if (l.x + l.w > maxX)      { l.x = maxX - l.w;      l.px = l.x + (l.x - l.px) * bounce; }
    if (l.y < minY)            { l.y = minY;            l.py = l.y + (l.y - l.py) * bounce; }
    if (l.y + LINE_HEIGHT > maxY) { l.y = maxY - LINE_HEIGHT; l.py = l.y + (l.y - l.py) * bounce; }
  }
}

// ---------------------------------------------------------------------------
// Fixed-timestep render loop (simulates at 120 Hz regardless of display rate)
// ---------------------------------------------------------------------------

const FIXED_DT = 1 / 120;
const MAX_STEPS = 4; // cap to avoid spiral of death on tab resume
let accumulator = 0;
let lastTime = -1;

function render(now: number): void {
  if (lastTime < 0) { lastTime = now; requestAnimationFrame(render); return; }
  const dt = Math.min((now - lastTime) / 1000, MAX_STEPS * FIXED_DT);
  lastTime = now;
  accumulator += dt;

  while (accumulator >= FIXED_DT) {
    simulate();
    accumulator -= FIXED_DT;
  }

  for (let i = 0; i < letters.length; i++) {
    if (!letters[i].locked) els[i].classList.add('draggable');
    els[i].style.transform = `translate(${letters[i].x}px, ${letters[i].y}px)`;
  }
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
