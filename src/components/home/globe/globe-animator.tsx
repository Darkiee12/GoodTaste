import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import {
  FOOD_LOCATIONS,
  SURPRISE_DISH_EVENT,
  type FoodLocation,
} from "@/components/home/globe/food-locations";
import {
  FACING_COSINE_THRESHOLD,
  GLOBE_REVOLUTION_SECONDS,
  SPIN_DIRECTION,
  facingCosine,
  type GlobeLayout,
  type GlobeOverlayBridge,
  type ViewportSize,
} from "@/components/home/globe/geo-utils";

/**
 * Dish rhythm: a new pick every 3.6s matches the 3.2s show + 0.38s exit for
 * near-seamless handoffs, and the 10s cooldown fits inside one window cycle
 * (3 dishes x 3.6s = 10.8s). Brief pauses still occur over ocean sectors
 * with no curated dishes in view (e.g. the Pacific transit).
 */
const DISH_INTERVAL_SECONDS = 3.6;
const DISH_COOLDOWN_SECONDS = 10;

type AnchorReading = {
  cosine: number;
  x: number;
  y: number;
  inZone: boolean;
};

type AnimatorTemps = {
  world: THREE.Vector3;
  projected: THREE.Vector3;
  center: THREE.Vector3;
};

function readAnchor(
  anchor: THREE.Object3D,
  camera: THREE.Camera,
  size: ViewportSize,
  layout: GlobeLayout,
  temps: AnimatorTemps,
): AnchorReading {
  anchor.getWorldPosition(temps.world);
  temps.center.set(0, layout.centerY, 0);

  const cosine = facingCosine(temps.world, temps.center, camera.position);
  temps.projected.copy(temps.world).project(camera);

  const x = (temps.projected.x * 0.5 + 0.5) * size.width;
  const y = (-temps.projected.y * 0.5 + 0.5) * size.height;
  const zoneTop = Math.max(size.height * 0.6, size.height - layout.capPx - 150);

  const inZone =
    x > size.width * 0.06 && x < size.width * 0.94 && y > zoneTop && y < size.height - 8;

  return { cosine, x, y, inZone };
}

/**
 * Spins the globe, schedules the visible dish, and positions the DOM overlay
 * node every frame. Runs inside the Canvas; pauses with frameloop="never".
 */
export function GlobeAnimator({
  spinRef,
  anchorsRef,
  bridgeRef,
  onActiveDish,
  layout,
}: {
  spinRef: RefObject<THREE.Group | null>;
  anchorsRef: RefObject<Map<string, THREE.Object3D | null>>;
  bridgeRef: RefObject<GlobeOverlayBridge>;
  onActiveDish: (id: string | null) => void;
  layout: GlobeLayout;
}) {
  const temps = useMemo<AnimatorTemps>(
    () => ({
      world: new THREE.Vector3(),
      projected: new THREE.Vector3(),
      center: new THREE.Vector3(),
    }),
    [],
  );

  const lastTick = useRef(DISH_INTERVAL_SECONDS * -1 + 1);
  const lastShown = useRef(new Map<string, number>());
  const forceRandom = useRef(false);

  useEffect(() => {
    const surprise = () => {
      forceRandom.current = true;
      lastTick.current = -1000;
    };

    window.addEventListener(SURPRISE_DISH_EVENT, surprise);

    return () => {
      window.removeEventListener(SURPRISE_DISH_EVENT, surprise);
    };
  }, []);

  const pickDish = (camera: THREE.Camera, size: ViewportSize, now: number): FoodLocation | null => {
    const eligible: Array<{ dish: FoodLocation; cosine: number }> = [];

    for (const dish of FOOD_LOCATIONS) {
      const anchor = anchorsRef.current.get(dish.id);

      if (!anchor) {
        continue;
      }

      const reading = readAnchor(anchor, camera, size, layout, temps);

      if (reading.cosine <= FACING_COSINE_THRESHOLD || !reading.inZone) {
        continue;
      }

      const last = lastShown.current.get(dish.id) ?? DISH_COOLDOWN_SECONDS * -2;

      if (now - last < DISH_COOLDOWN_SECONDS) {
        continue;
      }

      eligible.push({ dish, cosine: reading.cosine });
    }

    if (eligible.length === 0) {
      return null;
    }

    if (forceRandom.current) {
      const pick = eligible[Math.floor(Math.random() * eligible.length)];

      return pick === undefined ? null : pick.dish;
    }

    let best = eligible[0];

    for (const candidate of eligible) {
      if (best === undefined || candidate.cosine > best.cosine) {
        best = candidate;
      }
    }

    return best === undefined ? null : best.dish;
  };

  useFrame((state, delta) => {
    const spin = spinRef.current;

    if (!spin) {
      return;
    }

    spin.rotation.y +=
      (SPIN_DIRECTION * Math.min(delta, 0.1) * Math.PI * 2) / GLOBE_REVOLUTION_SECONDS;

    const bridge = bridgeRef.current;
    const now = state.clock.elapsedTime;

    if (now - lastTick.current >= DISH_INTERVAL_SECONDS && !document.hidden && !bridge.paused) {
      lastTick.current = now;

      const next = pickDish(state.camera, state.size, now);
      forceRandom.current = false;

      if (next) {
        lastShown.current.set(next.id, now);
      }

      const nextId = next ? next.id : null;

      if (nextId !== bridge.activeId) {
        bridge.activeId = nextId;
        onActiveDish(nextId);
      }
    }

    const node = bridge.node;
    const anchor = bridge.activeId ? anchorsRef.current.get(bridge.activeId) : undefined;

    if (!node || !anchor) {
      return;
    }

    const reading = readAnchor(anchor, state.camera, state.size, layout, temps);

    if (reading.cosine > FACING_COSINE_THRESHOLD && reading.inZone) {
      bridge.x = reading.x;
      bridge.y = reading.y;
      bridge.anchored = true;
      node.style.transform = `translate3d(${reading.x.toFixed(1)}px, ${(reading.y - 12).toFixed(1)}px, 0)`;
    } else {
      bridge.anchored = false;

      if (!bridge.paused && bridge.activeId) {
        bridge.activeId = null;
        onActiveDish(null);
      }
    }
  });

  return null;
}
