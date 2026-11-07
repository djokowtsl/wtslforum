import * as THREE from 'three';
import type { PlayerRig } from './DmoLiveCourt3DScene';
import type { NativePlayerPose } from './DmoNativePlayer';
import type { DmoCapturedGroundstroke, GroundstrokePlayback } from './DmoCapturedGroundstroke';
import { isRecordedBackhand } from './DmoCapturedGroundstroke';
import type { makeNativeGrip } from './DmoNativeGrip';
import { racketContactOrientation } from './DmoRacketOrientation';

type Side = 'l' | 'r';
type Grip = ReturnType<typeof makeNativeGrip>;
type SolveArm = (
  shoulder: THREE.Vector3, wrist: THREE.Vector3, upper: number, lower: number, pole: THREE.Vector3,
) => { elbow: THREE.Vector3; wrist: THREE.Vector3 };
type ContactReference = { pivot: THREE.Vector3; head: THREE.Vector3 };
const UP = new THREE.Vector3(0, 1, 0);
const BACKHAND_FACE_ROLL = 72 * Math.PI / 180;

/** The native captured chain drives the racket, never the other way round. */
export class DmoGroundstrokeRig {
  private readonly headOffset: THREE.Vector3;

  constructor(
    private readonly rig: PlayerRig,
    private readonly model: THREE.Group,
    private readonly pose: NativePlayerPose,
    private readonly capture: DmoCapturedGroundstroke,
    private readonly grips: Record<Side, Grip>,
    private readonly localRacket: Record<Side, THREE.Quaternion>,
    private readonly bodyScale: number,
    private readonly solveArm: SolveArm,
  ) {
    rig.root.updateMatrixWorld(true);
    const head = rig.racket.getObjectByName('racket-head');
    if (!head) throw new Error('Captured strokes require a racket string-bed landmark.');
    this.headOffset = rig.racket.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
  }

  private rotation(name: string) {
    return this.rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(this.pose.bones.get(name)!.getWorldQuaternion(new THREE.Quaternion())).normalize();
  }

  private racketFrame(stroke: GroundstrokePlayback['stroke'], side: Side) {
    const hand = this.rotation(`hand_${side}`);
    const centre = this.pose.point(`hand_${side}`)
      .add(this.grips[side].centre.clone().multiplyScalar(this.bodyScale).applyQuaternion(hand));
    const rotation = hand.multiply(this.localRacket[side]).normalize();
    if (isRecordedBackhand(stroke)) rotation.multiply(new THREE.Quaternion()
      .setFromAxisAngle(UP, BACKHAND_FACE_ROLL * (side === 'r' ? 1 : -1)));
    return { centre, rotation };
  }

  private alignContact(playback: GroundstrokePlayback, side: Side) {
    if (!playback.contactTarget) return false;
    const pivot = this.pose.point('spine_01');
    const captured = this.racketFrame(playback.stroke, side);
    const sourceHead = this.headOffset.clone().applyQuaternion(captured.rotation).add(captured.centre);
    const referenceHead = sourceHead.clone().sub(pivot);
    const target = new THREE.Vector3(...playback.contactTarget).sub(pivot);
    const radius = referenceHead.length();
    const horizontal = new THREE.Vector3(target.x, 0, target.z);
    const reachableHorizontal = Math.sqrt(Math.max(0, radius * radius - target.y * target.y));
    const shift = horizontal.clone().addScaledVector(horizontal.clone().normalize(), -reachableHorizontal);
    const limitedShift = shift.length() > 0.18;
    if (limitedShift) shift.setLength(0.18);
    const adjusted = target.sub(shift);
    if (adjusted.lengthSq() < 1e-8) return true;
    const turn = new THREE.Quaternion().setFromUnitVectors(referenceHead.normalize(), adjusted.normalize());
    const angle = turn.angleTo(new THREE.Quaternion());
    const limit = Math.PI / 5;
    const limitedTurn = angle > limit;
    if (limitedTurn) turn.slerp(new THREE.Quaternion(), 1 - limit / angle);
    const weight = THREE.MathUtils.clamp(playback.weight, 0, 1);
    turn.slerp(new THREE.Quaternion(), 1 - weight);
    // One rotation above the waist preserves all captured local arm/wrist
    // rotations. No independent elbow, forearm or neck target is introduced.
    this.pose.orient('spine_01', turn.multiply(this.rotation('spine_01')));
    this.model.position.addScaledVector(shift, weight);
    this.model.updateMatrixWorld(true);
    return limitedShift || limitedTurn || Math.abs(target.y) > radius;
  }

  private swing(name: string, child: string, target: THREE.Vector3) {
    const point = this.pose.point(name);
    const before = this.pose.point(child).sub(point).normalize();
    const after = target.clone().sub(point).normalize();
    if (before.lengthSq() < 0.5 || after.lengthSq() < 0.5) return;
    this.pose.orient(name, new THREE.Quaternion().setFromUnitVectors(before, after).multiply(this.rotation(name)));
  }

  private support(side: Side) {
    const upper = `upperarm_${side}`, lower = `lowerarm_${side}`, hand = `hand_${side}`;
    const shoulder = this.pose.point(upper), elbow = this.pose.point(lower), wrist = this.pose.point(hand);
    const upperLength = shoulder.distanceTo(elbow), lowerLength = elbow.distanceTo(wrist);
    const capturedHand = this.rotation(hand);
    const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(this.rig.racket.quaternion);
    let best: { orientation: THREE.Quaternion; elbow: THREE.Vector3; wrist: THREE.Vector3; centre: THREE.Vector3; score: number } | undefined;
    // The support palm has a small legal range along the handle. Select a
    // physically reachable hand centre first; preserve the captured wrist's
    // nearest roll when more than one grip location can reach.
    for (const along of [0.06, 0.10, 0.14]) for (let step = 0; step < 8; step++) {
      const centre = this.rig.racket.position.clone().addScaledVector(shaft, along);
      const orientation = this.rig.racket.quaternion.clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, step * Math.PI / 4))
        .multiply(this.localRacket[side].clone().invert()).normalize();
      const target = centre.clone().sub(this.grips[side].centre.clone()
        .multiplyScalar(this.bodyScale).applyQuaternion(orientation));
      const solved = this.solveArm(shoulder, target, upperLength, lowerLength, elbow);
      const achieved = solved.wrist.clone().add(this.grips[side].centre.clone()
        .multiplyScalar(this.bodyScale).applyQuaternion(orientation));
      const score = achieved.distanceTo(centre) * 60 + orientation.angleTo(capturedHand) * 0.4
        + Math.abs(along - 0.10) * 2;
      if (!best || score < best.score) best = { ...solved, orientation, centre, score };
    }
    this.swing(upper, lower, best!.elbow);
    this.swing(lower, hand, best!.wrist);
    this.pose.orient(hand, best!.orientation);
    const actual = this.pose.point(hand).add(this.grips[side].centre.clone()
      .multiplyScalar(this.bodyScale).applyQuaternion(best!.orientation));
    return actual.distanceTo(best!.centre);
  }

  apply(playback: GroundstrokePlayback) {
    const dominant: Side = playback.handedness === 'left' ? 'l' : 'r';
    const secondary: Side = dominant === 'r' ? 'l' : 'r';
    const two = playback.hands ? playback.hands === 'two' : Boolean(this.rig.root.userData.twoHandedGrip);
    const freeNames = [`upperarm_${secondary}`, `lowerarm_${secondary}`, `hand_${secondary}`];
    const free = freeNames.map(name => this.pose.bones.get(name)!.quaternion.clone());
    const captured = this.capture.apply(playback);
    if (!captured) {
      delete this.rig.root.userData.nativeGroundstrokeContact;
      return null;
    }
    if (isRecordedBackhand(playback.stroke) && !two) {
      // The source backhand is a generic capture. Keep the free arm's
      // anatomical local pose for one-handed selections; do not force a
      // second grasp or claim this is a professional player's authored style.
      freeNames.forEach((name, i) => this.pose.bones.get(name)!.quaternion.copy(free[i]));
      this.model.updateMatrixWorld(true);
    }
    const limited = this.alignContact(playback, dominant);
    const racket = this.racketFrame(playback.stroke, dominant);
    const flight = this.rig.root.userData.groundstrokeFlight as THREE.Vector3 | undefined;
    if (flight && flight.lengthSq() > 1e-8) {
      const axis = UP.clone().applyQuaternion(racket.rotation);
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(racket.rotation);
      const normal = flight.clone();
      if (normal.dot(face) < 0) normal.negate();
      racket.rotation.copy(racketContactOrientation(axis, normal));
    }
    this.rig.racket.position.copy(racket.centre);
    this.rig.racket.quaternion.copy(racket.rotation);
    this.grips[dominant].setClosed(true);
    this.grips[secondary].setClosed(two);
    const supportError = two ? this.support(secondary) : 0;
    const head = this.headOffset.clone().applyQuaternion(racket.rotation).add(racket.centre);
    this.rig.root.userData.nativeGroundstrokeContact = {
      limited,
      error: playback.contactTarget ? head.distanceTo(new THREE.Vector3(...playback.contactTarget)) : null,
      supportError,
    };
    return captured;
  }
}
