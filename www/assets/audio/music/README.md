# Procedural soundtrack assets

The game soundtrack is generated locally by `scripts/generate_soundtrack.py` using Python's standard library. The resulting music is original Chip Savage material: loop-ready arcade grooves with warm synth chords, bass, restrained drums, and a bright golf-bell motif. The ambient loops are generated from layered tones, noise, and sparse accents.

From the repository root, run `npm run audio:generate` to recreate the assets. The game supports the generated mono 22.05 kHz WAV files directly. To also create compact quality-5 OGG files, install the optional encoder dependency with `python -m pip install -r requirements-audio.txt`; the audio manager prefers OGG when supported and falls back to WAV. A system `ffmpeg` with `libvorbis` also works.

Generated tracks cover the names used by level configs and boss/menu playback:

- Music: `menu_theme`, `gameplay`, `forest_theme`, `city_theme`, `action_theme`, `cave_ambient`, `ambient_cave_loop`, `boss_theme`, `boss_battle`
- Environment beds: `ambient_forest`, `ambient_city`, `ambient_cave_deep`

WAV/OGG outputs are generated build assets; edit the arrangement parameters and synthesis in the Python generator, then regenerate rather than hand-editing audio files.
