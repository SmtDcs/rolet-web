# ROLET Roadmap

Çalışan demoyu (`v0.1-working-demo`) genişletmek için planlı, parça parça
ilerleme. Her feature kendi branch'inde, merge edilince main güncel kalır.

## Kural seti (gelecek konuşmalar için)

1. **Her yeni iş = yeni branch.** `feature/<isim>` veya `polish/<isim>`.
   Main asla deneysel kod taşımaz; demo her zaman main'de çalışır halde durur.
2. **Bir branch = tek konu.** ER + matchmaking + NFT'yi aynı branch'te
   karıştırma. Ayrı branch, ayrı PR, ayrı merge.
3. **Riskli işten önce checkpoint tag.** `v0.X-something` formatında. Tag'a
   her zaman roll-back edilebilir.
4. **AI oturumu açarken tek dosya brief'i ver:**
   - "ROLET projesi, branch X'teyim, hedef Y, son durum Z"
   - HANDOFF.md veya CHECKPOINT-vX.md'yi paylaş, gerisini AI sorabilir
5. **AI hafızası dolduğunda:** Konuşma uzayınca AI önceki bağlamı kaybeder.
   ROADMAP veya HANDOFF'a bakıp özetle, yeni AI oturumuna geç.

---

## Backlog (öncelik sırasıyla)

### 🎯 Hackathon submission paketi (önce bunu bitir)

| # | Branch                       | İş                                                  | Süre | Risk |
|---|------------------------------|-----------------------------------------------------|------|------|
| 1 | `polish/demo-screencast`     | 3-5 dk demo videosu + README + pitch deck          | 2-3s | düşük|
| 2 | `polish/readme`              | Mimari diyagram + setup talimatı + ekran görüntüsü | 1s   | düşük|

### 🔥 Kuvvetli feature'lar

| # | Branch                       | İş                                                  | Süre | Risk |
|---|------------------------------|-----------------------------------------------------|------|------|
| 3 | `feature/matchmaking`        | Ghost yerine 2. wallet rendezvous (Lobby PDA)      | 2-3s | düşük|
| 4 | `feature/character-nft`      | Metaplex Core mint + durability bar UI             | 3-4s | orta |
| 5 | `feature/sns-resolution`     | Bonfida ile gerçek `.sol` doğrulama                | 1s   | düşük|

### 🧪 Spekülatif (ekosistem stabil olunca)

| # | Branch                       | İş                                                  | Süre | Risk |
|---|------------------------------|-----------------------------------------------------|------|------|
| 6 | `feature/er-delegation-v2`   | Tekrar dene (SDK uyumsuzluğu çözülünce, Discord)   | 3-5s | yüksek|
| 7 | `feature/leaderboard`        | ELO sıralaması + en çok $ROLET kazananlar          | 2s   | düşük|
| 8 | `feature/spectator`          | Aktif maçları izleme (subscribe to all matches)    | 2s   | orta |
| 9 | `feature/match-replay`       | RNG seed deterministik olduğu için adım-adım rerun | 3s   | orta |

### 🔧 Teknik borç

| # | Branch                       | İş                                                  | Süre | Risk |
|---|------------------------------|-----------------------------------------------------|------|------|
| 10| `chore/anchor-tests`         | Init + play_card + pull_trigger + settle e2e tests | 4s   | orta |
| 11| `chore/cleanup-legacy`       | apps/server/src socket.io kalıntılarını sil        | 30dk | düşük|
| 12| `chore/error-boundaries`     | Wallet disconnect / RPC down resilience            | 2s   | düşük|

---

## Önerilen çalışma sırası (hackathon için)

1. **Bugün/yarın**: `polish/demo-screencast` + `polish/readme` → submit-ready
2. **Sonra**: `feature/matchmaking` (asıl PvP olduğunu kanıtlar)
3. **Vakit kalırsa**: `feature/character-nft` (NFT story'sini güçlendirir)
4. **Asla yapma**: ER delegation v2'yi tekrar deneme (MagicBlock cevap verene kadar)

---

## Branch açma şablonu

```bash
# Roll-back garantisiyle yeni feature başlat
git checkout main
git checkout -b feature/<name>

# Çalış, commit'le
git add . && git commit -m "..."

# Bitince merge:
git checkout main
git merge --no-ff feature/<name>
git tag v0.X-<name>
git push origin main --tags

# Branch artık silinebilir:
git branch -d feature/<name>
```

## Acil roll-back

```bash
git reset --hard v0.1-working-demo    # son temiz duruma
# ya da:
git checkout v0.1-working-demo -- <dosya>   # tek dosyayı geri al
```

Gitignored kritik state için `~/.rolet-checkpoint-v0.1/` yedeğine bak.
