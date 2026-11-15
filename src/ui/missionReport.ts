import './menus.css';
import type { Game } from '../game';
import { clamp } from '../core/math';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
}

type Stats = Game['stats'];

/** Pick the "corporate feedback" for a run. Returns [rating 1..5, headline, comment]. */
function rate(s: Stats): [number, string, string] {
  const acc = s.shots ? s.hits / s.shots : 0;
  if (s.kills === 0 && s.shots === 0) return [3, 'MEETS EXPECTATIONS', 'No incidents recorded. Suspiciously efficient.'];
  if (s.deaths >= 4) return [1, 'NEEDS IMPROVEMENT', 'Enrolled in mandatory resilience training (unpaid).'];
  if (s.deaths === 0 && acc >= 0.5 && s.kills >= 10) return [5, 'EXCEEDS EXPECTATIONS', 'Flagged as a top performer. Scheduled for immediate termination.'];
  if (s.kills >= 25) return [4, 'HIGHLY PRODUCTIVE', 'Headcount reduction targets met ahead of schedule. HR is concerned.'];
  if (s.shots > 0 && acc < 0.25) return [2, 'MEETS SOME EXPECTATIONS', 'Ammunition budget is under review. Please aim for the customer.'];
  if (s.deaths === 0) return [4, 'RELIABLE', 'Zero sick days. Eligible for a 0.2% raise, pending a further review.'];
  return [3, 'MEETS EXPECTATIONS', 'A solid shift. Your feedback has been recorded and ignored.'];
}

/** End-of-mission "performance review" dossier. */
export class MissionReport {
  private readonly g: Game;
  private readonly onContinue: () => void;
  private readonly root: HTMLElement;
  private shown = false;
  private rows: HTMLElement[] = [];
  private revealed = 0;
  private timer = 0;
  private stamped = false;
  private guard = 0;
  private lastReal = 0;
  private hudWasHidden = false;

  constructor(game: Game, onContinue: () => void) {
    this.g = game;
    this.onContinue = onContinue;
    this.root = document.createElement('div');
    this.root.className = 'mr';
    game.ui.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      if (!this.shown) return;
      if ((e.target as HTMLElement).closest('.mr-continue')) this.advance(true);
      else this.advance(false);
    });
    game.systems.push({ update: () => this.update() });
  }

  get isShown() {
    return this.shown;
  }

  show(missionNumber: string, title: string) {
    const g = this.g;
    const s = g.stats;
    if (!this.shown) this.hudWasHidden = g.hud.root.classList.contains('hidden');
    this.shown = true;
    this.guard = 2;
    this.revealed = 0;
    this.timer = 0.5;
    this.stamped = false;
    this.lastReal = g.realTime;
    g.input.exitLock();
    g.hud.setVisible(false);

    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const [stars, head, note] = rate(s);
    const rows: [string, string][] = [
      ['Time on shift', fmtTime(s.time)],
      ['Shots fired', String(s.shots)],
      ['Accuracy', s.shots ? `${acc}% (${s.hits} hits)` : '—'],
      ['Associates retired', String(s.kills)],
      ['Critical feedback given', String(s.crits)],
      ['Damage absorbed', String(Math.round(s.damageTaken))],
      ['Sick days (deaths)', String(s.deaths)],
      ['Petty cash collected', '$' + s.cash.toLocaleString('en-US')],
      ['Merchandise acquired', String(s.loot)],
      ['Lockers audited', String(s.lockers)],
      ['Severance packages delivered', String(s.mineKills)],
      ['Last-mile deliveries', String(s.roadkills)],
    ];
    const date = new Date();
    const ref = `HR-${String(missionNumber).replace(/\D/g, '').padStart(2, '0') || '00'}-${(s.kills * 7 + s.shots + 404) % 10000}`;
    this.root.innerHTML = `
      <div class="mr-paper">
        <div class="mr-head">
          <div class="mr-org">MONOMART<sup>™</sup> HUMAN RESOURCES</div>
          <div class="mr-doc">AUTOMATED PERFORMANCE REVIEW · REF ${esc(ref)}</div>
        </div>
        <div class="mr-meta">
          <div><span>ASSOCIATE</span>CLEARANCE <small>(formerly Loss Prevention)</small></div>
          <div><span>ASSIGNMENT</span>${esc(missionNumber)} — ${esc(title.toUpperCase())}</div>
          <div><span>DATE</span>${date.toISOString().slice(0, 10)}</div>
        </div>
        <div class="mr-rows">${rows.map(([k, v]) => `<div class="mr-row"><span class="k">${esc(k)}</span><span class="dots"></span><span class="v">${esc(v)}</span></div>`).join('')}</div>
        <div class="mr-rating mr-row"><div class="mr-stars">${'★'.repeat(stars)}<i>${'★'.repeat(5 - stars)}</i></div><div><b>${esc(head)}.</b> ${esc(note)}</div></div>
        <div class="mr-stamp">APPROVED</div>
        <div class="mr-foot"><span class="mr-sign">— Max Price, CEO <small>(signature auto-generated)</small></span><button class="mr-continue">CONTINUE ▸</button></div>
      </div>`;
    this.rows = [...this.root.querySelectorAll('.mr-row')] as HTMLElement[];
    this.root.classList.add('on');
    this.root.classList.remove('stamped');
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('on', 'stamped');
    this.root.innerHTML = '';
    this.g.hud.setVisible(!this.hudWasHidden);
  }

  private finishTyping() {
    for (const r of this.rows) r.classList.add('in');
    this.revealed = this.rows.length;
    this.stamp();
  }

  private stamp() {
    if (this.stamped) return;
    this.stamped = true;
    this.root.classList.add('stamped');
    this.g.audio.play('ui_equip', { bus: 'ui', pitch: 0.7 });
  }

  /** First press skips the typing; the next one continues. */
  private advance(fromButton: boolean) {
    if (!this.shown) return;
    if (!this.stamped) {
      this.finishTyping();
      if (!fromButton) return;
    }
    this.g.audio.play('ui_select', { bus: 'ui' });
    this.hide();
    this.onContinue();
  }

  private update() {
    if (!this.shown) return;
    const g = this.g;
    const dt = clamp(g.realTime - this.lastReal, 0, 0.1);
    this.lastReal = g.realTime;
    if (this.revealed < this.rows.length) {
      this.timer -= dt;
      while (this.timer <= 0 && this.revealed < this.rows.length) {
        this.rows[this.revealed++].classList.add('in');
        g.audio.play('typewriter', { bus: 'ui', vol: 0.55 });
        this.timer += this.revealed === this.rows.length ? 0.5 : 0.11;
      }
    } else if (!this.stamped) {
      this.timer -= dt;
      if (this.timer <= 0) this.stamp();
    }
    if (this.guard > 0) {
      this.guard--;
      return;
    }
    if (g.input.pressed('uiAccept') || g.input.pressed('uiBack')) this.advance(false);
  }
}
