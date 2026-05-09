# ROLET — Antigravity Handoff Document

> **Bu dosya AI asistan (Antigravity) için bağlam aktarım belgesidir.**
> Yeni bir oturumda "HANDOFF.md'yi oku" demeniz yeterlidir.

---

## 🎯 Proje Nedir?

ROLET, Solana blockchain üzerinde tamamen on-chain çalışan bir PvP Rus Ruleti oyunudur.
**Colosseum Frontier Hackathon** (deadline: ~12 Mayıs 2026) için geliştirilmektedir.

- **Live URL:** https://rolet-web-server.vercel.app
- **GitHub:** https://github.com/SmtDcs/rolet-web
- **Solana Program ID:** `2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7` (devnet)
- **Stack:** Next.js 16 + Anchor (Rust) + Solana Web3.js + pnpm monorepo

---

## 🏗️ Proje Yapısı

```
rolet-web/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   │   ├── page.tsx        # Landing page
│   │   │   ├── profile/        # Profil oluşturma / görüntüleme
│   │   │   ├── duel/           # Ana oyun sayfası (matchmaking + gameplay)
│   │   │   ├── leaderboard/    # Sıralama tablosu (YENİ EKLENDİ)
│   │   │   ├── api/rpc/        # RPC proxy (RPC Fast CORS çözümü)
│   │   │   └── layout.tsx      # Root layout + SolanaProvider
│   │   ├── hooks/
│   │   │   └── useRolet.ts     # Ana hook — tüm on-chain etkileşimler
│   │   ├── components/
│   │   │   └── SolanaProvider.tsx
│   │   ├── idl/                # Anchor IDL (rolet.json + rolet_types.ts)
│   │   └── .env.local          # Ortam değişkenleri (gitignore'd)
│   └── server/                 # Anchor programı (Rust smart contract)
│       └── programs/rolet/src/lib.rs
└── packages/shared/            # Paylaşılan tipler
```

---

## 🎮 Oyun Mekaniği

- 8 hazne: 5 dolu + 3 boş mermi
- Her tur: Kart oyna VEYA tetiği çek
- HP 0 olan kaybeder, kazanan on-chain vault'tan token alır
- 12 taktiksel kart: HawkEye, BulletExtractor, Shuffler, Silence, Blocker, DoubleStrike, Healer, CardThief, RandomInsight, LastChance, HandOfFate, RestoreBullet

---

## 🏆 Hackathon Track'leri

### ✅ Aktif Track'ler
1. **SNS Identity (Bonfida) — $5,000 USDC**
   - Profil oluşturmada `.sol` domain doğrulaması yapılıyor (opsiyonel — domain yoksa da kayıt olunabiliyor)
   - Dosya: `app/profile/page.tsx` satır 48-62

2. **100xDevs Open Track — $10,000 USDC**
   - Tam on-chain oyun, Session Keys, Auto-Matchmaking, taktiksel kartlar
   - Tüm proje bunu destekliyor

### ⏳ Bekleyen Track
3. **RPC Fast — $10,000 Kredi**
   - Beam ürünü Devnet'te 401 veriyor, şu an public devnet RPC kullanılıyor
   - Google Form dolduruldu (hackathon planı bekleniyor): https://forms.gle/qj2QcQ9PQdqBp4fu9
   - Proxy mimarisi hazır: `app/api/rpc/route.ts`
   - Endpoint geldiğinde sadece `.env.local`'daki `NEXT_PUBLIC_RPC_ENDPOINT` ve Vercel env var güncellenir

---

## ✅ Tamamlanan İşler (Bu Oturumda)

1. **Global Auto-Matchmaking** — `useRolet.ts` içinde `findOpenLobby()` fonksiyonu. On-chain LobbyState PDA'larını tarayıp boş lobi buluyor.
2. **RPC Fast Proxy** — `app/api/rpc/route.ts` — CORS bypass için Next.js API route.
3. **SSR Build Fix** — `SolanaProvider.tsx`'te relative URL SSR'da patlamıyordu, devnet'e fallback eklendi.
4. **TypeScript Fixes** — `lobbyState` ve `findOpenLobby` tip hataları düzeltildi.
5. **SNS Verification Optional** — Domain bulunamazsa uyarı verir ama profili yine de oluşturur.
6. **Ghost Timer Bug Fix** — `duel/page.tsx` bellek sızıntısı giderildi.
7. **Leaderboard Sayfası** — `app/leaderboard/page.tsx` + `useRolet.ts`'e `fetchAllProfiles` eklendi.
8. **README Güncellemesi** — Key Features, Known Limitations bölümleri eklendi.

---

## 📋 Kalan Görevler (Öncelik Sırasıyla)

### Opus Görevleri (Karmaşık Mantık + On-Chain)
- [ ] **Ses Efektleri Sistemi** — `hooks/useSound.ts` (YENİ DOSYA)
  - Tetik çekme, mermi isabet, boş mermi, kart kullanımı sesleri
  - `duel/page.tsx`'deki olaylara bağlanacak
  - Mute/Unmute butonu

- [ ] **Maç Geçmişi** — `app/profile/page.tsx`'e eklenecek
  - Son 10 maçın sonuçları (rakip, sonuç)
  - On-chain MatchState PDA'larından çekilecek

### Gemini Görevleri (UI/CSS + Görsel)
- [ ] **Landing Page Yenileme** — `app/page.tsx`
  - Hero section, nasıl çalışır akışı, özellikler grid
  - CRT monitor estetiği korunacak

- [ ] **Duel Sayfası UI Cilası** — `app/duel/page.tsx` (sadece CSS)
  - Find Match pulse/glow, radar animasyonu
  - Ekran shake efekti, HP bar renk geçişi
  - Maç sonu efektleri

- [ ] **Navbar + Footer** — `layout.tsx` + tüm sayfalar
  - Tutarlı navbar (Home, Profile, Duel, Leaderboard)
  - Footer (hackathon badge, GitHub, Solana logo)
  - Mobil responsive

### Son Gün
- [ ] Demo Videosu (3-5 dk ekran kaydı)
- [ ] Colosseum'a proje başvurusu
- [ ] Superteam Earn RPC Fast sidetrack başvurusu

---

## ⚠️ Dosya Çakışma Kuralları

| Dosya | Kimin? | Not |
|-------|--------|-----|
| `hooks/useRolet.ts` | Opus | fetchAllProfiles eklendi, ses hookları da buraya |
| `hooks/useSound.ts` | Opus | Yeni dosya |
| `app/leaderboard/page.tsx` | Opus | Tamamlandı |
| `app/profile/page.tsx` | Opus | Maç geçmişi eklenecek |
| `app/page.tsx` (landing) | Gemini | Yeniden tasarlanacak |
| `app/duel/page.tsx` | Gemini | Sadece CSS/animasyon |
| `globals.css` | Gemini | Animasyonlar |
| `layout.tsx` | Gemini | Navbar güncelleme |

---

## 🔧 Ortam Değişkenleri

### `.env.local` (apps/web/)
```env
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_ROLET_PROGRAM_ID=2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7
NEXT_PUBLIC_MAGICBLOCK_ER_ENDPOINT=https://devnet.magicblock.app
```

### Vercel Environment Variables
Aynı değerler Vercel panelinde de tanımlı. RPC Fast aktif edilince:
- `NEXT_PUBLIC_RPC_ENDPOINT` → `/api/rpc` olarak değiştirilecek
- `RPCFAST_BACKEND_URL` → RPC Fast'in vereceği endpoint eklenecek

---

## 🐛 Bilinen Sorunlar

1. **Commit-Reveal Güvenlik Açığı** — Guest'in `guest_secret`'ı lobby'ye yazması, Host'un RNG'yi önceden hesaplamasına olanak tanıyor. Hackathon için "Known Limitation" olarak belgelendi.
2. **MagicBlock ER** — Anchor 0.30.1 SDK uyumsuzluğu nedeniyle Rust seviyesinde devre dışı. Frontend'de stub olarak duruyor.
3. **RPC Fast** — Beam ürünü devnet desteklemiyor. Hackathon planı onayı bekleniyor.
4. **getProgramAccounts** — RPC Fast free tier'da bu method desteklenmiyor. Leaderboard bu methodu kullanıyor, bu yüzden public devnet RPC ile çalışması gerekiyor.

---

## 🚀 Hızlı Başlangıç (Linux)

```bash
git clone https://github.com/SmtDcs/rolet-web.git
cd rolet-web
pnpm install

# .env.local oluştur (yukarıdaki değerlerle)
cp apps/web/.env.example apps/web/.env.local

# Dev server
pnpm --filter web dev
```

---

*Son güncelleme: 9 Mayıs 2026, 21:13 UTC+3*
