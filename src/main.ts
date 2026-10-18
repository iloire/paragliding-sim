import './style.css';
import GUI from 'lil-gui';
import * as THREE from 'three';
import { FlightAudio } from './game/audio';
import { CameraRig } from './game/camera';
import { CloudLayer } from './game/clouds';
import { Hud } from './game/hud';
import { Input, type Action } from './game/input';
import { loadSite, type Launch } from './game/site';
import { createGlider as createGliderModel } from './game/wing';
import { TerrainView } from './game/terrain-view';
import { createLiftMap, createSea, createSkyAndLight, toScene } from './game/world';
import { createGlider, stepGlider, type Environment, type GliderState } from './sim/glider';
import { buildIgc, type Fix } from './sim/igc';
import { Polar, WINGS, type WingId } from './sim/polar';
import { WindField, type Weather } from './sim/wind';

declare const __COMMIT_SHA__: string;

const STEP = 1 / 120;
const AIRSTART_HEIGHT = 120;
const IGC_INTERVAL = 1;

const EVENTS: Record<string, [string, boolean]> = {
  takeoff: ['Airborne — work the lift band in front of the ridge', false],
  landed: ['Landed. Hold W to relaunch · R to reset', false],
  crashed: ['Crashed — too fast or too hard. R to reset', true],
  water: ['In the Atlantic. R to reset', true],
  stall: ['STALL — hands up!', true],
  recovered: ['Recovered', false],
  collapse: ['COLLAPSE — weight-shift away, brake the open side, pump the folded one', true],
  reinflated: ['Reinflated', false],
  spiral: ['Spiral dive', false],
};

async function boot(): Promise<void> {
  const hud = new Hud(__COMMIT_SHA__);
  const site = await loadSite('famara');
  const terrain = site.terrain;
  const extent = terrain.extent;

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 200000);
  createSkyAndLight(scene, renderer);
  const ortho = await new THREE.TextureLoader().loadAsync(site.orthoUrl);

  const weather: Weather = { ...site.spec.weather };
  const wind = new WindField(terrain, weather);
  const liftMap = createLiftMap(wind);
  const terrainView = new TerrainView(terrain, ortho, site.detailTileM, site.detailTiles, liftMap.texture,
    renderer.capabilities.getMaxAnisotropy());
  scene.add(terrainView.group, createSea());
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

  const settings = { wing: 'EN-B' as WingId, launch: site.launches[0].spec.id, liftMap: false };
  let polar = new Polar(WINGS[settings.wing]);
  let launch: Launch = site.launches[0];
  let state: GliderState = createGlider(launch.x, launch.y, launch.z, launch.heading);
  let paused = false;
  let climb = 0;
  let flightTime = 0;
  let glideAvg: number | null = null;
  let fixes: Fix[] = [];
  let fixTimer = 0;
  const startDate = Date.now();
  const pilotPos = new THREE.Vector3();

  function compass(rad: number): string {
    const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return names[Math.round(((rad * 180) / Math.PI / 22.5) % 16 + 16) % 16];
  }

  function reset(airstart = false): void {
    if (airstart) {
      // Above launch, pointed into the wind, already flying.
      const into = ((weather.windFromDeg * Math.PI) / 180);
      state = createGlider(launch.x, launch.y, launch.z + AIRSTART_HEIGHT, into, 'flying', polar.trim);
      hud.say(`Air start over ${launch.spec.name}, facing into the wind`);
    } else {
      state = createGlider(launch.x, launch.y, launch.z, launch.heading);
      hud.say(`${launch.spec.name} launch · facing ${compass(launch.heading)} · hold W to run`, 6);
    }
    climb = 0;
    flightTime = 0;
    glideAvg = null;
    fixes = [];
    rig.snap(toScene(extent, state.x, state.y, state.z, pilotPos), state);
  }

  function setLaunch(id: string): void {
    launch = site.launches.find((l) => l.spec.id === id) ?? site.launches[0];
    settings.launch = launch.spec.id;
    reset(true);
  }

  function refreshWeather(): void {
    wind.setWeather({ ...weather });
    if (settings.liftMap) liftMap.refresh();
  }

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
      case 'lift': toggleLiftMap(!settings.liftMap); break;
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

  const gui = new GUI({ title: 'Famara Glide' });
  const wx = gui.addFolder('Weather');
  wx.add(weather, 'windSpeedKmh', 0, 45, 1).name('Wind km/h').onChange(refreshWeather);
  wx.add(weather, 'windFromDeg', 0, 359, 5).name('Wind from °').onFinishChange(refreshWeather);
  wx.add(weather, 'inversionM', 300, 2500, 50).name('Inversion m').onFinishChange(refreshWeather);
  wx.add(weather, 'thermalStrength', 0, 4, 0.1).name('Thermals m/s').onChange(refreshWeather);
  wx.add(weather, 'turbulence', 0, 1, 0.05).name('Turbulence').onChange(refreshWeather);
  const fl = gui.addFolder('Flight');
  fl.add(settings, 'launch', Object.fromEntries(site.launches.map((l) => [l.spec.name, l.spec.id]))).name('Launch').onChange(setLaunch);
  fl.add(settings, 'wing', Object.fromEntries(Object.entries(WINGS).map(([id, w]) => [w.label, id]))).name('Wing').onChange((id: WingId) => {
    polar = new Polar(WINGS[id]);
  });
  fl.add(settings, 'liftMap').name('Lift map (L)').onChange(toggleLiftMap);
  fl.add({ airstart: () => reset(true) }, 'airstart').name('Air start (T)');
  fl.add({ reset: () => reset() }, 'reset').name('Reset to launch (R)');
  fl.add({ igc: downloadIgc }, 'igc').name('Download IGC');

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

  reset(true);
  hud.ready();

  let last = performance.now();
  let acc = 0;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.25);
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
        if (-state.vz > 0.2) {
          const glide = state.groundSpeed / -state.vz;
          glideAvg = glideAvg === null || !Number.isFinite(glideAvg) ? glide : glideAvg + (glide - glideAvg) * (1 - Math.exp(-dt / 4));
        } else {
          glideAvg = Infinity; // climbing or level: no glide ratio to show
        }
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
    clouds.update(wind.thermals.clouds(clock, ...windUV(), weather.inversionM));

    const ground = terrain.groundAt(state.x, state.y);
    const camGroundZ = terrain.groundAt(...camGround());
    rig.update(dt, pilotPos, state, toScene(extent, 0, 0, camGroundZ).y);
    terrainView.update(camera.position, camera.position.y - camGroundZ);
    audio.update(dt, climb, state.airspeed, state.phase === 'flying');
    const [dx, dy] = wind.direction;
    hud.update(dt, state, climb, state.z - ground, state.phase === 'flying' ? glideAvg : null, flightTime,
      wind.windSpeedAt(state.x, state.y, state.z) * 3.6, Math.atan2(dx, dy));
    renderer.render(scene, camera);
  });

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
