/// <reference types="@react-three/fiber" />
"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RoletCard } from "@/hooks/useRolet";

// ── Playing-card mapping (suit + rank for each ROLET card) ──────────────────
const CARD_GLYPH: Record<RoletCard, string> = {
  restoreBullet: "▲",
  hawkEye: "◉",
  silence: "✕",
  blocker: "▣",
  bulletExtractor: "↧",
  shuffler: "↻",
  doubleStrike: "✦",
  healer: "+",
  cardThief: "⌖",
  randomInsight: "?",
  lastChance: "!",
  handOfFate: "✧",
};

const CARD_LABEL: Record<RoletCard, string> = {
  restoreBullet: "RestoreBullet",
  hawkEye: "HawkEye",
  silence: "Silence",
  blocker: "Blocker",
  bulletExtractor: "BulletExtractor",
  shuffler: "Shuffler",
  doubleStrike: "DoubleStrike",
  healer: "Healer",
  cardThief: "CardThief",
  randomInsight: "RandomInsight",
  lastChance: "LastChance",
  handOfFate: "HandOfFate",
};

const CARD_RANK: Record<RoletCard, string> = {
  hawkEye: "A",
  doubleStrike: "K",
  bulletExtractor: "Q",
  cardThief: "J",
  silence: "10",
  shuffler: "9",
  blocker: "8",
  healer: "7",
  lastChance: "6",
  restoreBullet: "5",
  randomInsight: "4",
  handOfFate: "3",
};

const CARD_SUIT: Record<RoletCard, "♠" | "♥" | "♣" | "♦"> = {
  hawkEye: "♠",
  doubleStrike: "♠",
  bulletExtractor: "♠",
  cardThief: "♠",
  silence: "♣",
  blocker: "♥",
  healer: "♥",
  shuffler: "♣",
  lastChance: "♥",
  restoreBullet: "♦",
  randomInsight: "♣",
  handOfFate: "♦",
};

const isRed = (suit: string) => suit === "♥" || suit === "♦";

// ── Canvas-texture factory: card front (rank + suit + glyph + name) ─────────
function makeFrontTexture(card: RoletCard): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext("2d")!;

  const rank = CARD_RANK[card];
  const suit = CARD_SUIT[card];
  const suitColor = isRed(suit) ? "#cc1818" : "#1a0e08";

  // Background — aged ivory
  ctx.fillStyle = "#ede0c4";
  ctx.fillRect(0, 0, 256, 358);
  const grad = ctx.createLinearGradient(0, 0, 0, 358);
  grad.addColorStop(0, "#f0e0c0");
  grad.addColorStop(1, "#d8c5a0");
  ctx.fillStyle = grad;
  ctx.fillRect(10, 10, 236, 338);

  // Border
  ctx.strokeStyle = "#3a2418";
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 346);

  // Top-left corner: rank + suit
  ctx.fillStyle = suitColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 42px monospace";
  ctx.fillText(rank, 18, 18);
  ctx.font = "bold 34px monospace";
  ctx.fillText(suit, 18, 64);

  // Center glyph
  ctx.font = "bold 115px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#8b3a1a";
  ctx.fillText(CARD_GLYPH[card], 128, 170);

  // Card label (name)
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#3a2418";
  ctx.fillText(CARD_LABEL[card].toUpperCase(), 128, 268);

  // Subtle "ROLET" wordmark below label
  ctx.font = "9px monospace";
  ctx.fillStyle = "#6b4a30";
  ctx.fillText("/ ROLET /", 128, 290);

  // Bottom-right corner (rotated 180°)
  ctx.save();
  ctx.translate(238, 340);
  ctx.rotate(Math.PI);
  ctx.fillStyle = suitColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 42px monospace";
  ctx.fillText(rank, 0, 0);
  ctx.font = "bold 34px monospace";
  ctx.fillText(suit, 0, 46);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// ── Card back — dark-red diamond pattern + ROLET brand ─────────────────────
function makeBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#3a0808";
  ctx.fillRect(0, 0, 256, 358);
  ctx.fillStyle = "#280505";
  ctx.fillRect(12, 12, 232, 334);

  // Diamond pattern
  ctx.fillStyle = "#1a0303";
  const cellW = 18;
  const cellH = 24;
  for (let y = 30; y < 340; y += cellH) {
    for (let x = 28; x < 232; x += cellW) {
      const offset = (Math.floor((y - 30) / cellH) % 2) * (cellW / 2);
      const cx = x + offset;
      ctx.beginPath();
      ctx.moveTo(cx, y - cellH / 4);
      ctx.lineTo(cx + cellW / 3, y);
      ctx.lineTo(cx, y + cellH / 4);
      ctx.lineTo(cx - cellW / 3, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Central brand box
  const boxW = 140;
  const boxH = 60;
  const bx = (256 - boxW) / 2;
  const by = (358 - boxH) / 2;
  ctx.fillStyle = "#1a0000";
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = "#cc4422";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.fillStyle = "#dd5533";
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ROLET", 128, 174);

  ctx.font = "bold 10px monospace";
  ctx.fillStyle = "#cc4422";
  ctx.fillText("─[X]─", 128, 200);

  // Border
  ctx.strokeStyle = "#5a1010";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, 240, 342);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// ── Single 3D card mesh ─────────────────────────────────────────────────────
function Card3D({
  card,
  slotIndex,
  totalSlots,
  selected,
  disabled,
  onSelect,
}: {
  card: RoletCard | null;
  slotIndex: number;
  totalSlots: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const frontMat = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const frontTex = useMemo(() => (card ? makeFrontTexture(card) : null), [card]);
  const backTex = useMemo(() => makeBackTexture(), []);

  // Fan base — tighter spacing so cards overlap more (Buckshot-style hand)
  const offset = slotIndex - (totalSlots - 1) / 2;
  const baseX = offset * 0.42;
  const baseY = -Math.abs(offset) * 0.045;
  const baseZ = -Math.abs(offset) * 0.02; // edge cards slightly behind
  const baseRotZ = -offset * 0.1;

  useFrame((_, delta) => {
    if (!ref.current) return;
    const lerp = Math.min(1, delta * 8);
    // Bigger lift on hover/selected — more dramatic FPS card feel
    const lift = selected ? 0.55 : hovered && !disabled ? 0.32 : 0;
    const tiltX = selected ? -0.32 : hovered && !disabled ? -0.2 : 0;
    // Selected card pops forward in Z too so it doesn't get covered
    const liftZ = selected ? 0.35 : hovered && !disabled ? 0.2 : 0;
    const flipY = disabled ? Math.PI : 0;

    ref.current.position.x += (baseX - ref.current.position.x) * lerp;
    ref.current.position.y += ((baseY + lift) - ref.current.position.y) * lerp;
    ref.current.position.z += ((baseZ + liftZ) - ref.current.position.z) * lerp;
    ref.current.rotation.x += (tiltX - ref.current.rotation.x) * lerp;
    ref.current.rotation.y += (flipY - ref.current.rotation.y) * lerp;
    ref.current.rotation.z += (baseRotZ - ref.current.rotation.z) * lerp;

    // Strong selected glow pulse
    if (frontMat.current) {
      const target = selected
        ? 0.85 + Math.sin(performance.now() / 180) * 0.25
        : hovered && !disabled
        ? 0.35
        : 0.0;
      frontMat.current.emissiveIntensity += (target - frontMat.current.emissiveIntensity) * lerp;
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!card || disabled) return;
    onSelect();
  };

  return (
    <group
      ref={ref}
      position={[baseX, baseY, 0]}
      rotation={[0, 0, baseRotZ]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!card || disabled) return;
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
    >
      {/* Front face — bigger, slightly translucent */}
      <mesh>
        <planeGeometry args={[0.95, 1.34]} />
        <meshStandardMaterial
          ref={frontMat}
          map={frontTex ?? undefined}
          color={card ? "#ffffff" : "#3a2418"}
          side={THREE.FrontSide}
          emissive="#cc1818"
          emissiveIntensity={0}
          transparent
          opacity={card ? 0.78 : 0.4}
        />
      </mesh>
      {/* Back face */}
      <mesh rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.95, 1.34]} />
        <meshStandardMaterial
          map={backTex}
          side={THREE.FrontSide}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
}

// ── Main exported component ─────────────────────────────────────────────────
export default function HandRack3D({
  hand,
  selectedSlot,
  onSelect,
  disabled,
}: {
  hand: (RoletCard | null)[];
  selectedSlot: number | null;
  onSelect: (i: number | null) => void;
  disabled: boolean;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.15, 2.05], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%", pointerEvents: "auto" }}
    >
      <ambientLight intensity={0.6} color="#fff5d4" />
      <pointLight position={[0, 1.2, 2]} intensity={1.8} color="#ffd8a0" />
      <pointLight position={[-1.5, 0.4, 1]} intensity={0.6} color="#ff9966" />
      <pointLight position={[1.5, 0.4, 1]} intensity={0.6} color="#ff9966" />

      {hand.slice(0, 4).map((card, i) => (
        <Card3D
          key={i}
          card={card}
          slotIndex={i}
          totalSlots={4}
          selected={selectedSlot === i}
          disabled={disabled || !card}
          onSelect={() => onSelect(i === selectedSlot ? null : i)}
        />
      ))}
    </Canvas>
  );
}
