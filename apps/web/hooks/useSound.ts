"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SoundKey =
  | "triggerCock"
  | "gunshotLive"
  | "clickBlank"
  | "playerHit"
  | "cardPlay"
  | "uiSelect"
  | "matchWin"
  | "matchLose";

const SOUND_SRCS: Record<SoundKey, string> = {
  triggerCock: "/sounds/triggerCock.ogg",
  gunshotLive: "/sounds/gunshotLive.ogg",
  clickBlank: "/sounds/clickBlank.ogg",
  playerHit: "/sounds/playerHit.ogg",
  cardPlay: "/sounds/cardPlay.ogg",
  uiSelect: "/sounds/uiSelect.ogg",
  matchWin: "/sounds/matchWin.ogg",
  matchLose: "/sounds/matchLose.ogg",
};

const MUTE_KEY = "rolet:muted";

// Pre-created audio elements, cached across renders
const audioCache: Partial<Record<SoundKey, HTMLAudioElement>> = {};

function getAudio(key: SoundKey): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audioCache[key]) {
    const el = new Audio(SOUND_SRCS[key]);
    el.preload = "auto";
    audioCache[key] = el;
  }
  return audioCache[key]!;
}

export function useSound(): {
  play: (key: SoundKey, opts?: { volume?: number }) => void;
  muted: boolean;
  toggleMute: () => void;
} {
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(MUTE_KEY) === "true";
  });

  // Keep ref in sync so play() closure always reads current value
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Pre-load all audio on mount
  useEffect(() => {
    (Object.keys(SOUND_SRCS) as SoundKey[]).forEach(getAudio);
  }, []);

  const play = useCallback((key: SoundKey, opts?: { volume?: number }) => {
    if (mutedRef.current) return;
    const el = getAudio(key);
    if (!el) return;
    el.currentTime = 0;
    el.volume = opts?.volume ?? 0.6;
    el.play().catch(() => {
      // Autoplay blocked — silently ignore
    });
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTE_KEY, String(next));
      return next;
    });
  }, []);

  return { play, muted, toggleMute };
}
