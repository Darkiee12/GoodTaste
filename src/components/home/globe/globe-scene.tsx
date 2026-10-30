import { OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { FOOD_LOCATIONS, type FoodLocation } from "@/components/home/globe/food-locations";
import {
  AXIAL_TILT_RADIANS,
  GLOBE_RADIUS,
  SPIN_ROLL_RADIANS,
  latLonToVec3,
  type GlobeOverlayBridge,
} from "@/components/home/globe/geo-utils";
import { GlobeAnimator } from "@/components/home/globe/globe-animator";
import { GlobeFallback } from "@/components/home/globe/globe-fallback";
import { GlobeFoodOverlay } from "@/components/home/globe/globe-food-overlay";
import { useGlobeAssets } from "@/components/home/globe/use-globe-assets";
import { useGlobeDishes } from "@/components/home/globe/use-globe-dishes";
import { usePrefersReducedMotion } from "@/components/home/globe/use-prefers-reduced-motion";
import type { Locale, Messages } from "@/shared/i18n";

const DOT_SIZE_PX = 9;
const RING_SCALE = 1.002;
const GLOW_SCALE = 1.16;

function DishAnchor({
  dish,
  anchorsRef,
}: {
  dish: FoodLocation;
  anchorsRef: RefObject<Map<string, THREE.Object3D | null>>;
}) {
  const position = useMemo((): [number, number, number] => {
    const point = new THREE.Vector3();
    latLonToVec3(dish.latitude, dish.longitude, GLOBE_RADIUS * 1.01, point);

    const tuple: [number, number, number] = [point.x, point.y, point.z];

    return tuple;
  }, [dish]);

  return (
    <object3D
      position={position}
      ref={(node) => {
        anchorsRef.current.set(dish.id, node);
      }}
    />
  );
}

function FrameloopGate() {
  const set = useThree((state) => state.set);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const element = gl.domElement;
    let inView = true;
    let pageVisible = document.visibilityState !== "hidden";

    const apply = () => {
      set({ frameloop: inView && pageVisible ? "always" : "never" });
    };

    apply();

    const observer = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        apply();
      },
      { threshold: 0.02 },
    );

    observer.observe(element);

    const onVisibility = () => {
      pageVisible = document.visibilityState !== "hidden";
      apply();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gl, set]);

  return null;
}

/** Reports the first rendered frame once so the canvas wrapper can fade in. */
function FirstFrameReady({ onReady }: { onReady: () => void }) {
  const done = useRef(false);

  useFrame(() => {
    if (!done.current) {
      done.current = true;
      onReady();
    }
  });

  return null;
}

function GlobeWorld({
  bridgeRef,
  onActiveDish,
  onReady,
}: {
  bridgeRef: RefObject<GlobeOverlayBridge>;
  onActiveDish: (id: string | null) => void;
  onReady: () => void;
}) {
  const { layout, halfWidth, initialSpin, texture, atmosphere, atmosphereGlow, dotPositions } =
    useGlobeAssets();

  const spinRef = useRef<THREE.Group | null>(null);
  const anchorsRef = useRef<Map<string, THREE.Object3D | null>>(new Map());

  return (
    <>
      <OrthographicCamera
        makeDefault
        manual
        left={-halfWidth}
        right={halfWidth}
        top={layout.frustumHalfHeight}
        bottom={-layout.frustumHalfHeight}
        near={0.1}
        far={60}
        position={[0, 0, 10]}
      />
      <hemisphereLight args={["#bfd9ff", "#0a1633", 0.9]} />
      <directionalLight position={[-4, 3, 6]} intensity={2.2} color="#fff5e6" />

      <group position={[layout.centerX, layout.centerY, 0]}>
        <group rotation-x={AXIAL_TILT_RADIANS}>
          <group rotation-z={SPIN_ROLL_RADIANS}>
            <group ref={spinRef} rotation-y={initialSpin}>
              <mesh>
                <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
                <meshStandardMaterial map={texture} roughness={1} metalness={0} />
              </mesh>

              <points frustumCulled={false}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[dotPositions, 3]} />
                </bufferGeometry>
                <pointsMaterial
                  size={DOT_SIZE_PX}
                  sizeAttenuation={false}
                  color="#ffd97a"
                  transparent
                  opacity={0.95}
                  depthWrite={false}
                />
              </points>

              {FOOD_LOCATIONS.map((dish) => (
                <DishAnchor key={dish.id} dish={dish} anchorsRef={anchorsRef} />
              ))}
            </group>
          </group>
        </group>

        <mesh scale={GLOW_SCALE} material={atmosphereGlow}>
          <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
        </mesh>

        <mesh scale={RING_SCALE} material={atmosphere}>
          <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
        </mesh>
      </group>

      <GlobeAnimator
        spinRef={spinRef}
        anchorsRef={anchorsRef}
        bridgeRef={bridgeRef}
        onActiveDish={onActiveDish}
        layout={layout}
      />
      <FirstFrameReady onReady={onReady} />
      <FrameloopGate />
    </>
  );
}

/** Lazy, client-only globe experience: WebGL scene plus the DOM food overlay. */
export function GlobeScene({
  copy,
  lang,
  bridgeRef,
}: {
  copy: Messages;
  lang: Locale;
  bridgeRef: RefObject<GlobeOverlayBridge>;
}) {
  const reducedMotion = usePrefersReducedMotion();

  const {
    active,
    preview,
    announcement,
    handleActiveDish,
    handleOpenPreview,
    handleClosePreview,
    handleShowAnother,
  } = useGlobeDishes(bridgeRef, copy);

  const [ready, setReady] = useState(false);
  const [showStatic, setShowStatic] = useState(true);

  const handleReady = useCallback(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    let timer: number | undefined;

    if (ready) {
      timer = window.setTimeout(() => {
        setShowStatic(false);
      }, 700);
    }

    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [ready]);

  if (reducedMotion) {
    return <GlobeFallback label={copy.globeStaticLabel} />;
  }

  return (
    <>
      {showStatic ? (
        <div
          aria-hidden="true"
          className={`absolute inset-0 transition-opacity duration-700 ease-out ${ready ? "opacity-0" : "opacity-100"}`}
        >
          <GlobeFallback label={copy.globeStaticLabel} />
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={`absolute inset-0 transition-opacity duration-700 ease-out ${ready ? "opacity-100" : "opacity-0"}`}
      >
        <Canvas
          orthographic
          dpr={[1, 2]}
          frameloop="always"
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          camera={{ position: [0, 0, 10], near: 0.1, far: 60 }}
        >
          <GlobeWorld bridgeRef={bridgeRef} onActiveDish={handleActiveDish} onReady={handleReady} />
        </Canvas>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-space-deep/40 to-space-deep/25"
      />

      <GlobeFoodOverlay
        copy={copy}
        lang={lang}
        bridgeRef={bridgeRef}
        active={active}
        preview={preview}
        announcement={announcement}
        onOpenPreview={handleOpenPreview}
        onClosePreview={handleClosePreview}
        onShowAnother={handleShowAnother}
      />
    </>
  );
}
