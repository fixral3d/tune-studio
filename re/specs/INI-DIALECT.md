# VemsTune 1.5.46 INI Diyalekti — Tam Spesifikasyon

Hedef: VemsTune 1.5.46'nın (`V3iniParser`, MinGW gcc + wxWidgets 2.8 unicode) okuduğu INI tanım dilini, bağımsız bir TypeScript/Electron uygulamasının **tüm eski ve yeni VEMS firmware INI'lerini VemsTune ile aynı sonuçla** yükleyebileceği ayrıntıda tanımlamak.

## 0. Kaynaklar, kanıt etiketleri

- INI'ler: `re/target/vemstune-1.5.46/config/*.ini` (97 üst seviye), `config/include/*.ini` (321). Aşağıdaki yollar `config/` köküne görelidir; `include/x.ini:12` = `config/include/x.ini` satır 12.
- Binary: `vemsTune.exe` (GUI) ve `vemsTune-c.exe` (aynı gün derlenmiş 1.5.46 konsol yapısı). **`re/evidence/syms.tsv` sembolleri `vemsTune-c.exe`'ye aittir** (`vemsTune.exe`'de COFF sembol tablosu yok; 50916 fonksiyon sembolünün 47488'i `-c` içinde `55 89 e5` prologuna düşer). Decompile `vemsTune-c.exe` üzerinde Ghidra 12.1.4 ile yapıldı; adresler **`vemsTune-c.exe` VA** (image base 0x400000, `.text` VA = 0x401000 + syms değeri). Dize kanıtları her iki exe'de aynıdır.
- Yardımcı araçlar (`re/tools/ini/`): `inilex.py` (`vt_tokenize` + `VTLoader`: decompile edilmiş Tokenizer/parseLine'ın birebir modeli; ayrıca eski `split_args`/`Preprocessor` yaklaşık modeli), `inventory.py` (bölüm/anahtar envanteri), `constforms.py` (veri satırı biçim histogramı), `ini_matrix.py` + `gen_matrix_md.py` (sürüm matrisi), `symnames.py` (sembol çözücü).
- Sürüm/aile matrisi: `FIRMWARE-MATRIX.md`, `re/evidence/ini-matrix.json`.

Etiketler: **[O]** Observed — INI dosyalarında veya binary dizelerinde/sembollerinde görüldü. **[O‑dec]** decompile edilmiş kodda görüldü (adres verilir). **[I]** Inferred. **[U]** Unknown.

---

## 1. Ayrıştırıcı mimarisi

### 1.1 Bileşenler [O‑dec]
| bileşen | VA (`-c.exe`) | rol |
|---|---|---|
| `ParserBase::parse` / `openFile` | 0x4cd8c4 / 0x4cd6c0 | dosyayı `wxTextBuffer::Open(path, wxConvAuto)` ile açar, her satırı `parseLine`'a verir |
| `V3iniParser::parseLine` | 0x4d0e08 | yorum/boş satır, direktifler, bölüm başlığı, bölüm sevki |
| `Tokenizer::tokenize` | 0x4e2fcc | satırı tiplenmiş token'lara böler (§2.3) |
| `V3iniParser(V3iniParserPriv*)` | 0x4d0840 | include için alt ayrıştırıcı; **Priv'i paylaşır** (bölüm, sayfa, CondTree, koşul tablosu, loglar) |
| `V3iniParserPriv` ctor | 0x4cffa4 | koşul tablosu NULL ise yerleşik varsayılanları kurar (§3.4) |
| `initSpecialDialogs` | 0x4d0ab2 | gömülü diyalog adları (§5.7) |
| `parseParams` | 0x4d2a78 | `[Params]` |
| `parseMegatune` | 0x4d2d56 | `[MegaTune]` |
| `parseConstants` | 0x4d3022 | `[Constants]` |
| `lookupOffset` | 0x4d2f62 | ofset token'ı → sayı |
| `parseTypeSpec(Symbol*, const wxString&)` | 0x4dcdbc | `(U|S|F)(08|16|24|32)` |
| `parseArraySpec(Symbol*, const wxString&)` | 0x4dd5c4 | `[X:|Y:]N` / `AxB` |
| `parseBitSpec(Symbol*, const Tokenizer&)` | 0x4de15a | `lo:hi(+ofs)` + etiketler |
| `parseMenu` | 0x4d531e | `[Menu]` |
| `parseTableMapper` | 0x4d58ba | `[TableMapper]` |
| `parseTableEditor` | 0x4d6154 | `[TableEditor]` |
| `parseSuperTable` | 0x4d7860 | `[SuperTable]` |
| `parseCurveEditor` | 0x4d821a | `[CurveEditor]` |
| `parseSuperCurveEditor` | 0x4d964c | `[SuperCurve]` |
| `parseUserDefined` | 0x4d9ef8 | `[UserDefined]` |
| `parseGPSData` / `parseAIMData` / `parseSIPRData` | 0x4dab02 / 0x4dabea / 0x4db920 | `parseOutputChannels(hidden=0)`'a yönlendirir |
| `parseSIPRDescriptor` | 0x4dacd2 | `[SIPR]` |
| `parseOutputChannels(const Tokenizer&, bool hidden)` | 0x4dba08 | `[OutputChannels]` (0) / `[HiddenOutputChannels]` (1) |
| `parseDatalog` | 0x4dcb7e | `[Datalog]` |
| `parseSramSection` | 0x4d25c6 | `[SRAM]` |
| `parseSymbolAlias` | 0x4deba0 | `[SymbolAlias]` |
| `parseUserData` | 0x4dedda | `[UserData]` |
| `parseExpressionGrid` | 0x4def5c | `[ExpressionGrid]` |
| `parseInterpolationWidget` | 0x4e0ef2 | `[InterpolationWidget]` |
| `parseConfigTablesSavingOrder` / `parseSymbolMapping` | 0x4dedd4 / 0x4d25c0 | boş gövde (6 bayt) |
| `parseFrontPage` / `parseRunTime` / `parseTuning` | 0x4d9ebe / 0x4d9ec4 / 0x4d9eca | imza `(void)`, boş; **hiç çağrılmaz** |

Sonuç modeli `MTConfigData` (`addSymbol`, `addParam`, `addGroup`, `addDataLogEntry`, `addUserMenu`, `addUserMenuItem`, `setSignature`, `getSIPRDescriptor`, `getSuperTables`, `getCurveDialogs`, `getSuperCurveDialogs`, `getExpressionGridDescriptor`, `isRawLambdaUsed`, `fillDialogNamesBySymbol`, `fillMenuAndDialogNamesByDialogId`…) [O].

### 1.2 Bölüm adları ve sevk tablosu
Binary'deki bölüm adı listesi (UTF‑16): `Params, MegaTune, Constants, Menu, TableMapper, TableEditor, SuperTable, CurveEditor, SuperCurve, GaugeConfigurations, FrontPage, RunTime, Tuning, UserDefined, OutputChannels, HiddenOutputChannels, Datalog, GPSData, AIMData, SIPR, SIPRData, SymbolAlias, ConfigTablesSavingOrder, UserData, ExpressionGrid, InterpolationWidget, SymbolMapping, SRAM` [O].

`parseLine` her aktif veri satırını, **adı birebir (büyük/küçük harf duyarlı) eşleşen** bölüm işleyicisine verir; tüm karşılaştırmalar sırayla yapılır (else‑zinciri yok) [O‑dec]:

| bölüm | işleyici |
|---|---|
| Params | parseParams |
| MegaTune | parseMegatune |
| Constants | parseConstants |
| Menu | parseMenu |
| TableMapper | parseTableMapper |
| TableEditor | parseTableEditor |
| SuperTable | parseSuperTable |
| CurveEditor | parseCurveEditor |
| SuperCurve | parseSuperCurveEditor |
| UserDefined | parseUserDefined |
| GPSData / AIMData / SIPRData | parseGPSData / parseAIMData / parseSIPRData → parseOutputChannels(0) |
| SIPR | parseSIPRDescriptor |
| OutputChannels / HiddenOutputChannels | parseOutputChannels(0 / 1) |
| Datalog | parseDatalog |
| SymbolAlias | parseSymbolAlias |
| ConfigTablesSavingOrder, SymbolMapping | boş saplama |
| UserData | parseUserData |
| ExpressionGrid | parseExpressionGrid |
| InterpolationWidget | parseInterpolationWidget |
| SRAM | parseSramSection |

- **Hiç sevk edilmeyen** (adı listede olsa da): `GaugeConfigurations`, `FrontPage`, `RunTime`, `Tuning` [O‑dec].
- **Bilinmeyen bölüm** (ör. `[CheckboxMatrix]`): bölüm değişkeni ayarlanır, hiçbir işleyici eşleşmez, satırlar **sessizce yok sayılır**; önceki bölümün işleyicisine gitmez [O‑dec].
- `[GPSData]`'ya girişte ayrıca `MTConfigData::addGroup("GPSData")` çağrılır [O‑dec].

Dağıtılan dosyalarda başlık sayıları [O]: `[CurveEditor]` 1687, `[OutputChannels]` 202, `[UserDefined]`/`[Menu]`/`[MegaTune]`/`[Constants]` 94, `[Datalog]` 92, `[HiddenOutputChannels]` 77, `[UserData]` 67, `[SIPR]` 62, `[SymbolAlias]` 58, `[TableEditor]` 54, `[CheckboxMatrix]` 49, `[Params]` 44, `[GPSData]` 42, `[SuperCurve]` 34, `[SuperTable]` 23, `[TableMapper]` 22, `[GaugeConfigurations]` 10, `[ExpressionGrid]` 10, `[AIMData]` 5, `[SIPRData]` 2, `[SRAM]` 1, `[InterpolationWidget]` 1.

### 1.3 Dosya seti
- Üst seviye dosya seçimi: `FIRMWARE-MATRIX.md §2`. Binary ayrıca sabit adlar içerir: `vemsv3.ini` (dağıtımda yok), `vemsTune-aim.ini` (`MTConfigHelper::parseAIMConfig` ile ayrı yüklenir), `v3update.ini` (INI değil), `systeminfo.ini`, `vtsettings.ini`, `trigger.ini` (bu diyalektle ilgisiz) [O].
- Hiçbir yerden include edilmeyen include dosyaları [O]: `include/calc-model_development.ini`, `include/curve-editor-boost-shared-spark.ini`, `include/expression-grid.ini_development.ini`, `include/help.ini`, `include/sipr-1.2.33.ini`; yalnız yorum satırında anılanlar: `include/sram.ini` (`vemsTune-v3-1.2.34.ini:2559`), `include/page-config-ext-1.0.73.ini` (`vemsTune-v3-1.0.00.ini:89`).

---

## 2. Sözcük (lexical) kuralları

### 2.1 Dosya okuma ve satırlar [O‑dec]
- `wxTextBuffer::Open(path, wxConvAuto)`: UTF‑8/UTF‑16 BOM'u tüketir [I: wx davranışı]; BOM'suz UTF‑8 olmayan (Latin‑1 `°`) girdinin dönüşümü [U] — non‑ASCII karakterler tokenizer'da zaten atlanır (§2.3), yalnız dize içinde görünür (`"°C"` — `include/page-eeprom-1.2.33.ini:18`). Gerçekleme: BOM→UTF‑8; yoksa UTF‑8 dene, olmazsa Latin‑1. Her include dosyası ayrı açıldığı için include başındaki BOM da tüketilir (`include/rtdata-raw-common.ini:1` BOM'lu) [O].
- CR, LF, CRLF satır sonları; **satır devamı yok**; her fiziksel satır bağımsızdır [O‑dec]. En uzun satırlar tek satırdır (`include/page-h-1.1.77.ini:26`, 257 etiket) [O].
- Satır numarası 0 tabanlı tutulur, loglarda +1 basılır [O‑dec].

### 2.2 `parseLine` girişi [O‑dec]
1. Satırın solu kırpılır (`Trim(false)`).
2. Boş satır → atla. İlk karakter `;` → atla.
3. `Tokenizer::tokenize`.
4. **Direktif tespiti yalnız `token[1]` metnine bakar** (`include`, `if`, `else`, `endif`); `token[0]`'ın `#` olduğu kontrol edilmez. Dağıtılan dosyalarda `#` olmadan bu kelimeyi 2. token olarak taşıyan satır yok (taranmış) [O].
5. `token[0]` tipi bracket (4) ise bölüm başlığı: metin aynen bölüm adı olur — **etkin olmayan `#if` bloğu içinde bile** [O‑dec].
6. Diğer satırlar yalnız CondTree etkinse bölüm işleyicisine gider.

### 2.3 Tokenizer (`Tokenizer::tokenize` 0x4e2fcc) [O‑dec]
UTF‑16 karakterler üzerinde soldan sağa, msvcrt `isspace/isalpha/isalnum` ile:

| girdi | sonuç |
|---|---|
| boşluk/TAB (isspace) | atlanır |
| `;` | satırın geri kalanı yorum (yalnız dize, `[]`, `{}` dışında) |
| `,` ve `=` | **saf ayırıcı, atlanır** — `=` zorunlu değil, virgül zorunlu değil |
| `:` | tip 6 token `":"` |
| `#` | tip 0 token `"#"`; satırın kalanı **yalnız boşluklara göre** bölünür, her kelime tip 1 (ham, tırnaklar korunur, `;` yorum değil) |
| harf | tanımlayıcı `[A-Za-z][A-Za-z0-9_]*`, tip 1 |
| rakam veya `-` | o karakter + `[0-9.]*`, `ToDouble`, tip 2. Üs yok, hex yok (`0x82` → `0` + tanımlayıcı `x82`); tek başına `-` → 0 |
| `"` | sonraki `"`'e kadar, kaçış yok, tip 3. Kapanış yoksa yalnız loglanır (`Tokenizer::tokenize() Closing quote not found:`) ve satır sonuna kadar alınır [I] |
| `[` | `]`'e kadar (boşluklar korunur), tip 4 |
| `{` | ilk `}`'ye kadar (iç içe yok), süslüler atılır, tip 5 |
| diğer her şey | **sessizce atlanır**: `} ] ( ) ! $ % / . + * & |` , `_` (başta), BOM, non‑ASCII |

Token tipleri: 0 `#`, 1 tanımlayıcı, 2 sayı, 3 dize, 4 köşeli, 5 ifade, 6 iki nokta; `getType(i)` aralık dışı için 7 döner. `getInt` sıfıra doğru keser; `getInt/getDouble` aralık dışı veya sayı olmayan token için 0; `ix(i)` aralık dışı için `""` [O‑dec].

Sonuçları (dağıtılan dosyalarda gözlenen satırlarla) [O dosya + O‑dec kural]:
- **Konumlar yalnız token indeksiyle belirlenir**; virgül sayısı önemsizdir. Bu yüzden virgülsüz satırlar doğru çalışır: `page = 15,"[", "]"	"SIPR_GET_TABLEDATA", …` (`include/sipr-1.1.67.ini`), `adjust0 = scalar, U08, 32, "Deg"		0.250,0` (`vemsTune-v3-1.1.43.ini:2723`; OutputChannels'ta 920 satır), `knock_window_length = bits, U08, 150		[4:7], …` (`cockpit-v3-1.1.27.ini:545`), `field = "2nd iButton used for config switch only"prohibit_config_ibutton_keepalive, {1},"",{!prohibit_config_ibutton}` (`vemsTune-v3-1.2.34.ini:255`), `field = "Raw value", secondary_trigger {0}` (`:546`), `boostDcGauge = boost_pwm "Boost DC" "%" 0,255,…` (`vemsTune-round-1.4.2.ini:402`).
- **Boş argüman token üretmez**: `pageChunkWrite = "", ,"", …` (`cockpit-v3-1.1.27.ini:40`) → yalnız `""` dizeleri; `link = 1, 0, BoostRefGearTable , ,{ … }` (`include/expression-grid-boost-refdc-1.2.32.ini:6`) → `1 0 BoostRefGearTable {…}`; sondaki virgül (`field = "Trigger Edge", primary_trig0,` — `vemsTune-v3-1.2.34.ini:507`) etkisiz. Buna karşın `""` (boş dize) **bir token'dır** (`field = "#…","", {…},"", {…}` — `:301`).
- `=` gerekmez: `calc_mdx_battery { engine_t_batt / 10.0 }` (`include/calc_com_model_extras.ini:25`) geçerli bir hesaplanan sembol tanımıdır.
- **`%` önekli satırlar etkindir**: `%	taeRates = array, U08, 44, [4], …` (`cockpit-v3-1.1.27.ini:364`, `include/page-config-1.0.73.ini:87-91`, `vemsTune-v3-1.1.43…48`, `vemsv3pda.ini`) — `%` atlanır, satır normal sabit tanımıdır (MegaTune'daki "devre dışı" anlamı VemsTune'da yok).
- `"label".symbol` (`vemsTune-v3-1.1.97.ini:520`) → `.` atlanır → `"label"`, `symbol` (çalışır). `clt_type!` (`vemsTune-v3-1.1.50.ini:2899`) → `clt_type` (3. konumda enable ifadesi metni olur). `+128` → `128`. `upDownLabel = ("More"), "(Less)"` → `More`, `(Less)` (zaten yok sayılan anahtar).
- `${0xff0000}` (`include/expression-grid-config-overview-base.ini:6`) → `$` atlanır, ifade token'ı `0xff0000`.
- `yBinsSteps = 0.0196…, 0,0980…` (`include/curve-editor-1.2.14.ini:647`) → `0.0196…`, `0`, `0980…` → büyük adım 0 olur (veri hatası).
- Tanımlayıcı `_` ile başlayamaz (`_` atlanır, kalan kısım tanımlayıcı olur) — dosyalarda örnek yok.

### 2.4 Anahtar/büyük-küçük harf [O‑dec]
- Bölüm adları: harf duyarlı (`wxString ==`).
- Anahtarlar çoğunlukla harf duyarlı (`==`). **Harf duyarsız** (`IsSameAs(…, false)`) olanlar: `ochGetCommand`; tüm `[SIPR]` anahtarları; `[UserDefined]` `help`, `text`, `topicHelp`; `[CurveEditor]` `showHorizontalHelpLine`, `showVerticalHelpLine`, `xBinsSteps`, `yBinsSteps`; `[SuperTable] table`; `[SuperCurve] curve`; `[TableMapper] name`.
- Sonuç: `submenu = std_separator` (21 satır, `vemsTune-v3-1.1.99.ini:132`) **yok sayılır** (yalnız ayraçlar kaybolur); `filed = …` (62, `vemsTune-v3-1.1.84.ini:622`) ve `ffield = …` (1, `vemsTune-v3-1.1.53.ini:2490`) yok sayılır [O‑dec + O].

### 2.5 Sayısal değerler
- Ondalık: `[0-9.]+`, önde `-` serbest; üs ve hex yok [O‑dec]. `getInt` sıfıra doğru keser.
- Onaltılık değerler yalnız **dize** içinde anlamlıdır: `[SIPR] page = 16,"0x82","0x83",…` (`include/sipr-1.2.34.ini:51`) — dize olarak saklanır, bayta dönüştürülmesi protokol katmanında [I] (§5.12).

---

## 3. Önişlemci

### 3.1 `#include "yol"` [O‑dec]
- `token[1] == "include"` kontrolü **ilk** yapılır ve **koşulsuz** işlenir — etkin olmayan `#if` dalı içinde bile.
- Yol = `DirHelper::GetPath(3, true)` + `token[2].AfterFirst('"').BeforeLast('"')`; yol id 3 = `<kök>/config/` (`SetProgramRootDir` 0xd4a718; kök ortam değişkeni `VEMSDIR_RW` ile değişebilir). Yani **config dizinine göre**, include eden dosyaya göre değil (`include/calc-model-1.2.32.ini:2` içindeki `#include "include/calc-model-common-1.2.32.ini"` buna dayanır) [O]. Yol boşluk içeremez (`#` satırı boşluklara göre bölünür).
- Dosya yoksa kullanıcı loguna `Include not found: <yol>` yazılır, ayrıştırma devam eder. Varsa aynı Priv'i paylaşan alt `V3iniParser` ile ayrıştırılır (bölüm, sayfa, CondTree, koşul tablosu ortak).
- **Sonuç**: etkin olmayan dal içindeki include'un `[Bölüm]` başlıkları yine uygulanır ve iç `#if/#endif`'leri yığını etkiler; diğer satırları atlanır. Dağıtılan dosyalarda 75 include `#if` içinde. `VTLoader` ile 97 üst seviye INI için "naif" önişlemciyle karşılaştırıldı: varsayılan koşullarla bölüm ataması **tüm dosyalarda aynı** (gözlenen bölüm sızıntısı yok) [O, tools/ini].
- Döngüsel include koruması [U] (dosyalarda döngü yok). Aynı dosya iki kez include edilebilir: `vemsTune-v3-1.1.67.ini:48` `calc-model-1.1.00.ini` ve `:1685` `calc-model-1.1.67.ini` her ikisi `calc-model-common.ini`'yi içerir → 181 "Duplicate symbol" [O, tools].

### 3.2 `#if NAME` / `#else` / `#endif` [O‑dec]
- `#if`: `name = token[2].Upper()`; koşul tablosunda (`BoolHash`) aranır; yoksa **false** ve hata loguna `"<NAME> does not match condition!  - line: %d"`. Yeni `CondTree{cond, parent=current, state=0}` yığına itilir.
- Yalnız tek kelime: `!`, `&&`, ifade yok (`#if !FOO` → `!FOO` aranır → false). Dağıtılan 3729 `#if`'in hepsi tek tanımlayıcı [O]. Sonrasındaki kelimeler (`#if HIGHBOOST ; yorum`) yok sayılır.
- `#else`: `setState(1)`. `#endif`: üst düğüme döner. Açık `#if` yokken ikisi de `ParserException("IF statement missing!")` fırlatır (yakalandığı yer [U]).
- Değerlendirme: `CondTree::isValid` (0x4899fc) = `state ? !cond : cond`; `isActive` (0x489a20) = tüm atalar geçerli; ağaç yoksa etkin.
- İç içe serbest (`include/page-ve-16x14-1.2.32.ini:7-15`). `#elif`, `#ifdef`, `#ifndef` yok.
- `#define X …` (`include/dialog-woodgas.ini:5-6`), `#field = …` (10 satır, `vemsTune-v3-1.1.99.ini:336`): `token[0]` `#`, `token[1]` direktif değil → hiçbir işleyici eşleşmez → yok sayılır [O‑dec]. Çıplak `endif` satırı (`vemsTune-v3-1.1.55.ini:996`): token[1] yok → bölüm işleyicisine gider ve tanınmayan anahtar olarak yok sayılır [I].
- Dengesiz dosya: `vemsTune-v3-1.1.60.ini` 2 açık `#if` ile bitiyor; EOF'ta kapanmamış `#if` için hata [U].

### 3.3 Girintili direktifler
`parseLine` sol kırpma yaptığı için `	#if HIGHBOOST` (`cockpit-v3-1.1.27.ini:6`) geçerlidir; 451 girintili direktif var [O].

### 3.4 Koşul tablosunun kaynağı
1. **Proje parametreleri** (normal kullanım): `MTConfigHelper::commonParse` (0x6ccc50) → `ProjectConfigHelper::getProjectParams` (0x6f6f00/0x6f725c): proje konfigürasyonundaki `/sessions/params/` altındaki her giriş için `table[key] = (value != "0")` [O‑dec].
2. **Yerleşik varsayılanlar** — yalnız koşul tablosu NULL ise (`V3iniParserPriv` ctor 0x4cffa4): `12X12=1, 16X14=0, HIGHBOOST=1, CELSIUS=1, NARROW_BAND_EGO=0, VER2=0` [O‑dec].
3. **`[Params]`** satırları: `table[t0] = getInt(1) != 0` (ve `MTConfigData::addParam`). Anahtar harf duyarlı saklanır, `#if` adı büyük harfe çevirdiği için yalnız büyük harfli Params anahtarları eşleşebilir [O‑dec]. Params dosya başında olduğundan sonraki tüm `#if`'leri etkiler (`include/sipr-1.2.34.ini:17` `#if USE_RAW_LAMBDA_TABLE`) [O].
4. İmzadaki `kpa=a,b` → `HIGHBOOST`/`KPAUNIT_4`/`KPACONFRES_4` (`FirmwareInfo::setFirmwareCompileOptions()` dizeleri) [O dize / I: proje parametrelerine yazıldığı varsayılır].
   **Kesinleşti [O‑dec, 2026‑11‑01]:** `FirmwareInfo::fillDetectedParams` @0x513a7a ve `setHighAndLowBoost` @0x513bd6 üretir; `parseMTConfigData` bunları `USE_SUPER_TABLE`'a ekler.
   - **İmzadan:** `12x12`/`12X12` → `12X12`; `kpa=2,2`|`kpa=4,2` → `HIGHBOOST`; `kpa=4,*` → **`KPAUNIT_4`**; `kpa=*,4` → **`KPACONFRES_4`**.
   - **Derleme seçeneği bitleri** (`FirmwareInfo` ctor @0x511c72): 0x1 PS2KEYBOARD, 0x2 N2O_RETARD, 0x4 WARNING_BEEP, 0x8 EXPENSIVE_MISC1OUT, 0x10 EXPENSIVE_MISC2OUT, 0x20 INJECTOR_DEADTIME_SIMPLE, 0x40 INJECTOR_TRIM, 0x80 KNOCK_ALTERNATIVE, 0x100 TOYOTA_1JZ_VVTI, 0x200 A340E, 0x400 ALTERNATIVE_AE_DE_FILM, 0x800 WOODGAS_CONTROLLER.
   - **Maskenin kaynağı:** `.vemscfg`'de `CompileOptions` başlığı (hex). TF bağlantısında firmware seçenek dizesinin 24–25. karakterleri; yalnız dize 26–29 karakterse (`setFirmwareOptions` @0x51326c).
   - Uygulama: `@vems/core` `ini/defines.ts`. `vemsTune-v3-1.2.34.ini:11` yorumu: "for automatic correct behaviour use VT with compile date after 13-03-2015" [O].
5. fw_desc `my_make` → `^\s*MY_CONF\s*\+=\s*\-D\s([A-Za-z0-9_=]*)` (firmware derleme tanımları) [O regex / I kullanım].
- `commonParse` ayrıştırmadan sonra `fw_major`, `fw_minor`, `fw_build` adlı **ifade sembollerini** (`{N}`) ekler (ifadelerde kullanılabilir: `include/calc-model-config-overview-base.ini:5`) [O‑dec].
- Kullanılan tüm koşul adları ve sayıları: `FIRMWARE-MATRIX.md §3`.

---

## 4. Ortak kavramlar: tip, ölçek, sayfa, sembol

### 4.1 Tip (`parseTypeSpec` 0x4dcdbc) [O‑dec]
Regex `(U|S|F)(08|16|24|32)`, **çapasız, harf duyarlı**. `setType(signed, sizeCode 1..4, isFloat)`: `U`→(0,n,0), `S`→(1,n,0), `F`→(1,n,1). Hatalar `Type field error!`, `Type sign error!`, `Type size error!` → `ParserException(msg, line)` (yakalandığı yer [U]).
- Kullanılanlar: `U08`, `U16`, `U24` (`include/section-gpsdata.ini:4`), `U32` (`vemsTune-Arm-0.0.01.ini:82`), `S32` (`include/section-gpsdata.ini:2`) [O]. `inifiles::IniFileBase::scalar_s08/s16/s24/s32/u24/u32/f32` mevcut [O].
- **`U8`** (`knock_cyl_0_knock_val=scalar, U8, 41, …` — `vemsTune-v3-1.1.84.ini:1420` ve 18 benzeri) regex'e uymaz → istisna; o satırın (veya üst kapsamdaki ayrıştırmanın) akıbeti [U].
- Bayt sırası big‑endian (AVR; eski `endianness = big` — `cockpit-v3-1.1.27.ini:27`; anahtar okunmaz) [O/I].

### 4.2 Ölçek / dönüşüm [O‑dec]
`user = scale * (raw + translate)` (`STDataModelSerial::getValue` 0x7e4038); ters: `raw = user / scale − translate`.
- Doğrulama: `coolant = scalar, …, 1.0, -100` ↔ `coolant = { cltADC - 100 }` (`vemsTune-v3-1.2.34.ini:2006`) [O].
- **İfade dönüşümü**: scalar'da t5 ve t6, array'de t6 ve t7 **ikisi de** `{…}` ise `setExpressionsForTransformations(fromRaw=ilk, toRaw=ikinci)`; ifadelerde `x` mevcut değerdir; `{}` token'larının `getDouble`'ı 0 olduğundan scale/translate alanları 0 olur [O‑dec]. Örnek: `primePulse = scalar, U08, 0, "ms", { ( x == 0 ) ? 0 : ( 6 + … ) },{ ( x == 0 ) ? 0 : … }, 0.0, 25.5, 1` (`include/page-config-1.1.18.ini:4`), `camshaft_angle1_table = array, U08, 80, [8x8], "deg", { (x * 1.40625) }, { (x ) / 1.40625 }, 0.0, 360, 2` (`include/page-matcorr-8x8-1.2.33.ini:23`).
- lo/hi kullanıcı birimiyle sınır; digits gösterim ondalığı [O‑dec alan / I anlam].

### 4.3 Sayfa ve ofset [O‑dec]
- `[Constants] page = N` paylaşılan "güncel sayfa"yı ayarlar ve sayfa başına max‑ofset izleyicisini (`MTConfig+0x54[page] = -1`) sıfırlar. Sayfa uç baytı: scalar `off+size−1`, array `off+size·d0·d1−1`, bits `off`.
- Özel sayfalar [O]: `30` (EEPROM, `include/page-eeprom-1.2.33.ini:1` + `[SIPR] page_eeprom = 30`), `31` sanal tablo (`vemsTune-v3-1.2.34.ini:59-60`; ECU karşılığı yok, değerler `[UserData]`'dan, `IniFile::fillVirtualPage` sembolü), `-1` COM_MODEL "mdx" (`include/page-mdx-1.2.32.ini:1`).
- **`lookupOffset`** (0x4d2f62): `ToLong(10)`; başarısızsa **aynı adlı mevcut bir sembolün ofsetini** kullanır; hex ayrıştırılmaz. `config_t_tooth_wheel` gibi adlar (`include/page-mdx-1.2.32.ini:3`) yalnız o adla önceden bir sembol varsa çözülür — firmware başlık (`global.h`) ayrıştırıcısının `config_t_*` sembolleri ürettiği varsayılır [I].
- OutputChannels'ta ofset `getInt` ile okunur, ad çözümü yok [O‑dec].
- Aynı ofseti paylaşan semboller serbesttir (`h0` dizi + `h00…h07` — `include/page-h-1.1.77.ini:5-13`) [O].
- **Yinelenen ad**: hata loguna `Duplicate symbol! : <ad> - line : %d`, sembol yine de eklenir (`MTConfigData::addSymbol` davranışı → muhtemelen son tanım geçerli [I]) [O‑dec].

---

## 5. Bölümler

Notasyon: `t0` = anahtar (ilk token), `t1…` sonraki token'lar (ayırıcılar token üretmez). "argc" = dağıtılan dosyalarda görülen sayılar (inventory.py).

### 5.1 `[Params]` (parseParams) [O‑dec]
`AD = int` → `addParam(t0, getInt(1)!=0)` ve koşul tablosu. 1.1.60+ v3: `USE_RAW_LAMBDA_TABLE=1`, `BUSYLOOP_STIMULATION=0`, `USE_INJ_STEPPER=0`, `CAM_ANGLE_PHASE_CORRECT=0` [O] (`vemsTune-v3-1.2.34.ini:6-14`).

### 5.2 `[MegaTune]` (parseMegatune) [O‑dec]
Yalnız `signature = "…"` → `setSignature(t1)`. `queryCommand`, `versionInfo`, `MTversion`, `writeXML` **yok sayılır**. Örnek `vemsTune-v3-1.2.34.ini:18-30` (`#if HIGHBOOST signature = "VEMS v1.2.34 16x14 kpa=2,2" #else … kpa=2,1 #endif`). İmzanın rolü: `FIRMWARE-MATRIX.md §1.1`.

### 5.3 `[Constants]` (parseConstants)
Sembol, `t1` ∈ {`scalar`,`array`,`bits`} **veya** `getType(1)==5` (ifade) ise oluşturulur; aksi satır (ör. `page`) ya da tanınmayan anahtar yok sayılır [O‑dec].

```
page = N
name = scalar, TYPE, OFFSET, "units", SCALE, TRANSLATE, LO, HI, DIGITS
name = array,  TYPE, OFFSET, [SHAPE], "units", SCALE, TRANSLATE, LO, HI, DIGITS
name = bits,   TYPE, OFFSET, [LO:HI(+ADD)], label0, label1, … [, {validationExpr}]
name = {expr}, {reverseExpr}, target, "units", DIGITS        ; hesaplanan (computed) sabit
```

**5.3.1 scalar** [O‑dec]: t2 tip, t3 ofset (`lookupOffset`), t4 birim, t5 scale, t6 translate, t7 lo, t8 hi, t9 digits (int). `setBasic(name, units, const=true, page, offset)`, `setInputType(5)`, `setFormat(scale→+0x50, translate→+0x58, lo→+0x68, hi→+0x70, digits→+0x60)`. t10 ve sonrası yok sayılır (`shiftcut_ret_raw = scalar, U08, 10, "", 1, 0.0, 0.0, 255, 0,{0}` — `include/page-config-1.1.81.ini:16`) [I: işleyici t10'u okumuyor]. Eksik argümanlar 0 olur (`boosttpsTable = array, U08, 0, [8], "TPS Scaling",1` — `cockpit-v3-1.1.27.ini:262` → translate/lo/hi/digits = 0) [O‑dec getDouble kuralı].

**5.3.2 array** [O‑dec]: t2 tip, t3 ofset, t4 `[şekil]`, t5 birim, t6 scale, t7 translate, t8 lo, t9 hi, t10 digits.
`parseArraySpec` (0x4dd5c4): t4'ten tüm boşluklar silinir, `^(Y:|X:|)(?:(\d+)|(\d+)x(\d+))` ile **ICASE** eşlenir (sonda çapasız). Düzen bayrağı: varsayılan/`X:` → 1, `Y:` → 0; başka önek (`x:`/`y:` küçük harf dahil) → `Array xOrder error!`. `[N]` → `setArray(order, 1, N, 1)`; `[AxB]` → `setArray(order, 2, A, B)`. Diğer hatalar `Array Shape error!`, `Array size error!`, `Array size 1 error!`, `Array size 2 error!`, `Missing size 2 error!`.
- Büyük `X` (`[12X12]` 47, `[12X6]` 26, `[16X14]` 16, `[8X8]` 16, `[17X3]` 5, `[12X13]` 1) ICASE sayesinde geçerli [O+O‑dec]. `[  8]` boşluklu geçerli (`include/page-h-1.1.77.ini:15`).
- Dağıtılan dosyalarda `X:`/`Y:` öneki hiç yok → tüm diziler order=1 [O].
- `veTable [16x14]` + `rpmBinsVE [16]` + `mapBinsVE [14]` (`include/page-ve-16x14-1.2.32.ini:3-8`): A = x‑ekseni (RPM) uzunluğu, B = y‑ekseni (kPa) uzunluğu; order=1'de x hızlı değişir (MegaTune X‑order: `[x1,y1][x2,y1]…`, `vemsTune-Arm-0.0.01.ini:42-53`) [O/I].
- Kullanılan 2B şekiller: `12x12, 8x8, 12x6, 8x10, 16x14, 2x4, 6x6, 8x3, 17x3, 16x8, 8x4, 8x2, 8x5, 4x4, 2x8, 8x6, 12x13` [O].

**5.3.3 bits** [O‑dec]: t2 tip, t3 ofset, t4 `[lo:hi(+ofs)]`; `parseBitSpec` (0x4de15a) regex `^(\d+):(\d+)\+?(\d*)` (ofs varsayılan 0; hatalar `BitField error!`, `loBit value error!`, `hiBit value error!`, `offsBit value error!`). Ardından **t5'ten itibaren her token (tipinden bağımsız, metin olarak) seçenek etiketi**, ilk `{ifade}` token'ına kadar; o ifade `setValidationExpr` olur ve tarama durur. Birim `""`. `setBit(lo, hi, ofs, labels)`.
- `ofs`: gösterilen değere eklenen öteleme (`nCylinders = bits, U08, 62, [4:7+1]` — `cockpit-v3-1.1.27.ini:384`, 57 kullanım) [O/I].
- Etiket biçimleri [O]: dize (`"Metric"`), tırnaksız/tırnaklı `INVALID` (combobox'ta gizlenir — `vemsTune-Arm-0.0.01.ini:70-72` belge) , sayılar (`knock1_gain … [0:5], 2, 1.882, …` — `cockpit-v3-1.1.27.ini:547`; sayı token'ının **metni** etiket olur), alt alanlı h‑tablosu etiketleri `"I259-0;Ignition output;7A;Grounding;EC36 pin 35;"` (`include/page-h-1.1.77.ini:26`; görsel çıkış diyalogları bunları `;` ile ayrıştırır [I]). Etiketsiz bits (167 satır) sayısal düzenlenir [I]. Eksik etiketler için sentez kuralı (MegaTune) [U].
- Doğrulama ifadesi: `h20 = bits, U08, 16, [0:7], …, {!ign_out_dual}` (`include/page-h-1.1.77.ini:26`), `… {!iac_sol…}` (`include/page-config-1.1.81.ini:233`) [O]; ifade false iken değer geçersiz sayılır / doğrulama uyarısı [I: `ConfigValidatorMgr` "is disabled because of the validation expression" dizesi].

**5.3.4 Hesaplanan sabit** (`getType(1)==5`) [O‑dec]: `name = {expr}(t1), {reverseExpr}(t2), target(t3), "units"(t4), digits(t5)` → `setExpr(t0,t1)`, `setExprReverse(t2)`, `setTarget(t3)`, `setBasic(t0, t4, const=true, page=-1, off=-1)`, `setFormat(scale=0.0, translate=1.0, lo=0, hi=0, digits=t5)`.
- `accel_fadeout_combo = { -0.1/ln(accel_fadeout/256) }, { exp( 1/accel_fadeout_combo *(-0.1))*256 }, accel_fadeout, "sec", 2` (`include/page-config-1.1.81.ini:94`): `t1` hedefin değerinden görüntü değeri, `t2` girilen değerden (kendi adıyla) hedefin yeni değeri [I].
- `const_expr_test = { 2 * iac_integral_limit_dec }, { const_expr_test / 2 }, iac_integral_limit_dec` (`vemsTune-v3-1.1.51.ini:824`) [O].
- **Yalnız `{expr}` içeren satırlar da bu yoldan sabit olur**: v3 1.1.18–1.1.67 `calc-model-common.ini` ve `calc-model-config-overview-base.ini`'yi `[Constants]` bağlamında include eder (`vemsTune-v3-1.1.67.ini:48`) → bu hesap ifadeleri "hesaplanan sabit" olarak kaydedilir [O, VTLoader].

**5.3.5 Okunmayan MegaTune sayfalama anahtarları** (cockpit/pda, round ≤0.4.1, round 1.4.2/1.4.3, round.ini): `nPages`, `pageSize`, `pageActivate`, `pageReadCommand`, `pageValueWrite "H%o%v"`, `pageChunkWrite`, `burnCommand`, `endianness`, `verify`, `writeBlocks`, `interWriteDelay`, `pageActivationDelay` (`cockpit-v3-1.1.27.ini:24-40`) — `t1` bir tip anahtar kelimesi/ifade olmadığından **yok sayılır** [O‑dec]. Sayfa→komut eşlemesi yalnız `[SIPR]`'dandır.

Biçim histogramı (constforms.py; virgülsüz satırlar dahil) [O]: `scalar,T,N,S,N×5` 26064; `bits,…,S…` 10868; `array 1B` 2298; sayısal etiketli bits 365+94; etiketsiz bits 167; `array 2B` 112; bits + `{expr}` 111; `{e},{e},ID,S,N` 61; `{e},{e},ID` 36; ifade ölçekli scalar 41+23; ad ofsetli scalar 10; ifade ölçekli array 8+1.

### 5.4 `[OutputChannels]` / `[HiddenOutputChannels]` (parseOutputChannels) [O‑dec]
| biçim | işlem |
|---|---|
| `ochGetCommand = "x"` (harf duyarsız) | `SIPRDescriptor::setOchGetCommand(t1)` |
| `name = {expr} [, gaugeType(t2)] [, "title"(t3)]` | `setExpr(t0,t1)`, `setGaugeType(t2)`, `setTitle(t3)`, `setHidden(h)` |
| `name = scalar, TYPE(t2), offset(t3), "units"(t4), scale(t5), translate(t6), [t7], [t8], [digits t9]` | ofset `getInt` (ad çözümü yok); `setBasic(…, const=false, page, off)`, `setInputType(1)`, `setFormat(t5, t6, lo=t7, hi=t8, t9)`; **t7/t8 aynı anda** `setGaugeType(t7)`, `setTitle(t8)`; `MTConfig+100` = max uç ofset (realtime blok boyu) |
| `ochBlockSize = N` ve diğer her şey | yok sayılır |
- Hidden farkı yalnız `setHidden(true)`.
- Mevcut bölüme göre ek ayar: `GPSData` → inputType 0x20 + grup GPSData; `AIMData` → inputType 0x91 + `setChannel(getInt(7))`; `SIPRData` → inputType 0.
- Yinelenen ad: Constants ile aynı (log + ekle).
- Biçim sayıları [O]: `{expr}` 14322 (+2973 Hidden); `scalar` 6 arg 4839 (920'si virgülsüz); `scalar` + `gaugeType, "title"` 102 (`secl = scalar, U08, 0, "sec", 1.000, 0.000, secl, "Clock"` — `cockpit-v3-1.1.27.ini:1041`); `{expr}, gaugeType, "title"` 262 (`iac_integral_signed = { 2 * (iac_integral - 128) }, iac_integral_signed, "IAC int"` — `cockpit-v3-1.1.27.ini:1095`).
- `ochBlockSize` okunmaz; realtime blok boyu scalar kanalların uç ofsetinden hesaplanır. 1.1.81–1.1.94'te INI `ochBlockSize=64` iken hesaplanan 69 [O, FIRMWARE-MATRIX §1.2].
- Aynı ofsette çoklu yorum normaldir (`rpmdiff0_raw`/`rknock0`/`wbo2_status` @53 — `vemsTune-v3-1.2.34.ini:1933,1945,1957`; seçim ifadede: `rpmdiff0 = { rtdata == 1 ? -512 : rpmdiff0_raw }` — `:2478`) [O].
- İleri referans serbest: `isALSActive` (`:2396`) `isALsFuncActive`'i (`:2399`) kullanır; `pulseWidth` (`:1990`) Hidden'daki `calc_PulseWidth_ramp3`'ü kullanır [O] → değerlendirme isim bazlı/tembel olmalı (bkz. §6.4).
- Rezerve/beklenen adlar: `deadValue = { 0 }`, `time = { 0 }` (gerçek zaman uygulamadan [I]), `rpm`, `map`, `throttle`, `coolant`, `mat`, `lambda`, `afr`, `spark`, `batteryVoltage`, `egt1`, `roadSpeed`, `gear` — gösterge DB'leri (`GaugeDescriptors.xml`, `*.db`) bunları kullanır [O]. `vemsTune-aim.ini:20-29` aynı adları AIM verisinden üretir.

### 5.5 `[GPSData]`, `[AIMData]`, `[SIPRData]` [O‑dec]
`t1 != "size"` ise satır `parseOutputChannels(hidden=0)`'a gider (yukarıdaki inputType ayarlarıyla). Kontrol `t0` yerine `t1` üzerinde yapıldığından `size = 30` yakalanmaz ama OutputChannels'ta da tanınmaz → yok sayılır.
- GPS (`include/section-gpsdata.ini`): `rawLatitude = scalar, S32, 3, …` (ofset GPS paketi içinde), `latitude = { rawLatitude / 1000000 }`, `getGpsDistance/getGpsCourse/sum` [O]. Binary `rawLatitude`, `rawTime`, `rawDate`, `capturedIdx` adlarını ayrıca sabit olarak tanır [O].
- AIM (`cockpit-v3-1.1.27.ini:938-962`): `aim_rpm = scalar, U16, 0, "rpm", 1.000, 0.000, 1, rpm, "Aim Engine Speed"` → t7=1 AIM kanalı (`setChannel`) ve aynı zamanda lo/gaugeType; t8 `rpm` (hi/title); t9 `"Aim…"` (digits → 0) [O‑dec konum / I anlam: kanal numaraları 1,17,33,45,69,101,105 `vemsTune-aim.ini` bayt ofsetleriyle aynı].
- SIPRData (yalnız cockpit/pda, `cockpit-v3-1.1.27.ini:1001-1031`): SIPR realtime paket alanları [O].

### 5.6 `[Datalog]` (parseDatalog) [O‑dec]
`entry = t1, t2, t3, t4` → `addDataLogEntry(kanal, "Etiket", float|int, "format")` (`vemsTune-v3-1.2.34.ini:2580`). Tip `float` 2631 / `int` 1629; format `%d %.1f %.2f %.3f %.6f %.0f` [O]. Sıra = CSV log sütun sırası (`:2564-2579` belge) [O]. Tanımsız kanal (`entry = airCorrection` — `:2596`, tanımı yorumda `:1850`) [O] → davranış [U].

### 5.7 `[Menu]` (parseMenu) [O‑dec]
- `menu = "Başlık"` → `addUserMenu(t1)`; `currentMenu = t1` (statik, ilk değer `"default"`).
- `subMenu = hedefId(t1), "Etiket"(t2), int(t3), {koşul}(t4)` → `addUserMenuItem(currentMenu, t1, t2, getInt(3), t4)` + `fillMenuAndDialogNamesByDialogId(t1, currentMenu + ":" + t2)`. **Konumlar sabit**: `{koşul}` t3'te ise `getInt` ile 0 olur ve koşul kaybolur (`subMenu = drumsensor, "…", {shiftcut_conf_drumsensor}` — `include/menu-motorsports-1.2.15.ini:4`, 3 satır) [O‑dec+O].
- `subMenu = std_separator` (879), `std_realtime` (2) [O]; `submenu` (küçük m) yok sayılır (§2.4). `plugIn` yok sayılır.
- argc: subMenu 2→3003, 1→770, 4→587, 3→112; t3 her zaman `0` [O]; t3'ün anlamı [U].
- Koşul false → öğe devre dışı [I] (`UserDialogManager::refreshMenu` RPN ile değerlendirir [O‑dec]).
- Hedef id ad alanı (ini_matrix.py, 1.2.34): dialog 63, curve 18, table 16, **table 3D id (TableEditor t2) 11** (`veTableMap`), supercurve 8, supertable/3D 2+2, özel 36 [O]. Çözülemeyen hedefler mevcut (`cltignadjTbl_MAP` — `include/menu-tuning-1.2.23.ini:43`) [O] → davranış [U].

### 5.8 `[UserDefined]` (parseUserDefined) [O‑dec]
- `dialog = ad(t1), "Başlık"(t2), int(t3)` → `currentDialog = t1`, `UserDialogList::add(t1, t2, getInt(3))` + `"dialog"` gösterge tanımlayıcısı. t3 değerleri: `5` 1124, `1` 953, `9` 301, `6` 55, yok 1689 [O]; anlamı [U] (`1`: h‑tablosu ve gömülü diyaloglar; `9`: uzun diyaloglar). `{koşul}` t3'te (`dialog = drumsensor, "…", {…}` — `vemsTune-v3-1.2.10.ini:1596`, 16 satır) → 0, koşul kaybolur.
- **`field = "etiket"(t1), sembol(t2), enable(t3), comboSymbol(t4), hide(t5)`** → `UserEditField(label, sym, expr=t3, comboSymbol=t4, hideExpr=t5)` (ctor 0x8caad2) + `fillDialogNamesBySymbol`. Etiket = `t1.AfterFirst('#')`, boşsa tüm `t1` (yani baştaki `#` atılır; `#` içermeyen etiket aynen) [O‑dec].
  - t3 (enable) herhangi bir token'ın metnidir: `{wbo2_2_enable}` (`vemsTune-v3-1.2.34.ini:240`), `0` (`field = "MAP Sensor Offset [kPa]", kpaoffs_calculated, 0` — `:283`; 58 satır → her zaman devre dışı/salt‑okunur [I]), `{0}` (`:648`), `clt_type` (`!` atılmış — `vemsTune-v3-1.1.50.ini:2899`).
  - t4 = `comboSymbol`: dağıtılan dosyalarda ya `""` (2308 satırın neredeyse tamamı) ya da türetilmiş sabit adı (`field = "Fadeout Time", accel_fadeout,{1}, accel_fadeout_combo` — `vemsTune-v3-1.1.80.ini:786`, 36 satır) [O]; ikinci sembolün aynı satırda alternatif düzenleyici olarak gösterildiği varsayılır [I].
  - t5 = `hideExpr`: 2. koşul genelde t3 ile aynı ifade (`vemsTune-v3-1.2.34.ini:396`); true iken gizlemek mi göstermek mi [I: dosyalardaki kullanım (`{enable_etc}` ile aynı) "true iken göster" anlamına uyar; yani alan görünürlük koşulu].
  - t2 boş dize (`field = "#…", "", {…}, "", {…}` — `:301`, 150 satır): sembolsüz, koşullu başlık/metin.
  - Etiket önekleri [O sayılar]: `#` 5940 (başlık/ayraç; `#` atılır), `!` 609 (uyarı metni; `!` korunur, işleme [I]), `[` 2729, `%`, `-`, `*`, `(`, boşluk.
- `topicHelp = x` (harf duyarsız) → `setHelpID(currentDialog, t1)`; t1 dize (2650) ya da tanımlayıcı (17, `vemsTune-v3-1.0.00.ini:445`) [O].
- `help = ad` → `currentHelp = t1` (ikinci argüman yok sayılır); `text = "…"` → `helpText[currentHelp] += t1` (**ayırıcısız birleştirme**; HTML `<br>` dosyada) (`include/help.ini:1-15`, `vemsTune-v3-1.1.43.ini:2526-2528`) [O‑dec].
- Gömülü diyaloglar (`initSpecialDialogs`): `injOutVisual`, `outputChannels`, `ignitionOutputsVisual`, `roundMainDisplay`, `ledDisplayDemo`, `triggerSettingsVisual` — bu adlarla tanımlanan `dialog`'lar UserDialog yerine `StringObject` gösterge tanımlayıcısı alır, içerik uygulama tarafından çizilir (`include/dialog-allOutputChannels.ini:1-2`) [O‑dec].

### 5.9 `[TableEditor]` (parseTableEditor) [O‑dec]
| anahtar | işlem |
|---|---|
| `table = id(t1), id3d(t2), "başlık"(t3)` | 2B `VemsTableDesc` (anahtar t1, gösterge tipi `"table"`); t2 boş değilse 3D tanımlayıcı (t2, t1, t3; tip `"table3d"`). **t4 (sayfa no) yok sayılır** |
| `xBins` / `yBins` / `zBins = t1, t2` | eksen/tablo sabiti ve realtime kanal (zBins +0x18/+0x1c) [I anlam] |
| `numberWidth` (int), `numberPrec` (int), `largeCellStep` (double), `smallCellStep` (double) | 2B ve 3D tanımlayıcıya uygulanır |
| `useTableMapper` (bool) | yalnız 2B |
| `upDownLabel`, `gridHeight`, `topicHelp` | yok sayılır |
Örnek `include/table-editor-1.2.32.ini:41-47` (`table = veTableTbl, veTableMap, "RPM/MAP Fuel VE Table", 2` / `xBins = rpmBinsVE, rpm` / `zBins = veTable, veCurr`).

### 5.10 `[TableMapper]` (parseTableMapper) [O‑dec]
`name = id` (harf duyarsız) → `TblMapDesc` + gösterge `"tableMapper"`; `xBins`, `yBins`, `zBins = t1, t2` (`include/table-editor-1.2.32.ini:1-22`). Dosyalarda `xBins = rpmBinsVE, "RPM Header"`; `zBins = tablo1, tablo2, …` (4'e kadar — `vemsTune-v3-1.0.00.ini:189`) ama yalnız t1/t2 okunur [O‑dec] → 3. ve 4. tablo kaybolur.

### 5.11 `[SuperTable]` (parseSuperTable) [O‑dec]
`supertable = id(t1), id3d(t2)` (göstergeler `"supertable"`, `"supertable3d"`); `table = t1, t2` (harf duyarsız) → `SuperTableRecord(t2, t1)` = (koşul, tablo id). Örnek `include/table-editor-1.2.32.ini:24-27` (`table = veTableTbl, {!alphan}`). 2 argümanlı `supertable = Boost_s_Table, "Gear Dependent Boost Target Table"` (`include/table-editor-boost-1.2.14.ini:31`) → başlık dizesi 3D id olur [O‑dec sonuç]. Koşulu true olan ilk kayıt gösterilir [I].

### 5.12 `[CurveEditor]` (parseCurveEditor) [O‑dec]
| anahtar | argümanlar |
|---|---|
| `curve` | id, `"başlık"` |
| `topicHelp` | x |
| `columnLabel` | a, b |
| `xAxis` / `yAxis` | double min, double max, int bölme, t4 (`"%.0f"` biçim) |
| `xBins` | sembol, t2 (realtime kanal), [t3 == `readonly` → salt‑okunur] |
| `yBins` | sembol, t2 |
| `gauge` | gösterge adı |
| `showHorizontalHelpLine`, `showVerticalHelpLine` | çıplak bayrak (harf duyarsız) |
| `xBinsSteps` / `yBinsSteps` | double küçük adım, double büyük adım (harf duyarsız) |
Örnek `include/curve-editor-1.2.32.ini:1-12, 85-97`. `xBins = SEQUENCE, batteryVoltage` (`:7`) — `SEQUENCE` dizesi binary'de var [O] → eksen dizisi yerine sıra/aralık [I]. `readonly` dağıtılan dosyalarda yok [O]. Gösterge adları (`throttleGauge` 1246, `mapGauge` 143, …) `GaugeDescriptors.xml`/`*.db` adlarıdır [O].

### 5.13 `[SuperCurve]` (parseSuperCurveEditor) [O‑dec]
`supercurve = id` (başlık t2 yok sayılır [O‑dec: yalnız id]); `curve = t1, t2` (harf duyarsız) → `SuperCurveRecord(t2, t1)`. Örnek `include/curve-editor-1.1.67.ini:252-254` (`curve = BoostCurve, { (boost_more_raw & 96) == 0 }`).

### 5.14 `[ExpressionGrid]` (parseExpressionGrid) [O‑dec]
| anahtar | işlem |
|---|---|
| `name = id, başlık` | yeni tanımlayıcı (disable_col = −1) |
| `row = c…` | satır ekle; hücre ifadesi = token metni |
| `col_format = sütun, int, hizalama` | |
| `cell_format = satır, sütun, int, hizalama` | |
| `link = satır, sütun, hedef, …` | tanımlayıcı token'lar bir listeye, diğerleri ikinci listeye, `{ifade}`'e kadar; fazla token → `TOO MANY PARAMETERS!` |
| `disable_col = n` | −1..cols−1 (`Invalid disableCol! [%d]`) |
| `help = satır, sütun, metin` | |
| `line_enable = satır, {ifade}` | |
| `cell_text = satır, sütun, {koşul}, "metin"` | |
| `cell_color = satır, sütun, {koşul}, fg, bg` | |
Hizalama `LEFT/RIGHT/CENTER` (`ExpressionGridDescHelper::parseAlign`); hücre türleri `NUMBER/VARIABLE/EXPRESSION/INVALID` [O]. Örnek `include/expression-grid-boost-refdc-1.2.32.ini` (`link = 4, 0, softrpm_dlg,boost_matdec` → hedef + alan sembolü; `cell_color = 0,2, {…},${0xff0000},${0x000000}` → renkler ifade token'ı `0xff0000`; RPN hex desteklemediği için yorumlanması [U]). `row` dizelerindeki `${kanal}` gömülü değer gösterimi [O dosya / I işleme]. `line_enable 2, {…}` (= yok, `include/expression-grid-pw-1.1.98.ini:6`) tokenizer için `=` gereksiz olduğundan **geçerlidir** [O‑dec kural]. `[ExpressionGrid]` içindeki serbest metin satırları (`include/expression-grid-config-overview-base.ini:191-222`) tanınmayan anahtar olarak yok sayılır.

### 5.15 `[InterpolationWidget]` (parseInterpolationWidget) [O‑dec]
`interpolationWidget = id, t2`; `realtime = kanal`; `xAxis`/`yAxis = double, double, int, t4, t5, t6`; **`x0`, `x1`, `y0`, `y1` = t1, t2, t3** — alan tipi `getType(2)`'den (2→NUMBER, 5→EXPRESSION, 1→VARIABLE [I eşleme]).
**Uyumsuzluk**: dağıtılan tek dosya (`include/interpolation-widget.ini:3-10`) `xMin/xMax/yMin/yMax = değer, {0|1}` kullanır; bu anahtarlar tanınmaz → uç noktalar hiç ayarlanmaz [O+O‑dec]. Bağımsız uygulama `xMin→x0, xMax→x1, yMin→y0, yMax→y1` eşlemesini kabul edebilir (ama VemsTune ile birebirlik için yok saymak gerekir).

### 5.16 `[SIPR]` (parseSIPRDescriptor) — tüm anahtarlar harf duyarsız [O‑dec]
| anahtar | işlem | örnek (`include/sipr-1.2.34.ini`) |
|---|---|---|
| `realtime_page = "A", "SIPR_RT_…"` | `addRealTimePage(t1, t2)` | :5-6 |
| `burnCommand = x` | `setBurnCommand(t1)` | :2 |
| `page = N, rdCmd, wrCmd, "SIPR_TYPE", tablolar…` | `addPage(N, t2, t3, t4, eeprom=0)` + k≥5 için `addSIPRTableToPage(N, tk)` | :12-51 |
| `page_eeprom = N, t2, t3` | `addPage(N, t2, "", t3, eeprom=1)`; tablolar k≥4 | :54 |
| `sipr_table = ad, i2, i3, t4` | `addSIPRTable` (ofset, uzunluk) | :56-86 |
| `sipr_config = ad, i2, i3, t4` | `addSIPRConfig` | :88-89 |
| `vt_2_ecu_id = i1, i2` | `addVt2EcuId(VT sayfa, ECU tablo id)` | :13 |
- `addPage` (0xbb599e) okuma/yazma komutlarını **dize olarak aynen** saklar ve tipe göre dallanır: `SIPR_GET_TABLEDATA`, `SIPR_GET_CONFIG_1`, `SIPR_GET_CONFIG_2`. `"0x82"`, `"c."`, `"("` dizelerinin protokolde bayta çevrilmesi izlenmedi [I: aşağı akış].
- **Eski biçim** (`page = 2, "SIPR_GET_TABLEDATA", "SIPR_TABLE_VE", …` — `cockpit-v3-1.1.27.ini:967`): konumlar sabit olduğundan t2 (`SIPR_GET_TABLEDATA`) okuma komutu, t3 (`SIPR_TABLE_VE`) yazma komutu, t4 SIPR tipi olarak saklanır → eski cockpit/pda/round.ini sayfaları VemsTune 1.5.46'da yanlış eşlenir [O‑dec kural + O dosya].
- Sayfa içeriği: tablolar sırayla birleşir; VE sayfası = `SIPR_TABLE_VE`@0+224 + `RPM`@224+16 + `KPA`@240+14 (`include/sipr.ini:13,40-42`); config1 = `CONFIG1`@0+248 + `CONFIG1_EXT`@248+7 [O]. Toplamlar Constants sayfa kapsamıyla tutarlı (1.2.34: sayfa 5 = 255, 9 = 229, 1 = 48, 7 = 224) [O, ini_matrix].
- Koşullu: `#if USE_RAW_LAMBDA_TABLE` sayfa 3 = `(`/`)` LAMBDA, aksi `l`/`L` EGOC (`MTConfigData::isRawLambdaUsed`) [O].
- SIPR adları: `SIPR_GET_{TABLEDATA, CONFIG_1, CONFIG_2}`, `SIPR_RT_MT_{NORMAL, EXT}`, `SIPR_TABLE_{H, VE, RPM, KPA, LAMBDA, EGOC, IGN, CONFIG1, CONFIG1_EXT, CONFIG2, BOOST_TPS, TEMPERATURE, BOOST_DC, MAPCORR, MAT_TPS_RETARD, ALT_KNOCK, A340E, VVTI, LAUNCH_RPM, CONFIG_SHARED, CONFIG_EEPROM}` [O]. Sürüm profilleri: FIRMWARE-MATRIX tablo B/C.

### 5.17 `[SRAM]` (parseSramSection) — harf duyarlı, `MTConfig+0x88` [O‑dec]
`readRealtimeEnabled` (bool), `maxSiprPacketLength` (+4), `maxReadSramLength` (+8), `maxReadSramTryCunt` (yazım hatası binary ile aynı, +0xc), `rtStruct = ad, int(t2)` → `SramRealtimeStruct{ad, Hz}`. Tek tanım `include/sram.ini` (include edilmiyor). İfadelerdeki `engine_t_*`, `etime_t_*` adları (`include/calc_com_model_extras.ini`) SRAM yapı alanlarıdır [I].

### 5.18 `[SymbolAlias]` (parseSymbolAlias) [O‑dec]
`mevcutSembol = takmaAd` → sembol varsa kopyası (`Symbol(const Symbol&)`) `t1` adıyla eklenir ve `existing->setAlias(t1)`; yoksa sessizce yok sayılır. Takma adlar firmware konfig dosyası (`*.txt`, `*.vemscfg`) tablo kodlarıdır: `j, j_r, j_k, l, l_r, l_k, n, n_r, n_k, t, b, b_r, bC, bD, p, e, e_r, e_k, y, y_r, y_k, i, i_r, i_k, w, w_r, w_k, s, f, f_r, f_k, z, z_r, k, r` (`_r` RPM ekseni, `_k` kPa ekseni) (`vemsTune-v3-1.2.34.ini:2684-2748`) [O]. İndeksli biçim `s[16]` desteklenmez (yorum `:2735-2738`).

### 5.19 `[UserData]` (parseUserData) [O‑dec]
`k = v` → `UserDataDesc(t0, t1)` listeye eklenir. Değer: `"HEX HEX …"` (357 satır, `vemsTune-v3-1.2.34.ini:2752-2761`) — sanal sayfa 31 sembollerinin bayt içeriği [O/I]. `boostGearBins = 128, 64, …` (`vemsTune-v3-1.1.63.ini:1823`) → yalnız `128` (t1) saklanır [O‑dec sonuç].

### 5.20 İşlenmeyen bölümler
- `[GaugeConfigurations]` (yalnız round; `vemsTune-round-0.2.0.ini:276-285`, MegaTune 11 argümanlı gösterge biçimi `ad = kanal, "Başlık", "birim", lo, hi, loD, loW, hiW, hiD, vDig, lDig`, `"%TEMP"` makrosu): **sevk edilmez** [O‑dec]; round göstergeleri `Round-GaugeDescriptors.db`'den [O].
- `[CheckboxMatrix]` (v3 1.1.53+, 48 dosya; `vemsTune-v3-1.2.34.ini:197-218`: `name`, `title`, `maskOrder`, `maskPinout`, `maskTitle`, `topicHelp`, `field = "INJGroup 0", h00`, `pinoutPanel = Econoseal36`): bilinmeyen bölüm → yok sayılır; `injGroupDialog` hiçbir menüden çağrılmaz [O‑dec+O].
- `[FrontPage]`, `[RunTime]`, `[Tuning]`: listede, işleyici çağrılmaz. `[ConfigTablesSavingOrder]`, `[SymbolMapping]`: boş işleyici. Hiçbiri dosyalarda yok [O].

---

## 6. İfade dili

### 6.1 Kullanım yerleri [O]
| yer | biçim | örnek |
|---|---|---|
| Output/Hidden/GPS/AIM hesaplanan kanal | `ad = {…}` | `vemsTune-v3-1.2.34.ini:1990` |
| Constants ifade dönüşümü | `{f(x)}, {g(x)}` | `include/page-config-1.1.18.ini:4` |
| Constants hesaplanan sabit | `{…}, {…}, hedef` | `include/page-config-1.1.81.ini:94` |
| bits doğrulama | son `{…}` | `include/page-h-1.1.77.ini:26` |
| field enable / hide | t3, t5 | `vemsTune-v3-1.2.34.ini:396` |
| subMenu koşulu | t4 | `vemsTune-v3-1.2.34.ini:137` |
| SuperTable/SuperCurve seçimi | t2 | `include/table-editor-1.2.32.ini:25` |
| ExpressionGrid `link/cell_text/cell_color/line_enable` | `{…}` | `include/expression-grid-boost-refdc-1.2.32.ini:6` |
| InterpolationWidget alan | `{0}`/`{1}` (tanınmayan anahtarlarda) | `include/interpolation-widget.ini:7` |

### 6.2 Motor seçimi [O‑dec]
INI ifadelerini **`RPNParser`** değerlendirir: Constants `{}` sembolleri (`STDataModelSerial::getValue` → `RPNParser::calculate`), OutputChannels ifadeleri (`RT2ViewerConverter`, `RTDataRawInputBase`), menü/diyalog koşulları (`UserDialogManager` ctor/`refreshMenu`). `ExpressionParser` (+`ExpressionFv*`) INI için **kullanılmaz**; çağıranları `HeaderParser` (firmware başlık `#if`), `TriggerSettingsValidator_NT`, `CustomValueGauge`, `RTDataStat`, `Config*` kural yöneticileri (`ConfigCriteria.xml`). Ek olarak `inifiles::IniFile_1_2_23`/`IniFile_1_2_31`: 1.2.23 ve 1.2.31 INI ifadelerinin derlenmiş C++ karşılıkları (FIRMWARE-MATRIX §1.4) [O].

### 6.3 RPN sözcük analizi (`RPNParser::parseInfix` 0xd88194) [O‑dec]
- Boşluk atlanır; işlenmeyen diğer karakterler (TAB, `%`, `.` tek başına) **sessizce düşer**.
- Operatör karakterleri `! & * + , / : = ? | ~`, ardından `= & |`'den biri gelirse ona eklenir (`&&`, `||`, `!=`, `==`); `<` → `<<`/`<=`, `>` → `>>`/`>=`.
- `"…"` dize; kapanmazsa `SyntaxError` (`Parsing error : missing "`).
- **Tanımlayıcı**: `[A-Za-z]` ile başlar, `[A-Za-z0-9_\[\]-]` ile devam eder — **`-` tanımlayıcının parçasıdır** (`a-b` tek ad; `rpm[-1]` tek token). **Ancak tanımlayıcı `]` eklendiği anda biter** (`parseInfix` @0xd88194, satır 224-228: `]` → `break`): `h1[0]-h1[1]` = `h1[0]` − `h1[1]` [O-dec, 2026-11-01; ConfigCriteria "Reference tooth table invalid" kuralı VemsTune çıktısıyla doğrulandı].
- Sayı: `[0-9.]` (`StringUtil::isNumber`); hex ve üs yok (`0x10` → `0` + değişken `x10`).
- `-`, ifade başında veya operatör/`(`/`,`/`:` sonrasında sayının parçasıdır (negatif literal); aksi ikili eksi.
- Dengesiz `(` → `SyntaxError` (`Parsing error : parentheses mismatch`). Her token `ExpressionFactory::create` (0xd8bdf0) ile düğüme çevrilir; tanınmayan (ör. tek `=`) NULL → düşer.

### 6.4 Öncelik ve değerlendirme (`infixToRpn` 0xd88ae2, `evaluate` 0xd894d6, `calculate` 0xd89856) [O‑dec]
Shunting‑yard; büyük değer daha sıkı bağlar; eşit öncelik pop'lanır → **hepsi soldan ilişkili** (`?:` dahil; `:` gelince `?`'e kadar pop).

| öncelik | operatörler |
|---|---|
| 160 | `~` |
| 150 | `!` |
| 140 | `*` `/` `mod` |
| 130 | `+` `-` |
| 120 | `<<` `>>` |
| 110 | `<` `<=` `>` `>=` |
| 100 | `==` `!=` |
| 90 | `&` |
| 80 | `^` |
| 70 | `\|` |
| 60 | `&&` |
| 50 | `\|\|` |
| 40 | `?` `:` |

Semantik:
- Değerler `double`. `& | ^ << >>` işlenenleri tamsayıya keser; `&& ||` 0/1 üretir.
- `/` düz double bölme, sıfır kontrolü yok (±inf/NaN). `mod` (kelime operatörü) sıfırda `division by zero` fırlatır; **`%` karakteri operatör değil** (düşer).
- İşlenenlerden biri sayı değilse operatör hiçbir şey push etmez.
- Boş yığın → 1.0 (boş `{}` = true).
- Ayrıştırılmış RPN listeleri ifade dizesine göre önbelleklenir (`RPNCache`); durumlu fonksiyon düğümleri (`sum`, GPS) önbellek nedeniyle değerlendirmeler arasında durum korur.
- Değişkenler veri kaynağının `getValue(ad)`'ından; bulunamazsa `variable not found : X`. Geçmiş indeksi: `getPVariables` (0xd8ad6a) `([^\[]*)\[(-?[0-9]+)\]` ile `ad[-N]`'i ayırır → N örnek önceki değer (`delta_rpm = { rpm - rpm[-1] }` — `vemsTune-v3-1.2.34.ini:2029`). Pozitif indeks (`engine_t_egt[1]` — `include/calc_com_model_extras.ini:3`) aynı regex'ten geçer [I: dizi elemanı/ileri indeks ayrımı belirsiz → U].

### 6.5 Fonksiyonlar [O‑dec argüman sayıları; argüman anlamları I]
| fonksiyon | argümanlar | not | örnek |
|---|---|---|---|
| `interpolate` | x0, x1, y0, y1, x (5) | `Math::linearInterpolation2D` | `include/calc-model-common-1.2.32.ini:222` (63 kullanım) |
| `interpolate2d` | `"binsSym"`, `"valuesSym"`, x | Constants dizi adları dize olarak | `vemsTune-v3-1.1.56.ini:2136` (1088) |
| `interpolate3d` | `"xBins"`, `"yBins"`, `"table"`, x, y | | `include/calc-model-common-1.2.32.ini:47` (87) |
| `table` | x, `"dosya.inc"` | `.inc` dosyası (MegaTune `DW` listesi) okunur; `file read error!`, `table not found!`, `invalid key!` | `vemsTune-v3-1.0.73.ini:488` (`WBlambda100MOT.inc` mevcut); `cockpit-v3-1.1.27.ini:1129` (`NBafr100.inc` **dağıtımda yok**) |
| `switchCase8` | sel, v0…v7 (9) | sel ∉ 0..7 → istisna | `vemsTune-v3-1.2.34.ini:2071` |
| `latch32` | kanal, enable, değer (3) | kanal 0..31; enable≠0 iken saklar, mandallı değeri döndürür | `vemsTune-v3-1.2.34.ini:2076` |
| `floor`, `log2`, `ln`, `exp` | 1 | `log2`/`ln` ≤0 → istisna; `log2` dosyalarda yok | `include/page-config-1.1.81.ini:94` |
| `sum` | 1 | kümülatif toplam (düğümde durum) | `include/section-gpsdata.ini:20` |
| `getGpsDistance`, `getGpsCourse` | 2 | durumlu | `include/section-gpsdata.ini:18-19` |
`abs`, `min`, `max`, `pow`, `sqrt` RPN'de **yok** (yalnız ExpressionParser'da: `abs acos asin atan atan2 ceil cos exp floor if log max min pow pow10 rand rnd sin sqr sqrt tan`) [O‑dec].

### 6.6 Bilinen değişkenler
OutputChannels/Hidden/GPS/AIM kanalları; Constants sembolleri (kullanıcı birimi; `_raw` sonekli ikizler ayrıca tanımlanır, ör. `iac2etctarget_raw`); bits (seçili indeks [I]); hesaplanan sabitler; `x` (yalnız dönüşüm ifadelerinde); `fw_major/fw_minor/fw_build` (commonParse) [O‑dec]; SymbolAlias kopyaları. Dosyalarda tanımsız kullanılanlar: `timeNow` (`vemsTune-round-0.2.0.ini:438`, binary'de yok), `cam_ext_offset` (`vemsTune-v3-1.2.33.ini:1938`), `pps_raw` (`vemsTune-v3-1.2.14.ini:2057`), COM_MODEL `engine_t_*`/`etime_t_*` (SRAM; §5.17) [O].

### 6.7 Dağıtılan ifadelerde RPN tuzakları [O, tools taraması]
- **Boşluksuz eksi** (13 ifade): `(pulseWidth-lagtime)` (`vemsTune-v3-1.1.50.ini:3343`), `injopen+battfac-(51.0*battfac*(batteryVoltage-1830.0/255.0))/309.0` (`vemsTune-v3-1.1.51.ini:3373`) → `pulseWidth-lagtime`, `battfac-`, `batteryVoltage-1830.0` tek tanımlayıcı olur → `variable not found`. Birebir uyum için bu davranış korunmalı; "doğru" sonuç istenirse ayrı bir uyumluluk modu gerekir.
- **`%`** (1): `{calc_spark_time % calc_tooth_time}` (`include/calc_com_model_extras.ini:34`) → `%` düşer, iki ardışık işlenen.
- **Hex** (78): yalnız ExpressionGrid renkleri (`{0xff0000}`).
- TAB içeren ifadeler (14) sorunsuz (TAB düşer, token sınırları başka karakterlerle oluşur).
- Tekli eksi tanımlayıcı/parantez önünde: 0 kullanım.
- Operatör kullanımları (tüm `{}`): `==` 8727, `&` 8277, `*` 6459, `?:` 6126, `/` 5816, `>` 5059, `+` 4165, `!` 3517, `-` 2838, `>>` 2714, `&&` 2669, `<` 1290, `!=` 766, `||` 385, `>=` 232, `<=` 79, `<<` 48, `|` 7; `^`, `~`, `mod` kullanılmaz.

### 6.8 Gerçekleme grameri (RPN ile eşdeğer)
```
expr    := cond
cond    := lor ( '?' lor ':' lor )*          ; soldan ilişkili (shunting-yard eşit öncelik pop)
lor     := land ( '||' land )*
land    := bor  ( '&&' bor )*
bor     := bxor ( '|' bxor )*
bxor    := band ( '^' band )*
band    := eq   ( '&' eq )*
eq      := rel  ( ('=='|'!=') rel )*
rel     := sh   ( ('<'|'<='|'>'|'>=') sh )*
sh      := add  ( ('<<'|'>>') add )*
add     := mul  ( ('+'|'-') mul )*
mul     := un   ( ('*'|'/'|'mod') un )*
un      := ('!'|'~') un | prim
prim    := NUM | '-'NUM (bağlama göre) | STRING | IDENT | FUNC '(' args ')' | '(' expr ')'
IDENT   := [A-Za-z][A-Za-z0-9_\[\-]*(\])?     ; '-' ve '[' dahil; ilk ']' tanımlayıcıyı bitirir
```
Not: `a ? b : c ? d : e` soldan ilişkili ayrıştırma C'den farklı sonuç verebilir; dağıtılan iç içe ternary'lerin tamamı parantezlidir (`(x) ? a : ((y) ? b : c)` — `vemsTune-v3-1.2.34.ini:2095`) [O] → pratikte fark yok [I].

### 6.9 calc-model dosyaları
`include/calc-model*.ini`: firmware hesaplarının VemsTune tarafı kopyası (ortak bayraklar, spark, warmup, lambda hedef, boost hedef/refDC, gamma, ivme, VE, launch, PW, misc, config özeti); `[OutputChannels]`/`[HiddenOutputChannels]` ifadeleridir ve `[ExpressionGrid]` görünümlerine `disp_*`/`calc_*` kanallarıyla veri sağlar [O]. 1.1.18–1.1.67'de bir kısmı `[Constants]` bağlamında include edildiği için hesaplanan sabit olarak da kaydedilir (§5.3.4).

---

## 7. Anahtar envanteri

### 7.1 Ayrıştırıcının desteklediği, dağıtılan dosyalarda kullanılmayanlar ("parser supports, unused in shipped files") [O‑dec + O]
- Bölümler: `[ConfigTablesSavingOrder]`, `[SymbolMapping]` (boş işleyici), `[FrontPage]`, `[RunTime]`, `[Tuning]` (listede, çağrılmaz); `[SRAM]` (tek tanım include edilmiyor).
- `[Constants]`: dizi düzeni öneki `X:`/`Y:`; tipler `S08`, `S16`, `S24`, `U24`/`S32`/`U32` dışındakiler, `F08…F32`.
- `[CurveEditor]`: `xBins = sym, kanal, readonly`.
- `[InterpolationWidget]`: `x0`, `x1`, `y0`, `y1` (dosyalar `xMin/xMax/yMin/yMax` kullanır).
- `[SRAM]`: tümü.
- İfade: `~`, `^`, `mod`, `log2`.
- `[Menu]`: başlangıç menü adı `"default"` (menüsüz `subMenu` buraya gider).

### 7.2 Dosyalarda olup ayrıştırıcının yok saydıkları [O‑dec]
`[CheckboxMatrix]`, `[GaugeConfigurations]` (tüm içerik); `[MegaTune] queryCommand/versionInfo/MTversion/writeXML`; `[OutputChannels] ochBlockSize`; `[Constants] nPages/pageSize/pageActivate/pageReadCommand/pageValueWrite/pageChunkWrite/burnCommand/endianness/verify/writeBlocks/interWriteDelay/pageActivationDelay`; `[Menu] plugIn`, `submenu`; `[TableEditor] upDownLabel/gridHeight/topicHelp` ve `table` t4; `[TableMapper] zBins` t3+; `[SuperCurve] supercurve` başlığı; `[UserDefined] filed/ffield`, `help` t2; `[InterpolationWidget] xMin/xMax/yMin/yMax`; `[Datalog]`/`[UserData]` fazla token'lar; `#define`, `#field`.

### 7.3 Envanter sayıları (inventory.py, tüm dosyalar) [O]
`[Menu]` menu 414, subMenu 4472, submenu 21, plugIn 32. `[UserDefined]` dialog 4139, field 55325, topicHelp 2667, text 656, help 76, filed 62, ffield 1. `[CurveEditor]` curve 1686, xAxis 1734, columnLabel 1709, yAxis 1699, xBins/yBins 1686, gauge 1537, yBinsSteps 1289, xBinsSteps 1287, topicHelp 287. `[TableEditor]` table/xBins/yBins/zBins/gridHeight 262, upDownLabel 270, numberWidth/numberPrec/largeCellStep/smallCellStep 246, useTableMapper 144. `[SIPR]` page 398, sipr_table 505, vt_2_ecu_id 173, realtime_page 86, sipr_config 86, burnCommand 58, page_eeprom 8. `[ExpressionGrid]` row 516, link 380, col_format 107, cell_format 87, cell_text 77, name 54, disable_col 48, line_enable 48, cell_color 40, help 18. `[Datalog]` entry 4260. `[SymbolAlias]` 1588. Benzersiz sembol adı: Constants 1877, OutputChannels 1208, HiddenOutputChannels 1393.

---

## 8. Dayanıklılık / tuhaflık listesi (uygulama birebir taklit etmeli) [O]
1. Virgül/`=` isteğe bağlı; konum token indeksiyle (§2.3).
2. Boş argüman token üretmez; `""` üretir.
3. `%` önekli satırlar etkin tanımlardır.
4. `.`, `!`, `(`, `)`, `+`, `$` gibi karakterler sessizce atılır.
5. Büyük `X` dizi şekilleri; `U8` geçersiz tip.
6. `submenu`, `filed`, `ffield` yok sayılır.
7. `{koşul}` yanlış konumdaysa kaybolur (subMenu/dialog t3).
8. Etkin olmayan `#if` içindeki include ve başlıklar bölüm durumunu yine değiştirir.
9. Aynı include iki kez → yinelenen semboller (1.1.67: 181).
10. Kesik `vemsTune-v3-1.1.60.ini` (2 açık `#if`, OutputChannels/Datalog yok).
11. RPN: tanımlayıcı içinde `-`, `%` operatör değil, hex yok, boş ifade = 1.
12. Eski biçim `[SIPR] page` satırları (cockpit/pda/round.ini) konum kayması.
13. InterpolationWidget anahtar uyumsuzluğu.
14. `NBafr100.inc` eksik; tanımsız değişken/sembol/menü hedefi referansları.
15. `yBinsSteps` ondalık virgül; `TableMapper zBins` 2'den fazla tablo.

## 9. Açık konular (Unknown)
1. `ParserException` (tip/dizi/bit hatası, `IF statement missing!`) nerede yakalanıyor: yalnız satır mı atlanıyor yoksa INI yüklemesi mi duruyor (`U8` satırları için kritik).
2. `dialog` t3 (1/5/6/9) ve `subMenu` t3 (0) değerlerinin UI anlamı.
3. `hideExpr` (t5) true iken göster mi gizle mi (dosya kullanımı "göster" anlamına işaret ediyor).
4. Dize komutlarının (`"0x82"`, `"c."`, `"("`) seri protokolde kodlanması — protokol spesifikasyonunda.
5. `ad[N]` (pozitif indeks) semantiği; bits sembolünün ifadede değeri (indeks mi etiket mi).
6. `Duplicate symbol` sonrası hangi tanımın kullanıldığı (map üzerine yazma varsayımı).
7. BOM'suz Latin‑1 dosyaların wxConvAuto ile dönüşümü.
8. `lookupOffset`'in kullandığı `config_t_*` sembollerinin kaynağı (fw_desc `global.h` ayrıştırıcısı varsayımı).
9. ExpressionGrid renk ifadelerinin (`0xff0000`) değerlendirilmesi.
