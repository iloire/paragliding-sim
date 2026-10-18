// Vario beeper and wind noise on WebAudio. Browsers only allow audio after a
// user gesture, so start() is called from the first key press or click.

import { varioTone } from '../sim/vario';

export class FlightAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private beepGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private phase = 0;
  muted = false;

  start(): void {
    if (this.ctx) {
      // iOS can create the context suspended if the first touch wasn't a tap; any later one resumes it.
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.beepGain = ctx.createGain();
    this.beepGain.gain.value = 0;
    this.osc.connect(this.beepGain).connect(master);
    this.osc.start();

    // Wind: looped white noise through a low-pass that opens with airspeed.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(master);
    src.start();
  }

  update(dt: number, climb: number, airspeed: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.osc || !this.beepGain || !this.windGain || !this.windFilter) return;
    const now = ctx.currentTime;
    const tone = this.muted || !active ? { mode: 'silent' as const } : varioTone(climb);
    let on = false;
    if (tone.mode === 'sink') {
      this.osc.frequency.setTargetAtTime(tone.freq, now, 0.02);
      on = true;
    } else if (tone.mode === 'beep') {
      this.osc.frequency.setTargetAtTime(tone.freq, now, 0.01);
      this.phase = (this.phase + (dt * 1000) / tone.periodMs) % 1;
      on = this.phase < 0.5;
    } else {
      this.phase = 0;
    }
    // Short time constant = no clicks at the beep edges.
    this.beepGain.gain.setTargetAtTime(on ? 0.22 : 0, now, 0.008);

    const a = active ? Math.min(airspeed / 15, 1.4) : 0;
    this.windGain.gain.setTargetAtTime(0.12 * a * a, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + airspeed * 45, now, 0.1);
  }
}
