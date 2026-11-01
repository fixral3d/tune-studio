/** SIPR packet type codes — from SiprTypesHelper::getTypeAsString @0x00bbb50c. */
export const SiprType = {
  NACK: 0x00,
  ACK: 0x01,
  GET_VERSION: 0x02,
  SET_BAUD: 0x03,
  GET_TABLE_SIZE: 0x04,
  GET_TABLEDATA: 0x05,
  SET_TABLEDATA: 0x06,
  READ_SENSORS: 0x07,
  GET_HWSIG: 0x08,
  ENTER_FLASH: 0x09,
  SAVE_CONFIG: 0x0a,
  INVALID_DATA: 0x0b,
  ENTER_MEGATUNE: 0x0c,
  GET_CONFIG_1: 0x0d,
  GET_CONFIG_2: 0x0e,
  GET_COMPILE_TIME: 0x0f,
  GET_MT_SIGNATURE: 0x10,
  READ_MEMORY: 0x3f,
  WRITE_MEMORY: 0x40,
  READ_MEMORY_32: 0x41,
  WRITE_MEMORY_32: 0x42,
  READ_STORAGE_32: 0x43,
  WRITE_STORAGE_32: 0x44,
  PULSE_TRAIN: 0x80,
  SD_LOG_START: 0x81,
  SD_LOG_STOP: 0x82,
  SD_EMPTY: 0x84,
  SD_NOT_EMPTY: 0x85,
  SD_TIMEOUT: 0x86,
  SD_CRC_ERROR: 0x87,
  SD_LOG_NEXT_BLOCK: 0x88,
  SYNC_STARTED: 0x89,
  SYNC_FINISHED: 0x8a,
  SYNC_PAGE: 0x8b,
  CONFIG_LINE: 0x8c,
  CONFIG_ERROR: 0x8d,
  CONFIG_END: 0x8e,
  TABLES_END: 0x8f,
  TIMEOUT: 0x90,
  AIM: 0x91,
  LOG_MARKER: 0x92,
  RT_TIME: 0x93,
  UPDATE_FREQUENCY: 0x94,
  MDX_FRAMES_END: 0x95,
  RT_CRC_ERROR: 0x96,
  EEPROM_DATA: 0xa0,
  EEPROM_DATA_ADDR16: 0xa1,
  MODBUS_READ: 0xc8,
  RESERVED: 0xff,
} as const;

export type SiprTypeName = keyof typeof SiprType;

const byCode = new Map<number, SiprTypeName>(
  Object.entries(SiprType).map(([k, v]) => [v, k as SiprTypeName]),
);

export function siprTypeName(code: number): string {
  return byCode.get(code) ?? 'INVALID';
}
