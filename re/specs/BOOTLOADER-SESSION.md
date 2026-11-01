# BOOTLOADER / SESSION / CRYPTO — VemsTune 1.5.46

Kapsam: Kullanıcı bir `.hex/.uhex/.chex/.chex2/.vhex` seçtikten sonra, şifrelenmiş
sayfalar ECU'ya gidene kadar olan **crypto / oturum anahtarı / parola / tür** mantığı.
Sayfa yükleme dalga/durum makinesinin kendisi (FirmwareUploader) başka bir spec'tedir.

Kanıt: `re/ghidra/out/*.c` decompile'ları (VA'lar belirtilmiş), `re/evidence/strings.txt`,
`re/target/vemstune-1.5.46/config/*`, kullanıcı dosyaları `Desktop/vems/`.
İşaretler: [Observed] decompile/dosyada doğrudan görüldü · [Inferred] çıkarım · [Unknown] bilinmiyor.

---

## 1. `FirmwareData::crypto(const wxString& key)` — VA 0x00A0A5EC [Observed]

Toplamsal (additive), zincirli bir **akış dönüşümü**. Kriptografik şifre DEĞİL; basit
byte toplama + checksum düzeltme.

Anahtar string'in ayrıştırılması:
- `key.Mid(0,4)` → `Math::hex2int` → 16-bit **seed** (`uStack_2a`). Checksum'a karışır.
- `key.Mid(4,4)` → `Math::hex2int` → 16-bit **cipher value** (`uStack_30`).
- `Math::getBytes(cipher, buf)` (VA 0xBF9346, big-endian) → anahtar byte dizisi `kb[]`
  (16-bit için 2 anlamlı byte; indeks `& 3` ile sarılır).

Her sayfa (order index ile), her byte için:
```
ki = prevByte & 3                 // ilk iterasyonda prevByte = (byte)pageIndex
kb_sel = kb[ki]
prevByte = data[off]              // mevcut (şifreli) byte saklanır — ZİNCİRLEME
data[off] = data[off] + kb_sel    // in-place toplama
```
→ Anahtar byte seçimi **bir önceki şifreli byte'a** bağlı (CFB benzeri zincir),
başlangıç tohumu sayfa index'inin düşük byte'ı. Anahtar efektif olarak sadece 2 byte
(`cipher` değeri), indeks `&3`.

Sayfa döngüsü sonunda checksum düzeltmesi:
```
cs = getPageCheckSum(page)
setPageCheckSum(page, cs ^ (seed << 16))   // sadece yüksek 16-bit XOR'lanır
```

**Anahtar boyutu:** min 8 hex hane (4 seed + 4 cipher) + opsiyonel kuyruk. Kaynak §4.
**Uygulama tarafı mı?** Evet, host'ta (VemsTune içinde) çalışır. ANCAK yalnız **VHEX**
yolunda çağrılır (§3). `.uhex/.chex/.chex2` firmware yüklemesinde `crypto` ÇAĞRILMAZ.

## 2. Sayfa başına 32-bit TAG = checksum (MAC değil) [Observed]

`FirmwareData::getPageCheckSum` — VA 0x00A09F2E:
- Cihaz tipi V3 (`+0x54`==1): yüksek word = `pageAddressW` (sayfa adresi >> ...),
  tip 3 ise `page<<16`. Round (tip 2): checksum ayrı hash tablosundan okunur (`+0x44`).
- 16-bit word'ler üzerinde: `hi += word` (toplam), `lo ^= word` (XOR), başlangıç her
  ikisi = `addrW`. Sonuç 32-bit = `CONCAT(addr+Σwords, addr^⊕words)`.

`FirmwareData::checkPageCheckSum` — VA 0x00A0A48C: Round'da sadece yüksek word karşılaştırılır;
diğerinde tam 32-bit.

**TAG düz-metin (plaintext) checksum'ı.** Kanıt: kullanıcının `vems_uhex_eslestirilmis.txt`
dosyasında DÜZ hex sayfalarının başındaki TAG'ler (`4359870E`, `4359878E`, `9ACB2D66`,
`F5DF348D`) `.uhex`'teki C: sayfalarının TAG'leriyle BİREBİR aynı. İki ardışık boş sayfa
(0x20000 / 0x30000, ikisi de FF ile başlıyor) → TAG'ler yalnız adres terimiyle farklı
(`...870E` vs `...878E`) → checksum sayfa-adres tohumlu sum+xor, kriptografik MAC değil.
**Ampirik düzeltme (2026-11-01, Desktop `vems.hex`↔`vems.uhex`, 392 sayfa):** `.uhex` TAG'inin
**alt 16 biti** = `addrW ^ ⊕(LE word'ler)` (addrW = bayt adresi/2) → **392/392 tuttu**. **Üst 16 bit
tutmadı**: ne `addrW + Σword` ne adressiz toplam ne de yaygın CRC16 (MODBUS/CCITT/XMODEM, düz ya da
şifreli veri üzerinde). Üst word adresten bağımsız (aynı içerikli 0x200/0x300 sayfalarında aynı `4359`) →
büyük olasılıkla anahtara bağlı bir değer. Host düz `.hex` için tam 32-bit'i hesaplayabilir; `.uhex` için
TAG'i dosyadan alır. Emülatör üst word'ü hesaplayamaz → yüklenen TAG'i saklayıp geri döndürmeli. [Observed]
Host hesaplar; ECU'dan dönen checksum ile `FirmwareVerifier::sendGetChecksumCmd/waitChecksum`
üzerinden karşılaştırılır.

## 3. Üç yükleme yolu — crypto/oturum ne zaman devreye girer? [Observed]

`FirmwareDirector::uploadFirmware` (VA 0x005C016C) ve `verifyFirmware` (VA 0x005BED82)
`FirmwareInfo::getBootType` ile dallanır (BootType = BAĞLI ECU'nun bootloader tipi):

| BootType | Uzantı | Akış | crypto? | Oturum? |
|---|---|---|---|---|
| 1 CHEX / 2 CHEX2 / 3 UHEX | .chex/.chex2/.uhex | Dosyayı IHexParser ile ayrıştır → sayfaları OLDUĞU GİBİ yükle + `markerword_erase.*` yükle | **HAYIR** | **HAYIR** |
| 6 VHEX | .vhex | `connectVhexUploadEventHandlers` + `generateSessionKey()` → oturum → `crypto()` → yükle/verify | **EVET** | **EVET** |
| 0 HEX | .hex | Düz, olduğu gibi | Hayır | Hayır |

→ **Kritik:** `generateSessionKey`/`crypto` SADECE `bootType==6` (VHEX) için çağrılır
(`uploadFirmware` satır içi `if (getBootType()==6)`, `verifyFirmware` aynı). Yani sıradan
`.uhex` firmware yüklemesi oturum anahtarı GEREKTİRMEZ; şifreli sayfalar olduğu gibi gider,
şifre çözme ECU bootloader'ında yapılır.

`.uhex/.chex/.chex2` için `uploadFirmware`, BootType'a göre uygun `config/fw/markerword_erase.{uhex,chex,chex2}`
dosyasını da ayrıştırıp yükler (uygulama geçerliliğini bozup/ayarlayıp marker page yazma).

## 4. Oturum anahtarı — kaynaklar

### 4a. VHEX yolu (FirmwareDirector) [Observed]
- `generateSessionKey` (VA 0x005C5300): `DeviceModeSelectorHelper` oluşturup
  `changeDeviceModeTo(0x0B)` çağırır → ECU'yu "oturum üret" moduna sokar (ECU ile konuşma).
- `OnGenerateSession` (VA 0x005C558E): gelen `GeneralEvent` string'i `"RESULT_OK"` değilse
  `OnCommunicationError`. Değilse variant hash'ten:
  - `session_id` (string)
  - `checksum` (string, 4 hex hane)
  - **Anahtar string** = `checksum.Mid(2,2) + checksum.Mid(0,2)` (iki byte swap) `+ session_id`.
    → crypto'da `Mid(0,4)` = swap'lanmış checksum = seed, `Mid(4,4)` = session_id'nin ilk 4 hanesi = cipher.
  - `FirmwareData::crypto(firmwareData, key)` → sonra `+0x68` (upload bayrağı) set ise
    `startUploadFirmware`, değilse `startVerifyFirmware`.

### 4b. Bootloader upgrade yolu (SessionPage / FW-13) [Observed]
`SessionPage::OnGenerateSessionSucceeded` (VA 0x00C2EABE) variant hash'ten:
`session`, `sessionhex`, `locked` (double), `serial` okur.
- **Kilitli** sayılır: `locked != 0` **VE** `session` "0" ile BAŞLAMIYOR → `OnEcuLocked`.
  Aksi halde `OnEcuUnlocked`.
- `OnEcuLocked` (VA 0x00C2F3D2): `sessionstr`+`sessionhex` ile
  `BootloaderWebUpdater::Request(...)` → sunucu (bkz §7) şifreli bootloader döndürür.
- `OnEcuUnlocked` (VA 0x00C2F5C6): `getPassword()` ile `password_upgrade.txt`'den parola
  bulmaya çalışır. **Parola yoksa** (`getPassword==0`): hiçbir şey göndermeden "Click Finish"
  ile biter (indirme yok). **Parola varsa**: `sessionstr`+`password`+`sessionhex` ile
  `BootloaderWebUpdater::Request`.
- `getPassword` (VA 0x00C337E6): `password_upgrade.txt`'yi `serial=parola` olarak ayrıştırır
  (`;`/`#` yorum, `=` ile 2 token). Kurulumdaki `password_upgrade.txt` BOŞ.
- `OnVerifySession` (VA 0x00C31C0C): sunucudan dönen `session`, yerel `+0x1C0` ile ve
  indirilen dosyanın ilk satırının `#` sonrası ile karşılaştırılır → eşleşmezse fail.
- `OnWebUpdater` (VA 0x00C3047C): `GeneralEvent::GetLong`==0 → download OK, 1 → fail, diğer → bad response.

## 5. BootLoaderUpgradeClient — kablo komutları (FW-13) [Observed]

ECU bootloader ile ASCII komutlar, `TxData` ile gönderilir, `CommunicationTimer` zaman aşımı.
Durum alanı `+0x5C`, sonuç `+0x60`.

| Komut | Gönderilen | Yanıt / işlem | VA |
|---|---|---|---|
| **DzP** | `"DzP"` | `waitDZP`: `\r`(0x0D)→sonuç 0, `\n`(0x0A)→sonuç 1; timeout(100ms)→hata | send 0xE422C0 / wait 0xE4240C |
| **Mx2** | `"mcw"` | gönder sonra `waitMx2` → `BootStateDetector` başlatır (boot/marker durumu tespiti) | send 0xE42478 / wait 0xE425C8 |
| **Sk** | `"sK"` | `waitSk`: `LengthRecognizer::feed` ile SABİT uzunlukta oturum yanıtı okunur; timeout(1000ms)+retry | send 0xE426B0 / wait 0xE4287C |

- `getSessionString` (VA 0x00E42EF8): yanıt içinde geçerli seri varsa tüm `TxData` string'i;
  yoksa yanıt byte'ları **[0x0C .. 0x19)** (offset 12..24, 13 byte) `%c` ile birleştirilip
  oturum string'i döner.
- `isSerialValid` (VA 0x00E42CB0): ilk 12 yazdırılabilir byte'ı alıp regex
  `(\w{1}\d{1}\.\d{1}_\w{1}\d{6})` ile eşleştirir → VEMS seri formatı (ör. `V3.3_X123456`).
- Akış: DzP (hazırlık/mod) → mcw (marker/boot state) → sK (session string al) → web isteği.

## 6. Parola / "magic" sistemi (CONN-11) [Observed]

`config/password.txt`: `{6 haneli seri}={8 hex hane parola}` (örn. `000123=A82F1234`),
`;`/`#` yorum. Örnek: `password-example.txt`. `password_upgrade.txt` bootloader için (boş).

- `PasswordHelper::checkPassword` (VA 0x00BADFC0): `password.txt`'de seriyi bulur, 8-hex
  parolayı `hex2int` ile 32-bit alır, `isPasswordAccepted` ile doğrular, sonra
  `resolveMagic` ile 16-bit "magic" türetir ve `"%04X"` olarak döndürür.
- `PasswordHelper::resolveMagic` (VA 0x00BAE7A0): 32-bit parolanın **çift indeksli bitlerini**
  (bit 0,2,4,…,30) alıp sırayla 16-bit'e paketler. → ECU'ya kilit açmak için gönderilen değer.
- `PasswordHelper::checkMagic` (VA 0x00BAE714): geçerlilik testi — her i için
  `bit[2i] == bit[31-2i]` olmalı (parola simetrisi).
- Kabloda: `PasswordChecker` (sendP/sendPw, VA 0xE27F80/0xE28460) ve
  `TriggerLogReader::checkPassword/sendPassword`. "ECU kilitli" = parola/magic verilmeden
  tam erişim/upgrade yok.

## 7. Web sunucuları [Observed]

- `config/v3update.ini`:
  - `bootloader=http://svn.x-dsl.hu/cgi-bin/v3update/bootloaderupgrade.php`
  - `firmware=` (BOŞ — firmware indirme URL'si çalışma anında/başka yerden; web tool
    `http://vems.hu/vt`, `fwupdate.php?cmd=gethex|list` [Inferred]).
- Sunucu dönüş kodları (`strings.txt`): `FWU_OK, FWU_CRYPTING_FAIL, FWU_CRYPTO_BIN_NOTFOUND,
  FWU_BADSESSIONSTRING, FWU_VEMSHEX_NOTFOUND, FWU_CANT_OPEN_ZIP, …` ve
  `BLU_OK, BLU_ECU_NOT_LOCKED, BLU_CRYPT_FAILED, BLU_BAD_SESSION_FORMAT, BLU_UPGRADE_NOT_NEED, …`
  → Şifreleme sunucuda (perl/crypto binary) oturum string'ine göre yapılıyor; `BLU_ECU_NOT_LOCKED`
  bootloader upgrade'in ECU **kilitli** olmasını gerektirdiğini gösterir (kötüye kullanım önleme).

## 8. ECU "locked / unlocked" anlamı [Observed/Inferred]

- `locked` değeri ECU oturum yanıtından gelir (`OnGenerateSessionSucceeded`). "Locked",
  ECU'nun parola korumalı olduğu; web tabanlı firmware/bootloader indirmede sunucunun
  şifreleme yapması için ECU'nun kilitli + geçerli oturum string'i vermesi beklenir.
- Yerel `.uhex` upload (§3) locked/unlocked'tan ETKİLENMEZ — oturum kullanılmaz.

## 9. Emülatör için gereken "kabul" davranışı (gerçek VemsTune'u yüklemeye ikna) [Inferred]

Gerçek şifre çözme uygulamadan, VemsTune'un **basit `.uhex` upload** akışını geçirmek için:
1. ECU'yu boot mode'da tanıt (BootStateDetector / FirmwareInfo → BootType = **UHEX(3)**,
   "universal bootloader"). Böylece crypto/oturum YOLU DEVRE DIŞI kalır (§3).
2. FirmwareUploader kablo akışı: erase pages, page address OK, send page OK,
   `getChecksum` komutuna sayfanın TAG'i (host'un `getPageCheckSum` ile aynı değeri)
   ile cevap ver → verify geçer. (TAG hesabı §2; düz-metin sum+xor, adres tohumlu.)
3. Marker page (0x1F700, `5A A5` @0x1F7FE) yazımını ve `markerword_erase.uhex` sayfasını kabul et.
4. Oturum/parola istenmez (unlocked ECU). VHEX veya web wizard denenirse §4–7 gerekir.

VHEX/bootloader-upgrade emülasyonu istenirse: §5 komutlarına (DzP→`\r`/`\n`, mcw→boot state,
sK→12..24 byte oturum string'i, isteğe göre geçerli seri regex'i) ve §4b oturum alanlarına
(`session`, `sessionhex`, `locked=0`, geçerli `serial`) uygun cevap üretmek gerekir.

## 10. Açık [Unknown] maddeler

- `DeviceModeSelectorHelper::changeDeviceModeTo(0x0B)`'nin ECU'ya gönderdiği tam kablo baytları
  ve ECU'nun `session_id`/`checksum`'u hangi mesajla döndürdüğü (VHEX oturumu). [Unknown]
- `.uhex` içeriğinin kendisinin ÜRETİMİNDEKİ şifreleme (cihaz-ailesi anahtarı) — host'ta
  çözülmediği için incelenmedi/kırılmadı (görev kuralı). `crypto()` sadece VHEX re-key'i. [Unknown]
- Firmware indirme (`fwupdate.php`) tam URL + parametre adları (`cmd`, session, serial). [Unknown]
- `Math::hex2int` dosyası `out/` içinde yok (satır içi); davranışı aşikâr (hex→int). [Inferred]
- `.shex/.lhex` gerçek düzenleri ve BootType eşlemesi (örnek yok). [Unknown]

---

### İlgili VA özeti
`FirmwareData::crypto` 0xA0A5EC · `getPageCheckSum` 0xA09F2E · `checkPageCheckSum` 0xA0A48C ·
`setPageCheckSum` (0x16BE60E sym) · `Math::getBytes` 0xBF9346 ·
`FirmwareDirector::{generateSessionKey 0x5C5300, OnGenerateSession 0x5C558E, uploadFirmware 0x5C016C,
verifyFirmware 0x5BED82, startUploadFirmware 0x5C28F2, getHexFile 0x5C1CEE, OnSelectBootMode 0x5C53F6}` ·
`SessionPage::{OnGenerateSessionSucceeded 0xC2EABE, OnEcuLocked 0xC2F3D2, OnEcuUnlocked 0xC2F5C6,
OnVerifySession 0xC31C0C, getPassword 0xC337E6, OnWebUpdater 0xC3047C, OnBootLoaderDownloadSucceeded 0xC30B2E}` ·
`BootLoaderUpgradeClient::{sendDZP 0xE422C0, waitDZP 0xE4240C, sendMx2 0xE42478, waitMx2 0xE425C8,
sendSk 0xE426B0, waitSk 0xE4287C, getSessionString 0xE42EF8, isSerialValid 0xE42CB0}` ·
`PasswordHelper::{checkPassword 0xBADFC0, resolveMagic 0xBAE7A0, checkMagic 0xBAE714}`
