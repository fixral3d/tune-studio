# VemsTune 1.5.46 — Dosya Formatları ve Veri Depoları Spesifikasyonu

> Kapsam: VemsTune 1.5.46'nın (2016-06-05) okuduğu/yazdığı **tüm dosya formatları ve veri depoları**.
> Kapsam dışı: INI tanım dili (`*.ini`, `config/include/*.ini`) ve C başlıkları (`global.h`, `varstr.h`, `magicstr.h`, `comm.h`) — bunlar ayrı ekiplerin konusudur; burada yalnızca bu dosyaların *nerede* durduğu ve hangi formatlarla birlikte kullanıldığı belirtilir.
>
> Hedef: `re/target/vemstune-1.5.46/` (salt okunur). Kanıt: `re/evidence/syms.tsv`, `re/evidence/strings.txt` (ofsetler **`vemsTune-c.exe`** dosya ofsetidir, `vemsTune.exe` değil).
> Yardımcı betikler: `re/tools/formats/`. Üretilen dökümler: `re/evidence/formats/`.

## 0. Okuma kılavuzu

### 0.1 Kesinlik etiketleri

| Etiket | Anlamı |
|---|---|
| **[Observed]** | Gerçek örnek dosyada veya binary string/sembolünde doğrudan görüldü; betikle doğrulandı. |
| **[Inferred]** | Gözlemlerden mantıksal çıkarım (sembol adı, string sırası, sayısal uyum). Yüksek olasılık ama birebir kod okuması yok. |
| **[Unknown]** | Elde kanıt yok; Ghidra decompile gerekir. |

### 0.2 Adres dönüşümü (Ghidra için)

`syms.tsv` içindeki `value` sütunu `.text` bölümüne göre ofsettir. `vemsTune-c.exe`: ImageBase `0x400000`, `.text` RVA `0x1000` →
**VA = 0x401000 + value**. Örn. `VemsLogReader::getNextVersion2` value `0x7dab2c` → VA `0xBDBB2C`.
Mangled isimler MinGW'de fazladan `_` önekiyle gelir: `__ZN13VemsLogReader15getNextVersion2Ev`.

Not: Bu oturumda Ghidra/IDA/objdump yoktu (REA `provider_unavailable`); bu yüzden tüm davranışsal iddialar string/sembol + örnek dosya analizine dayanır.

### 0.3 Yardımcı betikler (`re/tools/formats/`)

| Betik | İş |
|---|---|
| `symgrep.py <regex>` | `syms.tsv`'de arama + kaba demangle (`Class::method`). |
| `wstr_range.py <exe> <start> <end> [minlen]` | Bir ofset aralığındaki kısa UTF‑16/ASCII string'leri döker (strings.txt'nin 5 karakter altını kaçırdığı anahtarlar için). |
| `dump_sqlite.py <root> <outdir>` | Tüm `*.db/*.s3db` şemaları, satır sayıları, örnek satırlar (salt-okunur `immutable=1`). |
| `vemscfg_stats.py` | `.vemscfg` gramer istatistiği (başlık, indeks türleri, değer uzunlukları). |
| `ihex_stats.py` | Düz Intel-HEX yapı raporu (kayıt tipleri, adres aralıkları, entropi). |
| `chex_stats.py` | `C:` önekli şifreli hex varyantları (`.uhex/.chex/.chex2/.uair/.uclt`) raporu. |
| `xml_schema.py` | XML dosyalarının eleman yolu/öznitelik şeması çıkarımı. |
| `crcsearch.py` | Bir paketin CRC16 varyantını kaba kuvvetle bulur. |
| `vemslog_parse.py` | `.vemslog` (LogVersion 2) çözümleyici — başlık, blok, paket, CRC doğrulama. |

Dökümler: `re/evidence/formats/sqlite/` (şema grupları, `sqlite_summary.json`, `summary.txt`), `sqlite_userdata/`, `xml_schemas.txt`, `vemslog_samples/` (kullanıcı dizininden kopyalanan 2 gerçek `.vemslog`), `VemsLogger-strings.txt`.

---

## 1. Dizin yerleşimi ve kullanıcı verisi

### 1.1 Kurulum dizini (`%vemstunedir%`) [Observed]

Binary'de sabit klasör listesi (`0xd7ea00`): `vemsprojects, config, VEMS_Files, webcache, hotkeys, maps, tiles, logs, fw_desc, icons, images, fonts, configlets, configfilters, defaultfirmwareconfigs, help, help2, htmls, defaultstatements`.

| Yol | İçerik | Bölüm |
|---|---|---|
| `config/*.db, *.s3db` | GUI/gauge/flag/hotkey SQLite depoları | §16 |
| `config/*.xml, *.cfg, *.json` | GUI tanımları, tercih formu, harita sunucuları | §18–19 |
| `config/*.ini`, `config/include/*.ini` | INI tanım dili (kapsam dışı) | — |
| `config/fw/markerword_erase.{uhex,chex,chex2}` | Marker sayfası silme imajları | §13 |
| `config/fw_desc/<firmware_x.y.z \| round_x.y.z>/[my_make.16x14/]global.h` | Firmware sürümüne göre C başlığı (kapsam dışı) | — |
| `config/hotkeys/*.db` | Kısayol profilleri | §16.6 |
| `config/modbus/<profil>/` | Modbus cihaz profilleri | §20 |
| `config/defaultstatements/*.sql` | Varsayılan SQL tohumları | §17 |
| `config/WBlambda100MOT.inc` | WBO2 ADC→lambda tablosu | §15 |
| `defaultfirmwareconfigs/*.vemscfg`, `audi/*` | Varsayılan konfigler ve örnek proje | §2, §5 |
| `configlets/<dialog>/*.txt`, `configfilters/*.txt` | Konfig parçacıkları/filtreler | §3 |
| `matfactor/*.air|.uair|.csv`, `coolantfactor/*.clt|.uclt` | Termistör kalibrasyon yamaları | §14 |
| `vemsprojects/firmware_x.y.z/` | `global.h`, `my_make.16x14/`, `vems.hex`, `vems.uhex`, `*.vemsprj` | §5, §13 |
| `logs/` | `filelog-<epoch>.log`, `resourcelog-<epoch>.log`, `operations-<epoch>.db` | §21 |
| `webcache/fw/` | İndirilen firmware önbelleği (boş) | §13.7 |
| `3rdparty/dd.exe` | SD kart ham imaj alma | §11 |

### 1.2 Kullanıcı veri dizini (`%vemsdocuments%`) [Observed]

`%vemsdocuments%` = `Documents\VEMS_Files` (string `VEMS_Files`, regex `%vemsdocuments%\/(.+)`, `%vemstunedir%\/(.+)`). Çalışma dizinleri `config/workingdirs.db` içinde tutulur (§16.7). Bu makinede (`C:\Users\erdem\Documents\VEMS_Files\`, salt-okunur listelendi):

```
VEMS_Files/
  v3.3_n001453-2026.10.14-12.22.24.vemslog   3072 B   (§7 — gerçek örnek)
  v3.3_n001453-2026.10.14-12.22.29.vemslog   2560 B
  vemsdetails.db                              3072 B   (§16.8 — log/cfg dizin indeksi)
  errorreports/reports.db                     3072 B   (§16.8 — hata raporu kuyruğu, boş)
```

Ayrıca kullanılan/oluşturulan (örneği yok) [Inferred, string kanıtlı]: `gpscache/osm`, `gpscache/google/{normal,sat,streets}` (harita karoları, `maps.xml`), `races\` (yarış analizi), `sdcardlogs.db` (§11), `*-SDCard.vemslog`, `eepromcfg_*.vemscfg2`, `*.raweeprom`, `*.triggerlog`.

**Log dosyası adlandırma** [Observed]: `<SerialNumber>-YYYY.MM.DD-HH.MM.SS.vemslog` (ör. `v3.3_n001453-2026.10.14-12.22.24.vemslog`); SD karttan dönüştürülenler `-SDCard.vemslog` son ekiyle (`0xd64100` bölgesi: `-SDCard`, `.vemslog`, `-.vemslog`).

---

## 2. `.vemscfg` — ECU konfigürasyon dosyası (metin)

**Amaç:** ECU EEPROM/flash konfigürasyonunun (skaler + tablo) insan-okunur dökümü; yükleme, karşılaştırma, filtreleme için. V3 (Genboard) ve Round (WBO2 gösterge) cihazları.

**Okuyucu/yazıcı sınıflar** [Observed sembol]:
- Yazıcı: `STDataIOVemsCfg::{saveTo, saveScalarsTo, saveArraysTo, saveArrayTo, saveEppromAreTo, writeScalarSymbolsToFile, writeArraySymbolsToFile, writeArraySymbolToFile, writeArraySymbolHeaderToFile, writeEppromAreToFile, getTableHeaderLine, writeStringToStream}`, başlık: `RawLogHelper::getVemsCfgHeader`.
- Okuyucu: `FirmwareConfigLoader::{load, parse, parseCfg, parseHeader, loadScalars, loadTables, loadEeepromPage, isAlienConfig, isMSQ, hasRpmKpaHeader, tableAxisHack}`, `FirmwareConfigParser::{parseFiles, parseHeader, parseHeaderOnly, parseLine, parseConfigLine, parseTableLine}`, `FirmwareConfigData`, `FirmwareConfigCreator` (karşılaştır/filtrele/yükle), `FirmwareConfigManager::parseConfigFilterFile`.
- Dosya diyalog filtreleri: `Vems Config files (*.vemscfg)|*.vemscfg`, `VEMSCFG files (*.vemscfg)|round*.vemscfg`, `VemsCfg files (*.vemscfg)|*.vemscfg|MSQ files (*.msq)|*.msq`.
- Varsayılan dosya seçimi regex'leri: `config_[0-9]{1}\.[0-9]{1}\.[0-9]{1,2}\.vemscfg$`, `round_[0-9]{1,}\.[0-9]{1,}\.[0-9]{1,}\.vemscfg$`, glob'lar `config_*.vemscfg`, `round_*.vemscfg`, `arm_*.vemscfg` (ARM cihazı için; örnek yok).

### 2.1 Gramer [Observed — 40 örnek, `vemscfg_stats.py`]

```
file        := header_line* blank_line? entry_line*
header_line := '#' ' '? KEY ':' ' ' VALUE EOL          ; serbest yorumlar da '#' ile başlar
entry_line  := NAME index? '=' HEXBYTE (' ' HEXBYTE)* EOL
NAME        := [A-Za-z_][A-Za-z0-9_]*
index       := '[' IDX ']'
IDX         := [0-9A-Z]       ; tek karakter, taban-36 benzeri: 0-9, A=10, B=11 … G=16
             | 'r'            ; tablonun RPM ekseni (X)
             | 'k'            ; tablonun kPa/yük ekseni (Y)
             | [0-9]+         ; dizi elemanı (warmup_clt[0] …)
HEXBYTE     := [0-9A-F]{2}    ; büyük harf yazılır; okuyucu küçük harfi de kabul eder [Inferred]
EOL         := '\n' (yazıcı) | '\r\n' (okuyucu kabul eder; calibrations.vemscfg CRLF)
```

- Satır sonu: yazıcı **LF** üretir (38/40 örnek LF). Satır sonunda TAB olabilir (`calibrations.vemscfg`: `wbo2_pump_pw_zero2=65\t`) → okuyucu trim etmeli.
- Skaler: tek bayt (`primep=00`). Çok baytlı skaler/blok: boşlukla ayrılmış baytlar (`eeprom_area[0]=` 64 bayt).
- Dizi elemanları ayrı satırlarda: `warmup_clt[0]=97 … warmup_clt[9]=00`; 17 elemanlı eğriler `clt_curve[0..9,A..G]`.
- **Tablo** (tek harfli isimler, MegaTune mirası): satır başına bir satır, satır içinde sütun baytları:
  ```
  j[0]=60 64 6B 71 80 88 8F 91 92 91 91 90 90 90 90 90   ; satır 0 (16 sütun)
  …
  j[D]=A6 AA AF …                                        ; satır 13
  j[r]=07 0A 0E 14 1A 22 29 31 37 3D 43 58 5A 5F 64 69   ; 16 RPM ekseni (×100 rpm) [Inferred]
  j[k]=0A 0F 19 23 28 2B 33 3A 46 64 A0 B4 C8 D2         ; 14 kPa ekseni
  ```
  Gözlenen tablolar (1.2.34): `h`(6×8, ateşleme çıkış eşlemesi), `j`(14×16 VE), `l`(8×8 lambda), `n`(12×12), `b`(4×12+r), `e`(r/k 8), `y`, `i`, `w`, `f`, `z[r]`. Tablo anlamları INI'den gelir (kapsam dışı). `configfilters/TABLE_VE.txt` aynı tabloyu `j`, `j_r`, `j_k` adlarıyla anar → iç sembol adları `<t>_r`, `<t>_k` [Observed].
- Değer token sayısı dağılımı (1.2.34): 1 bayt: 521, 4: 1, 8: 57, 12: 43, 14: 1, 16: 24, 17: 3, 64: 1.

### 2.2 Başlık anahtarları [Observed]

| Anahtar | Örnek | Not |
|---|---|---|
| `CurrentTime` | `2016-03-30 19:15:26` | yerel saat, `%Y-%m-%d %H:%M:%S` |
| `Creator` | `VemsTune 1.5.34 (2015-09-09)` | eski: `VemsTune 0.9.88 (2009.06.25)` |
| `Version` | `1.2.34` / `1.5.7` | ECU firmware sürümü (`config_1.2.2.vemscfg` içinde `1.2.0` — dosya adı ≠ içerik) |
| `SerialNumber` | `v3.3_u004521`, `r0.0_2562` | `v<hw>_<n|u><6 hane>` (V3), `r<hw>_<no>` (Round) |
| `SerialNumber Raw` | `20 76 33 2E 33 5F 75 30 30 34 35 32 31 ` | ≥1.1.98; ham ASCII hex, bazen başta `0x20`; sonda boşluk |
| `CompilationTime` | `2013-12-03 17:11` | Round'da boş |
| `Signature` | `VEMS v1.2.34 16x14 kpa=2,2` / `VEMS Round WBO2 v1.5.7` | `16x14`/`12x12` tablo boyutu, `kpa=<conf>,<unit>` (`FirmwareInfo::isKpaConfRes_4/isKpaUnit_4/isHighBoost`) |
| `CompileOptions` | `000000DE` | 32-bit hex bayrak (≥1.1.56; Round'da yok) |
| `Options` | `VEMS Genboard v3, 1.1.56` | yalnız 1.1.56–1.1.58 |
| `Firmwareversion=` | `# Firmwareversion=1.1.61` | yalnız 1.1.58–1.1.62 (eşittirli eski varyant) |

Başlık yoksa: `Config file has no header. Current firmware is used.` [Observed string].

### 2.3 Özel `.vemscfg` dosyaları [Observed]

- `defaultfirmwareconfigs/config_<fw>.vemscfg`, `round_<fw>.vemscfg`: "en yakın sürüm" varsayılan konfigler (`FirmwareConfigCreator::loadDefaultConfig`).
- `calibrations.vemscfg`: başlıksız, kalibrasyona özgü 8 anahtar (`wbo2_*`, `egt1_cal`, `batt_cal`); ECU'ya özel değerler — "IDENTICAL DEVICE SERIALNUMBER" uyarısıyla korunur.
- `v3_configfilter.vemscfg`: `#These keys are filtered at config upload!` + `confswitch`, `config_switch`, `pwcommlock0` — yükleme sırasında atlanan anahtarlar (`FirmwareConfigCreator::applyFilter`).

### 2.3a Okuma/yazma kuralları [O‑run, 2026‑11‑01; `@vems/core` `files/vemscfg.ts`]
Doğrulama: VemsTune'un `config_1.2.34`, `config_1.2.32` dosyaları ve kullanıcının gerçek `3000gt.vemscfg`'si (fw 1.2.16) okunup sayfalara yazıldı, sonra yeniden yazıldı; çıktı **bayt bayt aynı**.

- **Adlar `global.h` alanlarıdır:** `config_t` → `config_ext_t` → `config_shared_t`, yapı sırasıyla.
  - Dizi elemanları ayrı satırlarda yazılır. İndeks 10 elemana kadar ondalık, daha uzun dizilerde taban‑36 tek hanedir (`clt_curve[A]`).
  - [O‑run] Şablonsuz sıra, 1.2.32 dosyasında header sırasıyla birebir aynı.
- **Tek harfli tablolar** `[SymbolAlias]` ile çözülür:
  - `t[R]` = 2B dizinin R. satırı (R taban‑36).
  - `t[r]` / `t[k]` = `t_r` / `t_k` eksenleri.
  - Satır sayısını aşan satırlar ek alias'lardır (`b[C]` = `bC` = `rotary_trailing_spark`).
  - `h[R]` = INI'deki `hR` dizileri.
  - Tek boyutlu tablo için `t[0]` = dizinin tamamı.
  - Yazım sırası: `h j l z n t b p e y i w s f`; her tabloda satırlar, sonra `r`, `k`, sonra ek satırlar.
- **`eeprom_area[0]`:** 64 bayt, en son yazılır. Her bayt `"%02X "` biçiminde olduğu için **satır boşlukla biter**. `# SerialNumber Raw:` başlık değeri de boşlukla biter.
- **Bilinmeyen satırlar korunmalıdır.** Örneğin `mux_mcp_ch` / `mux_out0`: 1.2.34 varsayılan dosyasında var ama 1.2.34 INI'sinde ve 1.2.32 header'ında yok.
- **INI koşul tablosu dosyanın kendi başlığından türetilir:** `CompileOptions` bit maskesi ve `Signature`. Ayrıntı INI-DIALECT §3.4 ve `ini/defines.ts`. Örnek: `0xDE` → `KNOCK_ALTERNATIVE`, olmazsa `f` tablosu yerleşmez.

### 2.5 Config yükleme ve firmware yükseltme taşıması (FW-16/17) [O‑dec, 2026‑11‑01; `files/migrate.ts`]
**Giriş noktası:** `FirmwareConfigManager::createUploadConfig`. Şuralardan çağrılır:
- `FirmwareConfigUIManager::{uploadConfigFile, easyUploadConfig, …}`
- yükseltme sihirbazı `QFU_FwConfigUpload`

Akış `FirmwareConfigCreator::createUploadConfig` @0x4f8750 → `validateV3Config` @0x4f8bd8. Not: Ghidra projesi `vemsTune-c.exe`'den kurulu; `(int)` dönüşümleri **kesme** (trunc) yapar.

1. **Ayrıştırma** (`FirmwareConfigParser::parseLine`):
   - Tek karakterlik taban adlar ve `eeprom_area` tablo satırıdır.
     - `t[r]` / `t[k]` → `t_r` / `t_k`
     - `h[i]` → `h<i>`
     - `b[i]`, i > 11 → `b<I>`
     - diğerleri `t` matrisinin satırıdır.
   - Geri kalan her şey tam anahtarıyla bir skalerdir (`warmup_clt[0]`).
   - Başlık yoksa ECU sürümü kullanılır ("Config file has no header. Current firmware is used.").
2. **Eksikler:** ECU sembol kümesinde olup dosyada olmayan skalerler (sayfa/ofset sırasıyla) ve tablolar.
3. **`ConfigReplacerMgr::replace`** @0x4f01e8 (yalnız eksik skaler varsa):
   - Kuralın anahtarı **yeni** semboldür, ifade **eski** adlardan hesaplanır.
   - Değişkenler: dosyadaki skalerler + `t[i]` tablo elemanları + `<Variables>`.
   - `trunc` sonucu 0..255 aralığındaysa yazılır ve sembol eksik listesinden çıkar. Kurallar zincirlenmez.
   - Rapor: "Config replace summary", "Number of calculated variables: :%i", "Missing keys that there are calculations:"…
4. **`ConfigFwRulesMgr::replaceRules`** @0x4eed92:
   - **Kova V, `cfgVer < V && ecuVer >= V` ise uygulanır.** Aynı `fw` değerli kovalar birleşir (1.2.1 ×2).
   - Değişkenler: skalerler + tablo elemanları. Güncellenen değer sonraki kurallara görünür.
   - Anahtar config'te yoksa → "not found in config". Hesap hatalı ya da < 0 → "not valid or result < 0". Aksi halde `trunc` ile yazılır, **kırpma yapılmaz**.
   - Rapor satırları bir StringSet'te tutulur, yani tekrarsız ve sırasızdır. Örnek: `<b>K</b> has been updated from <b>a</b> to <b>b</b> by the rule <i>'K = expr'</i> (fw >= V)`; atlanan kova: `<i>V rules skipped. ECU version: …, config version: …</i>`.
5. **`filter(v3_configfilter.vemscfg)`:** Dosyada **bulunan** `confswitch`, `config_switch`, `pwcommlock0` çıkarılır; değerleri yok sayılır.
6. **Kısmi config** (< 230 skaler satır) burada durur. Tam config için devam:
   - Dosya başka bir ECU'danysa (`isAlienConfig`: seri no farklı ya da bilgi geçersiz) `calibrations.vemscfg` anahtarları çıkarılır.
   - **Varsayılan dosya** (`FirmwareInfo::geDefaultConfigFile`): sürüm **dosya adından** okunur. Önce birebir sürüm aranır; yoksa **aynı major.minor serisinde ECU sürümünden küçük en büyük** sürüm seçilir. Örnekler: 1.2.40 → 1.2.34, 1.2.16 → 1.2.15, 1.3.x → yok.
   - Eksik skalerler ve tablolar bu dosyadan doldurulur.
   - `b` tablosu varsa `extendTable`: varsayılan `b`'nin üzerine kullanıcı baytları satır sırasıyla kopyalanır.
   - **`safetyConfigSetup`:** `prohibit_config & 0x80 == 0` ise `p = (maj&7)<<10 | (min&7)<<7 | (patch&0x7F) | (ps2 ? 0x8000 : 0)`; `prohibit_h = p>>8`, `prohibit_l = p&0xFF`.
   - Sanity check yalnız danışma amaçlıdır ve göç **öncesi** değerlerle çalışır.

Yükleme yalnız config'te bulunan skalerleri gönderir (bayta kesilmiş); olmayan anahtarlarda ECU değeri korunur [I]. 12x12 → 16x14 yeniden örnekleme **yok**; yalnız `tableAxisHack` vardır: `t_x` yoksa eski ortak `r`/`k` eksen tabloları kopyalanır.

### 2.6 Config karşılaştırma (FW-06) [O‑dec; `files/compare.ts`]
Kaynak fonksiyonlar: `FirmwareConfigData::compareScalars` @0x4fc4aa, `compareTables` @0x4fcf30, `searchExtra*`; `FirmwareConfigDifferences::summary` @0x500002, `details` @0x500700.

**Karşılaştırma kuralları:**
- **Skalerler:** iki tarafta da var ama değer farklıysa satır `"ad: a != b"` olur. Referansta olup kontrol edilen config'te olmayan anahtar "missing" sayılır. O config anahtarı **kasten filtrelemişse** (configfilter/kalibrasyon) "intentionally filtered" sayılır. Yalnız kontrol edilen config'te olanlar "extra"dır.
- **Tablolar:** satırlar birleştirilerek aynı mantıkla karşılaştırılır.

**Özet satırları** (bu sırayla, yalnız boş olmayanlar):
- `Found %d missing scalar(s)!`
- `Found %d intentionally filtered scalar(s)!`
- `Found %u extra scalar(s)!`
- `Found %u different scalar value(s)!`
- `Found %u missing tables(s)!`
- `Found %u extra tables(s)!`
- `Found %u different table value(s)!`

**Detay:** her bölüm için başlık + satır sonu, ardından her öğe için `önek + öğe + satır sonu`. Başlıklar şunlardır; bazılarının sonunda boşluk vardır:
- `Missing scalar(s) found!`
- `Intentionally filtered scalar(s) found!`
- `Extra scalar(s) found!`
- `Different scalar value(s) found! `
- `Missing tables(s) found! `
- `Extra tables(s) found! `
- `Different table value(s) found! `

**Sonuç metni:** `Config files are identical.` / `Config files aren't identical.` + `See log tab for details.`

### 2.4 Bilinmeyenler
- Tablo/skaler yazım **sırası** (INI sırası mı, sembol tablosu sırası mı) — `STDataIOVemsCfg::saveTo`.
- `getTableHeaderLine`'ın ne ürettiği (örneklerde tablo öncesi başlık satırı yok) [Unknown].
- `isAlienConfig`, `tableAxisHack`, `FirmwareConfigData::extendTable` — 12x12↔16x14 dönüşüm kuralları [Unknown].

---

## 3. Konfig parçaları: configlets, configfilters, eski `.txt` konfigler

### 3.1 `configlets/<dialog>/*.txt` [Observed]
94 dosya, 27 klasör (`trigger`, `knock1`, `wideband`, `important`, `matSensorCurve`…). Gramer `.vemscfg` gövdesiyle aynı (`NAME[idx]=HEX…`), `#` yorumları serbest (ör. `# verified on 1.2.27`). Başlık yok. Klasör adı = kullanıcı diyaloğu (`ConfigletPanel::requestWriteData`); dosya adı = seçenek adı (`4cyl_60-2.txt`, `Enabled_All_Ch_1.txt`). Seçilince içerdiği anahtarlar ECU modeline yazılır.

### 3.2 `configfilters/*.txt` [Observed]
Yükleme/karşılaştırma için anahtar listeleri. İki biçim: `key=HEX` (değer yok sayılır [Inferred]) veya sadece anahtar adı (`TABLE_VE.txt`: `j`, `j_r`, `j_k`). Diyalog: `Select a filter file` (`Pmcdmct (*.txt)|*.txt|Vems config file (*.vemscfg)`). Okuyucu `FirmwareConfigManager::parseConfigFilterFile`.

### 3.3 Eski proje konfig `.txt` (mcd/mct, audi) [Observed]
`defaultfirmwareconfigs/audi/*.txt`: `.vemscfg` gövdesiyle aynı gramer ama **tablo hücreleri 16-bit (4 hex hane)**:
```
j[0]=6080 6080 6E80 8280 …     ; yüksek bayt ≈ VE, düşük bayt hep 0x80
```
Proje (`.vemsprj`) içinde `type="config"` / `type="config_download"` (`mcd-saved.txt`, `mct-saved.txt`) olarak referanslanır. 16-bit hücre anlamı [Unknown] — `FirmwareConfigData::addTableLine/addTableLineMSQ`, `FirmwareConfigParser::parseTableLine`.

---

## 4. `.vemscfg2` ve `.raweeprom` — ham EEPROM konfig

**Sınıflar:** Yazıcı: EEPROM indirme (`Config download`, `EEPROM_DL_PROGRESS`), dosya adı `eepromcfg_<…>.vemscfg2` [Observed string `eepromcfg_`, `.vemscfg2`]. Okuyucu: `VemsCfg2Loader::{load, parseCfgHeader, parseCfgLine, parseGlobalH, parseMapFile, getFileNames, getEepromBuffer}`; GUI: `MainFrame::OnUploadVemsCfg2`, `VemsCfg2UploadProgressDlg`. Filtre: `VemsCfg2 files (*.vemscfg2)|*.vemscfg2`.

**Yapı** [Observed string'lerden, örnek yok]:
```
# CurrentTime: <YYYY-mm-dd HH:MM:SS>
# ConfigVersion: 2.0            ; zorunlu; yoksa "ConfigVersion not found", farklıysa "version mismatch"
# Version: <fw>
# SerialNumber: …
# CompilationTime: …
# Signature: …
# CompileOptions: …
<variable>=<hex>,<hex>,…        ; [Inferred] format string'leri "=%02x" ve "%02x," (küçük harf hex, virgül ayraçlı)
```
- Değişken adları `struct.member` biçiminde olabilir; adres/çözünürlük için firmware dizininde **`global.h` + `my_make.16x14` + `vems.map`** (avr-ld linker map) aranır (`getFileNames(global.h, my_make, vems.map)`). Hata mesajları: `invalid variable name`, `struct … not found`, `invalid value … for variable`, `different array length for`.
- `.raweeprom`: aynı indirme akışında ham EEPROM baytları; `unknown-<…>.raweeprom` [Inferred: ham ikili döküm, başlıksız].

**Unknown:** satır gramerinin tam biçimi, `vems.map` parse kuralları → `VemsCfg2Loader::parseCfgLine` (VA 0x80E69C), `parseMapFile` (0x80E3E4), `parseGlobalH` (0x80E282), `parseCfgHeader` (0x80E026).

---

## 5. `.vemsprj` — Proje dosyası (XML) ve `RecentProjects.xml`

**Sınıflar:** `ProjectManager::{LoadRecents, SaveRecents, AddProject, InsertProject, GetProjectByPath…}`, `Project::{Set, SaveConfig, SaveSettings, SetItemNodeProperties, CreateFirmwareConfigItems, AddFirmwareConfigItem…}`, `ProjectWizard`, `ProjectSettingsFrame`, `ProjectChooserFrame`. Filtre: `VemsTune project (*.vemsprj)|*.vemsprj`. Hata: `Wrong project file`.

### 5.1 Şema [Observed — 7 örnek, `xml_schema.py`]
```xml
<?xml version="1.0" encoding="UTF-8"?>              <!-- opsiyonel -->
<VemsTuneProjectFile [name="Test"]>
  <ProjectSettings>                                 <!-- opsiyonel -->
    <set name="Audi-1.1.27-16x14" firmwareversion="1.1.27"/>
  </ProjectSettings>
  <Settings>                                        <!-- opsiyonel -->
    <Param name="HIGHBOOST|12X12|CELSIUS|NARROW_BAND_EGO" value="true|false"/>
    <File type="ini" name="Ini" path="vemsTune-1.1.35.ini"/>
  </Settings>
  <ConfigFiles>
    <File type="header" name="Global header" path="my_make.16x14/global.h" parent="Base" mandatory="1"/>
    <File type="config_download" name="mcd file" path="mcd-saved.txt" [parent="Base"] active="0"/>
    <File type="config" name="Basic Config" path="audi-base-config.txt" parent="Base" active="1|0"/>
  </ConfigFiles>
  <FirmwareFiles>
    <File type="firmware" name="Hex file" path="my_make.16x14/vems.hex" mandatory="1" parent="Base"/>
    <File type="firmware_patch" name="Air NTC (2063_256)" path="matfactor/airXfactor_2063_256.air"
          active="0" filter="*.air" [checked="false"]/>
  </FirmwareFiles>
  <ConfigFiles2> … aynı File elemanları … </ConfigFiles2>   <!-- yalnız Test.vemsprj -->
</VemsTuneProjectFile>
```
- `File/@type` değerleri: `ini, header, config_download, config, firmware, firmware_patch`.
- `path` göreli (proje dizinine göre), `\` veya `/` ayraç. `active` = proje oluştururken seçili mi; `mandatory="1"` zorunlu; `parent="Base"` gruplama [Inferred].
- `Settings/Param` → oturum parametreleri; varsayılanları `v3gui.cfg` `[defaultparams]`/`[sessions/params]` (`CELSIUS, NARROW_BAND_EGO, USEAFR147`) [Observed].
- Test.vemsprj'deki `<!-- wxTextCtrlHash… -->` yorumları geliştirici notu; yok sayılmalı.

### 5.2 `config/RecentProjects.xml` [Inferred]
Dosya yok (log: `can't open file …\config\RecentProjects.xml`). String'ler: `RecentProjects.xml`, `RecentProjects`, `UTF-8`, `VemsTuneProjectFile`. Kök `<RecentProjects>` altında proje yolları — **[Unknown]**: `ProjectManager::SaveRecents/LoadRecents`.

---

## 6. `.msq` — MegaTune tune dosyası (XML)

**Sınıflar:** Yazıcı `STDataIOMSQ::{writeAllData, makeXmlStructure, makeSymbolNodes, getSymbolValue, setModel}` (menü `idMenuExportMSQ`, `MSQ export`, `MSQ file has been saved to:`). Okuyucu `FirmwareConfigLoader::{isMSQ, parseMSQ}` + `ConfigParserMSQ::{parseLine, isStartOfConstant, isEndOfConstant, parseTableData, parseAxis, convertX, convertY, getTableName}`.

### 6.1 Yazıcı çıktısı [Observed string'ler, Inferred yapı]
```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<msq xmlns="http://www.msefi.com/:msq">
  <bibliography author="VemsTune" …/>              <!-- "VemsTune" ve "%u.%u.%u" string'leri; tam öznitelikler Unknown -->
  <versionInfo … />                                 <!-- Unknown -->
  <page number="0">
    <constant name="veTable" rows="14" cols="16" units="…">  <!-- ARRAY: "\n     " girintili satırlar -->
       60 64 6B …
    </constant>
    <constant name="req_fuel" units="…">…</constant>          <!-- SCALAR -->
  </page>
</msq>
```
- Özel isim eşlemesi: `veTable/rpmBinsVE/mapBinsVE`, `lambdaTable/rpmBinsLambda/mapBinsLambda`, `sparkTable/rpmBinsSpark/mapBinsSpark`; diğer semboller `SCALAR`/`ARRAY` olarak kendi isimleriyle. Sayı formatı `%i` / `%.<n>f`.
- `offset` string'i mevcut — ya `<constant offset=…>` ya da ölçekleme [Unknown].

### 6.2 Okuyucu [Observed string'ler]
XML parser değil, **satır tabanlı**: `<constant` ile başlayan satırda `name=` alınır, `</constant>` ile biter; yalnız `veTable` tanınır → `j`, eksenler `j_r[0]`, `j_k[0]` (`ConfigParserMSQ::parseLine() parse j_r[0]:`). Boş anahtar/değer uyarıları: `Warning. Key is empty. Line: %d`.

**Unknown:** `convertX/convertY` ölçekleme, page numaralandırması → `STDataIOMSQ::makeXmlStructure` (0x7DC908), `makeSymbolNodes` (0x7DCF5A), `ConfigParserMSQ::parseLine` (0x4CA234).

---

## 7. `.vemslog` — İkili datalog (ana log formatı)

**Sınıflar:**
- Okuma: `VemsLogReader::{SetInputFile, ParseHeader, parseHeaderPriv, getHeaderValue, getHeaderHash, getNext, getNextVersion1/2/3, loadNextBlock, start, reset, GetFilePos/SetFilePos}`, `VemsLogReaderHelper`, `VEMSLogBuffer::{loadLogFromFile, addPacket, getPacket, getPacketByType, getSRAMReadPackets, checkGPSPacket, getGPSData, convertRTTime, getSTData…}`, `ThreadControllerVemslog`, `LogHistoryMgr::{loadHistoryFromLog, getLogVersion…}`, `VemsLogViewer`.
- Yazma: `SIPRFileLogger::{setFile, setHeader, writeHeader, setBlockSize, fillBuffer, Flush, process, setSaveSDCard}`, `RawLogHelper::getVemslogHeader`, `VemsTuneController::fillLogHeader`, `RTDataRawLogger` (ham varyant, §7.5), `VemsLogGenerator::{createVemsLog, logAllPages, logSiprPackets}`, `SaveLogBufferProcess`/`SaveLogBufferDialog` (bellek tamponunu kaydet), `TriggerFrameToSiprLogConverter` (SD → vemslog).
- Filtre: `Log files (*.vemslog)|*.vemslog;`.

### 7.1 Genel yerleşim (LogVersion 2) [Observed — 2 gerçek örnek, tüm CRC'ler doğrulandı]

```
Offset 0x000  : Başlık, tam 512 bayt (metin, NUL dolgulu, bayt[511] = 0x0A)
Offset 0x200  : Blok 0  (BlockSize bayt, örnekte 512)
Offset 0x400  : Blok 1
…               dosya boyu = 512 + N × BlockSize
```

### 7.2 Başlık [Observed]
```
# Vems Log Header, 512 byte\n          ; sihirli ilk satır (trigger log için: "# Vems Trigger Log Header, 512 byte")
BlockSize=512\n                        ; yazıcıda sabit "=512\n"
LogVersion=2\n                         ; "=%i\n"
CurrentTime: 2026-10-14 12:22:24\n     ; DİKKAT: ": " ayraçlı (diğerleri "=")
Creator=VemsTune 1.5.46 (2016-06-05)\n
Version=1.2.16\n
SerialNumber=v3.3_n001453\n
CompilationTime=2013-09-23 16:02\n
Signature=VEMS v1.2.16 16x14 kpa=2,2\n
CompileOptions=000000DE\n
\0 … \0                                ; 511. bayta kadar
\n                                     ; bayt 511
```
Okuyucunun bildiği ek anahtarlar (string `0xce0d6e…`): `DataLength`, `SerialNumber Raw`, `GPSDataLength`, `GPSDataFormat`, `Options` — ham varyantta (§7.5) kullanılır [Inferred]. Yazıcı uyarısı: `SIPRFileLogger::writeHeader() - header data too long!!` (>512).

### 7.3 Blok ve paket yapısı [Observed]

Her blok yalnızca **tam paketler** içerir; paket blok sınırını aşmaz. Kalan alan `0x00` ile doldurulur; **bloğun son baytı daima `0x0A`** (5+4 blokta gözlendi).

```
packet := 0x0A  b1  type  len  payload[len]  crc_lo  crc_hi
  0x0A    : senkron/başlangıç baytı
  b1      : örneklerde hep 0x00  (Unknown: kanal/yön/sıra?)
  type    : SIPR paket tipi (aşağıdaki enum)
  len     : payload uzunluğu, 1 bayt (0..255)
  payload : GET_TABLEDATA için payload[0] = tablo/sayfa kimliği, ardından veri
  crc     : CRC-16/MODBUS (poly 0xA001 yansıtılmış, init 0xFFFF), kapsam = b1..payload sonu (0x0A HARİÇ), little-endian
```
Doğrulama: `crcsearch.py` iki farklı pakette yalnız `MODBUS from offset 1 little-endian` eşleşti; `vemslog_parse.py` 25 paketin 25'inde CRC OK. Payload içinde `0x0A` kaçışsız geçebilir (ör. tablo 0x0c verisi) → çözümleyici `len` alanına güvenmeli, `0x0A` aramamalı.

Örnek dosya içeriği (ECU bağlanır bağlanmaz alınan "tüm sayfalar" anlık görüntüsü, `VemsLogGenerator::logAllPages`):

| Blok | Paketler (type, len, payload[0]) |
|---|---|
| 0 | GET_TABLEDATA 49 `0x0a`; GET_TABLEDATA 255 `0x05`; GET_TABLEDATA 81 `0x06` |
| 1 | GET_TABLEDATA 169 `0x03`; GET_CONFIG_1 255 |
| 2 | GET_TABLEDATA 240 `0x0c`; GET_TABLEDATA 225 `0x0d` |
| 3 | GET_TABLEDATA 169 `0x0b`; GET_CONFIG_2 184; GET_TABLEDATA 81 `0x0e` |
| 4 | GET_TABLEDATA 81 `0x12`, 45 `0x0f`, 17 `0x14`, 34 `0x15`, 65 `0x1e` |

Uyum kontrolü [Inferred]: tablo `0x05` veri = 254 = 14×16 + 16 + 14 → **VE tablosu + r/k eksenleri**; `0x06` veri = 80 = 8×8 + 8 + 8 → lambda tablosu.

```
00000200: 0a00 0531 0a01 0204 0810 2040 8000 180c   0A | b1=00 | type=05 | len=0x31 | tbl=0x0A | …
00000230: 0d0d 0d00 009b 820a 0005 ff05 211f 1f1e   … crc=9B 82 (LE→0x829B) | sonraki paket 0A 00 05 FF 05 …
```

### 7.4 SIPR paket tipi enum'u [Inferred — string tablosu sırası; 5/13/14 değerleri örnekle tutarlı]

| # | Ad | # | Ad | # | Ad |
|---|---|---|---|---|---|
| 0 | NACK | 17 | READ_MEMORY | 34 | CONFIG_LINE |
| 1 | ACK | 18 | WRITE_MEMORY | 35 | CONFIG_ERROR |
| 2 | GET_VERSION | 19 | READ_MEMORY_32 | 36 | CONFIG_END |
| 3 | SET_BAUD | 20 | WRITE_MEMORY_32 | 37 | TABLES_END |
| 4 | GET_TABLE_SIZE | 21 | READ_STORAGE_32 | 38 | TIMEOUT |
| 5 | **GET_TABLEDATA** | 22 | WRITE_STORAGE_32 | 39 | AIM |
| 6 | SET_TABLEDATA | 23 | PULSE_TRAIN | 40 | LOG_MARKER |
| 7 | **READ_SENSORS** (realtime) | 24 | SD_LOG_START | 41 | RT_TIME |
| 8 | GET_HWSIG | 25 | SD_LOG_STOP | 42 | UPDATE_FREQUENCY |
| 9 | ENTER_FLASH | 26 | SD_EMPTY | 43 | MDX_FRAMES_END |
| 10 | SAVE_CONFIG | 27 | SD_NOT_EMPTY | 44 | RT_CRC_ERROR |
| 11 | INVALID_DATA | 28 | SD_TIMEOUT | 45 | EEPROM_DATA |
| 12 | ENTER_MEGATUNE | 29 | SD_CRC_ERROR | 46 | EEPROM_DATA_ADDR16 |
| 13 | **GET_CONFIG_1** | 30 | SD_LOG_NEXT_BLOCK | 47 | MODBUS_READ |
| 14 | **GET_CONFIG_2** | 31 | SYNC_STARTED | 48 | RESERVED |
| 15 | GET_COMPILE_TIME | 32 | SYNC_FINISHED | 49 | INVALID |
| 16 | GET_MT_SIGNATURE | 33 | SYNC_PAGE | | |

Tablo kimlik adları (`SIPR_TABLE_*`: RPM, KPA, IGN, LAMBDA, EGOC, VE, H, BOOST_DC, BOOST_TPS, TEMPERATURE, MAPCORR, ALT_KNOCK, A340E, MAT_TPS_RETARD, VVTI, CONFIG1, CONFIG1_EXT, CONFIG2, LAUNCH_RPM, CONFIG_SHARED, CONFIG_EEPROM) mevcut, ancak gözlenen kimlikler (0x03…0x1e) bu listenin sırasıyla birebir örtüşmüyor → eşleme [Unknown] (`SIPRDescriptor`, INI `[SIPR]` bölümü).

Realtime kayıtları [Inferred]: canlı loglamada `READ_SENSORS` (7) paketleri; zaman damgası `RT_TIME` (41), kullanıcı işaretleri `LOG_MARKER` (40), GPS (`VEMSLogBuffer::checkGPSPacket`), EEPROM (45/46), Modbus (47) paketleri aynı çerçeveyle eklenir. Realtime payload yerleşimi INI `[OutputChannels]` ile çözülür (kapsam dışı). **Örnek dosyada realtime paket yok.**

> **Not:** Yukarıdaki enum sırası string tablosundan tahmindi. Gerçek kodlar `SiprTypesHelper::getTypeAsString` ile doğrulandı (`packages/core/src/sipr/types.ts`): `LOG_MARKER = 0x92`, `RT_TIME = 0x93`.

### 7.4a Yazıcı ayrıntıları [Observed‑dec, 2026‑11‑01; `@vems/core` `log/writer.ts`, iki gerçek örnek bayt‑bayt yeniden üretildi]
- **Tablo kimliği (GET_TABLEDATA payload[0])** = `SIPRDescriptor::getTableType` @0xbb7c8e: RPM 1, KPA 2, IGN 3, EGOC 4, VE 5, LAMBDA 6, CONFIG1 7, CONFIG2 8, H 0x0a, BOOST_DC 0x0b, BOOST_TPS 0x0c, TEMPERATURE 0x0d, MAPCORR 0x0e, ALT_KNOCK 0x0f, A340E 0x10, VVTI 0x11, MAT_TPS_RETARD 0x12, CONFIG1_EXT 0x13, LAUNCH_RPM 0x14, CONFIG_SHARED 0x15, CONFIG_EEPROM 0x1e.
- **Sayfa paketleri** (`SIPRPacketFactory::create` @0xbb9e70): `SIPR_GET_TABLEDATA` sayfası → `[SIPR] page` tablo listesindeki her tablo için bir paket, payload = `[id] + sayfa[offset..offset+size]` (`sipr_table`). `SIPR_GET_CONFIG_1/2` → tip 0x0d/0x0e, payload = `sayfa[0..sipr_config size]`. Sıra = `[SIPR]` sayfa sırası (1…16, 30). Örnek dosyalar `sipr-1.2.15.ini` + `USE_RAW_LAMBDA_TABLE` + `KNOCK_ALTERNATIVE` ile birebir.
- **SIPRFileLogger::process** @0xbb8e28: sayfa tipleri (5/13/14) önbelleğe alınır, ilk yazımda başlıktan hemen sonra dökülür. Paket `cur + size <= BlockSize` ise bloğa eklenir, değilse önce `Flush` (blok yaz → `fillBuffer`: sıfırla, son bayt 0x0A). Başlık da tek bir blok olarak yazılır.
- **READ_SENSORS** (`RealtimeHandler::sendRtPacket` @0x81265e, `SIPRPacket(h,h,i,h,IntArray)` @0xbb9680): veri = TF realtime gövdesi (tip baytı hariç). Çerçeve `0A 00 07 (n+3) 00 00 01 data[n] crcLo crcHi`, CRC kapsamı seq..data. Okurken realtime bloğu = `payload[3..]`.
- **RT_TIME**: her realtime çerçevesinden ÖNCE gelir. Payload 4 bayt **big‑endian** (`Math::getBytes` @0xbf9346): realtime handler başlangıcından bu yana geçen ms.
- **LOG_MARKER** (`MainFrame::OnVemsLogAddMarker` @0x6ab0c4): seq 0, payload boş.
- **CompileOptions** başlık satırı yalnız `FirmwareInfo` compile options boş değilse yazılır. TF yolunda (`TriggerFrameFirmwareInfoFetcher::OnFirmwareInfoHandler` @0xbbe966) yalnız `setFirmwareOptions` çağrılır, `setFirmwareCompileOptions` çağrılmaz. Bu yüzden TF firmware loglarında bu satır yoktur. Örneklerdeki `000000DE` MegaTune/eski yoldan gelir.

### 7.5 Sürüm farkları

| LogVersion | Okuyucu | Durum |
|---|---|---|
| 1 | `VemsLogReader::getNextVersion1` (0xBDBED6, en büyük gövde) | [Unknown] — muhtemelen bloksuz/sabit kayıt; `RTDataRawLogger` başlığı (`BlockSize`, `DataLength`, `GPSDataLength`, `GPSDataFormat`) ile ilişkili ham format [Inferred]. `RTDataRawLogger::{fillHeader, AddHeaderItem, captureEcuBlock, getRecordSize, getRecordCountInBlock, calcMaxRTDataCount, WriteGPSData}` blok başına N sabit boyutlu RT kaydı + GPS verisi düşündürür. `Raw2HighConverterDialog` ham logu "yüksek" (çözülmüş) loga çevirir. |
| 2 | `getNextVersion2` (0xBDBB2C) | [Observed] §7.3. Hata: `VemsLogReader::getNextVersion2() CRC_ER m_blockIdx:%i` → paket CRC hatasında blok indeksi raporlanır. |
| 3 | `getNextVersion3` (0xBDBB12, çok kısa gövde: 0x1A bayt) | [Inferred] v2'ye yönlendiren ince sarmalayıcı veya tek-satırlık varyant. [Unknown] |

### 7.6 İlgili tercihler [Observed `preferences.xml`]
`vemslogpreferences`: 0=yalnız "ECU Log" ikonu açıkken kaydet, 1=tüm tamponu kaydet (varsayılan), 2=son kaydedilen indeksten itibaren. `v3gui.cfg`: `autoRawLog=0|1`, `SerialBufferSize` (ring buffer), `[environment] logdir=logs`, `/environment/logComment`.

---

## 8. Eski VemsLogger `.xls` ve MegaTune `.csv` datalogları

`VemsLogger.exe` (MFC, "VEMSLogger 1.29") [Observed string'ler]: `VEMS Datalogs (*.xls)`, `MegaTune Datalogs (*.csv)`, ayar dosyası `VEMSLoggerSettings.cfg`. `.xls` gerçek Excel değil, **TAB ayraçlı metin** (`%.2f\t`, `%.3f\t`, `%.1f\t`). İlk satır imza `VEMS v1.1 12x12 kpa=2,2\n` [Inferred: MegaTune "signature" satırı], ardından başlık:
```
Time\tSecL\tRPM\tMAP\tTP\tlambda\tMAT\tCLT\tEngine\tGego\tGair\tGwarm\tGbaro\tGammae\tTPSacc\tGve\tPW\tIacDC\tDutyCycle1\tUserData2\tSpark\tDwell\tEGT #1\tEGT #2\tVbatt\tExhaust Pressure\tFuel Pressure\tMisc 1\tMisc 2\tMisc 3\tMisc 4\tKnock Diff\tKnock Adjust\tStatusBits
```
VemsTune bu `.xls`'leri yalnız "mixturelog" dizini olarak (`Please choose the mixturelog directory (*.xls)`) ve yarış analizi için `.csv` racelog'ları (`racelog directory (*.csv)`, `races.csv`) okur — `RaceLogAnalyser`. Ayrıntı [Unknown]: `RaceLogAnalyser::analyzeRaces`.

---

## 9. Metin/tablo dışa aktarımları (CSV, JSON)

### 9.1 vemslog → "csv" dönüştürücü [Inferred]
Menü: `&VemsLog to csv Converter`, `&Convert last vemslog to csv`, `&Convert all vemslog to csv` (`Raw2HighConverterDialog`: `Ini File`, `Input File(s)`, `Concatenate input files`, `Output extension and path`). Yazıcı `RTDataLogWriter::{writeHeaders, writeLogWithoutInterpolate, setRTDataPerBlock, calculateTimeMilli, calcualteGPSCaptureLine}`. Wide string kümesi: `#VemsTune\n`, `\t`, `\n`, `.`, `time`, `secl`, `gpsCaptureLine`, `distanceSum` → **TAB ayraçlı**, ilk satır `#VemsTune`, ardından sütun başlıkları (`time`, `secl`, INI realtime sembolleri, GPS sütunları) — MegaLogViewer uyumlu (`ExtLogViewer=…MegaLogViewer.exe`). Ayrıca `RTDataCSVWriter` (`\t`, `\n`; "Play from .csv &file" ile geri oynatma `CSVConfig`). Uzantı `.csv` (`i*.csv`). Sütun sırası/birimler [Unknown] → `RTDataLogWriter::writeHeaders` (0x71A220), `RTDataCSVWriter::writeHeaders` (0x718D3E).

### 9.2 İstatistik/VE analiz dışa aktarımı (JSON benzeri) [Observed string'ler]
`RTDataStatExporterBase/RTDataStatVEExporter/RTDataStatIgnExporter::writeToFile`: `{\n`, `" : "`, `" : %d`, `" : %.2f`, `" : [ `, ` ]`, `date_`, `type`, `logname`, `expression`, `filter`, `lambdadelay`, `variance_multiplier`, `filterinfo` → anahtar/değer JSON nesnesi. Kesin şema [Unknown].

### 9.3 Tablo/grid CSV [Observed]
`Right-click on grid: save to csv`, `Save table to CSV`, `TableEditor/SuperTable::exportToFile`, `Export gauges to file`. Ayraç `std_separator`/`cellseparator` ayarlı [Inferred].

---

## 10. `.triggerlog` ve türevleri

**Sınıflar:** `TriggerLogManager::writeToLogFile`, `TriggerLog::{unescape, getHeaderInfo, fillTriggerData, fillTRDataArray, getTimelines…}`, `TriggerLogImg::parseHeader`, `TriggerLogReader` (seri akış), `TriggerLogResults`, `TriggerLogSaveAudio::{writeHeader, saveToWaw, saveToRaw}`.

**Dosya** [Observed string'ler + decompile; gerçek örnek yok, emülatör akışıyla doğrulandı]:
```
0x000: "# Vems Trigger Log Header, 512 byte\n" + key=value satırları (Version, CurrentTime, SerialNumber …) + NUL dolgu → 512 bayt
0x200: ham trigger akışı (ECU'dan gelen bayt dizisi; kaçış dizili → TriggerLog::unescape)
```
- Başlık yoksa: `no valid header found, use log as raw byte stream` → dosya baştan ham akış olarak okunur (geriye uyumluluk).
- Olay kodları ve renkleri `graphcolors.xml` `<event id=1..62>` (Primary trigger, Secondary trigger, Spark Event, TOOTH CNT = 0, TOO MANY PTRIG …) [Observed].
- Akış [Observed, decompile]: TF çerçeveleri (0x7E ayraç, 0x7D kaçış, CRC16/MODBUS LE), gövdeler PROTOCOL §7.4.3. Zaman 16-bit BE, 4 µs.
  - `convertFrame2Time`: birincil damga son değerden küçükse taban += 0x10000. Olay damgası için eşik "son − 250 tick".
  - Birincil zamanlar olay 1'e, olaylar kendi tip numarasına gider (graphcolors id = çerçeve tipi). 0x40–0x4E çerçevelerinde 1 veri baytı da var.
  - `addFrame` sonuç kodları: 0x101 bilinmeyen tip, 0x102 kısa, 0x103 CRC, 0x104 boş. 0x100'ün altındakiler zaman çizgisine girer.
    VemsTune 0x20'yi (realtime) de ekler ve sahte bir olay üretir; bizde atlanıyor.
- Başlık: `RawLogHelper::getVemslogHeader(fw, 2)` (= trigger varyantı, 512 B NUL dolgulu) — `TriggerLogManager::writeToLogFile`. Akış ECU'dan geldiği gibi (ham) yazılır.
- Sonuç tablosu (`TriggerLogResults::buildGUI`) [Observed]:
  - Birincil ve ikincil zamanlar sırayla birleştirilir.
  - Birincil satırı: diff = t − önceki birincil; oran = diff / önceki diff (önceki diff ≤ 0 ise 1.0).
  - **oran > 1.5** ise `MISSING TOOTH: floor(oran+0.5)−1, cycle=<son boşluktan beri birincil sayısı>`.
  - VemsTune hatası: son ikincilden sonraki birincillerin satırları boş kalır. Bizde bu satırlar dolduruluyor.
- Kod: `packages/core/src/log/triggerlog.ts` (`parseTriggerLog`, `appendTriggerStream`, `triggerLogResults`, `triggerLogCsv`, `writeTriggerLog`, `parseGraphColors`, `encodeTriggerFrame`).

**CSV dışa aktarımı** [Observed]:
```
; This is a csv-formatted version of a vems trigger log file
; Created on: <ts> - Serial number: <sn> - Firmware version: <fw>
id,Primary Time (ms),Primary Diff (ms),Primary Diff Ratio,Secondary Time (ms),Secondary Diff (ms),Comment
<id>,<%.3f>,…,"MISSING TOOTH: %d, cycle=%d"
```
**Ses dışa aktarımı:** `WAV files (*.wav)|RAW audio (*.raw)`, örnekleme `[audio] sampleRate=44100` — tetik zamanlarından sinüs üretimi (`createSinusoid`) [Inferred].

---

## 11. SD kart logları (ham imaj, dd, dönüştürme)

**Sınıflar:** `SDCardDialog`, `SDCardSaveDialog` (ham imaj), `SDImageHandler`, `SDCardFile::{isVEMSFilesystem, getInodeVersion, checkSectorIsEmpty, isCRCValid, isDataValid, parseTriggerFrame, getFwVersion, getFWVersion_New, CalcLogTimeLength}`, `SDCardFileSearch::getInode`, `SDCardFileDownloader::readSector`, `SDCardFileSummary`, `SDCardV3Logger`, `SDCardControllerTF/ManMode`, `SDCardSavedLogManager::{createHash, getSavedIds, saveFile, checkDB}`, `TriggerFrameToSiprLogConverter`.

### 11.1 Ham imaj (`.raw`) [Observed komutlar]
`3rdparty\dd.exe` = chrysocome "rawwrite dd for windows 0.6beta1", **VEMS'e özel `--stoponempty` / `--emptyseek=BLOCKS` seçenekli** sürüm.
```
probe : dd if=<\\?\Device\…> of=- bs=512 count=1               ; blok 0 → isVEMSFilesystem
list  : dd --list                                               ; "Removable devices", "Mounted on:"
save  : dd if=<dev> of="<YYYYMMDD_HHMMSS>.raw" bs=32768 --progress --stoponempty emptyseek=4
```
Dosya adı formatı `%d%02d%02d_%02d%02d%02d.raw`. `.raw` = kartın birebir sektör imajı (VEMS özel dosya sistemi, "inode" kavramlı). Mesajlar: `does not contain VEMS log`, `None of the available devices contains valid VEMS log`.

### 11.2 Kart içi yapı [Inferred/Unknown]
- Sektör/blok CRC16: `SDCard block invalid CRC, calculated=%04x, received=%04x`; `Too much CRC error for a block`.
- Log verisi **TriggerFrame** paketleri olarak saklanır (`SDCardFile::parseTriggerFrame`, `TriggerFrameToSiprLogConverter::{processRealtimePacket, processPagePacket, processPagesInfoPacket, processEcuDetailsPacket, processGpsPacket}`) ve `.vemslog` (SIPR çerçeveli, §7) dosyasına `-SDCard.vemslog` son ekiyle dönüştürülür.
- Özet alanları (`SDCardFileSummary`/GUI): `samples, maxrpm, maxmap, avgrpm, avgmap, alson, launchon, hasvalidGPS, gpsdatetime`, FW `%d.%d.%02d (%d)`, `Serial #`.
- Inode biçimi, sürüm alanı, CRC polinomu, blok boyu **[Unknown]** → `SDCardFile::isVEMSFilesystem` (0x77BDFE), `getInodeVersion` (0x77BF95), `isCRCValid` (0x77BBCD), `isDataValid` (0x77BC48), `parseTriggerFrame` (0x77BFA2), `SDCardFileSearch::getInode`.

### 11.3 `sdcardlogs.db` [Observed string'ler]
```sql
-- tablo adı: savedlogs ; sütunlar: card_hash (BLOB), file_id INTEGER
CREATE UNIQUE INDEX IF NOT EXISTS tindex ON savedlogs(card_hash,file_id);
INSERT OR IGNORE INTO savedlogs(card_hash,file_id) VALUES ( x'<hex>', %d);
SELECT file_id FROM savedlogs WHERE card_hash = x'<hex>'
```
Amaç: aynı karttan daha önce indirilmiş logları işaretlemek. Hash algoritması [Unknown] → `SDCardSavedLogManager::createHash` (0x781380).

---

## 12. GPS dışa aktarımı: GPX ve KML [Observed — tam şablonlar binary'de]

Menü: `Export to GPX format`, `Export to KML format`, `Export GPS data to XML format`.

**GPX 1.0:**
```xml
<?xml version="1.0"?>
<gpx creator="VemsTune" version="1.0" xmlns="http://www.topografix.com/GPX/1/0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/0 http://www.topografix.com/GPX/1/0/gpx.xsd">
<trk>
  <name>{isim}</name>
  <trkseg>
    <trkpt lat ="%f" lon="%f">          <!-- dikkat: "lat =" boşluklu, birebir -->
      <ele>%.1f</ele>
    </trkpt>
  </trkseg>
</trk>
</gpx>
```
**KML 2.2:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>…</name>
    <description>…</description>
    <Style id="e_linestyle">
      <LineStyle><color>7f00ffff</color><width>4</width></LineStyle>
      <PolyStyle><color>7f00ff00</color></PolyStyle>
    </Style>
    <Placemark>
      <name>…</name><description>…</description>
      <styleUrl>#e_linestyle</styleUrl>
      <LineString>
        <extrude>1</extrude><tessellate>1</tessellate><altitudeMode>absolute</altitudeMode>
        <coordinates>
%f,%f,%.1f            <!-- lon,lat,alt; satır başında "          " girinti -->
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
```
Ayrıca **KML okuma** (Google Directions `output=kml`: `kml/Document/Placemark/GeometryCollection/LineString/coordinates`) ve MapQuest XML (`response/route/legs/leg/maneuvers/maneuver/startPoint/lat,lng`) rota sorguları [Observed]. Kaynak noktalar ve örnekleme aralığı [Unknown] (`SIPR2GPSConverter`, `LogHistoryMgr::runGPSData`).

---

## 13. Firmware imajları (`.hex .uhex .chex .chex2 .vhex .shex .phex .lhex`)

**Sınıflar:** `IHexParser::{parseLine, detectType, fillFirmwareData, getPageIdx, isLineChecksumError, hex2bin}`, `IntelHex` (eski), `FirmwareData::{getPages, getPageSize, getPageAddress, getPageCheckSum, checkPageCheckSum, setPageData, addPatch, setV3MarkerWord, crypto, setRinsingSeq, setTargetType, writeToIhex, getTypeAsString}`, `FirmwareUploader`, `FirmwareVerifier`, `FirmwarePatchVerifier`, `FirmwareDirector::{uploadFirmware, uploadFirmwarePatch, generateSessionKey, connectVhexUploadEventHandlers…}`, `FirmwareWebUpdater`, `BootloaderWebUpdater`, `BootLoaderUpgradeClient`, `ECUInfo::getBootTypeAsString`.

### 13.1 Bootloader türleri ↔ uzantılar [Observed enum, Inferred anlam]

`BOOT_VHEX, BOOT_HEX, BOOT_CHEX, BOOT_CHEX2, BOOT_UHEX, BOOT_SHEX, BOOT_LHEX, BOOT_UNKNOWN, BOOT_INVALID`; `FirmwareData::getTypeAsString`: `Intel HEX`, `Crypto CHEX`, `Unknown`. Seçim diyaloğu: `Bootloader files (*.shex;*.lhex;*.uhex;*.vhex;*.hex;*.phex)`. Varsayılan dosya adları: `vems.uhex`, `vems.shex`, `vems.hex`, `round.chex2`, `round.chex`.

| Uzantı | Hedef | Kodlama | Kanıt düzeyi |
|---|---|---|---|
| `.hex` | V3 Genboard (AVR ATmega128), eski/açık bootloader | Düz Intel HEX | Observed (örnek) |
| `.uhex` | V3, **"universal bootloader"** (`You have universal bootloader`) | Şifreli `C:` hex, 256 B sayfa | Observed (örnek) |
| `.chex` | VEMS Round (WBO2 gösterge, küçük AVR) | Şifreli `C:` hex ("Crypto CHEX"), 128 B sayfa | Observed (örnek: marker) |
| `.chex2` | Round, yeni bootloader ("Old chex2" ayrımı) | Şifreli `C:` hex, 128 B sayfa | Observed (örnek: marker) |
| `.shex` | V3, `vems.shex` — "secure/session" bootloader [Inferred] | Muhtemelen `C:` + oturum anahtarı | Inferred |
| `.vhex` | Ayrı yükleme yolu (`connectVhexUploadEventHandlers`) — bootloader yükseltme imajı [Inferred] | Unknown | Inferred |
| `.lhex` | `BOOT_LHEX` — muhtemelen ARM/"large" hedef [Inferred] | Unknown | Inferred |
| `.phex` | "patched hex": yamalar uygulanmış imajın yazımı (`/tmp/verification.phex`, `FirmwareData::writeToIhex`) [Inferred] | Düz Intel HEX | Inferred |

### 13.2 Düz Intel HEX (`.hex`) [Observed — `ihex_stats.py`]
- Standart `:LLAAAATT<data>CC`, CRLF, 16 bayt/satır; kayıt tipleri 00, 01 (EOF), **02 (Extended Segment Address, `1000` → 0x10000)**, 03 (Start Segment, `00000400`). Tüm checksum'lar geçerli.
- `IHexParser` uyarıları: `hexfile line neglected (type2)(checksum error)`, `hexfile line neglected (type=%02x)` → 00/01/02 dışındaki tipler yok sayılır [Inferred].
- Adres aralıkları (V3):

| Dosya | Aralıklar |
|---|---|
| `firmware_1.1.27/vems.hex` | `000000-00008B`, `000100-01BFB7` (114500 B) |
| `firmware_1.1.94/vems.hex` | `000000-00008B`, `000100-0180FB`, `01F500-01F56D`, `01F7FE-01F7FF` |
| `firmware_1.1.94_BootUpdate/vems.hex` | + `01F600-01F6FF` |

- `0x0000-0x008B` AVR kesme vektörleri (`0C 94 …` = `jmp`), `0x0100-0x03FF` bölgesi kalibrasyon yamalarıyla örtüşür (§14).
- **Marker word**: `0x1F7FE-0x1F7FF = 5A A5` → sayfa **503** (`0x1F700`, 256 B) son kelimesi (`FirmwareData::setV3MarkerWord() at page 503 !!!`) — uygulamanın geçerli olduğunu bootloader'a bildirir [Inferred]. Uygulama alanı sayfa 0..503 (0x00000-0x1F7FF), üstü bootloader.

### 13.3 Şifreli `C:` hex (`.uhex/.chex/.chex2/.uair/.uclt`) [Observed — `chex_stats.py`]

```
line := 'C:' HEXRECORD [ ':' TAG32 ] CRLF
HEXRECORD := Intel-HEX kaydı (LL AAAA TT DATA CC) — checksum ŞİFRELİ veri üzerinden geçerli
TAG32     := 8 hex hane; YALNIZ her sayfanın ilk kaydında
```
- `.uhex` (1.1.94): 387 sayfa × 256 B = `0x00000-0x1F7FF` tamamı sayfa-hizalı; her sayfa başında TAG; tek tip-02 kaydı (`C:020000021000EC`, düz). Entropi 7.998 bit/bayt (şifreli).
- **Deterministik şifreleme**: `markerword_erase.uhex` (sayfa 0x1F700) ile `vems.uhex`'in son sayfası, son birkaç bayt dışında **birebir aynı şifreli metin** → IV/rasgelelik yok, adres-bağımlı akış/ECB benzeri [Inferred]. Ardışık sayfa TAG'leri çok benzer (`4359870E`/`4359878E`) → TAG muhtemelen sayfa adresi/CRC türevli [Inferred].
- `.chex`: 128 B sayfa, marker sayfası `0x3780`; `.chex2`: `0x3B80` → Round'da 16 KB flash, farklı bootloader boyutu [Inferred].
- Sunucu tarafı şifreleme: firmware `http://vems.hu/vt…`/`/v3update/fwupdate.php?cmd=gethex|list` ve `bootloaderupgrade.php`'den, ECU'nun **oturum anahtarına** göre şifrelenmiş halde indirilir (`generateSessionKey`, `session_id`, `getSessionString`, sonuç kodları `FWU_CRYPTING_FAIL`, `BLU_CRYPT_FAILED`, `BLU_ECU_NOT_LOCKED`, `FWU_CANT_OPEN_ZIP` …). Bu yüzden yerel `.uhex` dosyaları yalnız aynı anahtar ailesindeki bootloader'lara uygulanabilir. **Şifre çözülmeye çalışılmadı** (görev kuralı).

### 13.4 Marker silme imajları [Observed]
`config/fw/markerword_erase.{uhex,chex,chex2}`: yalnız marker sayfasını içeren tek-sayfalık şifreli imaj (V3: `0x1F700`, Round: `0x3780`/`0x3B80`). Amaç: uygulamayı geçersiz kılıp bootloader'da kalmak (`Marker file:`, `uhex bootloader only!`, `BootType isn't ECUInfo::BOOT_UHEX !`).

### 13.5 Doğrulama/yükleme yardımcıları [Inferred]
Sayfa başına checksum karşılaştırması (`FirmwareVerifier::sendGetChecksumCmd/waitChecksum`, `FirmwareData::getPageCheckSum`). `setRinsingSeq` ve `crypto` yerel şifreleme/karıştırma dizisi olabilir [Unknown].

### 13.6 Bilinmeyenler
`IHexParser::detectType` (0x4CBD44) — uzantı mı içerik mi; `FirmwareData::crypto` (0xA0A5EC), `getPageCheckSum` (0xA09F2E), `setRinsingSeq` (0xE93B6C), `addPatch` (0xA0A056), `writeToIhex` (0xA0A1F8); `.shex/.vhex/.lhex` gerçek düzenleri (örnek yok).

### 13.7 `webcache/fw/` [Observed boş]
İndirilen firmware paketleri (zip) önbelleği [Inferred].

---

## 14. Termistör kalibrasyon yamaları (`matfactor/`, `coolantfactor/`)

**Üretici:** dosya başlığındaki `# automatically generated by propertherm, type=airden|clt [Celsius]` → VEMS dışı **"propertherm"** betiği (EasyTherm wiki). VemsTune bunları üretmez, yalnız **firmware yaması** olarak flash sayfalarına uygular (`FirmwareData::addPatch`, `FirmwarePatchVerifier`, `Air patch files (*.air)`, `Coolant patch files (*.clt)`, `FWU_AIR_PATCH_FAILED`, `FWU_CLT_PATCH_FAILED`).

### 14.1 Dosya yapısı [Observed]
```
# automatically generated by propertherm, type=airden Celsius
# matfactor is also included# modelparam = 12000 Ohm  256 aref
# 2252 Ohm in modelparam means that … (açıklama)
:100100005D5D…        ; düz Intel HEX, yalnız tip-00, 16 B/satır, EOF kaydı YOK
```
- Adı: `airXfactor_<R25 Ohm>_<aref>[_Celsius].air`, `airXfactorptc_aref<aref>_<param>[_Celsius].air`, `cltfactor_<R>_<aref>[_Celsius].clt`. `aref` ∈ {256,263,266,275,287…} ADC referans ölçeği.
- Satır sonu: bazı dosyalarda LF, bazılarında CRLF → okuyucu ikisini de kabul etmeli.

| Dosya | Flash adresi | İçerik |
|---|---|---|
| `.air` | `0x0100-0x01FF` (sayfa 1) | **matfactor**: hava yoğunluk düzeltmesi, ADC(0..255) indeksli |
| `.air` | `0x0200-0x02FF` (sayfa 2) | **MAT sıcaklık tablosu**, ADC indeksli |
| `.clt` | `0x0300-0x03FF` (sayfa 3) | **CLT sıcaklık tablosu**, ADC indeksli |

### 14.2 Değer kodlaması [Observed — `airXfactors.csv` ile sayısal uyum]
- Sıcaklık sayfaları: eski (Celsius eki yok) **T[°F] = v − 40**; `_Celsius` **T[°C] = v − 100**. Doğrulama (`ptc_aref260_425`): CSV −4.8 °C → C:95 (−5 ✓), F:63 (23 °F ≈ −5 °C ✓); 79.0 °C → C:179 ✓, F:214 (174 °F ✓). 255/254 doyum.
- `airXfactor_2063_256.air` sayfa 2 ≡ `cltfactor_2063_256.clt` sayfa 3 (aynı termistör eğrisi).
- matfactor: v ≈ 100·(273+T₀)/(273+T), T₀≈21 °C (34 °C→95, −5 °C→109 ✓), alt/üst kırpma (125/93) [Inferred].
- Celsius/Fahrenheit seçimi proje parametresi `CELSIUS` ile ilişkili; firmware `TC`/`cltfactor_*_Celsius` string'leri [Observed].

### 14.3 `.uair`, `.uclt` [Observed]
Aynı içeriğin `.uhex` bootloader için şifreli `C:` biçimi (§13.3): `.uair` 2 sayfa (0x100, 0x200), `.uclt` 1 sayfa (0x300), her sayfa başında TAG. Dosya seçimi regex'leri: `.*\.clt|.*\.uclt`, `.*\.air|.*\.uair`, `.*\.hex|.*\.uhex`.

### 14.4 `matfactor/airXfactors.csv` [Observed]
Yardımcı tablo: açıklama metni + `file \ ADC ;0 , ;1 , …` başlığı + her `.hex` (eski adlandırma) için `;` ayraçlı 255 sıcaklık (°C, `-39.9` taban). Uygulama tarafından okunduğuna dair kanıt yok [Inferred: yalnız kullanıcı belgesi].

---

## 15. `config/WBlambda100MOT.inc` [Observed]

TechEdge WBO2 SVOUT→lambda tablosu, assembler `DW` sözdizimi:
```
; yorum
	DW	<lambda×100>	;	<ADC 0..255>	<VOUT volt>
```
256 satır (`DW 60` … `DW 2070`). INI ifadesi `table(egoADC, "WBlambda100MOT.inc") / 100.0` ile kullanılır (INI dili kapsam dışı). Okuyucu: `.inc` satırlarından yalnız ilk sayı (DW değeri) sırayla alınır [Inferred]; `;` sonrası yorum.

---

## 16. SQLite veri depoları

Motor: `sqlite3.dll` + `wxcode_msw28u_wxsqlite3.dll`; yardımcı `wxSqliteHelper::DatabaseCheck`. Tümünde `user_version=0`. Tam şema dökümü: `re/evidence/formats/sqlite/schema_*.sql`, gruplar `schema_groups.txt`, örnek satırlar `summary.txt`. 109 dosya, 32 farklı şema.

### 16.1 Cihaz başına GUI depoları (önek: yok=V3, `Round-`, `aim-`, `modbus-`)
Hangi dosyanın kullanılacağı `v3gui.cfg` `[devices/<dev>]` anahtarlarıyla belirlenir (§19.1).

| Dosya kalıbı | Tablolar (sütunlar) | Amaç |
|---|---|---|
| `GaugeDescriptors.db` | `descriptors(id, name UNIQUE, type, unit, numformat, Lo, Hi, MajorDiv, MinorDiv, scale, StartAngle, EndAngle, VD, LD, TitleAngle, TitlePos, UnitAngle, UnitPos, ValueAngle, ValuePos, UnitTextHeight, TitleTextHeight, ValueTextHeight, TickTextRadius, TickTextHeight, CustomSymbolTitle, TitleTextHeightDigi DEFAULT 0.125)`; `colored_areas(id, min, max, colorname∈{danger,warning,normal}, desc_id→descriptors.id)`; `symbols(id, name UNIQUE, type, title, group_id)`; `symbolgroups(id, title)` | Gauge görünüm tanımı; `symbols.type = descriptors.type` ile realtime sembol → tanım bağlantısı. V3: 102 desc, 204 sembol, 16 grup. |
| `gauges-<W>x<H>.db` | `gauges(id, type, name, x, y, width, height, descriptor, theme, group_id)` | Ekran çözünürlüğüne göre yerleşim (regex `gauges\-([0-9]{2,})x([0-9]{2,})\.db`). `type` ∈ {VemsGauge, Digital, Text, Graph, MultiGraph, Differ, ArcBar, ColumnsGauge, Compass, Curve, CustomValue, ExpressionGrid, Flag, GPS route, SuperTable, SuperTable3D, table, horizontal, ''}. |
| `gaugegroups.db` | `groups(id, name, hotkey, sticked, theme, show_on_startup, floated, settofocus_gaugeid, show_on_startup_online, show_on_startup_offline_cfg, short_name, dont_use_mincorner)`; `multigauge(id, gauge_id, type, name)`; `backgrounds(id, group_id, filename, position, align, enabled, color)` | Gauge grupları (sekme/pencere), arka plan resimleri. `aim-` sürümünde `backgrounds` ve `dont_use_mincorner` yok (eski şema → migration gerekli). |
| `GUILayoutDesc.db` (`V3-GUILayoutDesc.db`) | `toolbars(id, name, isHorizontal, FlagSize, IconWidth, IconHeight)`; `items(id, type∈{Icon,Flag,Control,None}, name, param1, size, toolbar_id)` | Araç çubukları. |
| `VemsFlagDesc.db` | `flags(id, name, autosize, title, group_id, help_file)`; `groups(id, title)`; `states(id, flag_id, value, text, fgcolor, bgcolor, img, fgcolor2, bgcolor2, img2, flash_time_ms)` | Bit bayraklarının durum metin/renkleri. V3: 53 flag, 132 state. |
| `MultiGraphDesc.db` | `profiles(id, title)`; `nodes(id, title, profile_id, ordernum, flagdisplayratio)`; `symbols(id, name, color, type, limit_min, limit_max, overlimitcolor, customtitle, node_id, ordernum, value_min, value_max, gaugedesc_id, scale)` | Çok kanallı log grafiği profilleri. |
| `MultiGraphDesc_default.db` | Aynı, **`gaugedesc_id`, `scale` yok** | "Varsayılana dön" kaynağı. |
| `ColsGaugeDesc.db`, `DiffGaugeDesc.db` | `profiles(id, name, min_value, max_value)`; `symbols(id, profile_id, symbol_name, color, custom_symbol_title)` | Sütun ve fark gauge profilleri. Not: `DiffGaugeDesc.db`'de `symbol_name TINYINT` (diğerlerinde VARCHAR) — SQLite tip esnekliği sayesinde metin tutuyor. |

### 16.2 Paylaşılan (cihazdan bağımsız) depolar [Observed]

| Dosya | Şema | Amaç / içerik |
|---|---|---|
| `GaugesSettings.db` | `Graph(gauge_id UNIQUE, maxval, ticks, value, minval, HistoryLengthBase, MakerValue, ShowLinesValues, ShowMarker, ShowLines, unit, title)`; `MultiGraph(gauge_id UNIQUE, showstaticmarker, resolution, showusermarker, showtoolbar, magnifyratio, scrollbarpos, cursoridx, refreshgauges)`; `table3D(gauge_id UNIQUE, RotationX, ShowAxes, CameraEyey, RotationY, ZoomLevel, CameraEyeX)` | Gauge örneği başına kalıcı ayarlar (`gauge_id` = `gauges.id`). |
| `MultiGraphTheme.db` | `profiles(id,title)`; `properties(id,name,title)`; `tvalues(prop_id, profile_id, tvalue)` | 38 tema özelliği (`MultiGraphDesc.cfg` anahtarlarıyla aynı). |
| `expressiondb.db` | `expressions(coloring_type, expression_name NOT NULL, expression, isexpression, used_by)`; `expression_colors(coloring_type, value, color 6-hex RGB)` | VE/ateşleme analizörü ifade/filtreleri. `used_by` = `|ve|spark|boost|` biçiminde etiket listesi. |
| `calcmodel.db` | `calc_symbols(symbol_name UNIQUE, diff_limit_min, diff_limit_max)` | Hesaplanan sembollerin fark sınırları. |
| `customvaluegauge.db` | `customvalues(id PK, title, gaugetext)` | printf benzeri özel değer: `"%02d:%02d:%02d",gpsTimeH,gpsTimeM,gpsTimeS`. |
| `outputchannels.s3db` | `output_types(types_id, current, connector_type, name, title, type)`; `output_channels(type_id, channel_id, pin)`; `ignitionmap(dual, h2x, type_id, channel_id)`; `injgrouppins(bit, pin)`; `symbols(id, name UNIQUE, fullname, s_order, dualsymbol)` | V3 çıkış kanalı ↔ konnektör pin eşlemesi (Injector/SPECFET/I259/S259/P259/Aim out). |
| `aimdsettings.db` | `aimchannels(channelid UNIQUE, channelname, a, b, conversion, dottop, dotbottom)`; `aimdotposition(value, isbottom, title, numformat)`; `aimmodes(id, name, isbottom, iscustom, isaim, isfixedvar)` | AIM dash protokol kanalları (y=a·x+b). |
| `dialogLayout.db` | `layout(name UNIQUE, xpos, ypos, width, height, maximized)` | Diyalog konum hafızası. |
| `filedlgsettings.db` | `columns(id, name, visible, c_order, colwidth, columnwidth)`; `defaultsort(defcol, ascending)`; `dlgsize(width, height)` | Özel dosya diyaloğu sütunları (Name, Size, Type, Date Modified, Firmware Version, RPM Max, MAP Max, No.of trigger errors, GPS data). |
| `recentfiles.db` | `recentfiles(fname UNIQUE, ftype VARCHAR(3) ∈ {cfg,log}, flastopen epoch)` | Son dosyalar; `REPLACE INTO …`, 10'dan eski kayıtlar silinir (`LIMIT 9,1`). |

### 16.3 `workingdirs.db` [Observed]
`workingdirs(id, path)` (ör. `C:\Users\erdem\Documents\VEMS_Files`); `serialnumber(tstamp DATETIME DEFAULT CURRENT_TIMESTAMP, serialnum, name)` — ECU seri no → kullanıcı adı eşlemesi (`LogDirManager`). Hata: `Database error. Check/delete workingdirs.db`.

### 16.4 `logs/operations-<epoch>.db` [Observed]
`operations(opdescr VARCHAR(55), status DEFAULT 'unknown', pid DEFAULT 0, otime epoch)`. Başlangıçta `SELECT * FROM operations WHERE status='started' ORDER BY otime` → önceki oturumdan yarım kalan işlem (çökme) tespiti. Dosya adı `operations-%d.db`, temizlik regex'i `operations\-[0-9]{10}\.db`. Örneklerin hepsi boş.

### 16.5 Binary'de olup kurulumda olmayan depolar [Observed SQL string'leri]
| Dosya | Yer | Şema |
|---|---|---|
| `vemsdetails.db` | her çalışma dizini (`VEMS_Files\`) | `files(id PK AI, fname, fsize, fdate epoch, ftype ∈ {'VEMSLOG file','VEMSCFG file','VEMS trigger log'}, fw_major, fw_minor, fw_build, rpmmax, mapmax, trigerr, hasGPS, isgpsdatechk)` — dosya diyaloğu için indeks; firmware filtresi `fw_major*1000+fw_minor*100+fw_build`. `VACUUM` ile temizlik. |
| `errorreports/reports.db` | `VEMS_Files\errorreports\` | `reports(id PK AI, url, key VARCHAR(16), status, comments, attachments, time)` — `http://vems.hu/vemstune/bugreports/` hata raporları. |
| `sdcardlogs.db` | [Inferred] `VEMS_Files` | §11.3 |

### 16.6 Kısayollar (`config/hotkeys/`) [Observed]
- `targets.db`: `targets(id, title, class_symbol, symboltablefile)` — 7 hedef (VEMSTableEditor, TableEditor3D, MultiValueGraph, DifferentialGauge, GPSRouteGauge, CurveEditor, VemsGraphWidgetAgg).
- `profiles.db`: `profiles(id, target_id, title, filename, isuse)` — hedef başına aktif kısayol dosyası.
- `*events.db`: `hotkeyevent(event_id PK, symbol, title)` — eylem sözlüğü (`VEMS_TABLE_EDITOR_KEY_INC_SMALL` …).
- `*hkeys.db`/`3dtable.db`/`multigraph.db`: `hotkeys(id, event_id, keystring)` — `keystring` wxWidgets hızlandırıcı söz dizimi (`Ctrl+LEFT`, `NumPad Add`, `Q`). Kullanıcı yeni profil oluşturabilir (`Hotkey profile database files (*.db;*.s3db)`; `CREATE TABLE IF NOT EXISTS [hotkeys] …`).

### 16.7 Modbus profilleri
`config/modbus/<profil>/modbus-*.db` = §16.1 şemalarının aynısı (ör. `default`: 11 sembol, `error_code` flag'i 18 durumlu).

---

## 17. `config/defaultstatements/*.sql` [Observed]

Düz SQL betikleri, satır başına bir ifade, `;` sonlu; DB sıfırlanırken/oluşturulurken çalıştırılır:
- `MultiGraphDescDef.sql` → `MultiGraphDesc.db`: `delete from profiles/nodes/symbols;` + varsayılan `Default` profil, `Node1/Node2`, semboller.
- `MultiGraphThemeDefProfiles.sql` (boş, 0 satır sonu; tek `insert into profiles (title) values('Default');`), `MultiGraphThemeDefProps.sql` (38 `properties`), `MultiGraphThemeDefValues.sql` (38 `tvalues`, alt sorgu ile `prop_id` çözer).

---

## 18. XML konfigürasyonları (`config/*.xml`)

Tam yol/öznitelik dökümü: `re/evidence/formats/xml_schemas.txt`. "Ref." sütunu: dosya adı binary'de literal geçiyor mu.

| Dosya | Kök şema (özet) | Amaç | Ref. |
|---|---|---|---|
| `ConfigCriteria.xml` (+`Round-ConfigCriteria.xml` beklenir) | `ConfigCriteria/{Variables/Item@key (ifade metni), Validate/Rule@key[@warningMsg|@errorMsg][@minfw][@maxfw][@inisymbols]/{Item@type∈{ok,warning,error} (boolean ifade), ErrorDetail (HTML)}, ReplaceRules/Item@key (ifade), FwRules/Item@fw/Rule@key/Upgrade (ifade)}` | Konfig doğrulama + firmware yükseltmede değer dönüştürme kuralları (ifade dili INI ifade diliyle aynı) | Evet |
| `TriggerSettingsValidation.xml` | Aynı `ConfigCriteria` şeması; `ErrorDetail` içinde `$MENU_LINK` makrosu | Tetik ayarı doğrulaması | Evet |
| `VemsErrorMessages.xml` | `ErrorMessages/Message@name@type@message` + HTML metin (`$symbol` yer tutucu) | GUI hata mesaj şablonları | Evet |
| `preferences.xml` | `vemstunepreferences@showapplybutton/panel@title@icon@name/tab/page@title/(setting|group@title/setting)/{text@name@tooltip, choice@name@default@editable/option@value, input@name@type∈{file,int,string}@default@min@max@width@maxlen, radio@name@title@default@col/option, checkbox@name@title@default, slider@name@min@max@width@default, customconfigpanel@type@target, empty}` | Tercihler diyaloğunu **tanımlayan** form şeması; değerler `v3gui.cfg`'ye yazılır [Inferred] | Evet |
| `maps.xml` | `MapsConfig/MapServer@title@url/Layer@title@server(%x,%y,%zoom)@imagetype(wxBITMAP_TYPE_*)@cachedir(%vemsdocuments%)@show@avgtilesize` | GPS harita karo sunucuları | Evet |
| `graphcolors.xml` | `colors/{background,scope,textcolor}#text, event@id@name@voffset #text(renk)` | Trigger log grafiği renkleri; 62 olay kimliği | Evet |
| `WidgetThemes.xml` | `WidgetThemes@default/Theme@name/{ScaleRatios, TextColors, FaceColors, Showns, ColorDefine@name@value, VemsGaugeDigital, ExpressionGrid}` | Gauge temaları (Gold/Silver…); `colorname` (danger/warning/normal) burada tanımlanır | Evet |
| `GDDesc.xml` | `GDDs/Page@name[@valid]/DescriptorItem@name@title[@min@max@factor@valid@type]` | Gauge tanım editörü alanları (`descriptors` sütunlarıyla birebir) | Evet |
| `pdascreen.xml`, `Round-pdascreen.xml` | `GAUGE_GROUPS@default/GAUGE_GROUP@name@orientation/GAUGE@type@name@x@y@width|size` | PDA/küçük ekran yerleşimi; cfg `screenFile=` ile | cfg üzerinden |
| `GUILayoutDesc.xml`, `Round-LayoutDesc.xml` | `guiLayout/ToolBar@name@defaultOrientation@FlagSize@IconSize/Item@type@name[@size@param1]` | Araç çubuğu — **eski**, artık `GUILayoutDesc.db` [Inferred] | Hayır |
| `GaugeDescriptors.xml` | `GDs/GaugeDesc@<descriptors sütunları>/Area@min@max@colorname` | Eski gauge tanımları (DB öncesi) | Hayır |
| `VemsFlagDesc.xml`, `Round-FlagDesc.xml` | `VemsFlagDesc/VemsFlag@name/State@value@text@fgcolor@bgcolor@img` | Eski bayrak tanımları | Hayır (`v3cockpit.cfg` `flagFile=` ile) |
| `gauges.xml`, `Round-gauges.xml` | `GAUGE_GROUPS@theme/GAUGE_GROUP@name@hotKey@showOnStartup@stick@theme/(GAUGE@name@x@y@width@height@type@desc@theme | MULTIGAUGE@name@x@y@orientation@height/GAUGE@type@name)` | Eski gauge grupları | Hayır |
| `MultiGraphDesc.xml` | `Descriptor/Node/Value@name@color[@limit_min@limit_max@overlimitcolor@customtitle@type=flag@flagdisplayratio]` | Eski multigraph tanımı | Hayır |
| `GaugeSymbols.xml` | `Symbols/Symbol@id@name@type@title` (72) | Eski sembol listesi | Hayır |
| `aimpanel.xml` | `channels@interval/node@chanid@title@min@max@expression` | AIM panel kanal dönüşümleri | Hayır |
| `vct_macros.xml` (kurulumda yok) | `macros/macro@num@name` [Inferred] | Konsol makroları (`M%d`) | Evet |

"Hayır" olanlar: büyük olasılıkla DB'ye geçiş öncesi **eski/ithalat kaynakları**; yeni uygulama bunları okumak zorunda değil ama içe aktarma için şemaları belgelendi.

---

## 19. `.cfg` / `.json` / `.ini` ayar dosyaları (INI dili hariç)

### 19.1 `v3gui.cfg` — ana uygulama ayarları [Observed]
wxFileConfig biçimi: `key=value`, `[grup/alt/grup]` hiyerarşik başlıklar, `#` yorum. Anahtar grupları:
- Kök: `port`, `currSession`, `autoRawLog`, `graphics_quality_factor`, `SerialBufferSize`, `timeout`, `rterrorcount`, `interWriteDelay`, `preferredBaudrate`, `firmwareUploadBaudrate`, `max_open_group`, `rtMinRefreshInterval`, `username`, `show_nightly_releases`, `forceAIM`, `aimfallbacktime`, `rtDelay`, dosya işaretçileri (`layoutFile`, `descriptorFile`, …).
- `[communication]` `mode=SERIAL|TCP`; `[communication/serial] baudrate`; `[communication/tcp] ip=host:port, timeout, useTelnet, useHub4Com, telnetPreferredBaudrate`; `[communication/modbus] ModbusEnabled, ModbusDeviceName, ModbusDataBits, ModbusParity, ModbusStopBits, ModbusDeviceId, ModbusRealtimeAddress (hex), ModbusRealtimeLength`.
- `[webservice] baseserver, handler, timeout_insec, mapserverformat, maptileserver, maps_default_lon/lat/level`; `[webservice/proxy_settings] use_proxy, host, port`.
- `[environment] ExtLogViewer, gauge_groups_behav, logdir, gauge_groups_float_behav, logComment`.
- `[devices] protocol=SIPR|MEGATUNE, read_realtime=SIPR_RT_MT_EXT|SIPR_RT_MT_NORMAL`; `[devices/<v3|round|arm|aim|modbus>] iniFile, flagFile, diffGaugeFile, colsGaugeFile, layoutFile, groupFile, screenFile, descriptorFile, gddFile, multigraphDescFile, multigraphDefaultDescFile, ICON_*`; `[devices/<dev>/defaultgaugesfiles] r_4_3, r_16_9, r_16_10`.
- `[gps] port, baudrate, enabled`; `[defaultparams]`, `[sessions/params]` (`CELSIUS, NARROW_BAND_EGO, USEAFR147`); `[defaultTorqueConfig]` + `/drivetrain` (ifade değerli: `2.13 * 4.11`); `[audio]`; `[sdcard] baudrate`; `[table_editor_3d]` + `/<harita>` (`RotationX/Y, CameraEyeX/Y, Zoom, ShowAxes`).
- `v3guil.cfg`: aynı biçimin daha eski/kısa kopyası; `v3cockpit.cfg`: "cockpit" (eski PDA arayüzü) varyantı, XML tabanlı dosya işaretçileriyle. `vtsettings.ini` (log'da aranıyor, yok) [Unknown içerik].

### 19.2 `gui.cfg` [Observed]
wxFileConfig; `[layout/<pencere>] x,y,width,height,fullscreen,maximized,perspective`. `perspective` = **wxAUI perspective string** (`layout2|name=…;caption=…;state=…;dir=…;layer=…;row=…;pos=…;prop=…;bestw=…;…|dock_size(5,0,0)=484|`).

### 19.3 `MultiGraphDesc.cfg` [Observed]
Düz `key=value` (bölümsüz): renkler `#RRGGBB` veya `rgba(r,g,b,a)`, sayılar ondalık. 38 anahtar = `MultiGraphTheme.db properties`.

### 19.4 `virtual_devices.cfg` [Observed]
wxFileConfig: `[VirtualDevices/communication/serial] Port, Baudrate, DataBits, Parity, StopBits`; `[VirtualDevices/PLCs/PLC_n] Name, ModbusAddress, ModbusProtocol=ASCII|RTU, Current`; `[VirtualDevices/ICP-7065]` … — test/simülasyon Modbus cihazları (`ModbusPlcDialog`, `SFloodDialog`).

### 19.5 `racesCache.cfg` [Observed]
wxFileConfig: kök `0=1`; `[<32 hex md5>]` bölümleri — log dosyası özeti başına `yarışNo=vites` eşlemesi (`RaceLogAnalyser::setGearNo`, `---------checksum----------------`).

### 19.6 `sramsections.json` [Observed]
```json
{"sections":["config","hwmap","config_ext","ve","at_config","config_s","f_charge","ign","boost","vvti_map","knock_table","etime","wbo2","wbo2_2","engine","h1"]}
```
SRAM okuma diyaloğunda (`SRAMReadDialog`) sunulan firmware değişken/bölüm adları; adres çözümü `vems.map`/`global.h` ile [Inferred].

### 19.7 `v3update.ini` [Observed]
```
bootloader=http://svn.x-dsl.hu/cgi-bin/v3update/bootloaderupgrade.php
firmware=
```

### 19.8 `password.txt` (örnek: `password-example.txt`) [Observed]
`#` yorum + `{6 hane seri no}={8 hex hane parola}` (`000123=A82F1234`). Kilitli ECU parolaları; `TriggerLogReader::checkPassword/sendPassword`.

---

## 20. Modbus klasörü (`config/modbus/<profil>/`) [Observed]

Profiller: `default`, `3phase-sync`, `sequencer`, `vfd-e`, `vfd-l`; seçim `v3gui.cfg [communication/modbus] ModbusDeviceName`.
- `vemsTune-modbus.ini`: INI dili alt kümesi (`[OutputChannels]` `name = scalar, U16, <offset>, "<unit>", <scale>, <translate>`, `[SIPR]`, `[Constants]`, `[Menu]`) — INI dili kapsam dışı; yalnızca Modbus register'ları byte ofsetine eşlendiği (offset = 2×register) not edilir.
- `parameters.csv`: **`;` ayraçlı, ondalık ayırıcı virgül** (`4,2`), sabit genişlikli boşluk dolgulu alanlar. Satır 1 = cihaz başlığı (`VFD-L;1,5;4,2A;230V;…`); satır 2 = sütun başlıkları `Check;Pr. No;MODBUS;Description;Unit;Data;Default;Min;Max;Attribute;Address;Dot;Attribute;`; `*****` satırları grup başlığı (`0 - User`); veri satırı: `X;00-01;0001H;Rated Current;;4,2;0,0;0,0;6550,0;Read-Only;0001;1;280;` (`Dot` = ondalık hane, son `Attribute` = bit bayrakları [Unknown anlam]).
- Sequencer `*.txt` (`setseq.txt`, `seq-*.txt`): Latin‑1, `#` yorum, kök `SECNUM=<n>`, ardından `[<idx> - <açıklama>]` bölümleri ve `TYPE`, `ADDRESS`, `TIME`, `OP`, opsiyonel `COND_IDX` tamsayı anahtarları (değerlerden önce TAB/boşluk olabilir: `TIME\t=100`). `SequencerDialog` tarafından yüklenir. TYPE kodlarının anlamı [Unknown].

---

## 21. Uygulama günlükleri (`logs/`) [Observed]

- `filelog-<epoch>.log`: `HH:MM:SS: <mesaj>` satırları (wxLog), ilk satır `Logger::initLog() Finished! - <yol>`.
- `resourcelog-<epoch>.log`: TSV, başlık `#TimeStamp\tCPU\tMemory`, satır `epoch\t%cpu\tbytes`.
- `operations-<epoch>.db`: §16.4.
`<epoch>` = Unix saniye (10 hane).

---

## 22. Ghidra ile decompile edilmesi gereken fonksiyonlar (öncelik sırasıyla)

VA = 0x401000 + value (`syms.tsv`).

| Öncelik | Fonksiyon | VA | Neden |
|---|---|---|---|
| P1 | `VemsLogReader::parseHeaderPriv` | 0xBDC6BE | başlık anahtarları, sürüm seçimi |
| P1 | `VemsLogReader::getNextVersion1` | 0xBDBED6 | v1 kayıt düzeni |
| P1 | `VemsLogReader::getNextVersion2` | 0xBDBB2C | `b1` baytı, blok sonu `0x0A`, CRC kapsamı teyidi |
| P1 | `VemsLogReader::getNextVersion3` / `loadNextBlock` / `getHeaderValue` | 0xBDBB12 / 0xBDBA26 / 0xBDC2DE | v3 ve blok okuma |
| P1 | `SIPRFileLogger::{writeHeader, fillBuffer, process}` | 0xBB927E / 0xBB9198 / 0xBB8E28 | yazıcı tarafı blok doldurma, `b1` |
| P1 | `RawLogHelper::getVemslogHeader` / `getVemsCfgHeader` | 0x70A87C / 0x7098F4 | başlık sırası |
| P1 | `RTDataRawLogger::{fillHeader, WriteHeader, Write, fillBuffer, captureEcuBlock, getRecordSize, WriteGPSData}` | 0x71DBF6 / 0x71D73C / 0x71D506 / 0x71D6F6 / 0x71D44E / 0x71D4C6 / 0x71D634 | ham log (DataLength/GPSData*) |
| P1 | `VEMSLogBuffer::{addPacket, checkGPSPacket, convertRTTime, getGPSData}` | 0xBD8CF4 / 0xBDAD5E / 0xBDAC16 / 0xBDA6F0 | GPS/RT zaman paketleri |
| P2 | `STDataIOVemsCfg::{saveTo, getTableHeaderLine, writeEppromAreToFile}` | 0x7DE316 / 0x7E01AC / 0x7DFF20 | `.vemscfg` yazım sırası |
| P2 | `FirmwareConfigParser::{parseLine, parseTableLine, parseHeader}` | 0x4CAB1C / 0x4CB618 / 0x4CAFAC | okuma toleransları |
| P2 | `FirmwareConfigLoader::{parseCfg, parseHeader, parseMSQ, tableAxisHack}` | 0x502CB0 / 0x503270 / 0x502A0E / 0x503EB0 | 12x12↔16x14, MSQ |
| P2 | `VemsCfg2Loader::{parseCfgHeader, parseCfgLine, parseGlobalH, parseMapFile}` | 0x80E026 / 0x80E69C / 0x80E282 / 0x80E3E4 | `.vemscfg2` |
| P2 | `STDataIOMSQ::{writeAllData, makeXmlStructure, makeSymbolNodes}`, `ConfigParserMSQ::parseLine` | 0x7DC41A / 0x7DC908 / 0x7DCF5A / 0x4CA234 | MSQ öznitelikleri |
| P2 | `TriggerLog::{unescape, getHeaderInfo, fillTriggerData}`, `TriggerLogManager::writeToLogFile` | 0x82522A / 0x8251E2 / 0x825A62 / 0x83C44C | `.triggerlog` |
| P2 | `SDCardFile::{isVEMSFilesystem, getInodeVersion, isCRCValid, isDataValid, parseTriggerFrame}`, `SDCardSavedLogManager::createHash`, `TriggerFrameToSiprLogConverter::convert` | 0x77BDFE / 0x77BF95 / 0x77BBCD / 0x77BC48 / 0x77BFA2 / 0x781380 / 0xBC12AC | SD kart FS + dönüştürme |
| P3 | `IHexParser::{detectType, parseLine, fillFirmwareData}`, `IntelHex::parseLine` | 0x4CBD44 / 0x4CBF48 / 0x4CC462 / 0x659104 | uzantı/tip tespiti |
| P3 | `FirmwareData::{crypto, getPageCheckSum, addPatch, setV3MarkerWord, writeToIhex, setRinsingSeq}` | 0xA0A5EC / 0xA09F2E / 0xA0A056 / 0xA0A198 / 0xA0A1F8 / 0xE93B6C | sayfa checksum/yama (şifre kırma DEĞİL) |
| P3 | `RTDataLogWriter::{writeHeaders, writeLogWithoutInterpolate}`, `RTDataCSVWriter::{writeHeaders, processData}` | 0x71A220 / 0x71ABAE / 0x718D3E / 0x718F26 | csv/tsv sütunları |
| P3 | `VemsLogGenerator::{createVemsLog, logAllPages, logSiprPackets}` | 0x772D7E / 0x773042 / 0x772F3E | log başı sayfa dökümü |
| P3 | `TriggerLogSaveAudio::writeHeader`, `ProjectManager::{LoadRecents, SaveRecents}`, `RaceLogAnalyser::analyzeRaces`, `RTDataStatExporterBase::writeToFile` | — (`symgrep.py` ile) | ikincil formatlar |

## 23. Açık bilinmeyenler (özet)

1. `.vemslog`: `b1` baytının anlamı; blok son baytı `0x0A`'nın rolü; LogVersion 1/3 düzeni; realtime (`READ_SENSORS`) ve GPS/RT_TIME/LOG_MARKER payload'ları; tablo kimliği ↔ `SIPR_TABLE_*` eşlemesi. (Elde yalnızca realtime içermeyen 2 örnek var — canlı ECU ile uzun bir log alınmalı.)
2. Ham log (`RTDataRawLogger`) ve `DataLength/GPSDataLength/GPSDataFormat` başlıkları.
3. `.triggerlog` gövde kodlaması ve kaçış kuralı.
4. SD kart dosya sistemi (inode, blok CRC), `card_hash` algoritması.
5. `.vemscfg2` satır grameri ve `vems.map` çözümü.
6. MSQ `bibliography/versionInfo` öznitelikleri, `offset`/ölçekleme.
7. `.shex/.vhex/.lhex` örneği yok; `C:` satırlarındaki 32-bit TAG'in hesaplanışı (şifreleme dahilinde olabilir — kırılmayacak).
8. Eski 16-bit tablo hücresi (`6080`) anlamı (mcd/mct).
9. `RecentProjects.xml`, `vtsettings.ini`, `vct_macros.xml` tam yapısı.
10. Sequencer `TYPE` kodları, `parameters.csv` son `Attribute` bitleri.
