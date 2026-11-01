# Live VE Analyzer (RTLiveAnalyzer) — LOG-15

> Kaynak: `re/ghidra/out/RTLiveAnalyzer.{processData,updateMatrix,getBins,tuneAhead,updateStat,onTimer,_ctor_}_*.c`
> (hedef listesi `re/ghidra/targets-rtla.tsv`), `config/expressiondb.db`, help `main/tools/live_analyzer.html`.
> Uygulama: `packages/core/src/tune/liveAnalyzer.ts` (+ `test/liveAnalyzer.test.ts`), UI `apps/tuner/src/components/AnalyzerPanel.tsx`.
> [O] = decompile/dosya ile doğrulandı, [I] = çıkarım.

## İfade ve filtre [O]
`expressiondb.db` → `expressions`:
- `default_expression` (used_by `|ve|spark|`): `(veCurr * egoCorrection * lambda) / (lambdatarget * 100)`
- `default_filter`: `(pulseWidth > 0) && (lambda < 1.285) && (lambda > 0.1) && (coolant > 70)`
- `default_filter2`: aynı + `(calc_dtpsdt > -1) && (calc_dtpsdt < 1)`
Help: "The expression is fixed"; filtre düzenlenebilir. Filtre boşsa 1.0 kabul edilir; geçme koşulu
sonuç **> 0** (`!(v < 0 || NaN || v == 0)`).

## getBins [O]
- Hücre sınırları = komşu bin değerlerinin **tamsayı** orta noktası `(b[i] + b[i+1]) / 2` (int bölme).
- Tablo kenarları ayna: `min = 2·b0 − b1`, `max = 2·bN − bN−1`. Bin değerleri `ROUND` ile tamsayı.
- RPM dizisi artan, yük (MAP/TPS) dizisi azalan sırada (GUI satır 0 = en yüksek yük) saklanır.

## processData [O]
1. `total++`. `rpm`, `load` = `ROUND(kanal)` (`RTDataMgr` DoubleHash'ten; tablo x/y kanalları).
2. Tablo kenarları dışı **veya** Settings dikdörtgeni (Min/Max RPM, Min/Max yük; boş = −1) dışı → `outliers++`.
3. Hücre: RPM için ilk sınır `> rpm` olan indeks (rpm == sınır → sonraki hücre); yük için yukarıdan
   aşağı ilk sınır `< load`.
4. Merkez toleransı: `lo = c − round((c − solSınır)·tol/100)`, `hi = c + round((sağSınır − c)·tol/100)`
   (kenar hücrelerde sınır = tablo kenarı). Dışında → `outliers++`, mesaj **"NOT IN CENTER!"**.
5. Filtre ≤ 0 → `filtered++`, **"Filter failed!"**. Aksi halde ifade → `updateMatrix(x, y, değer)`.

## updateMatrix [O]
- Atlanan hücre (sağ tık "Skip this cell") → hiçbir şey.
- Değer hücrenin boost accumulator'ına eklenir, sayaç++.
- `1 ≤ sayaç < Min.data` → sarı arka plan, **"Collecting data"**.
- `sayaç ≥ Min.data` **ve** `sayaç % Min.data == 0` (yalnız her Min.data'da bir değerlendirme):
  - `mean = ROUND(tüm değerlerin ortalaması)`, `diff = mean − orijinalVE`.
  - `diff > maxPos` veya `diff < −maxNeg` → kırmızı, **"Too high difference!"**, VE değişmez.
  - Aksi: hücre "altered"; tuned VE = mean; `tol = ROUND(precision · prev / 100)`; `tol ≥ 0` ve
    `|mean − prev| ≤ tol` → yeşil **"TUNED"**, değilse **"Tuning in progress"**. `prev = mean`
    (`prev` başlangıçta −100 ile dolu → ilk değerlendirmede tol < 0, TUNED olmaz).
  - AutoTune açık ve VE tablosu bağlıysa VE[satır = ylen − y − 1, x] = mean yazılır (model → ECU).
  - `tuneAhead(x, y)`, `updateStat`.

## tuneAhead [O/I]
Ayarlar bit maskesi (`0x318`): bit0 Sağa, bit1 Yukarı. İki tuned (altered) komşu hücreden
`Math::linearExtrapolation` (bin değerleri üzerinde) ile **boş** (veri yok) hedef hücre hesaplanır;
aynı maxPos/maxNeg sınırı uygulanır; AutoTune açıksa VE'ye yazılır. Çapraz yön desteklenmez (help).
Uygulamamız help'teki iki yönü (sağa: x−1,x → x+1; yukarı: y−1,y → y+1) uygular. [I] decompile'daki
ikinci dal (ters yönden doldurma) uygulanmadı.

## Varsayılan ayarlar [I]
Settings ctor'ı değerleri GUI kontrollerinden alıyor; sayısal varsayılanlar decompile'da görülmedi.
Kullandığımız: tolerans %50/%50, Min.data 10, hassasiyet %2, maks. değişim +8/−4 (help örneği).
VemsTune ayarları `rtla_settings.dat`'a kaydeder; biz `localStorage['vt.rtla']`.

---

# VE Tune by statistics (RTDataStat) — LOG-11

> Kaynak: `re/ghidra/out/RTDataStat.{processData,insertIntoMatrix,doOutLierFiltering,fixSelectedCells,OnEvaluate,load,notify}_*.c`,
> `LogHistoryMgr.{findPacketByDelay,setPacketDelay}_*.c` (hedefler `targets-rtds.tsv`, `targets-rtds2.tsv`).
> Uygulama: `packages/core/src/tune/veStatistics.ts` (+ `test/veStatistics.test.ts`), UI `apps/tuner/src/components/VeStatsPanel.tsx`
> ("VE Analiz" sekmesinde "VE Tune by statistics" modu).

- **Kaynak** [O]: `LogHistoryBase` — canlı tampon ya da açılan log. `load(from, to)` örnekleri `processData`'ya verir.
- **Lambda gecikmesi** [O]: `LogHistoryMgr::setPacketDelay(ms)`; `findPacketByDelay(i, ms)` = zamanı
  `t(i) + ms/1000`'e en yakın paket (pozitif gecikmede ileri, negatifte geri arama; log sonu → −1).
  Hangi sembollerin gecikmeli paketten okunduğu [I]: biz yalnız `lambda`'yı gecikmeli alıyoruz (extra override).
- **insertIntoMatrix** [O]: kenar dışı → "Out of Range". Hücre: rpm için ilk sınır `> rpm`, yük için yukarıdan ilk sınır `< load`.
  Filtre başarısız → hücreye "dropped". Aksi halde (değer, ağırlık) saklanır.
  Ağırlık (bayrak +0x1ef): eksen başına `0.5 + (1 − |v − merkez| / |merkez − alt sınır|) / 2`, toplam = çarpım.
  Sabitler binary'den: `_DAT_010e7478 = 0.5`, `_DAT_010e7470 = 2.0` (`_DAT_010e96d0 = 100.0` analyzer yüzdeleri).
  **Sapma:** VemsTune yalnız alt sınıra uzaklığı kullandığı için eşit olmayan bin aralıklarında merkezin üstündeki örnek
  negatif ağırlık alabilir (ör. MAP 58/70/100 → 84 kPa). Ağırlığı 0'da kırpıyoruz; hücrede toplam ağırlık 0 ise ağırlıksız ortalama.
- **doOutLierFiltering** [O]: hücre başına ortalama, örnek varyansı `Σ(x−µ)²/(n−1)`, σ. Çarpan > 0 ise
  `µ ± çarpan·σ` dışı → hücre "outliers"; kalanlar ağırlıklı accumulator'a. (Decompile'da `n / toplam` ile bir `pow` daha
  var; anlamı çözülemedi [I], uygulanmadı.)
- **Hücre gösterimi** [O, strings]: sol üst min, sağ üst max, orta ortalama, sol alt `# (dropped / outliers)`, sağ alt varyans;
  sağ tık histogram; "Show VEcorr/VE ratio (in %)".
- **fixSelectedCells** [O]: seçili, henüz "Fixed" olmayan hücrede `count ≥ Min. # of data` ve `sqrt(varyans) ≤ Max. variance`
  ise VE = ağırlıklı ortalama, hücre "Fixed"; sonunda "%d cells have been fixed".
- **Export** [O, strings]: `.json` — `logname, expression, filter, lambdadelay, variance_multiplier, filterinfo, mindata,
  maxvariance, x_axis, y_axis, statistics, tabledata{calculated,current,dropped,outliers,variance}`.
- Varsayılan sayılar (çarpan 2, Min. veri 10, Maks. varyans 5) [I] — GUI spin kontrollerinden geliyor, decompile'da görülmedi.
