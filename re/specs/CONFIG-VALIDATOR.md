# VemsTune 1.5.46 — Config Sanity Check (VAL-01/02)

> **Doğrulama:** Gerçek VemsTune'un emu-cli emülatörü üzerindeki çıktısı, `@vems/core` `validate/` ile **satır satır, sıra ve simge dahil** yeniden üretildi.
> - Fixture: `packages/core/test/fixtures/vemstune-sanity-emulator.txt`
> - Test: `test/validator.test.ts`
>
> **Etiketler:** [O‑dec] decompile, [O‑run] gerçek VemsTune çıktısıyla doğrulandı, [I] çıkarım.
>
> Decompile'lar `re/ghidra/out/ConfigValidator*`, `ConfigCriteria*` altında. Ek fonksiyonlar (show, MenuLinkHelper, ChannelCollision…) oturum içi alt‑ajan raporundan geliyor.

## 1. Akış (`ConfigValidatorHelper::validate` @0x4f1b20)
1. Kural dosyası cihaza göre seçilir: V3 için `ConfigCriteria.xml`, Round için `Round-ConfigCriteria.xml` (`DirHelper::GetPath(3)`).
2. Sembol tablosu boşsa firmware header'ı ayrıştırılır. Header yoksa "header_not_found" verilir.
3. `validate`: kurallar ve **özet** satırı.
4. `checkChannelCollisions`, `checkInvalidChannels`, `checkInvalidBits` sırayla çalışır.
5. `getButtonState` toolbar durumunu belirler.

## 2. Ayrıştırma [O‑dec]
- **Bölümler:** `<Variables>`, `<Validate>`, `<ReplaceRules>`, `<FwRules>`. **ReplaceRules ve FwRules sanity check'e girmez.** FwRules, firmware yükseltmede config taşıması içindir (`ConfigFwRulesMgr::replaceRules`).
- **Rule öznitelikleri:**
  - `key`, `errorMsg`, `warningMsg`, `inisymbols` (virgülle ayrılır, kırpılır), `var`, `type`.
  - `minfw` / `maxfw`; varsayılanları `0.0.0` / `9.9.99`.
  - `type="ALL_ERROR"` değeri hiçbir kuralda kullanılmıyor.
- **Item tipleri:** `ok`=0, `warning`=1, `error`=2. Bilinmeyen bir tip, o kuralın ayrıştırılmasını bitirir.
- **XML boşluk düğümlerini koruyarak yüklenir:** ifade, elemanın **ilk alt düğümüdür**. `<Item type="warning"> <![CDATA[ cranking_thres > 5 ]]>` satırında ifade `" "` olur.
  - [O‑run] Bu kural VemsTune'da hiç tetiklenmiyor; boş ifade eşleşme sayılmıyor.

## 3. Değerlendirme
- **Firmware kapısı:** `fw < minfw || fw > maxfw` ise kural atlanır ve sayılmaz. Sınırlar kapsayıcıdır.
  - [O‑run] 1.2.34'te `maxfw` < 1.2.34 olan tam 9 kural düştü: 99 etkin kural → 90.
- **Item eşleşmesi:** `calc(expr) > 0` ise eşleşir (NaN da eşleşir); negatif değer eşleşmez.
- **İlk eşleşen item kazanır.** `ok` sonucu "geçti", `warning`/`error` sonucu mesaj üretir; hiçbiri eşleşmezse kural geçer. `… error …, ok: 1` kalıbında `ok: 1` "varsayılan geçti" anlamındadır [O‑dec + O‑run].
- **Hatalar:** Değerlendirme hatası (bilinmeyen ad dahil) **tüm ifadeyi 0 yapar** (`RPNParser::calculate` yakalar, sonuç 0).
  - [O‑run] `crankpw` 1.2.34'te tanımsız, "Cranking enrichment order" tetiklenmiyor.
- **Lexer:** Tanımlayıcı `]`'dan sonra biter, dolayısıyla `h1[0]-h1[1]` bir çıkarmadır (INI-DIALECT §6).
  - [O‑run] "Reference tooth table invalid" kuralı.
- **`<Variables>`:** Belge sırasıyla, bir kez hesaplanır. Sonuçlar sonraki değişkenlere ve kurallara görünür; aynı adlı sembolü gölgeler.
- **Ad çözümleme** [O‑run; sıra deneyle belirlendi]:
  1. Variables
  2. **firmware `global.h` alanı**: `fw_desc/firmware_<v>`, yoksa en yakın eski sürüm (1.2.34 → 1.2.32). Değer, yapı ofsetindeki **ham bayttır**; yapı → sayfa dilimleri FIRMWARE-MEMORY-MODEL §4.1'deki gibidir.
  3. INI sembolü veya `[SymbolAlias]` (`iniAd = eskiAd`, ör. `j_r` → `rpmBinsVE`); değer **ham**dır.
  4. `<ReplaceRules>` (yalnız yukarıdakiler bulunamazsa).
  5. Bulunamazsa hata (ifade 0 olur).
- **Dizi elemanı:** `ad[i]` biçimi, dizi sınırı dışındaysa bulunamaz sayılır.
  - [O‑run] `b[156..167]` (`boostTableAll` 144 eleman) içeren "Injector angle invalid" tetiklenmiyor.

## 4. Raporlama
- **Uyarı:** sayaç `warnings++`, `VemsMessage(sev 0, key, warningMsg, ErrorDetail)`.
- **Hata:** sayaç `errors++`, sev 1 ve `errorMsg`.
- Mesaj eksikse metin boş kalır.
- **Şablonlar:** `"$KEY "` → `"değer "`. **Ardından boşluk şarttır.** Desteklenen anahtarlar:
  - `$MENU_LINK`: `inisymbols` varsa onlardan, yoksa eşleşen ifadenin değişkenlerinden üretilir. Biçimi: `Please check <b>VAR</b> in menu(s):<br><a href="DIALOGID" target="SYM">Menü:Diyalog</a><br><br>`. Gerçek detay panelinde "Base Setup:ECU Calibrations" bağlantısı olarak göründü.
  - `$1…$n`: ifadedeki değişken adları.
- **Özet:** `Validation summary`, sev 2. Metin: `Number of rules: R, Number of passed rules: P, Number of warning: W, Number of error: E`.
  - Kanal ve bit kontrollerinden **önce** yazılır; onların hatalarını içermez.
- **Buton durumu** (son sayaçlarla; kanal ve bit hataları dahil):

  | Koşul | Durum | Renk |
  |---|---|---|
  | hata + uyarı = 0 | 1 | yeşil |
  | hata ≥ 2 | 3 | kırmızı |
  | hata = 1 | 2 | kırmızı |
  | hata 0, uyarı ≥ 4 | 5 | altın |
  | hata 0, uyarı = 3 | 4 | altın |
  | hata 0, uyarı 1–2 | 1 | yeşil |

  Erken çıkışta simge "red‑broken" olur.
- **Otomatik kontrol:** config yüklendikten sonra yapılır (pref `/general/auto_config_sanity_check`). Durum 2–3 ise "There are too many validation errors", 4–5 ise "…warnings" mesajı çıkar.

## 5. Ek kontroller [O‑dec, sayılar O‑run]
Veri kaynağı `config/outputchannels.s3db`; JSON'a `re/tools/export_outputchannels.py` ile aktarılır. İçeriği:
- Geçerli kanal tipleri: `{0,1,2,6,7,14}`.
- 24 kanal sembolü (`s_order > -1`).
- `ignitionmap`.

**Kanal baytı:** `channel*16 + type`. Alt dört bit 0xF ise kanal kullanılmıyor demektir. `b > 0x80` ise bit 7 çevrilir. `audi_hall_scope` değerini `isAudiHallScopeActive`'ten alır, yoksa 0xFF.

**checkChannelCollisions** — şu çiftleri arar:
- sembol ↔ sembol (aynı değer)
- sembol ↔ "Injector output k" (`k*16`, k = 0..`alternateCyl`)
- sembol ↔ "Ignition output p" (`h2p` / `h2dp` değeri `ignitionmap` ile çözülür; dual kanal (ch−1) ve ch'yi kapsar)
- `camshaft_out_type == 1` iken dual kam kanalları
- `iac_type == 3` iken step sırası

Çakışma varsa tek mesaj çıkar ve `errors++` yapılır: `"%d channels are in conflicting state"`. [O‑run] Değer 5.

**checkInvalidChannels:** Geçersiz tipteki kanallar için tek mesaj çıkar: `"%d channels are not set correctly"`. [O‑run] Değer 12.

**checkInvalidBits:**
- Değeri `"INVALID"` etiketine düşen her bit sembolü için `errors++` yapılır ve tek bir "Invalid values" mesajı çıkar.
- Sembolün doğrulama ifadesi 0 ise kontrol atlanır.
- "Symbol bits check" mesajları (kullanılmayan semboller, INI'de eksik etiketler) üretilir **ama VemsTune listesinde görünmez**.
  - [O‑run] 1.2.34 INI'sinde etiketsiz `pps_input` olmasına rağmen satır yoktu.
  - Bizde bunlar `result.diagnostics` alanında.

## 6. Diyalog alan işaretleri [O‑dec + O‑run]
`UserDialogFrame` ve `TriggerSettingsVisualPanel` bir `ConfigValidatorBase` alır. Alanların yanındaki ✖/⚠ simgeleri ve ipuçları `ConfigValidator::validate(model, file, flags)` ile üretilir:
1. `flags & 1`: `ConfigValidatorMgr::validate(StringHash&)` @0x4f2e22.
   - Her kuralın ilk eşleşmesi uyarı ya da hata ise metin `"Warning: "` / `"Error: "` + **ham `ErrorDetail`** olur; şablon değiştirme yapılmaz.
   - Bu metin, eşleşen ifadedeki **her değişkene** yazılır. Değişken adlarından `[` ve `]` silinir. Sonraki kural öncekinin üzerine yazar.
2. `flags & 2`: `checkInvalidBits(StringHash&)` @0x4f289a.
   - `INVALID` etiketi → `"Error: INVALID value"`.
   - Etiket sayısını aşan değer → `"Warning: allowed range is 0 - N"`.
   - Sembolün doğrulama ifadesi 0 ise atlanır. Bu adım kuralların sonucunun üzerine yazar.

[O‑run] "Primary Trigger Settings Visual" panelinde `tooth_wheel` uyarısının ipucu, **ConfigCriteria.xml**'deki detay metniyle birebir aynıydı ("If trigger type is "Coil-type" …"). Ayrıca bir alan "Error: INVALID value" gösteriyordu; bizde karşılığı `primary_trigger_sel`.

Uygulama: `fieldMarks()` (`validate/validator.ts`). Arayüzde Ayarlar diyaloglarında görünür ve her düzenlemeden sonra yeniden hesaplanır.

## 7. VAL-03 — TriggerSettingsValidation.xml 1.5.46'da fiilen kullanılmıyor [O‑dec]
- **Sonuç penceresi** (`TriggerSettingsValidatorGUI`, başlık "Trigger Settings Validation Result"):
  - `TriggerSettingsValidator_NT` oluşturur ve `GetPath(3)/TriggerSettingsValidation.xml` dosyasını yükler.
  - `_NT::parseXML` kök elemanın **`TriggerSettingsValidation`** olmasını, altında `<Variables>`/`<Rules>` bulunmasını ve kuralların `type`/`check`/`message` öznitelikli olmasını bekler.
  - Gelen dosyanın kökü `ConfigCriteria` → hiç kural yüklenmez → pencere **her zaman "All settings are OK"** der. Bu bir VemsTune hatası.
- **`TriggerSettingsValidator_CC`:** `ConfigValidator("TriggerSettingsValidation.xml").validate(model)` çağırır (bayraklar 1|2). Ancak `notify(StringHash)` sonuçları **yalnız log'a yazar**.
- **Gerçek trigger geri bildirimi:** §6'daki alan işaretleri; kaynağı ana ConfigCriteria.xml.
- **Bizdeki karşılığı:** Trigger alanları Ayarlar diyaloglarında aynı işaretleri alır. TriggerSettingsValidation.xml kurallarının çoğunun daha yeni bir sürümü zaten ConfigCriteria.xml'de var.

## 8. Açık noktalar
- Değer kaynağının (ham/mühendislik) decompile'daki yeri (`STDataHelper::fillVariableHashFromModel`, vtable+0x28) çözülmedi. Ham yorum, gerçek çıktıyla birebir tutuyor.
- "Symbol bits check" mesajını hangi katmanın gizlediği bilinmiyor (liste denetimi filtresi [I]).
- `fw_desc` en yakın sürüm seçimi kodda izlenmedi [I]; 1.2.34'ün 1.2.32 header'ıyla çalıştığı çıktıyla tutarlı.
