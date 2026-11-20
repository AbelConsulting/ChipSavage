"""Generate original, loop-ready Chip Savage music using only Python's standard library.

The arrangements use a shared retro-sport / arcade palette: warm synth chords,
round bass, a restrained breakbeat, and bell-accented lead melodies. Run from the
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
    "menu_theme": (53, 72, False, 0.0, 11),
    "gameplay": (53, 112, False, 0.56, 23),
    "forest_theme": (60, 104, False, 0.44, 37),
    "city_theme": (55, 116, False, 0.60, 41),
    "action_theme": (52, 128, True, 0.82, 53),
    "cave_ambient": (50, 92, True, 0.30, 67),
    "ambient_cave_loop": (50, 88, True, 0.22, 71),
    "boss_theme": (45, 132, True, 0.90, 83),
    "boss_battle": (45, 144, True, 1.00, 97),
}

# Five-note calls in scale degrees (0 = tonic, 7 = upper tonic).
HOOKS = {
    "gameplay": (0, 2, 4, 7, 5),
    "forest_theme": (4, 2, 1, 2, 5),
    "city_theme": (2, 2, 5, 4, 1),
    "action_theme": (0, 4, 3, 2, 4),
    "cave_ambient": (4, 1, 2, 0, -1),
    "ambient_cave_loop": (2, 0, -2, 1, 0),
    "boss_theme": (0, -1, 0, 4, 3),
    "boss_battle": (4, 4, 7, 6, 3),
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
        elif voice == "nylon":
            value = (0.85 * fundamental + math.exp(-7 * t) *
                     (0.25 * math.sin(phase * 2) + 0.14 * math.sin(phase * 3)))
            envelope *= math.exp(-2.2 * t)
        elif voice == "soft_keys":
            value = 0.91 * fundamental + 0.09 * math.sin(phase * 2.0)
            envelope *= math.exp(-1.6 * t)
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


def add_shot_phrase(samples: array, start: float, beat: float, tonic: int,
                    landing: int, voice: str) -> None:
    # Two pickups, contact, then a beat of flight before the ball lands.
    for onset, length, offset, gain in (
        (0.25, 0.22, 2, 0.10), (0.625, 0.25, 4, 0.115),
        (1, 0.45, 9, 0.18), (2.5, 0.48, landing, 0.135),
    ):
        add_note(samples, start + onset * beat, length * beat, tonic + offset,
                 gain, voice=voice, attack=0.028 if voice == "soft_keys" else 0.006,
                 release=0.075)


def compose_menu(root: int, bpm: int) -> array:
    """A quiet waltz for electric keys; pitches are semitones above the tonic."""
    beat = 60.0 / bpm
    # Each bar pairs a broken chord with (onset, duration, pitch) lead notes.
    opening = (
        ((0, 7, 16), ((0.5, 0.9, 4), (1.5, 0.45, 7), (2, 0.9, 9))),
        ((5, 9, 16), ((0, 1.8, 7), (2, 0.75, 4))),
        ((2, 9, 17), ((0.5, 0.9, 2), (1.5, 0.5, 4), (2, 0.9, 5))),
        ((-5, 7, 14), ((0, 2.25, 2),)),
    )
    middle = (
        ((-3, 4, 12), ((0, 1.4, 9), (1.5, 1.2, 12))),
        ((4, 11, 19), ((0, 0.9, 11), (1, 0.8, 7), (2, 0.8, 4))),
        ((5, 12, 16), ((0.5, 1.3, 5), (2, 0.8, 9))),
        ((-5, 7, 14), ((0, 1.6, 7), (2, 0.65, 2))),
    )
    cadence = (
        ((5, 9, 16), ((0, 1.4, 5), (1.5, 0.9, 4))),
        ((0, 7, 16), ((0, 0.8, 2), (1, 1.7, 0))),
    )
    score = opening * 2 + middle + opening[:2] + cadence
    samples = array("f", [0.0]) * int(len(score) * 3 * beat * SAMPLE_RATE)
    for bar_index, (chord, melody) in enumerate(score):
        start = bar_index * 3 * beat
        for offset, onset, length, gain in zip(chord, (0, 0.9, 1.7),
                                               (1.8, 1.1, 0.95), (0.075, 0.050, 0.038)):
            add_note(samples, start + onset * beat, length * beat, root - 12 + offset,
                     gain, voice="soft_keys", attack=0.045, release=0.20)
        if bar_index in (0, 12):
            add_shot_phrase(samples, start, beat, root + 12,
                            4 if bar_index == 0 else 0, "soft_keys")
            continue
        for onset, length, offset in melody:
            add_note(samples, start + onset * beat, length * beat, root + 12 + offset,
                     0.15, voice="soft_keys", attack=0.030, release=0.19)
    normalize_and_loop(samples, target_peak=0.53)
    return samples


def compose_track(name: str, settings: tuple[int, int, bool, float, int]) -> array:
    root_note, bpm, minor, energy, seed = settings
    if name == "menu_theme":
        return compose_menu(root_note, bpm)
    rng = random.Random(seed)
    beat = 60.0 / bpm
    bar = beat * BEATS_PER_BAR
    duration = BARS * bar
    samples = array("f", [0.0]) * int(duration * SAMPLE_RATE)

    scale = (0, 2, 3, 5, 7, 8, 10) if minor else (0, 2, 4, 5, 7, 9, 11)

    def pitch(degree: int) -> int:
        octave, index = divmod(degree, len(scale))
        return root_note + 12 * octave + scale[index]

    progression = (0, 3, 5, 4, 0, 3, 1, 4, 5, 2, 3, 4, 0, 3, 4, 0)
    a, b, c, d, e = HOOKS[name]
    phrases = (
        (a, b, c, d, e), (e, d, c, 3, 2),
        (a, b, c, d, e), (c, b, 2, 1, 4),
        (a, b, c, d, e), (e, d, c, 5, 3),
        (b, c, d, e, 5), (5, 4, 2, 1, 4),
        (5, 7, 9, 8, 7), (6, 4, 2, 4, 6),
        (5, 7, 8, 7, 5), (4, 3, 2, 1, 4),
        (a, b, c, d, e), (e, d, c, 5, 3),
        (4, 5, 4, 2, 1), (2, 1, 0, 1, 0),
    )
    # (Onset, length) in beats. Quiet calls leave space; replies land and hold.
    if energy < 0.35:
        call = ((0, 0.9), (1, 0.42), (1.5, 0.42), (2, 0.85), (3, 0.55))
    else:
        call = ((0, 0.68), (0.75, 0.22), (1, 0.44), (1.5, 1.28), (3, 0.62))
    reply = ((0.5, 0.42), (1, 0.43), (1.5, 0.38), (2, 0.42), (2.5, 1.24))

    for i, (chord, phrase) in enumerate(zip(progression, phrases, strict=True)):
        start = i * bar
        stabs = (1.5,) if energy < 0.35 or i % 4 == 3 else (0.5, 2.5)
        for onset in stabs:
            for interval in (2, 4):
                add_note(samples, start + onset * beat, beat * 0.64,
                         pitch(chord + interval), 0.032, voice="pad", release=0.10)
        add_note(samples, start, beat * 0.86, pitch(chord) - 12, 0.105, voice="bass")
        if i % 4 != 3 or energy >= 0.7:
            add_note(samples, start + 2.5 * beat, beat * 0.48,
                     pitch(chord + 4) - 12, 0.08, voice="bass")

        forest = name == "forest_theme"
        if forest and i % 4 == 0:
            add_shot_phrase(samples, start, beat, root_note + 12,
                            (4, 7, 5, 0)[i // 4], "nylon")
            continue
        if forest and i % 4 == 3:
            add_note(samples, start + 3.5 * beat, beat * 0.32,
                     pitch(progression[(i + 1) % BARS] - 1) - 12, 0.07, voice="bass")
        rhythm = reply if i % 2 else call
        for j, (degree, (onset, length)) in enumerate(zip(phrase, rhythm, strict=True)):
            note = pitch(degree) + 12
            add_note(samples, start + onset * beat, length * beat, note,
                     0.16 if j in (0, 4) else 0.135, voice="nylon" if forest else "warm",
                     attack=0.008, release=0.07)
            if not forest and j == 0 and i % 2 == 0:
                add_note(samples, start + onset * beat, 0.45 * beat, note + 12,
                         0.048, voice="bell", attack=0.004)

    add_drums(samples, bpm, energy, rng)

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
