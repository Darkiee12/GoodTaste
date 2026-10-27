import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { createEarthTexture } from "@/components/home/globe/earth-texture";
import { FOOD_LOCATIONS } from "@/components/home/globe/food-locations";
import {
  GLOBE_RADIUS,
  Longitude,
  computeGlobeLayout,
  latLonToVec3,
  spinForLongitude,
  type GlobeLayout,
} from "@/components/home/globe/geo-utils";

const OPENING_LONGITUDE = Longitude(105.8542);
const ATMOSPHERE_OPACITY = 0.55;

const ATMOSPHERE_VERTEX = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = `
varying vec3 vNormal;
uniform vec3 glowColor;
uniform float opacity;
void main() {
  float rim = 0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0));
  float intensity = rim * rim;
  gl_FragColor = vec4(glowColor, 1.0) * intensity * opacity;
}
`;

export type GlobeAssets = {
  layout: GlobeLayout;
  halfWidth: number;
  initialSpin: number;
  texture: THREE.CanvasTexture;
  atmosphere: THREE.ShaderMaterial;
  dotPositions: Float32Array;
};

/**
 * Globe scene assets and their lifecycles: viewport layout, earth texture,
 * atmosphere material, and dish-dot positions. Must run inside the Canvas;
 * the scene component only places what this returns.
 */
export function useGlobeAssets(): GlobeAssets {
  const size = useThree((state) => state.size);
  const layout = useMemo(() => computeGlobeLayout(size), [size]);
  const halfWidth = layout.frustumHalfHeight * (size.width / size.height);
  const initialSpin = useMemo(() => spinForLongitude(OPENING_LONGITUDE), []);
  const texture = useMemo(() => createEarthTexture(), []);

  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );

  const atmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          glowColor: { value: new THREE.Color("#7dd3fc") },
          opacity: { value: ATMOSPHERE_OPACITY },
        },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      atmosphere.dispose();
    },
    [atmosphere],
  );

  const dotPositions = useMemo(() => {
    const positions = new Float32Array(FOOD_LOCATIONS.length * 3);
    const point = new THREE.Vector3();

    for (const [index, dish] of FOOD_LOCATIONS.entries()) {
      latLonToVec3(dish.latitude, dish.longitude, GLOBE_RADIUS * 1.006, point);
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
    }

    return positions;
  }, []);

  return { layout, halfWidth, initialSpin, texture, atmosphere, dotPositions };
}
