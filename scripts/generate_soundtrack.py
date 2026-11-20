"""Generate original, loop-ready Chip Savage music using only Python's standard library.

The arrangements use a shared retro-sport / arcade palette: warm synth chords,
round bass, a restrained breakbeat, and a short golf-bell motif. Run from the
repository root with the selected Python interpreter. WAV output is intentional;
the game can play WAV directly and will prefer an optional OGG alongside it.
"""

from __future__ import annotations

import argparse
import math
import random
import shutil
import struct
import subprocess
import wave
from array import array
from pathlib import Path

SAMPLE_RATE = 22050
ROOT = Path(__file__).resolve().parents[1]
MUSIC_DIR = ROOT / "assets" / "audio" / "music"
BEATS_PER_BAR = 4
BARS = 16

# root MIDI pitch, BPM, minor mode, rhythmic energy, and a deterministic seed.
ARRANGEMENTS = {
    "menu_theme": (57, 96, False, 0.28, 11),
    "gameplay": (53, 112, False, 0.56, 23),
    "forest_theme": (60, 104, False, 0.44, 37),
    "city_theme": (55, 116, False, 0.60, 41),
    "action_theme": (52, 128, True, 0.82, 53),
    "cave_ambient": (50, 92, True, 0.30, 67),
    "ambient_cave_loop": (50, 88, True, 0.22, 71),
    "boss_theme": (45, 132, True, 0.90, 83),
    "boss_battle": (45, 144, True, 1.00, 97),
}


def midi_hz(note: float) -> float:
    return 440.0 * (2.0 ** ((note - 69.0) / 12.0))


def add_note(
    samples: array,
    start: float,
    duration: float,
    note: float,
    amplitude: float,
    voice: str = "warm",
    attack: float = 0.015,
    release: float = 0.12,
    vibrato: float = 0.0,
) -> None:
    """Mix one enveloped oscillator note into a mono floating-point buffer."""
    first = max(0, int(start * SAMPLE_RATE))
    count = min(int(duration * SAMPLE_RATE), len(samples) - first)
    if count <= 0:
        return
    frequency = midi_hz(note)
    phase_step = 2.0 * math.pi * frequency / SAMPLE_RATE
    attack_samples = max(1, int(attack * SAMPLE_RATE))
    release_samples = max(1, int(release * SAMPLE_RATE))
    for offset in range(count):
        remaining = count - offset
        envelope = min(1.0, offset / attack_samples, remaining / release_samples)
        t = offset / SAMPLE_RATE
        phase = phase_step * offset
        if vibrato:
            phase += vibrato * math.sin(2.0 * math.pi * 5.0 * t) * t
        fundamental = math.sin(phase)
        if voice == "bell":
            value = (fundamental + 0.34 * math.sin(phase * 2.01) + 0.13 * math.sin(phase * 3.97))
            envelope *= math.exp(-4.2 * t / max(duration, 0.01))
        elif voice == "bass":
            value = 0.82 * fundamental + 0.18 * math.sin(phase * 2.0)
        elif voice == "pad":
            value = 0.70 * fundamental + 0.20 * math.sin(phase * 2.0) + 0.10 * math.sin(phase * 3.0)
        else:
            value = 0.78 * fundamental + 0.16 * math.sin(phase * 2.0) + 0.06 * math.sin(phase * 3.0)
        samples[first + offset] += value * amplitude * envelope


def add_drums(samples: array, bpm: int, energy: float, rng: random.Random) -> None:
    beat = 60.0 / bpm
    total_beats = BARS * BEATS_PER_BAR
    if energy < 0.35:
        return
    for index in range(total_beats):
        bar_beat = index % BEATS_PER_BAR
        start = index * beat
        if bar_beat in (0, 2):
            # Soft, pitched kick with a short downward pitch sweep.
            first = int(start * SAMPLE_RATE)
            count = min(int(0.20 * SAMPLE_RATE), len(samples) - first)
            for i in range(max(0, count)):
                t = i / SAMPLE_RATE
                freq = 118.0 - 54.0 * min(1.0, t / 0.20)
                samples[first + i] += math.sin(2.0 * math.pi * freq * t) * math.exp(-21.0 * t) * 0.18 * energy
        if bar_beat in (1, 3) and energy > 0.5:
            first = int((start + beat * 0.002) * SAMPLE_RATE)
            count = min(int(0.105 * SAMPLE_RATE), len(samples) - first)
            for i in range(max(0, count)):
                t = i / SAMPLE_RATE
                noise = rng.uniform(-1.0, 1.0)
                tone = math.sin(2.0 * math.pi * 185.0 * t) * 0.22
                samples[first + i] += (noise * 0.78 + tone) * math.exp(-32.0 * t) * 0.055 * energy
        # A light golf-club tick on alternating eighth notes.
        for subdivision in (0, 2):
            if subdivision == 2 and energy < 0.7:
                continue
            tick_start = start + subdivision * beat / 4.0
            first = int(tick_start * SAMPLE_RATE)
            count = min(int(0.028 * SAMPLE_RATE), len(samples) - first)
            for i in range(max(0, count)):
                t = i / SAMPLE_RATE
                samples[first + i] += rng.uniform(-1.0, 1.0) * math.exp(-95.0 * t) * 0.022 * energy


def compose_track(name: str, settings: tuple[int, int, bool, float, int]) -> array:
    root_note, bpm, minor, energy, seed = settings
    rng = random.Random(seed)
    beat = 60.0 / bpm
    bar = beat * BEATS_PER_BAR
    duration = BARS * bar
    samples = array("f", [0.0]) * int(duration * SAMPLE_RATE)

    if minor:
        chords = [(0, (0, 3, 7)), (7, (0, 3, 7)), (8, (0, 4, 7)), (5, (0, 3, 7))]
        scale = (0, 2, 3, 5, 7, 8, 10)
    else:
        chords = [(0, (0, 4, 7)), (7, (0, 4, 7)), (9, (0, 3, 7)), (5, (0, 4, 7))]
        scale = (0, 2, 4, 5, 7, 9, 11)

    # Four long chords per 16-bar pass; upper tones breathe so the beat stays clear.
    for chord_index, (offset, intervals) in enumerate(chords):
        start = chord_index * 4 * bar
        length = 4 * bar
        for tone_index, interval in enumerate(intervals):
            add_note(
                samples,
                start,
                length,
                root_note + offset + interval + 12,
                (0.035 if tone_index else 0.052) * (1.0 - energy * 0.18),
                voice="pad",
                attack=0.65,
                release=0.75,
                vibrato=0.025,
            )

    # A syncopated root / fifth bass line anchors each chord section.
    bass_pattern = (0, 0, 7, 0, 0, 7, 3, 7)
    for beat_index in range(BARS * BEATS_PER_BAR):
        chord_index = (beat_index // 16) % 4
        chord_offset, _ = chords[chord_index]
        pattern_value = bass_pattern[beat_index % len(bass_pattern)]
        duration_s = beat * (0.72 if beat_index % 2 == 0 else 0.42)
        add_note(
            samples,
            beat_index * beat,
            duration_s,
            root_note + chord_offset + pattern_value - 12,
            0.11 + 0.05 * energy,
            voice="bass",
            attack=0.008,
            release=min(0.10, duration_s * 0.45),
        )

    # A small, recurring bell phrase gives the score a bright golf-ball / cup-ring identity.
    motif_degrees = (4, 2, 1, 2, 4, 6, 4, 2, 0, 2, 4, 2, 1, 2, 4, 6)
    eighth = beat / 2.0
    for step in range(64):
        if step % 8 not in (0, 2, 3, 6):
            continue
        degree = motif_degrees[step % len(motif_degrees)]
        octave = 12 if step % 16 in (0, 6) else 0
        note = root_note + scale[degree % len(scale)] + 12 + octave
        note_start = step * eighth
        add_note(
            samples,
            note_start,
            eighth * (0.78 if step % 4 else 1.25),
            note,
            0.040 + 0.045 * energy,
            voice="bell",
            attack=0.004,
            release=0.28 if energy < 0.7 else 0.18,
        )

    add_drums(samples, bpm, energy, rng)

    # Subtle variation in the second half: soft counter-melody notes every other bar.
    for bar_index in range(8, BARS, 2):
        degree = rng.choice((0, 2, 4, 6))
        add_note(
            samples,
            bar_index * bar + beat * 2.5,
            beat * 0.7,
            root_note + scale[degree] + 24,
            0.018 + energy * 0.018,
            voice="warm",
            attack=0.02,
            release=0.15,
        )

    normalize_and_loop(samples)
    return samples


def compose_ambient(name: str, seed: int) -> array:
    duration = 20.0
    count = int(duration * SAMPLE_RATE)
    samples = array("f", [0.0]) * count
    rng = random.Random(seed)
    profiles = {
        "ambient_forest": (130.81, 196.00, 261.63),
        "ambient_city": (55.0, 82.41, 110.0),
        "ambient_cave_deep": (41.20, 55.0, 82.41),
    }
    tones = profiles[name]
    for i in range(count):
        t = i / SAMPLE_RATE
        swell = 0.55 + 0.20 * math.sin(2.0 * math.pi * 0.07 * t) + 0.12 * math.sin(2.0 * math.pi * 0.11 * t + 1.2)
        drone = sum(math.sin(2.0 * math.pi * f * t) for f in tones) / len(tones)
        noise = rng.uniform(-1.0, 1.0)
        noise_gain = 0.035 if name == "ambient_forest" else 0.022
        samples[i] = drone * swell * 0.12 + noise * noise_gain

    # Sparse, softly decaying environmental accents.
    accent_count = 22 if name == "ambient_forest" else 14
    for _ in range(accent_count):
        start = rng.uniform(0.2, duration - 0.6)
        freq = rng.uniform(1400.0, 3500.0) if name != "ambient_city" else rng.uniform(280.0, 520.0)
        length = rng.uniform(0.08, 0.35)
        first = int(start * SAMPLE_RATE)
        end = min(count, first + int(length * SAMPLE_RATE))
        amplitude = rng.uniform(0.008, 0.025)
        for index in range(first, end):
            t = (index - first) / SAMPLE_RATE
            samples[index] += math.sin(2.0 * math.pi * freq * t) * math.exp(-9.0 * t) * amplitude

    normalize_and_loop(samples, target_peak=0.30)
    return samples


def normalize_and_loop(samples: array, target_peak: float = 0.78) -> None:
    peak = max((abs(value) for value in samples), default=0.0)
    if peak:
        scale = target_peak / peak
        for i in range(len(samples)):
            samples[i] *= scale
    # Overlap the tail into the head so the last sample resolves into the first.
    fade = min(int(0.075 * SAMPLE_RATE), len(samples) // 8)
    if fade > 1:
        head = samples[:fade]
        tail = samples[-fade:]
        overlap = array("f")
        for i in range(fade):
            phase = (i / (fade - 1)) * (math.pi / 2.0)
            overlap.append(tail[i] * math.cos(phase) + head[i] * math.sin(phase))
        samples[:] = samples[fade:-fade] + overlap


def write_wav(name: str, samples: array) -> Path:
    path = MUSIC_DIR / f"{name}.wav"
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    pcm = array("h", (int(max(-1.0, min(1.0, value)) * 32767) for value in samples))
    if struct.pack("=h", 1) != struct.pack("<h", 1):
        pcm.byteswap()
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm.tobytes())
    return path


def get_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg

            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except (ImportError, RuntimeError):
            ffmpeg = None
    return ffmpeg


def maybe_encode_ogg(wav_path: Path) -> bool:
    ffmpeg = get_ffmpeg()
    if not ffmpeg:
        return False
    ogg_path = wav_path.with_suffix(".ogg")
    result = subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav_path), "-c:a", "libvorbis", "-q:a", "5", str(ogg_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        print(f"  OGG skipped ({result.stderr.strip() or 'encoder unavailable'})")
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the original Chip Savage procedural soundtrack.")
    parser.add_argument("--no-ogg", action="store_true", help="write WAV only; OGG is generated automatically when ffmpeg is available")
    args = parser.parse_args()

    outputs = []
    for name, settings in ARRANGEMENTS.items():
        samples = compose_track(name, settings)
        path = write_wav(name, samples)
        encoded = maybe_encode_ogg(path) if not args.no_ogg else False
        size_mb = path.stat().st_size / (1024 * 1024)
        print(f"{name}: {len(samples) / SAMPLE_RATE:.1f}s WAV, {size_mb:.2f} MiB" + (" + OGG" if encoded else ""))
        outputs.append(path)

    for index, name in enumerate(("ambient_forest", "ambient_city", "ambient_cave_deep")):
        path = write_wav(name, compose_ambient(name, 131 + index * 17))
        encoded = maybe_encode_ogg(path) if not args.no_ogg else False
        print(f"{name}: 20.0s WAV, {path.stat().st_size / (1024 * 1024):.2f} MiB" + (" + OGG" if encoded else ""))

    print(f"\nGenerated {len(outputs) + 3} original loops in {MUSIC_DIR}")
    if not get_ffmpeg() and not args.no_ogg:
        print("ffmpeg not found: WAV files are game-ready; install ffmpeg and rerun to add compact OGG versions.")


if __name__ == "__main__":
    main()
