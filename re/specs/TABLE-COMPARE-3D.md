# TUNE-11 · Table Compare 3D

Source: `re/ghidra/out/TableCompare3DFrame.*`, `TableCompare3DGLCanvas.*` (targets-tc3d.tsv).

## VemsTune 1.5.46 behaviour

- Frame "Table Compare 3D": File 1 / File 2 (Open → `*.vemscfg`), "Load from VT" checkbox, Mode, Type, "Show info", "Reset Display".
- **Load from VT** (`chk_loadfromvt`): File 1 = `MTConfigHelper::getDefaultConfigFile()` (the tune VemsTune is currently using) instead of the file; disables the File 1 picker (UpdateControls).
- **Mode** (`cbx_mode` → canvas flags 0x203/0x204/0x205 = draw F1 / F2 / Diff):
  `File 1` · `File 2` · `File 1 + File2` · `Difference` · `File 1 + File2 + Difference`.
- **Type** (`cbx_loadtype` index+1 → 0x2b4): `VE Table` = 14×16, user table `"j"`; `Ignition` = 12×12, user table `"n"`; `Simulation` (`chk_simulation`) = test surfaces sin(πr/(R−1))·sin(πc/(C−1)) and sin(2πr/(R−1))·sin(5πc/(C−1)).
- LoadConfigFile: FirmwareConfigLoader parse → calculateTables → getUserTable(name); LoadConfigData rejects a table whose rows/cols differ from the type, flips rows, scales each value.
- Difference = File 1 − File 2, cell by cell (LoadData).
- RenderGraph: File 1 `g_GLRed`, File 2 `g_GLDarkGreen`, Diff `g_GLBlue` with per-vertex colour: value > 0 → red, ≤ 0 → blue, intensity a + b·|v|. Optional net (T), coord system (C), wireframe (W), rotate (R); camera keys N/M/J/K, Shift+Y / Ctrl+Y zoom.

## Our implementation (`apps/tuner/src/components/TableCompare3D.tsx`)

Tables tab → "Karşılaştır 3D" (also command palette group "Karşılaştır 3D").
- Any INI 2D table (not only VE/Ignition); axis labels from File 1. A warning shows when the bins differ, but the comparison stays cell by cell, as in VemsTune.
- Each side can be: ECU (live pages, the "Load from VT" equivalent), one of VemsTune's default configs (`defaultfirmwareconfigs/config_<fw>.vemscfg`), or a local `.vemscfg`. The sides can be swapped (⇄).
- Same five modes. File 1 + File 2 draws File 1 solid red and File 2 as a translucent green ghost. The all-three mode colours File 1 by the difference (red/blue) instead of drawing a third surface. Difference only draws the zero plane.
- Info panel (Show info) shows the number of cells that differ, max + / max −, mean |Δ| and RMS. A 2D difference grid sits beside the view.
- Simulation type is not implemented, since it is a test pattern.
