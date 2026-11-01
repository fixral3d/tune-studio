import { useEffect, useState, type ReactNode } from 'react';
import { NAV, type Tab } from './Shell';

/**
 * Pre-connect usage wizard (onboarding). Opens from the splash so a new user
 * understands every screen, the read→edit→burn workflow and the safety rules
 * *before* touching a live ECU. Remembers "don't show again" in localStorage.
 */

const SEEN_KEY = 'vems.guide.seen';
export const guideSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked → treat as seen, never force the wizard
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
};

// richer, per-screen descriptions for the feature tour (keyed by NAV tab)
const FEATURE: Record<Tab, string> = {
  gauges: 'Canlı RPM, MAP, lambda, sıcaklık göstergeleri. Log oynatırken kokpit logu takip eder.',
  settings: "INI menüleri ve diyalogları — tüm sabitleri VemsTune'daki gibi düzenle.",
  tables: '3D yakıt/ateşleme haritaları; döndürülebilir yüzey, hücre düzenleme, canlı çalışma noktası.',
  curves: 'Soğutma zenginleştirme, hızlanma gibi 2D eğrileri sürükle-bırak düzenle.',
  analyzer: 'Live VE Analyzer — canlı lambda ölçümüyle VE tablosunu otomatik öner.',
  tune: 'Konfigürasyon dosyalarını aç/kaydet, iki tune arasını karşılaştır (3D diff).',
  validate: 'Config Sanity Check — bağlanınca otomatik çalışır, hata ve uyarıları listeler.',
  firmware: 'Firmware dosyasını (.hex / .uhex) bağlantısız incele; sayfaları çöz.',
  trigger: 'Trigger log kaydı ve analizi — tetik sinyali sorunlarını teşhis et.',
  datalog: '.vemslog loglarını Multi Graph ile aç, oynat ve kanalları karşılaştır.',
};

type Step = { key: string; title: string; body: ReactNode };

const STEPS: Step[] = [
  {
    key: 'overview',
    title: 'VEMS Tune NX’e hoş geldin',
    body: (
      <>
        <p>
          Web tabanlı, <strong>VemsTune 1.5.46 uyumlu</strong> bir tuning arayüzü. Kurulum gerekmez — tarayıcıdan
          çalışır. Aynı protokol, INI ve dosya biçimleri; üstüne canlı 3D haritalar, gerçek zamanlı kokpit ve komut
          paleti.
        </p>
        <ul className="guide-ul">
          <li>
            <strong>Donanımın yoksa</strong> → <em>Demo ECU</em> ile her ekranı güvenle keşfet.
          </li>
          <li>
            <strong>Gerçek ECU</strong> → seri porttan (WebSerial) bağlan ve canlı tune et.
          </li>
        </ul>
      </>
    ),
  },
  {
    key: 'connect',
    title: '1 · Bağlan',
    body: (
      <>
        <p>İki yoldan biriyle başla:</p>
        <div className="guide-two">
          <div className="guide-box">
            <b>◎ Demo ECU</b>
            <p className="muted small">Dahili TriggerFrame emülatörü. Donanım gerekmez, risk yok. Öğrenmek için ideal.</p>
          </div>
          <div className="guide-box">
            <b>⌁ ECU’ya bağlan</b>
            <p className="muted small">
              Seri port (WebSerial). <strong>Chrome / Edge</strong> gerekir. 19200→115200→57600→9600 baud otomatik
              denenir. Kabloyu tak, portu seç.
            </p>
          </div>
        </div>
        <p className="guide-note">
          Bağlanmadan da <strong>Firmware</strong>, <strong>Trigger log</strong> ve <strong>Datalog</strong> ekranları
          kullanılabilir.
        </p>
      </>
    ),
  },
  {
    key: 'tour',
    title: '2 · Ekranları tanı',
    body: (
      <div className="guide-feat">
        {NAV.map((n) => (
          <div className="guide-feat-row" key={n.tab}>
            <span className="guide-feat-ico">{n.icon}</span>
            <div>
              <b>{n.label}</b>
              <p className="muted small">{FEATURE[n.tab]}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'workflow',
    title: '3 · Çalışma akışı',
    body: (
      <>
        <ol className="guide-flow">
          <li>
            <b>Oku</b> — bağlanınca ECU’nun sayfaları ve kimliği otomatik okunur.
          </li>
          <li>
            <b>Düzenle</b> — tablo/eğri/ayar değişiklikleri önce <strong>RAM’e</strong> yazılır, anında etki eder.
          </li>
          <li>
            <b>Burn</b> — kalıcı olması için üst bardaki <span className="kbd-inline">⚡ Burn</span> (Ctrl+B) ile flash’a
            yaz.
          </li>
          <li>
            <b>Doğrula</b> — Config Sanity Check hataları yakalar.
          </li>
          <li>
            <b>Kaydet & Logla</b> — Tune ile yedekle, Datalog ile sürüşü kaydet/incele.
          </li>
        </ol>
        <p className="guide-note warn">
          Burn edilmemiş değişiklikler yalnızca RAM’dedir — <strong>ECU kapanınca kaybolur</strong>.
        </p>
      </>
    ),
  },
  {
    key: 'safety',
    title: '4 · Dikkat edilmesi gerekenler',
    body: (
      <ul className="guide-warn">
        <li>
          <strong>Yanlış harita motora zarar verebilir.</strong> Değişiklikten önce <em>Tune</em> ekranından mevcut
          tune’u yedekle; emin değilsen önce Demo ECU’da dene.
        </li>
        <li>
          <strong>Burn’ü unutma.</strong> RAM’deki değişiklikler kalıcı değildir; sekme/bağlantı kapanınca uyarılırsın
          ama en güvenlisi her doğrulanan değişiklikten sonra burn etmek.
        </li>
        <li>
          <strong>Kalibrasyon sihirbazları</strong> (TPS, analog) motor kapalı / kontak açık iken yapılır. Ekrandaki
          yönergeleri izle.
        </li>
        <li>
          <strong>Canlı tune</strong> ederken aracı güvenli koşulda tut; mümkünse yardımcıyla veya dinamometrede çalış.
        </li>
        <li>
          <strong>WebSerial</strong> yalnızca Chromium tabanlı tarayıcılarda (Chrome/Edge) çalışır; Firefox/Safari
          desteklemez.
        </li>
      </ul>
    ),
  },
  {
    key: 'tips',
    title: '5 · İpuçları',
    body: (
      <>
        <div className="guide-keys">
          <div>
            <span className="kbd-inline">Ctrl K</span> Her yerden komut paleti (ara & çalıştır)
          </div>
          <div>
            <span className="kbd-inline">Alt 1…0</span> Ekranlar arası hızlı geçiş
          </div>
          <div>
            <span className="kbd-inline">Ctrl B</span> Burn (RAM → flash)
          </div>
        </div>
        <p>
          Komut paletinden (Ctrl+K) herhangi bir tabloya, eğriye, menüye veya komuta tek adımda ulaşabilirsin. Hazırsan
          Demo ECU ile başla.
        </p>
      </>
    ),
  },
];

export function Guide({ onClose, onDemo }: { onClose: () => void; onDemo: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  const close = () => {
    markSeen();
    onClose();
  };
  const startDemo = () => {
    markSeen();
    onDemo();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && !last) setStep((s) => s + 1);
      else if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, last]);

  const s = STEPS[step]!;
  return (
    <div className="guide" onClick={close}>
      <div className="guide-card" onClick={(e) => e.stopPropagation()}>
        <header className="guide-head">
          <div className="splash-mark">
            <span className="logo-dot" /> Kullanım rehberi
          </div>
          <button className="ghost" onClick={close} title="Kapat (Esc)">
            ✕
          </button>
        </header>

        <div className="guide-dots">
          {STEPS.map((st, i) => (
            <button
              key={st.key}
              className={`guide-dot ${i === step ? 'on' : i < step ? 'done' : ''}`}
              onClick={() => setStep(i)}
              title={st.title}
            />
          ))}
        </div>

        <div className="guide-body">
          <h2>{s.title}</h2>
          {s.body}
        </div>

        <footer className="guide-foot">
          <span className="muted small">
            {step + 1} / {STEPS.length}
          </span>
          <div className="guide-foot-btns">
            <button onClick={step === 0 ? close : () => setStep(step - 1)}>{step === 0 ? 'Atla' : '‹ Geri'}</button>
            {last ? (
              <button className="primary" onClick={startDemo}>
                Demo ile başla
              </button>
            ) : (
              <button className="primary" onClick={() => setStep(step + 1)}>
                İleri ›
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
