/// <reference types="@react-three/fiber" />
"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  Pixelation,
  Noise,
} from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

const MODEL_TABLE = "/models/table.glb";
const MODEL_REVOLVER = "/models/revolver.glb";
const MODEL_LANTERN = "/models/lantern.glb";
const MODEL_BULLET = "/models/mermi.glb";

export type GunTarget = "self" | "opponent";

// ── Loading fallback ──────────────────────────────────────────────────────────
function LoadingText() {
  return (
    <Html center>
      <div
        style={{
          fontFamily: "monospace",
          letterSpacing: "0.4em",
          fontSize: 11,
          color: "#6b4a30",
          textShadow: "0 0 12px rgba(180,40,20,0.6)",
          whiteSpace: "nowrap",
        }}
      >
        // YÜKLENİYOR…
      </div>
    </Html>
  );
}

// ── Generic GLB loader that darkens materials for the dim room ────────────────
function GLBModel({
  src,
  position,
  rotation = [0, 0, 0],
  scale = 1,
  castShadow = true,
  receiveShadow = true,
}: {
  src: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const { scene } = useGLTF(src);
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = castShadow;
        m.receiveShadow = receiveShadow;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.roughness = Math.min(mat.roughness + 0.15, 1);
            mat.metalness = Math.min(mat.metalness + 0.05, 1);
            mat.envMapIntensity = 0.5;
          }
        });
      }
    });
    return cloned;
  }, [scene, castShadow, receiveShadow]);

  return <primitive object={model} position={position} rotation={rotation} scale={scale} />;
}

// ── Flickering spotlight that hangs above the table ───────────────────────────
function HangingSpot() {
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(new THREE.Object3D());
  const baseIntensity = 45;

  useFrame(({ clock }) => {
    if (!light.current) return;
    const t = clock.elapsedTime;
    const flicker =
      0.92 +
      Math.sin(t * 53.7) * 0.05 +
      Math.sin(t * 17.1) * 0.04 +
      (Math.random() < 0.012 ? -0.45 : 0);
    light.current.intensity = Math.max(0.1, baseIntensity * flicker);
    light.current.position.x = Math.sin(t * 0.6) * 0.04;
    light.current.position.z = Math.cos(t * 0.5) * 0.03;
  });

  return (
    <>
      <primitive object={target.current} position={[0, 0, 0]} />
      <spotLight
        ref={light}
        position={[0, 2.4, 0]}
        target={target.current}
        angle={0.55}
        penumbra={0.18}
        intensity={baseIntensity}
        distance={6}
        decay={1.6}
        color="#ffb86b"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0008}
        shadow-radius={1}
      />
    </>
  );
}

// ── Camera — fixed creepy high-angle view of the table ────────────────────────
function CameraInit() {
  useFrame(({ camera, clock }) => {
    const sway = Math.sin(clock.elapsedTime * 0.3) * 0.008;
    camera.position.set(0.05 + sway, 0.78, 1.15);
    camera.lookAt(0, 0.0, -0.05);
  });
  return null;
}

// ── Interactive revolver with state machine ──────────────────────────────────
// Idle on table  ←→  Raised in front of camera (held)
//   - Self target: barrel rotated toward camera
//   - Opponent target: barrel pointed away
//   - Fire: brief recoil punch + muzzle flash
function InteractiveRevolver({
  held,
  target,
  firing,
  onPickup,
}: {
  held: boolean;
  target: GunTarget;
  firing: boolean;
  onPickup: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const muzzleFlash = useRef<THREE.PointLight>(null);
  const { scene } = useGLTF(MODEL_REVOLVER);
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.roughness = Math.min(mat.roughness + 0.15, 1);
            mat.metalness = Math.min(mat.metalness + 0.1, 1);
          }
        });
      }
    });
    return cloned;
  }, [scene]);

  // Pose targets ──────────────────────────────────────────────────────────────
  // ON_TABLE  — laying on the table, grip toward player
  const TABLE_POS = useMemo(() => new THREE.Vector3(0.05, 0.05, 0.0), []);
  const TABLE_EUL = useMemo(() => new THREE.Euler(0, 0.55, 0), []);

  // HELD aiming at OPPONENT — close to camera, barrel forward (-Z)
  const HELD_OPP_POS = useMemo(() => new THREE.Vector3(0.25, 0.42, 0.5), []);
  const HELD_OPP_EUL = useMemo(() => new THREE.Euler(0, Math.PI, 0), []);

  // HELD aiming at SELF — pointing back at camera
  const HELD_SELF_POS = useMemo(() => new THREE.Vector3(0.18, 0.4, 0.45), []);
  const HELD_SELF_EUL = useMemo(() => new THREE.Euler(0, 0, 0), []);

  // Fire state (internal): keeps recoil playing for ~600ms even if prop flips
  const fireStartedAt = useRef<number | null>(null);
  useFrame((state, delta) => {
    if (!group.current) return;
    const lerp = Math.min(1, delta * 5);

    const targetPos = held
      ? target === "self" ? HELD_SELF_POS : HELD_OPP_POS
      : TABLE_POS;
    const targetEul = held
      ? target === "self" ? HELD_SELF_EUL : HELD_OPP_EUL
      : TABLE_EUL;

    // Lerp position
    group.current.position.lerp(targetPos, lerp);
    // Lerp Euler (per-axis)
    group.current.rotation.x += (targetEul.x - group.current.rotation.x) * lerp;
    group.current.rotation.y += (targetEul.y - group.current.rotation.y) * lerp;
    group.current.rotation.z += (targetEul.z - group.current.rotation.z) * lerp;

    // Idle float when on table, gentle aim sway when held
    const t = state.clock.elapsedTime;
    if (!held) {
      group.current.position.y += Math.sin(t * 0.8) * 0.003;
    } else {
      // Aim sway
      group.current.position.x += Math.sin(t * 1.3) * 0.0015;
      group.current.position.y += Math.cos(t * 1.7) * 0.0015;
    }

    // Recoil — short backward kick + slight upward tilt
    if (firing && fireStartedAt.current === null) {
      fireStartedAt.current = t;
    }
    if (fireStartedAt.current !== null) {
      const elapsed = t - fireStartedAt.current;
      if (elapsed < 0.65) {
        // Ease-out pulse
        const e = Math.max(0, 1 - elapsed / 0.65);
        const kick = Math.sin(elapsed * 25) * e * 0.06;
        const tiltX = e * 0.18;
        group.current.position.z += kick;
        group.current.rotation.x -= tiltX * delta * 4;

        if (muzzleFlash.current) {
          muzzleFlash.current.intensity = e * 18;
        }
      } else {
        fireStartedAt.current = null;
        if (muzzleFlash.current) muzzleFlash.current.intensity = 0;
      }
    } else if (muzzleFlash.current) {
      muzzleFlash.current.intensity = 0;
    }
  });

  // Muzzle flash light position (in front of barrel — flips with target)
  const flashZ = held && target === "opponent" ? -0.5 : 0.5;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPickup();
  };

  return (
    <group
      ref={group}
      scale={0.18}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = held ? "default" : "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      <primitive object={model} />
      <pointLight ref={muzzleFlash} position={[0, 0.15, flashZ]} color="#ffaa22" intensity={0} distance={3} decay={2} />
    </group>
  );
}

// ── Scene contents ────────────────────────────────────────────────────────────
function Scene({
  gunHeld,
  setGunHeld,
  target,
  firing,
}: {
  gunHeld: boolean;
  setGunHeld: (v: boolean) => void;
  target: GunTarget;
  firing: boolean;
}) {
  return (
    <>
      <CameraInit />
      <ambientLight intensity={0.02} color="#100502" />
      <HangingSpot />

      {/* Floor — nearly black, catches the shadow pool */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#050302" roughness={1} metalness={0} />
      </mesh>

      <GLBModel src={MODEL_TABLE} position={[0, -0.5, 0]} scale={0.6} receiveShadow />

      <InteractiveRevolver
        held={gunHeld}
        target={target}
        firing={firing}
        onPickup={() => setGunHeld(true)}
      />

      <GLBModel src={MODEL_LANTERN} position={[0, 2.05, 0]} scale={0.35} castShadow={false} />

      <GLBModel src={MODEL_BULLET} position={[-0.32, 0.04, 0.18]} rotation={[Math.PI / 2, 0, 0.3]} scale={0.05} />
      <GLBModel src={MODEL_BULLET} position={[0.38, 0.04, 0.05]} rotation={[Math.PI / 2, 0, -0.7]} scale={0.05} />
      <GLBModel src={MODEL_BULLET} position={[-0.08, 0.04, 0.28]} rotation={[Math.PI / 2, 0, 1.4]} scale={0.05} />
      <GLBModel src={MODEL_BULLET} position={[0.22, 0.04, 0.22]} rotation={[Math.PI / 2, 0, -0.2]} scale={0.05} />
    </>
  );
}

// ── Main canvas ───────────────────────────────────────────────────────────────
export default function DuelArena3D({
  isYourTurn,
  gunHeld,
  setGunHeld,
  target,
  firing,
}: {
  isYourTurn: boolean;
  gunHeld: boolean;
  setGunHeld: (v: boolean) => void;
  target: GunTarget;
  firing: boolean;
}) {
  // Reference isYourTurn so it's not "unused" — could drive scene mood later
  void isYourTurn;
  return (
    <Canvas
      shadows="basic"
      camera={{ position: [0.05, 0.78, 1.15], fov: 48 }}
      gl={{
        antialias: false,
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.75,
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        // Allow click events on the gun mesh; UI panels above with their
        // own backgrounds will capture clicks where they overlay.
        pointerEvents: "auto",
        background: "#000000",
        zIndex: 1,
      }}
    >
      <color attach="background" args={["#000000"]} />

      <Suspense fallback={<LoadingText />}>
        <Scene gunHeld={gunHeld} setGunHeld={setGunHeld} target={target} firing={firing} />
      </Suspense>

      <EffectComposer>
        <Pixelation granularity={3} />
        <Bloom intensity={0.9} luminanceThreshold={0.5} luminanceSmoothing={0.4} mipmapBlur />
        <Noise opacity={0.045} />
        <Vignette eskil={false} offset={0.22} darkness={0.95} />
      </EffectComposer>
    </Canvas>
  );
}

useGLTF.preload(MODEL_TABLE);
useGLTF.preload(MODEL_REVOLVER);
useGLTF.preload(MODEL_LANTERN);
useGLTF.preload(MODEL_BULLET);
