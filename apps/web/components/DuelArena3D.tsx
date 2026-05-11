/// <reference types="@react-three/fiber" />
"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  ChromaticAberration,
  Noise,
} from "@react-three/postprocessing";
import { useRef, useMemo } from "react";
import * as THREE from "three";

// ── Camera rig — subtle lean based on turn ────────────────────────────────────
function CameraRig({ isYourTurn }: { isYourTurn: boolean }) {
  useFrame(({ camera }) => {
    const tx = isYourTurn ? 0.18 : -0.18;
    const ty = isYourTurn ? 0.62 : 0.52;
    camera.position.x += (tx - camera.position.x) * 0.025;
    camera.position.y += (ty - camera.position.y) * 0.025;
    camera.lookAt(0, 0.1, -0.8);
  });
  return null;
}

// ── GLTF revolver ─────────────────────────────────────────────────────────────
function Revolver({ spinning }: { spinning: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/revolver_hd.glb");

  // Clone scene so multiple instances don't share state
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    // Darken + metalify all materials for the dim room lighting
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.roughness = Math.max(mat.roughness, 0.35);
            mat.metalness = Math.min(mat.metalness + 0.2, 1.0);
            mat.envMapIntensity = 0.6;
          }
        });
        mesh.castShadow = true;
      }
    });
    return cloned;
  }, [scene]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.y = 0.08 + Math.sin(clock.elapsedTime * 0.7) * 0.006;
    if (spinning) group.current.rotation.y += 0.008;
  });

  return (
    <group ref={group} position={[0.05, 0.08, -0.05]} rotation={[0.1, 0.6, -0.05]} scale={0.22}>
      <primitive object={model} />
    </group>
  );
}
// Preload so it's ready before the scene mounts
useGLTF.preload("/revolver_hd.glb");

// ── Hanging lamp ──────────────────────────────────────────────────────────────
function HangingLamp() {
  const bulb = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!bulb.current) return;
    const flicker = 0.92 + Math.sin(clock.elapsedTime * 47) * 0.04 + Math.sin(clock.elapsedTime * 11) * 0.04;
    (bulb.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 3.5 * flicker;
  });

  return (
    <group position={[0, 2.5, -0.3]}>
      {/* Cord */}
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.75, 5]} />
        <meshStandardMaterial color="#1a1a1a" roughness={1} />
      </mesh>
      {/* Shade outer */}
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.32, 0.3, 14, 1, true]} />
        <meshStandardMaterial
          color="#1a1814"
          roughness={0.5}
          metalness={0.75}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Shade inner (warm bounce) */}
      <mesh rotation={[Math.PI, 0, 0]} position={[0, 0.01, 0]}>
        <coneGeometry args={[0.29, 0.28, 14, 1, true]} />
        <meshStandardMaterial color="#5a2800" emissive="#3a1500" emissiveIntensity={0.5} side={THREE.BackSide} />
      </mesh>
      {/* Bulb */}
      <mesh ref={bulb} position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.052, 10, 10]} />
        <meshStandardMaterial
          color="#ffe8a0"
          emissive="#ffcc44"
          emissiveIntensity={3.5}
          toneMapped={false}
        />
      </mesh>
      {/* Main pool light */}
      <pointLight position={[0, -0.06, 0]} color="#cc7722" intensity={35} distance={7} decay={2} />
      {/* Ambient fill from lamp */}
      <pointLight position={[0, -0.06, 0]} color="#ff8800" intensity={5} distance={12} decay={2} />
    </group>
  );
}

// ── Room environment ──────────────────────────────────────────────────────────
function Room() {
  const floorTex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1a0e07";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#160c05" : "#1e1107";
      ctx.fillRect(0, i * 64, 512, 64);
      ctx.fillStyle = "#0f0904";
      ctx.fillRect(0, i * 64, 512, 2);
    }
    for (let x = 0; x < 512; x += 3) {
      for (let y = 0; y < 512; y += 3) {
        const v = (Math.random() - 0.5) * 0.06;
        ctx.fillStyle = `rgba(0,0,0,${Math.abs(v)})`;
        ctx.fillRect(x, y, 3, 3);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }, []);

  const wallTex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0f0905";
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      const offset = (Math.floor(y / 16) % 2) * 32;
      for (let x = -32; x < 256; x += 64) {
        ctx.fillStyle = "#0b0703";
        ctx.fillRect(x + offset, y, 60, 14);
        ctx.fillStyle = "#08060280";
        ctx.fillRect(x + offset, y + 14, 60, 2);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }, []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial map={floorTex ?? undefined} color="#180e06" roughness={0.97} metalness={0} />
      </mesh>
      {/* Back wall */}
      <mesh position={[0, 1.6, -3.4]}>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial map={wallTex ?? undefined} color="#0e0905" roughness={1} />
      </mesh>
      {/* Left wall */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-3.8, 1.6, 0]}>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial map={wallTex ?? undefined} color="#0c0803" roughness={1} />
      </mesh>
      {/* Right wall */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[3.8, 1.6, 0]}>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial map={wallTex ?? undefined} color="#0c0803" roughness={1} />
      </mesh>
      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 2.8, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#080604" roughness={1} />
      </mesh>
    </>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
function Table() {
  const mat = { color: "#1c0e06", roughness: 0.92, metalness: 0.02 };
  const legMat = { color: "#160b04", roughness: 0.96 };
  return (
    <group>
      <mesh position={[0, -0.02, -0.2]}>
        <boxGeometry args={[2.4, 0.055, 1.7]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Edge trim */}
      <mesh position={[0, -0.002, -0.2]}>
        <boxGeometry args={[2.42, 0.01, 1.72]} />
        <meshStandardMaterial color="#100804" roughness={0.9} metalness={0.08} />
      </mesh>
      {[[-1.05, -0.85], [1.05, -0.85], [-1.05, 0.45], [1.05, 0.45]].map(
        ([x, z], i) => (
          <mesh key={i} position={[x, -0.52, z]}>
            <boxGeometry args={[0.065, 0.97, 0.065]} />
            <meshStandardMaterial {...legMat} />
          </mesh>
        )
      )}
    </group>
  );
}

// ── Opponent figure ───────────────────────────────────────────────────────────
function OpponentFigure({ isYourTurn }: { isYourTurn: boolean }) {
  const group = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.position.y = 0.7 + Math.sin(t * 0.85) * 0.055;
    group.current.rotation.z = Math.sin(t * 0.48) * 0.016;
    if (eyeL.current && eyeR.current) {
      const p = 0.55 + Math.sin(t * 2.6) * 0.45;
      (eyeL.current.material as THREE.MeshStandardMaterial).emissiveIntensity = p;
      (eyeR.current.material as THREE.MeshStandardMaterial).emissiveIntensity = p;
    }
  });

  return (
    <group ref={group} position={[0, 0.7, -1.45]}>
      {/* Head — porcelain mask look */}
      <mesh>
        <sphereGeometry args={[0.28, 24, 24]} />
        <meshStandardMaterial
          color="#c0b09a"
          roughness={0.28}
          metalness={0.06}
          emissive="#150505"
          emissiveIntensity={0.2}
        />
      </mesh>
      {/* Crack */}
      <mesh rotation={[0, 0, 0.35]} position={[0.05, 0, 0.25]}>
        <torusGeometry args={[0.18, 0.003, 4, 18, Math.PI * 0.5]} />
        <meshStandardMaterial color="#2a1008" roughness={1} />
      </mesh>
      {/* Left eye socket */}
      <mesh position={[-0.092, 0.035, 0.255]}>
        <sphereGeometry args={[0.042, 10, 10]} />
        <meshStandardMaterial color="#050102" />
      </mesh>
      <mesh ref={eyeL} position={[-0.092, 0.035, 0.276]}>
        <sphereGeometry args={[0.016, 8, 8]} />
        <meshStandardMaterial
          color="#ff1000"
          emissive="#ff1000"
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>
      {/* Right eye socket */}
      <mesh position={[0.092, 0.035, 0.255]}>
        <sphereGeometry args={[0.042, 10, 10]} />
        <meshStandardMaterial color="#050102" />
      </mesh>
      <mesh ref={eyeR} position={[0.092, 0.035, 0.276]}>
        <sphereGeometry args={[0.016, 8, 8]} />
        <meshStandardMaterial
          color="#ff1000"
          emissive="#ff1000"
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>
      {/* Neck */}
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[0.065, 0.085, 0.14, 10]} />
        <meshStandardMaterial color="#100806" roughness={0.9} />
      </mesh>
      {/* Torso */}
      <mesh position={[0, -0.72, 0]}>
        <boxGeometry args={[0.52, 0.65, 0.28]} />
        <meshStandardMaterial color="#0c0705" roughness={0.9} metalness={0.06} />
      </mesh>
      {/* Shoulders */}
      {[-0.32, 0.32].map((x, i) => (
        <mesh key={i} position={[x, -0.6, 0]} rotation={[0, 0, x > 0 ? -0.28 : 0.28]}>
          <capsuleGeometry args={[0.09, 0.22, 5, 8]} />
          <meshStandardMaterial color="#0e0806" roughness={0.9} />
        </mesh>
      ))}
      <pointLight
        color="#9a0808"
        intensity={isYourTurn ? 0.8 : 2.8}
        distance={2.5}
        decay={2}
      />
    </group>
  );
}

// ── Bullet casings ────────────────────────────────────────────────────────────
function BulletCasings() {
  const casings: [number, number, number, number, number][] = [
    [-0.3, 0.03, 0.12, 0.3, 1.1],
    [0.42, 0.03, -0.08, -0.2, 0.8],
    [-0.05, 0.03, 0.28, 0.9, 0.5],
    [0.22, 0.03, 0.18, -0.4, 1.6],
  ];
  return (
    <>
      {casings.map(([x, y, z, ry, rz], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, ry, rz]}>
          <cylinderGeometry args={[0.011, 0.009, 0.05, 8]} />
          <meshStandardMaterial color="#b07818" roughness={0.28} metalness={0.92} />
        </mesh>
      ))}
    </>
  );
}

// ── Dust motes ────────────────────────────────────────────────────────────────
function DustMotes() {
  const pts = useRef<THREE.Points>(null);
  const count = 140;
  const pos = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 5.5;
      arr[i * 3 + 1] = Math.random() * 3.2 - 0.4;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!pts.current) return;
    pts.current.rotation.y = clock.elapsedTime * 0.012;
    pts.current.position.y = Math.sin(clock.elapsedTime * 0.08) * 0.04;
  });

  return (
    <points ref={pts}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#8a5228"
        size={0.013}
        sizeAttenuation
        transparent
        opacity={0.38}
      />
    </points>
  );
}

// ── ChromaticAberration offset (stable ref) ───────────────────────────────────
const CA_OFFSET = new THREE.Vector2(0.0009, 0.0009);

// ── Main export ───────────────────────────────────────────────────────────────
export default function DuelArena3D({ isYourTurn }: { isYourTurn: boolean }) {
  return (
    <Canvas
      camera={{ position: [0.18, 0.62, 2.05], fov: 66 }}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.75,
      }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <fog attach="fog" args={["#060301", 5, 16]} />
      <ambientLight intensity={0.03} color="#1a0800" />

      <CameraRig isYourTurn={isYourTurn} />
      <Room />
      <HangingLamp />
      <Table />
      <Revolver spinning={!isYourTurn} />
      <BulletCasings />
      <DustMotes />
      <OpponentFigure isYourTurn={isYourTurn} />

      <EffectComposer>
        <Bloom
          intensity={1.1}
          luminanceThreshold={0.55}
          luminanceSmoothing={0.5}
          mipmapBlur
        />
        <ChromaticAberration offset={CA_OFFSET} />
        <Noise opacity={0.038} />
        <Vignette eskil={false} offset={0.28} darkness={0.92} />
      </EffectComposer>
    </Canvas>
  );
}
