const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

export interface IaqCurrentDateTime {
  /** DD.MM.YYYY — the format printed in the IAQ report tables. */
  date: string;
  /** HH:mm — Israel local time, to the minute. */
  time: string;
}

/**
 * Today's date and current time for an indoor-air-quality report.
 *
 * Railway runs in UTC, while these reports describe work performed in Israel.
 * Reading named parts in the Israel time zone avoids both an incorrect hour and
 * the previous/next date around midnight, without relying on locale punctuation.
 */
export function iaqCurrentDateTime(now = new Date()): IaqCurrentDateTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return {
    date: `${part('day')}.${part('month')}.${part('year')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
