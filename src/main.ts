import './style.css';
import GUI from 'lil-gui';
import * as THREE from 'three';
import { durationBucket, gaEvent, startAnalytics, track as count } from './game/analytics';
import { FlightAudio } from './game/audio';
import { CameraRig } from './game/camera';
import { CloudLayer } from './game/clouds';
import { Hud, type HudFrame } from './game/hud';
import { Input, type Action } from './game/input';
import { TouchPad } from './game/touch';
import { clockTime, loadCatalog, parseStart, startQuery } from './game/catalog';
import { SitePicker } from './game/picker';
import { loadSite, type Launch } from './game/site';
import { createGlider as createGliderModel, type Crew } from './game/wing';
import { DEFAULT_PRESET, PRESETS as WING_PRESETS, RANGES, WingCard, classDefaults, polarFor, presetChoice, shapeFor, type WingChoice } from './game/wing-setup';
import { TerrainView } from './game/terrain-view';
import { createLiftMap, createSurround, Sunlight, toScene } from './game/world';
import { glideTo, TurnTrack } from './sim/instruments';
import { createGlider, stepGlider, type Environment, type GliderState } from './sim/glider';
import { buildIgc, type Fix } from './sim/igc';
import { WINGS } from './sim/polar';
import { dayOfYear, flyingHours, heating, sunPosition } from './sim/sun';
import { WindField, type Weather } from './sim/wind';

declare const __COMMIT_SHA__: string;

const STEP = 1 / 120;
const START_HEIGHT = 120;
const IGC_INTERVAL = 1;
/** Time warp steps T cycles through; anything that needs the pilot drops it back to 1×. */
const WARPS = [1, 2, 4, 8];
/** Solar time a flight starts at without ?time= — the thermals' peak, which the weather sliders describe. */
const DEFAULT_HOUR = 13;

/** Phones and tablets: thumb pads instead of keys, and a lighter renderer. */
const TOUCH = matchMedia('(pointer: coarse)').matches;
const KEY = TOUCH ? { run: 'push a thumb up', reset: 'RESET' } : { run: 'hold W', reset: 'R' };

const EVENTS: Record<string, [string, boolean]> = {
  takeoff: ['Airborne — work the lift band in front of the ridge', false],
  landed: [`Landed — ${KEY.run} to relaunch · ${KEY.reset} to reset`, false],
  crashed: [`Crashed — too fast or too hard. ${KEY.reset} to reset`, true],
  water: [`In the Atlantic. ${KEY.reset} to reset`, true],
  stall: ['STALL — hands up!', true],
  recovered: ['Recovered', false],
  collapse: ['COLLAPSE — weight-shift away, brake the open side, pump the folded one', true],
  reinflated: ['Reinflated', false],
  spiral: ['Spiral dive', false],
};

async function boot(): Promise<void> {
  startAnalytics();
  const hud = new Hud(__COMMIT_SHA__, TOUCH);
  const regions = await loadCatalog();
  const start = parseStart(location.search, regions);
  const region = start.region;
  const line = document.querySelector('.loading-line');
  if (line) line.textContent = `Loading ${region.spec.name} terrain…`;
  const site = await loadSite(region.id, region.spec);
  const terrain = site.terrain;
  const extent = terrain.extent;

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  // Phone screens are 3x: rendering all of it costs more fill rate than it shows.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TOUCH ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 200000);
  const sunlight = new Sunlight(scene, renderer);
  const ortho = await new THREE.TextureLoader().loadAsync(site.orthoUrl);

  const weather: Weather = { ...site.spec.weather };
  if (start.wind) {
    weather.windFromDeg = start.wind.fromDeg;
    weather.windSpeedKmh = start.wind.kmh;
  }
  const wind = new WindField(terrain, weather);
  const liftMap = createLiftMap(wind);
  const terrainView = new TerrainView(terrain, ortho, site.detailTileM, site.detailTiles, liftMap.texture,
    renderer.capabilities.getMaxAnisotropy());
  scene.add(terrainView.group, createSurround(extent, site.spec.plainM));
  const clouds = new CloudLayer(extent);
  scene.add(clouds.group);

  let model = createGliderModel();
  scene.add(model.group);
  const rig = new CameraRig(camera, canvas);
  const audio = new FlightAudio();

  let clock = 0;
  const env: Environment = {
    air: (x, y, z) => wind.sample(x, y, z, clock),
    ground: (x, y) => terrain.groundAt(x, y),
    isWater: (x, y) => terrain.isWater(x, y),
  };

  let launch: Launch = site.launches.find((l) => l.spec.id === start.launchId) ?? site.launches[0];
  const settings = { preset: DEFAULT_PRESET, crew: 'solo' as Crew, liftMap: false };
  const wing: WingChoice = presetChoice(DEFAULT_PRESET) ?? presetChoice(WING_PRESETS[0].name)!;
  const lat = site.toLatLon(extent / 2, extent / 2)[0];
  const day = dayOfYear(new Date());
  const hours = flyingHours(lat, day); // no flying in the dark, whatever ?time= says
  const sky = { hour: Math.min(Math.max(start.hour ?? DEFAULT_HOUR, hours.first), hours.last), preset: '', info: '' };
  const PRESETS: Record<string, number> = {
    Sunrise: hours.first, Morning: 10, Midday: 13, Afternoon: 15.5, Sunset: hours.last,
  };
  let polar = polarFor(wing);
  let state: GliderState = createGlider(launch.x, launch.y, launch.z, launch.heading);
  let paused = false;
  let warp = 1;
  let climb = 0;
  let flightTime = 0;
  let airborne = false; // a flight is under way, so its end is worth counting
  let glideAvg: number | null = null;
  let groundSpeedAvg = 0;
  let sinkAvg = 0;
  const track = new TurnTrack();
  let fixes: Fix[] = [];
  let fixTimer = 0;
  const startDate = Date.now();
  const pilotPos = new THREE.Vector3();

  /** The one way to start a flight: above the launch, pointed into the wind, already flying. */
  function reset(): void {
    const into = ((weather.windFromDeg * Math.PI) / 180);
    state = createGlider(launch.x, launch.y, launch.z + START_HEIGHT, into, 'flying', polar.trim);
    hud.say(`Over ${launch.spec.name}, facing into the wind`);
    climb = 0;
    flightTime = 0;
    airborne = false;
    glideAvg = null;
    groundSpeedAvg = state.groundSpeed;
    sinkAvg = 0;
    track.reset();
    fixes = [];
    rig.snap(toScene(extent, state.x, state.y, state.z, pilotPos), state);
  }

  function setLaunch(id: string): void {
    launch = site.launches.find((l) => l.spec.id === id) ?? site.launches[0];
    siteButton.name(siteLabel());
    writeUrl();
    reset();
  }

  /** Keeps the address bar a link to the current setup. */
  function writeUrl(): void {
    history.replaceState(null, '', startQuery(region.id, launch.spec.id, weather.windFromDeg, weather.windSpeedKmh, sky.hour));
  }

  /** Puts the sun where the hour says, and lets it set the thermals and the light. */
  function setTime(): void {
    const sun = sunPosition(lat, day, sky.hour);
    const heat = heating(lat, day, sky.hour);
    wind.setSun(heat, sun.dir);
    sunlight.set(sun.dir, sun.elevationDeg);
    clouds.setTint(sunlight.cloudTint);
    sky.info = `${clockTime(sky.hour)} · heating ${Math.round(heat * 100)} %`;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    writeUrl();
  }

  function refreshWeather(): void {
    wind.setWeather({ ...weather });
    if (settings.liftMap) liftMap.refresh();
    writeUrl();
  }

  function pickSite(regionId: string, launchId: string): void {
    if (regionId === region.id) setLaunch(launchId);
    else location.search = startQuery(regionId, launchId, undefined, undefined, sky.hour); // new terrain: reload, with that region's own weather
  }

  let pausedBeforePicker = false;
  const picker = new SitePicker(regions, pickSite, (open) => {
    if (open) pausedBeforePicker = paused;
    paused = open || pausedBeforePicker;
  });

  function downloadIgc(): void {
    if (fixes.length === 0) { hud.say('No flight recorded yet'); return; }
    const blob = new Blob([buildIgc(fixes, site.spec.name)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `famara-glide-${new Date(startDate).toISOString().slice(0, 10)}.igc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function setWarp(w: number): void {
    warp = w;
    hud.setWarp(w);
  }

  function onAction(a: Action): void {
    audio.start();
    switch (a) {
      case 'reset': reset(); break;
      case 'camera': hud.say(`Camera: ${rig.next()}`, 1.5); break;
      case 'mute': audio.muted = !audio.muted; hud.say(audio.muted ? 'Vario muted' : 'Vario on', 1.5); break;
      case 'pause': paused = !paused; hud.say(paused ? 'Paused' : 'Resumed', paused ? 1e9 : 1); break;
      case 'help': hud.toggleHelp(); break;
      case 'warp': setWarp(WARPS[(WARPS.indexOf(warp) + 1) % WARPS.length]); hud.say(`Time ×${warp}`, 1.5); break;
      case 'layout': hud.say(`Instrument: ${hud.cycleLayout()}`, 1.5); break;
      case 'lift': toggleLiftMap(!settings.liftMap); break;
      case 'sites': if (picker.isOpen) picker.close(); else picker.open(region.id, launch.spec.id); break;
      case 'nextLaunch': {
        const i = site.launches.indexOf(launch);
        setLaunch(site.launches[(i + 1) % site.launches.length].spec.id);
        break;
      }
    }
  }

  function toggleLiftMap(on: boolean): void {
    settings.liftMap = on;
    if (on) liftMap.refresh();
    terrainView.setLift(on);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  const input = new Input(onAction);
  canvas.addEventListener('pointerdown', () => audio.start());
  if (TOUCH) {
    input.touch = new TouchPad(onAction, (dx, dy) => rig.drag(dx, dy));
  }

  const gui = new GUI({ title: 'Famara Glide' });
  const tm = gui.addFolder('Time of day');
  tm.add(sky, 'preset', ['', ...Object.keys(PRESETS)]).name('Preset').onChange((p: string) => {
    if (p in PRESETS) { sky.hour = PRESETS[p]; setTime(); }
  });
  tm.add(sky, 'hour', hours.first, hours.last, 0.05).name('Solar time h').onChange(() => { sky.preset = ''; setTime(); });
  tm.add(sky, 'info').name('Sun').disable();
  const wx = gui.addFolder('Weather');
  wx.add(weather, 'windSpeedKmh', 0, 45, 1).name('Wind km/h').onChange(refreshWeather);
  wx.add(weather, 'windFromDeg', 0, 359, 5).name('Wind from °').onFinishChange(refreshWeather);
  wx.add(weather, 'inversionM', 300, 4000, 50).name('Inversion m').onFinishChange(refreshWeather);
  wx.add(weather, 'thermalStrength', 0, 4, 0.1).name('Thermals m/s').onChange(refreshWeather);
  wx.add(weather, 'turbulence', 0, 1, 0.05).name('Wind turbulence').onChange(refreshWeather);
  const fl = gui.addFolder('Flight');
  // The picker is the one place to choose a launch; this row says where you are and opens it.
  const siteLabel = () => `${region.spec.name} · ${launch.spec.name} (M)`;
  const siteButton = fl.add({ sites: () => picker.open(region.id, launch.spec.id) }, 'sites').name(siteLabel());
  fl.add(settings, 'preset', [...WING_PRESETS.map((p) => p.name), 'Custom']).name('Wing').onChange((name: string) => {
    const p = presetChoice(name);
    if (!p) return;
    Object.assign(wing, p);
    ws.controllers.forEach((c) => c.updateDisplay());
    setWing();
  });
  // Changes take effect at once, in the air too: the polar and the body under the pilot are rebuilt.
  const ws = fl.addFolder('Wing setup').close();
  const card = new WingCard();
  const custom = () => { settings.preset = 'Custom'; fl.controllers.forEach((c) => c.updateDisplay()); setWing(); };
  ws.add(wing, 'wing', Object.fromEntries(Object.entries(WINGS).map(([id, w]) => [w.label, id]))).name('Class').onChange(() => {
    Object.assign(wing, classDefaults(wing.wing, wing.allUpKg));
    ws.controllers.forEach((c) => c.updateDisplay());
    custom();
  });
  ws.add(wing, 'areaM2', ...RANGES.areaM2).name('Flat area m²').onChange(custom);
  ws.add(wing, 'aspectRatio', ...RANGES.aspectRatio).name('Aspect ratio').onChange(custom);
  ws.add(wing, 'allUpKg', ...RANGES.allUpKg).name('All-up weight kg').onChange(custom);
  ws.$children.appendChild(card.element);
  function setWing(): void {
    polar = polarFor(wing);
    card.update(wing, polar);
    // A new size, aspect ratio or class is a different canopy: draw it afresh.
    scene.remove(model.group);
    model.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat()) m.dispose();
    });
    model = createGliderModel(shapeFor(wing, polar));
    model.setCrew(settings.crew);
    scene.add(model.group);
  }
  setWing();
  fl.add(settings, 'crew', { Solo: 'solo', Tandem: 'tandem' }).name('Pilot').onChange((c: Crew) => model.setCrew(c));
  fl.add(settings, 'liftMap').name('Lift map (L)').onChange(toggleLiftMap);
  fl.add({ warp: () => onAction('warp') }, 'warp').name('Time warp (T)');
  fl.add({ reset }, 'reset').name('Restart (R)');
  fl.add({ igc: downloadIgc }, 'igc').name('Download IGC');
  if (TOUCH) gui.close();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  if (import.meta.env.DEV) {
    // Dev-only handle for browser-driven checks.
    Object.assign(window, {
      __sim: {
        get state() { return state; }, wind, terrain, launches: site.launches,
        /** Orbit camera at an offset from the pilot, in the pilot's heading frame (right, up, back). */
        frame(right: number, up: number, back: number) {
          while (rig.mode !== 'orbit') rig.next();
          const h = state.heading;
          camera.position.set(
            pilotPos.x + right * Math.cos(h) - back * Math.sin(h),
            pilotPos.y + up,
            pilotPos.z + right * Math.sin(h) + back * Math.cos(h),
          );
        },
      },
    });
  }

  setTime();
  reset();
  if (TOUCH) tapToFly();
  else hud.ready();

  /** Phones only unlock sound, fullscreen and the orientation lock from a tap, so ask for one. */
  function tapToFly(): void {
    const loading = document.getElementById('loading');
    const line = loading?.querySelector('.loading-line');
    if (!loading || !line) { hud.ready(); return; }
    line.textContent = 'Tap to fly — pull a thumb down to brake, push up to run, slide sideways to shift weight';
    loading.addEventListener('click', () => {
      audio.start();
      void document.documentElement.requestFullscreen?.().catch(() => {});
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void orientation.lock?.('landscape').catch(() => {}); // Android in fullscreen only
      hud.ready();
    }, { once: true });
  }

  let last = performance.now();
  let acc = 0;
  renderer.setAnimationLoop((now) => {
    // The first frame's timestamp can predate `last`, so never step backwards.
    const dt = Math.min(Math.max(now - last, 0) / 1000, 0.25);
    last = now;
    input.update(dt);

    if (!paused) {
      // Warp runs more fixed steps per frame; the flight's own clocks (time, track, averages, IGC) follow it.
      const simDt = dt * warp;
      acc += simDt;
      while (acc >= STEP) {
        clock += STEP;
        stepGlider(state, input.controls, polar, env, STEP);
        acc -= STEP;
      }
      wind.thermals.update(clock, weather.thermalStrength);
      if (state.event === 'takeoff') input.latchRun();
      if (state.event) {
        countFlight(state.event);
        const [text, warn] = EVENTS[state.event] ?? [state.event, false];
        if (warn || state.event === 'landed') setWarp(1);
        hud.say(state.event === 'spiral' ? `${text} — ${state.load.toFixed(1)} G` : text, warn ? 5 : 3.5, warn);
        state.event = null;
      }
      const flying = state.phase === 'flying';
      climb += ((flying ? state.vz : 0) - climb) * (1 - Math.exp(-simDt / 0.6));
      if (flying) {
        airborne = true;
        flightTime += simDt;
        track.add(state.x, state.y, state.vz, simDt);
        // Ratio of averages, not an average of ratios: coming out of lift the instant ratio
        // is huge (14 m/s over 0.2 m/s sink) and would hold L/D at ∞ for seconds.
        const k = 1 - Math.exp(-simDt / 4);
        groundSpeedAvg += (state.groundSpeed - groundSpeedAvg) * k;
        sinkAvg += (-state.vz - sinkAvg) * k;
        glideAvg = sinkAvg > 0.2 ? groundSpeedAvg / sinkAvg : Infinity; // climbing or level: no glide ratio to show
        fixTimer += simDt;
        if (fixTimer >= IGC_INTERVAL) {
          fixTimer = 0;
          const [lat, lon] = site.toLatLon(state.x, state.y);
          fixes.push({ time: new Date(startDate + clock * 1000), lat, lon, alt: state.z });
        }
      }
    }

    toScene(extent, state.x, state.y, state.z, pilotPos);
    model.group.position.copy(pilotPos);
    // The body's own attitude: canopy, lines and pilot swing as one.
    model.group.rotation.set(state.pitch, -state.yaw, -state.roll);
    model.update(state, input.controls, dt);
    clouds.update(wind.thermals.clouds(clock, ...windUV(), wind.cloudbase));

    const ground = terrain.groundAt(state.x, state.y);
    const camGroundZ = terrain.groundAt(...camGround());
    rig.update(dt, pilotPos, state, toScene(extent, 0, 0, camGroundZ).y);
    terrainView.update(camera.position, camera.position.y - camGroundZ);
    audio.update(dt, climb, state.airspeed, state.phase === 'flying');
    const [dx, dy] = wind.direction;
    const glide = state.phase === 'flying' ? glideAvg : null;
    hud.update(dt, state, {
      climb, agl: state.z - ground, glide, flightSeconds: flightTime,
      windKmh: wind.windSpeedAt(state.x, state.y, state.z) * 3.6, windToRad: Math.atan2(dx, dy),
      landing: nearestLanding(glide), track,
    });
    renderer.render(scene, camera);
  });

  /** Takeoffs and how flights end, for the GoatCounter dashboard and GA. */
  function countFlight(event: string): void {
    if (event === 'takeoff') {
      count(`flight/${region.id}/${launch.spec.id}`, `${wing.wing} ${settings.crew}`);
      gaEvent('takeoff', { region: region.id, launch: launch.spec.id, wing: wing.wing, size: wing.areaM2, load: Math.round(wing.allUpKg), crew: settings.crew });
    } else if (airborne && (event === 'landed' || event === 'crashed' || event === 'water')) {
      airborne = false;
      count(`${event}/${durationBucket(flightTime)}`);
      gaEvent(event, { region: region.id, launch: launch.spec.id, seconds: Math.round(flightTime) });
    }
  }

  function nearestLanding(glide: number | null): HudFrame['landing'] {
    let best: HudFrame['landing'] = null;
    for (const l of site.landings) {
      const g = glideTo(state.x, state.y, state.z, l.x, l.y, l.z, glide);
      if (!best || g.distance < best.glide.distance) best = { name: l.spec.name, glide: g };
    }
    return best;
  }

  function windUV(): [number, number] {
    const [dx, dy] = wind.direction;
    return [dx * wind.speed, dy * wind.speed];
  }

  /** Sim (x, y) under the camera, for keeping it above the ground. */
  function camGround(): [number, number] {
    return [camera.position.x + extent / 2, extent / 2 - camera.position.z];
  }
}

boot().catch((err) => {
  console.error(err);
  const line = document.querySelector('.loading-line');
  if (line) line.textContent = `Failed to load: ${String(err)}`;
});
