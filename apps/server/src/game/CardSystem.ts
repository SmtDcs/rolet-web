import type { Card, CardId } from '@rolet/shared';

export const CARD_DEFINITIONS: Record<CardId, Card> = {
  geri_ekleme: {
    id: 'geri_ekleme',
    name: 'Geri Ekleme',
    description: 'Rakibin çıkardığı mermiyi silaha geri ekler.',
  },
  keskin_bakis: {
    id: 'keskin_bakis',
    name: 'Keskin Bakış',
    description: 'Silahın içindeki sıradaki merminin dolu mu boş mu olduğunu gösterir.',
  },
  sessizlik: {
    id: 'sessizlik',
    name: 'Sessizlik',
    description: 'Rakibin kart kullanımını 1 tur boyunca yasaklar.',
  },
  durdurucu: {
    id: 'durdurucu',
    name: 'Durdurucu',
    description: 'Rakip oyuncuyu 1 tur boyunca engeller.',
  },
  mermi_cikarici: {
    id: 'mermi_cikarici',
    name: 'Mermi Çıkarıcı',
    description: 'Silahın namlusundaki mermiyi çıkarır.',
  },
  karistirici: {
    id: 'karistirici',
    name: 'Karıştırıcı',
    description: 'Silahın içindeki mermileri rastgele yeniden yerleştirir.',
  },
  cifte_darbe: {
    id: 'cifte_darbe',
    name: 'Çifte Darbe',
    description: 'Silah 1 tur boyunca 2 kat hasar verir.',
  },
  can_yenileyici: {
    id: 'can_yenileyici',
    name: 'Can Yenileyici',
    description: "Oyuncunun 1 canını yeniler.",
  },
  kart_hirsizi: {
    id: 'kart_hirsizi',
    name: 'Kart Hırsızı',
    description: "Rakibin elindeki kartlardan birini çalar.",
  },
  rastgele_bilgi: {
    id: 'rastgele_bilgi',
    name: 'Rastgele Bilgi',
    description: 'Rastgele seçilen bir merminin dolu veya boş olduğunu öğrenir.',
  },
  son_sans: {
    id: 'son_sans',
    name: 'Son Şans',
    description: 'Silahın içindeki son merminin yerini değiştirir.',
  },
  kaderin_eli: {
    id: 'kaderin_eli',
    name: 'Kaderin Eli',
    description: '3 olasılıktan birini tetikler: can kazan veya kaybet.',
  },
};

export function getRandomCards(count: number): Card[] {
  const allIds = Object.keys(CARD_DEFINITIONS) as CardId[];
  const shuffled = [...allIds].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((id) => CARD_DEFINITIONS[id]);
}

export function dealHands(): { hand1: Card[]; hand2: Card[] } {
  const selected = getRandomCards(8);
  return {
    hand1: selected.slice(0, 4),
    hand2: selected.slice(4, 8),
  };
}

export function kaderinEliEffect(): { hpDelta: number; description: string } {
  const r = Math.random();
  if (r < 0.20) {
    // %20: tam can yenilenir veya %80 -1 can
    return Math.random() < 0.20
      ? { hpDelta: 999, description: 'Tam can yenilendi!' }
      : { hpDelta: -1, description: 'Kader sana karşı: -1 can.' };
  } else if (r < 0.60) {
    // %40: +2 can veya %60 -1 can
    return Math.random() < 0.40
      ? { hpDelta: 2, description: '+2 can kazandın!' }
      : { hpDelta: -1, description: 'Kader sana karşı: -1 can.' };
  } else {
    // %50: +1 can veya %50 -1 can
    return Math.random() < 0.50
      ? { hpDelta: 1, description: '+1 can kazandın!' }
      : { hpDelta: -1, description: 'Kader sana karşı: -1 can.' };
  }
}
