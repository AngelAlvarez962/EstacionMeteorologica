/* One repeating timer per alarm; incoming readings do not restart its cadence. */
window.AlertCadence = class AlertCadence {
  constructor(play) { this.play = play; this.zone = 0; this.timer = null; }
  set(zone, enabled) {
    const next = enabled && (zone === 1 || zone === 2) ? zone : 0;
    if (next === this.zone) return;
    clearInterval(this.timer);
    this.timer = null;
    this.zone = next;
    if (!next) return;
    this.play(next);
    this.timer = setInterval(() => this.play(this.zone), next === 2 ? 1000 : 2000);
  }
};
