// Touch → Controls, for phones and tablets. One thumb per half of the screen, resting
// wherever it lands: pulling it down pulls that brake (like the real handle), pushing it
// up runs on the ground and is speed bar in the air, sliding it sideways shifts weight.
// Both thumbs down is both brakes, both all the way down a flare, one deep a spiral.

import type { Controls } from '../sim/glider';
import type { Action } from './input';

/** A thumb's offset from where it landed, in units of full travel; +dy is down. */
export interface Thumb { dx: number; dy: number }

/** Offsets below this are a resting thumb, not a command. */
const DEAD = 0.08;
/** Sideways drift while braking is normal, so weight shift needs a deliberate slide. */
const SHIFT_DEAD = 0.18;
/** Push past this to run. */
const RUN_AT = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const past = (v: number, dead: number) => Math.sign(v) * clamp((Math.abs(v) - dead) / (1 - dead), 0, 1);

export function thumbControls(left: Thumb | null, right: Thumb | null): Controls {
  const brake = (t: Thumb | null) => (t ? past(Math.max(t.dy, 0), DEAD) : 0);
  const push = (t: Thumb | null) => (t ? past(Math.max(-t.dy, 0), DEAD) : 0);
  const shift = (t: Thumb | null) => (t ? past(clamp(t.dx, -1, 1), SHIFT_DEAD) : 0);
  const bar = Math.max(push(left), push(right));
  return {
    brakeLeft: brake(left),
    brakeRight: brake(right),
    speedBar: bar,
    weightShift: clamp(shift(left) + shift(right), -1, 1),
    run: bar >= RUN_AT,
  };
}

const BUTTONS: [Action, string][] = [
  ['camera', 'CAM'], ['airstart', 'AIR'], ['reset', 'RESET'], ['sites', 'SITES'], ['layout', 'INST'], ['pause', 'II'],
];

interface Touch { id: number; x0: number; y0: number; x: number; y: number; ring: HTMLElement; knob: HTMLElement }

/** The thumb pads and action buttons, laid over the canvas on touch screens. */
export class TouchPad {
  private readonly layer = document.createElement('div');
  private readonly thumbs: { left: Touch | null; right: Touch | null } = { left: null, right: null };

  constructor(onAction: (a: Action) => void) {
    this.layer.id = 'touch';
    const nav = document.createElement('nav');
    nav.id = 'touch-buttons';
    for (const [action, label] of BUTTONS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => onAction(action));
      nav.append(b);
    }
    document.body.append(this.layer, nav);

    this.layer.addEventListener('pointerdown', (e) => {
      const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      if (this.thumbs[side]) return;
      this.layer.setPointerCapture(e.pointerId);
      const ring = this.mark('touch-ring'), knob = this.mark('touch-knob');
      this.thumbs[side] = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, ring, knob };
      this.place(this.thumbs[side]);
    });
    this.layer.addEventListener('pointermove', (e) => {
      const t = this.find(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      this.place(t);
    });
    const lift = (e: PointerEvent) => {
      for (const side of ['left', 'right'] as const) {
        const t = this.thumbs[side];
        if (t?.id !== e.pointerId) continue;
        t.ring.remove();
        t.knob.remove();
        this.thumbs[side] = null;
      }
    };
    this.layer.addEventListener('pointerup', lift);
    this.layer.addEventListener('pointercancel', lift);
  }

  read(): Controls {
    return thumbControls(this.offset(this.thumbs.left), this.offset(this.thumbs.right));
  }

  /** A quarter of the screen height is full travel, so it works the same on any phone. */
  private get travel(): number {
    return Math.max(80, window.innerHeight * 0.25);
  }

  private offset(t: Touch | null): Thumb | null {
    return t ? { dx: (t.x - t.x0) / this.travel, dy: (t.y - t.y0) / this.travel } : null;
  }

  private find(id: number): Touch | null {
    return this.thumbs.left?.id === id ? this.thumbs.left : this.thumbs.right?.id === id ? this.thumbs.right : null;
  }

  private mark(cls: string): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    this.layer.append(e);
    return e;
  }

  /** The ring stays where the thumb landed; the knob follows it, clamped to full travel. */
  private place(t: Touch): void {
    const r = this.travel;
    const dx = clamp(t.x - t.x0, -r, r), dy = clamp(t.y - t.y0, -r, r);
    t.ring.style.transform = `translate(${t.x0}px, ${t.y0}px)`;
    t.knob.style.transform = `translate(${t.x0 + dx}px, ${t.y0 + dy}px)`;
    t.ring.style.setProperty('--travel', `${r}px`);
  }
}
