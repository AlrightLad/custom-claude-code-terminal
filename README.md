# Custom Claude Code Terminal — Golf

A procedurally generated 8-bit golf course that plays itself in your Claude
Code status line. The golfer works while the agent works, strolls the fairway
with a caddie while it waits on you, and sinks a putt when the task finishes.

Every hole, every shot, every caddie is generated from the session seed. The
golfer plays to a 12 handicap, so he is worth watching.

## Install

    git clone <this repo> C:/Projects/Custom-Claude-Code-Terminal
    cd C:/Projects/Custom-Claude-Code-Terminal
    bash install/install.sh

Restart Claude Code. `bash install/uninstall.sh` reverts.

Optional: see `assets/sound/fetch.md` for the hole-out sound.

## Requirements

Node 18+, Claude Code, Git Bash on Windows. Windows Terminal 1.22+ if the
Sixel backend ever lands.

## Development

    bash harness/replay.sh harness/fixtures/working.json 2 60   # watch it
    bash harness/widths.sh                                      # width matrix
    bash harness/perf.sh                                        # p99 gate

See `docs/PROBE.md` for measured platform behavior.

## License

MIT. The hole-out sound is not included; see `assets/sound/fetch.md`.
