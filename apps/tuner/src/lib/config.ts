import {
  firmwareDefines,
  optionsFromString,
  type FirmwareDetails,
  loadConfig,
  parseConfigCriteria,
  parseSiprSection,
  pickLayoutVersion,
  keysOf,
  parseVemsCfg,
  pickDefaultConfig,
  type VemsCfgFile,
  type ChannelDb,
  type ConfigCriteria,
  type FwLayout,
  type SiprDescriptor,
  type VemsConfig,
} from '@vems/core';

const MAIN = 'vemsTune-v3-1.2.34.ini';
// The condition table VemsTune builds (MTConfigHelper::parseMTConfigData @0x6cc3d4):
// USE_SUPER_TABLE is always set, v3gui.cfg [sessions/params] defaults to CELSIUS=1
// (NARROW_BAND_EGO=0, USEAFR147=0), and the INI's own [Params] adds USE_RAW_LAMBDA_TABLE.
const DEFINES = ['USE_SUPER_TABLE', 'CELSIUS', 'USE_RAW_LAMBDA_TABLE'];

/** Fetch the main INI and all transitive #includes from /config (breadth-first). */
async function fetchIniFiles(mainFile: string): Promise<Map<string, string>> {
  const base = `${import.meta.env.BASE_URL}config/`;
  const cache = new Map<string, string>();
  const queue = [mainFile];
  const seen = new Set<string>();
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    try {
      const res = await fetch(base + f);
      if (!res.ok) continue;
      const text = await res.text();
      cache.set(f, text);
      for (const m of text.matchAll(/#\s*include\s+"([^"]+)"/g)) queue.push(m[1]!);
    } catch {
      /* missing include */
    }
  }
  return cache;
}

/** Base condition table plus the defines detected from the connected firmware. */
export function definesFor(details?: FirmwareDetails): Set<string> {
  const fw = details ? firmwareDefines({ signature: details.mtCodeVer, options: optionsFromString(details.signature) }) : [];
  return new Set([...DEFINES, ...fw]);
}

/** Run the synchronous loadConfig with a map-backed include resolver. */
export async function loadVemsConfig(mainFile = MAIN, defines = new Set(DEFINES)): Promise<VemsConfig> {
  const cache = await fetchIniFiles(mainFile);
  return loadConfig(cache.get(mainFile) ?? '', mainFile, {
    defines,
    resolveInclude: (p) => cache.get(p),
  });
}

/** ConfigCriteria.xml — the sanity-check rule set VemsTune ships (VAL-01). */
export async function loadCriteria(): Promise<ConfigCriteria> {
  const res = await fetch(`${import.meta.env.BASE_URL}config/ConfigCriteria.xml`);
  if (!res.ok) throw new Error(`ConfigCriteria.xml: HTTP ${res.status}`);
  return parseConfigCriteria(await res.text());
}

/** A file from VemsTune's defaultfirmwareconfigs/ (shipped under public/config). */
async function loadDefaultFile(name: string): Promise<VemsCfgFile | undefined> {
  const res = await fetch(`${import.meta.env.BASE_URL}config/defaultfirmwareconfigs/${name}`);
  return res.ok ? parseVemsCfg(await res.text()) : undefined;
}

/** Everything the upload-config migration needs for an ECU firmware version (FW-16/17). */
export async function loadMigrationData(ecuVersion: string) {
  const index: { v3: string[] } = await (await fetch(`${import.meta.env.BASE_URL}config/defaultfirmwareconfigs/index.json`)).json();
  const v = pickDefaultConfig(index.v3, ecuVersion);
  const [def, filter, calib] = await Promise.all([
    v ? loadDefaultFile(`config_${v}.vemscfg`) : Promise.resolve(undefined),
    loadDefaultFile('v3_configfilter.vemscfg'),
    loadDefaultFile('calibrations.vemscfg'),
  ]);
  return {
    defaults: v && def ? { version: v, file: def } : undefined,
    filterKeys: filter ? keysOf(filter) : [],
    calibrationKeys: calib ? keysOf(calib) : [],
  };
}

/** Output-channel metadata exported from VemsTune's outputchannels.s3db. */
export async function loadChannelDb(): Promise<ChannelDb> {
  return (await fetch(`${import.meta.env.BASE_URL}config/outputchannels.json`)).json();
}

/** global.h layout VemsTune would use for `firmware` (newest fw_desc not newer than it). */
export async function loadFwLayout(firmware: string): Promise<FwLayout | undefined> {
  const base = `${import.meta.env.BASE_URL}config/fw_layout/`;
  const versions: string[] = await (await fetch(base + 'index.json')).json();
  const ver = pickLayoutVersion(versions, firmware);
  return ver ? (await fetch(`${base}${ver}.json`)).json() : undefined;
}

/** [SIPR] descriptor (page → SIPR tables) from whichever file of the INI set defines it. */
export async function loadSiprDescriptor(mainFile = MAIN, defines = new Set(DEFINES)): Promise<SiprDescriptor> {
  const cache = await fetchIniFiles(mainFile);
  const text = [...cache.values()].filter((t) => /^\s*\[SIPR\]/im.test(t)).join('\n');
  return parseSiprSection(text, defines);
}
