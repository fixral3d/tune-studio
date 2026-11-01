// Engine model filling the V3 realtime block — the C++ port of the demo engine in apps/tuner/src/lib/device.ts.
// Manual mode is driven from the touch screen (throttle, coolant, intake air, battery, key);
// auto mode runs the demo's Lissajous drive cycle over the whole VE table.
#pragma once
#include "ecu.h"

struct EngineInputs {
  bool autoDrive = false;
  bool key = true;          // ignition on / engine requested
  float throttle = 0;       // %
  float coolant = 85;       // °C
  float intake = 25;        // °C
  float battery = 14.1;     // V
};

struct EngineState {
  float rpm = 0, map = 101, tps = 0, lambda = 1, lambdaTarget = 1, veTable = 80, pw = 0;
  bool running = false, cranking = false;
  float o2 = 0;  // WBO2 free-air calibration reading (%)
};

class Engine {
 public:
  void update(Ecu &ecu, float dt);
  EngineInputs in;
  EngineState st;

 private:
  float t_ = 0, crankT_ = 0, heat_ = 0;
  bool wasKey_ = false;
};
