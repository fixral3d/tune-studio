# VemsTune 1.5.46 — FEATURE CATALOG (Tamlık Kontrol Listesi)

> Amaç: VemsTune 1.5.46'nın (VEMS V3 / Round / AIM / ARM ECU tuning yazılımı, C++/wxWidgets 2.8.12, MinGW) **her ekranını, aracını, diyaloğunu, editörünü, gauge tipini, sihirbazını, log/analiz özelliğini, iletişim modunu ve tercihini** listelemek. Bu belge yeni TypeScript/Electron uygulaması için **tamlık (completeness) checklist'i** olarak kullanılacaktır.
>
> Dil: Türkçe anlatım, İngilizce tanımlayıcılar (sınıf, dosya, sembol, menü etiketi birebir korunmuştur).

## 0. Lejant, kaynaklar ve yöntem

### 0.1 Etiketler
| Etiket | Anlam |
|---|---|
| **P0** | Çekirdek tuning — bu olmadan uygulama VemsTune yerine geçemez (bağlantı, config read/write/burn, INI dialog'ları, tablo/curve editörleri, gauge'ler, log kaydı/replay, firmware/config upload). |
| **P1** | Önemli — günlük kullanıcıların sık kullandığı, desteğe/teşhise gerekli özellikler (triggerlog, validation, live analyzer, SD card, GPS, wizard'lar). |
| **P2** | Nice-to-have / niş / geliştirici-test menüleri / legacy (Modbus, audio signal gen, WinCE/PDA, bug report, map cache...). |
| **[O] Observed** | Doğrudan kaynakta görüldü: help HTML/CHM, `config/*.ini|xml|db`, binary string (`strings.txt`) veya sembol (`syms.tsv`). |
| **[I] Inferred** | Sınıf/metot adlarından, string komşuluğundan veya dosya adlarından çıkarım. Davranış doğrulanmalı (dinamik analiz/UI gözlemi). |
| **[U] Unknown** | Varlığı biliniyor, işlevi/menü yeri belirsiz. |

### 0.2 Kaynaklar (salt-okunur)
- `re/target/vemstune-1.5.46/help/` (eski help: `index.html`, `dialogs/*.html`, `vemstune.chm`) — CHM `hh.exe -decompile` ile `re/evidence/help-chm/` altına açıldı (içerik: `main.htm`, `gauge.htm`, `gps.htm`, `tableEditor.htm`, `contents.hhc`, `vemstune.hhk`, 13 görsel). CHM eski V3GUI dönemine ait, yeni bilgi az (GPS state ikonları, raw log → XLS convert).
- `help2/htmls/` — **birincil kaynak**, 234 HTML (main/*, main/file|preferences|tools|view/*, gauges/*, gui/*, round/*, v3/*, v3/flags/*, v3/general/*, v3/datalog/*).
- `config/vemsTune-v3-1.2.33.ini` + `config/include/*.ini` (tam açılım 12 879 satır): `[Menu]`, `[UserDefined]` (89 dialog), `[TableEditor]` (35 table), `[CurveEditor]` (~957 curve tanımı; 912'si anytrim varyantı), `[SuperTable]`, `[SuperCurve]`, `[ExpressionGrid]`, `[InterpolationWidget]` (9), `[CheckboxMatrix]`, `[OutputChannels]` (431 sembol), `[Datalog]` (81 entry), `[SymbolAlias]` (51), `[UserData]`, `[SIPR]`, `[TableMapper]`, `[SRAM]`.
- `config/*.xml`, `config/*.db` (SQLite), `config/hotkeys/*.db`, `configlets/` (24 klasör), `configfilters/` (4 filtre).
- `re/evidence/classes.txt` (2 028 sınıf; ~1 380 uygulama sınıfı), `syms.tsv` (206 729 COFF sembol), `strings.txt` (139 151 string; menü etiketleri W-string olarak `0x00cd4xxx` bölgesinde ardışık).

### 0.3 Mimari not (katalogu okumak için)
- VemsTune **INI-driven** bir uygulamadır (MegaTune/TunerStudio INI formatının genişletilmiş hali; `[MegaTune] MTversion=2.25`). Tuning menülerinin **tamamı** INI'den üretilir (`USER_MENUS`, `UserMenu`, `UserDialog*`). Uygulama menüleri (File/View/Tools/Preferences/Help...) ise `MainFrame::createMenu` içinde sabit kodludur ve INI menüleri bunların arasına eklenir.
- Firmware sürümüne göre `vemsTune-v3-X.Y.Z.ini` otomatik seçilir (V3 için 1.0.00 … 1.2.34 arası 70+ INI; Round için 0.2.0 … 1.5.10; ayrıca `vemsTune-aim.ini`, `vemsTune-Arm-0.0.01.ini`, `cockpit-v3-1.1.27.ini`, `vemsv3pda.ini`).
- Kalıcı kullanıcı verisi ağırlıklı olarak **SQLite** (`wxsqlite3`): gauge grupları, descriptor'lar, hotkey profilleri, expression/filtre DB, son dosyalar, ECU/çalışma dizinleri, rapor durumu, dosya analiz cache'i.
- Tüm sayımlar bu belgenin sonundaki **Ek A (sayım tablosu)**'ndadır.

---

## 1. Ana menü çubuğu (MainFrame) — yeniden kurulmuş yapı

> Kaynak: `strings.txt` satır ~126 3xx–126 4xx'teki ardışık W-string'ler (MainFrame `.rdata`) + `MainFrame::On*` sembolleri + help `main/*_menu.html`. Menü sırası string sırasından çıkarılmıştır **[I]**; etiketler **[O]**.

```
File
  Open Log file                         (OnOpenVemsLog)
  Open Log to separated frame           (OnOpenVemsLog / separate frame)
  Recent Log files ▸                    (OnSelectRecentLog)
  Open Config file                      (OnOpenVemsCfg)
  Recent Config files ▸                 (OnSelectRecentConfig)
  Open Vems files advanced              (OnFileOpenDlg)
  Upload Advanced (to table A and B)    (OnConfigSwitchUpload)
  Save Config file                      (OnSaveVemsCfg)
  Save Log Buffer                       (OnSaveLogBuffer)
  Current working directory: …  / Set default working directory...   (OnSetDefWorkingDir)
  Current ECU: … / Add ECUs from directories to database... (OnAddECUDir)
  Select ECU from database...           (OnSelectECUFromDb)
  Recent ECUs ▸                         (OnRecentECU)
  Firmware Info                         (OnFirmwareInfo)
  Firmware Parameters                   (GeneralConfigFrame) [I]
  Password Protection                   (OnPasswordProtection)
  Quit                                  (OnQuit)
View
  Toolbars ▸ (Replay on log, Main, Gauge Groups, Flags, Static Control, Edit mode) ; Reset Toolbar Layout (OnResetToolBars)
  Layout ▸ Full screen (Shift+F11, OnFullScreenMenu) ; Fixed tabs ; Reset Layout (OnMenuResetLayout/OnResetLayout) ; Clear log window (OnClearDebug)
  Groups ▸ <gauge groups…> ; Group Theme ; Single gauge-group mode (OnGGB) ; Gauge group layout behaviour (OnGGFloatBehav)
  Gauge Groups Editor                   (OnGaugeGroupEditor)
  Editors ▸ Add new symbol descriptor (OnAddSymbol) ; Multi Graph profiles (OnMultiGraphProfiles) ;
            Vems Flags descriptor editor (OnVemsFlagDescEditor) ; Set global group background image (OnGlobalGaugeGroupBgImage)
<INI menüleri — V3: Base Setup, &Tuning, &Starting / Idle, Boost Control, &Outputs, &Motorsports, [&Woodgas], &ECU Logger, Inputs, [&AT]>
VemsLog
  Start new vemslog (Alt+L)             (OnVemsLogStartNew)
  Add marker to vemslog (Alt+K)         (OnVemsLogAddMarker)
  VemsLog to csv Converter              (OnRawConvert)
  Convert last vemslog to csv           (OnConvertLastLog)
  Convert all vemslog to csv            (OnConvertAllLog)
  View last log with Ext. Viewer        (OnOpenLastLog)
  MSQ export                            (ExportMSQ)
  Convert VemsDisplay(Android) log      [O]
Tools
  VE Tune by statistics                 (OnRTDataStat)
  Live VE Analyzer                      (OnLiveAnalyze)
  WBO2 Calibration                      (OnAdvFrame "wbo2_calibration") / WBO2 Calibration (new) (WBO2CalibrationFrame)
  TPS Calibration Wizard                (OnWizards / OnAdvFrame "TPSCalibration")
  Ignition Lock                         (OnIgnLock)
  IAC Lock                              (OnIACLock)
  Tachometer Lock                       (OnTachoLock)
  AnalogInputCalibrationWizard          (OnAnalogInputCalibrationWizard)
  SD Card log ▸ Search SD files ; Open image file ; SD Card Reader ; Start ; (Stop) ; Erase   (OnMMCLog)
  Play Trigger                          (OnPlaySignal / SetSoundDialog)
  Generate trigger WAV dialog           (OnGenTrigger)
  Record triggerlog (from V3)           (OnTriggerLog)
  Analyze triggerlog file               (OnTriggerLog / ShowTriggerLogFrame)
  Firmware ▸
     Firmware update wizard             (OnFirmwareUploadWizard)
     Firmware upload                    (OnFirmwareUpload)
     Firmware verify                    (OnFirmwareVerify)
     Firmware Patch upload              (OnFirmwarePatchUpload)
     Config upload                      (OnConfigUpload)
     Filtered config upload             (OnFilteredConfigUpload)
     Projects: Open... / Recent projects ▸ (OnLoadRecentProject)
     Audi config upload                 (OnAudiConfigUpload)
     Config verify                      (OnConfigVerify)
     Config Download / Config Download To (OnConfigDownload)
     BootLoader Upgrade Wizard          (OnBootLoaderUpgradeWizard)
     Firmware web tool                  (OnFirmwareWeb)
     Round emergency revival            [O]
     V3 reboot                          (OnV3Reboot)
Preferences
  Preferences (Ctrl+P)                  (OnPreferencesMenu / ShowPrefDialog)
  ECU Communication                     (SetSerialDialog)
  GPS Communication                     [O]
  Hotkey config ▸ <target başına>       (wxHotKeyProfileManager) [O help]
  Trigger log & audio settings          (OnSoundConfig) [I]
  Automatic updates settings / Update files manually (OnVTFilesUpdaterSettings)
  Import configuration... (Import files from previous VemsTune installation) (OnImportAfterInstall)
  Restore backup
  Update ini files from web
  Check new VemsTune releases           (OnMenuReleaseCheck)
Dev / Other (OnDevOtherMenu — geliştirici menüsü, normal build'de kısmen gizli olabilir) [I]
  Testing IniFiles (OnTestingIniFiles) ; Table 3D Test (OnDevTable3D) ; Generate VemsLog (OnGenerateVemsLog) ;
  VemsLogViewer (OnVemsLogViewer) ; Boost refDC Tune by statistics (OnRTDataStatBoost) ; Knock Tune (OnKnockTune) ;
  Show Terminal (OnVemsCommTerminal) ; Read data from SRAM ; Switch comm.logging (OnDevEnableFileLog) ;
  ModbusDialog ; ModbusPlcDialog ; SequencerDialog ; VirtualDevicesDialog ; Save EEPROM cfg (OnSaveEepromCfg) ;
  Upload VemsCfg2 (OnUploadVemsCfg2) ; Triggerframe creator (OnDevTriggerFrameCreator) ; Triggercalc Test ;
  Mixture Table Test (OnMixtureTableView) ; wince test 1/2/3 (OnWinCETest*) ; Spark statistics (OnSparkStat) ;
  AIM test (OnAIMTest) ; Torque config (OnTorqueConfig) ; Race Analizer (OnRacesAnalyzer) ; IAC Control (OnIACControl) ;
  ConfigChecker test (OnConfigCheckerTest) ; Print Toolbar Layout ; Compare Firmware Configs (OnCompareFirmwareConfigs)
Help
  Help Topics (OnHelpTopics) ; Error reporting (OnErrorReport) ; Vems Sharing Center ; Previously sent reports ; About (OnAbout)
```

### 1.1 `MainFrame::On*` komut listesi (sembollerden, 135 adet) ve eşleme

| Handler | Menü / tetikleyici | Alan | Kanıt |
|---|---|---|---|
| OnAbout | Help ▸ About (`VemsAboutDialog`) | MISC | O |
| OnActivate / OnSetFocus / OnIconize / OnIdle / OnTimer / OnResourcesTimer / OnKeyDown / OnClose / OnWindowCreate / OnPageChanged / OnMenuBarOpen / OnMenuBarClose | Pencere olayları (resource logger timer, tray icon'a küçülme, perspective kaydetme, exit onayı) | GUI | O/I |
| OnAddECUDir | File ▸ Add ECUs from directories to database | CONN-12 | O |
| OnAddGauge | Gauge ekleme (edit mode / adv frame) | GAUGE | O |
| OnAddSymbol | View ▸ Editors ▸ Add new symbol descriptor | GAUGE-06 | O |
| OnAdvFrame | WBO2 / TPS calibration gibi "advanced frame" (`GaugeCarrierAdvFrame`) | CAL | O |
| OnAIMTest | Dev ▸ AIM test (`AIMTestFrame`) | AIM-04 | O |
| OnAnalogInputCalibrationWizard | Tools ▸ AnalogInputCalibrationWizard | CAL-04 | O |
| OnAudiConfigUpload | Tools ▸ Firmware ▸ Audi config upload | FW-05 | O(label)/I(davranış) |
| OnBootLoaderUpgradeWizard | Tools ▸ Firmware ▸ BootLoader Upgrade Wizard | FW-14 | O |
| OnCannotOpenPort / OnCommunicationError / OnDeviceCannotConnect / OnDeviceCannotLeaveBootMode / OnDeviceConnected / OnDeviceControllerStopped / OnDeviceDisconnected / OnDeviceFound / OnDeviceNotFound / OnDeviceProtected / OnDeviceReconnected / OnDeviceResumed | Cihaz durum olayları (mesaj kutuları, status bar, safe mode uyarısı, password uyarısı) | CONN-04/18 | O |
| OnClearDebug | View ▸ Layout ▸ Clear log window | GAUGE-20 | O |
| OnCompareFirmwareConfigs | Dev ▸ Compare Firmware Configs | FW-07 | O |
| OnConfigCheckerTest | Dev ▸ ConfigChecker test (`MTConfigChecker`) | VAL-05 | O |
| OnConfigDownload | Firmware ▸ Config Download / Config Download To | FW-01 | O |
| OnConfigSwitchUpload | File ▸ Upload Advanced (to table A and B) | FILE-07 | O |
| OnConfigUpload | Firmware ▸ Config upload | FW-02 | O |
| OnConfigVerify | Firmware ▸ Config verify | FW-03 | O |
| OnConvertAllLog / OnConvertLastLog | VemsLog ▸ Convert all/last vemslog to csv | LOG-07 | O |
| OnConvertTriggerFrameToSipr | Triggerframe log → SIPR/vemslog dönüştürücü | TRIG-06 | I |
| OnDevEnableFileLog | Dev ▸ Switch comm.logging | CONN-13 | O |
| OnDevOtherMenu | Dev menüsündeki diyaloglar (SRAM, Modbus, Sequencer, VirtualDevices) | MB/CALC | I |
| OnDevTable3D | Dev ▸ Table 3D Test | MISC | O |
| OnDevTriggerFrameCreator | Dev ▸ Triggerframe creator (hex komut girişi) | TRIG-07 | O |
| OnEditConfig | `ConfigEditFrame/ConfigEditPanel` (config değerlerini dosyaya yazan basit editör) | MISC | U |
| OnErrorReport | Help ▸ Error reporting | WEB-04 | O |
| OnFileOpenDlg | File ▸ Open Vems files advanced | FILE-05 | O |
| OnFilteredConfigUpload | Firmware ▸ Filtered config upload | FW-04 | O |
| OnFirmwareConfigUploaded / OnFWUploadedEvent / OnFirmwareUploadingStarted / OnFirmwareVerifyingStarted / OnFirmwareUpgradeWizardClosed | Firmware işlemleri sonrası olaylar | FW | O |
| OnFirmwareInfo | File ▸ Firmware Info (`FirmwareInfoDialog`) | FILE-12 | O |
| OnFirmwarePatchUpload | Firmware ▸ Firmware Patch upload | FW-10 | O |
| OnFirmwareUpload / OnFirmwareUploadWizard / OnFirmwareVerify / OnFirmwareWeb | Firmware alt menüsü | FW-08/11/09/13 | O |
| OnFullScreenMenu | View ▸ Full screen (Shift+F11) | GAUGE-17 | O |
| OnGaugeGroupEditor | View ▸ Gauge Groups Editor | GAUGE-04 | O |
| OnGeneralEvent / OnGUICommand / OnTestSendEvent | İç olay dağıtıcı (`VemsTuneEventDispatcher`, `VemsGUICommandEvent`) | Core | I |
| OnGenerateVemsLog | Dev ▸ Generate VemsLog (`VemsLogGenerator*`) | LOG-21 | O |
| OnGenTrigger | Tools ▸ Generate trigger WAV dialog | TRIG-04 | O |
| OnGGB / OnGGFloatBehav | View ▸ Groups: single/multi mod, floating/attach davranışı | GAUGE-17 | I |
| OnGlobalGaugeGroupBgImage | View ▸ Editors ▸ Set global group background image | GAUGE-13 | O |
| OnHelpTopics | Help ▸ Help Topics | WEB-08 | O |
| OnIACControl / OnIACLock / OnIgnLock / OnTachoLock | Dev ▸ IAC Control ; Tools ▸ IAC/Ignition/Tachometer Lock | TUNE-17 | O |
| OnImportAfterInstall | Preferences ▸ Import configuration... | FILE-11 | O |
| OnKnockTune | Dev/Tools ▸ Knock Tune (`KnockFrame`) | KNOCK-02 | O |
| OnLiveAnalyze | Tools ▸ Live VE Analyzer | LOG-15 | O |
| OnLoadRecentProject | Firmware ▸ Recent projects | FILE-09 | O |
| OnLogAnalyze | Trigger log analiz (log "Trigger frame / adv / config11 / ign_tdcdelay..." çıktısı) | TRIG | I |
| OnMenuLoggerScreen | Log/message ekranı | GAUGE-20 | U |
| OnMenuReleaseCheck | Preferences ▸ Check new VemsTune releases | WEB-01 | O |
| OnMenuResetLayout / OnResetLayout / OnResetToolBars | View ▸ Reset Layout / Reset Toolbar Layout | GAUGE-17/18 | O |
| OnMixtureTableView | Dev ▸ Mixture Table Test | LOG-20 | O |
| OnMMCLog | Tools ▸ SD Card log alt menüsü | SD | O |
| OnMultiGraphProfiles | View ▸ Editors ▸ Multi Graph profiles | LOG-05 | O |
| OnOpenLastLog | VemsLog ▸ View last log with Ext. Viewer | LOG-08 | O |
| OnOpenVemsCfg / OnOpenVemsLog / OnSaveVemsCfg / OnSaveLogBuffer | File menüsü | FILE | O |
| OnPasswordProtection | File ▸ Password Protection | CONN-11 | O |
| OnPlaySignal | Tools ▸ Play Trigger (`AudioPanel`) | TRIG-03 | O |
| OnPreferencesMenu | Preferences ▸ Preferences | PREF | O |
| OnProperIniFileNotFound | "Proper vemsTune-v3-X.Y.Z.ini file not found!" | CONN-05 | O |
| OnQuit | File ▸ Quit (exit onayı `exitquestion`) | MISC | O |
| OnRacesAnalyzer | Dev ▸ Race Analizer | GPS-09 | O |
| OnRawConvert | VemsLog ▸ VemsLog to csv Converter | LOG-07 | O |
| OnRecentECU | File ▸ Recent ECUs | CONN-12 | O |
| OnRefreshUserMenu | INI menülerinin koşullarını yeniden değerlendirme (`UserMenuRefresher`) | TUNE-01 | I |
| OnRTDataStat / OnRTDataStatBoost / OnSparkStat | VE / Boost refDC / Spark statistics | LOG-11/12/13 | O |
| OnSaveEepromCfg / OnUploadVemsCfg2 | Dev ▸ Save EEPROM cfg / Upload VemsCfg2 | FW-18 | O |
| OnSelectECUFromDb | File ▸ Select ECU from database | CONN-12 | O |
| OnSelectGaugeInput / OnSIPRInput | Toolbar "Set the Input Source" (ECU / file / signalgen / SIPR) | CONN/LOG | I |
| OnSelectRecentConfig / OnSelectRecentLog | Recent dosyalar | FILE | O |
| OnSetDefWorkingDir | File ▸ Set default working directory... | CONN-12 | O |
| OnSFlood | Serial flood (Round revival / `SFloodDialog`) | FW-15 | I |
| OnSoundConfig | Trigger log & audio settings | AUDIO | O(log string) |
| OnTestConfigParsing / OnTestingIniFiles | Dev ▸ Testing IniFiles | MISC | O |
| OnTorqueConfig | Dev ▸ Torque config | TUNE-20 | O |
| OnTriggerConfig | Trigger ayar paneli / ECU setup wizard trigger sayfası | TRIG-08 | I |
| OnTriggerLog | Tools ▸ Record/Analyze triggerlog | TRIG-01 | O |
| OnV3Reboot | Firmware ▸ V3 reboot | CONN-17 | O |
| OnVemsCommTerminal | Dev ▸ Show Terminal | CONN-21 | O |
| OnVemsFlagDescEditor | View ▸ Editors ▸ Vems Flags descriptor editor | GAUGE-10 | O |
| OnVemsLogAddMarker / OnVemsLogStartNew | VemsLog ▸ Add marker / Start new | LOG-02 | O |
| OnVemsLogViewer | Dev ▸ VemsLogViewer | LOG-21 | O |
| OnVemsTuneInfo | RT istatistik penceresi (`VemsTuneInfo`: received RT packets, RT CRC errors, timedout) | CONN-20 | I |
| OnVTFilesUpdaterSettings | Preferences ▸ Automatic updates settings | WEB-02 | O |
| OnWinCETest / OnWinCETest2 / OnWinCETest3 / OnWinCETestTimer | Dev ▸ wince test 1-3 (PDA/WinCE ekran testi) | AIM-06 | O |
| OnWizards | Wizard açıcı (ECU Setup / TPS) | TUNE-19, CAL-03 | I |

Diğer (On* olmayan) MainFrame metotları: `AcceptDrop/DropFiles` (drag&drop), `BuildAimGui`, `ChangePage`, `checkCommPort`, `compareConfigs`, `CompareFWCompTimeAndVTTime` (firmware VemsTune'dan yeniyse uyarı), `createMenu`, `createOrUpdateToolsMenu`, `CreateProjectRecentSubMenu`, `CreateRecentECUsMenu`, `CreateRecentFilesMenu`, `downloadConfig`, `EnableSelectECUMenus`, `ExportMSQ`, `FirmwareConfigDownloaded`, `GenerateMenu`, `helperIsAlphaN`, `initFrameLayout`, `loadLastLogFile`, `openVemsCfg`, `RebuildGUI`, `refreshLogDir`, `SavePerspective`, `SetFullScreen/ToggleFullScreen/IsFullScreen`, `SetRootDir`, `ShowErrorReportDialog`, `ShowTriggerLogFrame`, `showWebTool`, `SortRecentProjects`, `StartSparktTester`, `startUploadFirmwareWizard`, `UpdateAUI`, `uploadFirmware`, `uploadFirmwareOnly`, `validateConfig`.

---

## 2. Bağlantı ve cihaz yönetimi (CONN)

#### CONN-01 · ECU Communication Dialog (seri port) — P0 · [O]
- **Ne yapar:** ECU'ya seri (RS232/USB-FTDI) bağlantı ayarı ve otomatik algılama. Alanlar: `Enabled`, `Mode` (Serial/TCP), `Port`, `Current baudrate`, `Preferred baudrate`, `Firmware upload baudrate`, `SD Card baud rate`, `Timeout (ms)`, `Inter Write Delay(ms)`, `Ignored realtime error count`, `Realtime delay` (iki RT paketi arası gecikme, 0=kapalı), `Disable baudratechange (for BlueTooth)`, `Enable AIM mode` + `Fallback time` (AIM yoksa MegaTune moduna geçiş süresi), `Detect ECU && data flow` butonu, `Open Device Manager`, `Bytes received/sent` sayaçları.
- **Girdi/Çıktı:** COM listesi (`SerialEnumerator`, üretici adları: FTDI, "Sealevel Systems", "Speed Dragon", "QinHeng Electronics", "Renesas"), port tarama sonuçları ("ECU found / ECU not found on …"). Ayarlar `vtsettings.ini` (`/communication/serial/...`).
- **Sınıflar:** `SerialConfigDialog`, `SerialConfigPanel`, `SerialConfigMgr`, `CommsDialogFactory`, `ECUConfigDialog`, `ECUConfigPanel`, `SerialPortScanner`, `PortScanner`, `BaudRateSelector`, `SerialPortHandler(Factory)`, `SerialPorts`, `SerialHelper`, `CommunicationConfig`, `ConfigMgrCommunication`.
- **Help:** `main/preferences/ecu_comm_dialog.html`, `ecu_comm_overview.html` (FTDI latency ayar görselleri).
- **Not:** Tarama başarısızsa iletişim devre dışı bırakılır ("Please re-enable it in the Preferences/ECU Communication dialog").

#### CONN-02 · TCP üzerinden ECU (serial-over-TCP) — P1 · [O]
- **Ne yapar:** `IP:port` ile uzak ECU'ya bağlanma (ser2net, serproxy, VemsTCPSerialBridge, Android VemsDisplay köprüsü). `Check` ile erişilebilirlik testi.
- **Sınıflar:** `TCPClientHandler`, `TcpPortScanner`, `RemoteSerialPort`, `ReducedTelnetFsm` [I: telnet/RFC2217 kırpılmış FSM].
- **Help:** `main/preferences/ecu_serialovertcp.html`, `TCPSerialBridge.html`. `3rdparty/` (serproxy dökümanı; bu sürümde yalnız `dd.exe` var).

#### CONN-03 · WiFly modül algılama — P2 · [O]
- **Ne yapar:** Roving Networks WiFly kablosuz seri modülünü UDP broadcast ile bulur; "WiFly module found on the following IP and port" → `Use port && close`.
- **Sınıflar:** `WiflyDetectDialog`, `WiFlyDetectThread`, `WiFlyPacketReceiver`, `WiFlyUDPBroadcastData`.

#### CONN-04 · Cihaz algılama & bağlantı durum makinesi — P0 · [O]
- **Ne yapar:** Port açılır → cihaz tanınır (V3 / Round / ARM / AIM / boot mode) → şifre kontrolü → firmware bilgisi → config parse → sayfa senkronizasyonu ("Syncing pages: %d / %d") → realtime akışı. Progress mesajları: "Searching Device…", "Device Found…", "Checking password protection…", "Fetching firmware information…", "Parsing config files…", "Resuming…", "Leaving Boot mode…".
- **Olaylar:** Found/NotFound/Connected/Disconnected/Reconnected/Resumed/Protected/CannotConnect/CannotLeaveBootMode/ControllerStopped.
- **Sınıflar:** `VemsDeviceController` (94 metot: `connect`, `detectBootState`, `leaveBootMode`, `changeBaudRate`, `checkPassword`, `getAllPages`, `readOffset(SIPR)`, `readSRAM`, `resetDevice`, `resume*`, `enableFileLogging`...), `VemsDeviceControllerFSM/State/Config`, `DeviceDetector`, `DeviceRecognizer`, `IRecognizer/RangeRecognizer/LengthRecognizer/StringRecognizer/RegExRecognizer`, `BootStateDetector`, `FirmwareVersionRecognizer`, `V3FirmwareInfoFetcher`, `V3FirmwareVersionFetcher`, `RoundFirmwareInfoFetcher`, `CommunicationController2`, `CommunicationDispatcher`, `CommunicationThread`, `CommunicationTimer`, `SIPRPacket*`, `SIPRParser`, `ProtocolBase`, `Megatune`, `MegatuneSyncer`.
- **Protokol notu:** SIPR paket tipleri (`SIPR_GET_TABLEDATA`, `SIPR_GET_CONFIG_1/2`, `SIPR_RT_MT_NORMAL/EXT`, `SIPR_TABLE_RPM|KPA|IGN|LAMBDA|EGOC|VE|H|BOOST_DC|BOOST_TPS|TEMPERATURE|MAPCORR|ALT_KNOCK|A340E`) ve MegaTune komutları (`queryCommand="Q"`, `Manm…bye` tarzı komut şablonları: `Manmd[deainh]XX`, `ManmcL0mbye/ManmcS1mbye`, `Manmdi%02Xmbye` IAC lock, `Manmda%02Xmbye` ign lock, `Manmdh..` output test). Ayrıntı protokol belgesine bırakılmıştır.

#### CONN-05 · INI/firmware imzası eşleme — P0 · [O]
- **Ne yapar:** ECU imzasından (`signature = "VEMS v1.2.33 16x14 kpa=2,1"`, kpa varyantları `kpa=2,1|2,2|2,4|4,1|4,2|4,4`) uygun `vemsTune-v3-X.Y.Z.ini`'yi seçer; `#if/#else` koşulları (HIGHBOOST, USEAFR147, KNOCK_ALTERNATIVE, TOYOTA_1JZ_VVTI, A340E, WOODGAS_CONTROLLER, PS2KEYBOARD, USE_SUPER_TABLE, COM_MODEL, BUSYLOOP_STIMULATION, USE_INJ_STEPPER, KPACONFRES_4...) firmware compile option'larına göre çözülür. Uyarılar: "Proper vemsTune-v3-X.Y.Z.ini file not found!", "VemsTune seems to be older than the firmware…", "Project signature warning! Expected/ECU uses".
- **Sınıflar:** `V3iniParser`, `V3iniParserPriv`, `IniFile`, `MTConfigHelper`, `MTConfigData`, `MegatuneConfig`, `MyMakeParser` (`my_make`), `HeaderParser`/`ParseHeader` (`global.h`), `SramMapParser` (`vems.map`), `CompareFWCompTimeAndVTTime`.
- **Pref:** `compiled_inifiles_enabled` (derlenmiş INI cache) [I].

#### CONN-06 · Online/Offline modu — P0 · [O]
- Toolbar "Set serial mode: Online/offline" (`TbTbSerialMode`), "Go offline" (config upload diyaloğunda), offline'da `.vemscfg` / `.vemslog` üzerinde **read/write** çalışma (help `main/intro.html` "Offline mod").

#### CONN-07 · ECU State toolbar ikonu — P0 · [O]
- Durumlar: `tbEcuState48-false|true|offline|aim|rt|boot|locked`. Menü: "Leave AIM Mode", "Go to MegaTune mode". "ECU Disabled!". Sınıf `TbTbECUState`, `StateIcon`, `StatusBubble`, `BubbleStateDesc`.

#### CONN-08 · Devices ikonu — P1 · [O]
- "Device: not found | V3 | Round | ARM | AIM"; `TbTbDevices`, `DevicesIcon`, `DeviceModeSelector(Helper)`.

#### CONN-09 · AIM modu ve MegaTune moduna dönüş — P1 · [O]
- ECU AIM stream'i gönderirken seri iletişim isterse V3 AIM'i kapatır. Pref'ler: `enableAimOnECU` (çıkışta ECU'da AIM'i aç), `enableAimQuestion`. Sınıflar `AIMDetector`, `AIMRecognizer`, `AIMDeviceController`, `FSMAIM`, `AIMParser`, `AIMThread`. Help `main/aim.html`.

#### CONN-10 · Safe mode bildirimi — P0 · [O]
- "Safe Mode Active. Injector and ignition outputs are disabled." (`VemsTuneController::isSafetyModeActive`).

#### CONN-11 · Password protection — P1 · [O]
- `config/password.txt` (`{6 digit serial}={8 hex password}`), `password-example.txt`, `password_upgrade.txt` (bootloader). File ▸ Password Protection diyaloğu: Serial Number, password file location, `Enable Password Protection`, "Restart ECU after change". Mesajlar: Password Accepted / File not found / not found for serial / Invalid.
- Sınıflar: `PasswordProtectionDialog`, `PasswordChecker(Listener)`, `PasswordHelper`, `CheckingPassword`. Help `main/file/v3password.html`.

#### CONN-12 · ECU veritabanı ve çalışma dizinleri — P1 · [O]
- Her ECU seri numarası için ayrı log/config dizini; ilk bağlantıda isim sorulur (`^[[:alnum:]_.-]+$`). "Current ECU", "Add ECUs from directories to database…" (dizinleri tarar, aynı seri uyarısı), "Select ECU from database…", "Recent ECUs", "Set default working directory…". DB: `workingdirs.db` (`workingdirs`, `serialnumber`).
- Sınıflar: `AddECUDirDialog`, `AddECUDirScrolled`, `SelectECUFromDbDialog`, `RecentECUs`, `LogDirManager`, `DirHelper`, `DirLoader`, `SerialNumber`.

#### CONN-13 · İletişim loglama — P2 · [O]
- "Switch comm.logging": ham trafik `comm-*`/`filelog-*` dosyalarına. Sınıflar `CommunicationLogger`, `BufferedCommFileLogger`, `BufferedCommLoggerBase(A)`, `SerialPortHandlerSFile` (dosyadan oynatma), `SFile`.

#### CONN-14 · Port flood / SFlood — P2 · [I]
- "Serial port flooded with junk data!" tespiti; `SFloodDialog/Process/Thread` Round revival sırasında porta sürekli veri basma (`round_sflood_steps`, `calc_is_flood_clear`).

#### CONN-15 · hub4com port paylaşımı — P2 · [I]
- `useHub4Com`, `m_hub4comPID` — COM portu birden çok uygulamaya çoğaltma (hub4com süreci başlatılıp öldürülüyor).

#### CONN-16 · Multicast realtime paylaşımı — P2 · [O]
- Pref `multicast_enabled`, `multicast_mode` (0=Listen, 1=Connect), `multicast_host` (127.0.0.1), `multicast_port` (9000). Sınıflar `MulticastManager`, `UDPReceiverBase`, `UDPEvent`. Bir VemsTune'un RT verisini diğerine aktarma [I].

#### CONN-17 · V3 reboot — P1 · [O]
- Firmware ▸ V3 reboot (`VemsTuneController::rebootECU`).

#### CONN-18 · Hata/uyarı diyalogları — P0 · [O]
- "Cannot Open Port!", "Device cannot connect! If firmware is too old, firmware upgrade might help. (On round try Tools/Firmware/Round emergency revival)", "Device Disconnected/Reconnected/Resumed!", "It seems that there is some problems with Vems communication. Check power, cables and serial port settings.", "Please plug off USB-Serial converter!". Mesaj şablonları `config/VemsErrorMessages.xml` (≈20 adlandırılmış mesaj, `$symbol` yer tutuculu). Sınıflar `CommunicationControllerErrorHandler`, `MessageBoxObserver`, `VemsGeneralNotification(Handler)`, `VemsMessage`, `MessageContainer`.

#### CONN-19 · Trigger Frame (TF) taşıma modu — P0 (altyapı) · [O]
- Yüksek hızlı framed protokol (CRC'li). Triggerlog, SD card indirme, SRAM okuma, VemsCfg2 upload için kullanılır. "Trigger Frame Mode detected", "CRC Error Response Count". Sınıflar `TriggerFrame*` (FSM, FSMCRC, Controller, CommunicationController/Client, MemoryHandler, ReaderClient, WriterClient, Recognizer, Factory, Syncer, Tester, SDCardHandler, Request), `InitTriggerFrameMode`, `EepromTriggerFrameController`, `SRAMTriggerFrameController`, `TFMemoryHandlerRequest`.

#### CONN-20 · Realtime veri akışı & istatistik — P0 · [O]
- RT paket döngüsü, status bar'da "%d Hz"; `rtMinRefreshInterval` (60 ms). `VemsTuneInfo` (received RT packets, RT CRC errors, RT timedout packets, elapsed time). Sınıflar `RTDataMgrBase/Facade`, `RTDataInput*` (RingBuffer, SIPR, Signalgen), `RealtimeHandler`, `RefreshRateLimiter`, `UpdateFrequencyMeter`, `RTDataMgrRandom` (test).
- Input source seçimi: toolbar "Set the Input Source" (`TbTbInputSource`, `SelectInputIcon`) — ECU / log dosyası / signal generator / SIPR [I].

#### CONN-21 · VemsTune communication terminal — P2 · [O]
- Sekmeler: Combined view, Separated views, TriggerFrame view; Logging enabled, Scrolling enabled, Clear window, Set macros (`vct_macros.xml`, `VCT_MacroDialog`), Previously sent commands. Sınıflar `VemsCommTerminal`, `VemsCommTerminalMacros`, `TerminalPanel`, `VemsTerminal*ViewersPage`, `TerminalLog`.

#### CONN-22 · Hex komut gönderme — P2 · [O]
- "Enter hexadecimal values (may be separated by whitespace, comma)… Result will be displayed in the console window… Copy result to clipboard" → "TriggerFramed output". (Triggerframe creator ile aynı diyalog [I]).

#### CONN-23 · MegaTune uyumluluk katmanı — P1 · [O]
- MegaTune mod komutları, `.msq` export (http://www.msefi.com/:msq namespace), `.msq` tabloya import (`ConfigParserMSQ`), `MegatuneHelper`, `MegatuneSyncer(Listener)`.

#### CONN-24 · Device controller progress yönetimi — P1 · [O]
- Uzun işlemler için ortak progress diyaloğu (`bcProgressDialog`: Elapsed/Remaining/Estimated time), `DeviceControllerProgressBarManager`, `ProgressBarObserver(Widget)`, Win7 taskbar ilerlemesi (`Win7TaskBar.dll`, `TaskBarHelper`).

---

## 3. Proje, dosyalar ve oturum (FILE)

#### FILE-01 · Open Log file (.vemslog) — P0 · [O]
- `.vemslog` = 512 byte header (Creator, BlockSize, DataLength, CompilationTime, Version, LogVersion, SerialNumber, SerialNumber Raw, GPSDataLength, GPSDataFormat, Signature, Options, CompileOptions) + ham SIPR RT paketleri + config + GPS. Log açıldığında config parametreleri de yüklenir (config'e bağlı RT değerleri doğru hesaplanır). ECU online iken log açma onayı ("ECU is online! Do you really want to open the log file?"). "Open Log to separated frame" ayrı pencere.
- Sınıflar: `VEMSLogParser`, `VemsLogReader(Helper)`, `VemsLogHeaderParser`, `RawLogParser`, `RawLogHelper`, `VEMSDataLogDesc`, `DataLogEntry`, `LogHistoryMgr`.

#### FILE-02 · Open Config file (.vemscfg) ve offline düzenleme — P0 · [O]
- Header'lı config dump; header yoksa "you can upload this config, but you can not open it". Firmware sürümü kurulu değilse açılmaz/kaydedilmez ("Detected firmware version is not installed!"). Sınıflar `VemsCfgHelper`, `ConfigFile`, `EEpromConfigLoader`, `FirmwareConfigLoader/Parser/Data`, `OpenVemsCfgDialog` (ECU bağlıyken: Config upload / Config Upload Advanced / Config Verify / Go offline seçenekleri).

#### FILE-03 · Save Config file — P0 · [O]
- Mevcut ECU/offline config'i `.vemscfg` olarak kaydeder (`ConfigSaver2`, `ProjectConfigSaver`). Hata: "Firmware version is not available / not supported / not installed".

#### FILE-04 · Save Log Buffer — P0 · [O]
- Bellekteki RT log tamponunu (tamamı / seçili bölüm / son kaydedilenden itibaren) `.vemslog`'a yazar. `SaveLogBufferDialog`, `SaveLogBufferProcess`, `VEMSLogBuffer`. Pref `vemslogpreferences` (0: yalnız ECU Log ikonu ON iken, 1: tüm tampon, 2: son kaydedilen index'ten).

#### FILE-05 · Open Vems files advanced — P1 · [O]
- Genişletilmiş açma diyaloğu: klasör gezgini, dosya listesi sütunları (name, size, Date Modified, type, Firmware Version, RPM Max, MAP Max, No.of trigger errors, GPS data) — sütun seç/sırala (`filedlgsettings.db`), filtre (both / log / config / triggerlog), "Analyze all files", "Search files in VEMS home directory" (min/max size, date, fw, RPM, MAP, trigger errors, GPS var/yok), GPS route küçük harita, "Export to KML/GPX", "Rename files by GPS data", "Clean up database", "Open to separate frame". Cache DB `vemsdetails.db`.
- Sınıflar: `FileOpenDlg`, `FileOpenDlg_GPSSearch`, `FileOpenSQL`, `FileAnalyzeSQL`, `QuickAnalyze`, `FileDialogSettings(Dialog)`, `FileDialogSearchDialog`, `FD_ColumnInfo`, `FileInfo(A)`, `FileOpenArtProvider`.
- Help: `main/file/open_vems_files.html`.

#### FILE-06 · Drag & Drop — P1 · [O]
- `.vemslog`, `.vemscfg`, `.triggerlog` ana pencereye (ve curve/table editörlerine config import için) sürüklenebilir. `FileDropManagerBase`, `FileDropRegistrator`, `FileDropTarget(Base|Ext)`, `DnDFile`.

#### FILE-07 · Upload Advanced (Table A ve B / config switch) — P1 · [O]
- Seçenekler: "Upload to A and B (recommended)", "Upload to A only", "Upload to B only" (confswitch destekli fw ≥1.1.7x). Uyarı: yükleme sırasında switch'i değiştirme; upload sonrası confswitch kapanabilir. `ConfigSwitchAdvancedUploadDialog`, `ConfigSwitchState`, `ConfigSwitchViewer`, `CFGSW_HeadPanel`, `laptop2ecu-a/b.png`. Help `main/file/upload_advanced.html`, `v3/v3_config_switch.html`.

#### FILE-08 · Dosya formatları (okuma/yazma) — P0 · [O]
| Uzantı | Açıklama |
|---|---|
| `.vemscfg` | Config dump (header + page verisi; `mcd`/`mct` text varyantları). |
| `.vemscfg2` | Metin config (`# ConfigVersion: 2.0`, `# SerialNumber`, `# Signature`, `struct.field = value`; `vems.map`/`global.h` gerekir) — `VemsCfg2Loader`. |
| `.vemslog` | RT log (512B header). |
| `.triggerlog` | Trigger log ("Vems Trigger Log Header, 512 byte"). |
| `.vemsprj` | Proje (XML `VemsTuneProjectFile`). |
| `.raweeprom` | Ham EEPROM dökümü (Save EEPROM cfg). |
| `.msq` | MegaTune/TunerStudio export/import. |
| `.csv` | Log → CSV, triggerlog result CSV, race CSV. |
| `.kml` / `.gpx` | GPS rota export. |
| `.wav` / `.raw` | Trigger audio. |
| `.png` | Triggerlog ekran görüntüsü. |
| `.json` | VE stat export, `sramsections.json`. |
| `.hex/.uhex/.shex/.chex/.chex2/.lhex/.vhex/.phex` | Firmware/bootloader imajları (Intel HEX, crypto CHEX). |
| `.clt/.uclt`, `.air/.uair` | Coolant / air (MAT) firmware patch tabloları (`coolantfactor/`, `matfactor/`). |
| `.db/.s3db` | Hotkey profil export/import. |
| `.xml` | Gauge export/import ("Export gauges to file"). |

#### FILE-09 · Projeler (.vemsprj) — P2 · [O]
- Bir projede firmware + patch (coolant/air) + config dosyaları (full/partial, mandatory/active/validate) listesi; uzmanların müşteriye hazır kurulum paketi vermesi (Audi motronic55 senaryosu). Diyaloglar: Project selection ("Open project…", "Select recent project…", "Create…"), Project settings ("Select a firmware and patches for the project", Project name, "Save project", "Save and Load"), `Unidlg2Test` (config satırları ekle/sil). `RecentProjects.xml`.
- Sınıflar: `ProjectChooserFrame`, `ProjectManager`, `Project`, `ProjectHelper`, `ProjectSettingsFrame`, `ProjectWizard`, `NewProjectWizard`, `FirmwareAndPatchSelectorPanel`, `PropertyGuiItem`. Help `help/project.html`. Örnek: `config/Test*.vemsprj`.

#### FILE-10 · Welcome / Start here ekranı — P2 · [O]
- Başlangıç paneli: Open log / To new window / Adv. open / Open config / ECU / GPS / Communication settings; "Example data log files", "Default V3 config files", "Default round config files", "Recent log/config files"; `welcome.html` HTML karşılama ("Show this dialog at startup"). Pref `show_welcome_screen`, `starthere_autoclose`. Sınıflar `VemsWelcomeScreen`, `VemsTuneHtmlWelcomeScreen`, `VemsInitialScreen`, `NoProjectDialog`, `VemsSplashScreen`.

#### FILE-11 · Import / backup / restore — P1 · [O]
- "Import files from previous VemsTune installation" (DB yapı uyarısı), "Restore backup" (`cfgbkup.zip`, restart gerekir). Burn'de otomatik config yedeği (pref `backuponburn`, `maxbackuped`=20). Sınıflar `ConfigBackup`, `UpdateImporter`.

#### FILE-12 · Firmware Info / Firmware Parameters — P1 · [O]
- Firmware Info: versiyon, derleme zamanı, seri no, compile options, signature. Firmware Parameters ("Parameters Config / Detected Firmware Parameters") genel config çerçevesi (`GeneralConfigFrame`: combo/text grupları, "Not applied until VemsTune restart!"). Sınıflar `FirmwareInfoDialog`, `FirmwareInfo(Helper|Handler)`, `FirmwareDesc`, `DeviceInfo`, `ECUInfo`.

#### FILE-13 · Komut satırı argümanları — P2 · [O]
- `-convert`, `-play`, `-quickupload`, `-quickfirmwareupload`, `-quickconfigupload`, `-triggerlog <file>`; `vemsTune-c.exe` konsol varyantı. Sınıf `Arg_parser`. Tek örnek kontrolü ("Instance running").

#### FILE-14 · Son dosyalar / geçmiş — P1 · [O]
- `recentfiles.db` (log ve cfg için son 10), `FileListHistoryHelper/Manager`, `RecentVemsFiles`; silinmiş dosya için "Remove it from database?".

---

## 4. Firmware, bootloader ve config transferi (FW)

#### FW-01 · Config Download / Config Download To — P0 · [O]
- ECU'daki config'i okuyup `logs/<ECU>/` altına `.vemscfg` olarak kaydeder (veya seçilen yere). `ConfigDownloadController`, `ConfigDownloadDirector`, `ConfigDownloader(Listener)`, `ReadAllPageCommand`, `ReadPageCommand`.

#### FW-02 · Config upload — P0 · [O]
- `.vemscfg` (veya `mcdmct .txt`) seçilir → parse ("File parsing summary/details") → config oluşturma özeti: ECU serial vs config serial ("Calibration data will not be overwritten" — farklı seride kalibrasyon korunur), Config type PARTIAL/FULL, Default config loaded, table size uyumsuzluğu (12x12→16x14 durumunda onay) → Write → Burn ("Burning config in progress…") → verify. `CfgUploadDlg`, `FirmwareConfigCreator`, `FirmwareConfigManager/UIManager`, `WritePageCommand`, `BurnCommand`, `DataTransferMgr`, `RoundCfgUploadHelperDlg`, `VemsCfg2UploadProgressDlg`.

#### FW-03 · Config verify — P1 · [O]
- Dosya ile ECU içeriğini karşılaştırır; "Verify config was successful!/failed!", ayrıntılar debug tab'ında. `FirmwareConfigDifferences`, `ConfigValidatorHelper`.

#### FW-04 · Filtered config upload — P1 · [O]
- Bir config'in yalnızca filtre dosyasında listelenen anahtarlarını yükler (`configfilters/IAC_ALL.txt`, `OUTPUT_CHANNELS.txt`, `TABLE_VE.txt`, `WBO2_ALL.txt` — her satır bir sembol/tablo adı). "All filter keys missing!", "Configs are identical!". `v3_configfilter.vemscfg`.

#### FW-05 · Audi config upload — P2 · [O label / I davranış]
- Audi (motronic55, 5cyl c270) için hazır config/tablo paketini yükleme; proje mekanizmasıyla ilişkili.

#### FW-06 · Compare Firmware Configs — P1 · [O]
- İki config (kaydedilen vs indirilen) arasında: missing/extra/different scalar & table, intentionally filtered scalars. "Config files are identical / aren't identical. See log tab". `FirmwareConfigDifferences`, `CompareResult`, `MainFrame::compareConfigs`.

#### FW-07 · Firmware upload (basit) — P0 · [O]
- Device / Version / Type (16x14, non-PS2 vb.) / patch dosyaları (Air, Coolant) seçimi; yalnız indirilmiş+kurulu firmware'ler listelenir. Uyarılar: "Turn off fuel pump, remove injector connectors, remove ignition coil fuses… Make sure supply is stable! After firmware upgrade, upload some config. Validate and review config!", "Please preferably use the Firmware Update Wizard instead… you must MANUALLY upload the saved .vemscfg with IDENTICAL DEVICE SERIALNUMBER". Sayfa bazlı yükleme ("Erasing pages…", "Page index: %d / %d", "Uploading firmware: %.1f%%"). Marker word erase (`config/fw/markerword_erase.*`).
- Sınıflar: `SimpleFwDlg`, `SimpleFwPanel`, `AdvFirmwareUploadDialog`, `FirmwareUploader(Listener)`, `FirmwareDirector`, `FirmwareUpgradeClient`, `IntelHex`, `IHexParser`, `FirmwareData`, `FwPath`, `PatchManager`, `PatchUI`, `FirmwarePatchVerifier`. Help `v3/general/firmware_upload.html`, `firmware_upload_1.1.84.html`, `help/firmware-upload.html`.

#### FW-08 · Firmware verify — P1 · [O]
- Flash içeriğini dosya ile sayfa sayfa karşılaştırır ("Result: Firmware is identical/different", "Found patches"). `FirmwareVerifier(Listener)`, `FirmwareVerifyController`.

#### FW-09 · Firmware Patch upload — P1 · [O]
- Sadece coolant/air patch tablolarını yükler ("uhex bootloader only!"). Patch dosyaları `coolantfactor/*.clt|uclt`, `matfactor/*.air|uair` (ör. `cltfactor_2252_256_Celsius`, `airXfactor_2252_256_Celsius`, `airXfactorptc_aref260_425_Celsius`).

#### FW-10 · Firmware Upgrade Wizard — P0 · [O]
- Sayfalar: `FUWWelcomePage` → `FUWDownloadFirmwareListPage` (web'den liste) → `FUWSelectFirmwarePage` (versiyon + patch) → `FUWDownloadFirmwarePage` (session key üret/verify, indir) → `FUWUploadFirmwarePage` (yükle + verify). Otomatik: önce config download, sonra yeni firmware'e config re-upload (aynı seri → kalibrasyonlar korunur); dosya eksikse "Upload an earlier config / Upload a default firmware config / Skip config upload" seçimi. Sınıflar `FirmwareUpgradeWizard`, `FirmwareUpgradeWizardTester` (`FirmwareUpgradeTest.json`), `StateWizardBase/PageBase/SummaryPage`, `bcStateWizardDialog`.

#### FW-11 · Quick Firmware Upgrade — P1 · [O]
- Tek ekran adım listesi: Web check (yeni firmware var mı, yerel cache fallback) → Fw patch check → Config download → Firmware upload → Firmware verify → Config upload & verify. `QuickFirmwareUpgradeDialog`, `QFU_WebCheckPage`, `QFU_PatchFilesCheck`, `QFU_FwConfigDownload`, `QFU_FirmwareUpload(Settings)`, `QFU_FirmwareVerify`, `QFU_FwConfigUpload`, `QFU_Desc`. Komut satırı `-quickfirmwareupload`.

#### FW-12 · Firmware web tool — P0/P1 · [O]
- "Firmware package downloader and installer": sunucudan liste (`?command=list&type=v3firmware`), indir (`?command=url…`), kur (`(round|v3)_firmware_X.Y.Z.zip`), "Install/Reinstall Firmware", "Auto install after download" (pref `fwwebtool_autoinstall`). Kurulu firmware'ler config validation ve configlet'ler için de gereklidir (`config/fw_desc/firmware_X.Y.Z/global.h, my_make.16x14`). Sınıflar `WebInterfacePanel`, `FirmwareWebUpdater`, `FirmwareWebHelper`, `FirmwareWebListItem`, `FwWebToolHelper`, `DownloadProcess`, `DownloaderProcess`, `FirmwareInstallService`, `PackageInstallServiceBase`, `FirmwarePackChecker`, `FirmwaresAndPatchesDescs`, `FirmwareDescJSONLoader`. Help `help/firmware-upload.html`.

#### FW-13 · BootLoader Upgrade Wizard — P2 · [O]
- Bootloader tipini tespit (universal / old / net / invalid), firmware'in yeterliliğini kontrol, session key üret/doğrula (ECU kilitli olmalı, `password_upgrade.txt`), bootloader indir (`v3update.ini` → `bootloaderupgrade.php`), yükle. `BootLoaderUpgradeWizard`, `BootLoaderUpgradeClient`, `BootloaderWebUpdater`, `CheckBootLoaderPage`, `UploadBootLoaderPage`, `CheckDevicePage`. Help `v3/general/bootloader_upgrade.html`.

#### FW-14 · Round emergency revival — P2 · [O]
- Round cihazını boot mode'da yakalama ("Searching… Boot Mode found! / Device not found!"); flood ile [I]. `BootModeDialog`, `BootMode`, `SFlood*`.

#### FW-15 · Boot mode algılama diyaloğu — P1 · [O]
- "Boot Mode Detected — Device:, Stay reason:"; "Cannot leave Boot mode!".

#### FW-16 · Firmware rules / config migration — P1 · [O]
- Firmware sürümleri arası config dönüşüm kuralları ("FW Rules replace result", "has been updated from %d to %d by the rule", "No appliable rules found", "Config replace summary"). `ConfigFwRulesMgr`, `ConfigReplacerMgr`, `Rule`, `PatchDesc(Array)`.

#### FW-17 · Default firmware config'leri — P1 · [O]
- `defaultfirmwareconfigs/` (V3: `config_X.Y.Z.vemscfg`, Round: `round_X.Y.Z.vemscfg`), `calibrations.vemscfg`; eksik anahtarlar default'tan doldurulur ("Loaded default table"). `FirmwareConfigItem*`, `ConfigBase`.

#### FW-18 · VemsCfg2 ve EEPROM ham araçları — P2 · [O]
- "Upload VemsCfg2 type config to the ECU" (TF ile struct bazlı yazım; "firmware on your ECU does not support this kind of config upload"), "Save EEPROM cfg" (`.raweeprom` / `.vemscfg2` üretimi; `EepromCfgHelper`, `EepromCfgSaverV3`, `EepromMapParser`, `EepromReaderTFFormat`, `SramSection*`).

---

## 5. Tuning diyalogları ve tablo/curve editörleri (TUNE)

#### TUNE-01 · INI-driven menü üretimi — P0 · [O]
- `[Menu]` bölümündeki `menu = "…"` / `subMenu = <id>, "<label>"[, page][, {visibility-expr}]` satırlarından menü çubuğu üretilir; `std_separator`; koşullu görünürlük ifadeleri (ör. `{!alphan}`, `{iac_type == 2}`, `{(boost_channel & 8)==0}`) config değeri değiştikçe yeniden değerlendirilir (`UserMenuRefresher`, `MenuRefresher`, `OnRefreshUserMenu`). Özel giriş: `plugIn = "<exe>", "<label>"` (harici araç; Round INI'de VemsLogger). Menü kopyası kontrolü (`DuplicateMenuItemDesc`), `MenuLinkHelper`, `MenuExtendsHandlerBase`.
- Sınıflar: `USER_MENUS`, `UserMenu`, `UserMenuItem`, `UserMenuList`.

#### TUNE-02 · UserDialog renderer (INI `[UserDefined]`) — P0 · [O]
- `dialog = id, "Title"[, layoutHint]`, `field = "Label", symbol[, {enable-expr}]`, `topicHelp = "…"`, panel/kolon düzeni, dialog içinde tablo/curve/CheckboxMatrix/pinout panel (`pinoutPanel = Econoseal36`) gömme, HTML link'leriyle başka diyaloğa gitme, configlet paneli, "Value is out of range. Do you want to set this value [YES] or set limited value [NO] or drop value [CANCEL]?" sınır kontrolü.
- Kontroller: `STViewerTextCtrl`, `STViewerComboBox(Spec)` (bit alanı / enum), `STViewerCBMatrix(2)` (checkbox matris), `STViewerTable(+Row/ColHeader)`, `STViewerStaticText`, `STArrayViewerPanel`, `STMapperViewer`, `OwnBitmapComboBox`, `bc*` özel wx kontrolleri (bcSlider, bcKnobControl, bcCheckBox, bcRadioButton, bcLinkLabel…).
- Sınıflar: `UserDialog`, `UserDialogBase`, `UserDialogFrame(Base)`, `UserDialogList`, `UserDialogManager`, `UserDialogTemplate`, `UserEditField`, `DialogFactoryBase/Manager`, `DialogHelper`, `StaticViewersController` (96 metot), `VemsConfigPanelBase`, `ConfigletPanel`, `DebugPanel`, `UserLogWindow`.
- Kapanışta değişiklik varsa: "Config has been modified. Write changes to ECU (recommended) / Drop changes and refresh config from ECU".

#### TUNE-03 · Read / Write / Burn semantiği — P0 · [O]
- Her editör/diyalog: **Refresh (Alt+R)** ECU'dan oku, **Write (Alt+W)** RAM'e yaz, **Burn (Alt+B)** flash/EEPROM'a kalıcı yaz. Butonlar yazılmamış/yakılmamış veri varsa kırmızı (`tbRead48-active|inactive|warning`, `tbWrite48-*`, `tbBurn48-*`). Tekil hücre değişikliği anında yazılır (immediate write); çoklu seçim değişiklikleri Write gerektirir. Pref `enableWriteBurnAll` ("Always write and burn all changes"). Static Control toolbar (`TbTbStaticControl`). Burn'de otomatik yedek (FILE-11).
- Sınıflar: `STDataMgrBase`, `onBurnListenerIF`, `ChangedSymbol`, `ArrayOfChangedSymbols`, `TableEditorBatchUpdater`, `EditManagerIF`.

#### TUNE-04 · 2D tablo editörü (VEMSTableEditor) — P0 · [O]
- **Özellikler (help `gauges/table_editor.html`, hotkey DB `2dtableevents.db`):** hücre artır/azalt küçük/büyük adım (varsayılan q/w/e/r), imleç hareketi, "Shift+ok" ile kopyalayarak ilerleme, "Ctrl+ok"/Ctrl+tık ile dikdörtgen seçim, grid home/end, hücre kilitle/tümünü kilitle/aç, `i` 4 köşe 2D interpolasyon, değer düzenle, tümünü seç, undo (hücre / tüm grid), seçimi çarp/böl, "Key select load" / **Go to load (Space)**, "Change Table 2D to 3D" (g), Write/Burn/Refresh, **AutoFollow Load**, help göster/gizle, **trail** göster/gizle (Ctrl-T; pref `te_trail_*`), zoom box (sarsıntılı araçta büyük hücre), eksen başlığı düzenleme; eksen sağ-tık menüsü **Edit / Move (interpolate) / Insert** (satır/kolon ekle, sonuncuyu at), **Hide Unused Columns/Rows**, **Remap** (TUNE-09), **Import** (`.vemscfg/.txt/.msq` içinden yalnız tablo), "Set font sizes", hücre arka plan renk gradyanı, mevcut yük işaretçisi.
- Sınıflar: `VEMSTableEditor` (çok sayıda metot: `AutoFollowLoad`, `ChangeSelectedCells`, `DivideSelection`, `drawLoadTrail`, `GetFunctionByKey`…), `TableEditor`, `TableEditorIF`, `TableEditorController`, `TableEditorControlBase`, `TableEditorFactory`, `TableEditorDesc`, `TablePanel(Base)`, `VemsTableDesc(H|List)`, `VEMSCellEditorDialog`, `VemsNumPad`, `SimpleIntMatrix`, `VemsMatrix(Helper)`, `ConfigMgrTableEditorSettings`.
- INI: `[TableEditor] table = id, map3dId, "Title", page` + `xBins/yBins/zBins`, `xyLabels`, `gridHeight`, `upDownLabel`, `smallCellStep/largeCellStep`, `numberWidth/Prec`, `useTableMapper`.

#### TUNE-05 · 3D tablo editörü (OpenGL) — P0/P1 · [O]
- Yüzey render; hotkey'ler (`3dtableevents.db`): döndür sol/sağ/yukarı/aşağı, kamera hareketi, zoom in/out, reset view, eksenleri göster, y-ekseni min/max ayarla (a/s), hücre artır/azalt, seçim, interpolate, undo all, select load, AutoFollow load, copy-move, Write/Burn/Refresh, trail, "Save parameters". Debug kısayolları (R rotate, C coordinate system, Q normals, T net, W wireframe/flat, N/M yaw, J/K pitch, Shift+Y/Ctrl+Y zoom, D debug). Pref: `3dtable_cursor_moving_mode` (relative/absolute), `3dtable_cursor_label_align`, `3dtable_marked_label_align`, `3dtable_fontsize`, trail (`3dtable_trail_enabled|length|sensitivity|line_width|line_color`).
- Sınıflar: `TableEditor3D`, `TableEditor3DParams`, `TableEditor3DConfigHelper`, `TableEditor3DSQLHelper` (`GaugesSettings.db/table3D`: RotationX/Y, ZoomLevel, CameraEye…), `VemsOpenGLTable3D`, `OpenGLDrawer` (91 metot), `OpenGLWidgetBase(2D|3D)`, `OpenGLCamera`, `Surface3D`, `SurfaceRenderer`, `Basic3D(Math)`, `Axis3D`, `Marker3D`, `Trail3D`, `Point3D/4D`, `Primitive3D`, `OGLFT` (font), `TE3D_Align/CursorMovingMode/Font`.

#### TUNE-06 · SuperTable (alpha-N / speed-density otomatik tablo seçimi) — P0 · [O]
- `[SuperTable] supertable = veTable, veTable3D, "VE Table"` + `table = veTableTbl, {!alphan}` / `table = veTableTblTPS, {alphan}`: koşula göre MAP ya da TPS eksenli tabloyu gösterir. Kullanılan: VE, Camshaft inlet/exhaust target, Knock noise. "Change Table To" menüsü. Sınıflar `SuperTable`, `SuperTableDescriptor(H)`, `SuperTableRecord`.

#### TUNE-07 · Curve editörü + SuperCurve — P0 · [O]
- Grafik üzerinde nokta sürükleme + değer kutuları; hotkey'ler (`curveeditorevents.db`): artır/azalt küçük/büyük, hücreler arası gezinme, sonraki hücre, seçili hücreleri interpolate, kolonu seç, seçimi sola/sağa taşı, seçimi yukarı/aşağı genişlet. Sağ-tık "Change Curve To" (SuperCurve varyantları, ör. CrankEnrich_low/mid/high koşula göre), dosyadan import (drop), configlet paneli, ECU güncelleme timer'ı (anlık yazma).
- Sınıflar: `CurveEditor` (94 metot), `SuperCurveEditor`, `SuperCurveDescriptor(H)`, `SuperCurveRecord`, `Curve(A)`, `CurveDescValidator`, `VemsCurveDialogDesc(H)`, `Graph`, `GraphNode(Set)`, `ColumnDesc`.
- INI: `[CurveEditor] curve = id, "Title"` + `columnLabel`, `xAxis/yAxis`, `xBins/yBins`, `xBinsSteps/yBinsSteps`, `gauge`; `[SuperCurve] supercurve = id, "Title"` + koşullu curve listesi.

#### TUNE-08 · Filtered table editor — P1 · [O]
- Kullanılmayan satır/kolonları gizleyen görünüm (model↔view indeks eşleme, batch update). `FilteredTableEditor` (Hide Unused Columns/Rows, `SetCellsMin/MaxValue`, `LoadConfig/SaveConfig`).

#### TUNE-09 · Table Mapper (Remap) — P1 · [O]
- Tablo başlıklarını (bins) değiştirip değerleri yeniden interpolasyonla eşleme (ekstrapolasyon yok; azalan sıra kontrolü: "Value is greater than next / lesser than previous"). Fw ≥1.1.49'da tablo başına ayrı bin; eskide tüm bağlı tablolar remap edilir (`[TableMapper] name=TableMapperVE/Lambda/Spark`, `zBins = sparkTable, boostRefDCTable`). 12x12→16x14 config taşıma senaryosu. Sınıflar `TableMapper`, `TblMapDesc`, `STMapperViewer`, "Current RPM/MAT headers / Insert row" (`ArrayEditorDialog`). Help `gauges/table_mapper.html`, `help/tableMapper.html`.

#### TUNE-10 · Tablo/curve import — P1 · [O]
- Seçili tabloyu `.vemscfg`, `.txt` (mcd), `.msq` dosyasından alma; diğer değerler yok sayılır.

#### TUNE-11 · Table Compare 3D — P1 · [O] · [YAPILDI → `components/TableCompare3D.tsx`, spec `TABLE-COMPARE-3D.md`]
- İki tabloyu 3D karşılaştırma: File 1 / File 2 / "Load from VT"; mod: File 1 + File2 / + Difference; "Show info", "Reset Display", load type seçimi, simülasyon kutusu. Sınıflar `TableCompare3D`, `TableCompare3DFrame`, `TableCompare3DGLCanvas`. Gauge tipi `table3dcompare`.

#### TUNE-12 · Load trace / trail / autofollow — P0 · [O]
- 2D/3D tablolarda mevcut çalışma noktası işaretçisi ve iz (CTRL-T), AutoFollow. Welcome sayfasında "Load following trace in 2d and 3d tables".

#### TUNE-13 · Configlets — P1 · [O]
- Diyalog/curve'e hazır değer setleri uygulama (`configlets/<dialogId>/<name>.txt`, `symbol=HEX` satırları). Klasörler ve dosya sayıları: `trigger` (48 motor/tetik deseni: 4cyl 60-2, 36-1, 24-1, C004, Honda F20C/K20, Audi c270, Porsche 944, BMW M20/S54/double Vanos, Chrysler Viper/Hemi, Fiat Stilo, Lancia Cosworth, Maserati z012, Mazda NB, Mitsubishi Evo, Nissan SR20/Skyline, Rover-K/Elise e324, Subaru 36-2-2-2 / 6+7, Suzuki, wankel 2/3 rotor), `knock1` (7: Disabled, All Ch 1/2, Alternating, Log Only varyantları), `knockcalib` (1), `wideband` (3: Heater-PID, Pump-PID, Warmup), `analoginput` (4 sensör), `analoginputcurve`/`analoginput2curve` (linear, VEMS standard MAT), `coolantCurveDialog`/`coolantSensorCurve` (Bosch standard CLT), `matCurveDialog`/`matSensorCurve` (Standard, VEMS standard MAT), `warmup_enrichment_coolantBins`, `injector_angle` (cam sync var/yok), `injtrim`, `spark_delay`, `inputcal` (EGT-ch0), `soft_fuel_cut` (disable), `anytrim1_curve_mcp_fuel` (115KPa), `pwm0_settings`/`pwm4_settings` (Round reduction temp control), `disp_mode`, `displaydemo`, `ledDisplayDemo` (5), `aimmenu1`, `important` (3). Sınıf `ConfigletPanel`.

#### TUNE-14 · Görsel çıkış/tetik diyalogları — P0/P1 · [O]
- **Primary Trigger Settings Visual** (`triggerSettingsVisual`): diş çarkı çizimi, hesaplanan değerler (Next Trigger Tooth, Trigger Teeth Sequence, Angular Width of Tooth), model uyumsuzluk uyarıları, "Recommended reference tooth table", ELISE özel durumu. `TriggerSettingsVisualPanel/Ctrl`, `TriggerSettingsPanel(Helper)`, `TriggerGearPanel`, `TriggerMap`. Help `v3/v3_primary_trigger_settings_visual.html`.
- **Injector outputs visual** (`injOutVisual`): injector group tablosu (kırmızı ok ateşleme sırası), real cylinder order, rotate, Econoseal 36 pinout, **Testing mode** (çıkış test — "switch off Testing mode!"). 
- **Ignition outputs visual** (`ignitionOutputsVisual`): firing order, Dual Output Mode, shift outputs up/down, h[2] tablosu, Econoseal 18/36 pinout, Testing mode. `IgnitionOutputPanel(Ctrl)`, `FiringOrderPanel`, `PhysicalOrderPanel`, `RealCylinderOrderViewer`, `CylinderOrders`, `EconosealPanel`.
- **Assign Output Channels** (`outputChannels`): kanal adı / çıkış tipi / dual? tablosu, çakışma ve geçersiz kanal raporu, `outputchannels.s3db` (output types: Injector group, SPECFET extra, I259 ignition, S259 stepper, P259 low current, Aim out; 41 kanal/pin). `OutputChannelsCfg(Ctrl)`, `OutputChannelSQL`, `OutputType`, `ChannelValidationHelper`, `ChannelCollision`.
- Help: `v3/v3_injector_outputs.html`, `v3_ignition_outputs*.html`, `v3_output_channels_visual.html`, `help/visual-injector-output-settings.html`, `v3/general/v3_econoseal_pinout.html`.

#### TUNE-15 · CheckboxMatrix — P1 · [O]
- `[CheckboxMatrix] name=injGroupDialog`: 8 INJGroup × 8 bit, `maskOrder`, `maskPinout`, `maskTitle`, `pinoutPanel = Econoseal36`. `CheckBoxMatrix(2)`, `CheckBoxMatrixViewer(2)`, `CheckBoxMatrixDesc`, `CheckBoxPos`.

#### TUNE-16 · InterpolationWidget — P1 · [O]
- Bir ölçekleme fonksiyonunun (min/max sembollerle tanımlı doğrusal) grafiği + realtime nokta: `warmup_rpm_scaling`, `warmup_map_scaling`, `lambda_egt_corr`, `iac_target_rpm`, `sparkAls1/2`, `sparkCold1/2`, `sparkCrank2`. `InterpolationWidget(+AxisDesc, DescH, Descriptor, InputField, TextCtrl)`, `InterpolateViewerData`.

#### TUNE-17 · Lock diyalogları (canlı override) — P1 · [O]
- **Ignition Lock**: ateşleme avansını 0-63° sabitle (0/kapat = devre dışı) — `Manmda%02Xmbye`. `IgnitionLockFrame/Panel`.
- **IAC Lock**: IAC pozisyonunu 1-255 sabitle; uyarı: PWM/Stepper min/max sınırları kilidi engelleyebilir; IAC position, target rpm. `IACLockPanel`. Help `main/tools/iac_pic_control.html`.
- **Tachometer Lock**: takometre frekansı 0-3900 (-1 kapat). `TachometerLockPanel`.
- **IAC Control (PID test)**: `IACControl`, `IACControlPanel`, `IACHistory` (Start/Stop, P/I/target RPM).
- **VVTI Camshaft Table Lock**: pref `vvti_camshaft_lock_enabled`, `vvti_camshaft_lock_difference`; `CamshaftTableLockViewer`.

#### TUNE-18 · ECU Setup Wizard — P1 · [O]
- Sayfalar: Welcome ("Use config if available") → Req fuel hesaplama (cyl sayısı, displacement, injector flow, fuel type; geçerli aralık 0-25.5) → Cylinder/firing order (fiziksel ↔ ateşleme görünümü, ilk silindir after sync, injector/ignition çıkışı atama) → Trigger settings (TDC after trigger, tooth sayıları, missing tooth/coil type notları) → Finalize (hangi ayarlar kaydedilsin, Send/Burn). Sınıflar `ECUSetupWizard`, `ECUSetupWizardPageBase`, `ECUSetupWelcomePage`, `InjectorSizePage`, `CylinderOrderPage`, `TriggerSettingsPage`, `FinalizeSettingsPage`, `CarConfigHelper`, `CarParameters(H)`.

#### TUNE-19 · Torque config — P2 · [O]
- Drivetrain parametreleri (`/torqueConfig/drivetrain`: wheel radius, mass, aNull, fNull…) — race analyzer'da tork/güç hesabı. `TorqueConfigFrame`.

#### TUNE-20 · Diyalog düzen kalıcılığı — P2 · [O]
- `dialogLayout.db` (pozisyon/boyut/maximized), `DialogsLayoutManager`, `SizePosDialog` ("Set size and position"), `WindowReg`, `FrameLayoutHandler`, `ConfigMgrFrameLayout`.

#### TUNE-21 · V3 tuning menü ağacı (vemsTune-v3-1.2.33.ini) — P0 · [O]

| Menü | Giriş (label) | INI id | Tip | Koşul | Help |
|---|---|---|---|---|---|
| Base Setup | Engine Setup | constants | dialog | | v3/v3_engine_setup |
| | Alpha-N / Speed-Density Settings | blending | dialog | | v3_alphan_settings |
| | Primary Trigger Settings | trigger | dialog | | v3_primary_trigger_settings |
| | Primary Trigger Settings Visual | triggerSettingsVisual | visual dialog | | v3_primary_trigger_settings_visual |
| | Secondary Trigger Settings | trigger2 | dialog | | v3_secondary_trigger_settings |
| | Trigger Reference Tooth Table | hone | dialog (tablo) | | v3_reference_trigger_tooth |
| | Injector Settings | injectors | dialog | | v3_injector_settings |
| | Injector deadtime curve | injector_dead_time | curve | `(config11 & 2)==2` | v3_injector_settings |
| | Injector Outputs Visual | injOutVisual | visual | | v3_injector_outputs |
| | Injector trim | injtrim | dialog | | v3_injector_trim |
| | Injector angle curve | injector_angle | curve | | v3_injector_angle |
| | Injector Staging | staging | dialog | | v3_injector_staging |
| | Ignition Settings | ignition | dialog | | v3_ignition_settings |
| | Ignition Outputs Visual | ignitionOutputsVisual | visual | | v3_ignition_outputs_visual |
| | Cyl separated Spark delay | spark_delay | dialog | | v3_spark_delay |
| | Gear or Speed dependent Spark retard | fix_retard | dialog | | v3_g_s_fix_retard |
| | Wideband Settings | wideband | dialog | | v3_wideband_settings |
| | Wideband Calibration | wbo2Calibration | dialog | | v3_ecu_calibration |
| | Rev Limit / Overrun / Safety | softrpm_dlg | dialog | | v3_rev_limit |
| | Adjustable Fuel Cut | soft_fuel_cut | dialog | | v3_soft_fuel_cut |
| | EGO Closed Loop Control | egocontrol | dialog | | v3_ego_control |
| | EGO correction banks (temporary) | egobanks | dialog | | — |
| | ECU Calibrations | calibration | dialog | | v3_ecu_calibration |
| | Speed Sensor | speedsensor | dialog | `!PS2KEYBOARD` | v3_speed_sensor |
| | Config/Table switching | confswitch | dialog | | v3_config_switch |
| | Knock Sampling / Knock Action / Knock channels | knock / knockact / knock_channels | dialog | `!KNOCK_ALTERNATIVE` | v3_knock_control |
| | Busy Loop Stimulation | busyloopstimulation | dialog | `BUSYLOOP_STIMULATION` | — |
| | Electronic Throttle Control | etcSettings | dialog | | v3_electronic_throttle_control |
| | ETC Integral Action Window curve / ETC Reference DC (Spring comp) / TPS 2 / PPS 2 calibration curve | etc_i_err_scalecurve / etc_refcurve / etc_tps2tablecurve / etc_pps2tablecurve | curve | `{enable_etc}` | 〃 |
| | ETC Target table / ETC Target table when ALS | etctargetTbl / etctargetalsTbl | table | `{enable_etc}` | 〃 |
| &Tuning | VE Table / VE Table3D (USE_SUPER_TABLE) veya RPM/MAP Fuel VE (+3D) / RPM/TPS Fuel VE (+3D) | veTable / veTableTbl / veTableMap / veTableTblTPS / veTableMapTPS | supertable / table | `alphan` | v3_tuning_menu |
| | RPM/MAP Ignition (+3D) / RPM/TPS Ignition (+3D) | sparkTbl/sparkMap/sparkTblBlend/sparkMapBlend | table | `ignlambdaYaxis` | 〃 |
| | RPM/MAP Lambda (AFR) target (+3D) / RPM/TPS Target Lambda (AFR) (+3D) | lambdaTbl/lambdaMap/lambdaTblBlend/lambdaMapBlend | table | `USEAFR147`, `ignlambdaYaxis` | 〃 |
| | MAT/TPS Fuel Enrichment (+3D) | matTbl/matMap | table | | 〃 |
| | MAT/TPS Ign. Retard (+3D) | matTpsRetardTbl/Map | table | `!matretard` | 〃 |
| | RPM/MAP MAP corr (+3D) | mapCorrTbl/Map | table | `alphan` | 〃 |
| | CLT/MAP Ign. Adjust / CLT/TPS Ign. Adjust | cltignadjTbl_MAP/_TPS | table | `alphan` | 〃 |
| | Acceleration Enrichment | accenrichment | dialog | | v3_acceleration_enrichment |
| | Accel. dTPS/dMAP Enrich / Accel. RPM Enrich | AccelEnrichCurve3 / AccelEnrichCurve2 | curve | | 〃 |
| &Starting / Idle | Priming, Cranking, Afterstart Setup | startup | dialog | | v3_cranking |
| | Cranking / Afterstart / Warm-Up Enrichment Curve | CrankEnrich / AfterStartEnrich / WarmUpEnrichment | supercurve/curve (low/mid/high varyant) | max değerine göre | v3_starting_idle_menu |
| | Idle Control General / PID / AC / Ign. Advance / Spark-Cut Based | idlecontrol / idle_pid / idle_ac / ignidlecontrol / sparkidle | dialog | | v3_idle_settings, v3_idle_pid, v3_idle_ac, v3_idle_ignition, v3_idle_spark_cut |
| | Idle PWM / Stepper Hardware Settings | idle_pwm / idle_step | dialog | `iac_type==2/3` | v3_idle_pwm_hardware / v3_idle_stepper_hardware |
| | Idle Reference Cranking / Idle Reference Curve | iacrefboth / IACrefposSuper | dialog / supercurve | `iac_type 2|3` | v3_idle_cranking |
| | Stepper on injection output common/iac/wbo2 | inj_stepper_* | dialog | `USE_INJ_STEPPER` | — |
| Boost Control | Boost PID Settings | boostcontrol | dialog | | v3_boost_control_pid |
| | Boost Target TPS Scaling | BoostVsTpsCurve | curve | kanal koşulu | 〃 |
| | Boost Target vs RPM / vs Speed Curve, Gear dependent Boost Target | BoostCurve / boostTargetSpeed / BoostTable | curve/table | `boost_conf_*` | 〃 |
| | Boost refDC vs RPM / vs Speed, Gear dependent refDC, Boost Target dependent RefDC | boostRef / boostRefDCSpeed / BoostRefGearTable / BoostRefTgtTable | curve/table | `boost_more_targetref` | 〃 |
| | Secondary PWM Settings | boostalternate | dialog | `!enable_etc` | v3_alternate_boostcontrol_settings |
| | Secondary PWM relative/absolute (+3D) | boostAltTableRel(3D) / boostAltTable(3D) | table | `boost_conf_mode` | 〃 |
| | Pgas boost target table | BoostTablePgas | table | `WOODGAS_CONTROLLER` | — |
| &Outputs | Assign Output Channels | outputChannels | visual | | v3_output_channels_visual |
| | Misc Output 1 / 2 Settings | outputs1 / outputs2 | dialog | | v3_misc_output_settings |
| | WOT / RPM Actuators | actuators | dialog | | v3_wot_rpm |
| | Fan / Water Pump / FuelPump | fan_pump | dialog | | v3_fan_water_pump |
| | Display Settings | lcdsetup | dialog | | v3_display_settings, v3_lcd_pages |
| | Tach / BoostGauge | tachsetup | dialog | | v3_tach_boostgauge |
| | Warning Light | warning | dialog | | v3_warning_light |
| &Motorsports | WOT Shift-Cut | shiftcut | dialog | | v3_shiftcut_settings |
| | Gear position voltage table | drumsensor | dialog | `shiftcut_conf_drumsensor` | 〃 |
| | ALS Control | adv_als | dialog | | v3_als_control |
| | N2O Control | n2o_setup | dialog | | v3_n2o |
| | Trans Brake Creep | trans_brake_creep | dialog | | v3_transbrakecreep |
| | Launch Control | launch_dlg | dialog | | v3_launch_control |
| | Launch RPM Curve | roadSpeed_vs_RPM_Curve | curve (speed veya time base) | `als_launch_input` | v3_launch_curve |
| | Anytrim Control | anytrim_dlg | dialog | | v3_anytrim_control |
| | Anytrim1…5 Curve | anytrimN_s_curve | supercurve (giriş tipine göre ~180 curve varyantı/her biri) | `anytrimN_type_raw` | 〃 |
| | Rotary trailing spark curve | rotary_trailing_spark_curve | curve | | v3_rotary_trailing_curve |
| | Camshaft angle control | camshaft_angle_control | dialog | | v3_camshaft_angle_control |
| | Camshaft Inlet/Exhaust target table (+3D) | camshaftangle1table / 2table | supertable | kanal≠15 | 〃 |
| &Woodgas | Flaps sequence | flaps | dialog | `WOODGAS_CONTROLLER` | — |
| &ECU Logger | ECU Log Settings | eculog | dialog | | v3_ecu_logger |
| Inputs | Input Channels | allinputs | dialog | | v3_inputs_menu |
| | Analog Input Calibration / Calibration2 | inputcal / inputcal2 | dialog | | v3_analog_input_calibration, v3_VemsDisplay_calibration |
| | Analog Input Multiplexer | inputmux | dialog | | — |
| | CLT / MAT sensor Curve dialog | coolantCurveDialog / matCurveDialog | dialog | | — |
| | Coolant / Mat Sensor Curve | coolantSensorCurve / matSensorCurve | curve | `{clt_type}` / `{mat_type}` | — |
| | Custom temperature sensor | customCurveDialog | dialog | | — |
| | Knock Sampling / Channels / Gain and Ref / Knock Noise Table (+3D) | knock1 / knock_channels / knockcalib / knockTbl(3D) | dialog/supertable | `KNOCK_ALTERNATIVE` | v3_knock_control |
| | VVT-i Settings / Target Table / Target Map | vvtisettings / vvtiTbl / vvtiMap | dialog/table | `TOYOTA_1JZ_VVTI` | — |
| &AT | Shift UP 1-2/2-3/3-4, Shift DN 2-1/3-2/4-3, Lockup Lock/Unlock, PWM Map, AT Control 1/2, AT in/out, AT sensor Curve | shiftup_* … atCurveDialog | curve/dialog | `A340E` (Toyota A340E otomatik şanzıman) | — |

- Menüde olmayan ama tanımlı diyaloglar: `vtareadialog` (VT Area dialog), `boosttpsTbl`, `hzero` (Injector Outputs), `htwo`/`htwodual` (Ignition Outputs Table, Dual Out), `htwo_dummy`, `ignition_cylinder_map`, `idle_both`, `iacref`, `iacrefpct`, `allchannels`/`allchannels2` (Output Channels 1/2), `widebandCalibration`, `TPSCalibration` (adv frame'lerden açılır), `CrankPulsewidth`, `IACrefpos/IACrefposStep`, AT curve'leri.

#### TUNE-22 · Round menü ağacı (vemsTune-round-1.5.10.ini) — P1 · [O]
| Menü | Girişler (INI id) | Help |
|---|---|---|
| &Display | Main Display Settings (roundMainDisplay → özel `Round Main Display Settings` paneli), Display Settings (display), Display Peak Hold Settings (disp_peak), Display Demo Visual (ledDisplayDemo → `Round Display Demo Settings`), Display Demo (displaydemo), Display Mode (disp_mode, obsolete), AIM custom settings (aimmenu1, obsolete) | round/round_main_display_settings, round_display_settings, round_display_peak_hold_settings, round_display_demo, round_display_mode, round_aim_custom_settings |
| &Analog | Analog Output (analogoutput), Analog Input Settings (analoginput), Analog Input Curve / Analog Input 2 Curve | round_analog_output, round_analog_input_settings, round_analog_input_curve |
| Advanced | Wideband Settings (wideband), Wideband Controller PID (wideband_pid), EGT Input settings (egtinput), RPM Input settings (rpm_settings) | round_wideband_settings, round_wideband_controller_pid, round_egt_input_settings, round_rpm_input_settings |
| &Boost Control | Boost/Idle/Lambda settings (+ on PWM0 / PWM4), reference DC curve, Boost target curve, Idle target curve, Lambda target curve, Egt target curve (mod bitlerine göre görünür) | round_boost_idle_lambda_settings, round_boost_target_curve, round_idle_target_curve, round_lambda_target_curve, round_reference_dc_curve, round_control_loop |
| T&ools | `plugIn` "&VemsLogger Viewer" (`tools\VemsLogger.exe`) | — |
- Round donanım/kontrol döngüsü sayfaları: `round/round_hardware.html`, `round_control_loop.html`. Round için ayrı GUI setleri: `Round-*.db`, `Round-gauges*.db`, `Round-ConfigCriteria.xml`, `Round-pdascreen.xml`, `Round-FlagDesc.xml`.

#### TUNE-23 · Diğer cihaz INI'leri — P2 · [O]
- `vemsTune-Arm-0.0.01.ini` (menü "&Base test": test dialog1/2 — ARM tabanlı yeni cihaz prototipi), `vemsTune-aim.ini` (AIM kanal OutputChannels: rpm, wheelspeed, oil, water, fuel pressure, battery, throttle, MAP, ACT, EGT, lambda, fuel temp, gear, errors), `cockpit-v3-1.1.27.ini`/`vemsv3pda.ini` (Settings: Basic Settings/Constants; Extras: Idle Settings General — PDA/cockpit sadeleştirilmiş UI).

---

## 6. Config doğrulama (VAL)

#### VAL-01 · Config Sanity Check (Validate Config) — P0 · [O]
- Toolbar "yeşil boru" ikonu (`check-48-grey|gold|green|red|red-broken.png`; `TbTbConfigValidate`) ve otomatik kontrol (pref `auto_config_sanity_check`, config yüklenince). `ConfigCriteria.xml` (V3, ~148 kural) / `Round-ConfigCriteria.xml`: `<Variables>` (türetilmiş değişkenler ör. `isMissingTooth`, `NCYL`, `h2_0..7`, `kpa_range`) + `<Validate><Rule key=… warningMsg=…><Item type="warning|error">expr</Item>`. Sonuç penceresi: üstte mesaj listesi, altta detay + mavi link ile ilgili diyaloğu açma; özet (rules/passed/warning/error); "There are too many validation errors/warnings". Firmware descriptor gerektirir (FW-12).
- Sınıflar: `ConfigValidator`, `ConfigValidatorBase`, `ConfigValidatorMgr`, `ConfigValidatorHelper`, `ConfigValidatorViewerBase(A)`, `ConfigCriteria`, `ConfigCriteriaParser/Data/Range`, `CondTree`, `TbTbConfigValidate`, `VemsMsgListCtrl`. Help `help/validate-fw-config.htm`, `main/intro.html`.

#### VAL-02 · Output channel collision & invalid channels — P0 · [O]
- "Following collisions are found: … conflicts with …" + linkler (`injOutVisual`, `ignitionOutputsVisual`, `outputChannels`); "Following channels are invalid"; IAC stepper sequence kanalları, kamera kanalları (dual), staging. `ChannelValidationHelper`, `ChannelCollision`.

#### VAL-03 · Trigger Settings Validation — P1 · [O]
- `TriggerSettingsValidation.xml` (variables + rules: tooth_wheel_twidth, totaltooth, elise_trigger…) → "Trigger Settings Validation Result / All settings are OK". `TriggerSettingsValidatorBase/_CC/_NT/GUI`.

#### VAL-04 · INI/sembol tutarlılık kontrolleri — P2 · [O]
- "Symbol bits check", "Invalid values", "Unused symbol", "Some possible values of the symbol are not enumerated in the INI file", "This symbol is not used by any dialog", "Check INI file". `ItemStatusCheckerBase`, `ContentValidatorContainer`, `IValidator`.

#### VAL-05 · MTConfigChecker (dev) — P2 · [O]
- INI'deki her UserDialog/UserMenu/TableEditor'ın sembollerini kontrol eder (`configVerify-*` log): "Dialog not found", "xSTSymbol not found", "warning - xRTSymbol". `MTConfigChecker`, `OperationChecker`, `OpCheckDialog`.

#### VAL-06 · Realtime veri kontrolü — P2 · [I]
- `RealtimeDataChecker`, `RequiredCacheAndStat`, "WARNING - Dependency(%s) of an expression(%s) is missing".

---

## 7. Realtime gauge'ler ve dashboard'lar (GAUGE)

#### GAUGE-01 · Gauge/widget tipleri — P0/P1 · [O]
Gauge type string'leri (WidgetFactory) ve DB'deki kullanım sayısı (`gauges-1366x768.db`, 387 gauge):

| Type (UI adı / DB) | Sınıf | Ne gösterir | Öncelik |
|---|---|---|---|
| `VemsGauge` (Round analog) — 103 | `VemsGaugeAgg` (AGG render) | İbreli yuvarlak gösterge; descriptor: StartAngle/EndAngle, Lo/Hi, Major/MinorDiv, scale, renkli alanlar (colored areas), title/unit/value açı-pozisyon-yükseklik, numformat, min/max ibre (F11 tek, F12 grup reset) | P0 |
| `Digital` — 118 | `VemsGaugeDigital` | 7-segment dijital değer (`7 Segment` font, `TitleTextHeightDigi`) | P0 |
| `Text` — 93 | `VemsTextWidget` | Etiket+değer metin | P0 |
| `Graph` — 13 | `VemsGraphWidgetAgg` | Zaman serisi grafiği; hotkey: M marker göster, S marker konumu, H bölüm çizgileri, V bölüm değerleri, history uzunluğu, font size, help (`vemsgraphwidgetaggevents.db`); `GaugesSettings.db/Graph` | P0 |
| `Graph (GL)` / `GraphHWA` | `VemsGraphWidgetOpenGL` | OpenGL (hardware accelerated) grafik varyantı [I] | P2 |
| `ArcBar` — 5 | `ArcBarGauge` | Yay şeklinde bar | P1 |
| `Differ` — 13 | `DifferentialGauge` | İki sembol farkı (Lambda target–Lambda, EGO corr, IAC target RPM–RPM, ETC…; `DiffGaugeDesc.db` profilleri); hotkey: tick numbers, değer konumu sol/sağ | P1 |
| `ColumnsGauge` — 3 | `ColumnsGauge` | Çok kolonlu bar (Throttle, Individual Power `rpmdiff0-7`, Pulse Width, Knock `knockval0-7`; `ColsGaugeDesc.db`) | P1 |
| `Flag` | `VemsFlagWidget(Set)` | ECU durum bayrakları (DB'de 53 flag, 5 grup) | P0 |
| `MultiGraph` | `MultiValueGraph(OpenGL)` | Log viewer (LOG-05) | P0 |
| `table` — 9 | `VEMSTableEditor` | 2D tablo editörü gauge olarak | P0 |
| `Table 3D` / `table3d` | `TableEditor3D` | 3D tablo | P0 |
| `SuperTable` / `SuperTable3D` — 2/2 | `SuperTable*` | Koşullu tablo | P0 |
| `Curve` — 4 | `CurveEditor` | Curve editörü gauge olarak | P0 |
| `Table 3D Compare` | `TableCompare3D` | TUNE-11 | P1 |
| `ExpressionGrid` — 12 | `VemsExpressionGridWidget` | Calc model ızgarası (CALC-03) | P1 |
| `GPS Compass` (`Compass`) | `GPSCompassGauge` | Heading | P2 |
| `GPS route` | `GPSRouteGauge` | Harita + rota (GPS-03) | P2 |
| `Custom expression` (`CustomValue`) — 3 | `CustomValueGauge` | printf formatlı çoklu değer (GAUGE-09) | P1 |
| `ICON` (PDA ekranı) | `ScreenIcon`, `ExitIcon`, `FileIcon`, `GPSIcon`, `HideIcon`, `StateIcon`, `SelectInputIcon`, `DevicesIcon` | PDA/fullscreen ikon butonları | P2 |
| Diğer widget'lar | `VemsDynamicBar`, `SimpleLED`, `SmallDoubleLED`, `LEDDisplay` (Round 7-seg demo), `Vems2DHistogramWidget`/`zoom2dhistogram`, `VemsSignalGridWidget`, `VemsStateWidget`, `VemsGridWidget`, `GridByTime`, `FunctionMeter`, `KnockViewer`, `ShowSparkPhaseWidget`, `ShowSparkPWidget`, `CustomSlider`, `NumValueBoxes` | Özel araçlarda kullanılan görselleştiriciler | P1/P2 |

- Fabrika/altyapı: `VemsWidgetBase`, `VemsWidgetBaseFactory`, `WidgetFactoryBase/Manager`, `UserConfigGaugeFactory/Base/Desc`, `SelectableWidgetBase`, `SelectableWidgetRendererAgg/Base`, `ShapedWidgetBase`, `BitmapCanvas*`, `agg` (Anti-Grain Geometry), `RTDataViewerBase`, `RTSymbolViewer`, `RTSignalViewerBase`, `ThemeAble(Base)`.

#### GAUGE-02 · Gauge grupları (ekran düzenleri) — P0 · [O]
- `gaugegroups.db` (`groups`: name, hotkey, sticked, theme, show_on_startup, floated, settofocus_gaugeid, show_on_startup_online, show_on_startup_offline_cfg, short_name, dont_use_mincorner; `multigauge`; `backgrounds`) + çözünürlüğe göre gauge yerleşim DB'leri (`gauges-1024x768.db`, `gauges-1280x800.db`, `gauges-1366x768.db`, AIM/Round varyantları; `Igauges\-(\d+)x(\d+)\.db` deseni). Eski XML: `gauges.xml`, `GaugeDescriptors.xml`.
- Önceden tanımlı 21 grup: VE / Fuel Table 2D (Alt+1), Ignition 3D (Alt+2), Lambda Table 3D (Alt+3), VE / Fuel Table Adv (Ctrl+5), Ignition 2D (Ctrl+2), Lambda Table 2D (Ctrl+3), GPS (Shift+2), Log Viewer (Shift+8), Main Overview (Shift+1), Analog Inputs Raw, Analog Inputs All (Alt+9), Calc Model (Shift+5), IAC (Alt+I), Injector Calibration (Alt+5), VE / Fuel Table 3D (Ctrl+1), Config Overview, Woodgas Egt, Analog Custom, Boost, Knock, ETC.
- Grup davranışı: single/multi açık grup (pref `gauge_groups_behav`, `max_open_group`=5), "Sticked" grup, floating over mainframe / attach within mainframe / grup ayarına göre (`gauge_groups_float_behav`), "Show on startup when loaded log / config / ECU online", "Set focus after show group". Gauge Groups toolbar: grup seç, "Stick the group", "Add new icon", "Remove icon".
- Sınıflar: `GaugeGroupManager(SQL|IF)`, `GaugeGroupDesc`, `GaugeCarrierBase(Desc)`, `GaugeCarrierPanel`, `GaugeCarrierFrame`, `GaugeCarrierMDIChildFrame`, `GaugeCarrierAuiMDIChildFrame`, `GaugeCarrierAdvFrame`, `GaugeSetHelper`, `GroupMember(Object)`, `TbTbGaugeGroup`. Help `main/gauge_groups.html`, `main/view/gauge_groups.html`, `help/gaugeGrouping.htm`.

#### GAUGE-03 · Edit mode — P0 · [O]
- Toolbar "On/Off Edit mode" / "Save gauges layout and switch to View mode" (`TbTbEditMode`). Bağlam menüsü: Add new gauge (tip listesi), Selected only, Export gauges to file / Import gauges from file (XML), Copy (Ctrl+C) / Paste (Ctrl+V), Set theme for selected gauge / all gauge in group, Select all (Ctrl+A), Delete selected / Delete selected (no ask) (Shift+Delete), Save gauges layout (Ctrl+S), Fit gauges to window, Background settings, Show background image in Edit mode, Switch to View/Edit mode, Set full screen / Return from full screen. Gauge sağ-tık: Change gauge data (sembol), Change gauge descriptor, Modify descriptor, Set Size and Positions (X/Y), Duplicate to…, Close window. Taşıma: main frame içinde Ctrl+mouse, resize Shift+Alt+oklar; ayrı frame'de çift tık ile çerçeve. Edit mode help `config/editmodehelp.html`. Pref `editmode_savepolicy` (nosave/current/all), `show_bgimage_editmode`.

#### GAUGE-04 · Gauge Groups Editor — P1 · [O]
- Grup listesi + "Duplicate", "Remove", "Show"; özellikler: Name, Short name, Theme, Hotkey ("assigned to:" çakışma), Sticked, Floating, Show on startup (log/config/online), "Do not use minimum corner optimization", "Save properties". `GaugeGroupEditor`.

#### GAUGE-05 · Gauge descriptor editor — P1 · [O]
- Seçili gauge'ün descriptor'ını düzenleme ("Current gauge descriptor name", Save As, "Add new area" — renkli bölgeler, min/max, scale factor, major divisions). Alan tanımları `GDDesc.xml` (sayfalar: Main, Title, Value, Unit, Ticks…; her alan min/max/factor/valid=VemsGauge|Digital). DB `GaugeDescriptors.db` (`descriptors` 102, `colored_areas` 125, `symbols` 204, `symbolgroups` 16). Sınıflar `VemsGaugeDescDialog`, `NewGaugeDescriptorDialog`, `GaugeDescManager(SQL)`, `GaugeDescHelper`, `VEMSGaugeDesc`, `GDDesc`, `DescItemDesc`, `ColoredArea(Edit)`, `GaugeProperties`, `VemsWidgetBaseEditor(Base)`, `DescEditorReopener`.

#### GAUGE-06 · Add new symbol descriptor — P1 · [O]
- 1) Available symbols (with/without descriptor, show hidden), 2) symbol group, 3) gauge descriptor type (yeni tip yazılabilir → `<symbol><type>Gauge` descriptor otomatik), 4) title → Create. `SymbolMgr`, `SymbolGroup`, `IPredefinedSymbolHelper`/`PredefinedSymbolHelper` (predefinedMetric/Imperial). Help `main/view/add_new_symbol_descriptor.html`.

#### GAUGE-07 · Differential gauge descriptor editor — P1 · [O]
- Profil: name, min/max; semboller (ad, renk, custom title); "New profile", "Save new", "Remove selected". `DiffGaugeDescEditor`, `DiffGaugeDesc(Manager)`, `DiffTA`.

#### GAUGE-08 · Columns gauge descriptor editor — P1 · [O]
- Aynı yapı, `ColsGaugeDesc.db`. `MultiGaugeDescEditor`, `MultiSymbolGaugeDesc(Mgr)`, `MultiSymbolGaugeMgr`, `ColumnInfoA`.

#### GAUGE-09 · Custom expression gauge — P1 · [O]
- "Change gauge text and format": `"format", arg1, …` (printf alt kümesi: c, d/i, f, o, u, x, X, %%; flag `-+0`, width, .precision, h/l/L; escape `\\ \" \n`), sembol oto-tamamlama (3 harf / Ctrl+Space), başlık boyutu/konumu, metin boyutu/rengi, unique id. DB `customvaluegauge.db` (örnekler: GPS Date, GPS Time, Speed at 5000 rpm). Hata mesajları (missing quote, unterminated formatter, formatter/argüman sayısı uyumsuzluğu). Sınıflar `CustomValueGauge`, `CustomValueGaugeSettings`, `CustomValueSettingsSQL`, `CustomValueDescr(A)`, `AutoCompletition`. Help `gauges/customvaluegauge.html`.

#### GAUGE-10 · Vems Flags descriptor editor — P1 · [O]
- Flag ekle ("New flag", "Edit name"), durumlar (değer, metin, fg/bg renk, resim, ikinci renk seti, `flash_time_ms`), "Add new state", "Save states properties". `VemsFlagDescEditor`, `VemsFlagDescManager`, `VemsFlagDesc`, `VemsFlagStateDesc`, `VemsFlagStates`, `VemsFlagConfigHelper`. DB `VemsFlagDesc.db` (`groups` 5: Basic/Motorsport/Analog/Outputs/ETC Warnings; `flags` 53; `states` 132); XML `VemsFlagDesc.xml`, `Round-FlagDesc.xml`.

#### GAUGE-11 · Flags toolbar & flag help — P0 · [O]
- View ▸ Toolbars ▸ Flags; her flag sağ-tık → ilgili help (`help_file`). Flag help sayfaları `v3/flags/*` (isaccel, isafterstart, isalsactive, isconfsw, iscranking, isego, isfuelpump, isiac, isknocking, islaunch, ismiscout, isn2oactive, iso2ready, isrunning, isrunningorcranking, issdlogging, isshiftcut, issparkcut, isstage2, iswarmup, iswarninglight, iswot, trigger_error_flag; analog input flags + inverted).

#### GAUGE-12 · Temalar — P1 · [O]
- `WidgetThemes.xml`: Gold, Silver, Zafir, Zafir-white (+ durum renkleri normal/warning/danger/inactive). Grup teması (View ▸ Group ▸ Group Theme) ve gauge bazlı override. `ThemesHelper`, `ThemeGroupPair`, `ThemeLine`, `WidgetThemeTable`, `ControlColorContentValidator`.

#### GAUGE-13 · Arka plan resimleri — P2 · [O]
- Grup başına / global: Image file, preview, positioning (suit/fill/mosaic/stretch/original), resize method, background colour, enabled, "Keep this as a relative path?". `BackgroundImageDialog/Settings/Event`, `BackgroundImagePainterBase`, `BackgroundImageChildrenBase`. Help `main/gauge_groups.html`.

#### GAUGE-14 · Sembol/gauge değer seçici — P0 · [O]
- "Gauge Value Selector", grup bazlı sembol menüsü (16 sembol grubu: Basic, GPS, Analog, IAC, Knock, Misc, Calc, Individual power, Temperatures, Cam Control, Boost, Fuel/Enrichments, Ignition, Predefined, ETC Control, WBo2 Control). `GaugeValueSelector`, `SymbolChooserPanel`, `SymbolPanel`, `SymbolGetter`, `SymbolValueGetter`, `GaugeType`, `GaugeSymbols.xml`.

#### GAUGE-15 · Ana pencere yerleşimi — P0/P1 · [O]
- wxAUI perspektifleri (`VemsAuiManager`, `gui.cfg`/`v3gui.cfg` `[layout/maingui]`, "The main perspective is corrupted. Not saved."), Full screen (Shift+F11, pref `fullscreen` hotkey; "Press … to return"), Fixed tabs, Reset Layout, log/debug sekmeleri, single-frame vs multi-frame grup gösterimi. Sınıflar `MainFrame`, `MainGuiConfig`, `ConfigMgrMainGui`, `LayoutUpdaterBase`, `LayerHandler`, `AlignmentHelper`, `TitleBarControl`, `FullScreenableIF`, `WindowHelper`.

#### GAUGE-16 · Toolbar'lar — P0 · [O]
- Toolbar'lar: **Main** (GPS, Devices, ECUState, InputSource, isLogging, isAdvLogging, ConfigValidate — `GUILayoutDesc.db`), **Gauge Groups**, **Flags**, **Static Control** (Read/Write/Burn), **Edit mode**, **Replay on log** (Play/Pause/Stop/Speed/Repeat/slider). "Reset Toolbar Layout", "Print Toolbar Layout" (dev). Sınıflar `ToolBar`, `bcToolBar(Tool)`, `AuiPaneToolBar`, `VemsToolBarToolBase`, `VemsToolIconBase`, `TbTb*` (16 sınıf), `GUIDescGUIItem`, `GUIItemDesc`, `ToolBars`. Help `main/view/toolbars.html`.

#### GAUGE-17 · Status bar ve mesaj paneli — P1 · [O]
- Status bar alanları: Realtime source, Config source, RT frekansı (Hz), log replay pozisyonu, Online/Offline durumu (`bcStatusBar`, `BubbleStatusBar`, `StatusTextDesc`, `StatusBarEvent`). Mesaj paneli "Message list box" + "Message details" (`VemsMsgListCtrl`, `VemsMessageViewerBase`), Log sekmesi ("Clear log window"), debug sekmesi (`DebugTabObserver`), kullanıcı log'u (`UserLog`, `UserLogWindow`), ipuçları (`WindowTipper(Agg)`, `bcToolTip`, `AggToolTip(Frame)`, `InfoWindow`, `InfoPanel`).

#### GAUGE-18 · Tray / taskbar — P2 · [O]
- Sistem tepsisi ikonu (küçültme/restore), Win7 taskbar progress. `VemsTaskBarIcon`, `TaskBarBase/Helper`.

#### GAUGE-19 · PDA/fullscreen ekran düzenleri — P2 · [O]
- `pdascreen.xml` (ör. "Gauges 480x272", orientation multi/landscape-left; ICON + Text/ArcBar/Digital), `v3cockpit.cfg`, `v3guil.cfg`, `aimpanel.xml`. WinCE test menüleri. (AIM-06 ile birlikte.)

---

## 8. Datalogging, log viewer, multigraph, analiz (LOG)

#### LOG-01 · VEMS log kaydı (normal + advanced) — P0 · [O]
- Toolbar **isLogging** ("On/Off the raw log", "Log Comment" — dosya adına eklenen yorum, yasak karakter kontrolü; `tbIsLogging48-*`) ve **isAdvLogging** ("Advanced log ON/OFF": tampondan dosyaya yazma modu; ikisi birbirini devre dışı bırakır). Log dosyaları ECU başına çalışma dizinine (`logs/<ECU>/…vemslog`). Pref `vemslogpreferences`. Log ECU realtime + config + GPS içerir (yalnız online VemsTune ile; SD karttan inen loglarda config ayrıca yüklenmeli).
- Sınıflar: `TbTbIsLogging`, `TbTbIsAdvLogging`, `RTDataLogWriter`, `RTDataRawLogger`, `SIPRFileLogger`, `RTDataCSVWriter`, `WriteInFileByTime`, `ThreadControllerVemslog`, `ConfigMgrLogConverter`. Help `help/gps.htm` (CHM), `main/intro.html`.

#### LOG-02 · Start new vemslog (Alt+L) / Add marker (Alt+K) — P0 · [O]
- Yeni log dosyası başlatma; log'a kullanıcı marker'ı ekleme (MultiGraph'ta "User marker" olarak görünür).

#### LOG-03 · Log replay — P0 · [O]
- "Replay on log" toolbar: Start/Pause-Resume, Stop, hız ×1/×2/×4, Repeat on/off, pozisyon slider'ı; mevcut pozisyon sağ-alt köşede. Replay sırasında tüm gauge/tablolar log verisiyle güncellenir (config de log'dan). `FilePlayCommander`, `FilePlayDesc`, `ThreadLogPlayer`, `FilePosSlider(Set)`, `SliderPosEvent`, `TbTbPlay/Pause/Stop/LogPlaySpeed/LogRepeat`. Help `main/view/replaylog.html`.

#### LOG-04 · Log geçmiş belleği — P0 · [O]
- Bağlıyken tüm RT paketleri bellekte tutulur (MultiGraph/istatistik/arama kaynağı); `LogHistoryMgr`, `LogHistoryBase`, `LogHistoryMultigraph`, `LogHistoryMgrHelper`, `RingBuffer(Sync|ReaderThread)`, `RBController/Producer/Consumer*`, `GUIConsumerThread`, `SymbolStat`. Türetilmiş log sembolleri: `calc_drpmdt`, `calc_dtpsdt`, `calc_dmapdt`, `distanceSum`, `_exprvalue_`, `rtidx`.

#### LOG-05 · Multi Graph (MultiValueGraph) log viewer — P0 · [O]
- Bileşenler: toolbar (gauge refresh aç/kapa, marker ayarları, "Update graph loghistory", descriptor editor, theme editor, search, zoom in/out/100%/seçime zoom, zoom kutusu 2000%…1/n, "Save Selected Area"), zaman cetveli (ms), çok node'lu grafik alanı (node başına max N sembol, flag satırları `flagdisplayratio`), summary bar (tüm log; arama sonuçları, seçim, imleç, user/static marker'lar), status bar (seçim başlangıç→bitiş=fark, zoom bilgisi). İmleç tıklandığında tüm gauge'ler o anki değere güncellenir. İstatistik: Min/Max/Average — "In whole log / In selected / In visible screen", "Stat for all symbols in whole log". Sembol büyütme (magnify), offset, kilitleme. Gerçek zamanlı otomatik yenilenme yok ("Update" ile). Hotkey'ler `multigraphevents.db` (42 olay: imleç yavaş/hızlı, sayfa, başa/sona, zoom, magnify, lock, marker'lar arası atlama, sembol seçimi, offset, search, clear search, save selected area…).
- **Descriptor editor** (profil başına node/sembol: ad, descriptor, renk rgba, magnify, tip (flag), warning limit min/max, over-limit color, custom title; node ekle/sil/taşı, Save As profile), **Theme editor** (38 tema özelliği: bgcolor, fgcolor, cursorcolor, linewidth, summarybar renkleri…), **Profiles editor** ("Multi Graph descriptor and theme profiles editor": profil sil/yeniden adlandır, hangi gruplar kullanıyor), **Markers settings** dialog.
- DB: `MultiGraphDesc.db` (profiles: Default, IAC; nodes; symbols), `MultiGraphTheme.db`, `MultiGraphDesc_default.db`, `defaultstatements/*.sql`, `GaugesSettings.db/MultiGraph`. Pref `mvg_stat_enabled_at_start`.
- Sınıflar: `MultiValueGraph`, `MultiValueGraphOpenGL`, `MultiValueGraphTimeObserver`, `MultiGraphDesc(Manager|Node)`, `MultiGraphTheme(Property)`, `MVG_DescEditor`, `MVG_DescManager`, `MVG_ProfilesEditor`, `MVG_ThemeEditor`, `MVG_ToolbarPanel`, `MVG_SymbolChooserPanel`, `MVG_SymbolDescChooserPanel`, `MarkerSettingsDialog`, `NodeEditPanel`, `NodePanel`, `GraphDataDescriptor`, `TimeLine` [I]. Help `gauges/multigraph*.html`.

#### LOG-06 · Search in datalog — P1 · [O]
- İfade ile log arama (`rpm > 50`, `(rpm < 1500) & (rpm > 1000) & (map < 40)`), sembol önerisi, start/end index aralığı, ilerleme, sonuç listesi (start, length) → MultiGraph'ta işaretleme. `LogHistorySearch`, `LogSearchHistoryHelper`, `LogHistoryProcessFilterThread`, `SearchDialog(Help)`, `SearchResultDialog`, `SearchDescr`. Help `gui/loghistorysearch.html`.

#### LOG-07 · VemsLog → CSV dönüştürücü — P1 · [O]
- "Convert vemslog to csv!": Ini file (veya "Use default ini file"), Input File(s) (çoklu), "Concatenate input files", "Output extension and path", Auto close, Convert/Stop/Pause; çıktı başlığı `#VemsTune`, `#Converted from`, `#MD5`, `#Firmware version`. Kısayollar: Convert last / Convert all (çalışma dizinindeki tüm `*.vemslog`). `Raw2HighConverterDialog`, `CSVConverter`, `CSVConfig`, `RT2ViewerConverter`. (CHM: eski "Raw Log to XLS convert".)

#### LOG-08 · Harici log viewer — P2 · [O]
- "View last log with Ext. Viewer" (pref `extlogviewer`, varsayılan MegaLogViewer yolu); kurulumda `VemsLogger.exe` (ayrı viewer uygulaması; Round INI plugIn).

#### LOG-09 · MSQ export — P2 · [O]
- Mevcut config'i MegaTune `.msq` olarak kaydet ("MSQ file has been saved to"). `VemsTuneController::saveMSQ`.

#### LOG-10 · VemsDisplay (Android) log dönüştürme — P2 · [O]
- "Convert VemsDisplay(Android) log to VemsTune log" (Input Log → .vemslog). Help `main/tools_menu.html`.

#### LOG-11 · VE Tune by statistics (RTDataStat) — P1 · [O]
- Log geçmişinden hücre bazlı istatistik: Expression (varsayılan `(veCurr * egoCorrection * lambda) / (lambdatarget * 100)`), Filter (varsayılan `(pulseWidth > 0) && (lambda < 1.285) && (lambda > 0.1) && (coolant > 70)` [+ `calc_dtpsdt` sınırı]), Lambda delay (ms), Variance multiplier (outlier filtresi; 0=kapalı), Min. # of data in cell, Max. variance, "(Re-)Evaluate", "Edit filters & expressions…", "Tune table", "Show VEcorr/VE ratio (in %)", "Export data" (.json), "Fix selected cells", "Show Histogram". Hücre içi gösterim: sol-üst min, sağ-üst max, merkez mean, sol-alt sayı (filtrelenen), sağ-alt varyans; sağ tık histogram. Özet: Total / Dropped (Filter+outliers) / Out of Range.
- Sınıflar: `RTDataStat`, `RTDataStatTable`, `RTDataStatMath`, `RTDataStatExporterBase`, `RTDataStatVEExporter`, `RTDataStatIgnExporter`, `RTDataStatDistributionWin` ("Real-time data - Histogram & distributions"), `Histogram`, `DblHistogram`, `ResultHistogram`, `RTDataAnalyzer(Base)`, `RTCellInfo`.

#### LOG-12 · Boost refDC Tune by statistics — P2 · [O]
- RTDataStat'ın boost varyantı (expression `boost_dc / 255 * 100`, filter `(throttle > 95) && map > boost_minpressure`). `OnRTDataStatBoost`.

#### LOG-13 · Spark statistics — P2 · [O]
- Ateşleme tablosu için istatistik (`pulsewidth_spark_expression = pulseWidth`, `RTDataStatIgnExporter`). `OnSparkStat`.

#### LOG-14 · Expressions & filters editörü — P1 · [O]
- Adlandırılmış ifade/filtre saklama (`expressiondb.db`: expressions — name, expression, isexpression, used_by `|ve|spark|boost|`; `expression_colors`), "Available symbols", "Add to editor", "Validate", "Delete". `ExpressionPanel`, `ExpressionPage`, `ExpressionSQL`, `FilterPage`, `LogFilter(A)`, `ModelFilter`.

#### LOG-15 · Live VE Analyzer (RTLiveAnalyzer) — P1 · [O]
- Sekmeler: **Settings** (Min/Max RPM ve MAP/TPS dikdörtgeni, RPM/MAP tolerance %, Min. data, Tuning precision %, Max. allowed change pos/neg (mutlak), Tune ahead Up/Right; Load/Save settings → `rtla_settings.dat`), **Control Panel** (Live Analyzer ON/OFF, AutoTune ON/OFF, "Refresh from model", "Reset tables", expression/filter (sabit), mesajlar: Filter failed / Collecting data / TUNED / Too high difference!; hücre "Skip this cell / Enable this cell"), tablolar: tuned VE (renk kodlu: beyaz/sarı/…/yeşil/kırmızı), count tablosu, fark tablosu (kırmızı +, mavi −), zoomed 3x3 VE, differential gauge, **Statistics** (total, outlier, filtered out, cells altered, avg/max cell change), **Help** sekmesi (`main/tools/live_analyzer.html`). Tune-ahead: sağa ve yukarı ekstrapolasyon (çapraz desteklenmiyor).
- Sınıflar: `RTLiveAnalyzer`, `RTLiveAnalyzerControlPanel`, `RTLiveAnalyzerSettings`, `RTLiveAnalyzerStatPanel`, `RTLiveAnalyzerHelpPanel`, `SimulatedAnnealing` [I: optimizasyon yardımcı].

#### LOG-16 · Calc Model Analyzer — P1/P2 · [O]
- Log boyunca VemsTune'un model hesabı ile ECU'nun RT sonucu arasındaki farkı (`disp_*_diff` sembolleri; `calcmodel.db` diff_limit_min/max) gösteren ızgara; "Right-click on grid: save to csv", RT Index, çift tıkla hücre. `CalcModelAnalyzer`, `CalcModelAnalyzerProcess`, `CalcModelAnalyzerViewer`, `CalcSymbol(A)`.

#### LOG-17 · Race analyzer — P2 · [O]
- Log'daki ivmelenme koşularını (race) tespit: gear, sample count, filtered drpm/dt, avg map, drpm/dt/avgmap, lambda, spark, **engine torque** (TorqueConfig'den); `races.csv`, `racesCache.cfg`, "Please choose the racelog directory (*.csv)". `RaceLogAnalyser`, `VEMSRacesFrame`, `VEMSRacesDataView`, `RacesCache`. CHM: 402 m / 60 feet GPS ölçümü.

#### LOG-18 · Mixture table view (test) — P2 · [O]
- "Please choose the mixturelog directory (*.xls)" — mixture log görüntüleyici. `VEMSMixtureViewFrame`, `VEMSDataLogMixtureView`.

#### LOG-19 · VemsLogViewer & Generate VemsLog (dev) — P2 · [O]
- `VemsLogViewer` (Open log, refresh GUI), `VemsLogGenerator(Frame|Panel)`: ifadelerle sentetik log üretme (fileName, logLengthInSec, packetPerSecond, defaultExpression; örn. `rpmVHR`, `mapADC`, `rknock0..3` ifadeleri). Test/simülasyon için yararlı.

#### LOG-20 · Individual power analizi — P2 · [O]
- Trigger diş olaylarından silindir başına güç (`rpmdiff0-7`, ColumnsGauge "Individual Power"); ign_out → individual power indeks eşlemesi (4/5/6 silindir). Help `v3/datalog/individual_power.html`.

---

## 9. Trigger log, trigger araçları ve wizard (TRIG)

#### TRIG-01 · Analyze/record trigger log — P0/P1 · [O]
- **Online** (Start V3/Stop V3; her start yeni `.triggerlog`; fw ≥1.1.78 gerekli; baudrate değişimi "Please wait... Changing baudrate"; pref `auto_start_tlog`) ve **offline** (dosya aç/drop). Osiloskop benzeri ekran (darbe yüksekliği zaman aralığıyla orantılı), seçim uzunluğu ve seçimdeki primary/secondary sayısı, "Trigger on sec.trig", Pause, "Scroll as real-time", Save to PNG, "Save to audio" (WAV/RAW), "Create WAV file from triggerlog", Change settings (renkler, dikey offset — `graphcolors.xml`; Save&close/Apply&close/Default), **Result** tablosu (Primary/Secondary Time/Diff/Diff Ratio, MISSING TOOTH tespiti; CSV export), istatistik (toplam byte/frame, primary-only vs primary+secondary frame oranı, CRC hatalı frame, RT frame), "Save triggerlog file as…". Klavye: ↑↓/+-/tekerlek zoom, ←→/J K imleç, Ctrl+ küçük adım, PgUp/PgDn/H L büyük adım, Shift seçim, Enter seçime zoom, Backspace geri, Space ortala, F1 help, F2 advanced help, **F5 seçime 720° döngü uzunluğu ata / F6 kaldır** (açı gösterimi), pref `tlog_keybspeed`. Kanallar: Primary trigger, Secondary trigger, Camshaft exhaust, trigger Nr.4…31, road speed, road speed2, Spark Event, data+timestamp1-15.
- Sınıflar: `TriggerLog`, `TriggerLogV3`, `TriggerLogGraph`, `TriggerLogGraphSettings`, `TriggerLogPlotter`, `TriggerLogImg`, `TriggerLogReader`, `TriggerLogResults`, `TriggerLogManager`, `TriggerLogControllerBase/Man/TF`, `TriggerLogTFHandler`, `TriggerLogSaveAudio`, `TriggerLogSettingsHelper`, `TriggerLogEvent/Evt`, `RawTriggerLogEvent`, `TriggerDetect`, `Trigger`, `TriggerFrameLogPage`. Help `main/tools/triggerlog.html`.

#### TRIG-02 · Play Trigger (ses kartından tetik sinyali üretme) — P2 · [O]
- Tetik tipi kodu (1 harf + 3 rakam; büyük harf = ters polarite): `c004/c008/c270/c…` (coil-type, Audi), `m582/m351/m231/m071/m031/m111/m171/m631` (missing tooth), `g582` (double-pulse camsync, Magneti Marelli), `f000` (Fiat Stilo), `e324` (Rover-K/Elise), `s060` (Subaru 6+7), `s362` (Subaru/Suzuki 36-2-2-2), `l008` (Lancia/Cosworth), `z000/z012/z020` (Maserati odd-fire V6), `h000` (Honda extrapulse), `c001/c010/c024`. Kontroller: RPM slider (min/max/change rate), "Rpm Max Climb", Sec. trigger Pos, Fluctuating (%), Lower Pulse ratio (%), Volume, Play/Stop, Mute primary/secondary, "Play from .csv file", "From pulse train", Live Playback, Audio I/O (playback/recording device, sample rate), "Open preferences". Prefs: `preferred_audio_signal`, `rpm_start`. `trigger.ini` dizini.
- Sınıflar: `AudioPanel`, `AudioController`, `AudioConfig`, `ConfigMgrAudio`, `AudioThread`, `AudioPlayRecordThread`, `ThreadControllerAudio`, `SignalGen`, `SignalGenWx`, `SignalGeneratorCallBack`, `SignalProducerThread`, `SignalProcessThread`, `SignalRBWriterThread`, `SignalFilePlayer`, `TriggerPlayRpmParser`, `RpmFromFile`, `Main_Pulse_train`, `SoundFrame`, `SoundPanel` (portaudio). Help `main/tools/playtrigger.html`.

#### TRIG-03 · Generate trigger WAV dialog — P2 · [O]
- Output directory, Trigger type, RPM settings (`1000` sabit / `180-1740` sweep / `140-200-200-3000` adımlı), WAV length (s), Sectrig position (`15-30` veya `15-25-20` sweep), Amplitude (`1000`=100%, `100-1000` rampa), "Normal tooth relative". Örnek ad `c001_180-1740_30_15_1000_1000.wav`.

#### TRIG-04 · Trigger configlet'leri ve trigger diyalogları — P1 · [O]
- TUNE-13'teki 48 trigger configlet'i + Primary/Secondary trigger dialog + Reference tooth tablosu + Trigger Settings Visual + Trigger Settings Validation (VAL-03). Help `v3_primary_trigger_settings.html`, `v3_secondary_trigger_settings.html`, `v3_reference_trigger_tooth.html`, `help/dialogs/trigger_settings.html`.

#### TRIG-05 · Triggerframe → SIPR/vemslog dönüştürücü — P2 · [I]
- `TriggerFrameLogConverterDialog/Process`, `TriggerFrameToSiprLogConverter` (SD karttan gelen TF verisini vemslog'a çevirme; `ExportTFDataToLogV3`).

#### TRIG-06 · Triggercalc Test / Triggerframe creator (dev) — P2 · [O]
- Verilen trigger config'i (adv, crankdeg, rpm_period, config11, ign_tdcdelay, trigger_tooth, toothw16, tooth_wheel, primary/secondary_trigger, ignum, dwell) için firmware hesabını simüle: "Result: engine.proposed_spark_phase / proposed_trig2spark / dwell / proposed_dwell_phase / proposed_trig2dwell". `TriggerTestFrame`, `TriggerTestPanel`, `TimingTester`, `TriggerFrameTester`, `SineTest`, `FullDuplexTest`.

#### TRIG-07 · Spark tester — P2 · [O]
- "Spark Tester" penceresi: spark/dwell faz grafikleri (ch1/ch2), "Spark RPM Ploter", Grid widget, 2D Hist widget, Grid By Time, VemsGauge, "Write In File", Output Tester Gauges. `SparkTesterWidgetFactory`, `SparkMyFrame`, `ShowSparkPhaseWidget`, `ShowSparkPWidget`, `MainFrame::StartSparktTester`.

---

## 10. Knock (KNOCK)

#### KNOCK-01 · Knock diyalogları — P1 · [O]
- Knock Sampling (pencere, frekans, gain, integrator, threshold), Knock Action (retard step/delay/max/default), Knock channels, Knock Gain and Ref (alternatif knock), Knock Noise Table (RPM/MAP veya RPM/TPS; 2D+3D supertable). Configlet'ler (`knock1`, `knockcalib`). ECU Logger açıkken knock sensing devre dışı (help). Help `v3/v3_knock_control.html` (15 KB — en kapsamlı sayfalardan).

#### KNOCK-02 · Knock Tune (KnockFrame) — P1 · [O]
- Log/canlı veriden silindir başına knock değerlerini toplayıp **önerilen gain'ler** ("Proposed Gains") ve **önerilen knock noise tablosu** ("Proposed KnockTable") hesaplar; "Difference Table", katman seçici (ortalama/özel katmanlar), Accept proposed gains / table, ilerleme diyaloğu. Sınıflar `KnockFrame`, `KnockTable`, `KnockViewer`. Semboller `knock_gain%d`, `knockval%d`, `knock_ref_noise`, `calc_knock_table_val(_MAP|_TPS)`.

#### KNOCK-03 · Knock görselleştirme — P1 · [O]
- Knock gauge grubu, ColumnsGauge "Knock", descriptor tipleri `knock`, `knockAdjust`, `knock_cyl_0_adjust`, `knock_cyl_0_diff`, `knock_value`; flag `isKnocking`; LCD Page5 knock alanları.

---

## 11. Wideband / sensör kalibrasyonları (CAL)

#### CAL-01 · WBO2 Calibration (frame) — P1 · [O]
- Adımlar: motoru kapat, LSU4'ü egzozdan çıkar (serbest hava); manuel ("Start cal." → WBO2 Calibration değerini O2 gauge %20.9 olana dek ayarla → "Stop cal." → Burn) veya "Auto cal." (otomatik). Status, `stallO2` gauge, `wbo2Cal` sembolü. `WBO2CalibrationFrame` (doAutoCalibration, getAverage, setO2Limit, OnSelectWBO2 — çift WBO2 seçimi), `CalibrationWBO2`, `CalibrationBase/Desc`. Ayrıca INI dialog `widebandCalibration` ("Wideband Controller Calibration") adv frame ile.

#### CAL-02 · TPS Calibration Wizard — P0/P1 · [O]
- Welcome → "Press and hold the throttle to the maximum position and click on Next" → "Release the throttle to the minimum position" → Finish (Burn) / cancel ("Original values restored"); `adc255Gauge`. `TPSCalibrationWizard`, `TPSCalibrationWizardWelcomePage`, `TPSCalibrationWizardMinMaxTPSPage`, `TPSCalibrationWizardFinishedPage`. INI dialog `TPSCalibration` ("TPS min/max Calibration").

#### CAL-03 · Analog Input Calibration Wizard — P1 · [O]
- Kanal seç (0,1,2,5,6,7 — MCP3208), iki nokta: Values in Volt ↔ Calibrated Values → `&Calculate` → Scale/Scale Multiplier/Offset/Offset Multiplier → Write/Burn; VemsDisplay'de kalibre girişler. Önceden tanımlı tipler: Fuel/Oil/Exhaust/Turbo outlet/Pan vacuum/Transmission pressure, Air/Oil/Trans/Water/Rear end/IC water temp (`mcp3208_ch*_pre`). `AnalogInputCalibrationWizard`, `AnalogInputCalibrationCalculator`, `AnalogInputCalibrationSettings`. Help `v3/v3_VemsDisplay_calibration.html`, `v3_analog_input_calibration.html`.

#### CAL-04 · ECU Calibrations ve sensör eğrileri — P1 · [O]
- `calibration` dialog (seri numaraya bağlı kalibrasyon verisi; farklı seride config upload'da korunur), CLT/MAT/Custom sensör curve diyalogları, NTC bulucu (`NTCFinder` [I: termistör eğrisi uydurma]), coolant/air firmware patch'leri (FW-09). Help `v3/v3_ecu_calibration.html`.

#### CAL-05 · Wideband settings / configlets — P1 · [O]
- `wideband` dialog + configlet (Heater-PID, Pump-PID, Warmup); Round wideband + controller PID. `WBlambda100MOT.inc`, `NBafr100.inc` (lambda/AFR dönüşüm tabloları). Help `v3/v3_wideband_settings.html`.

---

## 12. SD kart / ECU internal logging (SD)

#### SD-01 · Search SD files (SD Card overview) — P1 · [O]
- Kart tarama ("Searching files…", "Card seems to be empty", "Card does not contain valid VEMS data"), liste: dosya, süre (uzunluktan tahmin), FW version, Serial #, GPS DateTime, Launch On, Sample count; daha önce kaydedilenler gri; "Save newer files first (reverse order)", Summary & control (Read block count, Create summary, Last refreshed), Rescan, Check/uncheck all, "Save checked files", ilerleme (current/overall, elapsed/estimated), Select timezone; çıktı `-SDCard.vemslog` / `-SDCard.triggerlog`, "Open containing folder". SD ve V3 firmware sürümü farklıysa uyarı. Önerilen: indirmeden önce eşleşen config'i yükle.
- Sınıflar: `SDCardDialog`, `SDCardDownloadPanel`, `SDCardSearchPanel`, `SDCardResultDialog`, `SDCardSaveDialog`, `SDCardFile(Downloader|Search|Summary)`, `SDCardSavedLogManager` (`sdcardlogs.db`), `SDCardControllerBase/ManMode/TF`, `SDCardV3Logger`, `SDStaticInfo`, `MMCFilesDesc(A)`, `SDCardEvent`, `TriggerFrameSDCardHandler/Event`. Help `v3/v3_ecu_logger.html`, `help/sdCardLogging.htm` (yalnız link).

#### SD-02 · SD logging Start / Stop / Erase — P1 · [O]
- `SDCardDirector` (startLog, stopLog, erase, checkDifferentFw): "Start logging may corrupt your existing data… save all data first", durum mesajları (Logging started/stopped/already running, Startlog/Stoplog/Erase failed, SDCard empty, Timeout, Communication failed).

#### SD-03 · Open image file — P2 · [O]
- Daha önce alınmış SD imajını (`*.raw`) açıp log çıkarma ("Choose SD Card image file"). `SDImageHandler`.

#### SD-04 · SD Card Reader (PC kart okuyucu) — P2 · [O]
- Removable device tespiti, `3rdparty\dd.exe` ile ham okuma (`bs=32768 --progress --stoponempty`), "Save image" (`YYYYMMDD_HHMMSS.raw`), "Valid VEMSlogs on: …". `SDProcess`, `VolumeInfo(A)`, `AutoHandleCloser`.

#### SD-05 · ECU Logger ayarları (INI) — P1 · [O]
- `eculog` dialog: ECU Logger enabled, RT logging condition (misc outputs, WOT actuator, after first engine start), stop delay, byte-stuffed format (deneysel; datalog+GPS+triggerlog+config), Automatic GPS Log on main serial port, GPS Log baud rate; flag `isSDcardLogging`.

---

## 13. Modbus, sequencer, sanal cihazlar (MB)

#### MB-01 · ModbusDialog (genel Modbus master) — P2 · [O]
- Seri ayarlar (Port, Baud, Data bits, Parity, Stop bits, Timeout, Try count), fonksiyon: `0x03 ReadHoldingRegisters`, `0x06 WriteSingleRegister`, `0x08 Diagnostics`, `0x10 WriteMultipleRegisters`; Address, Length, Value(s), SubFuncId, "Send Date" (tarih paketleme), Clear. RTU ve ASCII framing. Hata kodları (ILLEGAL_FUNCTION, ILLEGAL_DATA_ADDRESS, ILLEGAL_DATA_VALUE, SLAVE_DEVICE_FAILURE). Sınıflar `ModbusDialog`, `ModbusController`, `ModbusClient`, `Modbus_RTU_FSM`, `Modbus_ASCII_FSM`, `ModbusRequest/Response(+Factory)`, `ReadHoldingRegisters*`, `WriteSingleRegister*`, `WriteMultipleRegisters*`, `Diagnostics*`, `ModbusUtil`, `ModbusException`, `IModbusEventHandler`.

#### MB-02 · ModbusPlcDialog (VFD/PLC kontrol) — P2 · [O]
- Frekans slider, Run/Stop/Fwd/Rev, Read Status (Running status, Direction, Frequency Command, Output Frequency/Current/Voltage, acDriveStatus, motorDirection). `ModbusPlcDialog`, `ModbusPlcStatusPanel`, `Modbus_PLC_VFD_L`, `PLC_Controls`, `PLC_Properties`, `PlcStatus`, `VFDConfigParser`, `VFDParameter(Group)` (param dosyaları `config/modbus/{default,vfd-e,vfd-l,3phase-sync,sequencer}` — bu kurulumda boş).

#### MB-03 · Virtual devices — P2 · [O]
- `config/virtual_devices.cfg`: ortak seri port + PLC listesi (Name, ModbusAddress, ModbusProtocol ASCII/RTU, Current), `ICP-7065` (I/O modülü). `VirtualDevices`, `VirtualDevicesConfig(Loader)`, "VirtualDevicesDialog".

#### MB-04 · Sequencer — P2 · [O]
- Sıralı çıkış kontrolü (`setseq.txt`, `seq-open.txt`, `seq-clos.txt`, `seq-sens.txt`, `seq-pid.txt`, `seq_processIdx`, Cycles); muhtemelen Woodgas "Flaps sequence" ile ilişkili [I]. `SequencerDialog`, `SequencerPanel`, `SequencerModePanel`, `SequencerParser`, `SequencerConfig`, `SequenceElement`.

#### MB-05 · ECU üzerinden Modbus — P2 · [I]
- "MODBUS mode not enabled" — ECU'nun Modbus köprüsü modu; `VemsModbusClient`, `VemsModbusHelper`, `VemsModbusRequest`, `ModbusConfigHelper`. Kullanım senaryosu belirsiz **[U]**.

---

## 14. GPS, haritalar, yarış (GPS)

#### GPS-01 · GPS Communication dialog — P1 · [O]
- GPS enabled, COM port, Baud rate (genelde 4800), Test, **Detect** (tüm port/baud tarama; "GPS found, but to few satellites in view"), mevcut konum, uydu sayısı. `GPSConfigDialog(2)`, `GPSConfigPanel`, `GPSDetectProcess`, `GPSDetectorClient`, `GPSCommunicationController`, `GpsCommClient`, `NMEAParse`, `GPSData(A)`, `RawGPSData`, `GPSHelper`. Help `main/preferences/gps_comm_dialog.html`, `help/gps.htm`.

#### GPS-02 · GPS durum ikonu — P1 · [O]
- `tbGPS48-true|false|warning|offline` (Connected / not found / No GPS Data / Disabled). `TbTbGPS`.

#### GPS-03 · GPS route gauge (harita) — P2 · [O]
- Tile tabanlı harita (`maps.xml`: Open Street Maps, Google simple, Google Sat), sunucu seçici, zoom slider, sürükleme, rota çizimi + mevcut konum, hız/zaman tooltip, info paneli, debug, "Copy position to clipboard", "Open map cache dialog with the current area", disk cache (pref `maptilecache`, default merkez `maps_longitude/latitude/zoom`). Hotkey `gpsrouteevents.db`. `GPSRouteGauge`, `MapTileManager`, `MapDesc`, `MapLayerDesc`, `MapServerDesc`, `MapHelper`, `Mercator`, `TileDesc(Base)`, `TileSize`, `ImageContentLoader(Curl|File|URL)`, `ContentLoaderManager`, `RouteElement`, `PolygonHelper`.

#### GPS-04 · Map cache dialog — P2 · [O]
- Alan için tile indirme: Required space, target directory, "No. of threads for downloading", available free space, "Downloading tiles: %i / %i". `MapCacheDialog`.

#### GPS-05 · GPS compass gauge — P2 · [O]
- "Heading: %.1f". `GPSCompassGauge`.

#### GPS-06 · GPS verisi log'da ve sembollerde — P1 · [O]
- `[GPSData]` bölümü (`include/section-gpsdata.ini`: `gpsSpeed = { rawKnots / 10 * 1.852 }`, tarih/saat, lat/lon, course, height), GPS gauge grubu (Shift+2), tüketim (`l_100km`, `lphr`), V3 SD karta GPS logu (SD-05), `SIPR2GPSConverter`.

#### GPS-07 · GPS export / dosya yeniden adlandırma — P2 · [O]
- KML (LineString, absolute altitude) / GPX (trkseg) export; "Rename files by GPS data" (log adını GPS tarihine göre). FILE-05 içinde.

#### GPS-08 · Ters coğrafi kodlama ve rota servisleri — P2 · [I]
- `nominatim.openstreetmap.org/reverse` (konum adı), `open.mapquestapi.com/directions`, `maps.google.com/maps?...output=kml` (iki nokta arası rota) — `GPSMapPlanner`. UI yeri belirsiz **[U]**.

---

## 15. AIM, Round ekranı, PDA/cockpit, VemsDisplay (AIM)

#### AIM-01 · AIM Communication settings — P2 · [O]
- AIM communication enabled, COM port, Baud rate, Save&Close / Close w/o save; ikinci seri porttan V3 AIM akışı alma. `AIMCommunicationConfig`, `AIMCommunicationThread`, `AIMPacket`, `AIMData`, `AIMEvent`, `AimChDesc`, `SIPR2AIMConverter`.

#### AIM-02 · Round Main Display Settings — P1 (Round için P0) · [O]
- Slot seçici (Maximum Display Slot number), Top/Bottom display modu (EGT, ANALOG, RPM, Lambda, Afr, AIM EGT/MAP/RPM/Lambda/WHEELSPEED, AIM Custom0-4, Blank…), dot position, AIM custom kanal (Channel ID, multiplier a, offset b), "Start AIM"/"Stop AIM", "AIM Port", PC'de Round'un göstereceğinin önizlemesi, küçük yeşil LED'ler. DB `aimdsettings.db` (aimchannels 25, aimmodes 36, aimdotposition 8). `AIMDisplayPanel`, `AIMDisplayHelper`, `AIMValuesPanel`, `AIMFlagsPanel`, `AIMCustomValuesEditorPanel`, `DisplayHelper`. Help `main/aim.html`, `round/round_main_display_settings.html`.

#### AIM-03 · Round Display Demo — P2 · [O]
- LED/7-segment demo, "Force outputs to", segment maskesi, "Disable demo mode (reset values)", küçük çift renkli LED'ler. `RoundDemoModeLedDisplay`, `RoundDemoModeSettings`, `LEDDisplay`, `LedClickEvent`. Configlet `ledDisplayDemo` (blank, only dots, say hello, smiley face).

#### AIM-04 · AIM Test frame — P2 · [O]
- AIM kanal simülatörü (RPM, wheel speed, oil pressure/temp, water temp, fuel pressure, battery, throttle, manifold press, air charge temp, exhaust temp, lambda, fuel temp; `aimpanel.xml` interval/expression). `AIMTestFrame`, `AIMTestButtonPanel`.

#### AIM-05 · AIM cihaz modu GUI seti — P2 · [O]
- `vemsTune-aim.ini` + `aim-*.db` (gauge descriptors, groups, layout, multigraph, flag desc) — VemsTune'un AIM alıcısı olarak çalıştığı mod. `BuildAimGui`.

#### AIM-06 · PDA / cockpit / WinCE — P2 · [O]
- `pdascreen.xml`, `Round-pdascreen.xml`, `vemsv3pda.ini`, `cockpit-v3-1.1.27.ini`, `v3cockpit.cfg`, "wince test 1-3" menüleri; dokunmatik tam ekran ICON tabanlı sayfalar. Legacy — yeni uygulamada mobil/kiosk modu olarak düşünülebilir.

#### AIM-07 · LCD (V3 karakter LCD) ayarları — P1 · [O]
- `lcdsetup` dialog (LCD enable, default page, backlight, cable delays, busy polling, force goto, reinit, PWM/software brightness, AIM enable, LED heartbeat); sayfa içerikleri Page0-10 (help `v3/v3_lcd_pages.html`, `help/dialogs/lcd.html`).

#### AIM-08 · VemsDisplay (Android) entegrasyonu — P2 · [O]
- TCP köprü üzerinden bağlantı (CONN-02), kalibre analog girişler (CAL-03), log dönüştürme (LOG-10), `graphics/android_aimdisplay_splashscreen.png`.

---

## 16. Audio (AUDIO)

#### AUDIO-01 · Audio I/O paneli — P2 · [O]
- Playback/recording device seçimi, sample rate, "Show audio devices", "Test Fullduplex 0/1" (dev), Signalgen parameters. portaudio tabanlı. `AudioPanel`, `AudioController`, `portaudio` sarmalayıcıları.

#### AUDIO-02 · Play signal (sinyal jeneratörü) — P2 · [O]
- Choose audio device, signal type, Left/Right channel amplitude %, channel phase shift (deg), frekans/amplitude (pref `audio_frequency`=440, `audio_amplitude`=100). `SignalGenDialog`, `SignalPlayDlg`.

#### AUDIO-03 · Ses kartından sinyal girişi — P2 · [I]
- `RTDataInputSignalgen` ("RTDataInputSignalgen: trigger type"), "Get Pulse Train", `processPulseTrainDataBlock` — ses kartı girişinden darbe dizisi okuyup RT kaynağı olarak kullanma (input source "signalgen").

---

## 17. Calc model, ifadeler, semboller (CALC)

#### CALC-01 · INI ifade dili — P0 · [O]
- `{ … }` ifadeleri `[OutputChannels]` (431 sembol: ham + türetilmiş `calc_*`, `disp_*`), `[Datalog]` (81 entry), menü/alan görünürlük koşulları, ConfigCriteria, gauge'ler. Önişlemci: `#include`, `#if/#else/#endif`, `#ifdef/#ifndef/#define/#undef/#warning/#error`, `defined()`.
- Operatör/fonksiyon sınıfları (tam liste): `+ - * / %`, unary `-`, `!`, `~`[I], `& | ^`, `<< >>`, `&& ||`, `== != < <= > >=`, `?:` (Conditional), `exp`, `ln`, `log2`, `floor`, `sum`, `table()` (INI tablo lookup), `interpolate`, `interpolate2D`, `interpolate3D`, `latch32`, `switchcase8`, `getGPSDistance`, `getGPSCourse`; custom gauge'de ayrıca `sin`, `pi` (help). Sınıflar `ExpressionParser`, `ExpressionFactory`, `ExpressionBase`, `ExpressionFv*` (35 sınıf), `ExpressionVariable/Number/String/Comma/Colon/LP/RP`, `RPNParser`, `RPNHelper`, `RPNCache`, `RPNStack(Item)`, `Tokenizer`, `InfixTokenA`, `Eval`, `Evaluation`, `ExpError`, `SyntaxError`, `ExpressionException`.
- Sembol altyapısı: `Symbol`, `SymbolTable(s)` (94 metot), `SymbolTableFiller`, `SymbolWithExpression`, `SymbolWithIterator`, `dbsymbol`, `VariableDescriptor/Data/List`, `StructDescriptor`, `StructureVar`, `BitField` desteği (loBit/hiBit/offsBit), `SiprTypesHelper`, `SiprDescHelper`, `SIPRDescriptor`, `SIPRPageDescriptor`, `SIPRTableDescriptor`.
- Diğer INI bölümleri: `[SymbolAlias]` (51), `[UserData]`, `[HiddenOutputChannels]`, `[SymbolMapping]`, `[ConfigTablesSavingOrder]`, `[GaugeConfigurations]`, `[FrontPage]`, `[RunTime]`, `[Tuning]`, `[AIMData]`, `[SIPRData]`.

#### CALC-02 · Expression Grid (calc model görselleştirme) — P1 · [O]
- ECU'nun bir çıktıyı nasıl hesapladığını adım adım: fonksiyon adları, RT değerleri, alt değer, işlem (`-=` vb.), satır sonucu, ilgili diyaloğa link, pasif satırlar (konfigürasyona göre), not ikonları, VT sonucu vs ECU sonucu ve fark. Tanımlı ızgaralar: Spark, Warmup enrichment, Lambda target, Boost target, Boost RefDC, Gamma enrichment, Accel retard, VE, Launch RPM limit, Pulse Width (+ Inj0-7), Config overview. Gauge grubu "Calc Model" (Shift+5), "Config Overview". Sınıflar `VemsExpressionGridWidget(Helper)`, `ExpressionGridDesc(Helper)`, `ExpressionCellDescriptor`, `ExpressionCellLink`, `ExprCellColor`, `ExprCellText`. Help `gauges/expression_grid.html`, `main/error_reporting.html` (SHIFT+5).

#### CALC-03 · SRAM reader — P2 · [O]
- ECU RAM'inden struct okuma: `[SRAM] readRealtimeEnabled, maxSiprPacketLength=128, maxReadSramLength=16, rtStruct = "wbo2"|"wbo2_2"|"etime", 10` + `vems.map` adresleri + `sramsections.json`. "SRAM reader" diyaloğu: SRAM Address, sembol combo, periyodik okuma. `SRAMReadDialog`, `SramMapParser`, `SramSection(Filler|Printer)`, `SramReadPart`, `SramRealtimeStruct`.

#### CALC-04 · Symbol test / predefined semboller — P2 · [O]
- `SymbolTest`, `PredefinedSymbolHelper` (metric/imperial önceden tanımlı descriptor'lar), `UnicodeHelper`, `SiprPacketGenerator` (test).

---

## 18. Tercihler (PREF)

#### PREF-01 · VemsTune Preferences diyaloğu (Ctrl+P) — P0/P1 · [O]
- `config/preferences.xml` tarafından tanımlanan panel/sayfa/grup ağacı (kontroller: choice, checkbox, input[int|double|string|password|file|dir|hotkey], radio, slider, color, customconfigpanel); değerler `vtsettings.ini`'ye. Sınıflar `VTPreferences`, `VTPreferencesDialog`, `PreferencesPanelDescr`, `CustomSettings`, `Paramable`, `property`.

| Panel ▸ Sayfa/Grup | Ayar anahtarı | Varsayılan / seçenekler |
|---|---|---|
| General ▸ Overall | `vemslogpreferences` | 1 (0 ECU Log ikonu ON iken / 1 tüm buffer / 2 son kaydedilen index'ten) |
| | `exitquestion` | 1 |
| | `enableAimOnECU` / `enableAimQuestion` | 1 / 0 |
| | `starthere_autoclose` | 1 |
| | `enableWriteBurnAll` | 0 |
| | `extlogviewer` (file) | `C:\usr\MegaLogViewer\MegaLogViewer.exe1` |
| | `auto_config_sanity_check` | 1 |
| | `fullscreen` (hotkey) | Shift+F11 |
| | `show_welcome_screen` | 1 |
| | `compiled_inifiles_enabled` | 1 |
| General ▸ Updates | `check_for_new_release`, `show_nightly_releases`, `vtfilesupdate` (0 never/1 confirm/2 auto), `check_for_reports_changes`, `files_update_downloading_try_count`=10, `files_update_downloading_timeout`=5 | |
| General ▸ Backup | `backuponburn`=1, `maxbackuped`=20 | |
| Communication ▸ ECU / GPS Communication | customconfigpanel `Communications` (CONN-01, GPS-01 gömülü) | |
| Gauges ▸ Groups | `max_open_group`=5, `gauge_groups_behav`=single/multi, `gauge_groups_float_behav`=0/1/2, `editmode_savepolicy`=nosave/current/all, `show_bgimage_editmode`=1, `graph_qual`=0/1/2 (Poor/Middle/Rich), `rtMinRefreshInterval`=60 ms | |
| Gauges ▸ 3D Table Editor | `3dtable_cursor_moving_mode`, `3dtable_cursor_label_align`, `3dtable_marked_label_align`, `3dtable_fontsize`=12, trail: `3dtable_trail_enabled/length=30/sensitivity=2/line_width=2/line_color=0x00FFFF` | |
| Gauges ▸ Table Editor Setting | `te_trail_enabled/length=30/sensitivity=5/line_width=2/line_color=0x000000` | |
| Gauges ▸ GPS Route | `maps_longitude`=19.039998, `maps_latitude`=47.498065, `maps_zoom`=11, `maptilecache` | |
| Gauges ▸ VVTI Camshaft Table Lock | `vvti_camshaft_lock_enabled`, `vvti_camshaft_lock_difference` | |
| Gauges ▸ MultiValueGraph | `mvg_stat_enabled_at_start` | |
| Internet ▸ Proxy | `proxy_enabled/host/port=8080/username/pass` | |
| Internet ▸ Firmware web tool | `fwwebtool_autoinstall`=1 | |
| Internet ▸ Multicast | `multicast_enabled/mode/host/port` | |
| Trigger log & audio ▸ Trigger log | `auto_start_tlog`=1, `tlog_keybspeed`=4 | |
| ▸ Audio panel | `preferred_audio_signal` (20 kod), `rpm_start`=1000 | |
| ▸ Play signal | `audio_frequency`=440, `audio_amplitude`=100 | |

#### PREF-02 · Diğer kalıcı ayar dosyaları — P1 · [O]
- `vtsettings.ini` (tercihler + `/general/*`, `/web/*`, `/gauges/*`, `/taudio/*`, `/communication/serial/*`, `/gps`, `/aimsettings`, `/torqueConfig`, `/sessions/params`), `gui.cfg` / `v3gui.cfg` (AUI perspektifleri), `MultiGraphDesc.cfg`, `racesCache.cfg`, `filesupdate.cfg`, `graphcolors.xml`, `vct_macros.xml`, `RecentProjects.xml`, `rtla_settings.dat`. Sınıflar `ConfigMgrBase`, `ConfigHelper2`, `ProjectConfigHelper`, `DeviceConfigHelper`, `VemsDeviceControllerConfig`, `Serializer/Serializable`.

---

## 19. Hotkey'ler (HK)

#### HK-01 · Hotkey config (profil yöneticisi) — P1 · [O]
- Preferences ▸ Hotkey config ▸ <hedef>: hedefler (`targets.db`): VEMSTableEditor 2D, 3D Table Editor, MultiValue Graph, Differential Gauge, GPSRoute, CurveEditor, Graph. Her hedef için profil (`profiles.db`; "Default"), "Make a copy from this profile", "Activate profile", "Remove current profile", "Remove All", dış `.db/.s3db` profil dosyası ekleme (sürümler arası export/import), komut listesi + kısayollar + "New Shortcut" + "Currently assigned to" çakışma; global hotkey (grup kısayolları) önceliklidir. Sınıflar `wxHotKeyManagerGUI`, `wxHotKeyProfileManager` (wxcode keybinder), `HotKeyDesc`, `HotkeyHelper`. Help `main/preferences/hotkeys.html`.
- Olay listeleri: 2D tablo 36 olay, 3D tablo 41, curve 15, multigraph 42, differ 2, GPS route 9, graph 7 (ayrıntı TUNE-04/05/07, LOG-05, GAUGE-01, GPS-03).

#### HK-02 · Global kısayollar — P0 · [O]
| Kısayol | İşlev |
|---|---|
| Ctrl+P | Preferences |
| Alt+R / Alt+W / Alt+B | Refresh / Write / Burn |
| Alt+L / Alt+K | Start new vemslog / Add marker |
| Shift+F11 | Full screen |
| Ctrl+1/2/3, Ctrl+5 | VE 3D / Ignition 2D / Lambda 2D / VE Adv grupları (welcome: VE-table Ctrl-1, Ignition Ctrl-2, Lambda Ctrl-3) |
| Alt+1/2/3/5/9/I | VE 2D / Ignition 3D / Lambda 3D / Injector Calibration / Analog Inputs All / IAC |
| Shift+1/2/5/8 | Main Overview / GPS / Calc Model / Log Viewer |
| Ctrl+T | Load trace aç/kapa |
| Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+S / Shift+Delete | Edit mode seç/kopyala/yapıştır/kaydet/sil |
| F1 | Bağlamsal help (triggerlog, round display demo…) |
| F11 / F12 | Round gauge min/max ibresini resetle (tek / grup) |
| Shift+Tab | [U] tam ekran/odak |

---

## 20. Web, güncelleme, hata raporu, yardım (WEB)

#### WEB-01 · Check new VemsTune releases — P2 · [O]
- `http://vems.hu/vt/getlastrls.php`; "You are using the newest version" / "New release now available!" + link; nightly seçeneği. `ReleaseChecker(Helper)`.

#### WEB-02 · Automatic file updates — P2 · [O]
- Başlangıçta INI/help/default firmware config dosyalarının sunucu sürümüyle karşılaştırılması (`getfiles.php`, `filesupdate.cfg`, MD5), confirmation dialog ("Do not ask me again until newer updates are available"), "Update files manually", değiştirilmiş dosyaların `.bak` yedeği. `VTFilesUpdater`, `VTFilesUpdaterSettings`, `VTFilesMD5CheckerThread`, `md5wrapper`/`MD5`/`hashwrapper`, `WebUpdates`, `SVNHelper` (SVN çalışma kopyasında devre dışı). Help `main/preferences/automaticupdates.html`.

#### WEB-03 · Update ini files from web — P1 · [O]
- Yeni firmware için INI güncelleme ("Even with newest VT, Preferences/Update ini files from web!"). `v3UpdateHelper`, `v3update.ini`.

#### WEB-04 · Error reporting wizard — P2 · [O]
- "Create a new report" / "Send previously created report" → dosya seçimi (aktif config/log, "Other files…") → açıklama (min 8-10 kelime), rapor tipi (Firmware/Hardware vs VemsTune), username, VEMS wiki members page URL, "Keep it secret" → "Create and Send" / "Create and Send Later". Paket `Report-<date>-<time>.zip` (systeminfo.ini, msg.txt, configdir.md5), yükleme `vems.hu/vemstune/bugreports/bugreport.php`, takip URL'si. `ErrorReportDialog`, `ErrorReportHelper`, `ErrorReportManager(IF)`, `ReportDialogDesc`, `SystemInfoPacker` (`SystemInfo.dll`), `ResourcesLogger`. Help `main/error_reporting.html`.

#### WEB-05 · Previously sent reports / rapor durum takibi — P2 · [O]
- `reports.db`, "Latest reports (show only if the report status has been changed)", "Refresh statuses", "Open url…", "New status!" (`reports.php?cmd=getstatus`). `ErrorReportListDialog`, `ReportChecker`.

#### WEB-06 · Vems Sharing Center — P2 · [O]
- "Send files or anything to anyone" — rapor altyapısıyla dosya paylaşımı (`vems-sharingcenter.png`).

#### WEB-07 · Proxy/HTTP altyapısı — P2 · [O]
- `libcurl` + `wxcurl`, proxy ayarları, `WebHelper`, `WebProxyHelper`, `URLDesc`, `webcache/`.

#### WEB-08 · Help sistemi — P1 · [O]
- Help Topics (`help2/vemstune.hhp` HTML help, eski `dialogs/dialogs.hhp`), her INI dialog için `topicHelp` ile F1/bağlam yardımı, gömülü HTML help panelleri (live analyzer, edit mode), online fallback `http://www.vems.hu/manual/vemstune/help2/htmls`. `HelpUtil`, `VemsGuideHtmlWindow`, `SearchDialogHelp`.

#### WEB-09 · Beklenmeyen hata diyaloğu — P2 · [O]
- "Unhandled unknown exception caught", SQLite hata ayrıntısı, "Copy to clipboard", "Send report". `VemsExceptionBase`, `s_exception`.

---

## 21. Diğer / geliştirici araçları (MISC)

| ID | Özellik | Ayrıntı | Sınıflar | P | Kanıt |
|---|---|---|---|---|---|
| MISC-01 | About | Sürüm, wx sürümü, "Documentation writers", vems.hu linkleri | `VemsAboutDialog` | P2 | O |
| MISC-02 | Splash screen | `vemstune-banner-black-starting.png` | `VemsSplashScreen` | P2 | O |
| MISC-03 | Testing IniFiles / Test config parsing | Tüm INI'leri parse testi | `MainFrame::OnTestingIniFiles` | P2 | O |
| MISC-04 | Table 3D Test | 3D tablo demo | `OnDevTable3D` | P2 | O |
| MISC-05 | ConfigEditFrame | Config değerlerini panelden dosyaya yazma | `ConfigEditFrame/Panel` | P2 | U |
| MISC-06 | Environment editor | `EnvironmentEditFrame` (ortam değişkenleri / `%vemsdocuments%`, `%vemstunedir%` yolları [I]) | | P2 | U |
| MISC-07 | Resource/CPU logger | `resourcelog-*`, `CpuUsage(Base)`, `ResourceUsage` | | P2 | O |
| MISC-08 | Operation logger | `operations-%d.db` (işlem başlangıç/başarı kaydı; başarısız tarama sonrası iletişimi kapatma) | `OperationLogger(Helper)`, `OperationChecker` | P2 | O |
| MISC-09 | Print Toolbar Layout | toolbar düzenini log'a yaz | | P2 | O |
| MISC-10 | Unidlg2Test | Proje config satır editörü testi | `Unidlg2Test` | P2 | O |
| MISC-11 | Logger | `Logger`, `twLogger` (`VEMS_Files` log dizini) | | P1 | O |
| MISC-12 | Exit onayı & AIM etkinleştirme | "Are you sure you want to exit VemsTune?", "Do you want to enable AIM on ECU?" | | P1 | O |
| MISC-13 | Thread/event altyapısı | `ThreadBase`, `ThreadProcess(Func)`, `SafeQueue`, `SyncObj`, `Observable/ObserverBase`, `EventHandlerContainer`, `VemsTuneEventDispatcher`, `VemsTuneCore`, `VemsContext(Helper)`, `appHelper`, `MyApp` | | P0 (altyapı) | O |
| MISC-14 | Fontlar/görseller | `fonts/` (arial, VeraMono, Futura2, LED.ttf, 7 Segmentdot), `graphics/`, `images/`, `IconSetsHelper`, `ImageLoader` | | P1 | O |

---

## 22. Sürprizler, açık bilinmeyenler ve yeniden yazım notları

### 22.1 Dikkat çekici bulgular
1. **Tuning UI'nın tamamı INI'den geliyor** (89 dialog, 35 tablo, ~957 curve tanımı — 912'si anytrim giriş tipi varyantı; 431 output channel). Yeni uygulamanın çekirdeği sağlam bir **INI parser + önişlemci + ifade motoru + koşullu görünürlük** olmalıdır; ekranları elle kodlamak yanlış olur.
2. **Calc model / Expression Grid**: VemsTune, firmware'in yakıt/ateşleme/boost/lambda hesaplarını PC tarafında yeniden üretip ECU sonucuyla karşılaştırıyor (`disp_*_diff`, `calcmodel.db`). Destek sürecinin (Shift+5) merkezinde.
3. **Firmware'in kendisi VemsTune üzerinden indirilip kuruluyor** (web tool + wizard + bootloader session-key) ve config validation **kurulu firmware descriptor'ına** (`fw_desc/firmware_X.Y.Z/global.h, my_make`) bağlı.
4. **Seri numarasına bağlı kalibrasyon koruması**: farklı ECU seri numaralı config yüklenince kalibrasyon verisi yazılmıyor.
5. Beklenmedik niş alt sistemler: **Modbus master + VFD/PLC kontrolü + Sequencer + Virtual devices**, **ses kartı ile tetik sinyali üretme/okuma**, **WiFly**, **UDP multicast**, **hub4com**, **dd.exe ile SD imaj okuma**, **harita tile cache + reverse geocoding**, **Toyota A340E otomatik şanzıman** ve **Woodgas** menüleri, **ARM** cihaz prototipi.
6. Birçok "test/dev" menüsü release binary'de duruyor (wince test, Triggercalc Test, Mixture Table Test, ConfigChecker test, Generate VemsLog) — UI'da gizli olabilir.

### 22.2 Açık bilinmeyenler [U]
- `OnEditConfig` (ConfigEditFrame) ve `EnvironmentEditFrame`'in menü yeri ve kullanıcıya açık olup olmadığı.
- `OnDevOtherMenu`'nün hangi koşulda göründüğü (dev build / gizli tuş / pref?).
- `OnSFlood`, `OnMMCLog` alt menüsünün tam öğe listesi ("Stop" öğesi var mı), `OnMenuLoggerScreen`.
- `Graph (GL)` / `GraphHWA` farkı; `Shift+Tab` işlevi.
- ECU Modbus modu (`VemsModbusClient`, "MODBUS mode not enabled") ve Sequencer'ın hangi donanım senaryosunda kullanıldığı.
- `GPSMapPlanner` rota servislerinin UI'daki yeri.
- `config/modbus/*` parametre dosyaları bu kurulumda boş — VFD parametre formatı bilinmiyor.
- Audi config upload'un tam akışı.
- Menü sırası string sırasından çıkarıldı; gerçek menü hiyerarşisi (özellikle Preferences ve Dev) çalışan uygulamada doğrulanmalı.

### 22.3 Doğrulama önerisi
- REA `capture_native_ui_scenario` / ekran görüntüsü ile her üst menünün açılıp etiketlerin doğrulanması; `MainFrame::createMenu` decompile edilerek menü ID → handler eşlemesinin kesinleştirilmesi.

---

## Ek A — Sayım tablosu

| Alan | ID önek | Özellik sayısı (bu katalogda) | P0 | P1 | P2 |
|---|---|---|---|---|---|
| Ana menü handler'ları | `MainFrame::On*` | 135 handler (tabloda gruplanmış) | — | — | — |
| Bağlantı / cihaz | CONN | 24 | 9 | 8 | 7 |
| Proje & dosyalar | FILE | 14 | 5 | 6 | 3 |
| Firmware / config transferi | FW | 18 | 5 | 9 | 4 |
| Tuning dialog & editörler | TUNE | 23 (+89 INI dialog, 35 tablo, 9 interp. widget, V3 menü tablosunda ~95 giriş, Round ~25 giriş) | 10 | 10 | 3 |
| Config doğrulama | VAL | 6 | 2 | 1 | 3 |
| Gauge & dashboard | GAUGE | 19 (+21 widget tipi, 21 ön tanımlı grup) | 7 | 9 | 3 |
| Datalog & analiz | LOG | 20 | 5 | 6 | 9 |
| Trigger | TRIG | 7 | 1 | 1 | 5 |
| Knock | KNOCK | 3 | 0 | 3 | 0 |
| Kalibrasyon / WBO2 | CAL | 5 | 1 | 4 | 0 |
| SD kart | SD | 5 | 0 | 3 | 2 |
| Modbus / sequencer | MB | 5 | 0 | 0 | 5 |
| GPS / harita / yarış | GPS | 8 | 0 | 3 | 5 |
| AIM / Round / PDA | AIM | 8 | 0 | 2 | 6 |
| Audio | AUDIO | 3 | 0 | 0 | 3 |
| Calc / ifadeler | CALC | 4 | 1 | 1 | 2 |
| Tercihler | PREF | 2 (+~60 ayar anahtarı) | 1 | 1 | 0 |
| Hotkey | HK | 2 (+152 hotkey olayı, 7 hedef) | 1 | 1 | 0 |
| Web / güncelleme / rapor / help | WEB | 9 | 0 | 2 | 7 |
| Diğer / dev | MISC | 14 | 1 | 3 | 10 |
| **Toplam** | | **~199 katalog özelliği** | | | |

Not: P0/P1/P2 dağılımı yaklaşık; "P0/P1" çift etiketli maddeler ilk etikete sayılmıştır.

## Ek B — Kaynak dosya → özellik hızlı indeks
| Dosya | İlgili ID |
|---|---|
| `config/vemsTune-*.ini`, `config/include/*.ini` | TUNE-01/02/21/22/23, CALC-01/02, CONN-05 |
| `config/preferences.xml` | PREF-01 |
| `config/ConfigCriteria.xml`, `Round-ConfigCriteria.xml` | VAL-01 |
| `config/TriggerSettingsValidation.xml` | VAL-03 |
| `config/VemsErrorMessages.xml` | CONN-18 |
| `config/gauges*.db`, `gaugegroups.db`, `gauges.xml`, `GaugeDescriptors.(db|xml)`, `GDDesc.xml`, `GaugeSymbols.xml`, `GaugesSettings.db` | GAUGE-01..05, GAUGE-14 |
| `config/VemsFlagDesc.(db|xml)`, `Round-FlagDesc.xml` | GAUGE-10/11 |
| `config/WidgetThemes.xml` | GAUGE-12 |
| `config/GUILayoutDesc.(db|xml)` | GAUGE-16 |
| `config/MultiGraphDesc*.db|xml|cfg`, `MultiGraphTheme.db`, `defaultstatements/*.sql` | LOG-05 |
| `config/DiffGaugeDesc.db`, `ColsGaugeDesc.db`, `customvaluegauge.db` | GAUGE-07/08/09 |
| `config/expressiondb.db`, `calcmodel.db` | LOG-11/14/16 |
| `config/hotkeys/*.db` | HK-01 |
| `config/outputchannels.s3db` | TUNE-14, VAL-02 |
| `config/maps.xml` | GPS-03 |
| `config/aimdsettings.db`, `aimpanel.xml`, `aim-*.db` | AIM-02/04/05 |
| `config/pdascreen.xml`, `Round-pdascreen.xml`, `v3cockpit.cfg`, `cockpit-v3-*.ini`, `vemsv3pda.ini` | AIM-06 |
| `config/virtual_devices.cfg`, `config/modbus/*` | MB-02/03 |
| `config/password*.txt` | CONN-11, FW-13 |
| `config/fw/`, `config/fw_desc/`, `defaultfirmwareconfigs/`, `coolantfactor/`, `matfactor/` | FW-07/09/12/17 |
| `config/sramsections.json` | CALC-03 |
| `config/workingdirs.db`, `recentfiles.db`, `filedlgsettings.db`, `dialogLayout.db` | CONN-12, FILE-05/14, TUNE-20 |
| `config/graphcolors.xml` | TRIG-01 |
| `configlets/*` | TUNE-13 |
| `configfilters/*` | FW-04 |
| `config/v3update.ini` | FW-13, WEB-03 |
| `3rdparty/dd.exe` | SD-04 |
| `VemsLogger.exe`, `vemsTune-c.exe` | LOG-08, FILE-13 |
