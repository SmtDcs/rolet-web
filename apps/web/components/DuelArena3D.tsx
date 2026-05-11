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

// ── Camera — first-person sitting at the table, FOV punches on fire ──────────
function CameraInit({ firing }: { firing: boolean }) {
  useFrame(({ camera, clock }, delta) => {
    const lerp = Math.min(1, delta * 3);
    const sway = Math.sin(clock.elapsedTime * 0.4) * 0.008;
    // Sitting at the table, eye level looking slightly down toward the table
    camera.position.x += (0.0 + sway - camera.position.x) * lerp;
    camera.position.y += (0.55 - camera.position.y) * lerp;
    camera.position.z += (0.7 - camera.position.z) * lerp;
    camera.lookAt(0, 0.05, -0.6);

    // FOV punch on fire — muzzle blast feels closer
    if ("fov" in camera) {
      const persp = camera as THREE.PerspectiveCamera;
      const targetFov = firing ? 68 : 58;
      persp.fov += (targetFov - persp.fov) * lerp;
      persp.updateProjectionMatrix();
    }
  });
  return null;
}

// ── World-space gun — directly in the scene, fixed position ──────────────────
function FPSGun({
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
      }
    });
    return cloned;
  }, [scene]);

  // FIXED world-space pose — exact values requested
  const BASE_POS = useMemo(() => new THREE.Vector3(1.2, 0.4, -0.2), []);
  const BASE_EUL_OPP = useMemo(() => new THREE.Euler(0, -1.8, 0), []);
  // Self target — rotate barrel back toward camera
  const BASE_EUL_SELF = useMemo(() => new THREE.Euler(0.3, -3.5, 0.2), []);

  const fireStartedAt = useRef<number | null>(null);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    const lerp = Math.min(1, delta * 6);

    const tgtEul = target === "self" ? BASE_EUL_SELF : BASE_EUL_OPP;

    // Always at BASE_POS — barrel rotates with target
    group.current.position.lerp(BASE_POS, lerp);
    group.current.rotation.x += (tgtEul.x - group.current.rotation.x) * lerp;
    group.current.rotation.y += (tgtEul.y - group.current.rotation.y) * lerp;
    group.current.rotation.z += (tgtEul.z - group.current.rotation.z) * lerp;

    // Idle float / aim sway
    group.current.position.x += Math.sin(t * 1.0) * 0.005;
    group.current.position.y += Math.cos(t * 1.3) * 0.005;

    // Recoil — kicks backward (toward camera, +Z in world) + up-tilt
    if (firing && fireStartedAt.current === null) {
      fireStartedAt.current = t;
    }
    if (fireStartedAt.current !== null) {
      const elapsed = t - fireStartedAt.current;
      if (elapsed < 0.6) {
        const e = Math.max(0, 1 - elapsed / 0.6);
        group.current.position.z += e * 0.25;
        group.current.position.y += e * 0.08;
        group.current.rotation.x -= e * 0.4 * delta * 6;
        if (muzzleFlash.current) muzzleFlash.current.intensity = e * 36;
      } else {
        fireStartedAt.current = null;
        if (muzzleFlash.current) muzzleFlash.current.intensity = 0;
      }
    } else if (muzzleFlash.current) {
      muzzleFlash.current.intensity = 0;
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!held) onPickup();
  };

  return (
    <group
      ref={group}
      position={[1.2, 0.4, -0.2]}
      rotation={[0, -1.8, 0]}
      scale={0.4}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      <primitive object={model} />
      {/* Local fill light to keep the gun lit against the dark void */}
      <pointLight position={[0.3, 0.5, 0.3]} color="#ffd9a0" intensity={4} distance={2.5} decay={2} />
      {/* Muzzle flash — in front of barrel */}
      <pointLight ref={muzzleFlash} position={[0, 0.2, -0.7]} color="#ffaa22" intensity={0} distance={5} decay={2} />
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
      <CameraInit firing={firing} />
      <ambientLight intensity={0.02} color="#100502" />
      <HangingSpot />

      {/* Floor — nearly black, catches the shadow pool */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#050302" roughness={1} metalness={0} />
      </mesh>

      <GLBModel src={MODEL_TABLE} position={[0, -0.5, 0]} scale={0.6} receiveShadow />

      {/* FPS gun — portaled into camera, NOT a child of the scene root */}
      <FPSGun
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
      camera={{ position: [0.0, 0.55, 0.7], fov: 58 }}
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
        pointerEvents: "auto",
        background: "#000000",
        zIndex: 5,
      }}
    >
      <color attach="background" args={["#000000"]} />

      <Suspense fallback={<LoadingText />}>
        <Scene gunHeld={gunHeld} setGunHeld={setGunHeld} target={target} firing={firing} />
      </Suspense>

      <EffectComposer>
        <Pixelation granularity={5} />
        <Bloom intensity={1.1} luminanceThreshold={0.45} luminanceSmoothing={0.4} mipmapBlur />
        <Noise opacity={0.055} />
        <Vignette eskil={false} offset={0.22} darkness={0.95} />
      </EffectComposer>
    </Canvas>
  );
}

useGLTF.preload(MODEL_TABLE);
useGLTF.preload(MODEL_REVOLVER);
useGLTF.preload(MODEL_LANTERN);
useGLTF.preload(MODEL_BULLET);
