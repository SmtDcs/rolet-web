/// <reference types="@react-three/fiber" />
"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";

// ── Opponent: porcelain mask figure ─────────────────────────────────────────
function OpponentFigure3D({ isYourTurn }: { isYourTurn: boolean }) {
  const group = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    // Idle float
    group.current.position.y = 1.4 + Math.sin(t * 1.1) * 0.12;
    // Subtle sway
    group.current.rotation.z = Math.sin(t * 0.65) * 0.025;
    group.current.rotation.y = Math.sin(t * 0.4) * 0.06;
    // Eye intensity pulse
    if (eyeL.current && eyeR.current) {
      const pulse = 0.7 + Math.sin(t * 2.3) * 0.3;
      (eyeL.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
      (eyeR.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
  });

  return (
    <group ref={group} position={[0, 1.4, -0.5]}>
      {/* Head */}
      <mesh>
        <sphereGeometry args={[0.42, 32, 32]} />
        <meshStandardMaterial
          color="#cfc5b5"
          roughness={0.25}
          metalness={0.08}
          emissive="#1a0808"
          emissiveIntensity={0.15}
        />
      </mesh>

      {/* Crack lines on mask */}
      <mesh rotation={[0, 0, 0.3]}>
        <torusGeometry args={[0.25, 0.004, 4, 20, Math.PI * 0.4]} />
        <meshStandardMaterial color="#3a2018" roughness={1} />
      </mesh>

      {/* Left eye socket */}
      <mesh position={[-0.155, 0.06, 0.38]}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshStandardMaterial color="#080404" />
      </mesh>
      {/* Left eye glow */}
      <mesh ref={eyeL} position={[-0.155, 0.06, 0.42]}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial
          color="#ff2200"
          emissive="#ff2200"
          emissiveIntensity={0.8}
        />
      </mesh>

      {/* Right eye socket */}
      <mesh position={[0.155, 0.06, 0.38]}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshStandardMaterial color="#080404" />
      </mesh>
      {/* Right eye glow */}
      <mesh ref={eyeR} position={[0.155, 0.06, 0.42]}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial
          color="#ff2200"
          emissive="#ff2200"
          emissiveIntensity={0.8}
        />
      </mesh>

      {/* Neck */}
      <mesh position={[0, -0.48, 0]}>
        <cylinderGeometry args={[0.1, 0.14, 0.22, 12]} />
        <meshStandardMaterial color="#1a0e08" roughness={0.9} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, -0.92, 0]}>
        <capsuleGeometry args={[0.28, 0.55, 8, 16]} />
        <meshStandardMaterial color="#150a06" roughness={0.85} metalness={0.1} />
      </mesh>

      {/* Shoulders */}
      <mesh position={[-0.42, -0.72, 0]} rotation={[0, 0, 0.3]}>
        <capsuleGeometry args={[0.1, 0.28, 6, 10]} />
        <meshStandardMaterial color="#1a0e08" roughness={0.85} />
      </mesh>
      <mesh position={[0.42, -0.72, 0]} rotation={[0, 0, -0.3]}>
        <capsuleGeometry args={[0.1, 0.28, 6, 10]} />
        <meshStandardMaterial color="#1a0e08" roughness={0.85} />
      </mesh>

      {/* Opponent point light — follows character */}
      <pointLight color="#8b1010" intensity={isYourTurn ? 0.8 : 2.5} distance={3} />
    </group>
  );
}

// ── Player: darker silhouette from behind ────────────────────────────────────
function PlayerFigure3D({ isYourTurn }: { isYourTurn: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    // Offset phase from opponent
    group.current.position.y = -1.3 + Math.sin(t * 0.95 + 1.8) * 0.1;
    group.current.rotation.z = Math.sin(t * 0.55 + 0.8) * 0.02;
  });

  return (
    <group ref={group} position={[0, -1.3, 1.2]} rotation={[0, Math.PI, 0]}>
      {/* Head — viewed from behind */}
      <mesh>
        <sphereGeometry args={[0.36, 32, 32]} />
        <meshStandardMaterial
          color="#1a0e08"
          roughness={0.6}
          metalness={0.15}
          emissive="#0a0404"
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Neck */}
      <mesh position={[0, -0.42, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.18, 12]} />
        <meshStandardMaterial color="#0f0806" roughness={0.9} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, -0.84, 0]}>
        <capsuleGeometry args={[0.25, 0.5, 8, 16]} />
        <meshStandardMaterial color="#0f0806" roughness={0.9} metalness={0.08} />
      </mesh>

      {/* Shoulders */}
      <mesh position={[-0.38, -0.65, 0]} rotation={[0, 0, 0.25]}>
        <capsuleGeometry args={[0.09, 0.24, 6, 10]} />
        <meshStandardMaterial color="#120a06" roughness={0.9} />
      </mesh>
      <mesh position={[0.38, -0.65, 0]} rotation={[0, 0, -0.25]}>
        <capsuleGeometry args={[0.09, 0.24, 6, 10]} />
        <meshStandardMaterial color="#120a06" roughness={0.9} />
      </mesh>

      <pointLight color="#4a1a08" intensity={isYourTurn ? 2.5 : 0.6} distance={3} />
    </group>
  );
}

// ── Atmospheric dust particles ────────────────────────────────────────────────
function DustParticles() {
  const points = useRef<THREE.Points>(null);
  const count = 180;

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 6;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!points.current) return;
    points.current.rotation.y = clock.elapsedTime * 0.025;
    points.current.rotation.x = Math.sin(clock.elapsedTime * 0.015) * 0.05;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#6b3a20"
        size={0.018}
        sizeAttenuation
        transparent
        opacity={0.55}
      />
    </points>
  );
}

// ── Table surface ─────────────────────────────────────────────────────────────
function Table() {
  return (
    <mesh position={[0, 0.05, 0.3]} rotation={[-0.12, 0, 0]}>
      <boxGeometry args={[2.8, 0.06, 1.6]} />
      <meshStandardMaterial color="#0d0806" roughness={0.95} metalness={0.05} />
    </mesh>
  );
}

// ── Main scene ────────────────────────────────────────────────────────────────
export default function DuelArena3D({ isYourTurn }: { isYourTurn: boolean }) {
  return (
    <Canvas
      camera={{ position: [0, 0.3, 4.8], fov: 52 }}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* Lights */}
      <ambientLight intensity={0.08} />
      <pointLight position={[0, 5, 0]} color="#6b0a0a" intensity={3} distance={12} />
      <pointLight position={[-3, 2, 1]} color="#3a1a0a" intensity={1.8} distance={8} />
      <pointLight position={[3, 2, 1]} color="#200a0a" intensity={1.2} distance={8} />
      <pointLight position={[0, -2, 3]} color="#1a0808" intensity={0.8} distance={6} />

      <fog attach="fog" args={["#040202", 6, 16]} />

      <Stars radius={18} depth={8} count={600} factor={1.2} fade speed={0.4} />
      <DustParticles />
      <Table />
      <OpponentFigure3D isYourTurn={isYourTurn} />
      <PlayerFigure3D isYourTurn={isYourTurn} />
    </Canvas>
  );
}
