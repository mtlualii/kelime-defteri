# Kelime Defteri

Telefona kurulabilen (PWA) kelime defteri: bilmediğin kelimeyi hangi dilde olursa olsun yaz,
İngilizce · Almanca · Türkçe karşılığı ve örnek cümlesiyle kaydedilir; aralıklı tekrarla
(1-3-7-14-30-60-120 gün) sorulur; her sabah 08:35'te telefona bildirim gelir.

## Nasıl çalışır

- `public/` — uygulamanın kendisi (tek sayfa, çevrimdışı çalışır, ana ekrana eklenir). Kelimeler telefonda saklanır.
- `src/worker.js` — Cloudflare Worker: `/api/translate` (Anthropic API, `claude-opus-5-5`), `/api/sync` (yedek),
  `/api/subscribe` (push aboneliği), günlük cron (`35 5 * * *` UTC = 08:35 İstanbul) → Web Push.
- Tüm sunucu verisi tek bir Durable Object'te (SQLite, ücretsiz plan). VAPID anahtarları ilk kullanımda üretilir.

## Kurulum (bir kez)

1. Cloudflare → Workers & Pages → Create → **Import a repository** → bu repoyu seç.
   Build command boş, deploy command `npx wrangler deploy`. İlk deploy bittiğinde `https://kelime-defteri.<hesap>.workers.dev` adresi çıkar.
2. Worker → Settings → **Variables and Secrets** → iki **Secret** ekle:
   - `APP_TOKEN`: uygulamada bir kez gireceğin şifre (sen uydur).
   - `ANTHROPIC_API_KEY`: console.anthropic.com → API Keys.
   Sonra **Deploy** (değişkenler yeni deploy'da geçerli olur).
3. Telefonda adresi aç → Paylaş → **Ana Ekrana Ekle** → uygulamayı ana ekrandan aç → şifreyi gir → Liste → Ayarlar → **Bildirimleri aç**.

`GET /api/health` hangi secret'ın eksik olduğunu gösterir.

## Geliştirme

```bash
npm install
cp .dev.vars.example .dev.vars   # APP_TOKEN, ANTHROPIC_API_KEY
npm run dev                      # http://127.0.0.1:8787
node test/remind-test.mjs && node test/push-test.mjs
```

`public/index.html` elle düzenlenir; `port.py` yalnızca ilk taşımada kullanıldı.
