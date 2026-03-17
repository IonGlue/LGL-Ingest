# ATEM Dumps

Binary init dumps and proxy captures from real ATEM hardware.

## Files

| File | Size | Description |
|------|------|-------------|
| `ATEM_2_M_E_Constellation_4K.bin` | 85830 bytes | Full init dump from Constellation 4K |
| `ATEM_Television_Studio_HD.bin` | — | Init dump from TV Studio HD |
| `active_dump_85830.bin` | 85830 bytes | Known-working replay dump (same model as Constellation 4K) |
| `debug_proxy_log.txt` | — | Full transparent proxy capture — real ATEM responses verbatim |

## Format

Each `.bin` file is a sequence of raw BMDP (Blackmagic Protocol) packets:

```
Packet header (12 bytes):
  [0:2]  flags(3b) + length(13b), big-endian
  [2:4]  session ID
  [4:6]  remote sequence number
  [6:8]  local sequence number
  [8:10] unknown (often 0)
  [10:12] ack sequence number

Command (within packet payload):
  [0:2]  total command length including this header (big-endian)
  [2:4]  flags (usually 0)
  [4:8]  4-char ASCII command name
  [8..]  command payload
```

## Key Commands for PVW Debugging

| Command | Purpose | Known issue |
|---------|---------|-------------|
| `PrvI` | Preview input source per M/E | Likely wrong bytes causing PVW LED failure |
| `PrgI` | Program input source per M/E | Works (PGM LED lights) |
| `TlIn` | Tally by input index (bit0=PGM, bit1=PVW) | May have wrong bit layout |
| `TlSr` | Tally by source (sparse) | — |
| `MePg` | M/E state page | — |

## Analysis Tools

```bash
# See what real ATEM sends for PrvI and TlIn
python3 ../tools/parse_atem_commands.py dump debug_proxy_log.txt --cmd PrvI TlIn TlSr

# Focused PVW debug view
python3 ../tools/debug_pvw_diff.py real debug_proxy_log.txt

# Capture emulator output and diff against real
python3 ../tools/capture_emulator.py --listen-port 9911 --target localhost:9910 --out emulator_capture.bin
# (connect panel to port 9911 instead of 9910, then Ctrl-C)
python3 ../tools/debug_pvw_diff.py diff debug_proxy_log.txt emulator_capture.bin
```
