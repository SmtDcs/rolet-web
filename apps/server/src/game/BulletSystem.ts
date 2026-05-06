import type { BulletType, GunState } from '@rolet/shared';

export function createGun(liveCount: number, blankCount: number): GunState {
  const bullets: BulletType[] = [
    ...Array(liveCount).fill('live'),
    ...Array(blankCount).fill('blank'),
  ];
  return {
    bullets: shuffle(bullets),
    currentIndex: 0,
    damageMultiplier: 1,
  };
}

export function fireGun(gun: GunState): { type: BulletType; gun: GunState } {
  const type = gun.bullets[gun.currentIndex];
  const newGun: GunState = {
    ...gun,
    currentIndex: gun.currentIndex + 1,
    damageMultiplier: 1,
  };
  return { type, gun: newGun };
}

export function isGunEmpty(gun: GunState): boolean {
  return gun.currentIndex >= gun.bullets.length;
}

export function ejectCurrentBullet(gun: GunState): GunState {
  const bullets = [...gun.bullets];
  bullets.splice(gun.currentIndex, 1);
  return { ...gun, bullets };
}

export function shuffleRemaining(gun: GunState): GunState {
  const before = gun.bullets.slice(0, gun.currentIndex);
  const remaining = gun.bullets.slice(gun.currentIndex);
  return { ...gun, bullets: [...before, ...shuffle(remaining)] };
}

export function addBulletAtEnd(gun: GunState, type: BulletType): GunState {
  return { ...gun, bullets: [...gun.bullets, type] };
}

export function moveLastBullet(gun: GunState): GunState {
  const bullets = [...gun.bullets];
  const remaining = bullets.slice(gun.currentIndex);
  if (remaining.length < 2) return gun;
  const last = remaining.pop()!;
  const insertAt = gun.currentIndex + Math.floor(Math.random() * remaining.length);
  remaining.splice(insertAt, 0, last);
  return { ...gun, bullets: [...bullets.slice(0, gun.currentIndex), ...remaining] };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
