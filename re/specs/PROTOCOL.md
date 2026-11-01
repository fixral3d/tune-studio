# VemsTune 1.5.46 — Seri Protokol Spesifikasyonu (emülatör odaklı)

> Kaynak: `vemsTune-c.exe` (1.5.46, MinGW/wxWidgets) Ghidra dekompilasyonu (`re/ghidra/out/*.c`, dosya adı = `Class.method_<adres>.c`).
> Etiketler: **[Observed]** = dekompilasyonda doğrudan görüldü; **[Inferred]** = çıkarım (gerekçesi yazılı); **[Unknown]** = açık.
> Atıf biçimi: `Class::method @0xADRES`. Yardımcı araçlar: `re/tools/protocol/ann.py` (gürültüsüz + string çözümlü görünüm), `re/tools/protocol/xref.py` (E8/E9 çağrı xref taraması).
> Makine-okunur mesaj listesi: `re/specs/protocol-messages.json`.

---

## 0. Yönetici özeti — en kritik bulgu

1. **SIPR çerçevesi kabloda (seri hatta) KULLANILMIYOR.** [Observed] `SIPRParser::feed @0x00bbb232` ve `SIPRParser` ctor'u yalnızca `VemsLogReader::getNextVersion2 @0x00bdbb2c` tarafından çağrılıyor (tüm `.text` E8/E9 taraması, `xref.py`). `SIPRPacket::packet_data/packet_size` (@0x00f86074/0x00f86080) tüketicileri yalnızca `SIPRFileLogger::process`, kopya ctor/atama ve `toString`; hiçbir seri yazıcı yok. SIPR, uygulama içinde **iletişim katmanı → GUI arası olay para birimi** (`InputEvent`) ve **`.vemslog` dosya formatıdır**. Görevde "CONFIRMED" diye verilen SIPR çerçeve/CRC/tip bilgisi doğrudur ama emülatörün kabloda konuşacağı dil bu değildir.
2. Kablodaki diller (1.5.46): 
   - **TriggerFrame (TF)** — ikili, HDLC benzeri (0x7E sonlandırıcı, 0x7D kaçış, CRC-16/MODBUS). Firmware **≥ 1.1.98** V3 ECU'lar için birincil mod (`EcuMode 0x12 TRIGGER_FRAME`). §4.
   - **MegaTune ASCII modu** (`EcuMode 0x0c`) — eski firmware (< 1.1.98) ve Round için sayfa/realtime erişimi; ayrıca TF öncesi tespit ve sürüm sorgusu. §6.
   - **Man (menü/konsol) modu** (`EcuMode 0x0d`) — ASCII komutlar (`mcB..`, `mdx..`, mod geçişleri). §6.
   - Bootloader (`EcuMode 0x0b`) — kapsam dışı (yalnız tespit, §2).
3. Bir emülatörün VemsTune ile uçtan uca bağlanması için minimum set: (a) tespit probuna doğru cevap (§2.3), (b) [V3 ≥1.1.98 yolu] MegaTune/Man modunda parola + sürüm sorgusu ve TF moduna geçiş (§3, §6), (c) TF: `0xF2` ECU details ×4, `0xF4` sayfa okuma (tüm sayfalar + EEPROM `0xF5`), `0xA0` realtime, `0xFB` yazma, `0xEF 04` burn (§4).

---

## 1. Fiziksel katman ve iletişim döngüsü

| Parametre | Değer | Kanıt |
|---|---|---|
| Baud tarama listesi | **19200, 9600, 57600, 115200** (bu sırayla); `preferredBaudrate` ≠ 0 ise listenin **başına** eklenir, listede tekrar etmez | [Observed] `SerialPortHelper::getSerialBaudratesInt @0x00789f04` (sabitler 0x4b00, 0x2580, 0xe100, 0x1c200); `PortScanner::<ctor> @0x00e1f848` (`preferredBaudrate: %d`, önce tercih edilen eklenir, sonra diğerleri) |
| TCP/telnet modunda | Tek baud (konfigürasyondaki) | [Observed] aynı fonksiyonun `else` dalı |
| Çerçeve | 8 veri biti; parity/stop yapılandırılabilir (`E`/`O` dizeleri), varsayılan 8N1 | [Observed] `VemsDeviceController::initCommunication @0x00bcd0e6` (`L"E"`, `L"O"`, databits/stopbits alanları); varsayılan [Inferred] |
| `m_timeout` | log: 200 ms (konfig `timeout`) | [Observed] `VemsDeviceController::registerAndStartCommunicationClient @0x00bcf2f8` (`m_timeout: %d, m_interWriteDelay: %d`) |
| `m_interWriteDelay` | log: 30 ms | aynı |
| İletişim döngüsü | Her tur: `client.write(buf,&n)`; n>0 ise porta yazar ve `interWriteDelay` kadar uyur; sonra porttan okur; 0 bayt geldiyse `client.read(buf,0)` (zaman tik'i), aksi halde **her bayt tek tek** `client.read(&b,1)` ile beslenir | [Observed] `CommunicationController2::process @0x004812ee` |
| İstemci tamponu / uyku | `registerAndStartCommunicationClient(client, 0x200, 100)` — 512 B tampon, 100 ms istemci uyku/tik | [Observed] `VemsDeviceController::initTriggerFrameMode @0x00bcc794`, `checkPassword @0x00bc8a76`, `selectDeviceMode @0x00bcc02a`, `fetchFirmwareVersion @0x00bccf36` |

Emülatör notu [Inferred]: VemsTune yanıtı bayt bayt ve tik tabanlı tükettiği için emülatörün cevabı tek parça yazması yeterli; yanıtlar `m_timeout`/istek zaman aşımı içinde gelmeli (TF'de varsayılan 1000 ms, §4.4).

**Modem hatları [Observed, 2026‑11‑01, gerçek VemsTune 1.5.46 + com0com 2.2.2.0]:**
- VemsTune portu DTR ve RTS'yi **düşük** tutarak açıyor (karşı uçta CTS=0, DSR=0, DCD=0 okundu).
- Karşı taraf DTR'yi yükseltmezse VemsTune hiçbir bayt almıyor. Detect diyaloğunda "Bytes sent: 77, Bytes received: 0" görüldü; emülatör her proba 1 ms'de cevap verdiği halde sonuç "Could not find ECU" oldu. Bu, portun DSR'ye duyarlı açıldığını gösteriyor (`fDsrSensitivity`) [Inferred].
- Emülatör açılışta `DTR=1, RTS=1` yapınca tespit hemen başarılı oldu. Gerçek ECU/kablo bu hatları zaten sürüyor; null‑modem emülasyonunda bu adım şart.

**Gözlenen tam açılış dizisi** (aynı oturum, `emu.mjs --trace`):
1. prob → `02 7F` CRC‑hata çerçevesi
2. `F2` sub 3, 2, 5, 4
3. ~500 ms sonra `F4` ile sayfalar 01, 0A, 08, 0E, 00, 02, 04, 0F, 03, 0C, 0D, 06, 07
4. `0C F5` (EEPROM)
5. seri no adı sorulur
6. `A0` realtime ≈ 22 Hz

Tablo hücresi değişince anında tek bir `FB` yazılır. Burn'de VemsTune önce ilgili eksen bölgesini (VE: ofset 0xF0–0xFD) yeniden `FB` ile yazar, ardından `04 EF` → `01`, `03 EF` → `01`. "Refresh" sayfayı `F4` ile yeniden okur.

---

## 2. Port / ECU tespiti

### 2.1 Bileşenler
- `SerialPortScanner` (port listesi üzerinde gezer) → her port için `PortScanner` (baud listesi üzerinde gezer) → her baud denemesi için yeni `DeviceDetector` [Observed] `PortScanner::startProcess @0x00e226dc` (port baud'u ayarlanır `vtbl+0x24`, port temizlenir `vtbl+0x4c`, `registerDeviceDetector @0x00e219bc`).
- Baud başına **en fazla 2 deneme** (`+0x70 < 2`), sonra sonraki baud; TCP portunda (`port+0x120 == 1`) tek deneme. Liste bitince `checkAIM` açıksa ve tur sayısı < 3 ise baştan tekrar. [Observed] `PortScanner::OnDeviceNotFound @0x00e1f14c`.
- Bulununca `PortScannerEvent{device, mode, baud}` ile FSM'e bildirilir [Observed] `PortScanner::finish @0x00e1f068`. AIM bulunursa `device=4, mode=0x0F (Aim)` [Observed] `PortScanner::OnAIMDeviceFound @0x00e1f124`.

### 2.2 ECUInfo enum'ları [Observed]
| `ECUInfo::Device` (`getDeviceAsString @0x00a09274`) | | `ECUInfo::EcuMode` (`getStateAsString @0x00a091a4`) | |
|---|---|---|---|
| -2 | Init | 0x0B | Boot |
| 1 | V3 (Genboard v3) | 0x0C | Megatune |
| 2 | Round (WBO2) | 0x0D | Man |
| 3 | Arm | 0x0E | M168BLS |
| 4 | (AIM; string tablosunda "UNKNOWN") | 0x0F | Aim |
| | | 0x10 | SIPR (tespit yolunda üretilmiyor) |
| | | 0x11 | (adsız; "GPSVEMS Genboard v3" — Detecting'de Man gibi işlenir) |
| | | 0x12 | TRIGGER_FRAME |

Boot durumları (`getBootStateAsString @0x00a0930c`): 0x32 "From Fw (old)", 0x33 "Bad marker (old)", 0x34 "Bad marker", 0x35/0x36 "From Fw", 0x37 "Loopback", 0x38 "Sflood", 0x50 "Page loader", 0x72 "Old chex2", 0x76 "BOOTLOADER 2011-03-01". Boot tipleri (`getBootTypeAsString @0x00a0940a`): 0 BOOT_HEX, 1 BOOT_CHEX, 2 BOOT_CHEX2, 3 BOOT_UHEX, 4 BOOT_SHEX, 5 BOOT_LHEX, 6 BOOT_VHEX, 7 BOOT_UNKNOWN, diğer BOOT_INVALID.

### 2.3 DeviceDetector probu ve tanıyıcılar [Observed]

`DeviceDetector::write @0x00dea744` (durum 1) **7 bayt** gönderir (VA 0x01187904'teki sabit):

```
53 6D 78 63 2E FF 7E        ; "Smxc." 0xFF 0x7E
```
Zamanlayıcı: `m_timeout + 0x100` ms (200 ms ile ≈ 456 ms) → durum 2.

[Inferred] Probun tasarımı çok-dilli: MegaTune modundaki ECU `S` (versionInfo/sinyal) komutuna imza dizesiyle cevap verir; Man modundaki ECU menü komutlarına ("m…") konsol metniyle cevap verir; TF modundaki ECU ise sondaki `0x7E`'yi çerçeve sonu sayar, `53 6D 78 63 2E FF` CRC'sini tutturamaz ve **CRC hata çerçevesi** döner (aşağıda).

`DeviceDetector::read @0x00dea7a8` gelen her baytı tüm tanıyıcılara ve bir `TriggerFrameFSMCRC`'ye besler. Tanıyıcı listesi `DeviceDetector::<ctor> @0x00deb674` (her biri `StringRecognizer`, alt-dize eşleşmesi):

| Alt dize (ASCII, ECU→host) | Device | EcuMode |
|---|---|---|
| `VEMS Genboard v3` | 1 V3 | 0x0C Megatune |
| `GPSVEMS Genboard v3` | 1 V3 | 0x11 |
| `Yes, menu and comm worx` | 1 V3 | 0x0D Man |
| `AVREFI1` | 1 V3 | 0x0B Boot |
| `AVR3` | 1 V3 | 0x0B Boot |
| `VEMS Round WBO2 v` | 2 Round | 0x0C Megatune |
| `MenuPingx` | 2 Round | 0x0D Man |
| `AVR2` | 2 Round | 0x0B Boot |
| geçerli TF çerçevesi, tip **0x7F** | 1 V3 | 0x12 TRIGGER_FRAME |

- Eşleşmeden sonra durum 5: tampon boşaltma — 1 ms aralıkla **16 tik** (Round için **512 tik**) daha okunur, sonra bitiş [Observed].
- TF yolu: `TriggerFrameFSMCRC::parse` true ve `getType()==0x7F` → (V3, 0x12). CRC hatalı çerçeve gelirse (FSM hata kodu 2) **en fazla 3 kez** probu tekrarlar (zamanlayıcı `m_timeout+100`) [Observed].
- Zaman aşımı → `DeviceNotFound` (finish kodu 1).
- **Emülatör (TF modunda) prob cevabı** [Observed+hesap]: CRC hata çerçevesi `[02 7F]` → kablo baytları `02 7F 41 30 7E` (bkz. §4.6; VemsTune'un yerleşik test ECU'su da aynı çerçeveyi üretir: `TriggerFrameTestCommunicationBase::CreateCrcErrorResponse @0x00487ca0`, `SendByte @0x00487ad2`).
- **Emülatör (MegaTune modunda)**: `S` için ör. `VEMS Genboard v3, 1.2.34` benzeri imza dizesi (alt dize `VEMS Genboard v3` içermeli). Ayrıntı §6.

### 2.4 AIM pasif dinleme [Observed]
`checkAIM`=1 ise (konfig hash'i) DeviceDetector **göndermeden** `aimfallbacktime × 1000 + m_timeout` ms dinler; baytlar `AIMRecognizer::feed @0x00bae986`'ya beslenir; ≥300 bayt sonrası tanıyıcı isabeti < 6 → bulunamadı, ≥ 6 → AIM (finish kodu 2). Kayıt formatı §8.

---

## 3. Bağlantı FSM'i (`VemsDeviceControllerFSM`)

### 3.1 Yapı [Observed]
`VemsDeviceControllerFSM::<ctor> @0x00bd1120` dinleyici arayüzlerini (PortScanner, FirmwareInfoFetcher, MegatuneSyncer, Timeout, DeviceModeSelector, BaudRateSelector, PasswordChecker, BootState, FirmwareVersionFetcher) uygular ve olayları **geçerli duruma** (`VemsDeviceControllerState` alt sınıfı, `+0x24` = FSM işaretçisi) iletir; temel sınıf olay işleyicileri boş (`VemsDeviceControllerState::On* @0x00eeed18..0x00eeed70`). FSM eylem metotları (`connect`, `sync`, `checkPassword`, …) `VemsDeviceController` metotlarına yönlenir; her eylem bir **iletişim istemcisi** (PasswordChecker, DeviceModeSelector, V3FirmwareVersionFetcher, TriggerFrameCommunicationClient, …) oluşturup `registerAndStartCommunicationClient` ile başlatır.

Durumlar: `Detecting`, `CheckingPassword`, `FetchingFirmwareVersion`, `FetchingFirmwareInfo`, `Syncing`, `InitTriggerFrameMode`, `Connected`, `BootMode`, `Resuming`.

### 3.2 Geçiş tablosu [Observed]

| Durum | Olay | Koşul | Eylem → Yeni durum | Kaynak |
|---|---|---|---|---|
| Detecting | DeviceFound(dev,mode,baud) | dev==4 (AIM) | `connect` → Connected | `Detecting::OnDeviceFound @0x00bd30ae` |
| Detecting | DeviceFound | mode 0x0B | `detectBootState` (BootStateDetector) | aynı |
| Detecting | DeviceFound | mode 0x0C | → `OnMegatuneMode` (aşağı) | aynı |
| Detecting | DeviceFound | mode 0x0D / 0x11 | `selectMegatuneMode` (DeviceModeSelector → MT) | aynı |
| Detecting | DeviceFound | mode 0x12 | `initTriggerFrameMode` → InitTriggerFrameMode | aynı |
| Detecting | OnMegatuneMode | `preferredBaudrate` var ve seri port | `changeToPreferredBaudrate` (BaudRateSelector, §6) | `Detecting::OnMegatuneMode @0x00bd450e` |
| Detecting | OnMegatuneMode | aksi, device≠V3 | `fetchFirmwareInfo` → FetchingFirmwareInfo | aynı |
| Detecting | OnMegatuneMode | aksi, V3 | `checkPassword(1)` → CheckingPassword | aynı |
| Detecting | BaudrateChanged(b) | — | setBaudrate; → OnMegatuneMode | `@0x00bd4274` |
| Detecting | DeviceModeSelected(m) | — | setDeviceMode(m); → OnMegatuneMode | `@0x00bd4244` |
| Detecting | BootStateDetected(fi) | leaveBootMode kapalı | `bootModeFound` → BootMode | `@0x00bd4674` |
| Detecting | BootStateDetected | leaveBootMode açık | `selectMegatuneMode2` (19200/9600 dener) | aynı |
| Detecting | Timeout | sayaç < 3 | `selectMegatuneMode2` tekrar | `@0x00bd4628` |
| Detecting | Timeout | sayaç ≥ 3 | `sendCannotLeaveBootMode` | aynı |
| Detecting | DeviceNotFound | — | `deviceNotFound` (yeniden tarama zamanlayıcısı) | `@0x00bd422e` |
| CheckingPassword | DeviceProtected(serial) | — | seri no kaydı, `DeviceProtected` olayı (GUI parola ister) | `@0x00bd4dd6` |
| CheckingPassword | DeviceNotProtected | V3 | `fetchFirmwareVersion` → FetchingFirmwareVersion | `@0x00bd4e08` |
| CheckingPassword | DeviceNotProtected | V3 değil | `fetchFirmwareInfo` → FetchingFirmwareInfo | aynı |
| FetchingFirmwareVersion | FirmwareVersion(v) | v **≥ 1.1.98** | `selectDeviceMode(0x12)` (MT→TF geçişi) | `@0x00bd5ac2` (`FirmwareVersion(1,1,0x62)`) |
| FetchingFirmwareVersion | FirmwareVersion(v) | v < 1.1.98 | `fetchFirmwareInfo` → FetchingFirmwareInfo | aynı |
| FetchingFirmwareVersion | DeviceModeSelected(m) | — | `initTriggerFrameMode` → InitTriggerFrameMode | `@0x00bd60ac` |
| FetchingFirmwareInfo | FirmwareInfoFetched(fi) | yeniden bağlanma değil | `sync` → Syncing | `@0x00bd613a` |
| FetchingFirmwareInfo | FirmwareInfoFetched | yeniden bağlanma | `getAllPages` | aynı |
| FetchingFirmwareInfo | AllPageReceived | — | `reconnect` + DeviceReconnected olayı → Connected | `@0x00bd61f8` |
| FetchingFirmwareInfo | DeviceModeSelected | — | `sync` → Syncing | `@0x00bd6278` |
| Syncing | FirmwareDataSynced / DeviceModeSelected | — | `connect` → Connected | `@0x00bd62d2`, `@0x00bd632c` |
| InitTriggerFrameMode | FirmwareInfoFetched(fi) | yeniden bağlanma değil | `syncTriggerFrameMode` (+ `getAllPagesTriggerFrameMode`) | `@0x00bd63ba` |
| InitTriggerFrameMode | FirmwareDataSynced | preferred baud & seri | `changeToPreferredBaudrate` (TF `0xFC`) | `@0x00bd67b0` |
| InitTriggerFrameMode | FirmwareDataSynced | aksi | `connectTriggerFrameMode` → Connected | aynı |
| InitTriggerFrameMode | BaudrateChanged(b) | — | setBaudrate; `connectTriggerFrameMode` → Connected | `@0x00bd6b1c` |
| InitTriggerFrameMode | AllPageReceived | — | `reconnect` → Connected | `@0x00bd684c` |
| Connected | DeviceModeSelected | preferred baud yok | setDeviceMode(0x0C); `checkPassword(1)` → Detecting | `@0x00bd70a4` |
| Connected | DeviceModeSelected | preferred baud var | `changeToPreferredBaudrate` | aynı |
| Connected | BaudrateChanged | — | setBaudrate, `baudrateChanged` | `@0x00bd7142` |
| BootMode | DeviceModeSelected | — | `fetchFirmwareInfo` → FetchingFirmwareInfo | `@0x00bd4d48` |
| Resuming | DeviceFound / ModeSelected / NotProtected… | sürüm ≥1.1.98 & V3 | `selectDeviceMode(0x12)`; aksi `resumeBaudrate`/`getAllPages` → Connected | `Resuming::* @0x00bd73f6..0x00bd7edc` |
| (çoğu durum) | Timeout | — | `FSM.timeout` | `VemsDeviceController::timeout @0x00bca798` |

`VemsDeviceController::timeout @0x00bca798` [Observed]: ardışık zaman aşımı sayacı < 3 ise FSM reset + `resetDevice` + yeniden tespit zamanlayıcısı; aksi halde bağlantı kesildi olayı (0x0E) ve `resetDevice`.

### 3.3 V3, firmware ≥ 1.1.98 — tipik açılış dizisi

```
VemsTune                                           ECU (emülatör)
  |-- [baud 19200] 53 6D 78 63 2E FF 7E ------------>|   (§2.3)
  |<------------- "...VEMS Genboard v3..." (MT modu) |   veya 02 7F 41 30 7E (TF modu → doğrudan InitTriggerFrameMode)
  |   [opsiyonel] "mcB%02X" → "OK\r\n" (§6 BaudRateSelector)
  |-- "." (parola sorgusu) ------------------------->|   (§3.4)
  |   (≤ m_timeout içinde "BAD pw\r\n<seri>" yoksa → korumasız)
  |-- V3FirmwareVersionFetcher (MT modunda sürüm) -->|   (§6)
  |<------------- sürüm  (≥1.1.98)                  |
  |-- DeviceModeSelector: MT → TF geçişi ----------->|   (§6)
  |== TF modu ======================================|
  |-- F2 sub=3,2,5,4 (ECU details) ×4 -------------->|   (§4.5.1)
  |-- F4 FF id  (her SRAM sayfası) + F5 0C (EEPROM)->|   (§4.5.3, sync)
  |-- F4 … tekrar (getAllPages)                      |
  |   [opsiyonel] FC ubrr → 7C (baud değişimi)        |
  |== Connected: A0 realtime döngüsü, FB yazma, EF burn
```
[Observed] dizilim: `CheckingPassword::OnDeviceNotProtected`, `FetchingFirmwareVersion::OnFirmwareVersion`, `VemsDeviceController::initTriggerFrameMode @0x00bcc794` (TF istemcisi + `TriggerFrameController::fetchFirmwareInfo`), `InitTriggerFrameMode::OnFirmwareInfoFetched`, `VemsDeviceController::syncTriggerFrameMode @0x00bcc952` (`TriggerFrameController::sync`), `getAllPagesTriggerFrameMode @0x00bcce04`. MT/Man ayrıntıları için §6.

### 3.4 Parola / kilitli ECU protokolü (yalnız protokol) [Observed]

`PasswordChecker` (`@0x00e27c94` ctor; `write @0x00e288c4`, `read @0x00e28cf8`, `waitP @0x00e28a44`, `waitPw @0x00e28908`, `finish @0x00e27a8c`):

| Adım | Yön | Bayt | Bekleme |
|---|---|---|---|
| 1 | host→ECU | `2E` (`"."`) | `m_timeout` |
| 2a | ECU→host (kilitli) | `BAD pw\r\n` + seri no; regex `BAD pw\r\n(\w{1}\d{1}.\d{1}_\w{1}\d{6})` (ör. `BAD pw\r\nv3.3_n001453`) | — |
| 2b | (kilitsiz) | hiçbir şey → zaman aşımı → sonuç 0 = **NotProtected** | |
| 3 | host | serinin **son 6 hanesi** ile `password.txt` (`{6hane}={8 hex}`) aranır (`PasswordHelper::checkPassword @0x00badfc0`) | |
| 4 | host→ECU | parola bulunduysa: `%04X` + `"."` (ör. `1A2B.`) | `m_timeout` |
| 5 | ECU→host | `pwOK` → sonuç 1 (NotProtected olarak devam); zaman aşımı → 2 (Protected) | |
| — | | parola yok/geçersiz → sonuç 3 (Protected; GUI kullanıcıdan ister) | |

Parola dönüşümü [Observed]: dosyadaki 8 hex hane `h` (32 bit) `isPasswordAccepted @0x00bae6d2`: 8 hex hane formatı, `h≠0` ve `checkMagic @0x00bae714`: her i∈[0,15] için bit(2i) == bit(31−2i). Gönderilen 16 bit = `resolveMagic @0x00bae7a0`: bit i ← h'nin bit(2i)'si. `finish`: sonuç 0/1 → `OnDeviceNotProtected`, 2/3 → `OnDeviceProtected`.
Emülatör: kilitsiz ECU için `.` baytını **yok saymak** (cevap vermemek) yeterli. Aynı `BAD pw`/`pwOK` diyaloğu TF trigger-log modunda `TriggerFrameCommunicationClient` tarafından da yürütülür (`<ctor> @0x00e26b14`, `read @0x00e27200`, `findPassword @0x00e270a0`).

---

## 4. TriggerFrame (TF) protokolü — birincil ikili protokol

### 4.1 Çerçeve formatı [Observed]

```
mantıksal çerçeve:  body = data[0..k)  [value: 0/1/2/4 B]  [subtype: 0/1 B]  type(1 B)
CRC:                crc = CRC-16/MODBUS(body)   (Math::crc16_sipr; poly 0xA001 yansıtılmış, init 0xFFFF, xorout 0)
kablo:              escape(body ‖ crc_lo ‖ crc_hi) ‖ 0x7E
escape:             0x7D → 7D 5D ;  0x7E → 7D 5E ;  diğerleri aynen   (yani 7D, x^0x20)
```
- Başlangıç bayrağı **yok**; `0x7E` yalnız sonlandırıcı. Alıcı FSM: durum 1'de bayt biriktir; `0x7D` → kaçış durumu (`]`→7D, `^`→7E, diğer → çerçeveyi at); `0x7E` → çerçeve tamam [Observed] `TriggerFrameFSM::parse @0x0082056c`, `reset @0x008206a0` (ctor durum=1 @0x008203f0).
- CRC kontrolü: son 2 bayt LE CRC, kalan baytlar üzerinde CRC-16/MODBUS [Observed] `TriggerFrameFSMCRC::checkCRC @0x00820a22`; kısa çerçeve (<3 bayt) geçersiz. Başarı kodu 0, CRC hatası kodu 2 (`TriggerFrameFSMCRC::parse @0x008208b0`, `getErrorCode @0x00f8dbe8`).
- Gönderim: `TriggerFrame::create @0x00e970e8` (CRC her ham bayta işlenir, sonra kaçışla eklenir, sonuna 0x7E), `escape @0x00e97248`.
- Tip = CRC'den önceki **son** bayt (`TriggerFrameEx::getType @0x0081ed6c`; alıcıda `TriggerFrameFSMCRC::getType` = frame[n−3]). Alınan `TriggerFrameEx`'te CRC'nin 2 baytı çıkarılır (`TriggerFrameEx(IntArray,bool) @0x0081e756`).

**Gövde kurucu** `TriggerFrameEx::create(type, subtype, value, data, len) @0x0081eaf8` [Observed]:
1. `data[0..len)` baytları,
2. `value ≥ 0` ise: tip `0xF5` → 1 bayt; tip `0xF4`/`0xF9`/`0xFB` → 2 bayt **big-endian**; diğer → 4 bayt `00, (v>>16)&FF, (v>>8)&FF, v&FF`,
3. `subtype ≥ 0` ise 1 bayt,
4. `type`.
Kurucular: `(type,value)` @0x0081e420, `(type,data,len)` @0x0081e530, `(type,value,data,len)` @0x0081e312, `(type,subtype,value,data,len)` @0x0081e640.

Hazır örnekler (hesaplandı, CRC-16/MODBUS LE):
| Anlam | Gövde | Kablo baytları |
|---|---|---|
| CRC hatası cevabı | `02 7F` | `02 7F 41 30 7E` |
| Realtime isteği | `A0` | `A0 BF 38 7E` |
| İmza isteği (ECU details sub 4) | `04 F2` | `04 F2 82 F5 7E` |
| Burn | `04 EF` | `04 EF 42 FC 7E` |
| H sayfası okuma (ecu id 1) | `FF 01 F4` | `FF 01 F4 41 E7 7E` |

### 4.2 Tip kodları [Observed] `TriggerFrame::getTypeAsString @0x008192e0`

| Tip | Ad | Yön | İlgili cevap |
|---|---|---|---|
| 0x00–0x61 (0x20 hariç) | TRIGGER_EVENT(n) | ECU→host (akış) | — |
| 0x20 | READ_REALTIME_RESPONSE | ECU→host | ← 0xA0 |
| 0x30 | (GPS paketi; SD log dönüştürücüde) | ECU→host | — (`TriggerFrameToSiprLogConverter::processTriggerFramePacket @0x00bc16a2`) |
| 0x6F | EEPROM_CONTROL_RESPONSE | ECU→host | ← 0xEF |
| 0x72 | READ_ECU_DETAILS_RESPONSE | ECU→host | ← 0xF2 |
| 0x73 | SDCARD_GETBLOCK_RESPONSE | ECU→host | ← 0xF3 |
| 0x74 | SRAM_READ_RESPONSE | ECU→host | ← 0xF4 |
| 0x75 | EEPROM_READ_RESPONSE | ECU→host | ← 0xF5 |
| 0x77 | (adsız; trigger-log özel işleme) | ECU→host | `TriggerFrameCommunicationController::onReceiveTriggerFrame @0x00819d12` |
| 0x78 | GET_PAGE_LEN_CRC_RESPONSE | ECU→host | ← 0xF8 |
| 0x79 | EEPROM_WRITE_RESPONSE | ECU→host | ← 0xF9 |
| 0x7A | SDCARD_RESPONSE | ECU→host | ← 0xFA |
| 0x7B | SRAM_WRITE_RESPONSE | ECU→host | ← 0xFB |
| 0x7C | CHANGE_BAUDRATE_RESPONSE | ECU→host | ← 0xFC |
| 0x7F | TRIGGERFRAME_ERROR_TYPE | ECU→host | herhangi bir isteğe |
| 0xA0 | READ_REALTIME_REQUEST | host→ECU | → 0x20 |
| 0xB1 | EXIT_TRIGGERFRAME_MODE | host→ECU | (DeviceModeSelector/Megatune ctor'larında kullanılır, §6) |
| 0xEF | EEPROM_CONTROL_REQUEST | host→ECU | → 0x6F |
| 0xF0 | SIMPLE_MSG_STUFFED_TYPE_COMMAND | host→ECU | |
| 0xF1 | READ_FLASH_STUFFED_TYPE_COMMAND | host→ECU | |
| 0xF2 | READ_ECU_DETAILS_REQUEST | host→ECU | → 0x72 |
| 0xF3 | READ_SDCARD_STUFFED_TYPE_COMMAND | host→ECU | → 0x73 |
| 0xF4 | SRAM_READ_REQUEST | host→ECU | → 0x74 |
| 0xF5 | EEPROM_READ_REQUEST | host→ECU | → 0x75 |
| 0xF6 | GO_BOOTLOADER_STUFFED_TYPE_COMMAND | host→ECU | |
| 0xF7 | TEST_TOOLS_STUFFED_TYPE_COMMAND | host→ECU | |
| 0xF8 | GET_PAGE_LEN_CRC_STUFFED_TYPE_COMMAND | host→ECU | → 0x78 |
| 0xF9 | EEPROM_WRITE_REQUEST | host→ECU | → 0x79 |
| 0xFA | SD_CMD_STUFFED_TYPE_COMMAND | host→ECU | → 0x7A |
| 0xFB | SRAM_WRITE_REQUEST | host→ECU | → 0x7B |
| 0xFC | CHANGE_BAUDRATE_REQUEST | host→ECU | → 0x7C |

**Eşleştirme kuralı [Observed]:** cevap tipi = istek tipi − 0x80 (`SynchronousHandler::onReceiveTriggerFrame @0x00817a70`: `pendingType − 0x80 == rxType`).

### 4.3 Hata çerçevesi (tip 0x7F) [Observed]
Gövde: `[reason] [category] 7F` (ya da yalnız `[code] 7F`). Kod = `reason<<8 | category` (`TriggerFrameEx::getErrorInfoString @0x0081f238`, `TriggerFrame::getErrorSubTypeAsString @0x008196ca`):

| Kod | Anlam | | Kod | Anlam |
|---|---|---|---|---|
| 0x01 | UNKNOWN_COMMAND | | 0x0109 / 0x0209 | EEPROM_CONTROL \| NO_SUBTYPE / ERROR_BUSY |
| 0x02 | CRC (ECU, host çerçevesinde CRC hatası gördü) | | 0x010A / 0x020A | SRAM_WRITE \| NO_PARAMETERS / OVERWRITE |
| 0x03 | SD_BASE (SD hata ailesi; `isSDCardErrorType @0x0081f46a`: frame[n−2]==3) | | 0x0108 / 0x0208 | TEST_TOOLS \| NO_SUBTYPE / BAD_SUBTYPE |
| 0x0104 / 0x0204 | ECU_DETAILS \| NO_SUBTYPE / BAD_SUBTYPE | | 0x0308..0x0908 | TEST_TOOLS \| DIGITALOUT/IGNDWELL/ENA_FLAGS/DIS_FLAGS/FORCE_ADV/FORCE_IAC/FORCE_GENERAL_MISSING_PARAMETER |
| 0x0105 / 0x0205 | SD_CMD \| NO_SUBTYPE / BAD_SUBTYPE | | 0x0107 | CHANGE_BAUD \| NO_PARAMETER |
| 0x0106 / 0x0206 | GO_BOOTLOADER \| NO_PARAMETER / CANT_GO | | | |

Host davranışı [Observed]: `0x7F` gelince — CRC tipi ise (`frame[n−2]==2`, `SynchronousHandler::isCrcErrorType @0x00818cb6`) `onCRCError` (aynı isteği yeniden gönderme; ardışık **3**'e kadar, `SynchronousHandler::onCRCError @0x0081828a`); SD hata tipi ise SD işleyicisine; diğerleri bekleyen isteği düşürür ve loglar.

### 4.4 İstek/cevap motoru, zaman aşımı, yeniden deneme [Observed]
- `TriggerFrameCommunicationController` (`<ctor> @0x00819a54`) bir `SafeQueue<TriggerFrameRequest>` ve bir `SynchronousHandler` tutar. `TriggerFrameCommunicationClient::write @0x00e26688` her turda `poll` ile sıradaki isteği alır ve `getEscapedData()` baytlarını yazar.
- **Dur-bekle (stop-and-wait):** `SynchronousHandler::poll @0x008178ba` yalnızca bekleyen (pending) istek yokken kuyruktan bir istek çıkarır; aynı anda tek istek uçuştadır.
- `TriggerFrameRequest{frame, timeout(+8), tryCount(+0xC), deadline(+0x10)}` (`<ctor> @0x00823244`). Deadline = `now + timeout`, timeout 0 ise **1000 ms** (`setTimestamp @0x00818ae0`).
- Zaman aşımı (`isTimedout @0x0081852a`): `tryCount == 0` → başarısız (zaman aşımı olayı, `TriggerFrameCommunicationController::timeout @0x0081aa24`); aksi halde `tryCount−−` ve istek **kuyruğun başına** geri konur (yeniden gönderim).
- Kullanılan değerler: ECU details `1000 ms, 1 tekrar` (`FirmwareInfoHandler::request @0x0081169a`); realtime `1000 ms, 1 tekrar` (`RealtimeHandler::request @0x00812d6a`); SRAM bölüm okuma `1000/1` (`TriggerFrameMemoryHandler::readSramSection @0x00822d42`, `request @0x0082180a`); sayfa/yazma/burn çerçeveleri varsayılan `0/0` → 1000 ms, tekrar yok (`TriggerFrameMemoryHandler::request @0x00820d2e`).
- **İstenmemiş (unsolicited) çerçeveler:** tip ≤ 0x61 (0x20 hariç; trigger olayları) ve 0x7C doğrudan olay olarak yayınlanır, bekleyen istekle eşleştirilmez (`TriggerFrameCommunicationController::onReceiveTriggerFrame @0x00819d12`).
- Host tarafında CRC hatalı çerçeve alınırsa `TriggerFrameCommunicationController::onCRCError @0x0081a008` (TriggerFrameEvent(2) + aynı yeniden deneme mantığı) [Observed]; `TriggerFrameController::sendRTCRCErrorPacket @0x0081dd52` GUI/log'a SIPR `RT_CRC_ERROR (150)` üretir [Inferred isimden].
- Trigger-log modunda 0x800 bayt boyunca geçerli çerçeve yoksa port 19200'e sıfırlanır (`TriggerFrameCommunicationClient::read @0x00e27200`, `onBaudRateReset @0x0081b1c2`) [Observed].

### 4.5 Mesajlar (ana set)

#### 4.5.1 READ_ECU_DETAILS (0xF2 → 0x72) [Observed]
- İstek: `[sub] F2`. `FirmwareInfoHandler::fetchFirmwareInfo @0x0080fca8` sırası: **3 (SERIAL_NUMBER), 2 (COMPILATION_TIME), 5 (MTCODEVER), 4 (SIGNATURE)**.
- Cevap: `ASCII… [sub] 72` — metin = data[0..n−2) (`FirmwareInfoHandler::getDataAsString @0x008118fa`; gömülü NUL toleranslı). `onReceiveTriggerFrame @0x0080fd4c`: sub 3 → `setSerialNumber`; 2 → `setCompilationTime`; **4 → `setFirmwareOptions` + sürüm regex `(\d{1}.\d{1}.(?:\d{2}|\d{1}))` → `setFirmwareVersion` → `FirmwareInfoFetched` olayı** (son istek olduğu için bağlantıyı ilerletir); 5 → `setSignature` (MegaTune INI imzası; INI seçimi bununla).
- Yerleşik test ECU'sunun cevapları (`TriggerFrameTestCommunicationBase`, emülatör için birebir şablon):

| sub | Metin | Kaynak |
|---|---|---|
| 2 | `2011-11-24 15:15` | `CreateCompTimeReponse @0x00488278` |
| 3 | `v3.3_n003361` | `CreateSerialResponse @0x00488432` |
| 4 | `VEMS Genboard v3, 1.1.98` + `00 5E` (2 ek bayt) | `CreateSignatureResponse @0x004885ec` |
| 5 | `VEMS v1.1.98 16x14 kpa=2,1` | `CreateMtcodeverResponse @0x00488834` |

  sub 5 metni, INI `[MegaTune] signature` (ör. `vemsTune-v3-1.2.34.ini`: `"VEMS v1.2.34 16x14 kpa=2,1"` / `kpa=2,2` HIGHBOOST) ile eşleşmeli [Inferred]. sub 4'teki `00 5E` ekinin anlamı [Unknown].
- Geçersiz sub → `[02 04 7F]` (ECU_DETAILS|BAD_SUBTYPE) [Inferred tablodan].

#### 4.5.2 READ_REALTIME (0xA0 → 0x20) [Observed]
- İstek: `A0` (`RealtimeHandler::<ctor> @0x00811f24`: `TriggerFrameEx(0xA0, -1)`).
- Cevap: `rt[0..N) 20`; N = INI `ochBlockSize` (1.2.34: **75**; test ECU 1.1.98: 73 — `CreateReadRealtimeResponse @0x004889ee`, data `+0x170`, 0x49 bayt, ofset 8'de artan sayaç).
- İçeride SIPR `READ_SENSORS(7)` paketine çevrilir: `0A seq=0 07 len=N+3 | 00 00 01 rt[0..N) | crc` (`RealtimeHandler::sendRtPacket @0x0081265e`, `SIPRPacket::<ctor> @0x00bb9680` → payload `[0,0,subtype=1, data…]`). Ayrıca her cevapta SIPR `RT_TIME(0x93)` (4 bayt, bağlantıdan beri ms; `Math::getBytes`) ve frekans değişince `UPDATE_FREQUENCY(0x94)` (4 bayt) üretilir (`sendRtTimePacket @0x0081283e`, `sendUpdateFrequencyPacket @0x00812a38`) — kabloya gitmez.
- Hız kontrolü: normal modda ardışık hat — ctor'da `sendRealtimeRequest @0x0081261c` (bekleyen < 3 ise **2 istek** kuyruğa), her cevapta bekleyen−1 ve yeni istek; dur-bekle nedeniyle pratikte cevap gelir gelmez yeni `A0` gider. **Gecikmeli mod**: `rtDelay` (MTConfig `+0x90`) > 0 ise wxTimer `rtDelay` ms periyotla, bekleyen yoksa tek istek (`enableDelayedMode @0x00812568`, `OnTimer @0x00812ea4`, `TriggerFrameController::enableRealtime @0x0081c220`).
- Doğrulama: `RealtimeDataChecker::refresh @0x00712836` `secl` (RT bayt 0, saniye sayacı U08) değerinin önceki değere eşit ya da +1 olmasını bekler; değilse hata sayar (`rterrorcount`). **Emülatör `secl`'i saniyede 1 artırmalı.**

#### 4.5.3 SRAM_READ / sayfa okuma (0xF4 → 0x74) [Observed]
- **Sayfa okuma:** `[FF][ecuId] F4` — adres = `0xFF00 | ecuPageId` (`TriggerFrameFactory::createSramAddress @0x0081fedc`; ecuPageId ≥ 0x100 ise geçersiz), uzunluk baytı **yok** (`createReadPageTF @0x0081ff2c`). `ecuPageId` = INI `vt_2_ecu_id = <vtPage>, <ecuId>` ikinci değeri (`SIPRDescriptor::addVt2EcuId @0x00bb6fc4` → `SIPRPageDescriptor::setEcuPageId`; okuma `getEcuPageId @0x00bb81dc`).
- **Ham SRAM okuma:** `[len][addrHi][addrLo] F4` (`readSramSection @0x00822d42`: `TriggerFrameEx(0xF4, addr, &len, 1)`).
- Cevap: `data[0..L) [addrHi][addrLo] 74` — adres yankısı tipten hemen önce; `handleSramReadRealtimeRequest @0x0082206e` adresi `frame[n−3]*256 + frame[n−2]` ile doğrular ve `n−3` veri baytı alır; `SIPRPacketFactory::create @0x00bb9e70` da 0x74 için `count−3` bayt kullanır. Sayfa cevabında L = sayfa boyu (INI), adres yankısı `FF id` [Inferred, aynı kod yolu].
- Sayfa verisi içeride SIPR'e dönüştürülür (`SIPRPacketFactory::create @0x00bb9e70`): sayfa tipi `SIPR_GET_TABLEDATA(5)` ise sayfadaki her tablo için `0A 00 05 (size+1) | tableId data[off..off+size) | crc`; `SIPR_GET_CONFIG_1/2` (0x0D/0x0E) için `0A 00 0D|0E size | data[0..size)`. ofset/boy INI `sipr_table`/`sipr_config` satırlarından.

#### 4.5.4 Sayfa yazma — SRAM_WRITE (0xFB → 0x7B) [Observed]
- `TriggerFrameFactory::createWriteTF @0x00820042`: her **tek bayt** için bir çerçeve:
  `[value][offset_lo8][addrHi][addrLo] FB`, adres = `0xFF00|ecuId`; ofset > 0xFF ise ofset −= 0x100 ve adres `&= 0x7FFF` (yani `7F id`). (Veri iki baytı `CONCAT11(offset,value)` küçük-endian bellek düzeni → önce value, sonra offset [Inferred-güçlü].)
- Cevap tipi 0x7B (gövde düzeni bölüm §7'de/yardımcı ajan raporunda) — host çerçeveyi gönderip kuyruğa alır, sonra GUI'ye SIPR ACK paketi üretir (`TriggerFrameMemoryHandler::request @0x00820d2e` → `sendAckPacket @0x00822b9e`).
- Sayfa `0x1E` (CONFIG_EEPROM) ise EEPROM yazma kullanılır: `createWriteEEPROM(base=0xC0, offset<0x40, value)` → `[value][addrHi][addrLo] F9`, addr = `0xC0 + offset` (`@0x0082025a`; `offset < 0x40` ve `addr+1 ≤ 0x1000`).

#### 4.5.5 Burn — EEPROM_CONTROL (0xEF → 0x6F) [Observed]
- `TriggerFrameFactory::createBurn @0x0081fd62`: `TriggerFrameEx(0xEF, -1, {0x04}, 1)` → `04 EF` → kablo `04 EF 42 FC 7E`.
- `SynchronousHandler`: istek verisinin ilk baytı 3 ise (poll alt komutu) ya da cevap durum baytı (`frame[n−3]`) 1 değilse otomatik **yoklama isteği** `03 EF` kuyruğa eklenir ve tekrarlanır (`createEepromPollRequest @0x00818b14`, `handleEepromControlRequest @0x008188c4`, `handleEepromControlResponse @0x008189dc`). [Inferred] ECU burn'ü arka planda yapar; host `03 EF` ile durum 1 (tamam) görene kadar yoklar. Cevap gövdesinin tam düzeni yardımcı bölümde (§7).

#### 4.5.6 EEPROM okuma (0xF5 → 0x75) [Observed]
- `[idx] F5` (1 bayt değer). CONFIG_EEPROM sayfası (`page_eeprom = 30`, iç id 0x1E) için idx = **0x0C** (`createReadPage @0x0081f770`). Cevap > 64 bayt; ilk **64** bayt içeride `0A 00 05 41 | 1E data[64] | crc` olur (`SIPRPacketFactory::create @0x00bb9e70`). Not: yazma tabanı 0xC0 = 0x0C×16 [Inferred: idx = 16-baytlık blok no?].

#### 4.5.7 Baud değiştirme (0xFC → 0x7C) [Observed]
- `[ubrr] FC`; ubrr: 9600→0x68, 19200→0x34, 38400→0x1A, 57600→0x10, 115200→0x08, diğer `1000000/baud − 1` (`TriggerFrameController::changeBaudrate @0x0081bdde`).
- ECU `… 7C` cevabını **eski** baud'da gönderir; host 0x7C'yi alınca portu yeni baud'a alır ve `BaudRateChanged` olayı yayar (`TriggerFrameController::OnTriggerFrameEvent @0x0081d264`).

#### 4.5.8 SRAM realtime yapıları (opsiyonel) [Observed]
MTConfig bayrağı (`+0x88`) açıksa her **500 ms**'de `SramRealtimeStruct` bölümleri `[len][addr] F4` ile okunur; birleşik sonuç SIPR `READ_MEMORY(0x3F)` olarak yayınlanır (`TriggerFrameController::OnTimer @0x0081def6`, `readSramSection`, `handleSramReadRealtimeRequest`).

### 4.6 TF sayfa senkronizasyon algoritması [Observed]
1. `VemsDeviceController::syncTriggerFrameMode @0x00bcc952`: INI'den `MTConfigData` kurulur; `sramPageCount = getPageCount(0)`, `eepromPageCount = getPageCount(1)` (`SIPRDescriptor::getPageCount @0x00bb88d0`: konum 0 = `page=`, 1 = `page_eeprom=`, 2 = hepsi) → `TriggerFrameController::sync @0x0081bb76` → `TriggerFrameSyncer::sync @0x00bc0584` (mod 1) → `readAllPage @0x00bc05cc` → `ReadAllPageCommand`.
2. `TriggerFrameFactory::createReadAllPage @0x0081f940`: SRAM sayfaları **sayfa numarası sırasıyla** (`getPageNumber(i)`, i=0..sramCount−1) her biri için `FF id F4`; EEPROM sayfası varsa sonda `0C F5`. `TriggerFrameMemoryHandler::request` hepsini kuyruğa atar (dur-bekle ile sırayla gider).
3. Her cevap → `TriggerFrameSyncer::onSyncingEvent @0x00bc0c1a`: SIPR paketleri birikir, sayfa boyu = `frameSize − 3` kaydedilir; sayaç `pageCount`'a ulaşınca `FirmwareDataSynced` (mod 1) ya da `AllPagesReceived` (mod 2).
4. `getAllPagesTriggerFrameMode @0x00bcce04` aynı okumayı mod 2 ile tekrar eder.
5. Doğrulama: ek CRC/okuma-geri-doğrulama **yok**; yalnız TF CRC'si [Observed — yazma yolunda verify çağrısı görülmedi].

### 4.7 vt sayfa ↔ ECU sayfa ↔ SIPR tablo eşlemesi (sipr-1.2.34.ini + `SIPRDescriptor::getTableType @0x00bb7c8e`)

| vt page | MT okuma/yazma | SIPR tipi | SIPR tablo(lar) (id) | ecuPageId | TF okuma |
|---|---|---|---|---|---|
| 1 | `h`/`H` | GET_TABLEDATA | H (0x0A) | 1 | `FF 01 F4` |
| 2 | `j`/`J` | GET_TABLEDATA | VE (0x05; ofset 0, 254 B) [+RPM 0x01 @224/16, KPA 0x02 @240/14] | 10 | `FF 0A F4` |
| 3 | `(`/`)` | GET_TABLEDATA | LAMBDA (0x06) (USE_RAW_LAMBDA_TABLE) / EGOC (0x04) için `l`/`L`, ecu 9 | 8 | `FF 08 F4` |
| 4 | `n`/`N` | GET_TABLEDATA | IGN (0x03) | 14 | `FF 0E F4` |
| 5 | `o`/`O` | GET_CONFIG_1 | CONFIG1 (0x07, 248 B) + CONFIG1_EXT (0x13 @248/7) | 0 | `FF 00 F4` |
| 6 | `t`/`T` | GET_TABLEDATA | BOOST_TPS (0x0C) | 2 | `FF 02 F4` |
| 7 | `e`/`E` | GET_TABLEDATA | TEMPERATURE (0x0D) | 4 | `FF 04 F4` |
| 8 | `y`/`Y` | GET_TABLEDATA | BOOST_DC (0x0B) | 15 | `FF 0F F4` |
| 9 | `g`/`G` | GET_CONFIG_2 | CONFIG2 (0x08) | 3 | `FF 03 F4` |
| 10 | `i`/`I` | GET_TABLEDATA | MAPCORR (0x0E) | 12 | `FF 0C F4` |
| 11 | `w`/`W` | GET_TABLEDATA | MAT_TPS_RETARD (0x12) | 13 | `FF 0D F4` |
| 12 | `f`/`F` | GET_TABLEDATA | ALT_KNOCK (0x0F) (KNOCK_ALTERNATIVE) | 17 | `FF 11 F4` |
| 13 | `u`/`U` | GET_TABLEDATA | A340E (0x10) (A340E) | 5 | `FF 05 F4` |
| 15 | `[`/`]` | GET_TABLEDATA | LAUNCH_RPM (0x14) | 6 | `FF 06 F4` |
| 16 | `0x82`/`0x83` | GET_TABLEDATA | CONFIG_SHARED (0x15) | 7 | `FF 07 F4` |
| 30 (eeprom) | — | GET_TABLEDATA | CONFIG_EEPROM (0x1E, 64 B) | — | `0C F5` |

Diğer tablo id'leri: VVTI = 0x11, KPA = 0x02, RPM = 0x01. `getConfigType @0x00bb7fec`: `SIPR_GET_CONFIG_1` = 0x0D, `SIPR_GET_CONFIG_2` = 0x0E. Bu id'ler `.vemslog` örneğindeki (FILE-FORMATS §7.3) `payload[0]` değerleriyle birebir doğrulandı (0x0A/48, 0x05/254, 0x06/80, 0x03/168, 0x0C/239, 0x0D/224, 0x0B/168, 0x0E/80, 0x12/80, 0x0F/44, 0x14, 0x15, 0x1E/64) [Observed]. (Böylece FILE-FORMATS'taki "[Unknown] eşleme" kapanmıştır.) Boyutlar firmware INI'sine göre değişir.

---

## 5. SIPR — dahili olay ve `.vemslog` biçimi (kabloda değil)

Çerçeve (görev özetinde doğrulanan): `0A seq type len payload[len] crc_lo crc_hi`, CRC-16/MODBUS(seq..payload) [Observed] `SIPRPacket::init @0x00bb991c`, `SIPRParser::feed @0x00bbb232`. Tip tablosu: görev özetindeki `SiprTypesHelper::getTypeAsString` listesi (0 NACK … 255 RESERVED). Bu sürümde VemsTune SIPR paketlerini yalnızca **üretir/tüketir** (§0). Emülatör açısından önemi: (a) `.vemslog` üretimi, (b) iç model; kablo eşdeğerleri:

| SIPR tipi (dahili) | Kaynak (kablo) | Payload |
|---|---|---|
| 5 GET_TABLEDATA | TF 0x74 / 0x75; MT sayfa okuma | `tableId, data…` |
| 13/14 GET_CONFIG_1/2 | TF 0x74 (config sayfaları) | `data…` |
| 7 READ_SENSORS | TF 0x20; MT `A`/`D` | `00 00 subtype data…` (getSubType=payload[2]; TF'de subtype 1) |
| 0x3F READ_MEMORY | TF 0xF4 ham SRAM | birleşik veri |
| 0x41 READ_MEMORY_32 | Man `mdx` (§8) | `addr<<4 BE (4B) + 32 B` |
| 0x91 AIM | AIM kaydı | `ch, hi, lo` |
| 0x93 RT_TIME / 0x94 UPDATE_FREQUENCY | yerel saat/sayaç | 4 bayt |
| 0x95 MDX_FRAMES_END | mdx tur sonu | boş |
| 0xC8 MODBUS_READ | Modbus RTU/ASCII | `addrHi addrLo regs…` / `page 0 data…` |
| 1 ACK | yazma/burn kuyruğa alındı | boş |

---

---

## 6. MegaTune ASCII modu, Man modu, mod geçişleri (TF dışı)

> Bu bölüm legacy/eski-firmware ve Round yolunu, ayrıca TF öncesi mod geçişi + sürüm/parola sorgusunu kapsar. Kaynak: `sec-megatune` alt-ajan analizi; başlık içi `###` numaraları bu bölüme görelidir.


Kapsam: VemsTune 1.5.46'nın TriggerFrame (TF) dışındaki seri konuşmaları: `DeviceModeSelector` ile mod geçişi, `V3FirmwareVersionFetcher` / `V3FirmwareInfoFetcher` / `RoundFirmwareInfoFetcher` / `BootStateDetector` / `PasswordChecker` ile kimlik ve firmware bilgisi, `MegatuneSyncer` + `Megatune` ile MegaTune sayfa/realtime trafiği ve VemsTune'un gönderdiği Man komutlarının envanteri.
Etiketler: [Observed] = decompile ya da bayt kanıtı, [Inferred] = çıkarım, [Unknown] = belirlenemedi. Adresler `vemsTune-c.exe` VA'larıdır. Notasyon: `"abc"` ASCII baytlar, `XX` hex bayt, `→` host→ECU, `←` ECU→host.

Ortak notlar:
- Bütün `wxString` komut sabitleri `TxData` ile **8-bit ASCII** olarak gönderilir; Megatune realtime komutu açıkça `mb_str(wxConvISO8859_1)` ile çevrilir (`Megatune::write @0x00e40bc0`). [Observed]
- `Math_crc16_sipr` = **CRC-16/MODBUS** (init 0xFFFF, poly 0xA001 reflected). Kanıt: `DeviceModeSelector::<ctor> @0x00df9ee0` içinde 0xB1 baytının CRC'si çalışma anında hesaplanır, ayrıca ROM'daki sabit dizi `B1 7F 34 7E` aynı değeri taşır. CRC16/MODBUS(B1) = 0x347F, LE olarak `7F 34`. [Observed]
- "Poll" zaman aşımları: `ResponseRecognizer(...,100)` sayacı, `read()` boş döndükçe (`param_3 < 1`) `Sleep(m_sleep)` ile birlikte artar (ctor'larda `m_sleep = this[4] = 1`). Gerçek süre ≈ 100 × (1 ms + comm döngüsü) [Inferred], yani ≈100–200 ms.
- `VemsDeviceController::registerAndStartCommunicationClient @0x00bcf2f8`, her istemciye denetleyicinin `m_timeout` (+0xc4) ve `m_interWriteDelay` (+0xc0) değerlerini atar ve bunları loglar. Varsayılanlar (200 ms / 30 ms) tercihlerden gelir. [Observed, varsayılanlar brief'ten alındı]

---

### 1. Mod geçişi: `DeviceModeSelector`

#### 1.1 Geçiş tablosu (`ModeSelectCmdArray`, `DeviceModeSelector::<ctor> @0x00df9ee0`)
Her girdi `{sourceMode, targetMode, TxData bytes}` üçlüsüdür. `sendChangeMode @0x00df9730` (ve aynı mantığın kopyası `write @0x00df9d98`), `(m_sourceMode = this[0x19], m_targetMode = this[0x1a])` çiftini tabloda arar ve baytları **tek bir write'ta** gönderir. Eşleşme yoksa `"INVALID MODE SELECT - source: …"` loglanır. `source == target` ise hiçbir şey göndermez ve doğrudan başarı durumuna (3) geçer. [Observed]

Ctor'un son parametresi `param_9` (bundan sonra *roundNew*), hangi girdilerin ekleneceğini belirler. `DeviceModeSelectorHelper::changeDeviceModeTo @0x00a08980` bu bayrağı `isRound() && firmwareVersion.minor > 4` olarak hesaplar (`4 < iStack_28`). `VemsDeviceController::selectMegatuneMode/selectMegatuneMode2/selectDeviceMode` her zaman `0` geçer. [Observed; alanın *minor* olduğu Inferred]

| # | source → target | Gönderilen baytlar | Uzunluk | Koşul | Kaynak |
|---|---|---|---|---|---|
| 1 | Man(0x0d) → MT(0x0c) | `"bye."` = `62 79 65 2E` | 4 | roundNew=0 | @0x00df9ee0 |
| 2 | Man(0x0d) → Boot(0x0b) | `"cb33cb."` = `63 62 33 33 63 62 2E` | 7 | roundNew=0 | @0x00df9ee0 |
| 3 | MT(0x0c) → Boot(0x0b) | `"Mancb33cb."` | 10 | roundNew=0 | @0x00df9ee0 |
| 4 | MT(0x0c) → Man(0x0d) | `"Man."` = `4D 61 6E 2E` | 4 | roundNew=0 | @0x00df9ee0 |
| 5 | MT(0x0c) → TF(0x12) | `"Mat"` = `4D 61 74` | 3 | roundNew=0 | @0x00df9ee0 |
| 6 | 0x11 (GPS-V3) → MT(0x0c) | `0D 0A B1 7F 34 7E` (CRLF + TF frame `[B1]`+CRC+`7E`) | 6 | roundNew=0 | @0x00df9ee0 |
| 7 | TF(0x12) → MT(0x0c) | `B1 7F 34 7E` (TF EXIT_TRIGGERFRAME_MODE 0xB1) | 4 | roundNew=0 | @0x00df9ee0; tip adı `TriggerFrame::getTypeAsString @0x008192e0` |
| 8 | TF(0x12) → Man(0x0d) | `B1 7F 34 7E 4D 61 6E` (çıkış frame'i + `"Man"`) | 7 | roundNew=0 | @0x00df9ee0 (7 baytlık sabit dizi `L"羱縴慍n"`) |
| 9 | MT(0x0c) → Boot(0x0b) | `7F 33 2E` (`"\x7F3."`) | 3 | **roundNew=1** (Round fw minor>4) | @0x00df9ee0 (else dalı) |
| 10 | TF(0x12) → Boot(0x0b) | `TriggerFrameEx(0xF6, 0xFE, -1, NULL, 0).getEscapedData()` (GO_BOOTLOADER_STUFFED_TYPE_COMMAND) | ? | her zaman | @0x00df9ee0; ctor imzası `TriggerFrameEx(int,int,int,uchar*,uint)` @0x0081e640 |
| 11 | Boot(0x0b) → TF(0x12) | `"EMat"` = `45 4D 61 74` | 4 | her zaman | @0x00df9ee0 |
| 12 | Boot(0x0b) → MT(0x0c) | `"E."` = `45 2E` | 2 | her zaman | @0x00df9ee0 |
| 13 | Boot(0x0b) → Man(0x0d) | `"E.Man."` | 6 | her zaman | @0x00df9ee0 |

- 6–8. satırlardaki TF frame'i ctor içinde kuruluyor: payload `[0xB1]`, `crc = crc16_sipr(0xFFFF, B1) = 0x347F`, `escape(B1)`, `escape(7F)`, `escape(34)`, ardından `7E`. 6. satır bunun başına `0D 0A` ekler. 7. satır aynı tamponu 2 bayt ileriden ve `len-2` uzunlukla kullanır. [Observed]
- 10. satırdaki tam bayt dizisi TF serileştirmesine (başka bölüm) bağlıdır. Argümanların (type=0xF6, ikinci int=0xFE, üçüncü int=-1) anlamı [Unknown].
- `"\x7F3."` ve `"cb33cb."` içindeki `33` ASCII '3'tür. Bunların firmware'deki anlamı [Unknown]. `'.'` Man komut sonlandırıcısı olarak görünüyor [Inferred].

#### 1.2 Durum makinesi ve zamanlama
`this[0x1e]` durumları: 0 = komut gönder, 1 = `PortScanner` ile yeniden tespit, 2 = 100 ms bekleme, 3 = başarı, 4 = hata. Kaynaklar: `write @0x00df9d98`, `read @0x00df9e94`, `OnDeviceFound @0x00df8994`, `OnDeviceNotFound @0x00df891c`, `OnTimeout @0x00df8934`, `OnBaudrateChanged @0x00df8960`, `finish @0x00df88cc`, `isFinished @0x00df8908` (3 ve 4 bitiştir). [Observed]

```
Host (DeviceModeSelector)                         ECU
 state0: write(table[src,dst])  ───────────────▶  (mod değiştirir; yanıt PARSE EDİLMEZ)
 state1: PortScanner/DeviceDetector probe ─────▶  53 6D 78 63 2E FF 7E  ("Smxc.\xFF~", her baud'da)
                                       ◀──────── tanıma metni / TF 0x7F frame'i
 OnDeviceFound(mode=M, baud=B):
   M != target → retry++ (en çok 3, this[0x27]=3) ; source:=M ; PortScanner reset ; state0
   M == target && source==Boot && B != m_baud → BaudRateSelector("mcB%02X") ; state1
   aksi halde → timer 100 ms ; state2 → state3 (başarı)
 OnDeviceNotFound / OnTimeout → state4 (hata)
```
- Mod komutuna verilen yanıtın kendisi okunmaz. Sonuç, `PortScanner` tarafından yeniden çalıştırılan `DeviceDetector` probu ile doğrulanır. Bu yüzden emülatör, mod komutundan sonra probu yeni modun tanıma dizesiyle yanıtlamalıdır (MT: `"VEMS Genboard v3"`, Man: `"Yes, menu and comm worx"`, TF: tip 0x7F frame'i). [Observed/Inferred]
- Hedef dışında bir mod tespit edilirse **yeni kaynak = tespit edilen mod** olur ve tablodan yeni bir komut seçilir. Bu, çok adımlı yollara izin verir (örneğin TF→MT başarısızsa ve cihaz Man görünüyorsa `"bye."`). Toplam deneme sayısı 3'tür. [Observed]
- Boot kaynağından çıkışta cihaz farklı bir baud'da bulunursa `BaudRateSelector` ile `m_baud`'a geri dönülür (`OnDeviceFound @0x00df8994`). [Observed]

#### 1.3 Çağıranlar ve baud listesi
| Çağıran | Hedef | PortScanner baud listesi | Kaynak |
|---|---|---|---|
| `VemsDeviceController::selectMegatuneMode` | 0x0c | `SerialPortHelper_getSerialBaudratesInt()` (tüm liste) | @0x00bcbc9e |
| `VemsDeviceController::selectMegatuneMode2` | 0x0c | **sadece `[19200, 9600]`** (`0x4B00`, `0x2580`) | @0x00bcbe4e |
| `VemsDeviceController::selectDeviceMode(m)` | m (örn. 0x12) | tüm liste | @0x00bcc02a |
| `VemsDeviceController::leaveTFMode` | `selectMegatuneMode()` çağırır (0x12→0x0c, yani tablo 7. satır `B1 7F 34 7E`) | tüm liste | @0x00bc864e |
| `DeviceModeSelectorHelper::changeDeviceModeTo(m)` | m; `roundNew` bayrağıyla | `getSupportedBaudrates()` | @0x00a08980; sonuç olayı `"RESULT_OK"` + `device_mode` @0x00a08b0e, `"RESULT_TIMEOUT"` @0x00a08fbc |

- `selectMegatuneMode2` neden 19200/9600 kullanıyor: yalnızca boot-loader'dan çıkış yollarında çağrılır. `Detecting::OnBootStateDetected @0x00bd4674` (leave-boot-mode açıkken) ve `Detecting::OnTimeout @0x00bd4628` (en çok 3 deneme, sonra `sendCannotLeaveBootMode`) bunu kullanır. Kaynak mod Boot olduğundan tablo 12. satır (`"E."`) gönderilir. Firmware yeniden başladığında varsayılan baud'una döndüğü için tarama 19200 ve 9600 ile sınırlıdır. [Observed çağrı/baud; firmware'in reset sonrası varsayılan baud'u Inferred]
- `FetchingFirmwareVersion::OnFirmwareVersion @0x00bd5ac2`: V3 firmware ≥ **1.1.98** (`FirmwareVersion(1,1,0x62)`) ise `selectDeviceMode(0x12)` çağrılır (MT→TF, `"Mat"`), ardından `InitTriggerFrameMode` gelir (`FetchingFirmwareVersion::OnDeviceModeSelected @0x00bd60ac`). Aksi halde legacy MT yoluna (`fetchFirmwareInfo`) gidilir. [Observed]

---

### 2. TF dışında firmware/kimlik bilgisi

#### 2.1 Bağlantı akışı (MT modunda tespit edilen cihaz)
```
Detecting::OnMegatuneMode @0x00bd450e
  ├─ (tercihli baud varsa) changeToPreferredBaudrate (mcB%02X)
  ├─ Round → fetchFirmwareInfo → RoundFirmwareInfoFetcher (§2.4)
  └─ V3    → checkPassword → PasswordChecker (§2.5)
               └─ CheckingPassword::OnDeviceNotProtected @0x00bd4e08
                    └─ V3: fetchFirmwareVersion → V3FirmwareVersionFetcher (§2.2)
                          ├─ ver ≥ 1.1.98 → selectDeviceMode(0x12) → TF (başka bölüm)
                          └─ ver < 1.1.98 → fetchFirmwareInfo → V3FirmwareInfoFetcher (§2.3)
FetchingFirmwareInfo::OnFirmwareInfoFetched @0x00bd613a → sync (MegatuneSyncer, §3.3) → getAllPages (Megatune, §3.4)
FetchingFirmwareInfo::OnAllPageReceived @0x00bd61f8 → Connected
```
[Observed: `VemsDeviceController::fetchFirmwareInfo @0x00bc8b86` (isV3 ? V3FirmwareInfoFetcher : RoundFirmwareInfoFetcher), `fetchFirmwareVersion @0x00bccf36`, `sync @0x00bc8d70`, `getAllPages @0x00bca360`]

#### 2.2 `V3FirmwareVersionFetcher` (hızlı sürüm sorgusu)
| Yön | Bayt | Uzunluk | Beklenen yanıt | Zaman aşımı | Kaynak |
|---|---|---|---|---|---|
| → | `"ManmdVbye."` = `4D 61 6E 6D 64 56 62 79 65 2E` | 10 | Akışta `FirmwareVersionRecognizer` deseni (aşağıda). Diğer baytlar yok sayılır. | 500 ms (`0x1F4`) | `write @0x00e40c48`, `read @0x00e40da0` |

- `FirmwareVersionRecognizer::feed @0x00baeaee` bayt bayt bir FSM'dir: `digit` → `'.'` → `digit` → `'.'` → `digit` → (herhangi bir bayt; digit ise eklenir) → TAMAM. İlk alanda birden çok digit gelirse yalnızca sonuncusu tutulur. Kabul edilen biçimler `D.D.D` + 1 bayt veya `D.D.DD`. Örnek: `"1.1.97"` → 1.1.97. `"1.2.34"` gibi iki haneli patch çalışır, ancak major ya da minor iki haneliyse yalnızca son hane alınır. Sonuç `FirmwareVersion::<ctor>(string)` ile `'.'`'dan bölünerek parse edilir (`FirmwareVersion::fromString @0x00517dd0`). [Observed]
- Emülatör örneği: `→ "ManmdVbye."` geldikten sonra `← "...1.1.97..."` gönderilir (çevredeki metin serbesttir). [Inferred]

#### 2.3 `V3FirmwareInfoFetcher` (legacy V3, fw < 1.1.98)
Komutlar sırayla gönderilir. Her adım bir `ResponseRecognizer(tx, recognizer, 100)` kullanır (`ctor @0x00e2a860`, `write @0x00e28d8c`, `read @0x00e28dc8`). Başarılı her adımdan sonra `Sleep(10)` gelir ve sonraki adıma geçilir. [Observed]

| # | → Bayt | Yanıt tanıyıcı | Alan | Zaman aşımında |
|---|---|---|---|---|
| 0 | `"Man"` (3) | `LengthRecognizer(8)` | (atılır) | **adım atlanır**, 1'e geçilir |
| 1 | `"mdv"` (3) | `LengthRecognizer(16)` | `FirmwareInfo::setCompilationTime` (16 bayt metin) | hata |
| 2 | `"mdV"` (3) | `FirmwareVersionRecognizer` | `setFirmwareVersion` | hata |
| 3 | `"mci"` (3) | `LengthRecognizer(12)` | `setSerialNumber` (12 bayt) | hata |
| 4 | `"bye"` (3) | `LengthRecognizer(5)` | (atılır) | hata |
| 5 | `"Q"` (1) | `RangeRecognizer(23,26)` | `setSignature` (örn. `"VEMS v1.2.34 16x14 kpa=2,2"`, 26 bayt) | ≥1 bayt geldiyse kısmi kabul edilir, sonraki adıma geçilir; 0 baytsa hata |
| 6 | `"S"` (1) | `RangeRecognizer(24,26)` | `setFirmwareOptions` | ≥1 bayt geldiyse `setFirmwareOptions` çağrılır ve durum 0'a döner. Decompile'da indeks artmıyor, yani `"S"` yeniden gönderilebilir [Observed/şüpheli]; 0 baytsa hata |

- Not: `"Q"` yanıtı *signature* olarak, `"S"` yanıtı ise *firmware options* olarak saklanır. INI'de `queryCommand="Q"`, `versionInfo="S"`, `signature="VEMS v1.2.34 …"` (`vemsTune-v3-1.2.34.ini`). [Observed]
- "Man" yanıtının 8 baytlık içeriği [Unknown]; yalnızca uzunluğu sayılır. `bye` yanıtı da 5 bayt olarak sayılır. [Observed]
- `RangeRecognizer` "tamamlandı" kararını ne zaman verir (min mi, max mı) [Unknown]. Gövdesi decompile edilmemiş.

#### 2.4 `RoundFirmwareInfoFetcher` (Round WBO2)
Durumlar (`this[0x15]`): 0 = sendBye, 1 = waitBye, 2 = sendS, 3 = waitS, 4 = sendMan, 5 = waitMan, 6 = sendManMci, 7 = waitManMci, 8 = sendTriggerMci, 9 = waitTriggerMci, 10 = clearing (adımlar arasında **150 ms** sessizlik, `this[0x1e]=0x96`), 11 = başarı, 12 = hata. Başlangıçta önce 150 ms clearing yapılır. Ardından gelen durum `source==Man(0x0d)` ise 0 (bye), değilse 2 (S) olur (`ctor @0x00e2ca60`). [Observed]

| Durum | → Bayt | Beklenen ← | Sonraki | Kaynak |
|---|---|---|---|---|
| 0 sendBye | `"bye"` (3) | 5 bayt | mci okunduysa 11 (bitti), okunmadıysa 2 | `sendBye @0x00e2bb44`, `waitBye @0x00e2c9f0` |
| 2 sendS | `"S."` = `53 2E` | 23 bayt (`LengthRecognizer(0x17)`), örn. `"VEMS Round WBO2 v1.5.10"` | sürüm `minor > 4` ise 8, değilse 4 | `sendS @0x00e2bd28`, `waitS @0x00e2c698` |
| 4 sendMan | `"Man."` = `4D 61 6E 2E` | 8 bayt | 6 | `sendMan @0x00e2bf0c`, `waitMan @0x00e2c62c` |
| 6 sendManMci | `"mci."` = `6D 63 69 2E` | 12 bayt → `setRoundSerialNumber` | 0 (bye), mci bayrağı=1 | `sendManMci @0x00e2c0f0`, `waitManMci @0x00e2c588` |
| 8 sendTriggerMci | `80 2E` (2 bayt) | 12 bayt → `setRoundSerialNumber` | 11 | `sendTriggerMci @0x00e2c2d4`, `write @0x00e2c438` |

- S zaman aşımında ≥21 (0x15) bayt geldiyse kısmi kabul edilir, aksi halde hata. Signature `setSignature` ile saklanır, sürüm ise `setFirmwareVersion(sig, 'v')` ile signature içindeki `'v'` sonrasından parse edilir. [Observed çağrı; parse ayrıntısı Inferred]
- Her bekleme 100 boş poll'dur; aşılırsa durum 12 olur. [Observed]

```
Round (yeni fw, minor>4, MT modunda):  →"S."  ←23B signature | 150ms | →80 2E  ←12B serial | bitti
Round (eski fw):                       →"S."  ←23B | 150ms | →"Man." ←8B | →"mci." ←12B | →"bye" ←5B | bitti
Round (Man modunda başlarsa):          →"bye" ←5B | 150ms | →"S." ...
```

#### 2.5 `PasswordChecker` (V3, MT modunda, firmware sorgusundan önce)
| Yön | Bayt | Beklenen | Kaynak |
|---|---|---|---|
| → | `"."` (`2E`) | korumalıysa `RegExRecognizer("BAD pw\r\n(\w{1}\d{1}.\d{1}_\w{1}\d{6})")`, yani `"BAD pw\r\n"` + seri no (örn. `v3.3_u012345`) | `ctor @0x00e27c94`, `sendP @0x00e27f80`, `waitP @0x00e28a44` |
| → | `<password> + "."` (parola, seri numarasına göre `findPassword @0x00e28980` ile bulunur) | `StringRecognizer("pwOK")` | `sendPw @0x00e28460`, `waitPw @0x00e28908` |

- `"."` probuna `m_timeout` içinde eşleşen yanıt gelmezse cihaz "korumasız" sayılır ve `OnDeviceNotProtected` çağrılır [Inferred]. Bu dalın kesin koşulu ve `finish` bitiş kodları (1 = OK, 2 = zaman aşımı, `waitPw`) [Observed kısmi]. Emülatör korumasız bir V3 için `"."` baytına **hiç yanıt vermemelidir** [Inferred].

#### 2.6 `BootStateDetector` (boot-loader'daki cihaz)
| Yön | Bayt | Uzunluk | Not | Kaynak |
|---|---|---|---|---|
| → | `"S"` (`53`) | 1 | durum 1'de gönderilir, zamanlayıcı **1000 ms**. Bayrak kombinasyonuna göre (`this+0x54/0x55/0x56`) durum 0'da da gönderilebilir; o durumda zamanlayıcı `m_timeout` olur. | `write @0x00df5d2c`, `ctor @0x00df6c10` |
| ← | `"AVR"` | 3 | `StringRecognizer("AVR")` | `read @0x00df8488` |
| ← | aygıt karakteri | 1 | `'3'` → V3 (device 1), bootState beklenir; `'2'` → Round (device 2), bootState beklenir; `'E'` → V3, `"FI1"` beklenir (eski V3 boot, `"AVREFI1"`) | `waitDevice @0x00df6f44` |
| ← | bootState | 1 | `0x34..0x38`, `0x50 'P'`, `0x72 'r'` olduğu gibi saklanır; `0x76 'v'` saklanır **ve seri numaranın ilk karakteri olarak** SerialRecognizer'a verilir; diğer her değer → −1 | `waitBootState @0x00df6fcc` |
| ← | seri | 12 (toplam) | V3: `SerialRecognizer(12)`, 12 bayt toplanır ve regex `(\w{1}\d{1}.\d{1}_\w{1}\d{6})` eşleşmesi alınır. Round: `LengthRecognizer(12)` ile ham `setRoundSerialNumber` | `waitSerialNumber @0x00df705c`, `SerialRecognizer::feed @0x00bb0768` |
| → | (yalnızca `"AVREFI1"` sonrası) `41 FB 80 44 6C 6C` | 6 | checksum sorgusu | `write @0x00df5d2c` (durum 7) |
| ← | 5 bayt | 5 | bayt[1..4] `Math_getNumber(…,4)` ile okunur: `0xA05BA125` → bootState 0x32 "From Fw (old)", `0xFB00FB80` → 0x33 "Bad marker (old)", diğer → −1. Bayt sırası (BE/LE) [Unknown] | `waitChkSum @0x00df7e9c` |

- BootState adları (`ECUInfo::getBootStateAsString @0x00a0930c`): 0x32 "From Fw (old)", 0x33 "Bad marker (old)", 0x34 "Bad marker", 0x35/0x36 "From Fw", 0x37 "Loopback", 0x38 "Sflood", 0x50 "Page loader", 0x72 "Old chex2", 0x76 "BOOTLOADER 2011-03-01". BootType (`@0x00a0940a`): 0 HEX, 1 CHEX, 2 CHEX2, 3 UHEX, 4 SHEX, 5 LHEX, 6 VHEX, 7 UNKNOWN. [Observed]
- `finish @0x00df5fec`: Round ve seri `"UNKNOWN"` ya da boşsa bootType alanına 1 yazılır. bootState → bootType eşlemesinin geri kalanı [Unknown]. Zaman aşımında aygıt biliniyorsa (≠−1) kısmi başarı (durum 10), bilinmiyorsa hata (durum 9) döner. [Observed]
- Örnek V3 yanıtı: `"AVR3v3.3_u012345"` (bootState `'v'` = serinin ilk harfi) [Inferred].

---

### 3. MegaTune ASCII modu

#### 3.1 Algılanan MegaTune yapılandırması (`VemsDeviceController::initDetectedMegatuneConfig @0x00bcd8a0`)
`m_megatuneConfig` (denetleyici +0x1d8), `Megatune::<ctor> @0x00e3a2d0` ve `MegatuneSyncer` içine kopyalanır. [Observed]

| cfg idx (ofset) | Anlam | V3 | Round |
|---|---|---|---|
| [0] (+0x1d8) | ? | 45 (0x2D) | 30 (0x1E) |
| [1] (+0x1dc) | RT uzunluk keşfi için maksimum tampon | 128 | 128 |
| [2] (+0x1e0) | **RT CRC modu** (0 yok, 1 CRC16, 2 TF frame) | fw ≥ 1.1.75 → 1, değilse 0 | 0 |
| [3] (+0x1e4) | isV3 | 1 | 0 |
| [4] (+0x1e8) | **Sayfa CRC modu** (0 yok, 1 CRC16, 2 TF frame) | fw ≥ 1.1.86 → 1, değilse 0 | 0 |
| [5] (+0x1ec, bayt) | `0xF8` sayfa boyut/CRC sorgusu destekleniyor mu | fw ≥ 1.1.89 → 1 | 0 |
| [6] (+0x1f0) | **komut biçimi** = Device (1=V3, 2=Round). 2 ise komutlara `'.'` eklenir | 1 | 2 |
| [10] (+0x200) | **RT komutu** | `"D"` (`44`) | `"A."` (`41 2E`) |
| [11] (+0x204) | RT beklenen uzunluk (varsayılan, syncer üzerine yazar) | 100 | 100 |
| [12] (+0x208) | ? | 1 | 3 |
| [0x21] (+0x25c) | `m_timeout` | tercih (+0x10c seri / +0xe8 diğer) | |
| [0x22] (+0x260) | `m_interWriteDelay` | tercih (+0xf0) | |
| [0x23] (+0x264) | RT zaman aşımı yeniden deneme limiti | tercih (+0xec) | |
| [0x24] (+0x268) | RT periyodu (ms; 0 = sürekli) | tercih (+0xe4) | |

- RT komutu baytları binary'de doğrulandı: `.rdata` 0xd60df0'da `44 00 41 2E 00` var, yani ayrı `"D"` ve `"A."` C string'leri. Ghidra bunları `L"D⹁"` / `L"⹁"` olarak göstermiş. [Observed]
- Tercih alanları: `initUserMegatuneConfig @0x00bce07c`. [Observed]
- Sayfa ve RT CRC modu 2 (TF frame) için kodu yazan yer bulunamadı [Unknown]. Ancak okuma yolları mevcut (§3.5).

#### 3.2 Sayfa komut baytları (`SiprDescHelper::getPageReadCommand`, `Megatune::writePage`)
INI `[SIPR]` `page = N, "<read>", "<write>", …` (örnek `sipr-1.2.34.ini`: `page = 1,"h","H"` … `page = 16,"0x82","0x83"`; Round 1.5.10: `page = 5, "c.", "C"`). `burnCommand = "B"`.

**Okuma** (`getPageReadCommand(wxString,int fmt) @0x00bb5308`) [Observed]:
- Dize boşsa komut yoktur (null).
- `"0x"` / `"0X"` önekliyse `ToULong` → **tek bayt** (örn. `"0x82"` → `82`). `fmt==2` ise `2E` eklenir.
- Aksi halde dizenin tamamı ASCII olarak gönderilir; `fmt==2` ise sonuna `'.'` eklenir. Round `"c."` için bu kural `63 2E 2E` (`"c.."`) üretir. Firmware'in fazla `'.'`'yı nasıl ele aldığı [Unknown].
- `fmt` = cfg[6] (V3=1 → sonek yok; Round=2 → `'.'`).
- TF-sayfa modu (cfg[4]==2): `getPageReadCommand(uchar 0xF4, uchar ecuPageId, fmt) @0x00bb5668` → `F4 <ecuPageId>` (+`2E`). `ecuPageId` INI'deki `vt_2_ecu_id = vtPage, ecuId` eşlemesinden gelir. [Observed]
- (`@0x00bb5500` = önek bayt + dize varyantı; çağıranı bu bölümde görülmedi.)

**Yazma** (`Megatune::writePage(page, offset, value) @0x00e3cd18`, komut `WritePageCommand{page, offset, value&0xFF}` `@0x00eca5d8`, kaynak `STDataIOSIPR::write @0x007dd8c2`) [Observed]:
```
V3   : [W] [offset u8] [value u8]          (3 bayt)
Round: [W] [offset u8] [value u8] 2E       (4 bayt)
W = write dizesi "0x.." ise ToULong baytı, değilse dizenin İLK karakteri
```
- **Yazma işlemi tek baytlıktır**: her değişen bayt ayrı bir `WritePageCommand` olarak gider. Ofset 8 bittir, dolayısıyla sayfa başına ofset 0..255. **Yanıt beklenmez.** Yazmadan sonra durum hemen 0 olur (`sendAckPacket` dahili olaydır). [Observed]
- **Doğrulama yok**: yazmanın ardından otomatik geri okuma yapan kod bu yolda görülmedi [Inferred].

**Burn** (`Megatune::burn @0x00e3cba0`, `BurnCommand` ← `STDataIOSIPR::burnData @0x007dd826`): `SIPRDescriptor+0x50` dizesi (INI `burnCommand`, `"B"`) gönderilir; Round'da `'.'` eklenir. V3: `42`, Round: `42 2E`. Yanıt beklenmez, durum 0'a döner. [Observed]

**Raw/String komutlar** (`executeRawCommand @0x00e3ad60`, `executeStringCommand @0x00e3ac7c`): baytlar olduğu gibi gönderilir. Durum 3'te 50 poll (`this[0xd8]=0x32`) beklenir ve bu sürede gelen her bayt atılır. `StringCommand` ayrıca kendine özel bir inter-write gecikmesi taşır (`this[3]`). [Observed]

#### 3.3 Senkronizasyon: `MegatuneSyncer` (bağlantı başına bir kez)
Durumlar (`this[0xa0]`): 0 requestRt, 1 waitRtLength, 2 requestPagesCrcAndSize, 3 waitPagesCrcAndSize, 4 requestPage, 5 waitPage, 6 checkDevice, 7 waitCheckDevice, 9 hata, 10 bitti. Kaynak `write @0x00e2f140` (request* gövdeleri inline), `read @0x00e32d58`. [Observed]

```
Host                                               ECU
 0: → RT komutu ("D" | "A.")         timeout=m_timeout
 1: ← RT yanıtı; uzunluk ZAMAN AŞIMIYLA ölçülür (≤ min(512, cfg[1]=128))
      cfg[2]==1: n>1 ise CRC16(bytes[0..n-3]) == LE(bytes[n-2..n-1]) → rtSize=n (CRC dahil)
                 değilse en çok this[0x16] kez tekrar (durum 0), sonra 9
      cfg[2]==2: TF frame tip 0x20 → rtSize = frameLen-3
      cfg[2]==0: waitRtLengthFirst/Second: iki istek, iki uzunluk ölçümü (eşleşme beklenir) [Inferred]
    → cfg[5] ? 2 : 4
 2: → F8                               timeout=m_timeout+250, en çok 3 deneme
 3: ← TF frame tip 0x78 = sayfa CRC/boyut tablosu (aşağıda) → 4
 4: her sayfa i için: → okuma komutu (§3.2)   timeout=m_timeout+128 (0x80)
 5: ← sayfa verisi; uzunluk ZAMAN AŞIMIYLA ya da 0x78 tablosuyla belirlenir
      cfg[4]==1: CRC16 sonu doğrulanır (checkCrc @0x00e30254); tablo boyutu biliniyorsa 256 ms zamanlayıcı
      cfg[4]==2: TF frame tip 0x74; len==6 && data[0]==1 → "Page doesn't exist!"; veri = frameLen-5 bayt
      cfg[4]==0: waitPageFirst/Second: iki okuma, aynı uzunluk → "PAGE SIZE VERIFIED!"
 tüm sayfalar bittiğinde: Sleep(1000) → 10
 6/7: DeviceDetector yeniden probe (53 6D 78 63 2E FF 7E)  (checkDevice @0x00e2ef5c)
```
- **0xF8 yanıtı** (`setPagesSizeAndCrc @0x00e31fbc`): TF frame verisi, `cnt = (frameLen-3)/3` sayfa içerir. Düzen: `[crcLo0 crcHi0 crcLo1 crcHi1 … crcLo(cnt-1) crcHi(cnt-1)] [size0 size1 … size(cnt-1)]`. Sayfa `i` = ecuPageId'dir ve vtPage `SIPRDescriptor::getVtPageNo` ile bulunur. Saklanan beklenen boyut **size+2** olur (CRC dahil). `frameLen < 4` veya `frameLen % 3 != 0` ise hata verir. Boyut alanı 1 bayt olduğundan sayfa ≤ 255 bayt. [Observed; frameLen'e tip+CRC'nin dahil olduğu Inferred]
- Sayfa bilinmiyorsa en çok 0xFF bayt beklenir, cfg[4]==1 iken 0x101 (= 255+2 CRC). [Observed `write @0x00e2f140`]
- Emülatör açısından: CRC modu 0/1'de VemsTune uzunluğu **sessizlik** ile algılar. Yanıtı tek seferde göndermeli ve sonra susmalısınız; gönderim sırasında `m_timeout+128` ms'den uzun boşluk olmamalı. [Inferred]

#### 3.4 Çalışma zamanı: `Megatune` istemcisi
Durumlar (`this[0xa2]`): 0 boşta/hazır, 1 RT bekleniyor, 2 sayfa bekleniyor, 3 raw/string sonrası bekleme, 4 CRC hatası kurtarma (`handleCrcError @0x00e3b5e4`), 5 hata. [Observed `read @0x00e3eec4`, `write @0x00e40bc0`, `sendNextCommand @0x00e408a0`]

`write()` (durum 0 iken):
1. Komut kuyruğu (`m_commands`, `this[0xcc]`) boşsa ve realtime açıksa (`enableRealtime @0x00e3ad9c`) RT komutu gönderilir; RT periyodu >0 ise periyot zamanlayıcısı beklenir. `m_expectedRxSize = rtSize`, zamanlayıcı `m_timeout`, durum 1.
2. Aksi halde kuyruğun başındaki komut `execute()` ile çalışır (`@0x00e40244`; `dynamic_cast` sırası: ReadPage → WritePage → Burn → String → Raw).

**Sayfa okuma** (`readPage @0x00e3ef80`): komut §3.2'deki gibidir. `m_expectedRxSize` = senkronizasyonda öğrenilen boyut (CRC modu 1'de +2 dahil). Zamanlayıcı **m_timeout+200 ms**, durum 2. Zaman aşımında komut **yeniden gönderilmez**: zamanlayıcı en çok 3 kez `m_timeout+50` ile yeniden kurulur, sonra durum 5 (hata). Yanıt tamamlanınca cfg[4]==1 ise `MegatuneHelper_checkCrc` çağrılır (başarısızsa durum 5) ve 2 CRC baytı kırpılır. cfg[4]==2 ise TF tip 0x74, `frameLen-5` veri baytı içerir (`waitPageTriggerFrame @0x00e3ed70`). [Observed]

**Realtime** (`waitRt @0x00e3e120`, `waitRtRead @0x00e3de58`, `waitRtReadNoCrc @0x00e3c5ec`, `waitRtReadTriggerFrame @0x00e3c688`):
| RT CRC modu (cfg[2]) | Yanıt biçimi | Doğrulama |
|---|---|---|
| 0 | `rtSize` ham bayt | yok, sayıyla tamamlanır |
| 1 | `rtSize` bayt = veri + `crcLo crcHi` | CRC16/MODBUS(0xFFFF, bytes[0..n-3]) == `b[n-2] | b[n-1]<<8`. Hata → `"CRC ERROR m_crc…"`. Saniyede <5 hata ise durum 4 (kurtarma), aksi halde 5 |
| 2 | TF frame tip 0x20 | TF CRC (`TriggerFrameFSMCRC`) |

- RT zaman aşımı: sayaç ≤ cfg[0x23] ise `sendRTTimeoutPacket` (dahili) gönderilir ve zamanlayıcı `m_timeout` ile yeniden başlar (**komut tekrar gönderilmez**). Limit aşılırsa durum 5. [Observed]
- **Pipeline**: RT periyodu 0 (sürekli) iken 33. (`0x21`) bayt alındığında ve bekleyen istek sayısı (`this[0x97]`) < 2 ise "sonraki isteği gönder" bayrağı (`this[0xf2]`) erkenden kurulur. Yani VemsTune önceki yanıt bitmeden yeni bir RT komutu gönderebilir; emülatör en az 2 RT isteğini kuyruklamalıdır. [Observed bayrak; davranış Inferred]
- `getInterWriteDelay @0x00e39080`: durum 1 veya 2 ise `m_interWriteDelay` (cfg[0x22]) döner, değilse `this[3]` (StringCommand gecikmesi, normalde 0). Yani 30 ms gecikme RT ve sayfa okuma isteklerine uygulanır; tek baytlık yazmalar gecikmesiz ardışık gidebilir. [Observed dönüş değeri; denetleyicinin bunu nasıl uyguladığı Inferred]
- `Megatune::request @0x00e390b8`: `ReadAllPageCommand` geldiğinde SIPR descriptor'daki her sayfa için bir `ReadPageCommand` kuyruğa eklenir. [Observed]

#### 3.5 MegaTune ↔ TriggerFrame etkileşimi
- `0xF8` (sayfa CRC/boyut sorgusu) ve TF-sayfa okuması `F4 <ecuPageId>` **ham bayt** olarak gönderilir. Yanıtlar ise TF çerçevesidir: 0x78 (boyut/CRC tablosu), 0x74 (sayfa verisi), 0x20 (RT, cfg[2]==2). Hepsi `TriggerFrameFSMCRC_parse` ile ayrıştırılır (`MegatuneSyncer::waitPagesCrcAndSize @0x00e32b80`, `waitPageTriggerFrame @0x00e2fc74`, `waitRtTriggerFrame @0x00e2d414`, `Megatune::waitPageTriggerFrame @0x00e3ed70`, `waitRtReadTriggerFrame @0x00e3c688`). Yani MT modunda VemsTune'dan ECU'ya ASCII/ham bayt, ECU'dan VemsTune'a TF frame giden **hibrit** bir yol vardır. [Observed]
- Bu frame'lerin sarmalama ayrıntıları (len alanının neyi kapsadığı, `-3` ile `-5` farkı) TF bölümüne bırakılmıştır. `-5` farkı, sayfa frame'inde fazladan 2 bayt (muhtemelen sayfa kimliği ya da sayfa CRC'si) olduğunu düşündürüyor [Inferred].

#### 3.6 Örnek V3 legacy (fw 1.1.90, MT) oturumu
```
→ "."                         ← (sessizlik)                      PasswordChecker: korumasız
→ "ManmdVbye."                ← "...1.1.90..."                   500 ms
→ "Man"  ← 8B | →"mdv" ← 16B | →"mdV" ← "1.1.90." | →"mci" ← 12B | →"bye" ← 5B
→ "Q"    ← "VEMS v1.1.90 …" (23–26B) | →"S" ← 24–26B
→ "D"    ← ochBlock + CRC16 LE   (sessizlikle uzunluk ölçülür)
→ F8     ← TF(0x78){crc[i] LE…, size[i]…}
→ "h"    ← size0 bayt + CRC16 LE ; → "j" … ; → 82 ← …       (her sayfa)
… çalışma: → "D" ← RT  (periyodik/pipeline) ; yazma: → 48 <ofs> <val> ; burn: → 42
```
[Inferred birleşik senaryo; tek tek adımlar Observed]

---

### 4. Man (menü/konsol) modu komut envanteri

| Komut (ASCII) | Bağlam | Beklenen yanıt | Kaynak |
|---|---|---|---|
| `"mcB%02X"` | baud değiştirme (`BaudRateSelector`, `TriggerLogReader`) | `"OK\r\n"` ≤100 ms (bilinen) | `BaudRateSelector::sendChangeBaudRate @0x00e0f728`, `TriggerLogReader::sendBaudrateChange @0x00e011ac` |
| `"bye."` / `"bye"` | Man→MT | probe ile doğrulanır / 5 bayt | §1.1, §2.3, §2.4 |
| `"Man."` / `"Man"` | MT→Man | probe / 8 bayt | §1.1, §2.3 |
| `"Mat"` | MT→TF | probe (TF 0x7F) | §1.1 |
| `"mdv"`, `"mdV"`, `"mci"`, `"mci."` | derleme zamanı / sürüm / seri | 16 B / sürüm deseni / 12 B | §2.3, §2.4 |
| `"ManmdVbye."` | tek seferde sürüm | sürüm deseni | §2.2 |
| `"cb33cb."`, `"Mancb33cb."` | boot-loader'a geçiş | probe (`"AVR…"`) | §1.1 |
| `"Manmxc"` | trigger log başlatma | [Unknown] | `TriggerLogReader::sendMxc @0x00e00410` |
| `"Manmde40"` / `"mde40"` / `"mde00"` | trigger log start/restart/stop | [Unknown] | `sendManMde40 @0x00e00638`, `sendRestart @0x00e007b8`, `sendStartCmd @0x00e00528`, `sendStopCmd @0x00e008f0` |
| `"mdx"` | offset okuyucu | [Unknown] | `OffsetReaderClient::sendCommand @0x00e24198` |
| `"mss"`, `"msemss"`, `"msdmss"`, `"msc"`, `"msd"`, `"msg%06x"` | SD kart logger: status/start/stop/erase/disable/get | [Unknown] (stop 1000 ms, erase status 1000 ms zamanlayıcı) | `SDCardV3Logger::sendStatus @0x00e1c84c`, `sendStart @0x00e1c74c`, `sendStop @0x00e1c940`, `sendErase @0x00e1e598`, `sendEraseStatus @0x00e1ce30`, `SDCardFileSearch::getInode @0x00e0cd44`, `SDCardFileDownloader::sendDisable @0x00e125d4` |
| `"md([deainh])([0-9a-fA-F]{2})"`, `"Manmc([LS])([01])mbye"`, `"mcB"` | `StringCommand` desenleri. TF modunda `VemsCommandTranslator` bunları TF frame'ine çevirir (tip 0xF7, 0xFC …); MT modunda `Megatune::executeStringCommand` ham ASCII olarak gönderir | yok (50 poll atılır) | `VemsCommandTranslator::createTriggerFrame @0x00823922` |
| `"."` | parola kontrolü probu | `"BAD pw\r\n<serial>"` | §2.5 |
| `"<pw>."` | parola | `"pwOK"` | §2.5 |

- Man yanıtlarının metin biçimleri (menü istemi, CR/LF düzeni) TriggerLog/SD/Offset için bu dilimde incelenmedi [Unknown].

### 5. Açık sorular
- [Unknown] `TriggerFrameEx(0xF6,0xFE,-1,NULL,0)` (TF→Boot) çerçevesinin kesin bayt dizisi. TF serileştiricisine bağlı.
- [Unknown] `RangeRecognizer(23..26 / 24..26)` için tamamlanma kuralı; V3 `"S"` adımında kısmi yanıt sonrası tekrar döngüsü (bug olabilir).
- [Unknown] Sayfa/RT CRC modu 2'yi (TF yanıtlı MT) etkinleştiren kod yolu; `F4`/`F8` firmware sürüm eşikleri yalnızca cfg[5] (≥1.1.89) için kesin.
- [Unknown] `"Man"` (8 B), `"bye"` (5 B) yanıtlarının içeriği; Round `"c."` + `'.'` = `"c.."` firmware kabulü.
- [Unknown] `waitChkSum` 32 bitlik sayının bayt sırası; bootState → bootType eşlemesi.
- [Unknown] cfg[0] (45/30) ve cfg[12] (1/3) alanlarının anlamı.
- [Inferred] PasswordChecker'da "korumasız" kararı = `"."` probuna yanıt gelmemesi.

---

## 7. TriggerFrame yardımcı servisleri — SD kart, EEPROM, SRAM istemcileri, trigger-log, TEST_TOOLS, GO_BOOTLOADER

> Kapsam: TF modunda (`EcuMode 0x12`) çalışan ve §4.5'teki ana set (sayfa/realtime/ECU details) dışında kalan servisler. Çerçeve biçimi, CRC16/MODBUS, kaçış ve `TriggerFrameEx::create` değer kodlaması §4.1'de; burada yalnızca gövde düzenleri verilir. Tüm örnek kablo baytları CRC16/MODBUS (LE) + kaçış + `7E` ile hesaplanmıştır (`scratchpad/tfx.py`).
>
> Notasyon: "gövde" = CRC'siz, kaçışsız bayt dizisi; son bayt tiptir. `n` = gövde uzunluğu (tip dahil, CRC hariç). VemsTune alınan çerçeveyi `TriggerFrameEx(IntArray, stripCrc=true)` ile oluşturur ve son 2 baytı (CRC) atar (`TriggerFrameEx::<ctor> @0x0081e756`); `TriggerFrameFSMCRC::getFrame` ise CRC'yi **içerir** (`checkCRC @0x00820a22`). Aşağıdaki indeksler bu farkı hesaba katar.

### 7.0 Ortak kurallar

| Kural | Açıklama | Etiket / Kaynak |
|---|---|---|
| Cevap tipi | Cevap tipi = istek tipi − 0x80 (0xFA→0x7A, 0xF3→0x73, 0xEF→0x6F, 0xF5→0x75, 0xF9→0x79, 0xF4→0x74, 0xFB→0x7B, 0xF7→0x77). Bekleyen istekle eşleştirme bu kuralla yapılır. | [Observed] `SynchronousHandler::onReceiveTriggerFrame @0x00817a70` (`reqType − 0x80 == rspType`); istemciler `(byte)(type+0x80)` ile karşılaştırır (`TriggerFrameReaderClient::waitResponse @0x00dfef5c`, `TriggerFrameWriterClient::checkResponseRaw @0x00dfc580`, `EepromReaderTFFormat::waitData @0x00dfe214`) |
| Yönlendirme | `TriggerFrameController::OnTriggerFrameEvent @0x0081d264`: SD hata çerçevesi (`isSDCardErrorType`) ve tip 0x73/0x7A → `TriggerFrameSDCardHandler`; 0x74/0x75 → `TriggerFrameMemoryHandler`; 0x72 → FirmwareInfo; 0x20 → Realtime; 0x7C → baud değişimi. 0x6F/0x77/0x79/0x7B controller'da işlenmez, yalnız `SynchronousHandler` eşleştirmesiyle bekleyen isteği kapatır. | [Observed] |
| İstek motoru | `TriggerFrameRequest{frame, timeout(+8), tryCount(+0xC), deadline(+0x10)}`. Kuyruktan çıkarken `SynchronousHandler::add @0x0081788e` tryCount'u **+1** artırır; zaman aşımında tryCount≠0 ise azaltıp yeniden gönderir (§4.4). Dolayısıyla verilen tryCount=N ⇒ en fazla N+2 gönderim. | [Observed] kod; [Inferred] toplam sayı |
| ECU modu | EEPROM tam okuma/yazma ve SRAM istemcileri yalnız `EcuMode 0x12`'de çalışır; değilse önce `DeviceModeSelector(target=0x12)` çalıştırılır. | [Observed] `EepromTriggerFrameController::downloadEeprom @0x0080c6da`, `uploadEeprom @0x0080c202`, `SRAMTriggerFrameController::readSRAM @0x00814b82`, `writeSymbol @0x00814f8e`, `writeAddresses @0x008150a4` |
| Realtime duraklatma | `TriggerFrameController::disableRealtime @0x0081c362` `RealtimeHandler`'ı siler (0xA0 yoklaması durur); `enableRealtime @0x0081c220` yeniden oluşturur. SD erase/search/fwver/summary işlemleri önce `isRealTimeEnabled` değerini saklar (`+0x41`), realtime'ı kapatır, bitişte gerekiyorsa açar. | [Observed] `SDCardControllerTF::erase @0x00774400`, `getFwVersion @0x00774ba8`, `search @0x00775c90`, `createSummary @0x00774f86`, `ResponseToErase @0x007768c6` |
| Ayrık istemciler | `TriggerFrameReaderClient`, `TriggerFrameWriterClient`, `EepromReaderTFFormat` istek motorunu kullanmaz; kendi çerçevelerini (aynı CRC/kaçış) doğrudan yazar ve kendi FSMCRC'leriyle okur. Boş okuma başına `Sleep(2 ms)`, ~1000 boş tur (~2 s+) sonra zaman aşımı; yeniden deneme yok. | [Observed] `sendAddress @0x00dff8b8`, `waitResponse @0x00dfef5c`, `sendDataRaw @0x00dfce94`, `checkResponseRaw @0x00dfc580`, `EepromReaderTFFormat::sendCommand @0x00dfe3fc`, `waitData @0x00dfe214` |

---

### 7.1 SD kart (SD_CMD `0xFA`, SDCARD_GETBLOCK `0xF3`)

#### 7.1.1 Mesajlar

| Mesaj | İstek gövdesi | Kablo örneği | Cevap | Kaynak |
|---|---|---|---|---|
| GET_STATUS | `01 FA` | `01 FA 80 63 7E` | `[status] 7A` (**tam 1 veri baytı**, n=2) | [Observed] `TriggerFrameSDCardHandler::getStatus @0x00813ba4`, `handleStatus @0x00813f12` |
| START_LOG | `02 FA` | `02 FA 80 93 7E` | `… 7A` (içerik okunmaz) | [Observed] `startLog @0x008137f6` |
| STOP_LOG | `03 FA` | `03 FA 81 03 7E` | `… 7A` (içerik okunmaz) | [Observed] `stopLog @0x00813a6a` |
| ERASE | `04 FA` | `04 FA 83 33 7E` | `… 7A` (içerik okunmaz) | [Observed] `eraseCard @0x00813930` |
| GET_BLOCK(b) | `00 b2 b1 b0 F3` (b = 24-bit blok no, `& 0xFFFFFF`; 4 baytlık değer kodlaması) | b=0: `00 00 00 00 F3 64 45 7E`; b=0x1234: `00 00 12 34 F3 D2 80 7E` | `data[512] crcHi crcLo x x x 73` (n = **0x206 = 518**) | [Observed] `getBlock @0x00813cde`, `handleGetBlock @0x00813e1a`; değer kodlaması `TriggerFrameEx::create @0x0081eaf8` |

- Tüm SD istekleri: `TriggerFrameRequest(frame, timeout=1000 ms, tryCount=3)` (`TriggerFrameSDCardHandler::doRequest @0x00813ffc`) [Observed].
- **0x73 gövdesi** [Observed boyut, Inferred son 3 bayt]: `handleGetBlock` yalnız n==0x206 ise kabul eder, ilk 0x202 baytı alır: 512 bayt sektör + 2 bayt blok CRC'si. Blok CRC'si = **CRC-16/XMODEM** (poly 0x1021, init 0x0000, yansıtmasız) 512 bayt üzerinde, **big-endian** (`[512]=hi, [513]=lo`) (`SDCardFile::isCRCValid @0x0077bbcd`, `getCRC @0x0077bdb1`, `Math::crc16 @0x00bf96be`). Kalan 3 bayt (indeks 514..516) VemsTune tarafından okunmaz; [Inferred] 24-bit blok numarası yankısı (`b2 b1 b0`) — ASCII karşılığı `msg%06x` de 24-bit'tir. Emülatör bu 3 bayta blok no koymalı; içerik kontrol edilmez.
- CRC geçersiz ya da n≠0x206 → olay "CRC error" (response=3) [Observed].
- ASCII (Man mod) eşdeğerleri [Observed string / Inferred eşleme]: `mss`=status, `mse`=start, `msd`=stop/disable, `msc`=erase, `msg%06x`=get block (`SDCardV3Logger::sendStatus @0x00e1c84c`, `sendStart @0x00e1c74c` "msemss", `sendStop @0x00e1c940` "msdmss", `sendErase @0x00e1e598` "msc", `SDCardFileSearch::getInode @0x00e0cd44` "msg%06x"). ASCII yolda da sektör başına 0x202 bayt aktarılır (`SDCardFileDownloader::readSector @0x00e11c08`).

#### 7.1.2 Durum baytı → ECU SD durumu [Observed] `TriggerFrameSDCardHandler::getECUState @0x00814410`, metinler `TriggerFrameSDCardEvent::toString @0x004c0bbc`

| status | enum | Metin | Host'un yorumu |
|---|---|---|---|
| `0x00` | 2 | " running" | log yazılıyor (start başarı ölçütü) |
| `0xFE`,`0xFF` | 1 | " disabled" | log kapalı/kart boşta — search/erase-bitti ölçütü |
| `0xFC`,`0xFD` | 3 | " not running" | |
| `0xDD`–`0xFB` | 4 | " starting" | |
| `0x08` | 5 | " not started" | |
| `0xC1`–`0xDC` | 6 | (metin yok) | [Unknown] anlam |
| diğer | 0 | " unknown" | |

#### 7.1.3 `TriggerFrameSDCardHandler` FSM'i [Observed] `onReceiveTriggerFrame @0x00813064`
Alan `+4` = sürmekte olan işlem (0 idle, 1 start, 2 status, 3 stop, 4 getblock, 5 erase).
- 0x7A alınınca: op 1 veya 3 → **otomatik `01 FA` (GET_STATUS)** gönderir; op 2 → `handleStatus` (n==2 değilse yok sayar) → olay(response=4, ECU state); op 5 → olay(response=5 "Erasing"); op 0 → "Strange" log.
- 0x73 alınınca op 4 ise `handleGetBlock` → olay(response=2 "Block read", blok no, 512 B) ya da (response=3 "CRC error"); her durumda op=0.
- SD hata çerçevesi (`[d] 03 7F` / `03 7F`; `TriggerFrameEx::isSDCardErrorType @0x0081f46a`: son bayt 0x7F ve önceki bayt 0x03) → olay(response=6 "Response error", state 0). `SynchronousHandler` bu çerçeveyle bekleyen isteği kapatır (`@0x00817a70`).
- Diğer tipler → "Unexpected response".

**Sonuç:** her START/STOP komutu kablo üzerinde `0x FA → 7A`, ardından `01 FA → [status] 7A` çiftine dönüşür.

#### 7.1.4 Diziler (SDCardControllerTF) [Observed]
```
GET_STATUS (getStatus @0x007747f4, ResponseToStatus @0x00776cce)
 host: 01 FA            ecu: [st] 7A          → st==00 → "running"(0x17) değilse 0x18

START (startLog @0x00773ff2, ResponseToStart @0x00776702)
 host: 01 FA            ecu: [st] 7A          → st==00 ise "zaten çalışıyor" (0x0E), bitir
 host: 02 FA            ecu: [..] 7A
 host: 01 FA (otomatik) ecu: [st] 7A          → st==00 → başarı (0x0D)
   değilse Sleep(500 ms) + 01 FA, en çok 10 kez → başarısız (0x0B)

STOP (stopLog @0x007743b8, ResponseToStop @0x00776898)
 host: 03 FA → 7A ; 01 FA → [st] 7A          → "stopped" (0x10), durum kontrol edilmez

ERASE (erase @0x00774400, ResponseToErase @0x007768c6)
 [realtime kapatılır]  03 FA→7A ; 01 FA→[st]7A        (response 6 gelirse tekrar 03 FA)
 04 FA → 7A  (op5 → "Erasing")
 01 FA → [st] 7A ; st∉{FE,FF} ise Sleep(250 ms)+01 FA, en çok 30 kez (aşılırsa 0x14 hata)
 st∈{FE,FF} → 03 FA→7A ; 01 FA→[st]7A
 F3(blok 0) → 73 : blok 0 "boş" olmalı (512 baytın toplamı 0 ya da 512·0xFF; SDCardFile::checkSectorIsEmpty @0x0077bcae)
   boş → başarı (0x13); değilse tüm silme en çok 3 kez yeniden → 0x14
 toplam cevap sayısı ≥ 0x20 → 0x19 hata ; sonunda realtime eski hâline
```
```
FW VERSION (getFwVersion @0x00774ba8, ResponseToFWVersion @0x00776d2e)
 [realtime kapatılır] 03 FA→7A ; 01 FA→7A ; F3(0)→73 → blok0[4..5] BE = fw (major=v/10000, minor=(v/100)%100, patch=v%100; SDCardFile::getFwVersion @0x0077be2b)
```
```
SEARCH (search @0x00775c90, ResponseToSearch @0x00779978, checkInode @0x0077af74)
 [realtime kapatılır] 03 FA→7A ; 01 FA→[st]7A
 st==FE/FF ("disabled") beklenir; değilse 01 FA tekrar (≤50; aşılırsa 0x15)
 (opsiyonel) [ubrr] FC → 7C (SD baud'u), sonra 01 FA
 F3(0), F3(1), … : "VEMS" süperblok(lar)ı ardışık okunur; boş blok gelene kadar
 son kayıt başlangıcından itibaren uç arama: probe=lo+0x1000, hi=0x7FFFFF;
   dolu→lo=probe, boş→hi=probe; sonraki probe = (hi−lo<4) ? (lo+hi)/2 : lo+(hi−lo)/4 ; lo+1≥hi olana dek
   → son dolu blok = log sonu; o bloğun [0x1FE] baytı = örnekleme kodu (0x40..0x4B dışı/0x7E → 0x45)
 F3(0), F3(1)… : checkInode ile kayıt listesi toplanır; boş/VEMS-dışı blokta biter
 (cevap response≠2 ise 03 FA ile tekrar, ≤50)
```
**Emülatör uyarısı** [Observed]: uç arama 0x7FFFFF'e kadar rastgele blok numaraları ister; kart sonu ötesindeki her blok **tamamen 0x00 veya 0xFF** dönmelidir (hata çerçevesi değil).

```
DOWNLOAD (download @0x00776238, ResponseToDownload @0x00777062)
 03 FA→7A ; 01 FA→[st]7A
 F3(start) → 73 ; F3(start+1) → 73 ; … F3(end) → 73      (tam sıralı, tek uçuşta 1 istek)
   - blok CRC hatalı/hata → hata sayacı++, 01 FA ile durum alıp aynı bloğu tekrar ister; 10 hatada iptal (event 0)
   - blok verisi tümü 0x00 ya da tümü 0xFF ise (SDCardFile::isDataValid @0x0077bc48) AYNI blok sınırsız tekrar istenir (>3'te log "Too much CRC error for a block")
   - tampon = (end−start)·0x202 + 0x404; bitince SDCardEvent(type 5) + veri
```
`createSummary @0x00774f86` / `ResponseToSummary @0x00777a78` aynı GET_BLOCK desenini kullanır (CRC + isDataValid kontrolü; içerik `SDCardFile::parseTriggerFrame @0x0077bfa2` ile özetlenir) [Observed].

#### 7.1.5 Kart içi biçim (FILE-FORMATS §11.2'ye ek) [Observed]
- **Süperblok / inode bloğu**: `[0..3]="VEMS"` (`isVEMSFilesystem @0x0077bdfe`), `[4..5]` fw sürümü BE, `[6]` [Unknown], `[7]` inode sürümü ∈ {1,2,3} (`getInodeVersion @0x0077bf95`); başka sürüm → "VEMS FS değil" (−2). Kayıtlar ofset 8'den başlar, ilk sıfır başlangıçta biter:
  - v1: 3 bayt `[a b c]`, tip=1
  - v2: 4 bayt `[a b c type]`
  - v3: 8 bayt `[a b c type fwHi fwLo uHi uLo]` — fw16 = `bits: patch=&0x7F, minor=>>7&7, major=>>10&7, ?=>>13&7` (`getFWVersion_New @0x0077bf26`); `u` [Unknown]
  - başlangıç bloğu = `a·0x8000 + b·0x80 + (c>>1)` (`checkInode`, `ResponseToSearch`).
- Log *i* = blok `start[i] … start[i+1]−1` (sonuncusu arama ile bulunan son dolu bloğa kadar). Log süresi `SDCardFile::CalcLogTimeLength(blocks, rate) = blocks · 0.1 · round(512/rate)`; tip 2 ve fw ≥ 1.1.96 için ilk 8 blok düşülür ve /1.1667 ölçeklenir [Observed sabitler `0x10eb8a0=0.1`, `0x10eb898=512.0`, `0x10eb690=1.16667`].
- Veri blokları kaçışlı TF çerçeveleri içerir: `0x72` ECU details, `0x78` sayfa bilgisi, `0x74` sayfalar, sonra `0x20` realtime / `0x30` GPS (`TriggerFrameToSiprLogConverter::processTriggerFramePacket @0x00bc16a2`). Özetleme realtime gövdesinden rpm=`[14..15]` BE, map=`[4..5]` BE /4, bayrak baytı `[0x2F]` (bit7 → "alson", bit6 → "launchon") okur; GPS (0x30) `[13..16]` tarih/saat (`parseTriggerFrame @0x0077bfa2`).
- **Pratik emülatör yolu** [Inferred]: gerçek bir `.raw` imajı (`dd`, §11.1) blok blok servis edilebilir; CRC-XMODEM'i emülatör her blok için hesaplar.

---

### 7.2 EEPROM

#### 7.2.1 EEPROM_CONTROL (`0xEF` → `0x6F`)
Alt komut = tipten önceki tek veri baytı.

| Alt | Anlam | Gönderen | Kablo |
|---|---|---|---|
| 1 | `ManmcL0mbye` ("L0") | `FirmwareConfigManager::setLoadCmd` | `01 EF 41 AC 7E` |
| 2 | `ManmcL1mbye` ("L1") | `FirmwareConfigManager::setLoadCmd` | `02 EF …` |
| 3 | durum yoklama (poll) | `SynchronousHandler::createEepromPollRequest @0x00818b14` | `03 EF 40 CC 7E` |
| 4 | burn | `TriggerFrameFactory::createBurn @0x0081fd62` | `04 EF 42 FC 7E` |
| 5 | `ManmcS0mbye` ("S0") | `FirmwareConfigManager::requestAdvancedBurn` | `05 EF …` |
| 6 | `ManmcS1mbye` ("S1") | `FirmwareConfigManager::requestAdvancedBurn` | `06 EF 43 9C 7E` |

Kaynak: `VemsCommandTranslator::createTriggerFrame(StringCommand) @0x00823922` regex `Manmc([LS])([01])mbye` → L0=1, L1=2, S0=5, S1=6 [Observed]; gönderen fonksiyonlar binary'deki string referanslarından [Observed]. L/S ve 0/1'in firmware anlamı [Unknown] (Load/Store, bank 0/1 [Inferred]).

**Davranış** [Observed] `SynchronousHandler::poll @0x008178ba`, `handleEepromControlRequest @0x008188c4`, `handleEepromControlResponse @0x008189dc`:
- Alt≠3 bir 0xEF isteği gönderildiğinde host onun cevabını **beklemez**; hemen `03 EF` yoklamasını (timeout 1000 ms, tryCount 1) kuyruğa koyar.
- `0x6F` cevabında durum = `data[n−3]` (CRC'siz gövde `[… status X 6F]`). `status != 1` → yeni `03 EF`; sınırsız yoklama. `status == 1` → tamam.
- Cevap gövdesi [Inferred]: `[status] [sub] 6F` (X = alt komut yankısı, "[subtype] type" kalıbına göre; host X'i okumaz). Meşgul hata: `02 09 7F` (EEPROM_CONTROL|ERROR_BUSY; kablo `02 09 7F 97 B0 7E`) [Observed kod tablosu].
- StringCommand yolu (L/S): `TriggerFrameController::requestStringCommand @0x0081c586` → `TriggerFrameMemoryHandler::request @0x0082180a` (0xEF: timeout 1000, tryCount 1) + **anında yerel SIPR ACK** (`sendAckPacket @0x00822b9e`). Burn yolu `request @0x00820d2e` (§4.5.5).
```
host: 04 EF                     (cevap beklenmez)
host: 03 EF        ecu: [st] 03 6F     st≠1 → tekrar 03 EF …
host: 03 EF        ecu: 01 03 6F       → burn tamam
```
Emülatör önerisi [Inferred]: `04 EF`'e de `[st] 04 6F` dönülebilir (eşleşme tipe göre olduğundan bekleyen yoklamayı kapatır, zararsız); burn anında bitiyorsa her zaman `01 xx 6F`.

#### 7.2.2 EEPROM tam okuma (`EepromReaderTFFormat`, `0xF5` → `0x75`) [Observed]
`EepromTriggerFrameController::readEeprom @0x0080cad2` → `EepromReaderTFFormat` (`<ctor> @0x00dfd6d8`, `sendCommand @0x00dfe3fc`, `waitData @0x00dfe214`, `read @0x00dfe3e0`).
- İstek: `[idx] F5` — idx 0'dan başlar, her cevapta **+15** (0x0F) artar, `idx < 0x100` iken devam: idx = 0, 15, 30, …, 255 → **18 istek**. Örnek: `00 F5 C1 F7 7E`, `0F F5 C4 07 7E`.
- Cevap: `getFrame` (CRC dahil) sonundan **5 bayt** atılır ve kalan **0xF0 = 240** bayt olmalıdır ⇒ gövde `data[240] x y 75` (+CRC). `x y` okunmaz [Unknown; Inferred adres/uzunluk yankısı]. 240 değilse durum 3 (hata) yazılır ama ardından üzerine yazılır — fiilen tolere edilir [Observed].
- Adres semantiği [Inferred]: idx = 16-baytlık blok numarası (240 = 15×16; §4.5.6 `0C F5` ↔ taban 0xC0 ile tutarlı). Son istek idx=255 (adres 0xFF0) 240 bayt ister; 4 KB sınırını aşar — emülatör yine 240 bayt döndürmeli (dolgu/sarma). Tampon sonunda boyut **0x1000**'e kırpılır.
- Zaman aşımı: boş okuma başına 2 ms, >1000 tur → hata (≈2 s); yeniden deneme yok. Tip 0x75 değilse hata.
```
host: 00 F5          ecu: d[0x000..0x0EF] x y 75
host: 0F F5          ecu: d[0x0F0..0x1DF] x y 75
 …   (idx += 15)
host: FF F5          ecu: d[0xFF0..0x10DF] x y 75   → toplam 0x1000'e kırpılır
```

#### 7.2.3 EEPROM tam yazma (`TriggerFrameWriterClient`, `0xF9` → `0x79`) [Observed]
`EepromTriggerFrameController::writeEeprom @0x0080c8e0`: `WriterClient(data, len, startAddr=0, type=0xF9)` (`<ctor> @0x00dfc1a0`).
- İstek (ham mod, `sendDataRaw @0x00dfce94`): `d[k] aH aL F9`, k = min(16, kalan) (kalan tam 16 ise 16), adres = mevcut yazma adresi BE.
- Cevap (`checkResponseRaw @0x00dfc580`): `aH aL k 79` — host `frame[2]==k` ve `frame[0]·256+frame[1]==adres` doğrular; uyuşmazlık → hata 8/9, tip yanlış → 7, `n<3` → 6. Doğruysa adres += k; toplam = len olunca biter. Her adımda "progress" olayı.
- Sayfa yazma yolundaki tek-bayt `[value aH aL] F9` (§4.5.4) aynı cevap düzenini bekler [Inferred].

---

### 7.3 SRAM okuma/yazma istemcileri

#### 7.3.1 `TriggerFrameReaderClient` (`0xF4`/`0xF5`/diğer) [Observed] `sendAddress @0x00dff8b8`, `waitResponse @0x00dfef5c`
`SRAMTriggerFrameController::create_and_run_client @0x00815108` bunu yalnız **0xF4** ile kurar (struct/symbol okuma; adres ve uzunluk `internal_getStructInfo @0x00815b04`'ten).
- İstek: tip 0xF4/0xF5 için önce `len = min(kalan, 0xF0)`; sonra adres:
  - 0xF4: `aH aL` (16-bit) → `[len] aH aL F4`; yankı uzunluğu 2
  - 0xF5: `aL` (8-bit) → `[len] a F5`; yankı 1
  - diğer tipler: `[a31..24 a23..16 a15..8 a7..0]` 4 bayt, uzunluk baytı yok; yankı 4
- Cevap: `data[N] <yankı> type+0x80` → N = `n_crcli − 3 − yankı`. Yankı içeriği kontrol edilmez.
- [Unknown/olası hata] Ghidra çıktısında ilerleme sayacı veri uzunluğu yerine çerçeve sayısı (`uStack_4c`) kadar artıyor; ≤240 baytlık tek parça okumalarda etkisi yok. Emülatör istenen `len` kadar veri döndürmeli.

#### 7.3.2 Diğer SRAM okuma yolları [Observed]
- `TriggerFrameController::readSRAMAddress(addr, handler) @0x0081c3fe`: `10 aH aL F4` (**16 bayt**), `TriggerFrameMemoryHandler::request @0x0082180a` (TFMemoryHandlerRequest tip 4, timeout 1000, tryCount 1). Cevap baytları (tip dahil) ve uzunluk `GeneralEvent` ile handler'a verilir (`handleReadSRAMRequest @0x00821f06`). Örnek: `10 01 23 F4 4D 93 7E`.
- `TFMemoryHandlerRequest` tipleri (`onReceiveReadResponse @0x00821d22`): 0 sayfa, 1 tüm sayfalar, 4 SRAM, 6 EEPROM (`handleReadEEPROMRequest @0x00821f00` boş gövde), 8 SRAM-realtime.
- 0x74 cevap gövdesi: `data[L] aH aL 74` (§4.5.3; `handleSramReadRealtimeRequest @0x0082206e` adresi doğrular).

#### 7.3.3 `TriggerFrameWriterClient` SRAM yazma (`0xFB` → `0x7B`) [Observed]
- **Ham mod** (`writeSymbol` → `create_and_run_client` durum 3; `WriterClient(data, len, (symAddr+off)&0xFFFF, 0xFB)`): `d[≤16] aH aL FB` → `aH aL k 7B` (7.2.3 ile aynı doğrulama).
- **Çoklu mod** (`writeAddresses` → durum 4; `<ctor> @0x00dfd334`, `sendDataMultiple @0x00dfd100`, `checkResponseMultiple @0x00dfc990`): liste elemanı başına tek bayt `value aH aL FB` → `aH aL 01 7B`.
- Hatalar: `01 0A 7F` (SRAM_WRITE|NO_PARAMETERS), `02 0A 7F` (OVERWRITE) [Observed tablo; ECU koşulu Unknown].
```
host: d0..d15 00 40 FB      ecu: 00 40 10 7B
host: d16..d31 00 50 FB     ecu: 00 50 10 7B
 …  son parça k<16          ecu: aH aL k 7B   → bitti
```

---

### 7.4 Trigger-log (TF modu)

#### 7.4.1 Başlatma / durdurma [Observed]
- `TriggerLogControllerTF::start @0x00826d8a` → olay işleyicisi + `registerForRawInput` (ham baytlar `MemBufferEvent` ile görünüme, `OnRawInput @0x00826e46`) + `TriggerFrameController::enableTriggerLog` → `TriggerLogTFHandler::enableTriggerLog @0x00823504`: önce `setTriggerLogMode(1)`, sonra **`40 03 F7`** (`m_enableBytes` @.data `0x010925D4` = `40 03`). Kablo: `40 03 F7 31 62 7E`.
- `stop @0x00826dde` → `disableTriggerLog @0x00823648`: önce `setTriggerLogMode(0)`, sonra **`00 03 F7`** (`m_disableBytes` = `00 03`). Kablo: `00 03 F7 30 B6 7E`.
- Bu, TEST_TOOLS alt=3 (ENA_FLAGS) param 0x40 / 0x00 — ASCII `mde40` / `mde00` ile birebir (`TriggerLogReader::sendStartCmd @0x00e00528`, `sendStopCmd @0x00e008f0`) [Observed].
- Trigger-log modundayken `TriggerFrameCommunicationController::poll @0x0081a394` kuyruğun başındaki "tlog isteğini" (`isTLogRequest @0x0081ad96`: tip 0xF7 ve `data[0]∈{0x00,0x40}`, `data[1]==3`; ya da tip 0xFC) bekleme kaydı açmadan doğrudan gönderir ⇒ enable için cevap beklenmez; disable mod kapandıktan sonra gittiği için normal istektir (1000 ms, cevap `… 77`) [Observed].
- Realtime: `TriggerLogControllerTF` realtime'ı kendisi kapatmaz; `reenableRealtime @0x00826e30` var ⇒ GUI'nin önceden kapattığı [Inferred].
- Baud değişimi (`changeBaudrate @0x00826f28`): `[ubrr] FC` → `7C` → "chb_finished" olayı.

#### 7.4.2 Akış ve "veri yok" mantığı [Observed]
- Trigger-log modunda gelen çerçeveler: tip ≤ 0x61 (0x20 hariç) ve 0x7C bekleyen istekle eşleştirilmeden doğrudan olay olur (`onReceiveTriggerFrame @0x00819d12`, `TriggerFrameController::OnTriggerFrameEvent @0x0081d264`). Aynı baytlar ham olarak `.triggerlog` dosyasına yazılır (FILE-FORMATS §10: 512 B başlık + ham kaçışlı TF akışı).
- `TriggerFrameCommunicationClient::read @0x00e27200`: modda ardışık **300** boş okuma → `onTriggerLogNoData @0x0081ae50`: `40 03 F7` yeniden kuyruğa + bayrak; ardışık **3** kez olursa `GeneralEvent("TriggerLogNoData", 1)`. Bayrak açıkken `0x77` çerçevesi gelirse yine "TriggerLogNoData" olayı.
- Trigger-log modunda istek zaman aşımı (event id 0) → `enableTriggerLog` tekrar (`40 03 F7`).

#### 7.4.3 TRIGGER_EVENT çerçeve gövdeleri [Observed] `TriggerFrame::addFrame @0x00818d8a`, `convertFrame2Time @0x008190e0`
Akış `7E`'lerden bölünür, kaçış çözülür, CRC16/MODBUS doğrulanır (`TriggerLog::fillTRDataArray @0x0082551e`). `T` = 16-bit BE zaman damgası; birim **4 µs** (`t_ms = 4·ticks/1000`, sabitler `0x10fc7b8=4.0`, `0x10fc7c0=1000.0`), 16-bit taşmada +0x10000.

| Tip | Gövde (CRC hariç) | Anlam |
|---|---|---|
| `0x01` | `T₁ T₂ … Tₖ 01` | yalnız birincil tetik zaman damgaları |
| `0x02`–`0x1F`, `0x50`–`0x57`, `0x5A`–`0x61` | `T₁ … Tₖ Eₕ Eₗ type` | birincil damgalar + olay zamanı E |
| `0x40`–`0x4E` | `T₁ … Tₖ d Eₕ Eₗ type` (gövde ≥ 4 + CRC) | + 1 bayt olay verisi `d` |
| `0x20` | realtime (§4.5.2) | |
| diğer | — | tanınmaz (0x101) |

Olay adları `graphcolors.xml <event id=1..62>` (FILE-FORMATS §10). ASCII Man-modu trigger-log (`TriggerLogReader`: `Manmxc`, `mde40`/`mde00`, `Manmde40` ≤5 yeniden başlatma, `mcB%02X`, ham parola `+0x78`, AIM akışı `0xA3` işaretli 4 bayt+toplam) TF dışıdır [Observed `@0x00e00410`, `@0x00e007b8`, `@0x00e00a58`].

---

### 7.5 TEST_TOOLS (`0xF7` → `0x77`) [Observed]
Gövde: **`[param] [sub] F7`** (`VemsCommandTranslator::createTriggerFrame(StringCommand) @0x00823922`, regex `md([deainh])([0-9a-fA-F]{2})`, `TriggerFrameEx(0xF7, data, 2)`); ham komut: `[b1] [b2] 07 F7` (`createTriggerFrame(RawCommand) @0x008249ca`: `RawCommand` "X b1 b2", uzunluk ≥3).

| sub | Harf | Hata adı (`0x0{sub+2}08`) | GUI göndericisi (ASCII şablon) |
|---|---|---|---|
| 1 | `h` | DIGITALOUT | `OutputChannelsCfg::onTestButton` (`Manmdh%02xbye`), `CheckBoxMatrix::OnTestButton/SwitchOffTests`, `CheckBoxMatrixViewer2::switchInjGroup` (`Manmdh%x0bye`, `Manmdh%d0bye`) |
| 2 | `n` | IGNDWELL | `IgnitionOutputPanel::OnTestButton` (`Manmdn%02Xbye`) |
| 3 | `e` | ENA_FLAGS | `WBO2CalibrationFrame::sendStart/sendStop` (`Manmde02/03/00bye`), `CalibrationWBO2::start/stop`; trigger-log `40` |
| 4 | `d` | DIS_FLAGS | [Unknown] gönderen bulunamadı |
| 5 | `a` | FORCE_ADV | `IgnitionLockPanel::ignitionRequest` (`Manmda%02Xmbye`) |
| 6 | `i` | FORCE_IAC | `IACControl/IACControlPanel/IACLockPanel::commandRequest` (`Manmdi%02Xmbye`) |
| 7 | (`X`) | FORCE_GENERAL | `RawCommand` — gönderen [Unknown] |

- Harf→sub eşlemesi ve hata kodları [Observed] (`getErrorSubTypeAsString @0x008196ca`: `0x0308`…`0x0908` = sub+2'nin "MISSING_PARAMETER"'ı). Gönderen fonksiyonlar binary string referansıyla [Observed]. `param` = harften sonraki 2 hex hane (`ToLong(16)`); kaynak değişkenin ataması decompile'da görünmüyor [Inferred].
- Yol: `requestStringCommand` (dönüş 1) / `requestRawCommand @0x0081c7c0` → varsayılan `TriggerFrameRequest` (1000 ms, tryCount 0). Cevap `… 77` gövdesi okunmaz [Inferred: içerik serbest]. Hatalar `[d] 08 7F` (`01 08 7F` NO_SUBTYPE, `02 08 7F` BAD_SUBTYPE).
- `mcB<hex>` StringCommand'ı `[ubrr] FC` üretir (dönüş 4) [Observed].

---

### 7.6 GO_BOOTLOADER (`0xF6`) [Observed]
- Gövde **`FE F6`** — `DeviceModeSelector::<ctor> @0x00df9ee0` (satır ~537): `TriggerFrameEx(0xF6, subtype=0xFE, value=-1, NULL, 0)`; kaçışlı baytlar `FE F6 C1 96 7E` bir `ModeSelectCmd{0x12 → 0x0B}` (TF → Bootloader) olarak eklenir [Observed; alan anlamı Inferred].
- Cevap beklenmez; ECU bootloader'a geçer ve mod seçici bootloader tespitini bekler [Inferred]. Hatalar: `01 06 7F` NO_PARAMETER, `02 06 7F` CANT_GO.

---

### 7.7 Emülatör için asgari davranış özeti [Inferred, yukarıdaki Observed davranıştan türetildi]
1. `xx FA` → her zaman `[st] 7A` (1 veri baytı); st: log açık `00`, kapalı `FF`. `02 FA` sonrası st=`00`, `03 FA` sonrası `FF`; `04 FA` sonrası kısa süre `C1..FB` sonra `FF` ve blok 0 tamamen 0x00/0xFF.
2. `00 b2 b1 b0 F3` → `sector[512] crcXmodemHi crcXmodemLo b2 b1 b0 73`; kart dışı bloklar tamamen 0xFF; 0x7FFFFF'e kadar her blok sorgusuna cevap ver. SD yoksa `03 7F`.
3. `03 EF` → `01 03 6F` (burn anında bitti); `04 EF`/`0[1256] EF` → `01 xx 6F`.
4. `[idx] F5` → `eeprom[idx·16 … +240] 00 idx 75` (dışı 0xFF).
5. `d[k] aH aL F9|FB` → `aH aL k 79|7B`; `[len] aH aL F4` → `sram[len] aH aL 74`.
6. `40 03 F7` → trigger olay akışı başlat (0x01/0x02… çerçeveleri, 4 µs damgalar); `00 03 F7` → durdur ve `00 03 77` dön. Diğer `[p][s] F7` → `[p][s] 77`.
7. `FE F6` → bootloader moduna geç (cevapsız).

### 7.8 Bilinmeyenler
- 0x73 gövdesindeki son 3 baytın kesin içeriği (blok yankısı varsayıldı); SD durum enum 6 (`0xC1–0xDC`) anlamı.
- 0x75 gövdesindeki `x y` (2 bayt) ve 0x6F'deki ikinci bayt; 0x77 (TEST_TOOLS) cevap içeriği.
- EEPROM_CONTROL L0/L1/S0/S1'in firmware semantiği; TEST_TOOLS `d` (DIS_FLAGS) ve `X` (FORCE_GENERAL) göndericileri; `param` baytının bit düzeni (ör. `mdh%x0`: kanal<<4|durum?).
- Inode v3 son 2 baytı (`u`), süperblok `[6]`.
- `TriggerFrameReaderClient` ilerleme sayacının çok parçalı okumada doğru çalışıp çalışmadığı (decompile belirsizliği).
- Trigger-log sırasında realtime'ı kimin kapattığı (GUI katmanı, bu dilimde okunmadı).

---

## 8. AIM, Modbus, MDX ve TCP/uzak mod

> Yan protokoller; `###` numaraları bu bölüme görelidir. Not: TCP taşıması TF/MT baytlarını şeffaf iletir (SIPR kabloda değildir, §0); alt-ajan metnindeki "SIPR çerçeveleme" ifadesi taşıma şeffaflığını kasteder.


Kapsam: VemsTune 1.5.46 içindeki yan protokoller. Etiketler: [Observed] = decompile/bayt kanıtı, [Inferred] = çıkarım, [Unknown] = belirlenemedi. Adresler `vemsTune-c.exe` VA.

### 1. AIM protokolü

#### 1.1 Rol
- VemsTune **AIM akışının alıcısıdır** (dashboard emülatörü değil). ECU (veya VEMS AIM uyumlu gösterge) AIM kayıtlarını sürekli yayınlar; VemsTune pasif dinler. `DeviceDetector` → `AIMRecognizer::feed @0x00bae986` → `FSMAIM::feed @0x00d5f854` dönüş kodu 5 = geçerli kayıt. [Observed]
- Ek olarak VemsTune AIM kaydı **gönderebilir**: `AIMDetector::write @0x00e033cc`, `AIMDeviceController::SendSIPRPacket @0x00a076fe` ile kuyruğa konan SIPR 145 paketlerini AIM kaydına çevirip hatta yazar. Bu yol `AIMDeviceController` (ayrı "AIM cihazı" seri bağlantısı, `aimdsettings.db` / `AIMDisplayPanel` ile ilişkili) içindir. Gönderimi kimin tetiklediği [Unknown] (`AIMCommunicationThread::sendSiprAIM @0x0042e0c4` dışında çağıran bulunamadı). [Observed/Inferred]
- `AIMParser` (protokol tipi 0xF, `AIMParser::type @0x00fa1074`) ayrı bir eski/alternatif sınıf; `sendChannel @0x00453ffe` aynı 5 baytlık kaydı üretir, `tx @0x00453eea` "send set state MAN" log'u ile bekleyen komutu yollar. Kullanım yeri [Unknown]. [Observed]

#### 1.2 Kayıt formatı (5 bayt) [Observed `FSMAIM::feed @0x00d5f854`, `AIMParser::feed @0x00453b6e`, `SIPR2AIMConverter::Convert @0x0047a228`, `AIMParser::setSum @0x004541a4`]

| Ofset | Alan | Not |
|---|---|---|
| 0 | `channel` | AIM kanal kimliği (bkz. 1.4) |
| 1 | `0xA3` | sabit senkron baytı (`AIMData::AIM_CONST`) |
| 2 | `valueHi` | değer, big-endian U16 |
| 3 | `valueLo` | |
| 4 | `sum` | `(b0+b1+b2+b3) & 0xFF` |

Senkronizasyon FSM'i: durum 0'da gelen her bayt "önceki bayt" olarak saklanır; `0xA3` gelince önceki bayt kanal kabul edilir, `sum = ch + 0xA3`, durum 2 → hi, durum 3 → lo (toplama eklenir), durum 4 → checksum karşılaştır: eşit → 5 (OK), değil → 6 (hata), durum 0'a dön. Not: durum ≠0 iken gelen `0xA3` veri olarak işlenir (kaçış yok). [Observed]

`AIMParser::syncRecord @0x00453ad6`: 5 baytlık pencerede `0xA3` konumuna göre hizalama kaydırması (1/2/4) döndürür. [Observed]

#### 1.3 Algılama ve zaman aşımı
- `DeviceDetector`: `checkAIM` açıksa `aimfallbacktime`×1000 ms dinler; ≥300 bayt ve ≥6 geçerli kayıt → AIM cihazı (bitiş kodu 2 → `PortScanner::OnAIMDeviceFound @0x00e1f124`). Ayar: `v3gui.cfg` kökünde `forceAIM=0`, `aimfallbacktime=10`. [Observed, görevden + config]
- `AIMDetector::read @0x00e03864`: boş okuma başına 2 ms uyur; ardışık boş okuma sayısı `0x28` (=40, ctor @0x00e03664) eşiğini aşarsa durum 2 → `finish` "TIMEOUT" olayı (`AIMCommunicationThread::OnAimDetectEvent @0x0042debe` iletişimi durdurur). [Observed]
- Kanal filtresi: global int dizisi (`DAT_011fd724`) doluysa ve kanal listede yoksa döngü **break** eder (tamponun kalanı atılır). [Observed]

#### 1.4 SIPR 145 (SIPR_AIM) eşlemesi
- Alım: her geçerli kayıt → `SIPRPacket(seq=0, type=0x91, len=3, payload=[channel, valueHi, valueLo])` InputEvent olarak yayınlanır (`AIMDetector::read`). Log'larda AIM verisi bu biçimde saklanır. [Observed]
- Gönderim/ters çevirme: `SIPR2AIMConverter::Convert` payload `[ch,hi,lo]` → `[ch,0xA3,hi,lo,sum]`. `AIMDetector::OnSIPRInputEvent @0x00e0340c` bunu 0xFC baytlık tx tamponuna ekler; `write` tamponu tek seferde boşaltır. [Observed]
- `AIMParser::rx @0x00453c8c` ise geçerli kayıtta **boş** (len=0) tip 145 paketi üretir (bayt kanıtı: `SIPRPacket(0,0x91,0,NULL,0)` @0x453da8) — yalnızca bildirim. [Observed]
- Kanal kimlikleri (`config/aimdsettings.db: aimchannels`, `vemsTune-aim.ini [OutputChannels]` ofset alanı = kanal id) [Observed]:

| id | kanal | ölçek |
|---|---|---|
| 1 | RPM | y=x |
| 5 | Wheel speed | x/10 |
| 9 | Oil pressure | x/100 |
| 13 | Oil temp | x/10−100 |
| 17 | Water temp | x/10−100 |
| 21 | Fuel pressure | x/100 |
| 33 | Battery voltage | x/100 |
| 45 | Throttle angle | x/10 |
| 69 | Manifold press | y=x (ini: /10) |
| 97 | Air charge temp | x/10−100 |
| 101 | Exhaust temp | x/10−100 |
| 105 | Lambda | x/1000 (ini) |
| 109 | Fuel temp | x/10−100 |
| 113 | Gear | y=x |
| 125 | Errors | — |
| 133 | GPS speed | ×1.852 |
| 248–255 | Internal ADC'ler | ×1.22 |

- Emülatör için: AIM modunda ECU yalnızca bu 5 baytlık kayıtları döngüsel yayınlamalı; istek/yanıt yoktur. Baud: `AIMDeviceController::initCommunication @0x00a0782c` kendi baud ayarını kullanır; değer [Unknown] (AIM standardı 19200 8N1 [Inferred]). Kayıt aralığı/sırası [Unknown].

### 2. Modbus

#### 2.1 Roller [Observed]
- `ModbusClient` iki modlu: `+0xC4 == 1` iken **master** (adı yanıltıcı: `writeServerMode @0x00df33d4` istek gönderir, `readServerMode @0x00df5c14` yanıtı `ModbusResponseFactory` ile çözer). Diğer modda **slave** (`readClientMode @0x00df3320` → `handleRequest @0x00df31b4` → `ModbusRequestFactory::create`, `writeClientMode` yanıt yollar).
- `VemsModbusClient` (VemsTune ↔ harici Modbus cihazı, ör. VFD / 3phase-sync) master kullanır. Bu bir **ECU protokolü değildir**; ECU emülatörü yalnızca Modbus profili seçilmişse slave olarak taklit etmeli. [Inferred]

#### 2.2 Çerçeve: yalnızca Modbus **ASCII** [Observed]
- `ModbusRequest::createAsciiFrame @0x006c357a` / `ModbusResponse::createAsciiFrame @0x006c447a`: `':' + HEX("%02X", [devId, func, data..., LRC]) + "\r\n"`.
- LRC = `ModbusUtil::calculateLRC @0x006c1378/0x006c13b0` (gövde decompile edilmedi; standart iki tümleyen toplam [Inferred]). `checkLrc @0x00df3168` son baytı ayırıp karşılaştırır.
- `Modbus_ASCII_FSM::parse @0x006c147a`: `':'` → topla → `'\r'` → `'\n'` → çerçeve tamam. `Modbus_RTU_FSM::parse @0x006c263c` boş stub (RTU/CRC desteklenmiyor). [Observed]
- Seri ayarlar `v3gui.cfg [communication/modbus]`: `ModbusEnabled`, `ModbusDeviceName` (profil klasörü), `ModbusDataBits` (7/8), `ModbusParity` (N), `ModbusStopBits`, `ModbusDeviceId`, `ModbusRealtimeAddress` (örn. 0x2100), `ModbusRealtimeLength` (örn. 11), `ModbusDeviceConfigFile`. `ModbusController::start @0x006c28d0` bunları seri porta uygular, `setMaxTryCount` ile tekrar sayısı. [Observed]

#### 2.3 Fonksiyon kodları [Observed factory'ler]

| func | istek gövdesi | yanıt | durum |
|---|---|---|---|
| 0x03 Read Holding Registers | addrHi addrLo cntHi cntLo | byteCount, reg[BE]… | kullanılıyor (realtime + sayfa okuma) |
| 0x06 Write Single Register | addrHi addrLo valHi valLo | echo | kullanılıyor (sayfa yazma) |
| 0x10 Write Multiple Registers | addr, qty, byteCount=(qty&0x7F)*2, reg[BE]… | addr, qty | istek kodlayıcı var; slave tarafı parse etmez (factory 0 döner) |
| 0x08 Diagnostics | — | — | stub |
| func|0x80 | — | exception | yanıt func = istek func+0x80 → hata olayı |

#### 2.4 Adresleme ve SIPR 200 (SIPR_MODBUS_READ) sarmalaması [Observed]
- Realtime: `sendReadRealTimeRequest @0x00e34428` → `ReadHoldingRegisters(devId=+0xDC, addr=+0xDE, count=+0xE0)` (ModbusRealtimeAddress/Length).
- Yanıt `handleReadRealtimeReponse @0x00e361e0`: tampon = `[startAddrHi, startAddrLo] + reg0Hi reg0Lo …`; `sendSiprRealTimePacket @0x00e34688` → `SIPRPacket(0, 200, len, buf)`.
- Sayfa okuma: `sendSiprMemoryReadPacket @0x00e34aa0` → tip 200, payload `[pageId, 0x00, data…]`, len = data+2. Register adresi = `(page << 8) | (byteOffset >> 1)` (`requestWritePage @0x00e32f78`; ini notu "0x0100 → page1 offset0"). INI'de `offset = 2×register`.
- Yazma: iki ardışık bayt birleştirilip `WriteSingleRegister` (0x06) ile yollanır (`requestWritePage`). [Observed/Inferred]
- Frekans: `updateRealtimeFrequency @0x00e34a50` saniyedeki yanıt sayısını `SIPRPacket(0, 0x94 SIPR_UPDATE_FREQUENCY, 4, Math_getBytes(count))` olarak yayınlar. Bayt sırası [Unknown].
- Zaman aşımı: `CommunicationTimer`; deneme sayısı aşılınca olay 3 (timeout). Olay kodları: 0 OK, 1 LRC hata, 2 çözme hatası/yanlış func, 3 timeout, 4 istek alındı (slave), 5 hex hatası. [Observed]

### 3. MDX (SIPR_MDX_FRAMES_END, tip 149) [Observed `OffsetReaderClient` @0x00e22..–0x00e26..]
- MDX = ECU firmware konsolunun **`mdx` bellek-döküm komutu**; "offset okuma" (`VemsDeviceController::readOffset/readOffsetSIPR @0x00bc7476/0x00bc6cb6`) özelliği için.
- Akış: `DeviceModeSelector` ile cihaz **MAN** moduna alınır (mod 0xD; `goMan @0x00e23dc0` "Going to MAN mode"). Sonra adres listesindeki her öğe için ASCII `"mdx" + <hexAdres>` gönderilir (`sendCommand @0x00e24198`; satır sonu [Unknown], muhtemelen `\r`).
- Yanıt (`getResponse @0x00e2432c`): ham **32 bayt**; CRC bayrağı (`+0x64`) açıksa 32 + 2 bayt, CRC = `Math_crc16_sipr` (init 0xFFFF) 32 veri baytı üzerinden, little-endian ushort `@+0x20`. Hata → "crc error".
- `createSipr @0x00e25408`: her çerçeve → `SIPRPacket(0, 0x41 SIPR_READ_MEMORY_32, 36, [addr32 BE = hex2int(addr)<<4] + 32 bayt)`. Liste indeksi başa sardığında (tam tur) önce **boş** `SIPRPacket(0, 0x95, 0)` = MDX_FRAMES_END yayınlanır.
- Bitince cihaz modu sıfırlanır (`resetDevMode @0x00e25fdc`). Okuma zaman aşımı 0x5DC=1500 ms (`write`). [Observed]

### 4. TCP / uzak mod
- Ayarlar `v3gui.cfg [communication] mode=SERIAL|…`, `[communication/tcp] ip=vemstune:9000, timeout=1500, useTelnet=0, useHub4Com=0, telnetPreferredBaudrate=19200`. [Observed]
- `TcpPortScanner(evtHandler, "host:port", timeout, …) @0x004868b4` seri `PortScanner` ile aynı `DeviceDetector`/`CommunicationController` zincirini kurar (`registerDeviceDetector @0x00487266`); yani **SIPR çerçeveleme değişmez**. Gövdeler decompile edilmedi. [Observed sembol / Inferred davranış]
- `RemoteSerialPort(host, port) @0x00485fc4` = `TCPClientHandler` + `ReducedTelnetFsm`, varsayılan baud 0x4B00=19200.
  - Gönderim `SendString @0x0048627a`: blok ≤0x200; her `0xFF` bayt **`FF FF` olarak ikilenir** (Telnet IAC kaçışı). Bu fonksiyonda useTelnet kontrolü yok. [Observed]
  - Alım `Read @0x004863fa`: her bayt `ReducedTelnetFsm::read @0x00485798` süzgecinden geçer; yalnız veri baytları iletilir. FSM durumları (string): `WAIT_DATA, WAIT_COMMAND, WAIT_OPTION, WAIT_SB_OPTION, WAIT_COM_PORT_OPTION, WAIT_SET_BAUDRATE_VALUE, WAIT_NOTIFY_MODEMSTATE_VALUE, CLEAR_ERROR` → RFC 2217 (COM-PORT-OPTION 44) istemcisi; IAC komutları, SB SET-BAUDRATE yanıtı ve NOTIFY-MODEMSTATE yutulur, `FF FF` → `FF` [Inferred; FSM gövdesi decompile edilmedi].
  - `setBaudRate @0x004864da` (bağlıyken) 13 baytlık şablon gönderir (`@0x010a0e3c`): `FF FB 2C  FF FA 2C 01 <baud u32 BE> FF F0` = IAC WILL COM-PORT-OPTION; IAC SB COM-PORT-OPTION SET-BAUDRATE baud IAC SE. İzinli baud: 4800, 9600, 19200, 38400, 57600, 115200; diğerleri 19200'e düşer. [Observed]
- hub4com: `MyApp::OnExit` "m_hub4comPID: %d, killed: %d" → VemsTune harici `hub4com` sürecini başlatıp kapatıyor (yerel COM ↔ TCP köprüsü) [Inferred]; komut satırı [Unknown].
- `MulticastManager` (wxSocket, `TriggerFrameEx` yayını) ayrı bir özellik; ECU hattı değil. [Observed sembol]
- Emülatör için: TCP sunucu (varsayılan 9000) SIPR akışını aynen taşımalı; veri içindeki `0xFF` baytlarını **ikilemeli**, gelen `FF FF`'yi teke indirmeli ve `FF FB 2C`/`FF FA 2C 01 … FF F0` dizilerini yutmalı (isteğe bağlı RFC 2217 yanıtı `FF FA 2C 65 <baud> FF F0`). [Inferred]

### 5. Açık noktalar [Unknown]
- AIM yayın baud'u, kayıt periyodu; `AIMParser` ve AIM gönderim yolunun gerçek tetikleyicisi.
- `ModbusUtil::calculateLRC` gövdesi; tip 0x94 sayaç bayt sırası.
- `mdx` komut satırı sonlandırıcısı ve adres listesi kaynağı.
- `ReducedTelnetFsm::read`, `TcpPortScanner::*`, hub4com komut satırı — decompile edilmedi; useTelnet=0 iken IAC kaçışının yine uygulanıp uygulanmadığı (SendString'de koşul görülmedi).
