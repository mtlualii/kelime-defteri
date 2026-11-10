#!/usr/bin/env python3
"""Builds public/index.html from the artifact source (../kelime-defteri.html) by swapping the
claude.ai runtime for the PWA runtime in client/runtime.js. Every anchor must match exactly once."""
import pathlib, re, sys

here = pathlib.Path(__file__).resolve().parent
src = (here.parent / 'kelime-defteri.html').read_text(encoding='utf-8')
runtime = (here / 'client' / 'runtime.js').read_text(encoding='utf-8')

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        sys.exit(f'anchor "{label}" found {n} times')
    return s.replace(old, new)

HEAD = '''<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Kelime Defteri</title>
<meta name="description" content="Bilmediğin kelimeleri kaydet; İngilizce, Almanca ve Türkçe karşılıklarıyla aralıklı tekrar et.">
<meta name="theme-color" content="#F1F3F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#12161D" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Kelime">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
'''

# 1. head: drop the artifact-only lines, add a real document head
s = replace_once(src, '<title>Kelime Defteri</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n', HEAD, 'head')
s = replace_once(s, '</style>\n\n<header class="hdr">', '</style>\n</head>\n<body>\n<header class="hdr">', 'body start')
s = s.rstrip() + '\n</body>\n</html>\n'

# 2. base styles the artifact shell used to provide, plus the new cards
s = replace_once(s, '* { box-sizing: border-box; }\nbody {', '''* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
[hidden] { display: none !important; }
input[type="password"] { width: 100%; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 16px; }
html { -webkit-text-size-adjust: 100%; }
.prefs .srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.prefs .srow b { display: block; font-size: 15px; }
.prefs .srow .btn { flex: 0 0 auto; }
.nudge { align-items: center; }
.nudge .btn { flex: 0 0 auto; }
.nudge .x { background: none; border: 0; color: inherit; font-size: 20px; line-height: 1; padding: 0 2px; cursor: pointer; opacity: .7; }
body {''', 'base styles')

# 3. the "sign in to Claude" notice becomes the access-token card + the notification nudge
s = replace_once(s, '''        <div id="dbNotice" class="notice" hidden>
          <span>Kayıt için Claude hesabınla giriş yapman gerekiyor. Şimdilik eklediklerin sadece bu ekranda kalır.</span>
        </div>
''', '''        <section class="card stack" id="tokenCard" hidden>
          <h2 class="title" style="font-size:20px">Erişim şifresi</h2>
          <p class="hint">Çeviri, yedekleme ve sabah bildirimi için Cloudflare'de belirlediğin şifreyi (APP_TOKEN) bir kez gir. Bu cihazda saklanır; kelimeler şifre olmadan da bu cihaza kaydedilir.</p>
          <form class="row" id="tokenForm" autocomplete="off">
            <input type="password" id="tokenInput" class="grow" placeholder="Şifre" autocapitalize="off" autocorrect="off" spellcheck="false">
            <button class="btn primary" type="submit">Bağlan</button>
          </form>
          <p class="hint" id="tokenMsg"></p>
        </section>
        <div class="notice nudge" id="pushNudge" hidden>
          <span class="grow">Sabah hatırlatması için bildirimleri aç.</span>
          <button class="btn small" type="button" id="nudgeBtn">Aç</button>
          <button class="x" type="button" id="nudgeClose" aria-label="Kapat">×</button>
        </div>
''', 'dbNotice')

# 4. settings card at the bottom of the list view
s = replace_once(s, '''        <textarea id="exportBox" rows="6" hidden readonly></textarea>
      </div>
    </section>
''', '''        <textarea id="exportBox" rows="6" hidden readonly></textarea>

        <section class="card stack prefs" id="settings">
          <h2 class="title" style="font-size:20px">Ayarlar</h2>
          <div class="srow">
            <div class="grow"><b>Sabah bildirimi</b><p class="hint" id="pushHint">Her sabah 08:35'te tekrar edilecek kelimeleri hatırlatır.</p><p class="hint" id="lastRemind"></p></div>
            <button class="btn small" type="button" id="pushBtn">Bildirimleri aç</button>
          </div>
          <div class="notice" id="iosNotice" hidden><span>iPhone'da bildirim için: Safari'de Paylaş → Ana Ekrana Ekle, sonra uygulamayı ana ekrandan açıp şifreni girip "Bildirimleri aç"a bas.</span></div>
          <div class="btnrow tight"><button class="btn small" type="button" id="testPushBtn" hidden>Test bildirimi gönder</button></div>
          <div class="srow">
            <div class="grow"><b>Yedek</b><p class="hint" id="syncHint">Kelimeler bu cihazda saklanır ve sunucuya yedeklenir.</p></div>
            <button class="btn small" type="button" id="syncBtn">Şimdi yedekle</button>
          </div>
          <div class="srow">
            <div class="grow"><b>Erişim şifresi</b><p class="hint" id="tokenHint">—</p></div>
            <button class="btn small" type="button" id="tokenBtn">Değiştir</button>
          </div>
        </section>
      </div>
    </section>
''', 'settings card')

# 5. runtime wiring: no more claude.use(); server error codes get Turkish copy and open manual entry
s = replace_once(s, "  const use = (name) => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(name).catch(() => null) : Promise.resolve(null);\n", '', 'use()')
s = replace_once(s, "      case 'session_expired': return 'Oturumun düşmüş, Claude\\'a yeniden giriş yap.';\n", '''      case 'no_token': return 'Çeviri için erişim şifresini gir. Şimdilik alanları elle doldurabilirsin.';
      case 'unauthorized': return 'Erişim şifresi yanlış; Ayarlar\\'dan düzelt. Alanları elle doldurabilirsin.';
      case 'setup': return 'Sunucuda APP_TOKEN ayarlanmamış (Cloudflare → Settings → Variables and Secrets).';
      case 'no_api_key': return 'Çeviri anahtarı (ANTHROPIC_API_KEY) Cloudflare\\'de ayarlanmamış. Alanları elle doldurabilirsin.';
      case 'bad_api_key': return 'Anthropic API anahtarı geçersiz; Cloudflare\\'de düzelt.';
      case 'upstream': return 'Çeviri servisine ulaşılamadı. Biraz sonra tekrar dene.';
      case 'network': return 'İnternet yok gibi. Bağlantıyı kontrol et.';
''', 'sampleCopy')
s = replace_once(s, "  const HIDE_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);\n",
                 "  const HIDE_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);\n"
                 "  const MANUAL_CODES = new Set(['no_token', 'unauthorized', 'setup', 'no_api_key']);   // server not usable yet: let the user fill the fields\n", 'HIDE_CODES')
s = replace_once(s, "      if (HIDE_CODES.has(code)) { state.sampleOff = true; openManual(term); }\n      showErr(sampleCopy(code));",
                 "      if (HIDE_CODES.has(code)) { state.sampleOff = true; openManual(term); }\n      else if (MANUAL_CODES.has(code)) { openManual(term); if (code === 'no_token') showTokenCard(); }\n      showErr(sampleCopy(code));", 'translate catch')
s = replace_once(s, "        if (HIDE_CODES.has(code)) state.sampleOff = true;\n", "        if (HIDE_CODES.has(code)) state.sampleOff = true;\n        if (code === 'no_token') showTokenCard();\n", 'bulk catch')

# 6. boot section → PWA runtime
start = s.index("  // ---------- boot ----------\n  route();\n  renderAll();\n\n  use('db').then((db) => {")
end = s.index("})();\n</script>", start)
s = s[:start] + runtime + s[end:]

out = here / 'public' / 'index.html'
out.write_text(s, encoding='utf-8')
leftovers = [m.start() for m in re.finditer(r'window\.claude|claude\.use|Claude', s)]
print('wrote', out, len(s.splitlines()), 'lines; claude mentions left:', len(leftovers))
