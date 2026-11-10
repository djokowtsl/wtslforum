import * as THREE from 'three';

export const BROADCAST_TIME_OF_DAY_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
] as const;

export type BroadcastTimeOfDay = typeof BROADCAST_TIME_OF_DAY_OPTIONS[number]['value'];

type LightingPreset = {
  sky: number;
  fog: number;
  hemisphere: number;
  key: number;
  fill: number;
  floodlights: number;
  floodlightFixtureEmission: number;
  exposure: number;
  sunPosition: [number, number, number];
  sunColor: number;
  cloudColor: number;
  cloudOpacity: number;
  visibleClouds: number;
};

const PRESETS: Record<BroadcastTimeOfDay, LightingPreset> = {
  day: {
    sky: 0x7194aa,
    fog: 0x71878e,
    hemisphere: 1.2,
    key: 2.15,
    fill: 0.68,
    floodlights: 0,
    floodlightFixtureEmission: 0,
    exposure: 1,
    sunPosition: [-52, 68, -105],
    sunColor: 0xffe8b0,
    cloudColor: 0xf1f4f2,
    cloudOpacity: 0.72,
    visibleClouds: 6,
  },
  evening: {
    sky: 0x8f6c68,
    fog: 0x80666a,
    hemisphere: 0.82,
    key: 1.22,
    fill: 0.62,
    floodlights: 0.45,
    floodlightFixtureEmission: 0,
    exposure: 0.94,
    sunPosition: [-91, 23, -96],
    sunColor: 0xffae72,
    cloudColor: 0xe2b5a1,
    cloudOpacity: 0.82,
    visibleClouds: 8,
  },
  night: {
    sky: 0x08101e,
    fog: 0x0b1422,
    hemisphere: 0.92,
    key: 0.24,
    fill: 0.66,
    floodlights: 60,
    floodlightFixtureEmission: 0.45,
    exposure: 0.82,
    sunPosition: [-91, 23, -96],
    sunColor: 0xffae72,
    cloudColor: 0x3d4b60,
    cloudOpacity: 0.28,
    visibleClouds: 2,
  },
};

const CLOUD_POSITIONS: Array<[number, number, number, number]> = [
  [-60, 37, -88, 1.05],
  [61, 44, 76, 0.9],
  [-78, 51, 44, 0.82],
  [86, 48, -62, 0.8],
  [-24, 108, -12, 1.15],
  [5, 39, 111, 1.1],
  [32, 96, 20, 0.8],
  [22, 42, -102, 1.15],
];

export function createDmoBroadcastLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  indoor: boolean,
) {
  const hemisphere = new THREE.HemisphereLight(0xe2e4df, 0x34383a, 1.2);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff0dc, 2.15);
  key.position.set(-8, 22, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 25;
  key.shadow.camera.bottom = -25;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xc4d0d0, 0.68);
  fill.position.set(17, 9, -14);
  scene.add(fill);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PRESETS.day.sky, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.name = 'wtsl-broadcast-sky';
  const stadiumRim = scene.getObjectByName('wtsl-stadium-superstructure');
  const rimHeight = stadiumRim?.userData.upperRimHeight;
  sky.position.y = !indoor && typeof rimHeight === 'number' && Number.isFinite(rimHeight)
    ? rimHeight
    : -12;
  sky.userData.lowerHorizonY = sky.position.y;
  sky.visible = !indoor;
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 20, 14),
    new THREE.MeshBasicMaterial({ color: PRESETS.day.sunColor, fog: false, depthWrite: false }),
  );
  sun.name = 'wtsl-broadcast-sun';
  sun.position.set(...PRESETS.day.sunPosition);
  sun.frustumCulled = false;
  sun.renderOrder = -90;
  scene.add(sun);

  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'wtsl-broadcast-cloud-cover';
  const cloudGeometry = new THREE.SphereGeometry(1, 12, 8);
  const cloudMaterials: THREE.MeshBasicMaterial[] = [];
  CLOUD_POSITIONS.forEach(([x, y, z, scale], index) => {
    const cluster = new THREE.Group();
    cluster.name = `broadcast-cloud-${index + 1}`;
    cluster.position.set(x, y, z);
    const material = new THREE.MeshBasicMaterial({
      color: PRESETS.day.cloudColor,
      transparent: true,
      opacity: PRESETS.day.cloudOpacity,
      depthWrite: false,
      fog: false,
    });
    cloudMaterials.push(material);
    for (const [offsetX, offsetY, offsetZ, size] of [
      [-0.75, 0, 0, 1],
      [0, 0.18, 0, 1.25],
      [0.8, 0, 0.04, 0.9],
    ]) {
      const puff = new THREE.Mesh(cloudGeometry, material);
      puff.position.set(offsetX * scale, offsetY * scale, offsetZ * scale);
      puff.scale.set(7.5 * size * scale, 2.2 * size * scale, 3.8 * size * scale);
      puff.renderOrder = -80;
      cluster.add(puff);
    }
    cloudGroup.add(cluster);
  });
  cloudGroup.visible = !indoor;
  scene.add(cloudGroup);

  const floodlightFixtures: THREE.Mesh[] = [];
  const floodlights: THREE.SpotLight[] = [];
  const stadiumCourtLights: THREE.SpotLight[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.SpotLight && object.name === 'wtsl-stadium-court-fill-light') {
      stadiumCourtLights.push(object);
    }
  });
  for (const x of [-20, 20]) {
    for (const z of [-15, 15]) {
      const fixture = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.2, 0.34),
        new THREE.MeshStandardMaterial({
          color: 0x303b44,
          emissive: 0xffe7b0,
          emissiveIntensity: 0,
          roughness: 0.56,
          metalness: 0.35,
        }),
      );
      fixture.name = 'wtsl-broadcast-floodlight-fixture';
      fixture.position.set(x, 18, z);
      scene.add(fixture);
      floodlightFixtures.push(fixture);

      const light = new THREE.SpotLight(0xffe7cc, 0, 72, Math.PI / 3, 0.72, 1);
      light.name = 'wtsl-broadcast-floodlight';
      light.position.set(x, 18, z);
      light.target.position.set(x * 0.12, 0, z * 0.35);
      light.castShadow = false;
      scene.add(light, light.target);
      floodlights.push(light);
    }
  }

  const apply = (timeOfDay: BroadcastTimeOfDay) => {
    const preset = PRESETS[timeOfDay];
    const skyMaterial = sky.material as THREE.MeshBasicMaterial;
    const sunMaterial = sun.material as THREE.MeshBasicMaterial;
    skyMaterial.color.setHex(preset.sky);
    sunMaterial.color.setHex(preset.sunColor);
    sky.visible = !indoor;
    // Time-of-day sky belongs above the open rim, never in holes between seats.
    scene.background = new THREE.Color(indoor ? 0x182129 : 0x26383b);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(indoor ? 0x182129 : preset.fog);
    hemisphere.intensity = preset.hemisphere;
    key.color.setHex(timeOfDay === 'evening' ? 0xffc18d : 0xfff0dc);
    key.intensity = preset.key;
    key.position.set(...preset.sunPosition);
    fill.intensity = preset.fill;
    stadiumCourtLights.forEach(light => {
      const daylightIntensity = Number(light.userData.wtslDaylightIntensity ?? 0);
      light.intensity = timeOfDay === 'night'
        ? 0
        : daylightIntensity * (timeOfDay === 'evening' ? 0.45 : 1);
    });
    sun.position.set(...preset.sunPosition);
    sun.visible = !indoor && timeOfDay !== 'night';
    cloudGroup.visible = !indoor;
    cloudGroup.children.forEach((cluster, index) => {
      cluster.visible = index < preset.visibleClouds;
      cluster.scale.setScalar(timeOfDay === 'evening' ? 1.14 : timeOfDay === 'night' ? 0.78 : 1);
    });
    cloudMaterials.forEach(material => {
      material.color.setHex(preset.cloudColor);
      material.opacity = preset.cloudOpacity;
    });
    floodlights.forEach(light => { light.intensity = preset.floodlights; });
    floodlightFixtures.forEach(fixture => {
      (fixture.material as THREE.MeshStandardMaterial).emissiveIntensity = preset.floodlightFixtureEmission;
    });
    renderer.toneMappingExposure = preset.exposure;
    scene.userData.wtslBroadcastTimeOfDay = timeOfDay;
  };

  return { apply };
}
