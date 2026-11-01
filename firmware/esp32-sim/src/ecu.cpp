#include "ecu.h"
#include <LittleFS.h>
#include "seed_pages.h"

static const char *DET_COMPILATION = "2011-11-24 15:15";
static const char *DET_SIGNATURE = "VEMS Genboard v3, 1.2.34";
static const char *DET_MTCODEVER = "VEMS v1.2.34 16x14 kpa=2,1";

void Ecu::begin(void (*write)(const uint8_t *, size_t)) {
  write_ = write;
  startMs_ = millis();
  fw = (FwPage *)ps_calloc(FW_PAGES, sizeof(FwPage));
  loadPages();
  loadFirmware();
}

void Ecu::resetPagesToSeed() {
  memset(pages, 0, sizeof(pages));
  for (int i = 0; i < SEED_PAGE_COUNT; i++) {
    const SeedPage &s = SEED_PAGES[i];
    if (s.ecuId < ECU_PAGES) memcpy(pages[s.ecuId], s.data, min<int>(s.len, PAGE_SIZE));
  }
  memset(eeprom, 0, sizeof(eeprom));
}

void Ecu::loadPages() {
  File f = LittleFS.open("/pages.bin", "r");
  uint32_t hash = 0;
  if (f && f.size() == sizeof(pages) + sizeof(eeprom) + 1 + 4) {
    f.read((uint8_t *)pages, sizeof(pages));
    f.read(eeprom, sizeof(eeprom));
    uint8_t bt;
    f.read(&bt, 1);
    bootType = (bt == 'u') ? 'u' : 'n';
    f.read((uint8_t *)&hash, 4);
  }
  if (hash != SEED_HASH) resetPagesToSeed();  // missing, old format, or burned with an older seed
  if (f) f.close();
  dirty = false;
}

/** Burn: RAM pages → flash. */
void Ecu::savePages() {
  File f = LittleFS.open("/pages.bin", "w");
  if (!f) return;
  f.write((uint8_t *)pages, sizeof(pages));
  f.write(eeprom, sizeof(eeprom));
  f.write((uint8_t)bootType);
  uint32_t hash = SEED_HASH;
  f.write((uint8_t *)&hash, 4);
  f.close();
  dirty = false;
}

int Ecu::fwPageCount() const {
  int n = 0;
  if (fw)
    for (int i = 0; i < FW_PAGES; i++) n += fw[i].state != 0;
  return n;
}

void Ecu::saveFirmware() {
  if (!fw) return;
  File f = LittleFS.open("/firmware.bin", "w");
  if (!f) return;
  f.write((uint8_t *)fw, FW_PAGES * sizeof(FwPage));
  f.close();
}

void Ecu::loadFirmware() {
  if (!fw) return;
  File f = LittleFS.open("/firmware.bin", "r");
  if (f && f.size() == FW_PAGES * sizeof(FwPage)) f.read((uint8_t *)fw, FW_PAGES * sizeof(FwPage));
  if (f) f.close();
}

void Ecu::sendRaw(const uint8_t *d, size_t n) {
  if (write_) write_(d, n);
}

void Ecu::send(const uint8_t *body, size_t n) {
  static uint8_t out[700];
  size_t len = TfWriter::encode(body, n, out, sizeof(out));
  sendRaw(out, len);
  if (trace && body[n - 1] != 0x20 && !triggerOn) {
    char t[48];
    snprintf(t, sizeof t, "%lu TX %02X body=%u wire=%u", (unsigned long)millis(), body[n - 1], (unsigned)n, (unsigned)len);
    trace(t);
  }
  framesTx++;
}

void Ecu::onBytes(const uint8_t *d, size_t n) {
  lastRxMs = millis();
  for (size_t i = 0; i < n; i++) {
    if (inBoot) {
      bootByte(d[i]);
      continue;
    }
    if (!parser_.feed(d[i])) continue;
    framesRx++;
    if (!parser_.crcOk()) {
      if (trace) {
        char t[120];
        int k = snprintf(t, sizeof t, "%lu RX badCRC len=%u:", (unsigned long)millis(), (unsigned)parser_.len());
        for (size_t j = 0; j < parser_.len() && j < 24 && k < 110; j++) k += snprintf(t + k, sizeof t - k, " %02X", parser_.body()[j]);
        trace(t);
      }
      // detection probe "Smxc." FF 7E has a bad CRC → CRC-error reply
      const uint8_t r[] = {0x02, 0x7f};
      send(r, sizeof r);
      continue;
    }
    handle(parser_.body(), parser_.len());
  }
}

void Ecu::handle(const uint8_t *b, size_t n) {
  uint8_t type = b[n - 1];
  if (trace && type != 0xa0) {
    char t[96];
    int k = snprintf(t, sizeof t, "%lu RX", (unsigned long)millis());
    for (size_t i = 0; i < n && i < 8 && k < 80; i++) k += snprintf(t + k, sizeof t - k, " %02X", b[i]);
    trace(t);
  }
  static uint8_t out[600];
  switch (type) {
    case 0xf2: {  // details [sub] F2 → text [sub] 72
      uint8_t sub = n >= 2 ? b[n - 2] : 0;
      String t;
      if (sub == 2) t = DET_COMPILATION;
      else if (sub == 3) t = serialNumber();
      else if (sub == 4) t = DET_SIGNATURE;
      else if (sub == 5) t = DET_MTCODEVER;
      else {
        const uint8_t r[] = {0x02, 0x04, 0x7f};  // ECU_DETAILS | BAD_SUBTYPE
        return send(r, sizeof r);
      }
      size_t k = t.length();
      memcpy(out, t.c_str(), k);
      out[k] = sub;
      out[k + 1] = 0x72;
      return send(out, k + 2);
    }
    case 0xa0: {  // realtime → rt 20, byte0 = secl
      memcpy(out, rt, RT_SIZE);
      out[0] = ((millis() - startMs_) / 1000) & 0xff;
      out[RT_SIZE] = 0x20;
      return send(out, RT_SIZE + 1);
    }
    case 0xf4: {  // [FF][ecuId] F4 → data [FF][ecuId] 74
      uint8_t id = n >= 2 ? b[1] : 0;
      // 255 bytes like the verified emu-cli pages (a 256-byte answer makes VemsTune drop the connection)
      size_t k = id < ECU_PAGES ? PAGE_SIZE - 1 : 0;
      if (k) memcpy(out, pages[id], k);
      out[k] = 0xff;
      out[k + 1] = id;
      out[k + 2] = 0x74;
      return send(out, k + 3);
    }
    case 0xf5: {  // EEPROM [idx] F5 → data [idx] 75
      memcpy(out, eeprom, 64);
      out[64] = b[0];
      out[65] = 0x75;
      return send(out, 66);
    }
    case 0xfb: {  // write [value][offLo][addrHi][addrLo] FB → 00 00 7B
      if (n >= 5) {
        uint8_t value = b[0], offLo = b[1], addrHi = b[2], id = b[3];
        int offset = (addrHi & 0x80) == 0 ? offLo + 0x100 : offLo;
        if (id < ECU_PAGES && offset < PAGE_SIZE && pages[id][offset] != value) {
          pages[id][offset] = value;
          dirty = true;
        }
        writes++;
      }
      const uint8_t r[] = {0x00, 0x00, 0x7b};
      return send(r, sizeof r);
    }
    case 0xef: {  // burn 04 EF / poll 03 EF → 01 00 6F
      // answer first; the flash write happens in tick() (it can take >1 s while the RGB panel scans PSRAM)
      if (n >= 2 && b[0] == 0x04) burnPending_ = true, burns++;
      const uint8_t r[] = {0x01, 0x00, 0x6f};
      return send(r, sizeof r);
    }
    case 0xf7: {  // TEST_TOOLS [param][sub] F7
      uint8_t param = b[0], sub = n >= 3 ? b[1] : 0;
      if (sub < 8) testTools[sub] = param;
      if (sub == 3 && param == 0x40) {  // trigger log on: stream instead of answering
        triggerOn = true;
        trigTick_ = trigNext_ = 0;
        trigPos_ = 0;
        trigLastMs_ = millis();
        return;
      }
      if (sub == 3) triggerOn = false;
      const uint8_t r[] = {param, sub, 0x77};
      return send(r, sizeof r);
    }
    case 0xf6:  // GO_BOOTLOADER: no answer
      inBoot = true;
      cmdLen_ = 0;
      return;
    case 0xfc: {  // change baud [ubrr] FC → [ubrr] 00 7C (USB CDC ignores the baud rate)
      const uint8_t r[] = {b[0], 0x00, 0x7c};
      return send(r, sizeof r);
    }
    default: {
      const uint8_t r[] = {0x01, 0x7f};  // UNKNOWN_COMMAND
      return send(r, sizeof r);
    }
  }
}

// ---------------------------------------------------------------- trigger log (PROTOCOL §7.4)

static size_t triggerFrame(uint8_t type, const uint16_t *prim, int k, int event, uint8_t *body) {
  size_t n = 0;
  for (int i = 0; i < k; i++) body[n++] = prim[i] >> 8, body[n++] = prim[i] & 0xff;
  if (type != 0x01) body[n++] = (event >> 8) & 0xff, body[n++] = event & 0xff;
  body[n++] = type;
  return n;
}

void Ecu::tick() {
  if (burnPending_) {
    burnPending_ = false;
    savePages();
  }
  if (triggerOn && millis() - trigLastMs_ >= 20) triggerStep();
}

void Ecu::triggerStep() {
  uint32_t now = millis();
  trigTick_ += (now - trigLastMs_) * 250.0;  // 4 µs ticks
  trigLastMs_ = now;
  uint16_t prim[64];
  int k = 0;
  uint8_t body[200];
  auto flush = [&]() {
    if (k) send(body, triggerFrame(0x01, prim, k, 0, body)), k = 0;
  };
  const int teeth = wheel.teeth;
  while (trigNext_ <= trigTick_) {
    float rpm = max(60.0f, triggerRpm);
    double period = (60.0 / rpm / teeth) * 250000.0;
    int tooth = trigPos_ % teeth;
    uint16_t at = (uint32_t)llround(trigNext_) & 0xffff;
    if (tooth < teeth - wheel.missing) {
      prim[k++] = at;
      if (k == 60) flush();
    }
    bool cam = trigPos_ == teeth + wheel.secondaryTooth;
    int sparkEvery = wheel.sparksPerRev ? (teeth + wheel.sparksPerRev / 2) / wheel.sparksPerRev : 0;
    bool spark = sparkEvery && tooth % sparkEvery == 0;
    if (cam || spark) {
      flush();
      uint8_t eb[8];
      if (cam) send(eb, triggerFrame(0x02, nullptr, 0, at, eb));
      if (spark) send(eb, triggerFrame(0x08, nullptr, 0, at, eb));
    }
    trigPos_ = (trigPos_ + 1) % (2 * teeth);
    trigNext_ += period;
  }
  flush();
}

// ---------------------------------------------------------------- bootloader (BOOTLOADER.md §7)

static uint32_t pageChecksum(const uint8_t *d, int len, uint16_t wordAddress) {
  uint16_t hi = wordAddress, lo = wordAddress;
  for (int i = 0; i < len; i += 2) {
    uint16_t w = d[i] | (d[i + 1] << 8);
    hi += w;
    lo ^= w;
  }
  return ((uint32_t)hi << 16) | lo;
}

void Ecu::bootByte(uint8_t b) {
  auto ack = [&]() {
    const uint8_t r = 0x0d;
    sendRaw(&r, 1);
  };
  auto be32 = [&](uint32_t v) {
    const uint8_t r[] = {(uint8_t)(v >> 24), (uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)v};
    sendRaw(r, 4);
  };
  if (cmdLen_ == 0) {
    switch (b) {
      case 'S': {
        String s = String("AVR3") + serialNumber();
        sendRaw((const uint8_t *)s.c_str(), s.length());
        return;
      }
      case 'e':
        if (fw) memset(fw, 0, FW_PAGES * sizeof(FwPage));
        return ack();
      case 'E':  // leave boot mode
        inBoot = false;
        parser_.reset();
        saveFirmware();
        return;
      case 'A':
      case 'D':
        cmd_[cmdLen_++] = b;
        return;
      default:
        return;  // probe leftovers
    }
  }
  if (cmdLen_ < sizeof(cmd_)) cmd_[cmdLen_++] = b;
  if (cmd_[0] == 'A') {
    if (cmdLen_ < 3) return;
    addr_ = (cmd_[1] << 8) | cmd_[2];
    cmdLen_ = 0;
    return ack();
  }
  if (cmdLen_ < 3) return;
  uint8_t o1 = cmd_[1], o2 = cmd_[2];
  bool crypto = o1 == 'c' || o1 == 'C';
  int page = crypto ? addr_ : (addr_ * 2) / FW_PAGE;
  if ((o1 == 'c' && o2 == 'c') || (o1 == 'k' && o2 == 'k')) {
    if (cmdLen_ < 3 + FW_PAGE + 4) return;
    const uint8_t *data = cmd_ + 3, *t = cmd_ + 3 + FW_PAGE;
    uint32_t tag = ((uint32_t)t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3];
    cmdLen_ = 0;
    if (!crypto && pageChecksum(data, FW_PAGE, addr_) != tag) {
      const uint8_t r = 'N';
      return sendRaw(&r, 1);
    }
    if (fw && page >= 0 && page < FW_PAGES) {
      memcpy(fw[page].data, data, FW_PAGE);
      fw[page].tag = tag;
      fw[page].state = crypto ? 2 : 1;
      fwPagesWritten++;
    }
    return ack();
  }
  if ((o1 == 'C' && o2 == 'C') || (o1 == 'l' && o2 == 'l')) {
    cmdLen_ = 0;
    if (fw && page >= 0 && page < FW_PAGES && fw[page].state == 2) return be32(fw[page].tag);
    static uint8_t blank[FW_PAGE];
    memset(blank, 0xff, sizeof blank);
    const uint8_t *data = (fw && page >= 0 && page < FW_PAGES && fw[page].state) ? fw[page].data : blank;
    return be32(pageChecksum(data, FW_PAGE, (page * FW_PAGE) / 2));
  }
  if (o1 == 0xde && o2 == 0xad) {  // 'D' DE AD BE EF: erase marker page
    if (cmdLen_ < 5) return;
    cmdLen_ = 0;
    if (fw) fw[0x1f7].state = 0;
    return ack();
  }
  cmdLen_ = 0;
}
