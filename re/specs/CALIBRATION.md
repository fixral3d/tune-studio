# Kalibrasyon sihirbazları (CAL)

Kaynak: VemsTune 1.5.46 decompile (`re/ghidra/out/TPSCalibrationWizard.*`, `WBO2CalibrationFrame.*`,
`MainFrame.OnWizards_006b8662.c`). Uygulama: `apps/tuner/src/components/TpsWizard.tsx`, `Wbo2Calibration.tsx`
(Ayarlar → Sihirbazlar).

## 1. TPS min/max (CAL-02) — `TPSCalibrationWizard` [Observed]
- Sayfalar: 0 Welcome, 1 MinMax (tam gaz), 2 MinMax (bırakılmış), 3 Finished.
- `MinMaxTPSPage::refresh`: realtime `tpsADC`, `ROUND` FPU kesme modunda (RC=11) → trunc. `getValue` son değeri döner.
- `OnPageChanged` (ileri yönde): 1'e girişte `tps_high`/`tps_low` orijinalleri saklanır. 2'ye girişte max = page1.getValue,
  3'e girişte min = page2.getValue; `FinishedPage::setValues(max, min)`.
- `update`: Finished sayfa düğmeleri yalnız online+connected iken etkin; mevcut değerler 0..255'e sıkıştırılır.
- `requestWrite` = RAM'e yaz; `OnWizardFinished` = `tps_high`=max, `tps_low`=min + `BURN`.
- `OnCancel` → `restoreOriginalValues` ("Original values restored").

## 2. WBO2 serbest hava (CAL-01) — `WBO2CalibrationFrame` ("WBO2 Calibration (new)") [Observed]
- Sabitler (ctor): hedef `20.9` (double @+0x200), tolerans `0.09` (@+0x210), ortalama penceresi `20` örnek (@+0x1c0).
  `MainFrame::OnWizards` → `setO2Limit(8.0)`: O2 < 8 iken durum "HEATING..." (otomatikte "[Autocalibration]" eki).
- Sensör seçimi (`OnSelectWBO2`): 0 → `wbo2_calibration`, Start = `Manmde02bye`; 1 → `wbo2_calibration2`, `Manmde03bye`.
  Seçim yalnız `wbo2_2_enable` ≠ 0 ise etkin. Stop = `Manmde00bye`.
- TF modunda bu StringCommand'lar `[param] 03 F7` olur (TEST_TOOLS sub 3 = ENA_FLAGS, PROTOCOL §7.5).
  `VemsClient.testTool(3, 0x02|0x03|0x00)`.
- Okunan kanal: `require` bir realtime sembolü kaydeder. Adı ctor'da görünmüyor; gauge `stallO2`
  (`pulseWidth_raw / 10.24`) [Inferred: kalibrasyon modunda firmware O2 %'yi pulseWidth alanında verir].
- `getAverage(v)`: diziye ekle; eleman sayısı > 20 ise en eskiyi at, ortalamayı döndür, değilse −1.
- `refresh` (her realtime örneği):
  - Çalışmıyorsa "Idle".
  - O2 < limit ise "HEATING...".
  - Otomatik modda `doAutoCalibration`.
  - Elle modda ort > 0 ve |ort − 20.9| ≤ 0.09 ise "Calibrated". Aksi halde ort ≤ 20.9 → "Increase", değilse
    "Decrease the WBO2 Calibration value".
- `doAutoCalibration`: kronometre ≥ 500 ms olunca ortalamaya bakar (ort ≥ 0 gerekir).
  - Ortalama tolerans dışıysa değer ±1 yazılır (`setSymbolValue`), "Calibration in progress... Please wait" gösterilir ve
    kronometre yeniden başlar. Yönün dalı decompile'da kayboldu; elle moddaki ipucuyla tutarlı olarak ort ≤ hedef → +1 alındı [Inferred].
  - Tolerans içindeyse "Calibrated" gösterilir ve kronometre durdurulur.
- `setSymbolValue`: 0..255'e sıkıştırır, ortalama dizisini temizler, sembolü yazar.
  Spin değişimi anında yazar; Send = yaz, Burn = yaz + burn.

## 3. Demo emülatörü
`apps/tuner/src/lib/device.ts`: ENA_FLAGS 02/03 iken ~3 s ısınma, ardından
O2 = 20.9 + (cal − 120)·0.06 (±0.02 gürültü) değeri `pulseWidth_raw`'a yazılır (ölçek 0.004).

## 4. Analog giriş (CAL-03) — `AnalogInputCalibrationWizard` / `AnalogInputCalibrationCalculator` [Observed]
- Kanallar 0, 1, 2, 5, 6, 7. Ekranda iki nokta "Values in Volt" ↔ "Calibrated Values", ardından `&Calculate`, sonra Write / Burn.
  Write/Burn yalnız başarılı bir Calculate'ten sonra etkin (`+0x1d0`).
- `OnCalculateButton`: dört kutu `ToDouble`; biri başarısızsa hiçbir şey olmaz. Volt değerleri **5'e bölünür** (`0x116ac80`).
- `calculate(x1,y1,x2,y2)`: |x1−x2| ≥ 1e-6 ve |y1−y2| ≥ 1e-6 olmalı (`EPSILON @0x1092800`).
  a = (y1−y2)/(x1−x2), b = y1 − a·x1. calculate başarısız olursa sonuç kutuları boşaltılır.
- `getTranslationA(a)`: geçerli aralık 0 ≤ a ≤ 2550.
  - a ≤ 25.5 → round(10a), ×0.1 (kod 0)
  - a < 256 → round(a), ×1 (kod 1)
  - a < 512 → round(a/2), ×2 (kod 2)
  - a < 2550 → round(a/10), ×10 (kod 3)
  - a = 2550 tam olarak hiçbir dala düşmez (orijinalde değer başlatılmamış kalıyor; bizde ×10).
- `getTranslationB(b)`: geçerli aralık |b| ≤ 1270. Büyüklüğe göre aynı kovalar: ≤12.7 → round(10b) kod 0, ≤127 → round(b) kod 1,
  ≤254 → round(b/2) kod 2, değilse round(b/10) kod 3. Offset işaretli.
- ROUND, x87 varsayılan yuvarlamasıdır (en yakın, eşitlikte çift). Yardım dosyasındaki EGT örneğinde 1195 → 119.5 → **120** ×10 çıkar
  (yardım sayfası elle 119 yazıyor).
- `write`: `mcp_scale_N`, `mcp_mult_N`, `mcp_offset_N` (INI'de U08, translate −127), `mcp_offset_mult_N`, sonra requestWrite.
  Burn = write + burn.
- Firmware/INI karşılığı: `mcp3208_chN = scale·mult/4096·demuxed_chN + offset·offsetMult`.
  Çarpan kodları 0..3 = /10, x1, x2, x10.
- Kod: `packages/core/src/tune/analogCal.ts` (`calculateAnalogCal`, `translationA/B`, test `analogCal.test.ts`),
  arayüz `AnalogCalWizard.tsx` (canlı volt ve kalibre değer önizlemesi bize ait bir ek).
