# VemsTune 1.5.46 — Bootloader Firmware Yükleme/Doğrulama Kablo Protokolü

> Kaynak: `vemsTune-c.exe` Ghidra dekompilasyonu (`re/ghidra/out/*.c`, ad = `Class.method_<VA>.c`).
> Etiketler: **[Observed]** dekompilasyonda doğrudan görüldü · **[Inferred]** çıkarım (gerekçe yazılı) · **[Unknown]** açık.
> Atıf: `Class::method @0xVA`. Sabit baytlar `vemsTune-c.exe` içinden okundu (rdata: dosya ofseti = VA − 0x401C00).
> Kardeş spec'ler: `PROTOCOL.md` (§1 DeviceModeSelector, §2.3 prob, §2.6 BootStateDetector, §7.6 GO_BOOTLOADER),
> `FILE-FORMATS.md §13` (.hex/.uhex/.chex kapsayıcı), `BOOTLOADER-SESSION.md` (oturum/crypto/VHEX — burada derinlemesine YOK).

---

## 0. Özet

```
Bootloader komutları (host→ECU, hepsi ham bayt, çerçeve/CRC YOK):
  'S'                         → "AVR" + aygıt('3'|'2') + bootState + seri(12)        (tespit/yeniden senkron)
  'A' hi lo                   → 0x0D                        sayfa adresi (16-bit BE)
  'D' 'c' 'c' <data[N]> TAG4  → 0x0D | 'N'                  şifreli sayfa yaz (CHEX/UHEX; N=256 V3 / 128 Round)
  'D' 'k' 'k' <data[N]> CS4   → 0x0D | 'N'                  düz sayfa yaz (Intel HEX)
  'D' 'C' 'C'                 → 4 bayt (BE)                 seçili sayfanın checksum'ı (crypto tip)
  'D' 'l' 'l'                 → 4 bayt (BE)                 seçili sayfanın checksum'ı (düz tip)
  'D' DE AD BE EF             → 0x0D | 'n'                  marker sayfasını sil (yalnız SHEX/LHEX/VHEX bootType)
  'e'                         → 0x0D                        tüm sayfaları sil (yalnız düz .hex)
  'E'                         → (cevap beklenmez)           bootloader'dan çık / uygulamayı başlat
```
- Adres: crypto V3 (`device==1 && type==2`) için **sayfa numarası**; diğer her durumda **word adresi** (`pageIdx*pageSize/2`). Daima BE `hi lo`. [Observed]
- Checksum/TAG daima **4 bayt big-endian** (`Math::getBytes(v,buf,4)` / `Math::getNumber(buf,4)`). [Observed]
- Her ACK **tek bayt**; VemsTune gelen her baytı **ayrı ayrı** durum makinesine verir, beklenmeyen fazladan bir bayt (eko, CRLF) yüklemeyi bozar. [Observed: `CommunicationController2::process @0x004812ee`]

---

## 1. Bootloader'a giriş

### 1.1 Kim tetikler [Observed]
`FirmwareDirector::startUploadFirmware @0x005c28f2` → normal iletişimi durdurur (`VemsDeviceController` vtbl+0x40 = `stop(1)`), `FirmwareVerifyController::upload @0x00a0afd6` çağırır:
- `isBootMode()` (DeviceInfo.mode == 0x0B) **değilse**: `DeviceModeSelector(src = getDeviceMode(), tgt = 0x0B, baudList = getSupportedBaudrates(), roundNew = isRound() && fwMinor>4)` kaydedilir. Sonuç `FirmwareVerifyController::OnDeviceModeSelected @0x00a0b35c` (mode==0x0B ise) içinde `FirmwareUploader` oluşturulur.
- Zaten boot modundaysa `FirmwareUploader` doğrudan oluşturulur.
- Her iki yolda da uploader'ın son ctor argümanı `FirmwareInfo::getBootType()` (bağlı ECU'nun bootloader tipi).

### 1.2 Mod geçiş baytları (PROTOCOL §1.1 tablosu, `DeviceModeSelector::<ctor> @0x00df9ee0`) [Observed]
| Kaynak mod | Gönderilen | Not |
|---|---|---|
| TF (0x12) | `FE F6 C1 96 7E` | TF GO_BOOTLOADER: gövde `FE F6`, CRC16-MODBUS `0x96C1` LE, `7E` (CRC tarafımızdan doğrulandı) |
| MegaTune (0x0C) | `"Mancb33cb."` (10 B) | roundNew=0 |
| MegaTune (0x0C), Round fw minor>4 | `7F 33 2E` (`"\x7F3."`) | roundNew=1 |
| Man (0x0D) | `"cb33cb."` (7 B) | |

- Mod komutuna verilen cevap **okunmaz**. Ardından `PortScanner`/`DeviceDetector` her baud'da (`getSupportedBaudrates()`: 19200, 9600, 57600, 115200; tercih edilen başa) prob `53 6D 78 63 2E FF 7E` ("Smxc.\xFF~") gönderir; alt-dize `AVR3` (V3), `AVREFI1` (eski V3) veya `AVR2` (Round) → mode 0x0B. Eşleşmeden sonra 16 tik (Round 512) boşaltma, sonra 100 ms bekleme, başarı. [Observed, PROTOCOL §1.2/§2.3]
- **Bootloader baud'u:** VemsTune sabitlemez, tarar; bulunduğu baud'da kalır (hedef Boot iken `BaudRateSelector` çalışmaz). Gerçek bootloader baud'u [Unknown] (19200 olası [Inferred]: listenin ilk elemanı ve fw reset varsayılanı).
- Boot modunda iken bağlanılırsa: `Detecting` → `detectBootState` (`BootStateDetector`). [Observed, PROTOCOL §3.2]

### 1.3 Bootloader kimlik cevabı (`BootStateDetector`, PROTOCOL §2.6) [Observed]
Host `'S'` → ECU `"AVR"` + aygıt karakteri (`'3'` V3, `'2'` Round, `'E'`→`"FI1"` eski V3) + bootState (1 B) + seri.
- bootState: `0x34..0x38`, `'P'`(0x50), `'r'`(0x72) olduğu gibi; `'v'`(0x76 "BOOTLOADER 2011-03-01") hem bootState hem **serinin ilk karakteri**; diğer → −1. V3 seri = 12 karakter, regex `(\w\d.\d_\w\d{6})`. Örnek: `"AVR3v3.3_u012345"` (16 B) [Inferred örnek].
- Eski `"AVREFI1"` bootloader'ında ek sorgu `41 FB 80 44 6C 6C` (= `'A'` word-adres 0xFB80 = bayt 0x1F700 = sayfa 503 + `"Dll"`); cevap 5 B = `0D` + checksum(4, BE). `0xA05BA125` → "From Fw (old)", `0xFB00FB80` → "Bad marker (old)". **Doğrulama:** §5 checksum algoritmasıyla sayfa 503 tamamen `FF` → `0xFB00FB80`; yalnız `FE/FF` baytları `5A A5` (marker) → `0xA05BA125`. İki sabit de birebir tuttu → adres biçimi, `Dll` komutu, checksum algoritması ve BE sırası kesinleşti. [Observed + hesap]

### 1.4 BootType'ın belirlenmesi (`FirmwareInfo::setSerialNumber @0x0051298e`) [Observed]
| Seri | device | bootType |
|---|---|---|
| `v…_u…` | 1 V3 | 3 UHEX |
| `v…_v…` | 1 | 6 VHEX |
| `v…_s…` | 1 | 4 SHEX |
| `v…_l…` | 1 | 5 LHEX |
| `v…_<diğer>` | 1 | 0 HEX |
| `r…` | 2 Round | seriAsLong < 0xC00 → 1 CHEX, aksi 2 CHEX2 |
| diğer | 1 (seri = `"UNKNOWN"`) | FirmwareInfo+0x51 == `'3'` → 3 UHEX, aksi 0 HEX |

Normal moddan yüklemede FirmwareInfo normal modda okunan seriyi taşır [Inferred: `upload` FirmwareInfo'yu denetleyiciden kopyalıyor, DeviceModeSelector seri okumuyor].

---

## 2. `FirmwareUploader` durum makinesi

### 2.1 Nesne alanları (`FirmwareUploader::<ctor> @0x00e069cc`) [Observed]
| Ofset | Anlam |
|---|---|
| +0x08 | `m_timeout` (registerClient: denetleyici +0xC4; varsayılan 200 [Inferred, PROTOCOL]) — bekleme "tik" sınırı |
| +0x0C | interWriteDelay (denetleyici +0xC0; varsayılan 30 ms [Inferred]) — her `write` sonrası `Sleep` |
| +0x10 | sleepTime = 1 (ms) — boş `read` başına `Sleep` |
| +0x18 | CommunicationTimer |
| +0x5C | abort bayrağı (`Abort @0x00e06790`) |
| +0x68 | `FirmwareData*` · +0x6C `BootStateDetector*` (ctor'da `new BootStateDetector(this,this,1,1)`, timeout 1000) |
| +0x70 | **state** · +0x74 sıra indeksi · +0x78 silme yoklama sayacı · +0x7C bekleme sayacı |
| +0x80 | sayfa başlığı gönderildi · +0x84 sayfa bayt indeksi · +0x88/+0x8C CLEARING sayaç/limit(64) |
| +0x90 | marker silme deneme sayısı · +0x94..+0x97 checksum alım tamponu · +0xA4 alınan bayt |
| +0xA8 | "yeniden göndermeden önce checksum sor" bayrağı · +0xA9 disconnected olayı gönderildi · +0xAC `'N'` deneme sayısı |

`FirmwareData` (`FirmwareData::<ctor> @0x00a094f4`): +4 pageSize (Round=2 → **128**, diğer **256**), +8 type (0 bilinmiyor, 1 "Intel HEX" `:`, 2 "Crypto CHEX" `C:` — `IHexParser::detectType @0x004cbd44`), +0xC targetType (**varsayılan 1**), +0x10 IntArray sayfa sırası (+0x14 sayı, +0x18 öğeler; dosyada ilk görülme sırası, `setPageData @0x00a098ce`), +0x44 sayfa→TAG hash, +0x54 device, +0x58 rinsing/artan sıra (**varsayılan 1**), +0x5C/+0x60 izinli indeks (V3: **0..0x1F7**, diğer: −1/−1 = sınırsız). Yeni sayfa `0xFF` ile doldurulur. `.uhex` satırındaki 8 haneli TAG `setPageCheckSum(pageIdx, tag)` ile saklanır (`IHexParser::parseLine @0x004cbf48`). [Observed]

### 2.2 Durumlar (`getStateAsString @0x00e0a00c`) ve başlangıç [Observed]
| # | Ad | # | Ad |
|---|---|---|---|
| 0 | SEND_MARKER_PAGE_ADDRES | 10 | SEND_PAGE_ADDRESS |
| 1 | WAIT_MARKER_PAGE_ADDRES | 11 | WAIT_PAGE_ADDRESS_OK |
| 2 | SEND_ERASE_MARKER_PAGE | 12 | SEND_PAGE |
| 3 | WAIT_ERASE_MARKER_PAGE | 13 | WAIT_SEND_PAGE_OK |
| 4 | ERASE_ALL_PAGES | 14 | CLIENT_MODE |
| 5 | WAIT_ALL_PAGE_ERASED | 15 | CLEAR |
| 6 | SEND_LEAVE_BOOT_MODE_COMMAND | 16 | SEND_GET_CHECKSUM_CMD |
| 7 | WAIT_AUTO_ENTER_BOOT_MODE | 17 | WAIT_CHECKSUM |
| 8 | CLEARING | 18 | FINISHED |
| 9 | FIRST_PAGE_EVENT | 19 | TIMEDOUT |

Başlangıç durumu (ctor):
```
if device==1 (V3):
   if targetType==0                 → 9
   elif bootType ∈ {4 SHEX,5 LHEX,6 VHEX} → 0   (marker silme yolu)
   elif type==1 (Intel HEX)         → 4   (tümünü sil)
   else (type 2 crypto)             → 9
else (Round/Arm)                    → 9
curIdx = rinsing ? 0 : pageCount-1     (rinsing varsayılan 1 → artan)
```
`isFinished @0x00e0677c`: state 18 ya da 19. `finish @0x00e06758`: 19 ise TimeoutListener → `FirmwareVerifyController::OnTimeout` → `CommunicationEvent(2)` (hata). `write @0x00e09e90` her çağrıda önce abort'u sorar; abort → 19.

### 2.3 Durum başına kablo davranışı

Çağrı modeli [Observed `CommunicationController2::process @0x004812ee`]: her döngüde `client.write(buf,&n)`; n>0 ise porta yaz + `Sleep(interWriteDelay)`; sonra porttan ≤16 bayt oku; 0 bayt ise `client.read(buf,0)` bir kez, aksi hâlde **her bayt için ayrı** `client.read(&b,1)`. "Tik" = boş read çağrısı (her biri `Sleep(1)` + döngü süresi).

| State | Yön | Baytlar | Bekleme / geçiş | Kaynak |
|---|---|---|---|---|
| 0 | → | `41 01 F7` (`'A'`, sayfa 0x1F7) | →1, sayaç=0 | `sendMarkerPageAddress @0x00e06c78` |
| 1 | ← | `0D` | `0D`→2 (deneme=0); başka bayt →19; `m_timeout+100` tik sessiz →19 | `waitMarkerPageAddress @0x00e06ce0` |
| 2 | → | `44 DE AD BE EF` | deneme++ ; →3 | `sendEraseMarkerPage @0x00e07048` |
| 3 | ← | `0D` / `6E 'n'` | `0D`→9; `'n'` ve deneme<5 →2 (tekrar), aksi →19; başka →19; `m_timeout+1000` tik →19 | `waitEraseMarkerPage @0x00e070bc` |
| 4 | → | `65` (`"e"`) | olay 2 (silme başladı); →5 | `eraseAllPages @0x00e09d70` |
| 5 | ← | `0D` | boş read'de `Sleep(100)`, en çok 30 (≈3 s; her biri ilerleme olayı 3) → olay 5, →19. `0D` → olay 4; `pageCount < 0x1F7` ise →9, aksi →6. Başka bayt →19 | `waitAllPageErased @0x00e09bbc` |
| 6 | → | `45` (`"E"`) | →7 | `sendLeaveBootModeCommand @0x00e07870` |
| 7 | – | – | `Sleep(20)`; sayaç=0, limit=64; →8 | `waitAutoEnterBootMode @0x00e0796c` |
| 8 | ← | (yok sayılır) | her read çağrısında sayaç++; 64'te →10 (ECU'nun yeniden boot'a girmesi beklenir [Inferred]) | `clearing @0x00e079a4` |
| 9 | – | – | log `UPLOADING_PAGES_STARTED`, olay 6; →10 | `sendFirstPageEvent @0x00e0985c` |
| 10 | → | `41 hi lo` | sayfa geçersizse (izinli aralık dışı) log + indeks ilerlet; bittiyse olay 8 →18; aksi 10'da kal. Geçerliyse →11, sayaç=0 | `sendPageAddress @0x00e09390` |
| 11 | ← | `0D` | `0D` → (+0xA8 ? 16 : 12). Başka bayt veya `m_timeout` tik (DİKKAT: +100 yok) → type==1 ? 19 : **14** | `waitPageAddressOk @0x00e079e4` |
| 12 | → | `44 63 63` (`"Dcc"`, type≠1) / `44 6B 6B` (`"Dkk"`, type==1) | ilk write'ta 3 B; sonraki **her write'ta 1 bayt** sayfa verisi (pageSize kez); son write'ta 4 B checksum/TAG (BE) → 13, sayaç=0. Bu durumda gelen baytlar **atılır**. | `sendPage @0x00e07d58` |
| 13 | ← | `0D` / `4E 'N'` | `0D` → olay 7, indeks ilerlet (bittiyse olay 8 →18), +0x80/+0x84/+0xAC=0, →10. `'N'` ("CHKSUM ERROR"): type==1 →19; aksi deneme++ <5 ise →**14**, sonra →19. Başka bayt / `m_timeout+100` tik → type==1 ? 19 : 14 | `waitSendPageOk @0x00e08704` |
| 14 | ↔ | `'S'` … ← `"AVR"…` | `BootStateDetector` çalıştırılır (§2.4). Başarı → `OnBootStateDetected`; zaman aşımı → `OnTimeout` | `read/write @state 0xE`, `sendClient/waitClient @0x00e08078/0x00e08090` |
| 15 | ← | (yok sayılır) | `Sleep(1)`; 500 ms zamanlayıcı dolunca type≠1 ise +0xA8=1; →10 | `clear @0x00e080dc` |
| 16 | → | `44 43 43` (`"DCC"`, type≠1) / `44 6C 6C` (`"Dll"`, type==1) | alınan=0, zamanlayıcı(m_timeout); →17 | `sendGetChecksumCmd @0x00e08120` |
| 17 | ← | 4 bayt | 4. baytta `Math::getNumber(buf,4)` (BE) ile `checkPageCheckSum` çağrılır **ama sonucu kullanılmaz**; +0xA8=0, →10 (aynı sayfa tekrar adreslenip **yeniden gönderilir**). Bu durumda zaman aşımı yolu **yok**. | `waitChecksum @0x00e083a4` |

Adres kodlaması (`sendPageAddress`, `FirmwareVerifier::sendPageAddress` aynı) [Observed]:
```
page = pageList[curIdx]
if fd.device==1 && fd.type==2:  hi = page>>8,           lo = page & 0xFF            ; sayfa numarası
else:                           w = page*pageSize/2;   hi = (w>>8)&0xFF, lo = w&0xFF ; word adresi
send 'A' hi lo
```
`fillAddressCommand @0x00e079c8` aynı `41 hi lo` düzenini kurar.

### 2.4 Hata kurtarma: CLIENT_MODE → CLEAR (yalnız crypto tip) [Observed]
1. 14: `BootStateDetector(…, true, true)`; `write` her çağrıda `'S'` (0x53) gönderir, **ilk bayt gelene kadar** (bayrak +0x56). Zamanlayıcı 1000 ms. Beklenen cevap §1.3. (`BootStateDetector::write @0x00df5d2c`, `read @0x00df8488`)
2. Başarı → `OnBootStateDetected @0x00e067a4`: yeni detector, zamanlayıcı **500 ms**, →15.
3. 15 → +0xA8=1 → 10: `41 hi lo` ← `0D` → 16: `"DCC"` ← 4 B → 17 → 10: `41 hi lo` ← `0D` → 12: sayfa yeniden gönderilir.
4. Detector zaman aşımı → `OnTimeout @0x00e085e8`: ilk seferde olay 10 (disconnected), yeni detector kurulur (state 14'te kalır, sonsuz deneme [Inferred]).

### 2.5 Olay kodları (`wxEVT_FIRMWARE_UPLOAD`, `FirmwareDirector::connectFirmwareUploadEventHandlers @0x005c2fc6`) [Observed]
2 silme başladı · 3 silme ilerleme (pageCount, idx) · 4 silme bitti · 5 silme zaman aşımı · 6 sayfa yükleme başladı · 7 sayfa yüklendi (`onFirmwarePageUploaded`) · 8 başarı (`onFirmwareUploadingSucceeded`) · 9 hata · 10 bağlantı koptu.

### 2.6 Yükleme fazları (`FirmwareDirector::uploadFirmware @0x005c016c`, `onFirmwareUploadingSucceeded @0x005c4324`) [Observed]
1. Firmware dosyası `IHexParser(device)` ile ayrıştırılır.
2. bootType ∈ {1 CHEX, 2 CHEX2, 3 UHEX}: önce `config/fw/markerword_erase.{chex|chex2|uhex}` ayrı bir `FirmwareData` olarak **normal sayfa yüklemesiyle** gönderilir (+0x69=1 "marker fazı"). Dosya ayrıştırılamazsa doğrudan 3'e geçilir.
3. Marker fazı başarı (olay 8) → `startUploadFirmware(asıl firmware)` (yeni `FirmwareVerifyController` + yeni `FirmwareUploader`), olay param `marker_uploaded`.
4. bootType 6 VHEX: `generateSessionKey` → `OnGenerateSession` → `FirmwareData::crypto(session)` → yükle (bkz. BOOTLOADER-SESSION.md). bootType 0/4/5: doğrudan yükle.
5. Asıl yükleme başarı → `startVerifyFirmware` (§3). Doğrulama başarı → `cleanupVerifyFirmware`, sonra denetleyici `resumeToMode(…)` (vtbl+0x48) ya da `start(6)` (vtbl+0x3C) → yeniden tespit; boot'taki ECU `Detecting::OnBootStateDetected` ile `"E."` (Boot→MT) gönderilerek çıkarılır [Inferred: PROTOCOL §1.3 leaveBootMode yolu, `VemsDeviceController::leaveBootMode @0x00bc84e4` = DeviceModeSelector(0x0B→0x0C)].

> Uploader'ın kendisi yükleme sonunda `'E'` **göndermez**; `'E'` yalnız state 6'da (düz .hex, tümünü sil sonrası, pageCount ≥ 0x1F7) gider. [Observed]

---

## 3. `FirmwareVerifier` protokolü

Alanlar (`FirmwareVerifier::<ctor> @0x00e04950`): +0x60 FirmwareData, +0x64 state (başlangıç 0), +0x68 sonuç (başlangıç 2), +0x6C pageCount (fd+0x14), +0x70 idx (0'dan artan), +0x74 uyuşmazlık sayacı, +0x78.. alım tamponu, +0x88 alınan bayt, +0xB4 `StringRecognizer("AVR")`, +0x8C `NTCFinder` (termistör yama dosyaları). [Observed]

| State | Yön | Baytlar | Geçiş | Kaynak |
|---|---|---|---|---|
| 0 | → | `41 hi lo` (adres kuralı §2.3) | zamanlayıcı(m_timeout); →1 | `sendPageAddress @0x00e04bdc` / `write @0x00e05120` |
| 1 | ← | `0D` | `0D`→2; başka → sonuç 2, →7 | `read @0x00e05970`, `waitPageAddressOk @0x00e04d24` |
| 2 | → | `44 43 43` `"DCC"` (type≠1) / `44 6C 6C` `"Dll"` (type==1) | alınan=0, zamanlayıcı; →3 | `sendGetChecksumCmd @0x00e04d50` |
| 3 | ← | 4 B (BE) | bkz. aşağı | `waitChecksum @0x00e0553c` |
| 4 | → | `53` `"S"` | zamanlayıcı(m_timeout); →5 | `sendS @0x00e04fd4` |
| 5 | ← | `"AVR"` (alt-dize) | eşleşince zamanlayıcı 100 ms, →6 | `waitS @0x00e05178` |
| 6 | – | – | 100 ms dolunca →0 (aynı sayfa tekrar) | `read` |
| 7 | – | bitti | `finish @0x00e05360`: sonuç 0 → olay 5 (aynı), 1 → olay 4 (farklı), 2 → TimeoutListener | |

Zaman aşımı (boş read + zamanlayıcı doldu, `read`): state 5 ise ilk seferde olay 6 (disconnected), `Sleep(1000)`, abort sorgusu; değilse →4 (yeniden `'S'`). State 6 → 0. Diğer state'ler → 4 (resync). [Observed]

`waitChecksum` mantığı [Observed]:
```
rx = getNumber(buf,4)                          ; BE
isPatch = device==1 && page∈{1,2,3} && NTCFinder.getFile(page, rx)≠"" && rx ∈ pageSet
if checkPageCheckSum(page, rx):    isPatch ? olay3 : olay2 ; sonraki
else if isPatch:                   olay3 ; sonraki
else: log "different checksum! idx: %i,%08X,%08X"; mismatch++;
      mismatch < 15 ? (olay2 ; sonraki) : (sonuç=1, →7)
sonraki: idx < pageCount-1 ? (idx++, →0) : (sonuç=0, →7)
```
- `checkPageCheckSum @0x00a0a48c`: device==2 (Round) → yalnız **üst 16 bit** karşılaştırılır; diğer → tam 32 bit. Beklenen değer `getPageCheckSum` (crypto tipte dosyadaki TAG, düz tipte hesap §5).
- Not: 15'ten az uyuşmazlık sonuç=0 ("identical") ile bitebilir — kodda böyle. [Observed; niyet Unknown]
- `isPatchPage @0x00e05bc4`: V3 ve sayfa 1..3 (`.air` 0x100/0x200, `.clt` 0x300; FILE-FORMATS §14). Olay kodları `wxEVT_FIRMWARE_VERIFY`: 2/3 sayfa doğrulandı, 4 başarısız, 5 başarılı, 6 koptu (`connectFirmwareVerifyEventHandlers @0x005c2ce6`).

---

## 4. Firmware / boot tipine göre farklar [Observed, aksi belirtilmedikçe]

| Durum | Başlangıç | Adres | Sayfa yaz | Checksum sor | 'N'/hata sonrası | Sayfa boyu |
|---|---|---|---|---|---|---|
| V3, `.hex` (type 1), bootType 0/1-3 | 4: `e` → (pageCount≥0x1F7 ise `E` + 64 tik) → 9 | word adresi | `Dkk`+256+CS(hesap) | (`Dll`, verifier) | **TIMEDOUT** (kurtarma yok) | 256 |
| V3, `.uhex`/`.chex` (type 2), bootType 3 UHEX (ve 0–2) | 9 (marker dosyası önceden ayrı faz) | **sayfa no** | `Dcc`+256+TAG | `DCC` | CLIENT_MODE (≤5 'N') | 256 |
| V3, type 2, bootType 4 SHEX / 5 LHEX / 6 VHEX | 0: `A 01 F7` → `D DEADBEEF` → 9 | sayfa no | `Dcc`+256+TAG | `DCC` | CLIENT_MODE | 256 |
| V3, type 1, bootType 4–6 | 0 (marker silme) → 9 | word adresi | `Dkk` | `Dll` | TIMEDOUT | 256 |
| V3, targetType==0 | 9 | – | – | – | – | – |
| Round (device 2), `.chex/.chex2` | 9 (marker dosyası önceden) | word adresi (`idx*64`) | `Dcc`+128+TAG | `DCC` (yalnız üst 16 bit karşılaştırılır) | CLIENT_MODE | 128 |

- V3 izinli sayfa aralığı 0..0x1F7 (503); üstü (bootloader alanı) `"Page out of bounds error(%i,%i), idx:%i"` ile atlanır (`isPageValid @0x00a0a4de`).
- `setRinsingSeq`, `setAllowedIdx`, `setTargetType`, `setV3MarkerWord` için decompile edilmiş kümede **çağıran bulunamadı** → varsayılanlar (artan sıra, targetType=1) geçerli kabul edildi. [Unknown çağıranlar]
- `setV3MarkerWord @0x00a0a198`: sayfa 0x1F7 varsa `[0xFE]=5A, [0xFF]=A5` yazar (düz veri). [Observed; ne zaman çağrıldığı Unknown]

---

## 5. Checksum algoritması (düz tip, `getPageCheckSum @0x00a09f2e`) [Observed + §1.3'te doğrulandı]
```
if fd.type == 2: return storedTag[page]               ; .uhex/.chex TAG
seed = device==1 ? (page*pageSize)>>1 (word adresi) : device==3 ? page : (log "INVALID DEVICE")
hi = lo = seed & 0xFFFF
for i in 0, 2, … pageSize-2:
    w = data[i] | data[i+1]<<8                       ; LE word (getLittleEndianWordValue @0x00a0a032)
    hi = (hi + w) & 0xFFFF ; lo ^= w
return hi<<16 | lo          ; kabloda BE: hi_hi hi_lo lo_hi lo_lo
```
TAG alt 16 biti düz metin `addrW ^ ⊕words` ile tutuyor; üst 16 bit anahtara bağlı (BOOTLOADER-SESSION.md §2). Emülatör TAG'i hesaplayamaz → yazılan TAG'i saklayıp `DCC`'ye geri döndürmeli. [Inferred]

---

## 6. Örnek transkript — 2 sayfalık V3 `.uhex` (TF modundan, bootType 3 UHEX)

Varsayım: sayfalar 0x004 ve 0x005, TAG'ler `4359870E`, `4359878E` (örnek değerler [Inferred]). `markerword_erase.uhex` sayfa 0x1F7, TAG `Tm` [Unknown değer, dosyadan].

| # | Yön | Baytlar | Etiket |
|---|---|---|---|
| 1 | → | `FE F6 C1 96 7E` (TF→Boot) | [Observed] |
| 2 | ← | (cevap okunmaz) | [Observed] |
| 3 | → | `53 6D 78 63 2E FF 7E` (prob, her baud) | [Observed] |
| 4 | ← | `41 56 52 33 …` (`"AVR3"` + bootState + seri; örn. `"AVR3v3.3_u012345"`) | [Observed alt-dize; devamı Inferred] |
| 5 | – | 16 tik boşaltma + 100 ms; `FirmwareUploader` (marker fazı) state 9 | [Observed] |
| 6 | → | `41 01 F7` | [Observed] |
| 7 | ← | `0D` | [Observed] |
| 8 | → | `44 63 63` + 256 B şifreli marker sayfası (bayt bayt) + `Tm` (4 B BE) | [Observed düzen] |
| 9 | ← | `0D` → olay 7, olay 8 (marker_uploaded) | [Observed] |
| 10 | → | (isBootMode hâlâ false ise tekrar `FE F6 C1 96 7E` + prob, ← `"AVR3…"`) | [Inferred/Unknown] |
| 11 | → | `41 00 04` | [Observed] |
| 12 | ← | `0D` | [Observed] |
| 13 | → | `44 63 63` + data[0x400..0x4FF] + `43 59 87 0E` | [Observed düzen] |
| 14 | ← | `0D` | [Observed] |
| 15 | → | `41 00 05` | [Observed] |
| 16 | ← | `0D` | [Observed] |
| 17 | → | `44 63 63` + data[0x500..0x5FF] + `43 59 87 8E` | [Observed düzen] |
| 18 | ← | `0D` → olay 8 (başarı) → verify | [Observed] |
| 19 | → | `41 00 04` ← `0D` → `44 43 43` ← `43 59 87 0E` | [Observed] |
| 20 | → | `41 00 05` ← `0D` → `44 43 43` ← `43 59 87 8E` | [Observed] |
| 21 | – | verify başarı → denetleyici yeniden başlar; boot'ta ise `"E."` ile çıkış | [Inferred] |

Checksum hatası örneği (adım 14 yerine): ← `4E` → →`'S'` (tekrarlı) ← `"AVR3…"` → 500 ms → `41 00 04` ← `0D` → `44 43 43` ← 4 B → `41 00 04` ← `0D` → `44 63 63`+veri+TAG ← `0D`. [Observed akış]

---

## 7. Emülatör bootloader asgari davranışı [Inferred, §2–3'ten türetildi]
1. TF modunda `FE F6` çerçevesi → sessizce boot moduna geç.
2. Boot modunda: `'S'` → `"AVR3"` + `'v'` + `"3.3_u012345"` (UHEX). Diğer tanınmayan baytları **yok say** (prob kalan `mxc.\xFF~` dahil).
3. `'A' hi lo` → adresi sakla (UHEX: sayfa no), `0D`.
4. `'D'` + 2 bayt op: `cc`/`kk` → pageSize bayt + 4 B TAG oku, sakla, `0D` (reddetmek için `4E`). `CC`/`ll` → saklı TAG/checksum'ı 4 B BE gönder (sayfa yoksa §5 algoritmasıyla `FF` sayfanın değeri). `DE AD` → 2 bayt daha (`BE EF`) oku, marker sil, `0D`.
5. `'e'` → `0D`. `'E'` (ve `"E."`) → marker geçerliyse normal moda dön, cevapsız.
6. Her komuta **tek** ACK baytı; eko/CRLF yok.

---

## 8. Açık [Unknown] maddeler
- `'D'` alt-op baytlarının (`cc`/`kk`/`CC`/`ll`/`DE AD BE EF`) bootloader tarafındaki kesin anlamı; `'n'` ile `'N'` farkı.
- Gerçek bootloader'ın prob artıkları (`mxc.\xFF~`) ve `'S'` dışı baytlara cevabı; bootloader baud'u.
- `m_timeout`/interWriteDelay'in yükleme sırasındaki gerçek değerleri (denetleyici +0xC4/+0xC0; setter çağıranları bulunmadı) → tik başına gerçek süre ve sayfa başına toplam süre.
- Tümünü sil sonrası `'E'`'nin yalnız `pageCount ≥ 0x1F7` iken gönderilmesinin amacı.
- `setRinsingSeq/setAllowedIdx/setTargetType/setV3MarkerWord` çağıranları (varsayılanlar kabul edildi).
- Marker fazından asıl faza geçişte DeviceInfo modunun Boot'a güncellenip güncellenmediği (aksi hâlde TF→Boot komutu ve prob tekrar gider).
- WAIT_CHECKSUM (17)'de zaman aşımı yolu yok; ECU cevapsızsa uploader'ın nasıl sonlandığı.
- `checkPageCheckSum` sonucunun `waitChecksum`'da gerçekten kullanılmadığı (decompile'da dönüş değeri atılıyor; assembly ile teyit edilmedi).
- `isPageValid` dönüş değeri decompile'da kısmen gizli (geçerli/geçersiz dalları log'dan çıkarıldı).
- Yükleme sonrası denetleyici `start(6)`/`resumeToMode` ile tam olarak hangi baytların gittiği.
- TAG üst 16 bitinin nasıl üretildiği (BOOTLOADER-SESSION.md).

## 9. Gerçek VemsTune ile doğrulama (2026-11-01, com0com COM10↔COM11) [Observed]

Emülatör: `packages/core/src/emulator/bootloader.ts` (`EcuEmulator` TF `F6` gelince bootloader'a geçer).
Harness: `node apps/emu-cli/src/emu.mjs --port COM10 --trace --serial <seri> --reply-delay 20`.
VemsTune: Tools ▸ Firmware ▸ Firmware upload ▸ "Firmware Upload" ▸ v3 / **1.1.94** / PS2 ▸ OK.

| Çalışma | TF serisi | bootType (VemsTune log) | Kablo | Sonuç |
|---|---|---|---|---|
| 1 | `v3.3_n001453` | `BOOT_HEX` (0) | `FE F6`, prob, `e`→0D, 387 × (`A` wordAddr, `Dkk`+256+CS4)→0D, sonra `FE F6`+prob, 387 × (`A`, `Dll`→4B), `E.` | **"Firmware is identical."** |
| 2 | `v3.3_u001453` | `BOOT_UHEX` (3) | `FE F6`, prob, marker `A 01 F7` + `Dcc`(markerword_erase.uhex)→0D; `FE F6`+prob, 387 × (`A` sayfaNo, `Dcc`+256+TAG4)→0D; `FE F6`+prob, 387 × (`A`, `DCC`→4B) | **"Firmware is identical."** |

Bu testle kapanan açık maddeler (§8):
- **bootType kaynağı:** bağlı ECU'nun **TF ECU-details serisi** (sub 3). Bootloader'ın `'S'` cevabındaki seri değil:
  çalışma 1'de bootloader `_u` dediği hâlde düz yol seçildi.
- **Fazlar arası mod:** her faz (marker / ana / verify) için `FE F6` + prob **yeniden** gönderilir. Bootloader'daki
  bir ECU `FE F6`'yı yok saymalı, `'S'`'ye yine cevap vermeli.
- **Zamanlama:** Preferences ▸ Communication: Timeout 200 ms, Inter Write Delay 30 ms, "Firmware upload baudrate"
  19200 (varsayılanlar). Gözlenen hız: sayfa başı ≈ 140 ms (yazma), ≈ 62 ms (doğrulama). 387 sayfa ≈ 55 sn + 25 sn.
  Inter-write delay bayt başına uygulanmıyor.
- **Prob cevabı gecikmesi:** cevap **0 ms**'de gelirse VemsTune bazen bootloader'ı tanımıyor (baud taraması
  19200/9600/57600/115200 → `FirmwareVerifyController::OnTimeout` → "Firmware upload has been cancelled.").
  Bu durumda log'da her denemede `setBaudRate` iki kez görünüyor. 20 ms gecikmeyle her seferinde tanındı.
  Gerçek ECU'da hat süresi zaten ≥ 8 ms (16 bayt @19200). [Observed; kök neden Inferred: ikinci baud ayarı alım tamponunu temizliyor]
- **Bootloader çıkışı:** doğrulama sonrası `"E."` gönderilir. Ardından VemsTune prob + TF→MT (`B1 7F 34 7E`) ile
  yeniden bağlanmaya çalışır. MT modu olmayan emülatörde birkaç denemeden sonra vazgeçer. Sonra Detect ile
  TF'ye bağlanınca "Select config file to upload" diyaloğu çıkar (yükseltme sonrası config yükleme önerisi).
- `'n'`, `'N'`, `DE AD BE EF` ve `'e'` sonrası `'E'` bu testlerde görülmedi (UHEX ve HEX yollarında gerekmiyor).

### İlgili VA özeti
`FirmwareUploader`: ctor 0x00e069cc, write 0x00e09e90, read 0x00e09c54, sendMarkerPageAddress 0x00e06c78, waitMarkerPageAddress 0x00e06ce0, sendEraseMarkerPage 0x00e07048, waitEraseMarkerPage 0x00e070bc, eraseAllPages 0x00e09d70, waitAllPageErased 0x00e09bbc, sendLeaveBootModeCommand 0x00e07870, waitAutoEnterBootMode 0x00e0796c, clearing 0x00e079a4, sendFirstPageEvent 0x00e0985c, sendPageAddress 0x00e09390, waitPageAddressOk 0x00e079e4, sendPage 0x00e07d58, waitSendPageOk 0x00e08704, sendGetChecksumCmd 0x00e08120, waitChecksum 0x00e083a4, clear 0x00e080dc, OnBootStateDetected 0x00e067a4, OnTimeout 0x00e085e8, getStateAsString 0x00e0a00c.
`FirmwareVerifier`: ctor 0x00e04950, write 0x00e05120, read 0x00e05970, sendPageAddress 0x00e04bdc, sendGetChecksumCmd 0x00e04d50, waitChecksum 0x00e0553c, sendS 0x00e04fd4, waitS 0x00e05178, finish 0x00e05360, isPatchPage 0x00e05bc4.
`FirmwareData`: ctor 0x00a094f4, getPageCheckSum 0x00a09f2e, checkPageCheckSum 0x00a0a48c, setPageData 0x00a098ce, isPageValid 0x00a0a4de. `IHexParser`: detectType 0x004cbd44, parseLine 0x004cbf48, fillFirmwareData 0x004cc462. `Math`: getBytes 0x00bf9346, getNumber 0x00bf93ea. `FirmwareInfo::setSerialNumber` 0x0051298e. `FirmwareVerifyController`: upload 0x00a0afd6, verify 0x00a0ab5c, OnDeviceModeSelected 0x00a0b35c. `CommunicationController2::process` 0x004812ee.
