/* ═══════════════════════════════════════════════════════════
   SkyAlert — Google Calendar Integration
   Fetches upcoming events from Google Calendar API
   ═══════════════════════════════════════════════════════════ */

const { google } = require('googleapis');

class Calendar {
  constructor(auth) {
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  /**
   * Fetch upcoming events within the next N minutes
   * @param {number} minutesAhead - How far ahead to look
   * @returns {Array} Array of event objects
   */
  async getUpcomingEvents(minutesAhead = 30) {
    try {
      const now = new Date();
      const future = new Date(now.getTime() + minutesAhead * 60 * 1000);

      const res = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = res.data.items || [];

      return events
        .filter(e => e.start && (e.start.dateTime || e.start.date))
        .map(event => {
          const startTime = new Date(event.start.dateTime || event.start.date);
          const minutesUntil = Math.round((startTime - now) / 60000);

          return {
            id: event.id,
            title: event.summary || 'Untitled Event',
            startTime: startTime.toISOString(),
            minutesUntil,
            description: event.description || '',
            location: event.location || '',
            type: this._guessEventType(event),
            emoji: this._getEventEmoji(event),
          };
        });
    } catch (err) {
      console.error('Failed to fetch calendar events:', err.message);
      return [];
    }
  }

  /**
   * Guess event type from title/content for appropriate emoji
   */
  _guessEventType(event) {
    const title = (event.summary || '').toLowerCase();
    if (title.includes('birthday') || title.includes('bday')) return 'birthday';
    if (title.includes('meet') || title.includes('standup') || title.includes('sync') || title.includes('1:1')) return 'meeting';
    if (title.includes('deadline') || title.includes('due')) return 'deadline';
    if (title.includes('remind')) return 'reminder';
    return 'default';
  }

  _getEventEmoji(event) {
    const type = this._guessEventType(event);
    const emojis = {
      meeting: '📅',
      deadline: '⏰',
      reminder: '💡',
      birthday: '🎂',
      default: '✨'
    };
    return emojis[type] || '✨';
  }
}

module.exports = Calendar;
