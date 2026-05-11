/// <reference types="@react-three/fiber" />
"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  Pixelation,
  Noise,
} from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const MODEL_TABLE = "/models/Small Table.glb";
const MODEL_REVOLVER = "/models/Revolver.glb";
const MODEL_LANTERN = "/models/Lantern.glb";
const MODEL_BULLET = "/models/mermi.glb";

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
    // Random flicker — mostly stable, occasional dim dip
    const flicker =
      0.92 +
      Math.sin(t * 53.7) * 0.05 +
      Math.sin(t * 17.1) * 0.04 +
      (Math.random() < 0.012 ? -0.45 : 0);
    light.current.intensity = Math.max(0.1, baseIntensity * flicker);
    // Subtle sway as if hanging on a cord
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

// ── Camera rig — fixed, slight high-angle creepy tilt ─────────────────────────
function CameraInit() {
  useFrame(({ camera, clock }) => {
    // Almost-static, but breathes a tiny amount so it doesn't look frozen
    const sway = Math.sin(clock.elapsedTime * 0.3) * 0.012;
    camera.position.set(0.15 + sway, 1.05, 1.55);
    camera.lookAt(0, 0.05, -0.1);
  });
  return null;
}

// ── Scene contents ────────────────────────────────────────────────────────────
function Scene({ isYourTurn }: { isYourTurn: boolean }) {
  // Floor catches the spotlight's hard shadow — kept dark so we just see the
  // pool of light, not the whole floor.
  return (
    <>
      <CameraInit />

      {/* The void — barely visible ambient so silhouettes don't disappear */}
      <ambientLight intensity={0.018} color="#100502" />

      <HangingSpot />

      {/* Floor receives shadow but is nearly black — just the lit pool shows */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.5, 0]}
        receiveShadow
      >
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#050302" roughness={1} metalness={0} />
      </mesh>

      {/* Table */}
      <GLBModel
        src={MODEL_TABLE}
        position={[0, -0.5, 0]}
        scale={0.6}
        receiveShadow
      />

      {/* Revolver on the table */}
      <GLBModel
        src={MODEL_REVOLVER}
        position={[0.05, 0.05, -0.05]}
        rotation={[0, 0.6 + (isYourTurn ? 0 : Math.PI), 0]}
        scale={0.18}
      />

      {/* Lantern — hanging above where the spotlight emits */}
      <GLBModel
        src={MODEL_LANTERN}
        position={[0, 2.05, 0]}
        scale={0.35}
        castShadow={false}
      />

      {/* Bullets scattered on the table */}
      <GLBModel src={MODEL_BULLET} position={[-0.32, 0.04, 0.18]} rotation={[Math.PI / 2, 0, 0.3]} scale={0.05} />
      <GLBModel src={MODEL_BULLET} position={[0.38, 0.04, 0.05]} rotation={[Math.PI / 2, 0, -0.7]} scale={0.05} />
      <GLBModel src={MODEL_BULLET} position={[-0.08, 0.04, 0.28]} rotation={[Math.PI / 2, 0, 1.4]} scale={0.05} />
      <GLBModel src={MODEL_BULLET} position={[0.22, 0.04, 0.22]} rotation={[Math.PI / 2, 0, -0.2]} scale={0.05} />
    </>
  );
}

// ── Main canvas ───────────────────────────────────────────────────────────────
export default function DuelArena3D({ isYourTurn }: { isYourTurn: boolean }) {
  return (
    <Canvas
      shadows="basic"
      camera={{ position: [0.15, 1.05, 1.55], fov: 50 }}
      gl={{
        antialias: false, // Pixelation handles aliasing
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.7,
      }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "#000000" }}
    >
      {/* Pure black background */}
      <color attach="background" args={["#000000"]} />

      <Suspense fallback={<LoadingText />}>
        <Scene isYourTurn={isYourTurn} />
      </Suspense>

      <EffectComposer>
        <Pixelation granularity={3} />
        <Bloom
          intensity={0.9}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.4}
          mipmapBlur
        />
        <Noise opacity={0.045} />
        <Vignette eskil={false} offset={0.22} darkness={0.95} />
      </EffectComposer>
    </Canvas>
  );
}

// Preload all GLBs so the Suspense fallback only flashes once
useGLTF.preload(MODEL_TABLE);
useGLTF.preload(MODEL_REVOLVER);
useGLTF.preload(MODEL_LANTERN);
useGLTF.preload(MODEL_BULLET);
