"""The required sound set: the single source of truth shared by the generator
(gen_sfx.py) and the checker (verify.py).

Each entry: name, number of variations, allowed duration range in seconds,
loop flag and family (used to group spectrogram contact sheets).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Spec:
    name: str
    variations: int
    dur_min: float
    dur_max: float
    loop: bool
    family: str

    def files(self) -> list[str]:
        """Output file names: <name>.ogg, or <name>_<n>.ogg (n = 1..variations)."""
        if self.variations == 1:
            return [f"{self.name}.ogg"]
        return [f"{self.name}_{i}.ogg" for i in range(1, self.variations + 1)]


def _rows(family: str, rows: str, loop_names: tuple[str, ...] = ()) -> list[Spec]:
    out = []
    for line in rows.strip().splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        name, var, lo, hi = line.split()
        out.append(Spec(name, int(var), float(lo), float(hi), name.endswith("_loop"), family))
    return out


SPECS: list[Spec] = []

SPECS += _rows("weapons_fire", """
pistol_fire     3  0.45  0.70
rifle_fire      4  0.30  0.50
shotgun_fire    3  0.90  1.40
sniper_fire     2  1.40  2.20
zap_fire        3  0.30  0.50
dry_fire        1  0.08  0.15
""")

SPECS += _rows("weapons_handling", """
mag_out         2  0.15  0.30
mag_in          2  0.15  0.30
mag_tap         1  0.08  0.12   # "0.1 s"
slide_back      1  0.12  0.20
slide_release   1  0.10  0.20
bolt_back       1  0.15  0.25
bolt_forward    1  0.12  0.20
bolt_up         1  0.08  0.20
bolt_pull       1  0.08  0.20
bolt_push       1  0.08  0.20
bolt_down       1  0.08  0.20
pump_back       1  0.12  0.20
pump_forward    1  0.12  0.20
shell_insert    3  0.10  0.20
cloth           3  0.15  0.35
weapon_draw     1  0.25  0.40
weapon_holster  1  0.20  0.35
ads_in          1  0.10  0.18
ads_out         1  0.10  0.18
shell_casing    3  0.25  0.50
shell_shotgun   2  0.20  0.40
melee_swing     2  0.20  0.30
melee_hit       2  0.20  0.35
""")

SPECS += _rows("impacts", """
impact_concrete 3  0.15  0.40
impact_metal    3  0.15  0.40
impact_sand     2  0.15  0.40
impact_wood     2  0.15  0.40
impact_robot    3  0.15  0.40
impact_flesh    2  0.15  0.40
impact_shield   2  0.15  0.40
ricochet        3  0.40  0.80
bullet_whiz     3  0.20  0.40
""")

SPECS += _rows("ui", """
hitmarker           1  0.05  0.10
hitmarker_crit      1  0.10  0.18
kill_confirm        1  0.20  0.35
enemy_shield_break  1  0.40  0.70
ui_move             1  0.04  0.08
ui_select           1  0.10  0.20
ui_back             1  0.10  0.20
ui_equip            1  0.20  0.35
ui_error            1  0.15  0.30
watch_tick          2  0.03  0.06
watch_beep          1  0.25  0.40
watch_open          1  0.30  0.50
typewriter          3  0.03  0.07
objective_new       1  0.50  0.90
objective_done      1  0.60  1.00
checkpoint          1  0.60  1.00
""")

SPECS += _rows("loot", """
pickup_ammo     1  0.15  0.40
pickup_cash     1  0.15  0.40
pickup_health   1  0.15  0.40
pickup_weapon   1  0.15  0.40
pickup_mine     1  0.15  0.40
loot_drop       2  0.20  0.40
loot_rare       1  0.60  1.00
loot_legendary  1  1.20  2.00
chest_open      1  0.80  1.30
""")

SPECS += _rows("explosives", """
explosion_big    3  1.60  2.60
explosion_small  2  0.80  1.40
mine_throw       1  0.20  0.30
mine_stick       2  0.15  0.30
mine_beep        1  0.08  0.15
fire_ignite      1  0.40  0.70
shock_zap        2  0.25  0.50
acid_sizzle      1  0.50  0.90
""")

SPECS += _rows("player", """
footstep_concrete  4  0.12  0.25
footstep_metal     4  0.12  0.25
footstep_sand      4  0.12  0.25
jump               1  0.15  0.25
land               2  0.20  0.35
slide              1  0.60  0.90
mantle             1  0.30  0.45
player_hurt        3  0.15  0.30
shield_hit         3  0.15  0.30
shield_break       1  0.60  0.90
shield_recharge    1  1.20  1.80
heartbeat_loop     1  1.00  1.00   # exactly 1.0 s
""")

SPECS += _rows("enemies", """
enemy_blaster       3  0.25  0.45
enemy_heavy_cannon  2  0.80  1.30
enemy_charge        1  1.00  1.40
drone_shot          2  0.15  0.30
drone_loop          1  1.50  2.50
robot_servo         3  0.15  0.35
robot_step          3  0.12  0.22
heavy_step          2  0.40  0.60
robot_alert         2  0.20  0.40
robot_death         3  0.70  1.30
robot_explode       2  0.80  1.30
""")

SPECS += _rows("vehicles", """
truck_engine_loop   1  1.50  2.50
tire_skid_loop      1  1.00  1.60
truck_impact        2  0.40  0.70
scooter_hover_loop  1  1.50  2.50
scooter_boost       1  0.80  1.20
scooter_blaster     2  0.20  0.35
scooter_horn        1  0.35  0.55
turret_fire         3  0.20  0.35
vehicle_enter       1  0.30  0.50
vehicle_exit        1  0.30  0.50
""")

SPECS += _rows("world", """
amb_wind_loop       1  8.00  12.00
amb_warehouse_loop  1  8.00  12.00
pa_chime            1  1.00  1.60
gate_open           1  1.80  2.60
door_open           1  0.50  0.80
barrel_hit          2  0.15  0.30
glass_break         2  0.50  0.90
""")

BY_NAME: dict[str, Spec] = {s.name: s for s in SPECS}
assert len(BY_NAME) == len(SPECS), "duplicate sound name in spec"

# Shared conventions (also enforced by verify.py)
SR = 44100
PEAK_DBFS = -1.0          # one-shots are peak-normalised to this
LOOP_LUFS = -16.0         # loops are loudness-normalised to about this
LOOP_PEAK_DBFS = -1.0     # ... with peaks no higher than this
MAX_ONSET_S = 0.002       # one-shots must start within 2 ms
DC_LIMIT = 0.002          # |mean| limit
