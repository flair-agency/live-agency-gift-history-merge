// Service-neutral validation owned by this business capability.
function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function assertIsoDateTime(value, label) {
  const match = typeof value === "string" ? value.match(ISO_DATE_TIME_PATTERN) : null;
  if (!match) {
    throw new TypeError(`${label} must be an ISO date-time string`);
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`${label} must be an ISO date-time string`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function assertCalendarDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${label} is not a calendar date`);
  }
}

function assertPlainText(value, label) {
  if (typeof value !== "string" || !value || /[\t\r\n]/.test(value)) {
    throw new TypeError(`${label} must be non-empty single-line text`);
  }
}

export function validateGiftHistorySnapshot(snapshot) {
  assertObject(snapshot, "gift-history snapshot");
  if (snapshot.version !== 1) throw new TypeError("gift-history snapshot version is invalid");
  assertCalendarDate(snapshot.snapshotDate, "gift-history snapshot snapshotDate");
  assertIsoDateTime(snapshot.observedAt, "gift-history snapshot observedAt");
  assertPlainText(snapshot.accountKey, "gift-history snapshot accountKey");
  if (!/^[0-9a-f]{64}$/.test(snapshot.sourceSha256 ?? "")) {
    throw new TypeError("gift-history snapshot sourceSha256 is invalid");
  }
  if (!Array.isArray(snapshot.events)) {
    throw new TypeError("gift-history snapshot events must be an array");
  }
  if (snapshot.rowCount !== snapshot.events.length) {
    throw new TypeError("gift-history snapshot rowCount must match events.length");
  }

  const keys = new Set();
  let previous = null;
  for (const [index, event] of snapshot.events.entries()) {
    const label = `gift-history event ${index}`;
    assertObject(event, label);
    assertPlainText(event.eventKey, `${label} eventKey`);
    assertPlainText(event.accountKey, `${label} accountKey`);
    assertPlainText(event.recipientKey, `${label} recipientKey`);
    assertIsoDateTime(event.occurredAt, `${label} occurredAt`);
    if (!/^(?:0|[1-9]\d*)$/.test(event.amount ?? "")) {
      throw new TypeError(`${label} amount must be a canonical non-negative integer string`);
    }
    if (event.accountKey !== snapshot.accountKey) {
      throw new TypeError(`${label} accountKey does not match the snapshot`);
    }
    if (keys.has(event.eventKey)) throw new TypeError(`${label} eventKey is duplicated`);
    keys.add(event.eventKey);
    const ordering = [Date.parse(event.occurredAt), event.eventKey];
    if (
      previous &&
      (ordering[0] < previous[0] || (ordering[0] === previous[0] && ordering[1] <= previous[1]))
    ) {
      throw new TypeError(`${label} is not strictly ordered by occurredAt and eventKey`);
    }
    previous = ordering;
  }
  return snapshot;
}

