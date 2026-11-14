"""PocketSphinx helpers: the pipeline's stand-in for a pair of ears.

Three instruments, all built on the English model bundled with the
`pocketsphinx` wheel (`python3 -m pip install pocketsphinx`):

* recognize()      - free recognition with the stock language model. Absolute
                     accuracy on synthetic speech is poor; it is only ever used
                     to compare the *same line* dry vs. processed.
* align_score()    - forced-alignment acoustic score of a known word sequence
                     (optionally with a private pronunciation dictionary).
                     Used to decide between two candidate pronunciations of a
                     word for engines that cannot print their phonemes.
* phone_string()   - phoneme-loop recognition, for eyeballing.

Scores are log-likelihoods: only differences between two renderings of the
same words mean anything.
"""
from __future__ import annotations

import difflib
import math
import os
import re
import tempfile

import numpy as np
from scipy import signal

try:  # optional dependency
    import pocketsphinx  # type: ignore
    from pocketsphinx import Decoder  # type: ignore

    HAVE_PS = True
except Exception:  # pragma: no cover - exercised only when the wheel is missing
    pocketsphinx = None  # type: ignore
    Decoder = None  # type: ignore
    HAVE_PS = False

ASR_SR = 16000


def model_dir() -> str:
    return os.path.join(pocketsphinx.get_model_path(), "en-us")


def to_pcm16(x: np.ndarray, sr: int, noise_db: float | None = None, seed: int = 0) -> bytes:
    """float mono -> 16 kHz int16 bytes, peak-normalised to -3 dBFS.

    Peak normalisation keeps level differences between dry and processed
    audio out of the score.

    noise_db adds a white noise floor at that level (dBFS RMS, after the
    normalisation). PocketSphinx was trained on recordings, which always have
    a noise floor; on eSpeak's formant synthesis (digitally silent gaps, empty
    upper bands) its features collapse and it recognises ~11 % of the words,
    against ~54 % of the *same audio* with a -55 dB floor. Natural-sounding
    engines do not need it (and Pico's British voice is hurt by it), so the
    floor is a per-speaker setting of the test (vo_cast.py, 'asr_noise_db')
    and is always identical for the dry and the processed rendering.
    """
    x = np.asarray(x, dtype=np.float64)
    if sr != ASR_SR:
        g = math.gcd(ASR_SR, sr)
        x = signal.resample_poly(x, ASR_SR // g, sr // g)
    pk = float(np.max(np.abs(x))) if len(x) else 0.0
    if pk > 0:
        x = x * (0.7079 / pk)
    # the acoustic model wants a little silence around the utterance
    pad = np.zeros(int(0.25 * ASR_SR))
    x = np.concatenate([pad, x, pad])
    if noise_db is not None:
        x = x + np.random.default_rng(seed).standard_normal(len(x)) * 10.0 ** (noise_db / 20.0)
    return (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


# ----------------------------------------------------------------------------
# text normalisation for scoring
# ----------------------------------------------------------------------------

_NUM = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine",
}


def norm_words(text: str) -> list[str]:
    """Lower-case word list as the recogniser would write it."""
    t = text.lower().replace("’", "'")
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"(\d)", lambda m: " " + _NUM[m.group(1)] + " ", t)
    t = re.sub(r"[^a-z' ]+", " ", t)
    words = []
    for w in t.split():
        w = w.strip("'")
        if w:
            words.append(w)
    return words


def word_match(ref: list[str], hyp: list[str]) -> float:
    """Fraction of reference words recovered in order (0..1).

    matched words / len(ref), from the longest-matching-blocks alignment;
    insertions in the hypothesis are not rewarded and only hurt by breaking
    blocks apart.
    """
    if not ref:
        return 1.0
    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    return sum(b.size for b in sm.get_matching_blocks()) / len(ref)


# ----------------------------------------------------------------------------
# decoders (cached: building one loads the model)
# ----------------------------------------------------------------------------

_cache: dict = {}


def _decoder(kind: str, **kw):
    key = (kind, tuple(sorted(kw.items())))
    if key not in _cache:
        _cache[key] = Decoder(loglevel="FATAL", **kw)
    return _cache[key]


def recognize(pcm: bytes, lm: str | None = None, dic: str | None = None) -> str:
    """Free recognition. lm/dic default to the wheel's generic en-us model."""
    kw = {}
    if lm:
        kw["lm"] = lm
    if dic:
        kw["dict"] = dic
    dec = _decoder("lm", **kw)
    dec.start_utt()
    dec.process_raw(pcm, full_utt=True)
    dec.end_utt()
    hyp = dec.hyp()
    return hyp.hypstr if hyp is not None else ""


def phone_string(pcm: bytes) -> str:
    dec = _decoder("allphone", allphone=os.path.join(pocketsphinx.get_model_path(), "en-us", "en-us-phone.lm.bin"),
                   lw=2.0, pip=0.3, beam=1e-20, pbeam=1e-20, lm=None)
    dec.start_utt()
    dec.process_raw(pcm, full_utt=True)
    dec.end_utt()
    return " ".join(s.word for s in dec.seg() if s.word not in ("SIL", "+NSN+", "+SPN+"))


_base_dict: dict | None = None


def base_dict() -> dict:
    """word -> first pronunciation, from the bundled CMU dictionary."""
    global _base_dict
    if _base_dict is None:
        d = {}
        with open(os.path.join(pocketsphinx.get_model_path(), "en-us", "cmudict-en-us.dict"), encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) >= 2:
                    d.setdefault(parts[0], " ".join(parts[1:]))
        _base_dict = d
    return _base_dict


def all_prons(word: str) -> list[str]:
    out = []
    with open(os.path.join(pocketsphinx.get_model_path(), "en-us", "cmudict-en-us.dict"), encoding="utf-8") as fh:
        for line in fh:
            parts = line.split()
            if parts and re.sub(r"\(\d+\)$", "", parts[0]) == word:
                out.append(" ".join(parts[1:]))
    return out


def align_score(pcm: bytes, words: list[str], prons: dict | None = None) -> dict | None:
    """Force-align `words` to the audio.

    `prons` maps word -> pronunciation (ARPAbet, no stress digits) and
    overrides / extends the CMU dictionary for this call.

    Returns None when the aligner cannot fit these words to the audio, else

    * 'loglik' - Viterbi path log-likelihood (nats) of the whole utterance;
                 comparable between two alignments of the SAME audio only;
    * 'gop'    - per-word (name, start_frame, n_frames, score) from the
                 second (state-level) pass. That score is relative to the best
                 competing senone in every frame, i.e. a goodness-of-
                 pronunciation measure: 0 is perfect, more negative is worse;
    * 'phones' - the same per phone.
    """
    prons = dict(prons or {})
    bd = base_dict()
    lines = []
    for w in dict.fromkeys(words):
        p = prons.get(w) or bd.get(w)
        if p is None:
            raise KeyError(f"no pronunciation for {w!r}")
        lines.append(f"{w} {p}")
    # the dictionary is tiny and call-specific, so build a throwaway decoder
    with tempfile.NamedTemporaryFile("w", suffix=".dict", delete=False, encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
        path = fh.name
    try:
        dec = Decoder(loglevel="FATAL", dict=path, lm=None, fsgusealtpron=False,
                      beam=1e-80, wbeam=1e-60, pbeam=1e-80)
        dec.set_align_text(" ".join(words))
        try:
            dec.start_utt()
            dec.process_raw(pcm, full_utt=True)
            dec.end_utt()
        except RuntimeError:
            return None
        if dec.hyp() is None:
            return None
        loglik = 0.0
        for s in dec.seg():
            loglik += math.log(s.ascore) if s.ascore > 0 else -745.0
        gop, phones = [], []
        try:
            dec.set_alignment()
            dec.start_utt()
            dec.process_raw(pcm, full_utt=True)
            dec.end_utt()
            al = dec.get_alignment()
        except RuntimeError:  # state-level pass could not reach the end
            al = None
        if al is not None:
            for w in al:
                gop.append((w.name, w.start, w.duration, w.score))
                for ph in w:
                    phones.append((w.name, ph.name, ph.start, ph.duration, ph.score))
        return {"loglik": loglik, "gop": gop, "phones": phones}
    finally:
        os.unlink(path)


def pron_vote(pcm: bytes, words: list[str], target: str, candidates: dict, prons: dict | None = None) -> dict:
    """Which candidate pronunciation of `target` best explains the audio?

    candidates: label -> ARPAbet string. For every candidate the utterance is
    force-aligned with that pronunciation; the candidate with the highest
    whole-utterance log-likelihood wins. Returns

        {'best': label, 'margin': nats between the two best,
         'loglik': {label: nats}, 'gop': {label: target-word score per frame}}
    """
    ll, gop = {}, {}
    for label, pron in candidates.items():
        p = dict(prons or {})
        p[target] = pron
        a = align_score(pcm, words, p)
        if a is None:
            ll[label] = float("-inf")
            gop[label] = float("-inf")
            continue
        ll[label] = a["loglik"]
        tw = [g for g in a["gop"] if g[0] == target]
        gop[label] = sum(g[3] for g in tw) / max(sum(g[2] for g in tw), 1) if tw else float("-inf")
    order = sorted(ll, key=lambda k: ll[k], reverse=True)
    return {
        "best": order[0],
        "margin": ll[order[0]] - ll[order[1]] if len(order) > 1 else float("inf"),
        "loglik": ll,
        "gop": gop,
    }
