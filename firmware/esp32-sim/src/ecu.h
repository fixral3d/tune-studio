// V3 ECU emulation: the TriggerFrame message set of packages/core/src/emulator/ecu.ts plus the raw-byte
// V3 bootloader of packages/core/src/emulator/bootloader.ts, with pages/firmware kept in flash.
#pragma once
#include <Arduino.h>
#include "tf.h"

static const int ECU_PAGES = 18;     // ecuId 0..17
static const int PAGE_SIZE = 256;
static const int RT_SIZE = 80;
static const int FW_PAGE = 256;      // bootloader flash page (bytes)
static const int FW_PAGES = 512;     // 128 KB application area

struct TriggerWheel {
  uint8_t teeth = 36, missing = 1, secondaryTooth = 5, sparksPerRev = 2;
};

struct FwPage {
  uint32_t tag;
  uint8_t state;  // 0 empty, 1 plain, 2 crypto
  uint8_t data[FW_PAGE];
};

class Ecu {
 public:
  /** `write` sends bytes to the host (must not block). */
  void begin(void (*write)(const uint8_t *, size_t));
  /** Feed bytes received from the host. */
  void onBytes(const uint8_t *d, size_t n);
  /** Call often: trigger-log streaming (every 20 ms). */
  void tick();

  uint8_t pages[ECU_PAGES][PAGE_SIZE];
  uint8_t eeprom[64];
  uint8_t rt[RT_SIZE];
  /** last TEST_TOOLS param per sub (3 = ENA_FLAGS: 02/03 WBO2 cal, 40 trigger log) */
  uint8_t testTools[8] = {0};
  bool inBoot = false;
  bool triggerOn = false;
  float triggerRpm = 1500;  // set by the engine model
  TriggerWheel wheel;
  /** boot type letter in the serial number: 'n' = .hex, 'u' = .uhex (VemsTune picks the file type from it) */
  char bootType = 'n';
  String serialNumber() const { return String("v3.3_") + bootType + "001453"; }

  // statistics for the UI
  uint32_t framesRx = 0, framesTx = 0, writes = 0, burns = 0, fwPagesWritten = 0;
  uint32_t lastRxMs = 0;
  /** optional trace sink (debug CDC port) */
  void (*trace)(const char *) = nullptr;
  bool dirty = false;  // RAM differs from flash (unburned)

  /** firmware image (PSRAM) uploaded through the bootloader */
  FwPage *fw = nullptr;
  int fwPageCount() const;

  void loadPages();  // flash (LittleFS) or seed
  void savePages();
  void resetPagesToSeed();
  void saveFirmware();
  void loadFirmware();

 private:
  void handle(const uint8_t *b, size_t n);
  void send(const uint8_t *body, size_t n);
  void sendRaw(const uint8_t *d, size_t n);
  void bootByte(uint8_t b);
  void triggerStep();

  void (*write_)(const uint8_t *, size_t) = nullptr;
  TfParser parser_;
  uint32_t startMs_ = 0;
  // bootloader state
  uint16_t addr_ = 0;
  uint8_t cmd_[3 + FW_PAGE + 4];
  size_t cmdLen_ = 0;
  bool burnPending_ = false;
  // trigger log
  uint32_t trigLastMs_ = 0;
  double trigTick_ = 0, trigNext_ = 0;
  int trigPos_ = 0;
};
