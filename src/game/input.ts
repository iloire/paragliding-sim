// Keyboard + gamepad + touch → Controls. Keys are digital, so brakes ramp towards their
// target instead of snapping; gamepad triggers are analog and used as-is.

import type { Controls } from '../sim/glider';
import type { TouchPad } from './touch';

const RAMP = 2.5; // brake travel per second on keys
const TURN_BRAKE = 0.7;
/** Past TURN_BRAKE, Shift feeds the brake in this slowly (per second): hold it longer to wind a spiral tighter. */
const DEEP_RAMP = 0.15;
const BOTH_BRAKES = 0.55;

export type Action = 'reset' | 'camera' | 'mute' | 'pause' | 'help' | 'lift' | 'nextLaunch' | 'layout' | 'menu' | 'warp';

const ACTION_KEYS: Record<string, Action> = {
  KeyR: 'reset', KeyC: 'camera', KeyV: 'mute',
  KeyP: 'pause', KeyH: 'help', KeyL: 'lift', KeyN: 'nextLaunch', KeyI: 'layout', KeyM: 'menu', Escape: 'menu', KeyT: 'warp',
};
// Standard-mapping gamepad buttons.
const PAD = { A: 0, B: 1, X: 2, Y: 3, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 };
const PAD_ACTIONS: [number, Action][] = [[PAD.Y, 'camera'], [PAD.BACK, 'reset'], [PAD.START, 'pause']];

export class Input {
  readonly controls: Controls = { brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false };
  private keys = new Set<string>();
  private padPrev: boolean[] = [];
  private keyLeft = 0;
  private keyRight = 0;
  private keyBar = 0;
  /** Set at lift-off: the held run key must be released before it works as speed bar. */
  private runLatched = false;

  /** Set on touch screens; its thumbs combine with the keys and pad like a second pad. */
  touch: TouchPad | null = null;

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
    const deep = this.down('ShiftLeft', 'ShiftRight');
    const turnBrake = deep ? 1 : TURN_BRAKE;
    const targetL = flare ? 1 : Math.min((this.down('KeyA', 'ArrowLeft') ? turnBrake : 0) + both, 1);
    const targetR = flare ? 1 : Math.min((this.down('KeyD', 'ArrowRight') ? turnBrake : 0) + both, 1);
    const ramp = (v: number, t: number) => v + Math.max(-RAMP * dt, Math.min(RAMP * dt, t - v));
    // Shift pulls to the turn brake as fast as ever, then feeds the rest in slowly: how deep a
    // spiral winds is how long Shift is held.
    const brakeRamp = (v: number, t: number) => {
      if (!deep || flare || t <= v) return ramp(v, t);
      return v < TURN_BRAKE ? Math.min(ramp(v, t), TURN_BRAKE) : Math.min(v + DEEP_RAMP * dt, t);
    };
    this.keyLeft = brakeRamp(this.keyLeft, targetL);
    this.keyRight = brakeRamp(this.keyRight, targetR);
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

    const t = this.touch?.read();
    const touchRun = t?.run ?? false;
    if (this.runLatched && !forward && !padRun && !touchRun) this.runLatched = false;
    const bar = this.runLatched ? 0 : 1;
    this.keyBar = ramp(this.keyBar, forward ? bar : 0);
    padBar *= bar;

    const c = this.controls;
    c.brakeLeft = Math.max(this.keyLeft, padL, t?.brakeLeft ?? 0);
    c.brakeRight = Math.max(this.keyRight, padR, t?.brakeRight ?? 0);
    c.speedBar = Math.max(this.keyBar, padBar, (t?.speedBar ?? 0) * bar);
    c.weightShift = Math.max(-1, Math.min(1, shift + padShift + (t?.weightShift ?? 0)));
    c.run = forward || padRun || touchRun;
  }
}
