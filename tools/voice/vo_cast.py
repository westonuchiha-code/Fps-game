"""Casting table: which engine plays whom, and through what.

Edit this file to recast a character or retune an effect; gen_voice.py has no
per-speaker logic of its own. Every number here was chosen from measurements
(pitch tracks, long-term spectra, PocketSphinx word-match of dry vs. processed
audio) because nobody on the project can listen to the result - see the
comments, intel_check.py and pron_check.py.

Per speaker:
    synth       engine + voice + engine settings (see vo_synth.py)
    sub         optional second synth pass mixed in as a sub-octave double
    tone        corrective EQ {1/3-octave centre Hz: dB}, from calibrate_eq.py
    fx / fx_params   effect chain (vo_fx.py) and its settings
    pause       seconds of silence that an ellipsis ("...") becomes
    asr_noise_db    noise floor used by the intelligibility test for this voice
    deliveries  optional overrides of DELIVERY for this speaker
"""
from __future__ import annotations

# ----------------------------------------------------------------------------
# eSpeak voice variants (written into a private espeak-ng-data mirror)
# ----------------------------------------------------------------------------
# The stock eSpeak voice is close to unintelligible to the recogniser; these
# variants were picked from a scan of all 100 stock variants plus hand-made
# ones. Klatt-source variants and the breathy 'f5' recipe were the clear
# winners (0.69-0.85 word match with the test's noise floor, same range as the
# natural-sounding engines).


def _formants(scale: dict) -> str:
    return "".join(f"formant {i} {v} 100 100\n" for i, v in scale.items())


ESPEAK_VARIANTS = {
    # Associate: bright and chirpy. eSpeak's own 'f5' recipe (breathy, strong
    # consonants, formants +5..15 %) minus its built-in echo, pitched up to ~230 Hz.
    "emg_assoc": """gender female
pitch 180 258
roughness 0
formant 0 105 80 150
formant 1 110 80 160
formant 2 110 70 150
formant 3 110 70 150
formant 4 115 80 200
formant 5 115 80 100
formant 6 110 70 150
formant 7 110 70 100
formant 8 110 70 150
stressAdd 0 0 -10 -10 0 0 10 40
breath 0 4 6 6 6 6 0 10
voicing 75
consonants 150 150
breathw 150 150 200 200 400 400
""",
    # Kiosk: Klatt source at ~250 Hz with all formants +12 % - a small, toy-like voice.
    "emg_kiosk": "gender female\nklatt 2\npitch 195 275\n" + _formants({i: 112 for i in range(9)}) + "consonants 130 130\n",
    # Supervisor: dark Klatt source, ~96 Hz, formants -4 %.
    "emg_super": "gender male\nklatt 5\npitch 84 116\n" + _formants({i: 96 for i in range(1, 9)}) + "voicing 100\nconsonants 110 110\n",
    # Regional Manager: ~81 Hz before the 'size' varispeed, first formants lowered.
    "emg_manager": "gender male\nklatt 4\npitch 66 98\n" + _formants({1: 90, 2: 94, 3: 96, 4: 96}) + "voicing 85\nconsonants 110 110\n",
    # ...and the same voice exactly one octave down. eSpeak's timing does not
    # depend on pitch, so the two renders line up sample for sample.
    "emg_manager_sub": "gender male\nklatt 4\npitch 33 49\n" + _formants({1: 90, 2: 94, 3: 96, 4: 96}) + "voicing 85\nconsonants 110 110\n",
}

# ----------------------------------------------------------------------------
# delivery: how a line is performed, on top of the speaker's base settings
# ----------------------------------------------------------------------------
# rate / pitch are multipliers on the engine's own controls; effort_db tilts
# the spectrum up above ~1 kHz (the main acoustic cue of a raised voice);
# pause_mul stretches ellipsis pauses.

DELIVERY = {
    "normal": {"rate": 1.00, "pitch": 1.00},
    "shout": {"rate": 1.10, "pitch": 1.06, "effort_db": 3.0},       # barks, mid-firefight
    "dying": {"rate": 0.84, "pitch": 0.92, "pause_mul": 1.5},       # last words
    "aside": {"rate": 0.97, "pitch": 0.98},                         # idle chatter
}

# bark group -> delivery (anything not listed is a 'shout')
GROUP_DELIVERY = {
    "death": "dying",
    "idle": "aside",
    "search": "normal",
    "lost": "normal",
    "win": "normal",
}

# ----------------------------------------------------------------------------
# the cast
# ----------------------------------------------------------------------------

CAST: dict[str, dict] = {
    # Steward - dry, British, unflappable. The only British woman on the machine.
    "steward": {
        "synth": {"engine": "pico", "voice": "en-GB", "pitch": 97, "speed": 98},
        "fx": "radio",
        "fx_params": {},
        "pause": 0.40,
        "asr_noise_db": None,
    },
    # Store PA - relentlessly cheerful: Pico's US voice pitched and sped up a little.
    "pa": {
        "synth": {"engine": "pico", "voice": "en-US", "pitch": 109, "speed": 104},
        "fx": "pa",
        "fx_params": {},
        "pause": 0.45,
        "asr_noise_db": None,
    },
    # Max Price - smooth, slow, smug. Flite's rms is the lowest and slowest male
    # voice available (103 Hz); it has no pitch control, so the extra depth
    # comes from a 5 % varispeed in the effect chain, which also slows him down.
    "price": {
        "synth": {"engine": "flite", "voice": "rms", "stretch": 1.06},
        "fx": "price",
        "fx_params": {},
        "pause": 0.60,
        "asr_noise_db": None,
    },
    # Rivet - veteran union woman, close voice.
    "rivet": {
        "synth": {"engine": "rhvoice", "voice": "clb", "rate": 100, "pitch": 97},
        "fx": "near",
        "fx_params": {},
        "pause": 0.40,
        "asr_noise_db": None,
    },
    # Dutch - the big guy: RHVoice's Scottish male, pitched down and unhurried.
    "dutch": {
        "synth": {"engine": "rhvoice", "voice": "alan", "rate": 96, "pitch": 84},
        "fx": "near",
        "fx_params": {},
        "pause": 0.40,
        "asr_noise_db": None,
    },
    # Hank - generic Striker: RHVoice's US male, a little higher and quicker,
    # so he is a different accent, register and pace from Dutch.
    "hank": {
        "synth": {"engine": "rhvoice", "voice": "bdl", "rate": 104, "pitch": 108},
        "fx": "near",
        "fx_params": {},
        "pause": 0.40,
        "asr_noise_db": None,
    },
    # Associate - chirpy service robot.
    "assoc": {
        "synth": {"engine": "espeak", "voice": "en-us", "variant": "emg_assoc", "pitch": 50, "speed": 172},
        "fx": "robot",
        "fx_params": {},
        "pause": 0.32,
        "asr_noise_db": -55.0,
        "deliveries": {"shout": {"rate": 1.04, "pitch": 1.04}, "dying": {"rate": 0.80, "pitch": 0.90, "pause_mul": 1.4}},
    },
    # Supervisor - lower, sterner.
    "super": {
        "synth": {"engine": "espeak", "voice": "en-us", "variant": "emg_super", "pitch": 50, "speed": 152},
        "fx": "robot",
        "fx_params": {},
        "pause": 0.42,
        "asr_noise_db": -55.0,
        "deliveries": {"shout": {"rate": 1.04, "pitch": 1.03}, "dying": {"rate": 0.80, "pitch": 0.90, "pause_mul": 1.4}},
    },
    # Regional Manager - huge mech: very low, slow, doubled an octave down.
    "manager": {
        "synth": {"engine": "espeak", "voice": "en-us", "variant": "emg_manager", "pitch": 50, "speed": 126},
        "sub": {"variant": "emg_manager_sub"},
        "fx": "robot",
        "fx_params": {},
        "pause": 0.62,
        "asr_noise_db": -55.0,
        "deliveries": {"shout": {"rate": 1.0, "pitch": 1.0}, "dying": {"rate": 0.82, "pitch": 0.92, "pause_mul": 1.3}},
    },
    # Kiosk - tinny vending-machine speaker.
    "kiosk": {
        "synth": {"engine": "espeak", "voice": "en-us", "variant": "emg_kiosk", "pitch": 50, "speed": 165},
        "fx": "robot",
        "fx_params": {},
        "pause": 0.35,
        "asr_noise_db": -55.0,
    },
}


def delivery_for(who: str, kind: str, group: str | None) -> dict:
    """Resolved delivery dict for a line ('line') or a bark in `group`."""
    name = "normal" if kind == "line" else GROUP_DELIVERY.get(group or "", "shout")
    d = dict(DELIVERY[name])
    d.update(CAST[who].get("deliveries", {}).get(name, {}))
    d["name"] = name
    return d
