# Procedural soundtrack assets

The game soundtrack is generated locally by `scripts/generate_soundtrack.py` using Python's standard library. The original melodies now use a synthesized sax-like lead with soft synthesized strings in the background. The menu and forest share a musical golf shot: two pickups, an accented high note, a pause, and a lower landing note. The menu introduces it in a percussion-free 72 BPM waltz. The forest repeats it every four bars with a different landing each time. Other gameplay cues retain their five-note hooks and golf-bell accents. Separate environmental ambience is not played.

From the repository root, run `npm run audio:generate` to recreate the assets. The game supports the generated mono 22.05 kHz WAV files directly. To also create compact quality-5 OGG files, install the optional encoder dependency with `python -m pip install -r requirements-audio.txt`; the audio manager prefers OGG when supported and falls back to WAV. A system `ffmpeg` with `libvorbis` also works.

Generated tracks cover the names used by level configs and boss/menu playback:

- Music: `menu_theme`, `gameplay`, `forest_theme`, `city_theme`, `action_theme`, `cave_ambient`, `ambient_cave_loop`, `boss_theme`, `boss_battle`

WAV/OGG outputs are generated build assets; edit the arrangement parameters and synthesis in the Python generator, then regenerate rather than hand-editing audio files.
