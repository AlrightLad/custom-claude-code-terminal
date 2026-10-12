# Sounds (not redistributed — download your own)

No audio ships with this repo. The hooks look for two optional WAV files and
stay silent, with no error, when either is missing. `CCGOLF_SOUND=off`
disables sound entirely.

| File | Plays when |
|---|---|
| `assets/sound/putt-drop.wav` | the main session finishes a turn (Stop hook) |
| `assets/sound/subagent-putt.wav` | a subagent finishes (SubagentStop hook) |

Windows `Media.SoundPlayer` is WAV-only; macOS uses `afplay`, Linux `paplay`
or `aplay`. Any short WAV works. One source for a putt sound:

    https://pixabay.com/sound-effects/film-special-effects-minigolf-putt-right-into-the-hole-96699/

License there is the Pixabay Content License (check current terms before
redistributing). Convert to a mono 22 kHz WAV:

    ffmpeg -i <downloaded>.mp3 -ar 22050 -ac 1 assets/sound/putt-drop.wav

For the subagent cue, use any distinct short WAV (a softer tap reads well):

    ffmpeg -i <other>.mp3 -ar 22050 -ac 1 assets/sound/subagent-putt.wav

Drop the files in `assets/sound/` and the hooks find them. They are gitignored
so they are never committed.
