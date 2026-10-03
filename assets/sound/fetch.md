# Putt-in-the-cup sound

Not redistributed with this repo — download it yourself.

Source: https://pixabay.com/sound-effects/film-special-effects-minigolf-putt-right-into-the-hole-96699/
License: Pixabay Content License (check current terms before redistributing)

Windows Media.SoundPlayer is WAV-only, so convert after downloading:

    ffmpeg -i <downloaded>.mp3 -ar 22050 -ac 1 assets/sound/putt-drop.wav

Any short WAV works. Drop it at assets/sound/putt-drop.wav and the Stop hook
will find it. No file = silent, no error.
