# VEMS Firmware Bellek Modeli (VemsTune 1.5.46 tersine mühendisliği)

Bu belge VEMS ECU firmware'inin **hangi byte'ın hangi sayfa/struct içinde durduğunu** ve bunun 1.0.73 → 1.2.34 (v3) ile Round 0.2 → 1.5.10 sürümleri boyunca nasıl değiştiğini tanımlar. Hedef: tüm eski/yeni firmware'leri destekleyen TypeScript/Electron tuner.

**İşaretleme:** **[O]** Observed (dosyada doğrudan görüldü), **[I]** Inferred (gözlemlerden çıkarım; doğrulama yöntemi belirtilmiştir), **[U]** Unknown (mevcut kanıtla çözülemedi).
Yol kısaltmaları: `T/` = `re/target/vemstune-1.5.46/`, `E/` = `re/evidence/fw-structs/`, `TOOL/` = `re/tools/fwstruct/`.

---

## 0. Kısa özet

- **[O]** v3 firmware'inde ECU tarafındaki tüm ayar bellek düzeni `global.h` içindeki struct'lardan gelir: `config_t`, `config_ext_t`, `config_shared_t`, `ve_t`, `ign_t`, `boost_t`, `hwmap_t`, `knock_noise_t`, `at_config_t` (+ `vvti_map_t`, `f_charge_t` opsiyonel). VemsTune "page"leri bu struct'ların **dilimleri**dir (bir struct birden çok sayfaya bölünebilir: `ve_t` → 6 sayfa, `boost_t` → 2 sayfa).
- **[O]** `config_t` **tüm v3 sürümlerinde 255 byte**tır (SIPR: `CONFIG1` 0..247 + `CONFIG1_EXT` 248..254). Boyut sabit kalırken alanlar defalarca yeniden adlandırılmış/yeniden amaçlandırılmıştır → sürümler arası ayar taşıma **ofsetle değil isimle** yapılmalıdır.
- **[O]** `global.h` ile `my_make.16x14/global.h` 81 sürümün hepsinde **byte-byte aynıdır** (1.1.19'da `my_make.16x14` yok). Fark yaratan şey ayrı bir `my_make` dosyasıdır ve **VemsTune paketinde hiçbir sürüm için bulunmaz**. **[I]** 16x14 release profili (`VE_SIZE_RPM=16, VE_SIZE_KPA=14, MAP_CORR, MAT_ENRICH, CAMSHAFT_ANGLE, CLT_IGN_ADJUST, KNOCK_ALTERNATIVE`) SIPR tablo boyutlarının **tamamını** (1.2.32'de A340E hariç 16/16) birebir verir.
- **[O]** Çapraz doğrulama (1.2.32 header ↔ `vemsTune-v3-1.2.32.ini`): 1264 sayfa girdisinden 1246'sı hatasız; **2 sert** uyumsuzluk (ETC'nin boost-DC sayfasını alan sınırı gözetmeden "overlay" etmesi), **3 yumuşak** (uint8_t[2] alanın U16 okunması), 9 adet 1-tabanlı isim indeksi (bilgi). SIPR boyutları: yalnızca `SIPR_TABLE_A340E` (ini 211 ↔ `at_config_t` 131) uyuşmaz.
- **[O]** 1.2.33/1.2.34 için header yoktur; ini'ler `config_shared_t`'yi 35/37 byte'a büyütür (`mux_*`, `cam_refdc_*_down`) → 1.2.32 header'ı ile 8/10 sert uyumsuzluk (beklenen evrim).
- v3: 82 header → **34 katı (strict) layout ailesi**, **17 boyut ailesi**. Round: 35 header → 19 katı aile; Round `0.x` ve `1.x` hatları büyük ölçüde **aynı header**ı paylaşır.

---

## 1. Kaynaklar ve araç

### 1.1 Girdi dosyaları
| Kaynak | İçerik | Not |
|---|---|---|
| `T/config/fw_desc/firmware_<ver>/global.h` (82 adet, 1.0.73 … 1.2.32) | v3 struct tanımları | **[O]** |
| `T/config/fw_desc/firmware_<ver>/my_make.16x14/global.h` | aynısı (81 adet) | **[O]** sha256 eşit, bkz. `E/<ver>.json → my_make_16x14.identical_to_base` |
| `T/config/fw_desc/round_<ver>/global.h` (35 adet) | Round tek `config_t` | **[O]** |
| `T/vemsprojects/*/global.h` | fw_desc kopyaları | **[O]** 1.0.75/76/80, 1.1.27, 1.1.94(+BootUpdate), round_1.4.4: hepsi fw_desc ile birebir aynı |
| `T/vemsprojects/firmware_1.1.27/{varstr,magicstr}.h` | `bin/get_name.pl` çıktısı: `_varname_str_<hexofs>` | **[O]** indeks = `config_t` byte ofseti |
| `T/config/include/sipr-*.ini` | page ↔ SIPR tablo ↔ boyut | **[O]** |
| `T/config/include/page-*.ini`, `T/config/vemsTune-v3-<ver>.ini` | sayfa içi ofsetler | **[O]** bazıları UTF-8 BOM ile başlar (`page-matcorr-8x8*.ini`) |
| `T/defaultfirmwareconfigs/config_<ver>.vemscfg` | VemsTune'un header'dan ürettiği `isim=hex` dökümü | **[O]** alan sırası header ile aynı |
| `T/config/sramsections.json` | RAM bölüm (değişken) listesi | **[O]** |
| `re/evidence/strings.txt` | vemsTune.exe string'leri | HeaderParser davranışı için |

### 1.2 Araç: `TOOL/`
| Dosya | Görev |
|---|---|
| `cparse.py` | Yorum ayıklama, satır birleştirme, tam C ön-işlemci (`#define` obj/func, `#undef`, `#if/#ifdef/#ifndef/#elif/#else/#endif`, `defined()`, aritmetik/mantıksal ifade), struct/union/enum/typedef, iç içe ve anonim aggregate, bitfield (LSB-first), makro boyutlu çok boyutlu diziler, fonksiyon işaretçileri, `__attribute__` atlama, fonksiyon gövdelerini atlama |
| `fwstruct.py` | 117 header'ı iki profil ile (`bare`, `release16x14`) çözer → `E/<ver>.json`, `E/round-<ver>.json`, `E/index.json` |
| `siprmap.py` | page ↔ SIPR tablo ↔ struct dilimi eşlemesi (anchor alanlar) |
| `inifile.py` | VemsTune ini okuyucu (`#include`, `[SIPR]`, `[Constants]`, BOM) |
| `crosscheck.py` | A) ini ofsetleri, B) SIPR boyutları, C) vemscfg, D) varstr.h, E) Round ofset yorumları + round ini → `E/crosscheck-*.json`, `E/crosscheck-report.txt` |
| `evolve.py` | sürümler arası diff + aileler → `E/evolution.json`, `E/families.json`, `E/evolution-report.txt` |
| `test_cparse.py` | ABI kuralları için öz-test |
| `run_all.py` | tüm hat |

Çalıştırma: `C:/Users/erdem/AppData/Local/Programs/Python/Python312/python.exe -I re/tools/fwstruct/run_all.py`

`E/<ver>.json` şeması: `{version, product, source, sha256, my_make_16x14, vemsprojects_copies, includes, conditional_symbols, struct_conditionals, profiles:{<profil>:{my_make_defines, effective_macros, diagnostics, struct_order, typedefs, structs:{<ad>:{size,line,kind,fields:[{name,offset,size,type,elem_size,dims,dims_expr,bit_offset,bit_width,signed,ref,cond,comment,line,members}]}}}}}`.

### 1.3 VemsTune'un kendi header ayrıştırıcısı (taklit edilen davranış)
- **[O]** `HeaderParser::{parse, parseLine, parseMyMake, doIfdefCheck, checkIfCondition, createDefine, removeDefine, createNewStruct, parseStructLine, findStructDescr, stripComments}`, `StructDescriptor::{addVariable, printStructure}`, `SramSectionFiller::{parseFiles, createParts, setAddressAndSize, createSymbols, fill}` (`re/evidence/strings.txt` satır 490-499, 44525-44567).
- **[O]** Tanınan direktifler: `#endif #else #ifdef #ifndef #define #undef #warning #error`; atılan niteleyiciler `static EXTERN extern volatile`; struct regex'leri `struct ([0-9a-zA-Z_]*?) {` ve `struct ([0-9a-zA-Z_]*?) ([0-9a-zA-Z_\[\]]*).*;`; `defined` regex'i `(defined\s*\(?\s*)([0-9a-zA-Z_]*)(\s*\)?)?`; izinli tipler **yalnızca** `uint8_t int8_t uint16_t int16_t uint32_t int32_t struct` ("ERROR: unknown type … (allowed types are: uint8/16/32_t, struct)", "is pointer") (strings.txt 124635-124666).
- **[O]** `my_make` satır regex'i: `^\s*MY_CONF\s*\+=\s*\-D\s([A-Za-z0-9_=]*)` (strings.txt 123690 civarı, `00ca82b0`). Yani my_make girdileri `MY_CONF += -D VE_SIZE_RPM=16` biçimindedir.
- **[O]** Ek okunan header'lar: `pid.h softpwm.h heap.h comm.h`, harita dosyası `vems.map` regex'i `\s+0x([0]{0,8})0080([a-fA-F\d]{4})\s+([a-zA-Z0-9_]+)` (AVR data-space 0x800000 + SRAM adresi). Hata: "or global.h/map file/mymake is missing".
- **[O]** Ayrı, daha basit bir `ParseHeader` sınıfı yalnızca `struct config_t {`, `struct config_ext_t {`, `struct config_shared_t {` bloklarını ve `uint8/16/32_t` + sayısal dizi boyutunu (`^\s*([^\[]+)\[(\d+)\]`) tanır; config.txt/vemscfg eşlemesi için ("Symbol: %s in config.txt not found in global.h!"). **[O]** 1.2.32 header'ındaki uyarı bununla tutarlı: *"DO NOT PUT IFDEFS here unless you teach stru.pl to parse my_make. Otherwise magicstr will be offsetted"* (`firmware_1.2.32/global.h` `struct config_t` öncesi). Gerçekten de hiçbir sürümde `config_t/config_ext_t/config_shared_t` gövdesinde `#if` yoktur (`E/*.json → struct_conditionals`).
- **[I]** Bizim `cparse.py` bunun üst kümesidir: `#if A>B` gibi ifadeleri gerçekten değerlendirir. VemsTune'un `checkIfCondition`'ının `#if IGNCHANNELS>8`, `#if KNOCK_SIZE_KPA>1` gibi karşılaştırmaları nasıl değerlendirdiği **[U]** (sayfa struct'larını etkileyen tek örnek 1.2.15+ `knock_noise_t`'dir; release değerinde `KNOCK_SIZE_KPA=4` header'da sabit).

---

## 2. ABI kuralları (avr-gcc)

| Kural | Durum | Doğrulama |
|---|---|---|
| Hizalama 1, struct içi/sonu padding yok | **[I]** | 1.2.32'de A340E hariç tüm SIPR tablo boyutları + `config_t`=255, Round `uint16_t aim_b0..4` ofsetleri (`/* 0x49 */` vb. 13-14 ofset yorumu/sürüm, 0 sapma) ve round ini `aim_b0 = U16 @81` |
| `uint8/int8/char`=1, `uint16/int16/short/int/unsigned`=2, `uint32/int32/long/float/double`=4, pointer=2 | **[I]** (avr-gcc standardı) | Round U16 ofsetleri; v3 `engine_t` için doğrulanamaz |
| Little-endian çok byte'lı alanlar | **[I]** | ini `U16` görünümleri (`tooth_wheel_twidth`, `inj_size`) LE byte çiftini okur |
| `enum` = 2 byte (`-fshort-enums` yok) | **[I]**/**[U]** | Sayfa struct'larında enum yok → pratikte etkisiz |
| Bitfield LSB-first, ardışık paketleme | **[I]** | Hiçbir `global.h`'de bitfield **yok** (**[O]** grep); bit alanları ini'de `bits, U08, ofs, [a:b]` ile ifade edilir |

---

## 3. Ürün hatları

| | v3 (Genboard v3, `firmware_*`) | Round (WBO2/AIM gösterge, `round_*`) |
|---|---|---|
| Header satırı | 829 → 2393 | 92 → 184 |
| Struct'lar | `time_t squirt_t engine_t config_t (+config_ext_t, config_shared_t, ve_t, ign_t, boost_t, hwmap_t, knock_noise_t, at_config_t, vvti_map_t, f_charge_t, table_*_t, config_multi_t)` | yalnızca `config_t` |
| Koşullu derleme | yoğun (`#ifdef` ~50 sembol) | yok |
| SIPR | 15+ tablo, `vt_2_ecu_id` | tek: `page = 5, "c.", "C", "SIPR_GET_CONFIG_1"`, `vt_2_ecu_id = 5,0`, `sipr_config = "SIPR_GET_CONFIG_1", 0, <boyut>` (**[O]** `T/config/vemsTune-round-1.5.10.ini` 16-25) |
| 16-bit alan | `config_*`'da yok | `uint16_t aim_b0..aim_b4` |
| Signature | `"VEMS v1.2.32 16x14 kpa=2,2"` | `"VEMS Round WBO2 v1.5.10"` |
| Header yorumu | `config_t` "Max 248" (EEPROM) | `config_t {/* must less size than 249byte*/` |

**[O]** Round `0.x` ve `1.x` sürümleri pairwise aynı header'ı kullanır: `{0.4.6,0.4.8,1.4.6,1.4.8}`, `{0.5.0,1.5.0}`, `{0.5.1,1.5.1}`, `{0.5.2,1.5.2}`, `{0.5.3,1.5.3}`, `{0.5.5,0.5.6,1.5.4,1.5.5,1.5.6}`, `{0.5.7..0.5.10,1.5.7..1.5.10}` (sha256 eşit; `E/families.json → products.round.identical_headers`). **[I]** 0.x/1.x farkı layout değil, donanım/bootloader varyantıdır.

---

## 4. Sayfa ↔ SIPR tablo ↔ struct haritası (v3)

### 4.1 Tablo (1.2.32 release16x14; boyutlar hesaplanan = ini)
Kaynak: `T/config/include/sipr-1.2.32.ini`, `sipr-1.2.34.ini`, `TOOL/siprmap.py`, `E/crosscheck-ini-1.2.32.json → sipr_tables`.

| VT page | rd/wr | SIPR get tipi | SIPR tablo | ecu id | Struct dilimi (başlangıç alanı → bitiş) | Struct ofset | Boyut |
|---|---|---|---|---|---|---|---|
| 1 | `h`/`H` | TABLEDATA | `SIPR_TABLE_H` | 1 | `hwmap_t` (tamamı, `table[HWMAP_SIZE*HWMAP_LINES]`) | 0 | 48 |
| 2 | `j`/`J` | TABLEDATA | `SIPR_TABLE_VE` (+ alt tablolar `SIPR_TABLE_RPM` 224/16, `SIPR_TABLE_KPA` 240/14) | 10 | `ve_t.ve8_table … kpa_range` | 0 | 254 |
| 3 | `(`/`)` veya `l`/`L` | TABLEDATA | `SIPR_TABLE_LAMBDA` (USE_RAW_LAMBDA_TABLE) / `SIPR_TABLE_EGOC` | 8 / 9 | `ve_t.lambda … lambda_kpa_range` | 254 | 80 |
| 4 | `n`/`N` | TABLEDATA | `SIPR_TABLE_IGN` | 14 | `ign_t` | 0 | 168 |
| 5 | `o`/`O` | **CONFIG_1** | `SIPR_TABLE_CONFIG1` + `SIPR_TABLE_CONFIG1_EXT` | 0 | `config_t` [0..247] + [248..254] | 0 | 248+7 |
| 6 | `t`/`T` | TABLEDATA | `SIPR_TABLE_BOOST_TPS` | 2 | `boost_t.tpstransfer_table … anytrim1_array` | 0 | 239 |
| 7 | `e`/`E` | TABLEDATA | `SIPR_TABLE_TEMPERATURE` | 4 | `ve_t.mat_enrich … camshaft_kpa_range` | 494 | 224 |
| 8 | `y`/`Y` | TABLEDATA | `SIPR_TABLE_BOOST_DC` | 15 | `boost_t.{union boost_ref_table / at_config_at} … boost_ref_kpa_range` | 239 | 168 |
| 9 | `g`/`G` | **CONFIG_2** | `SIPR_TABLE_CONFIG2` | 3 | `config_ext_t` | 0 | 229 |
| 10 | `i`/`I` | TABLEDATA | `SIPR_TABLE_MAPCORR` | 12 | `ve_t.map_corr … map_corr_kpa_range` | 414 | 80 |
| 11 | `w`/`W` | TABLEDATA | `SIPR_TABLE_MAT_TPS_RETARD` | 13 | `ve_t.mat_retard … tps_range` | 334 | 80 |
| 12 | `f`/`F` | TABLEDATA | `SIPR_TABLE_ALT_KNOCK` (`#if KNOCK_ALTERNATIVE`) | 17 | `knock_noise_t` | 0 | 44 |
| 13 | `u`/`U` | TABLEDATA | `SIPR_TABLE_A340E` (`#if A340E`) | 5 | `at_config_t` (RAM'de `boost_t` union'ı) | — | ini **211** ↔ C **131** ✗ |
| 15 | `[`/`]` | TABLEDATA | `SIPR_TABLE_LAUNCH_RPM` | 6 | `ve_t.launch_rpmtable … clt_ign_adjust_kpa_range` | 718 | 40 |
| 16 | `0x82`/`0x83` | TABLEDATA | `SIPR_TABLE_CONFIG_SHARED` | 7 | `config_shared_t` | 0 | 33 |
| 30 | (map dosyası id) | TABLEDATA | `SIPR_TABLE_CONFIG_EEPROM` (`page_eeprom`) | — | **global.h'de struct yok** (64 byte EEPROM alanı; `page-eeprom*.ini`: `adcN_type`, `custom_curve[17]` …) | — | 64 |
| 31 | — | — | — | — | **VIRTUAL TABLE**: VemsTune-yerel, ECU'ya gitmez (`vemsTune-v3-1.2.32.ini` "; VIRTUAL TABLE") | — | 176 |
| -1 | — | — | — | — | `page-mdx-*.ini` (`#if COM_MODEL`), ECU sayfası değil | — | — |
| (yok) | — | — | `SIPR_TABLE_VVTI` (yalnız `sipr.ini`…`sipr-1.1.81.ini`, 168) | — | `vvti_map_t` (`uint8_t vvti[IGNADV_SIZE]`=144) **[U]** 168↔144 | — | — |

Notlar:
- **[O]** Realtime: `realtime_page = "A", "SIPR_RT_MT_NORMAL"` ve `"D", "SIPR_RT_MT_EXT"`; `burnCommand = "B"`; `sipr_config = "SIPR_GET_CONFIG_1", 0, 255` ve `"SIPR_GET_CONFIG_2", 0, 229` (sipr-1.2.32.ini). Realtime paket düzeni bu belgenin kapsamı dışında (`engine_t` RAM imajı değildir).
- **[O]** ETC parametreleri `page 8`'i bindirir (`page-boost-1.2.32.ini` "; E-throttle reusing boostAlt", `etc_*` 0..157, "; MAX 156"): alan sınırlarını gözetmez (aşağıda §8.1).
- **[O]** `#if A340E` iken ini A340E alanlarını da **page 8** üzerinde tanımlar (`page-boost-1.2.32.ini` 74-159) = `boost_t` içindeki `union { boost_ref_table; struct at_config_t at_config_at; }`. Bizim kontrolde bu alanlar `at_config_t` ile birebir eşleşti (0 sapma).
- **[I]** `ve_t`'nin sayfa sınırları `siprmap.py` anchor kuralıyla (bir sonraki dilimin ilk alanı) bulunur; 1.1.84–1.2.32 tüm sürümlerde SIPR boyutlarıyla birebir tutar (`E/crosscheck-report.txt` A/B bölümü).

### 4.2 Depolama aggregate'leri (sayfa değil)
- **[O]** `struct table_config_t { config_t config; config_ext_t config_ext; ve_t ve; ign_t ign; boost_t boost; hwmap_t hwmap; }` (1.2.32: 0/255/484/1242/1410/1817 → 1865) ve `table_config_A`, `table_config_multi[STOREDMAPCOUNT=1]`; `struct table_shared_t { config_shared_t config_s; knock_noise_t knock_table; [f_charge_t]; [vvti_map_t]; }` (77). **[I]** Bunlar flash/EEPROM kalıcı depolama ve "config A/B" (`config_switch`, `STATUS4_CONFSW`) için; VemsTune sayfa I/O'su bunları değil SIPR tablolarını kullanır.
- **[O]** `config_multi_t { config_t; config_ext_t; }` = 438 (1.1.50–1.1.82), 1.1.84'te `table_config_t` ile yer değiştirdi.
- **[O]** Yorum: `config_shared_t` "Max size should be no more then 248 byte … EEPROM storege adresses are hardcoded to this limit too. See sipr_protocol.c!".

### 4.3 RAM (SRAM) bölümleri
- **[O]** `T/config/sramsections.json`: `config, hwmap, config_ext, ve, at_config, config_s, f_charge, ign, boost, vvti_map, knock_table, etime, wbo2, wbo2_2, engine, h1`.
- **[O]** global.h'de değişken tanımı/extern'i olanlar: `config, config_ext, config_s, ve, ign, boost, hwmap, knock_table, f_charge, vvti_map, engine, rtc`; `at_config` = `#define at_config boost.at_config_at` (A340E).
- **[U]** `etime`, `wbo2`, `wbo2_2`, `h1` tipleri global.h'de yok (muhtemelen `eventqueue.h`, wbo2 başlıkları; paketle gelmiyor).
- **[I]** VemsTune bu bölümleri `vems.map` adres + header boyutu ile okur (`SramSectionFiller::setAddressAndSize`, "Address not found. Struct name =", "Size not found. Struct name ="). `vems.map` paket içinde yok → **[U]** bu yol fiilen sadece geliştirici projelerinde çalışır.
- **[O]** `engine_t` 1.2.14+ sürümlerde `struct pid_t ETC_piddata` (pid.h) içerdiği için boyutu çözülemez; 1.2.32'de ofset 41'e kadar bilinir (`prohibit_status@0 … etc_mismatchcnt@40, ETC_piddata@41`), sonrası **[U]**. 1.2.14 öncesi `engine_t` tamamen çözülür (44 → 111 byte).

---

## 5. Struct kataloğu

### 5.1 1.2.32 (release16x14) — `E/1.2.32.json`
| Struct | Boyut | Alan sayısı | İçerik / alt bloklar (ofset[boyut]) |
|---|---|---|---|
| `config_t` | 255 | 230 | F1..F12 grupları; `warmup_clt[10]@18`, `tpsdotrate[4]@44`, `tpsaq[4]@48`, `iac_ref_pos[10]`, `tooth_wheel_twidth[2]@190`; 248..254 = `fuelcut_max_kpa, tach_channel, tach_div, shiftcut_conf_input, shiftcut_tpsthresh, shiftcut_time, softrpm_rpm` (= `CONFIG1_EXT`) |
| `config_ext_t` | 229 | 115 | `gears[6]`, `cylinder_order[3]`, `knock_gain[8]`, `knock_reference[8]`, `inj_deadtime[5]`, `cranking_clt_range[4]`, `crank_enrich[4]`, `afterstart_enrich[4]`, `accel_rpm[4]`, `accel_scale[4]`, `inj_size[2]@136`, `clt_curve[17]`, `mat_curve[17]`, `clt_range[10]`, `anytrim4_array[17]@191`, `anytrim5_array[17]@208`, `idleup_*@225..228` |
| `config_shared_t` | 33 | 15 | `prohibit_config@0, prohibit_h, prohibit_l, config_switch@3, vtstorage[7]@4, blab[8]@11, fix_retard[5]@19, wbo2_pump_pw_zero2@24, wbo2_nernstdc_target2, wbo2_calibration2, ibutton_code2[2]@27, fuelcut_delay@29, iac2etctarget@30, wbo2_ri_target2@31, wbo2_config@32` |
| `ve_t` | 758 | 23 | `ve8_table@0[224] rpm_range@224[16] kpa_range@240[14] │ lambda@254[64] lambda_rpm_range@318[8] lambda_kpa_range@326[8] │ mat_retard@334[64] mat_range@398[8] tps_range@406[8] │ map_corr@414[64] …rpm@478 …kpa@486 │ mat_enrich@494[64] emat_range@558 etps_range@566 camshaft_angleI@574[64] camshaft_angleE@638[64] camshaft_rpm_range@702 camshaft_kpa_range@710 │ launch_rpmtable@718[16] clt_ign_adjust@734[16] …clt_range@750[4] …kpa_range@754[4]` |
| `ign_t` | 168 | 3 | `adv_table@0[144] adv_table_rpm_range@144[12] adv_table_kpa_range@156[12]` (12x12, `IGNADV_SIZE_*` header'da sabit) |
| `boost_t` | 407 | 10 | `tpstransfer_table@0[8] boostmaxtarget_table@8[72] boostpidrefpwm_table@80[72] rotary_trailing_spark@152[12] inj_angle@164[12] boostgear_rpmrange@176[12] anytrim1_array@188[51] │ union{boost_ref_table[144] / at_config_at}@239 boost_ref_rpm_range@383[12] boost_ref_kpa_range@395[12]` |
| `hwmap_t` | 48 | 1 | `table[48]` (6 satır × 8) |
| `knock_noise_t` | 44 | 3 | `knock_noise@0[32] rpm_range@32[8] kpa_range@40[4]` (`KNOCK_SIZE_KPA=4`) |
| `at_config_t` | 131 | 31 | `shift_up[3][8]@0, shift_dn[3][8]@24, lockup_lock[8], … at_temp_curve[17]@113, at_temp_channel@130` |
| `time_t` | 4 | 3 | `tsec, sec(u16), adc_clk(#ifndef WBO2)` |
| `squirt_t` | 4 | 2 | `stopat(u16), pwcalc(u16)` |
| `engine_t` | **[U]** | 83 | bkz. §4.3 |
| `table_shared_t` / `table_config_t` | 77 / 1865 | | §4.2 |

`bare` profil (my_make yok) farkı: `ve_t` = 256 (8x8 VE + lambda + mat_retard + launch; `MAP_CORR/MAT_ENRICH/CAMSHAFT_ANGLE/CLT_IGN_ADJUST` yok), `knock_noise_t` yok → `table_shared_t`=33. **[I]** VemsTune my_make bulamazsa bu `bare` görünümü üretir; SIPR ini boyutlarıyla uyuşmaz, dolayısıyla tuner my_make'e değil **SIPR/ini boyutlarına** güvenmelidir.

### 5.2 Layout'u etkileyen derleme seçenekleri
| Sembol | Etkilediği struct | Kaynak | Release değeri |
|---|---|---|---|
| `VE_SIZE_RPM`, `VE_SIZE_KPA` (`#ifndef` → 8) | `ve_t.ve8_table/rpm_range/kpa_range` | my_make | **16, 14** [I] (signature "16x14", SIPR VE 254) ; ≤1.1.49 ini'lerde 12x12 [O] |
| `MAP_CORR` | `ve_t.map_corr*` (+80) | my_make | tanımlı [I] (SIPR MAPCORR 80) |
| `MAT_ENRICH` | `ve_t.mat_enrich*` (+80) | my_make | tanımlı [I] |
| `CAMSHAFT_ANGLE` | `ve_t.camshaft_*` (+144), `engine_t` | my_make | tanımlı [I] (TEMPERATURE 224) |
| `CLT_IGN_ADJUST` (1.2.22+) | `ve_t.clt_ign_adjust*` (+24), `engine_t` | my_make | tanımlı [I] (LAUNCH_RPM 40) |
| `KNOCK_ALTERNATIVE` | `knock_noise_t`, `table_shared_t`, `engine_t` | my_make | tanımlı [I] (ini `#if KNOCK_ALTERNATIVE` sayfa 12) |
| `KNOCK_SIZE_RPM/KPA` | `knock_noise_t` | header sabiti | 12/12 (1.1.88), 8/8 (1.1.89+), 8/1→16B (1.2.14), 8/4 (1.2.15+) [O] |
| `A340E` | `boost_t` union, `table_shared_t` (1.1.84–87) | my_make | tanımsız [I] |
| `TOYOTA_1JZ_VVTI`, `CHARGE_TEMP` | `vvti_map_t`, `f_charge_t`, `table_shared_t` | my_make | tanımsız [I] |
| `NOIGN`, `BOOSTCONTROL(_GEARS)`, `HWMAP` | `table_config_t`, `boost_t` boyutu (`BOOSTCONTROL_GEARS*12`) | header varsayılanı (`6`, `HWMAP` tanımlı) | [O] |
| `IGNCHANNELS` (varsayılan 10), `WBO2`, `GENBOARDv3`, `ALS`, `SOFTRPM`, `INJ_ANGLE`, … | yalnızca `engine_t`/`time_t`/`squirt_t` | header/my_make | sayfa layout'unu etkilemez [O] |

**[O]** `vemscfg` başlıklarında `# CompileOptions: 00000003 / 1B / 1A / 1E / 5E / 5F / DE` görülür (1.1.56…1.2.34), `FirmwareInfo::setFirmwareCompileOptions` mevcut. **[U]** bitlerin anlamı; **[I]** ini'deki `#if KNOCK_ALTERNATIVE / A340E / TOYOTA_1JZ_VVTI / HIGHBOOST / KPACONFRES_4` koşulları bu maske + signature'dan (`kpa=2,1` ↔ `kpa=2,2`) beslenir.

---

## 6. `my_make.16x14`'ün rolü

1. **[O]** Her `firmware_<ver>/` altında `my_make.16x14/` dizini vardır ve içinde yalnızca **aynı** `global.h` bulunur (81/81 sha256 eşit; 1.1.19'da dizin yok). `vemsprojects/firmware_1.1.94/my_make.16x14/` ise ek olarak **farklı** `vems.hex/vems.uhex` içerir (279523 B vs kök 277248 B) → dizin adı bir **derleme varyantı**nı (my_make dosyası `my_make.16x14`) temsil eder.
2. **[O]** vemsTune.exe string'leri: `"my_make"`, `".16x14"`, `"my_make.16x14/"`, `"global.h"`, `"vems.map"` (strings.txt 124679, 126647-126653, 126952, 128045, 128445-128446); `vemsprj` dosyaları header'ı `path="my_make.16x14/global.h"` ile gösterir (`T/vemsprojects/firmware_1.1.27/audi-16x14.vemsprj`).
3. **[I]** VemsTune firmware dizininde `my_make.16x14/` alt dizinini tercih eder; içinde `my_make` dosyası olsaydı `MY_CONF += -D …` satırlarını define olarak yükleyecekti. Paket bu dosyayı içermediği için header'ın "çıplak" hali okunur; asıl sayfa boyutları ini/SIPR'dan gelir.
4. **[O]** VE boyut tarihi: `vemsTune-v3-1.0.00 … 1.1.49.ini` signature `"… 12x12 kpa=2,2"`, `1.1.50+` `"… 16x14 kpa=2,2"`; `page-ve.ini` her iki dalı içerir; `audi-12x12.vemsprj` (1.1.27) 12x12 varyantını gösterir. **[I]** 1.1.50 öncesi firmware'ler 12x12 (veya seçime göre 16x14) derlenebiliyordu; ≤1.1.49 ini'lerinde ign/lambda tabloları da VE eksenini paylaşır (`page-spark-veAxis.ini`, `page-lambda-veAxis.ini`).

---

## 7. Evrim zaman çizelgesi (v3)

Tam liste: `E/evolution-report.txt`, ayrıntı `E/evolution.json → products.v3.changes`. Önemli adımlar:

| Sürüm | Değişiklik | Durum |
|---|---|---|
| 1.0.73–1.0.75 | Yalnız `config_t` (255); tablo struct'ları global.h'de yok ve `ve.h` de dahil edilmiyor (yalnız `hwdef_v2.h`, 1.0.73–1.1.27) | [O]; yerleri [U] |
| 1.0.76 | `config_ext_t` doğar (16) | [O] |
| 1.0.80 | `config_ext_t` 27 (`boostsw_conf, confswitch, accel_rpm[4], accel_scale[4], inj_stage2_conf`) | [O] |
| 1.1.19–1.1.27 | `config_ext_t` **yok**; `config_t` 134/135/180/207 baytları yeniden adlandırıldı (`wbo2_edgetime_* → als_retard_rpm1/2`, `ign_balance → als_igncut_rpm2`, `als_deact_rpm → als_igncut_rpm1`) | [O]; **[I]** 1.1.x hattı 1.0.75'ten dallanmış, 1.0.76/1.0.80 ayrı dal |
| 1.1.19–1.1.82 | `#include "ve.h"` (38 sürüm): `ve_t` vb. **paketle gelmeyen** header'da | [O] → layout **[U]**, yalnız SIPR boyutları [O] |
| 1.1.42 | `config_ext_t` 110; `config_t`'de `warmup_clt_range[8]@8` → 8 yeni skaler (`shiftcut_*`, `boost_matdec`…) — byte uyumlu, anlam uyumsuz | [O] |
| 1.1.50 | `config_ext_t` 183; `config_multi_t`; `ve_learn_*` (170..175) kaldırıldı; `tooth_wheel_twidth1/2` → `[2]` | [O] |
| 1.1.51–1.1.82 | `config_t`/`config_ext_t` içinde sürekli yeniden adlandırma; `blabla*/bla*` yer tutucuları büyüyüp küçülür (boyut sabit 255/183) | [O] |
| 1.1.67→1.1.77→1.1.80 | SIPR `BOOST_TPS` 181→227→239, `H` 24→48 (hwmap 3→6 satır; vemscfg `h` 3→6 satır) | [O] sipr-*.ini, vemscfg |
| 1.1.81 | SIPR `TEMPERATURE` 80→224 (cam açısı tabloları) | [O] |
| 1.1.84 | Tablo struct'ları global.h'ye taşındı: `ve_t` 734, `ign_t` 168, `boost_t` 407, `hwmap_t` 48, `config_shared_t` 4, `table_*_t`; `misc2out_*` `config_t`'den `config_ext_t`'ye taşındı (config_ext'te 6 alan kaydı) | [O] |
| 1.1.88 | `knock_noise_t` 168 (12x12), `at_config_t` 131 | [O] |
| 1.1.89 | `knock_noise_t` 80 (8x8) | [O] |
| 1.1.91 | `config_shared_t` 19 (`vtstorage[7]`, `blab[8]` — `config_ext_t`'den taşındı) | [O] |
| 1.1.98 | `config_shared_t` 24 (`fix_retard[5]`); `launch_out_*` → `softcut_*` | [O] |
| 1.2.0 | `config_ext_t` 184 (`sectrig_maxrpm`); `config_shared_t` 27 (`wbo2_*2`) | [O] |
| 1.2.11 | `config_shared_t` 29 (`ibutton_code2[2]`) | [O] |
| 1.2.14 | `config_shared_t` 31; `knock_noise_t` **16** (rpm'e bağlı eşik); `engine_t` `pid_t` içerir → [U] | [O] |
| 1.2.15 | `config_shared_t` 33; `knock_noise_t` 44 (8x4) | [O] |
| 1.2.22 | `ve_t` 758 (`CLT_IGN_ADJUST`); SIPR `LAUNCH_RPM` 40 ancak 1.2.23 ini'sinde | [O] |
| 1.2.32 | `config_ext_t` 229 (`boost_input…idleup_ref_up`); `airden_ignore → config14@61` | [O] |
| 1.2.33 (ini) | `config_shared_t` 35: `mux_mcp_ch_high/low@33`, `mux_channel@34` | [O] ini, header yok |
| 1.2.34 (ini) | `config_shared_t` 37: `cam_refdc_i_down@35`, `cam_refdc_e_down@36` | [O] ini, header yok |

**[O]** Byte-aynı header grupları (v3): `{1.0.73,1.0.75} {1.1.26,1.1.27} {1.1.53,1.1.54} {1.1.59,1.1.60,1.1.61} {1.1.74,1.1.75} {1.1.92,1.1.93} {1.1.94,1.1.95} {1.2.17,1.2.18} {1.2.22,1.2.23,1.2.24} {1.2.28,1.2.29,1.2.30}`.

**[O]** fw_desc'te olmayan ama ini'si olan sürümler: 1.1.43/47/48/49, 1.1.76/77, 1.1.83, 1.1.90, 1.1.99, 1.2.5, 1.2.8, 1.2.13, 1.2.33, 1.2.34; ini'si olmayan header sürümleri en yakın küçük ini'yi kullanır (**[I]** VemsTune kuralı; `inifile.select_ini_for`).

---

## 8. Layout aileleri

### 8.1 v3 boyut aileleri (SIPR seviyesinde uyumlu; `E/families.json → size_families`)
| Aile | Sürümler | config_t | config_ext_t | config_shared_t | ve_t | ign/boost/hwmap | knock | not |
|---|---|---|---|---|---|---|---|---|
| S1 | 1.0.73–1.0.75 | 255 | — | — | [U] | [U] | — | tablolar header dışı |
| S2 | 1.0.76 | 255 | 16 | — | [U] | [U] | — | |
| S3 | 1.0.80 | 255 | 27 | — | [U] | [U] | — | |
| S4 | 1.1.19–1.1.27 | 255 | — | — | [U] | [U] | — | `ve.h` |
| S5 | 1.1.42 | 255 | 110 | — | [U] | [U] | — | |
| S6 | 1.1.50–1.1.82 | 255 | 183 | — | [U] (SIPR 254/80/…) | [U] | — | `config_multi_t` 438 |
| S7 | 1.1.84–1.1.87 | 255 | 183 | 4 | 734 | 168/407/48 | — | |
| S8 | 1.1.88 | 255 | 183 | 4 | 734 | 168/407/48 | 168 | `at_config_t` 131 |
| S9 | 1.1.89 | 255 | 183 | 4 | 734 | … | 80 | |
| S10 | 1.1.91–1.1.97 | 255 | 183 | 19 | 734 | … | 80 | |
| S11 | 1.1.98 | 255 | 183 | 24 | 734 | … | 80 | |
| S12 | 1.2.0–1.2.10 | 255 | 184 | 27 | 734 | … | 80 | |
| S13 | 1.2.11 | 255 | 184 | 29 | 734 | … | 80 | |
| S14 | 1.2.14 | 255 | 184 | 31 | 734 | … | 16 | |
| S15 | 1.2.15–1.2.21 | 255 | 184 | 33 | 734 | … | 44 | |
| S16 | 1.2.22–1.2.31 | 255 | 184 | 33 | 758 | … | 44 | |
| S17 | 1.2.32 | 255 | 229 | 33 | 758 | … | 44 | (+1.2.33: shared 35, 1.2.34: 37 — ini'den) |

### 8.2 Katı (strict) aileler
**[O]** v3'te 34, Round'da 19 aile (`E/evolution-report.txt` başı). Katı aile = tüm sayfa struct'larında (isim, ofset, boyut, tip, dizi boyutu) dizisi aynı → tek bir TS layout tanımı yeter. Büyük olanlar: `1.1.56–1.1.62` (7), `1.1.71–1.1.75` (5), `1.1.92–1.1.95` (4), `1.2.0–1.2.10` (8), `1.2.15–1.2.21` (6), `1.2.22–1.2.31` (10). Struct bazlı aileler (`per_struct`): ör. `config_t` 19 farklı isim düzeni (hepsi 255 B); `ign_t`, `boost_t`, `hwmap_t` 1.1.84–1.2.32 boyunca **tek** aile.

### 8.3 Round aileleri
`config_t`: 52 (0.2/0.3.5) → 121 (0.3.8) → 105 (0.4.0) → 106 (0.4.1–0.4.2) → 140 (0.4.6/0.4.8, 1.4.6/1.4.8) → 146 → 147 → 168 → 190 → 192 (0.5.7+/1.5.7+); 1.4.2–1.4.5 = 135 (`aim_channel[4] aim_a[4] aim_b[...]` dizi düzeni; 1.4.3'te `aim_b` geçici olarak `uint8_t[8]`, 1.4.2/1.4.4/1.4.5'te `uint16_t[4]` — byte uyumlu, tip farkı). 0.3.8→0.4.0 küçülmesi (121→105) `aim_*` dizilerinin 8→4 kanala inmesidir.

---

## 9. Çapraz doğrulama sonuçları

### 9.1 1.2.32 header ↔ `vemsTune-v3-1.2.32.ini` (`E/crosscheck-ini-1.2.32.json`)
SIPR: `A340E` dışındaki 15 tablo **OK** (VE 254, LAMBDA/EGOC 80, IGN 168, CONFIG1 248, CONFIG1_EXT 7, CONFIG2 229, BOOST_TPS 239, BOOST_DC 168, H 48, TEMPERATURE 224, MAPCORR 80, MAT_TPS_RETARD 80, ALT_KNOCK 44, LAUNCH_RPM 40, CONFIG_SHARED 33).

Uyumsuzlukların tamamı:
| # | Tür | Girdi | Açıklama |
|---|---|---|---|
| 1 | SIPR boyut | `SIPR_TABLE_A340E` | ini 211, `at_config_t` 131 (fark 80). Eski ini'nin (page-knock-alt.ini, page 13) A340E düzeninde `sol1_channel@166` vs C `@94` (+72), `at_temp_curve@193` vs `@113` (+80). **[U]** 211 byte'lık A340E düzeninin hangi firmware'e ait olduğu |
| 2 | STRADDLE (sert) | p8 `etc_tps2table@128 [17]` | `boost_ref_table` (…382) ile `boost_ref_rpm_range` (383…) sınırını aşar — ETC overlay, kasıtlı |
| 3 | STRADDLE (sert) | p8 `etc_i_err_scale@152 [5]` | `boost_ref_rpm_range` ↔ `boost_ref_kpa_range` sınırı — ETC overlay |
| 4 | WIDTH (yumuşak) | p5 `tooth_wheel_twidth@190 U16` | C `uint8_t[2]`; ini LE U16 olarak okur |
| 5 | WIDTH (yumuşak) | p5 `stimperiod_min@190 U16` | aynı bytes, alias |
| 6 | WIDTH (yumuşak) | p9 `inj_size@136 U16` | C `uint8_t[2]` |
| – | bilgi | p5 `tpsaq1..4@48..51`, p16 `fix_retard1..5@19..23` | ini 1-tabanlı indeks (C `tpsaq[0..3]`, `fix_retard[0..4]`) — ofset doğru; `fix_retard0` page 31'de (virtual) |
| – | bilgi | p9 `gears_delay`, `launch_speed1` | ini'de karşılığı olmayan `config_ext_t` alanları ("experimental, excluded from release") |

### 9.2 1.2.32 header ↔ `vemsTune-v3-1.2.33.ini` (`E/crosscheck-ini-1.2.33.json`)
Yukarıdakilere ek: `SIPR_TABLE_CONFIG_SHARED` ini **37** ↔ C 33; p16 `mux_mcp_ch_high@33`, `mux_mcp_ch_low@33`, `mux_channel{,_enable,_names,_bits}@34` → struct dışı (6 sert). **[O]** Tutarsızlık: `vemsTune-v3-1.2.33.ini` `include/sipr-1.2.34.ini`'yi (CONFIG_SHARED 37) içerir, oysa `sipr-1.2.33.ini` 35 der ve `page-config-shared-1.2.33.ini` en son ofset 34 kullanır. 1.2.34 ini'si ek olarak `cam_refdc_i_down@35`, `cam_refdc_e_down@36` (toplam 10 sert, `E/crosscheck-ini-1.2.34.json`).

### 9.3 Tüm v3 sürümleri (header → seçilen ini; `E/crosscheck-summary.json`)
- 1.0.73–1.1.82: sert 0; yumuşak 1-3 (`rpmk@41 U16` (C `uint8_t rpmk[2]`), `tooth_wheel_twidth`, `inj_size`); sayfa 2/3/4/6/8 girdileri **doğrulanamaz** (struct header dışı, 79–250 girdi).
- 1.1.84–1.1.87, 1.1.89–1.2.11: sert 0.
- **1.1.88** (ini 1.1.87): 53 sert — page 13 A340E düzeni (`at_config_t` 131 ile uyumsuz, bkz. 9.1#1).
- **1.2.14**: `SIPR_TABLE_ALT_KNOCK` ini 80 ↔ C 16; `CONFIG_SHARED` ini 29 ↔ C 31 (sipr-1.2.11 kullanılıyor); p12 `knockTable[8x8]` / `rpmBinsK` struct dışı.
- 1.2.15–1.2.30: sert 1 (`etc_tps2table` overlay); 1.2.31–1.2.32: 2.
- **1.2.22** (ini 1.2.20): `SIPR_TABLE_LAUNCH_RPM` ini 16 ↔ C 40 → CLT ign adjust tablosu bu ini ile görünmez.

### 9.4 Diğer bağımsız doğrulamalar
- **[O]** `varstr.h` (1.1.27): 221 `config_t` alanının **221'i** isim+ofset olarak eşleşti (0 sapma).
- **[O]** `vemscfg` (header'ı olan 28 dosya, 1.1.56–1.2.32): alan sırası 28/28 header sırasıyla aynı. Sapmalar: 1.1.96 `bla_8` 3 eleman (C 2); 1.1.98 dosyası `speed_mintime, softcut_enrich` içermez, `bla_8` içerir; 1.2.15 dosyası `ego_banks` yerine `lcd_backlight` ve `config_shared_t`'nin son 4 alanı yok. **[I]** Bu dosyalar aynı sürüm numaralı ama daha eski bir header revizyonuyla (VemsTune 0.30/0.40/1.5.22) üretilmiş → **aynı sürüm numarası ≠ aynı layout** riski.
- **[O]** Round: header'daki `/* 0xNN */` ofset yorumları 13–14 kontrol/sürüm, **0 sapma**. Round ini `SIPR_GET_CONFIG_1` boyutu ↔ `config_t`: 0.2 (73↔52), 0.3.5 (113↔52, ini 0.3.3), 0.4.0 (106↔105; ini signature v0.4.1), 0.4.6/0.4.8/1.4.6/1.4.8 (139↔140), 0.5.0 (139↔146), 0.5.1 (139↔147), 1.5.1 (148↔147) uyumsuz; diğer 25 sürüm eşit. İsim çakışması: ini `aim_dot1 = bits @95 [2:3]` (=C `aim_dot`'un bitleri) ↔ C `aim_dot1@139` (ini adı `aim_dot4`) — layout değil isim çakışması. 0.4.0: ini `out_minain@105` ↔ C `@77` (header 0.4.0 `hack` alanından önce). **[I]** `round_0.2/0.3.5` header'ı ini'lerden eski bir revizyon.

---

## 10. Alternatif tuner için gereksinimler

1. **Layout kaynağı:** Her firmware için sayfa layout'unu **ini `[Constants]` + `[SIPR]`** setinden al (VemsTune'un yaptığı); `global.h` ikincil/doğrulayıcı kaynak. Bu araçla üretilmiş `E/<ver>.json` (release16x14) 1.1.84+ için alan→ofset tablosu olarak doğrudan gömülebilir.
2. **Sürüm seçimi:** Signature (`"VEMS v1.2.32 16x14 kpa=2,2"`, `"VEMS Round WBO2 v1.5.10"`) → ürün hattı + sürüm + VE boyutu + kpa modu. Header/ini bulunmayan sürümde en yakın **küçük** sürümü kullan ama SIPR boyutlarını ECU'dan teyit et (**[I]** `MegatuneSyncer::waitPageCrcSizeKnown` ECU'nun sayfa boyutu/CRC bildirdiğini düşündürür).
3. **Sayfa = struct dilimi:** §4.1 tablosunu uygula; `ve_t`'yi 6 SIPR tablosuna, `boost_t`'yi 2'ye böl; `config_t` page 5'i `CONFIG1`(248)+`CONFIG1_EXT`(7) olarak oku/yaz; `SIPR_TABLE_RPM/KPA` VE'nin alt pencereleridir.
4. **Koşullu sayfalar:** 12 (KNOCK_ALTERNATIVE), 13/8-union (A340E), VVTI (≤1.1.81) yalnız ilgili derleme seçeneğinde var; seçenek bilgisini CompileOptions/signature/ini `[Params]`'tan türet (**[U]** bit eşlemesi).
5. **Ayar taşıma (import/export, sürüm yükseltme):** `vemscfg` gibi **isim tabanlı** yap; `config_t` boyutu sabit olsa da alan anlamları değişti (ör. 1.1.42 `@8`, 1.1.84 `misc*` taşınması, 1.2.32 `@61`). Yeniden adlandırma tabloları `E/evolution.json → renamed_in_place` içinde.
6. **Çok byte'lı alanlar:** v3 config sayfalarında C tarafında hepsi `uint8_t`; ini'nin U16 görünümleri (`tooth_wheel_twidth`, `inj_size`, `rpmk`) LE iki byte'tır. Round `aim_b*` gerçek `uint16_t` LE.
7. **Overlay'ler:** page 8'de ETC (`etc_*`) ve A340E (`at_*`) aynı byte'ları farklı yorumlar; aktif yorum firmware seçeneğine bağlı — UI'da tek seferde bir görünüm.
8. **Virtual/yerel sayfalar:** page 31 (ve Round page 31 `analog_in_curve_x`) ECU'ya yazılmamalı; page 30 EEPROM ayrı komut yolu (`page_eeprom`).
9. **Kalıcılık:** `B` (burn) sonrası firmware `table_config_t`/`table_shared_t` düzeninde saklar; tuner yalnız SIPR tablo düzeyinde çalışmalı.
10. **Round:** tek sayfa (`c.`/`C`, `SIPR_GET_CONFIG_1`), 52…192 byte; 0.x/1.x eşdeğer header grupları tek tanımla desteklenebilir; ini boyutu ile header boyutu çelişirse (§9.4) ini'deki `sipr_config` boyutunu oku, fazlasını yok say.
11. **Uyarı listesi (bilinen ini/header çelişkileri):** 1.1.88+A340E, 1.2.14 knock/shared, 1.2.22 launch (1.2.20 ini), 1.2.33 shared 35↔37 — tuner bu sürümlerde ini'yi körü körüne izlememeli.

---

## 11. Açık bilinmeyenler

- **[U]** Gerçek release `my_make` içerikleri (paketlenmemiş). Profil, SIPR boyutlarından çıkarıldı; `INJ_ANGLE`, `ALS`, `SOFTRPM` vb. yalnız RAM struct'larını etkiler.
- **[U]** 1.0.73–1.1.82 tablo struct'ları (`ve.h`, `hwdef_v2.h` vb. paket dışı): yalnız SIPR/ini boyutları biliniyor (VE 254/12x12 dönemi 144+24, BOOST_TPS 20→181→227→239, H 24→48, TEMPERATURE 80→224, ALT_KNOCK 168, LAUNCH 16, CONFIG2 183).
- **[U]** `SIPR_TABLE_A340E` 211 byte düzeninin kaynağı; `SIPR_TABLE_VVTI` 168 ↔ `vvti_map_t` 144.
- **[U]** `pid_t` (pid.h) boyutu → 1.2.14+ `engine_t` toplam boyutu ve `ETC_piddata` sonrası ofsetler; `etime/wbo2/wbo2_2/h1` RAM struct'ları.
- **[U]** `CompileOptions` bit anlamları; VemsTune'un `#if` karşılaştırma ifadelerini değerlendirme biçimi.
- **[U]** 1.2.33/1.2.34 header'ları (yalnız ini'den: `config_shared_t` 35/37).
- **[U]** vemscfg `z` tablosu (9 satır, 1.1.81+) ve `e` (10 satır) ile struct dilimleri arasındaki kesin eşleme (sayfa harfleriyle uyumlu görünüyor: `e`=TEMPERATURE, `y`=BOOST_DC, `s`=LAUNCH_RPM, `f`=ALT_KNOCK — **[I]**).
- **[U]** Aynı sürüm numaralı header revizyonlarının sayısı (vemscfg sapmaları bunu gösteriyor).

---

## 12. Kanıt dosyaları
- `E/<ver>.json` (82), `E/round-<ver>.json` (35), `E/index.json`
- `E/crosscheck-ini-1.2.32.json`, `E/crosscheck-ini-1.2.33.json`, `E/crosscheck-ini-1.2.34.json`, `E/crosscheck-summary.json`, `E/crosscheck-report.txt`
- `E/evolution.json`, `E/families.json`, `E/evolution-report.txt`
