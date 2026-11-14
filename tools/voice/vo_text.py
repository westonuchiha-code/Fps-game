"""Text preparation for the speech engines.

`text` in dialogue.json is what the subtitle shows and is never edited here.
What the synthesiser is asked to say is derived from it (or from `say`):

1. generic clean-up: typographic quotes, ALL-CAPS words, digits;
2. ellipses split the line into chunks that are synthesised separately and
   joined with a measured silence (engines either ignore "...", or - Pico -
   read it as three sentence ends and pause for 1.7 s);
3. a per-engine substitution table fixes what that engine mispronounces.

Every entry in the substitution tables was found by measurement (phoneme
dumps for eSpeak/Flite, forced-alignment pronunciation votes for Pico and
RHVoice, see pron_check.py) - the comment on each rule says what was wrong.
"""
from __future__ import annotations

import re

# ----------------------------------------------------------------------------
# generic clean-up
# ----------------------------------------------------------------------------

# Acronyms that must be spelled out letter by letter. Anything else written in
# capitals ("EVERYTHING MUST GO", brand names like KRONA) is just shouted text
# and is lower-cased so no engine decides to spell it.
ACRONYMS = {
    "PA": "P A",       # eSpeak says "pah"
    "CEO": "C E O",
    "AI": "A I",
    "FC": "F C",
    "ID": "I D",
    "OK": "okay",
    "HQ": "H Q",
    "HR": "H R",
    "VIP": "V I P",
}

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def number_words(n: int) -> str:
    """Cardinal in the script's own style: 4112 -> 'four thousand, one hundred and twelve'."""
    if n < 0:
        return "minus " + number_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("-" + _ONES[n % 10] if n % 10 else "")
    if n < 1000:
        rest = n % 100
        return _ONES[n // 100] + " hundred" + (" and " + number_words(rest) if rest else "")
    if n < 1_000_000:
        rest = n % 1000
        head = number_words(n // 1000) + " thousand"
        if not rest:
            return head
        return head + (" and " if rest < 100 else ", ") + number_words(rest)
    if n < 1_000_000_000:
        rest = n % 1_000_000
        head = number_words(n // 1_000_000) + " million"
        if not rest:
            return head
        return head + (" and " if rest < 100 else ", ") + number_words(rest)
    return " ".join(_ONES[int(d)] for d in str(n))


def _digits(m: re.Match) -> str:
    s = m.group(0)
    if len(s) > 1 and s[0] == "0":  # codes like 007: digit by digit
        return " ".join("oh" if d == "0" else _ONES[int(d)] for d in s)
    return number_words(int(s))


def _caps(m: re.Match) -> str:
    w = m.group(0)
    if w in ACRONYMS:
        return ACRONYMS[w]
    return w[0] + w[1:].lower()


def clean(text: str) -> str:
    t = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = t.replace("…", "...").replace("—", ", ").replace("–", ", ")
    t = t.replace("&", " and ").replace("<", " ").replace(">", " ")
    t = re.sub(r"\b[A-Z]{2,}\b", _caps, t)
    t = re.sub(r"(?<![\w.])\d{1,3}(?:,\d{3})+(?![\w])", lambda m: number_words(int(m.group(0).replace(",", ""))), t)
    t = re.sub(r"\d+", _digits, t)
    return re.sub(r"\s+", " ", t).strip()


# ----------------------------------------------------------------------------
# ellipses -> chunks
# ----------------------------------------------------------------------------

_ELLIPSIS = re.compile(r"\s*\.{3,}\s*")


def split_chunks(text: str) -> list[str]:
    """'It is... unsatisfactory.' -> ['It is,', 'unsatisfactory.']

    A chunk that is cut off by an ellipsis gets a comma so the engine gives it
    a 'not finished yet' contour; a line that trails off ('Solidarity...') ends
    on a full stop. The pause itself is added by the caller as real silence.
    """
    parts = [p.strip() for p in _ELLIPSIS.split(text)]
    trailing = bool(_ELLIPSIS.search(text)) and parts and parts[-1] == ""
    parts = [p for p in parts if p]
    out = []
    for i, p in enumerate(parts):
        last = i == len(parts) - 1
        if not last:
            if p[-1] not in ",;:!?.":
                p += ","
        elif trailing and p[-1] not in "!?.":
            p = p.rstrip(",;:") + "."
        out.append(p)
    return out


# ----------------------------------------------------------------------------
# per-engine substitution tables
# ----------------------------------------------------------------------------
# (pattern, replacement, why). Patterns are case-insensitive regexes applied in
# order to one chunk of cleaned text. Keys: '<engine>' or '<engine>:<voice>'.

SUBS: dict[str, list[tuple[str, str, str]]] = {
    "pico:en-GB": [
        (r"\bMono\s?Mart\b", "Monno Mart",
         "one word -> 'MON-uh-mart' (schwa); 'Mono Mart' -> first vowel drifts to 'moh'; 'Monno' gives the short o"),
    ],
    "pico:en-US": [
        (r"\bMono\s?Mart\b", "Mahno Mart",
         "one word -> stress on 2nd syllable ('muh-NAH-mart'); 'Mono Mart' -> 'MOH-noh'"),
        (r"\bclass A\b", "class Ay", "letter A read as the article 'uh'"),
        (r"\bAssociate(s?)\b", r"Associet\1",
         "after 'Good morning,' the tagger picks the verb ('-ates'); respelling pins the noun"),
    ],
    "rhvoice": [
        (r"\bLead (the|them|us|me|on)\b", r"Leed \1", "homograph: said 'led' (the metal)"),
        (r"\bMono\s?Mart\b", "Mahno Mart", "CMU lexicon has 'MOH-noh'"),
        (r"\bclass A\b", "class Ay", "letter A read as the article 'uh'"),
    ],
    "flite": [
        (r"\bLead (the|them|us|me|on)\b", r"Leed \1", "homograph: phones were 'l eh d'"),
        (r"\bMono\s?Mart\b", "Monno Mart", "one word -> 'm aa n ax m aa r t'; 'Mono' -> 'm ow n ow'"),
        (r"\bclass A\b", "class Ay", "letter A read as 'ax'"),
    ],
    "espeak": [
        (r"\bMono\s?Mart\b", "Mono Mart", "keeps the two-word stress pattern (m'0noU m'A@t)"),
        (r"\bAssociates\b", "[[a#s'oUSi@ts]]", "always the verb form (-,eIts), even after 'an'"),
        (r"\bAssociate\b", "[[a#s'oUSi@t]]", "always the verb form (-,eIt)"),
        (r"\bOw\b", "[['aU]]", "read as 'oh'"),
        (r"\brefunds\b", "[[r'i:fVndz]]", "plural noun got verb stress (rI#f'Vndz)"),
        (r"\bRestocking\b", "[[r,i:st'0kIN]]", "prefix reduced to 'rih-' as in 'restore'"),
    ],
}


def engine_text(chunk: str, engine: str, voice: str) -> tuple[str, list[str]]:
    """Apply the substitution tables; returns (text, [rules that fired])."""
    fired = []
    out = chunk
    for key in (f"{engine}:{voice}", engine):
        for pat, rep, why in SUBS.get(key, []):
            new = re.sub(pat, rep, out, flags=re.IGNORECASE)
            if new != out:
                fired.append(f"{key}: /{pat}/ -> {rep!r} ({why})")
                out = new
    return out, fired


def prepare(text: str, engine: str, voice: str) -> tuple[list[str], list[str]]:
    """Full preparation: returns (chunks ready for the engine, notes)."""
    chunks = split_chunks(clean(text))
    out, notes = [], []
    for c in chunks:
        t, fired = engine_text(c, engine, voice)
        out.append(t)
        notes.extend(fired)
    return out, notes
