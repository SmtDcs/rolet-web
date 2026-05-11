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

// ── Flickering spotlight (wider cone so the table edges aren't pitch black) ──
function HangingSpot() {
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(new THREE.Object3D());
  const baseIntensity = 55;

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
        position={[0, 1.4, 0]}
        target={target.current}
        angle={0.85}
        penumbra={0.35}
        intensity={baseIntensity}
        distance={6}
        decay={1.4}
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

// ── Swinging lantern — hangs above the table, gentle pendulum motion ─────────
function SwingingLantern() {
  const ref = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_LANTERN);
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).castShadow = false;
      }
    });
    return cloned;
  }, [scene]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    // Pivot at the top of the lantern → swings like a pendulum
    ref.current.rotation.z = Math.sin(t * 0.7) * 0.09;
    ref.current.rotation.x = Math.cos(t * 0.5) * 0.04;
  });

  return (
    // Pivot point is where the cord attaches; lantern body hangs BELOW (-Y)
    <group ref={ref} position={[0, 1.5, 0]}>
      {/* Cord going up off-screen */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.8, 6]} />
        <meshStandardMaterial color="#0a0604" roughness={1} />
      </mesh>
      {/* Lantern body — offset down from pivot so it swings naturally */}
      <group position={[0, -0.3, 0]}>
        <primitive object={model} scale={0.4} />
      </group>
    </group>
  );
}

// ── Camera — pulled in a bit closer to see table details + bullets ──────────
function CameraInit({ firing }: { firing: boolean }) {
  useFrame(({ camera, clock }, delta) => {
    const lerp = Math.min(1, delta * 3);
    const sway = Math.sin(clock.elapsedTime * 0.4) * 0.006;
    camera.position.x += (0.0 + sway - camera.position.x) * lerp;
    camera.position.y += (1.2 - camera.position.y) * lerp;
    camera.position.z += (1.5 - camera.position.z) * lerp;
    camera.lookAt(0, 0, 0);

    if ("fov" in camera) {
      const persp = camera as THREE.PerspectiveCamera;
      const targetFov = firing ? 62 : 55;
      persp.fov += (targetFov - persp.fov) * lerp;
      persp.updateProjectionMatrix();
    }
  });
  return null;
}

// ── World-space gun — centered geometry, live/blank-aware effects ───────────
export type FireKind = "live" | "blank" | null;

function FPSGun({
  held,
  target,
  firing,
  onPickup,
}: {
  held: boolean;
  target: GunTarget;
  firing: FireKind;
  onPickup: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const muzzleFlash = useRef<THREE.PointLight>(null);
  const { scene } = useGLTF(MODEL_REVOLVER);

  // Center the geometry AND rotate it 90° on Y so the barrel aligns with
  // the gun group's local -Z axis. After this, the outer group's rotation
  // becomes intuitive: [0,0,0] → barrel forward (into scene), [0,π,0] →
  // barrel toward camera.
  const model = useMemo(() => {
    const cloned = scene.clone(true);

    // 1) Rotate the model so the barrel ends up along the group's -Z axis.
    //    Quaternius revolver's barrel is along its local +X by default.
    //    +π/2 Y rotation maps +X → -Z (forward, into the scene).
    cloned.rotation.y = Math.PI / 2;

    // 2) Compute bbox AFTER the rotation, recenter to parent origin.
    const box = new THREE.Box3().setFromObject(cloned);
    const center = box.getCenter(new THREE.Vector3());
    cloned.position.sub(center);

    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
      }
    });
    return cloned;
  }, [scene]);

  // After the inner rotation, barrel direction in OUTER local space is -Z.
  // Opponent: outer rotation [0, 0, 0] — barrel world -Z, away from camera.
  // Self:     outer rotation [0, π, 0] — barrel world +Z, toward camera.
  const BASE_EUL_OPP = useMemo(() => new THREE.Euler(0, 0, 0), []);
  const BASE_EUL_SELF = useMemo(() => new THREE.Euler(0, Math.PI, 0), []);

  // Position targets — sitting on the table top (lower y after the scale cut).
  const BASE_POS_OPP = useMemo(() => new THREE.Vector3(0.15, 0.15, 0.6), []);
  const BASE_POS_SELF = useMemo(() => new THREE.Vector3(0.15, 0.15, 0.6), []);

  const fireStartedAt = useRef<number | null>(null);
  const fireKindAtStart = useRef<FireKind>(null);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    const lerp = Math.min(1, delta * 6);

    const tgtEul = target === "self" ? BASE_EUL_SELF : BASE_EUL_OPP;
    const tgtPos = target === "self" ? BASE_POS_SELF : BASE_POS_OPP;

    group.current.position.lerp(tgtPos, lerp);
    group.current.rotation.x += (tgtEul.x - group.current.rotation.x) * lerp;
    group.current.rotation.y += (tgtEul.y - group.current.rotation.y) * lerp;
    group.current.rotation.z += (tgtEul.z - group.current.rotation.z) * lerp;

    // Subtle aim sway when held
    if (held) {
      group.current.position.x += Math.sin(t * 1.3) * 0.003;
      group.current.position.y += Math.cos(t * 1.7) * 0.003;
    }

    // Fire — different intensity for live vs blank
    if (firing && fireStartedAt.current === null) {
      fireStartedAt.current = t;
      fireKindAtStart.current = firing;
    }
    if (fireStartedAt.current !== null) {
      const elapsed = t - fireStartedAt.current;
      const kind = fireKindAtStart.current;
      const duration = kind === "live" ? 0.6 : 0.25;
      if (elapsed < duration) {
        const e = Math.max(0, 1 - elapsed / duration);
        if (kind === "live") {
          // Full recoil + flash
          group.current.position.z += e * 0.22;
          group.current.position.y += e * 0.06;
          group.current.rotation.x -= e * 0.35 * delta * 6;
          if (muzzleFlash.current) muzzleFlash.current.intensity = e * 36;
        } else {
          // Blank — gentle mechanical click, no flash
          group.current.position.z += e * 0.04;
          if (muzzleFlash.current) muzzleFlash.current.intensity = 0;
        }
      } else {
        fireStartedAt.current = null;
        fireKindAtStart.current = null;
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
      position={[0.15, 0.15, 0.6]}
      rotation={[0, 0, 0]}
      scale={[0.25, 0.25, 0.25]}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      <primitive object={model} />
      {/* Local fill light — keeps gun lit against the dark void */}
      <pointLight position={[0.3, 0.5, 0.3]} color="#ffd9a0" intensity={4} distance={2} decay={2} />
      {/* Muzzle flash — placed at barrel tip (outer local -Z = barrel direction) */}
      <pointLight ref={muzzleFlash} position={[0, 0.1, -0.65]} color="#ffaa22" intensity={0} distance={6} decay={2} />
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
  firing: FireKind;
}) {
  return (
    <>
      <CameraInit firing={firing === "live"} />
      {/* A touch more ambient so table details + bullets read clearly */}
      <ambientLight intensity={0.08} color="#2a1408" />
      {/* Soft fill over the table so bullets aren't lost in shadow */}
      <pointLight position={[0, 1.2, 0.4]} color="#ffba70" intensity={3} distance={2.5} decay={2} />
      <HangingSpot />

      {/* Floor — nearly black, catches the shadow pool */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#050302" roughness={1} metalness={0} />
      </mesh>

      <GLBModel src={MODEL_TABLE} position={[0, -0.5, 0]} scale={0.78} receiveShadow />

      <FPSGun
        held={gunHeld}
        target={target}
        firing={firing}
        onPickup={() => setGunHeld(true)}
      />

      {/* Hanging lantern — swings gently, visible above the table */}
      <SwingingLantern />

      {/* Bullets scattered on the table — larger so they read at distance */}
      <GLBModel src={MODEL_BULLET} position={[-0.45, 0.08, 0.2]} rotation={[Math.PI / 2, 0, 0.3]} scale={0.1} />
      <GLBModel src={MODEL_BULLET} position={[0.55, 0.08, 0.1]} rotation={[Math.PI / 2, 0, -0.7]} scale={0.1} />
      <GLBModel src={MODEL_BULLET} position={[-0.18, 0.08, 0.4]} rotation={[Math.PI / 2, 0, 1.4]} scale={0.1} />
      <GLBModel src={MODEL_BULLET} position={[0.35, 0.08, 0.35]} rotation={[Math.PI / 2, 0, -0.2]} scale={0.1} />
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
  firing: FireKind;
}) {
  // Reference isYourTurn so it's not "unused" — could drive scene mood later
  void isYourTurn;
  return (
    <Canvas
      shadows="basic"
      camera={{ position: [0.0, 1.2, 1.5], fov: 55 }}
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
