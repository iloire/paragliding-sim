// Keyboard + gamepad → Controls. Keys are digital, so brakes ramp towards their
// target instead of snapping; gamepad triggers are analog and used as-is.

import type { Controls } from '../sim/glider';

const RAMP = 2.5; // brake travel per second on keys
const TURN_BRAKE = 0.7;
const BOTH_BRAKES = 0.55;

export type Action = 'reset' | 'airstart' | 'camera' | 'mute' | 'pause' | 'help' | 'lift' | 'nextLaunch';

const ACTION_KEYS: Record<string, Action> = {
  KeyR: 'reset', KeyT: 'airstart', KeyC: 'camera', KeyV: 'mute',
  KeyP: 'pause', KeyH: 'help', KeyL: 'lift', KeyN: 'nextLaunch',
};
// Standard-mapping gamepad buttons.
const PAD = { A: 0, B: 1, X: 2, Y: 3, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 };
const PAD_ACTIONS: [number, Action][] = [[PAD.Y, 'camera'], [PAD.BACK, 'reset'], [PAD.START, 'pause'], [PAD.X, 'airstart']];

export class Input {
  readonly controls: Controls = { brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false };
  private keys = new Set<string>();
  private padPrev: boolean[] = [];
  private keyLeft = 0;
  private keyRight = 0;
  private keyBar = 0;
  /** Set at lift-off: the held run key must be released before it works as speed bar. */
  private runLatched = false;

  constructor(private readonly onAction: (a: Action) => void) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!e.repeat && ACTION_KEYS[e.code]) onAction(ACTION_KEYS[e.code]);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Call on lift-off so the run you're still holding doesn't slam the speed bar. */
  latchRun(): void {
    this.runLatched = true;
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number): void {
    const both = this.down('KeyS', 'ArrowDown') ? BOTH_BRAKES : 0;
    const flare = this.down('Space');
    // Shift turns a normal turn into a deep brake — the way into a spiral.
    const turnBrake = this.down('ShiftLeft', 'ShiftRight') ? 1 : TURN_BRAKE;
    const targetL = flare ? 1 : Math.min((this.down('KeyA', 'ArrowLeft') ? turnBrake : 0) + both, 1);
    const targetR = flare ? 1 : Math.min((this.down('KeyD', 'ArrowRight') ? turnBrake : 0) + both, 1);
    const ramp = (v: number, t: number) => v + Math.max(-RAMP * dt, Math.min(RAMP * dt, t - v));
    this.keyLeft = ramp(this.keyLeft, targetL);
    this.keyRight = ramp(this.keyRight, targetR);
    const forward = this.down('KeyW', 'ArrowUp');
    const shift = (this.down('KeyE') ? 1 : 0) - (this.down('KeyQ') ? 1 : 0);

    let padL = 0, padR = 0, padBar = 0, padShift = 0, padRun = false;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      padL = pad.buttons[PAD.LT]?.value ?? 0;
      padR = pad.buttons[PAD.RT]?.value ?? 0;
      const stick = pad.axes[0] ?? 0;
      padShift = Math.abs(stick) > 0.12 ? stick : 0;
      padRun = pad.buttons[PAD.A]?.pressed ?? false;
      padBar = padRun || pad.buttons[PAD.RB]?.pressed ? 1 : 0;
      for (const [b, action] of PAD_ACTIONS) {
        const pressed = pad.buttons[b]?.pressed ?? false;
        if (pressed && !this.padPrev[b]) this.onAction(action);
        this.padPrev[b] = pressed;
      }
    }

    if (this.runLatched && !forward && !padRun) this.runLatched = false;
    const bar = this.runLatched ? 0 : 1;
    this.keyBar = ramp(this.keyBar, forward ? bar : 0);
    padBar *= bar;

    const c = this.controls;
    c.brakeLeft = Math.max(this.keyLeft, padL);
    c.brakeRight = Math.max(this.keyRight, padR);
    c.speedBar = Math.max(this.keyBar, padBar);
    c.weightShift = Math.max(-1, Math.min(1, shift + padShift));
    c.run = forward || padRun;
  }
}
