import './style.css';
import GUI from 'lil-gui';
import * as THREE from 'three';
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
import { TerrainView } from './game/terrain-view';
import { createLiftMap, createSurround, Sunlight, toScene } from './game/world';
import { compass, glideTo, TurnTrack } from './sim/instruments';
import { createGlider, stepGlider, type Environment, type GliderState } from './sim/glider';
import { buildIgc, type Fix } from './sim/igc';
import { Polar, WINGS, type WingId } from './sim/polar';
import { dayOfYear, daylight, heating, sunPosition } from './sim/sun';
import { WindField, type Weather } from './sim/wind';

declare const __COMMIT_SHA__: string;

const STEP = 1 / 120;
const AIRSTART_HEIGHT = 120;
const IGC_INTERVAL = 1;
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
  const hud = new Hud(__COMMIT_SHA__);
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

  const model = createGliderModel();
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
  const settings = { wing: 'EN-B' as WingId, crew: 'solo' as Crew, launch: launch.spec.id, liftMap: false };
  const lat = site.toLatLon(extent / 2, extent / 2)[0];
  const day = dayOfYear(new Date());
  const { sunrise, sunset } = daylight(lat, day);
  const sky = { hour: start.hour ?? DEFAULT_HOUR, preset: '', info: '' };
  const PRESETS: Record<string, number> = {
    Sunrise: sunrise + 0.25, Morning: 10, Midday: 13, Afternoon: 15.5, Sunset: sunset - 0.25,
  };
  let polar = new Polar(WINGS[settings.wing]);
  let state: GliderState = createGlider(launch.x, launch.y, launch.z, launch.heading);
  let paused = false;
  let climb = 0;
  let flightTime = 0;
  let glideAvg: number | null = null;
  let groundSpeedAvg = 0;
  let sinkAvg = 0;
  const track = new TurnTrack();
  let fixes: Fix[] = [];
  let fixTimer = 0;
  const startDate = Date.now();
  const pilotPos = new THREE.Vector3();

  function reset(airstart = false): void {
    if (airstart) {
      // Above launch, pointed into the wind, already flying.
      const into = ((weather.windFromDeg * Math.PI) / 180);
      state = createGlider(launch.x, launch.y, launch.z + AIRSTART_HEIGHT, into, 'flying', polar.trim);
      hud.say(`Air start over ${launch.spec.name}, facing into the wind`);
    } else {
      state = createGlider(launch.x, launch.y, launch.z, launch.heading);
      hud.say(`${launch.spec.name} launch · facing ${compass(launch.heading)} · ${KEY.run}`, 6);
    }
    climb = 0;
    flightTime = 0;
    glideAvg = null;
    groundSpeedAvg = state.groundSpeed;
    sinkAvg = 0;
    track.reset();
    fixes = [];
    rig.snap(toScene(extent, state.x, state.y, state.z, pilotPos), state);
  }

  function setLaunch(id: string): void {
    launch = site.launches.find((l) => l.spec.id === id) ?? site.launches[0];
    settings.launch = launch.spec.id;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    writeUrl();
    reset(true);
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

  function onAction(a: Action): void {
    audio.start();
    switch (a) {
      case 'reset': reset(); break;
      case 'airstart': reset(true); break;
      case 'camera': hud.say(`Camera: ${rig.next()}`, 1.5); break;
      case 'mute': audio.muted = !audio.muted; hud.say(audio.muted ? 'Vario muted' : 'Vario on', 1.5); break;
      case 'pause': paused = !paused; hud.say(paused ? 'Paused' : 'Resumed', paused ? 1e9 : 1); break;
      case 'help': hud.toggleHelp(); break;
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
    input.touch = new TouchPad(onAction);
    hud.cycleLayout(); // full → minimal: the full panel covers too much of a phone
  }

  const gui = new GUI({ title: 'Famara Glide' });
  const tm = gui.addFolder('Time of day');
  tm.add(sky, 'preset', ['', ...Object.keys(PRESETS)]).name('Preset').onChange((p: string) => {
    if (p in PRESETS) { sky.hour = PRESETS[p]; setTime(); }
  });
  tm.add(sky, 'hour', 5, 21, 0.05).name('Solar time h').onChange(() => { sky.preset = ''; setTime(); });
  tm.add(sky, 'info').name('Sun').disable();
  const wx = gui.addFolder('Weather');
  wx.add(weather, 'windSpeedKmh', 0, 45, 1).name('Wind km/h').onChange(refreshWeather);
  wx.add(weather, 'windFromDeg', 0, 359, 5).name('Wind from °').onFinishChange(refreshWeather);
  wx.add(weather, 'inversionM', 300, 4000, 50).name('Inversion m').onFinishChange(refreshWeather);
  wx.add(weather, 'thermalStrength', 0, 4, 0.1).name('Thermals m/s').onChange(refreshWeather);
  wx.add(weather, 'turbulence', 0, 1, 0.05).name('Wind turbulence').onChange(refreshWeather);
  const fl = gui.addFolder('Flight');
  fl.add(settings, 'launch', Object.fromEntries(site.launches.map((l) => [l.spec.name, l.spec.id]))).name('Launch').onChange(setLaunch);
  fl.add(settings, 'wing', Object.fromEntries(Object.entries(WINGS).map(([id, w]) => [w.label, id]))).name('Wing').onChange((id: WingId) => {
    polar = new Polar(WINGS[id]);
  });
  fl.add(settings, 'crew', { Solo: 'solo', Tandem: 'tandem' }).name('Pilot').onChange((c: Crew) => model.setCrew(c));
  fl.add(settings, 'liftMap').name('Lift map (L)').onChange(toggleLiftMap);
  fl.add({ sites: () => picker.open(region.id, launch.spec.id) }, 'sites').name('Sites… (M)');
  fl.add({ airstart: () => reset(true) }, 'airstart').name('Air start (T)');
  fl.add({ reset: () => reset() }, 'reset').name('Reset to launch (R)');
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
  reset(true);
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
      acc += dt;
      while (acc >= STEP) {
        clock += STEP;
        stepGlider(state, input.controls, polar, env, STEP);
        acc -= STEP;
      }
      wind.thermals.update(clock, weather.thermalStrength);
      if (state.event === 'takeoff') input.latchRun();
      if (state.event) {
        const [text, warn] = EVENTS[state.event] ?? [state.event, false];
        hud.say(state.event === 'spiral' ? `${text} — ${state.load.toFixed(1)} G` : text, warn ? 5 : 3.5, warn);
        state.event = null;
      }
      const flying = state.phase === 'flying';
      climb += ((flying ? state.vz : 0) - climb) * (1 - Math.exp(-dt / 0.6));
      if (flying) {
        flightTime += dt;
        track.add(state.x, state.y, state.vz, dt);
        // Ratio of averages, not an average of ratios: coming out of lift the instant ratio
        // is huge (14 m/s over 0.2 m/s sink) and would hold L/D at ∞ for seconds.
        const k = 1 - Math.exp(-dt / 4);
        groundSpeedAvg += (state.groundSpeed - groundSpeedAvg) * k;
        sinkAvg += (-state.vz - sinkAvg) * k;
        glideAvg = sinkAvg > 0.2 ? groundSpeedAvg / sinkAvg : Infinity; // climbing or level: no glide ratio to show
        fixTimer += dt;
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
