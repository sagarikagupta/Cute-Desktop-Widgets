/* ═══════════════════════════════════════════════════════════
   SkyAlert — Event Scheduler
   Polls calendar and triggers airplane flights for upcoming events
   ═══════════════════════════════════════════════════════════ */

const Calendar = require('./calendar');

class Scheduler {
  constructor(store, onTriggerFlight, googleAuth) {
    this.store = store;
    this.onTriggerFlight = onTriggerFlight;
    this.googleAuth = googleAuth;
    this.pollInterval = null;
    this.calendar = null;
  }

  async start() {
    console.log('📅 Scheduler starting...');

    try {
      const auth = await this.googleAuth.getAuthClient(this.store.get('googleTokens'));
      this.calendar = new Calendar(auth);
    } catch (err) {
      console.error('Failed to initialize calendar:', err.message);
      return;
    }

    // Poll immediately, then every 60 seconds
    this._poll();
    this.pollInterval = setInterval(() => this._poll(), 60 * 1000);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('📅 Scheduler stopped');
  }

  async _poll() {
    if (!this.calendar) return;

    try {
      const alertMinutes = this.store.get('alertMinutesBefore') || 15;
      const events = await this.calendar.getUpcomingEvents(alertMinutes + 5);

      for (const event of events) {
        // Check if we should alert for this event
        if (this._shouldAlert(event, alertMinutes)) {
          this._triggerAlert(event);
        }
      }
    } catch (err) {
      console.error('Poll failed:', err.message);
    }
  }

  _shouldAlert(event, alertMinutes) {
    // Don't re-alert events we've already shown
    const alertKey = `${event.id}_${alertMinutes}`;
    if (this.store.wasAlerted(alertKey)) return false;

    // Alert if event is within the alert window
    return event.minutesUntil <= alertMinutes && event.minutesUntil >= 0;
  }

  _triggerAlert(event) {
    const alertMinutes = this.store.get('alertMinutesBefore') || 15;
    const alertKey = `${event.id}_${alertMinutes}`;

    // Mark as alerted
    this.store.markAlerted(alertKey);

    // Build the flight message
    const timeText = event.minutesUntil <= 1
      ? 'starting now!'
      : `in ${event.minutesUntil} min`;

    const flightData = {
      title: `${event.title} — ${timeText}`,
      subtitle: event.location || '',
      type: event.type,
      emoji: event.emoji,
      speed: this.store.get('airplaneSpeed') || 'normal',
    };

    console.log(`✈️ Flying alert: ${flightData.title}`);
    this.onTriggerFlight(flightData);
  }
}

module.exports = Scheduler;
