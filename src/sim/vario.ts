// The vario law, ported from the esp32-vario firmware (src/VarioAudio.cpp + config.h)
// so the sim sounds like the instrument in the harness.

export const CLIMB_ON = 0.2;
export const SINK_ON = -2.0;
const FREQ_MIN = 400;
const FREQ_MAX = 1600;
const CLIMB_MAX = 5.0;
const SINK_FREQ = 220;

export type VarioTone =
  | { mode: 'silent' }
  | { mode: 'sink'; freq: number }
  | { mode: 'beep'; freq: number; periodMs: number };

export function varioTone(climb: number): VarioTone {
  if (climb <= SINK_ON) return { mode: 'sink', freq: SINK_FREQ };
  if (climb < CLIMB_ON) return { mode: 'silent' };
  const f = Math.min(Math.max(climb / CLIMB_MAX, 0), 1);
  // Pitch and repeat rate both rise with lift: 600 ms at weak lift → 120 ms at strong.
  return { mode: 'beep', freq: FREQ_MIN + f * (FREQ_MAX - FREQ_MIN), periodMs: 600 - f * 480 };
}
