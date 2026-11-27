// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { splitScheduleRange } from '../lib/trackingEmails.js';

function formatRxoExcelDateTime(value) {
  const text = String(value ?? '').trim();
  let date;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    date = new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes()
    ));
  } else if (
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || (/^\d+(?:\.\d+)?$/.test(text) && Number(text) >= 0)
  ) {
    const serial = Number(value);
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  } else {
    const timeRange = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i
    );
    if (timeRange) {
      const to24 = (h, m, meridiem) => {
        let hour = Number(h);
        if (meridiem) {
          if (hour < 1 || hour > 12) return null;
          hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
        }
        return hour > 23 || Number(m) > 59 ? null : `${String(hour).padStart(2, '0')}${m}`;
      };
      const start = to24(timeRange[4], timeRange[5], timeRange[6]);
      const end = to24(timeRange[7], timeRange[8], timeRange[9] || timeRange[6]);
      const year = timeRange[3].length === 2 ? `20${timeRange[3]}` : timeRange[3];
      if (start && end) {
        return `${timeRange[1].padStart(2, '0')}/${timeRange[2].padStart(2, '0')}/${year} ${start} - ${end}`;
      }
      return text;
    }
    const usDateTime = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i
    );
    const isoDateTime = text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
    );
    if (!usDateTime && !isoDateTime) return text;

    const month = Number(usDateTime ? usDateTime[1] : isoDateTime[2]);
    const day = Number(usDateTime ? usDateTime[2] : isoDateTime[3]);
    const yearText = usDateTime ? usDateTime[3] : isoDateTime[1];
    const year = Number(yearText) < 100 ? 2000 + Number(yearText) : Number(yearText);
    let hour = Number(usDateTime ? usDateTime[4] : isoDateTime[4]);
    const minute = Number(usDateTime ? usDateTime[5] : isoDateTime[5]);
    const meridiem = usDateTime?.[6]?.toUpperCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return text;
      hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
    }
    date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || hour > 23 || minute > 59) {
      return text;
    }
  }

  if (!Number.isFinite(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function toExcelDateTime(value, fallbackDateValue = '') {
  const dateTime = String(value || '').replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
  const fullMatch = dateTime.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,4})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (fullMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = fullMatch;
    const month = Number(monthText);
    const day = Number(dayText);
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    let hour;
    let minute;
    if (minuteText !== undefined) {
      hour = Number(hourText);
      minute = Number(minuteText);
    } else if (hourText.length > 2) {
      hour = Number(hourText.slice(0, -2));
      minute = Number(hourText.slice(-2));
    } else {
      hour = Number(hourText);
      minute = 0;
    }
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    }
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || hour > 23 || minute > 59) return null;
    return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  }

  const timeMatch = dateTime.match(/^(\d{1,4})(?::(\d{2}))?\s*(AM|PM)?$/i);
  const fallbackMatch = String(fallbackDateValue || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!timeMatch || !fallbackMatch) return null;
  const [, timeText, minuteText, meridiem] = timeMatch;
  let hour;
  let minute;
  if (minuteText !== undefined) {
    hour = Number(timeText);
    minute = Number(minuteText);
  } else if (timeText.length > 2) {
    hour = Number(timeText.slice(0, -2));
    minute = Number(timeText.slice(-2));
  } else {
    hour = Number(timeText);
    minute = 0;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const [, monthText, dayText, yearText] = fallbackMatch;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

function parseSchedulePickerParts(value) {
  const parts = splitScheduleRange(value);
  const parse = text => {
    const match = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/);
    if (!match) return null;
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return {
      date: `${year}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`,
      time: `${String(Number(match[4])).padStart(2, '0')}:${match[5]}`
    };
  };
  const from = parse(parts[0]);
  let to = parse(parts[1]);
  if (!to && from) {
    // "11/18/2026 0700 - 1500": the end has only a time, on the same day as the start.
    const timeOnly = String(parts[1] || '').trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (timeOnly && Number(timeOnly[1]) <= 23 && Number(timeOnly[2]) <= 59) {
      to = { date: from.date, time: `${String(Number(timeOnly[1])).padStart(2, '0')}:${timeOnly[2]}` };
    }
  }
  return { from, to };
}

function formatSchedulePickerParts(from, to) {
  const format = (part, fallbackTime) => {
    if (!part?.date) return '';
    const [year, month, day] = part.date.split('-');
    const time = (part.time || fallbackTime).replace(':', '');
    return `${Number(month)}/${Number(day)}/${year} ${time}`;
  };
  const fromText = format(from, '08:00');
  const toText = format(to, '16:00');
  return fromText && toText ? `${fromText} - ${toText}` : fromText || toText;
}

export {
  formatRxoExcelDateTime,
  toExcelDateTime,
  parseSchedulePickerParts,
  formatSchedulePickerParts
};
