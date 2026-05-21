const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DEFAULT_TIMEZONE = 'Europe/Istanbul';
const DEFAULT_OPENING_TIME = '10:00';
const DEFAULT_CLOSING_TIME = '22:00';

const getFormatter = (timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const parseTimeToMinutes = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
};

export const getStoreTimezone = (settings = {}) => String(settings?.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

export const getStoreLocalParts = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
  const parts = getFormatter(timeZone).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    localDate,
    dayKey: DAY_NAMES[weekdayIndex],
    minutesOfDay: (hour * 60) + minute,
  };
};

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = getStoreLocalParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
};

export const zonedLocalDateTimeToUtc = (localDate, minutesOfDay, timeZone = DEFAULT_TIMEZONE) => {
  const [year, month, day] = String(localDate || '').split('-').map(Number);
  if (!year || !month || !day || !Number.isFinite(minutesOfDay)) return null;
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let index = 0; index < 3; index += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }

  return new Date(utcMs);
};

const addDaysToLocalDate = (localDate, days) => {
  const [year, month, day] = String(localDate || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const getDayKeyFromLocalDate = (localDate) => {
  const [year, month, day] = String(localDate || '').split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
};

export const resolveStoreScheduleForDate = (settings = {}, localDate, dayKey = null) => {
  const resolvedDayKey = dayKey || getDayKeyFromLocalDate(localDate);
  const specialDays = Array.isArray(settings.specialDays) ? settings.specialDays : [];
  const weeklySchedule = Array.isArray(settings.weeklySchedule) ? settings.weeklySchedule : [];
  const closedDays = Array.isArray(settings.closedDays) ? settings.closedDays : [];
  const activeSpecialDay = specialDays.find((item) => item?.date === localDate && item?.isActive !== false);
  const activeWeekdaySchedule = weeklySchedule.find((item) => item?.dayKey === resolvedDayKey);
  const isClosed = Boolean(settings.holidayMode)
    || Boolean(activeSpecialDay?.isClosed)
    || (!activeSpecialDay && (Boolean(activeWeekdaySchedule?.isClosed) || closedDays.includes(resolvedDayKey)));
  const opensAt = activeSpecialDay?.opensAt || activeSpecialDay?.startTime || activeWeekdaySchedule?.opensAt || settings.openingTime || DEFAULT_OPENING_TIME;
  const closesAt = activeSpecialDay?.closesAt || activeSpecialDay?.endTime || activeWeekdaySchedule?.closesAt || settings.closingTime || DEFAULT_CLOSING_TIME;
  const openMinutes = parseTimeToMinutes(opensAt);
  const closeMinutes = parseTimeToMinutes(closesAt);

  return {
    localDate,
    dayKey: resolvedDayKey,
    source: activeSpecialDay ? 'specialDay' : 'weeklySchedule',
    isClosed,
    opensAt,
    closesAt,
    openMinutes,
    closeMinutes,
  };
};

export const isMinuteWithinSchedule = (minutesOfDay, schedule) => {
  if (!schedule || schedule.isClosed || schedule.openMinutes === null || schedule.closeMinutes === null || schedule.openMinutes === schedule.closeMinutes) {
    return false;
  }

  if (schedule.openMinutes < schedule.closeMinutes) {
    return minutesOfDay >= schedule.openMinutes && minutesOfDay < schedule.closeMinutes;
  }

  return minutesOfDay >= schedule.openMinutes || minutesOfDay < schedule.closeMinutes;
};

export const resolveStoreScheduleStatus = (settings = {}, date = new Date()) => {
  const timeZone = getStoreTimezone(settings);
  const local = getStoreLocalParts(date, timeZone);
  const schedule = resolveStoreScheduleForDate(settings, local.localDate, local.dayKey);
  return {
    ...schedule,
    timeZone,
    isStoreOpen: isMinuteWithinSchedule(local.minutesOfDay, schedule),
    localDate: local.localDate,
    localTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
  };
};

const findOpenScheduleOnOrAfter = (settings, localDate, { skipCurrentDate = false } = {}) => {
  for (let offset = skipCurrentDate ? 1 : 0; offset < 370; offset += 1) {
    const candidateDate = addDaysToLocalDate(localDate, offset);
    const schedule = resolveStoreScheduleForDate(settings, candidateDate);
    if (!schedule.isClosed && schedule.openMinutes !== null && schedule.closeMinutes !== null && schedule.openMinutes !== schedule.closeMinutes) {
      return schedule;
    }
  }
  return null;
};

export const coerceToStoreOpenInstant = (dateValue, settings = {}) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const status = resolveStoreScheduleStatus(settings, date);
  if (status.isStoreOpen) return date;

  const local = getStoreLocalParts(date, status.timeZone);
  let targetSchedule = null;

  if (!status.isClosed && status.openMinutes !== null && status.closeMinutes !== null) {
    const afterClose = status.openMinutes < status.closeMinutes
      ? local.minutesOfDay >= status.closeMinutes
      : local.minutesOfDay >= status.closeMinutes && local.minutesOfDay < status.openMinutes;
    targetSchedule = afterClose
      ? findOpenScheduleOnOrAfter(settings, local.localDate, { skipCurrentDate: true })
      : status;
  } else {
    targetSchedule = findOpenScheduleOnOrAfter(settings, local.localDate, { skipCurrentDate: true });
  }

  if (!targetSchedule) return null;

  const duration = targetSchedule.openMinutes < targetSchedule.closeMinutes
    ? targetSchedule.closeMinutes - targetSchedule.openMinutes
    : (24 * 60) - targetSchedule.openMinutes + targetSchedule.closeMinutes;
  const preservedMinuteOffset = Math.min(Math.max(0, duration - 1), local.minutesOfDay % 60);
  const targetMinutes = (targetSchedule.openMinutes + preservedMinuteOffset) % (24 * 60);
  return zonedLocalDateTimeToUtc(targetSchedule.localDate, targetMinutes, status.timeZone);
};
