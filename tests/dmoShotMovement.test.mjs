import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DMO_SLIDE_COOLDOWN_SECONDS,
  classifyDmoShotMovement,
  dmoShotMovementAt,
  measureDmoShot,
  planDmoShotMovements,
} from '../lib/dmoShotMovement.mjs';
import { deriveLiveCourtFootworkEvents } from '../lib/liveCourtMotion.ts';

const FPS = 30;
// Samples every 2 frames: [ballX, ballZ, ballHeight, p1X, p1Z, p2X, p2Z] in cm.
// Player 1 runs sideways along the baseline (x = -1200 cm) at `speed` m/s
// until `contact`, then (when `brake`) nearly stops; the ball is `reach` m to
// his side at contact.
function run({ contact = 300, speed = 4.5, reach = 1.2, brake = true, height = 0.9, start = 0, end = 400 } = {}) {
  const samples = [];
  for (let frame = start; frame <= end; frame += 2) {
    const before = Math.min(frame, contact);
    const after = Math.max(0, frame - contact);
    const z = (before / FPS) * speed * 100 + (after / FPS) * (brake ? 0.5 : speed) * 100;
    const atContact = frame === contact;
    samples.push({
      frame,
      values: [atContact ? -1200 : 0, atContact ? z + reach * 100 : 0, atContact ? height * 100 : 50, -1200, z, 1200, 0],
    });
  }
  return samples;
}
const shot = (frame, player = 1, shotType = 'rally') => ({ frame, kind: 'shot', player, shotType });

test('a shot is measured from the run-in, the stop and the reach', () => {
  const measured = measureDmoShot(run(), shot(300), FPS);
  assert.ok(Math.abs(measured.approachSpeed - 4.5) < 0.01);
  assert.ok(Math.abs(measured.speedAfter - 0.5) < 0.01);
  assert.ok(Math.abs(measured.reach - 1.2) < 0.01);
  assert.ok(Math.abs(measured.ballHeight - 0.9) < 0.01);
  assert.equal(measured.depth, 12);
  assert.equal(measureDmoShot(run(), shot(500), FPS), null, 'no samples at the contact');
});

test('slides depend on the surface: clay often, hard flat out only, grass never', () => {
  const clayRun = measureDmoShot(run({ speed: 4.0, reach: 1.1 }), shot(300), FPS);
  assert.equal(classifyDmoShotMovement(clayRun, 'clay'), 'slide');
  assert.equal(classifyDmoShotMovement(clayRun, 'hard'), null);
  assert.equal(classifyDmoShotMovement(clayRun, 'grass'), null);
  const flatOut = measureDmoShot(run({ speed: 5, reach: 1.5 }), shot(300), FPS);
  assert.equal(classifyDmoShotMovement(flatOut, 'hard'), 'slide');
  assert.equal(classifyDmoShotMovement(flatOut, 'grass'), 'stretch', 'grass: a stretch, not a slide');
  const noStop = measureDmoShot(run({ speed: 4.5, reach: 1.2, brake: false }), shot(300), FPS);
  assert.equal(classifyDmoShotMovement(noStop, 'clay'), null, 'running through the shot is not a slide');
  const walk = measureDmoShot(run({ speed: 1.5, reach: 1.6 }), shot(300), FPS);
  assert.equal(classifyDmoShotMovement(walk, 'clay'), 'stretch');
  const net = { approachSpeed: 5, speedAfter: 0.5, reach: 1.2, ballHeight: 1, depth: 3 };
  assert.equal(classifyDmoShotMovement(net, 'clay'), null, 'no slides at the net');
  assert.equal(classifyDmoShotMovement(null, 'clay'), null);
});

test('the plan skips serves and keeps slides apart', () => {
  const samples = [...run({ contact: 300, end: 340 }), ...run({ contact: 360, start: 342, end: 420 })
    .map(({ frame, values }) => ({ frame, values }))];
  const events = [shot(300), shot(360), shot(200, 2, 'serve')];
  const plan = planDmoShotMovements(samples, events, { surface: 'clay', frameRate: FPS });
  assert.equal(plan.length >= 1, true);
  assert.equal(plan[0].kind, 'slide');
  assert.ok(plan.every((entry) => entry.player === 1), 'the serve is never planned');
  const slides = plan.filter((entry) => entry.kind === 'slide');
  for (let index = 1; index < slides.length; index += 1) {
    assert.ok(slides[index].frame - slides[index - 1].frame >= DMO_SLIDE_COOLDOWN_SECONDS * FPS);
  }
  assert.equal(dmoShotMovementAt(plan, 1, 300)?.kind, 'slide');
  assert.equal(dmoShotMovementAt(plan, 2, 300), null);
  assert.deepEqual(planDmoShotMovements(null, events), []);
});

test('with a surface, footwork slides only where realistic', () => {
  // A hard sideways stop at 3 m/s: the old rule slid on every one.
  const samples = [];
  for (let frame = 0; frame <= 60; frame += 2) {
    const z = frame <= 30 ? frame / 60 * 300 : 150 + (frame - 30) / 60 * 20;
    samples.push({ frame, values: [0, 0, 0, -1200, z, 1200, 0] });
  }
  const slides = (events) => events.filter((event) => event.kind === 'slide');
  assert.ok(slides(deriveLiveCourtFootworkEvents(samples, 60)).length > 0, 'unchanged without options');
  assert.equal(slides(deriveLiveCourtFootworkEvents(samples, 60, { surface: 'clay' })).length, 0, 'too slow to slide');
  assert.equal(slides(deriveLiveCourtFootworkEvents(samples, 60, { surface: 'grass' })).length, 0);
  const planned = deriveLiveCourtFootworkEvents(samples, 60, { surface: 'hard', shotSlides: [{ frame: 40, player: 1 }] });
  assert.deepEqual(slides(planned), [{ frame: 28, kind: 'slide', player: 1, shot: true }], 'a planned slide starts 0.2 s before contact');
});

test('the court plays the slide clip and the forehand slice from the plan', async () => {
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(court, /planDmoShotMovements\(sampleBufferRef\.current, trajectoryEventsRef\.current/);
  assert.match(court, /shotSlides: shotMovements\.filter\(\(movement\) => movement\.kind === 'slide'\)/);
  assert.match(court, /movement\?\.kind === 'slide' && capturedEvent\.stroke === 'backhand' && bundledSource\?\.clips\['slide-backhand'\]/);
  assert.match(court, /movement\.reach >= LAST_DITCH_REACH/);
  assert.match(court, /movement\.ballHeight < LAST_DITCH_HEIGHT/);
  assert.match(court, /capturedEvent\.lastDitch = true;/);
  assert.match(court, /const spinSlice = capturedEvent\.stroke === 'backhand'/, 'backspin alone never slices a forehand');
  assert.match(court, /\.\.\.\(capturedEvent\.slide \? \{ slide: true \} : \{\}\)/);
  const bundled = await readFile(new URL('../components/DmoBundledGroundstroke.ts', import.meta.url), 'utf8');
  assert.match(bundled, /playback\.slide && playback\.stroke === 'backhand' && source\?\.clips\['slide-backhand'\]\) return 'slide-backhand'/);
  const loader = await readFile(new URL('../components/useNativePlayerMotions.ts', import.meta.url), 'utf8');
  assert.match(loader, /clips\['slide-backhand'\] = slide/);
  assert.match(loader, /if \(!clips\['slice-forehand'\]\)/, "a player's own forehand slice wins");
  assert.match(loader, /clips\['stretch-slice-forehand'\] = slice/, 'the stand-in is for last-ditch forehands only');
  assert.match(bundled, /playback\.lastDitch && playback\.stroke === 'forehand' && !source\?\.clips\['slice-forehand'\]/);
  const catalog = await readFile(new URL('../lib/nativeMotionCatalog.ts', import.meta.url), 'utf8');
  assert.match(catalog, /'slide-backhand': \{ clipId: 'a2c075e329bf25172543_80477a8d19745e08'/);
});

test('a slide into a shot eases in and out smoothly and lasts longer than a quick stop', async () => {
  const { liveCourtSlideWeight } = await import('../lib/liveCourtMotion.ts');
  const shotSlide = [{ frame: 0, kind: 'slide', player: 1, shot: true }];
  const quickStop = [{ frame: 0, kind: 'slide', player: 1 }];
  const curve = [];
  for (let frame = 0; frame <= 50; frame += 1) curve.push(liveCourtSlideWeight(shotSlide, 1, frame, 60));
  assert.equal(curve[0], 0, 'starts from nothing');
  assert.ok(Math.max(...curve) > 0.95, 'reaches full strength');
  assert.equal(liveCourtSlideWeight(shotSlide, 1, 45, 60), 0, 'over by 0.75 s');
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(Math.abs(curve[index] - curve[index - 1]) < 0.15, `no jump at frame ${index}`);
  }
  assert.ok(liveCourtSlideWeight(shotSlide, 1, 30, 60) > liveCourtSlideWeight(quickStop, 1, 30, 60));
});

test('during a slide the legs follow the stroke, and feet never go below the court', async () => {
  for (const file of ['DmoNativePlayer.ts', 'DmoNativePlayerClaude.ts']) {
    const source = await readFile(new URL(`../components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /const running = runningLegs \* \(playback\?\.slideIn \? 1 - captureWeight : 1\);/, file);
    assert.match(source, /if \(ankle\.y >= ANKLE_FLOOR\) continue;/, file);
    const clamp = source.indexOf('if (ankle.y >= ANKLE_FLOOR) continue;');
    assert.ok(clamp > source.indexOf('capturedGroundstroke.applyGesture('), `${file}: after strokes and gestures`);
    assert.ok(clamp < source.indexOf('distributeNativeTwist(pose.bones, pose.rest);'), `${file}: before the shoes`);
  }
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(court, /if \(movement\?\.kind === 'slide'\) capturedEvent\.slideIn = true;/);
  assert.match(court, /\.\.\.\(capturedEvent\.slideIn \? \{ slideIn: true \} : \{\}\)/);
});

test('a slide without a slide recording gets slide legs, on a side fixed for the whole slide', async () => {
  for (const file of ['DmoNativePlayer.ts', 'DmoNativePlayerClaude.ts']) {
    const source = await readFile(new URL(`../components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /const slideLegs = slidePose && !playback\?\.slide \?/, `${file}: not over the slide recording`);
    const legs = source.indexOf('const slideLegs = ');
    assert.ok(legs > source.indexOf('capturedGroundstroke.apply(strokePlayback)'), `${file}: after the stroke's legs`);
    assert.ok(legs < source.indexOf('rig.racket.quaternion.copy(handOrientation'), `${file}: before the racket is placed`);
    assert.ok(legs < source.indexOf('if (ankle.y >= ANKLE_FLOOR) continue;'), `${file}: the floor still applies after`);
  }
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(court, /rig\.root\.userData\.slideSide = slideDirection \|\| 1;/);
  assert.match(court, /rig\.root\.userData\.slidePose = \{ weight: slideWeight, side: rig\.root\.userData\.slideSide \};/);
});
