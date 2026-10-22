/**
 * מושך נתונים מטאורולוגיים היסטוריים עבור יום הבדיקה — מ-Open-Meteo (ללא API key).
 *
 * שימוש: ב-DetailsStep של דוח איכות אוויר הבודק לוחץ על "שלוף מזג אוויר" והשרת
 * מוציא עיר+תאריך, מגאו-קודד את העיר ל-lat/lng (Open-Meteo geocoding), ואז מושך
 * טמפרטורה / לחות / רוח / קוד תנאים לפי השעות שהבדיקה בוצעה בהן. הפלט מורכב
 * לטקסט עברי קצר כמו "סתיו, בהיר ונוח · ממוצע 22°C · לחות 58% · רוח מערבית 12 קמ"ש"
 * כדי שישב בשדה weather כפי שהוא היום.
 */

/** פלט הקריאה — טקסט מוכן לשדה weather + פירוט מספרי לוגים/הצגה. */
export interface WeatherLookupResult {
  /** הטקסט שנדחף ישירות לשדה weather. */
  text: string;
  /** פירוט מספרי — טמפרטורות ממוצע/מינימום/מקסימום, לחות ממוצעת, רוח. */
  details: {
    temperatureAvg: number | null;
    temperatureMin: number | null;
    temperatureMax: number | null;
    humidityAvg: number | null;
    windSpeedAvg: number | null;
    windDirectionAvg: number | null;
    precipitation: number | null;
    conditionCode: number | null;
  };
}

export class WeatherLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherLookupError';
  }
}

/**
 * מגאו-קודד שם עיר (עברית או אנגלית) ל-lat/lng. מגביל לישראל כדי להימנע מתאומים
 * בחו"ל של ערים ישראליות — "Herzliya" בטקסס, "Haifa" במצרים וכד'.
 */
async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const q = city.trim();
  if (!q) return null;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=he&countryCode=IL&format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as
    | { results?: Array<{ latitude: number; longitude: number; name: string; country_code?: string }> }
    | null;
  const first = data?.results?.find((r) => r.country_code === 'IL') ?? data?.results?.[0];
  if (!first) return null;
  return { lat: first.latitude, lon: first.longitude, name: first.name };
}

/** DD/MM/YYYY → YYYY-MM-DD. מחזיר null אם לא תקין. */
function parseDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // DD/MM/YYYY או DD.MM.YYYY או DD-MM-YYYY
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(trimmed);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // כבר ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

/** HH:MM-HH:MM → [startHour, endHour] באינטרס שעות מלאות. "17:00-18:30" → [17, 18]. */
function parseHourRange(input: string): [number, number] | null {
  const m = /^(\d{1,2})[:.](\d{1,2})\s*-\s*(\d{1,2})[:.](\d{1,2})/.exec(input.trim());
  if (!m) return null;
  const h1 = Number(m[1]);
  const h2 = Number(m[3]);
  if (!(h1 >= 0 && h1 <= 23 && h2 >= 0 && h2 <= 23)) return null;
  return [Math.min(h1, h2), Math.max(h1, h2)];
}

/** עונה לפי חודש ישראלי — פשוט, כי זה מופיע בטקסט ולא לחישוב. */
function seasonHebrew(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7));
  if (month >= 3 && month <= 5) return 'אביב';
  if (month >= 6 && month <= 8) return 'קיץ';
  if (month >= 9 && month <= 11) return 'סתיו';
  return 'חורף';
}

/** WMO weather code → תיאור קצר בעברית. ה-WMO הוא התקן של Open-Meteo. */
function describeCondition(code: number | null): string {
  if (code === null) return 'בהיר';
  if (code === 0) return 'בהיר';
  if (code === 1 || code === 2) return 'מעונן חלקית';
  if (code === 3) return 'מעונן';
  if (code === 45 || code === 48) return 'ערפל';
  if (code >= 51 && code <= 57) return 'טפטוף';
  if (code >= 61 && code <= 67) return 'גשם';
  if (code >= 71 && code <= 77) return 'שלג';
  if (code >= 80 && code <= 82) return 'ממטרים';
  if (code >= 85 && code <= 86) return 'ממטרי שלג';
  if (code >= 95) return 'סופת רעמים';
  return 'בהיר';
}

/** 0°=צפון, 90°=מזרח, 180°=דרום, 270°=מערב. */
function describeWindDir(deg: number | null): string {
  if (deg === null) return '';
  const dirs = [
    'צפונית',
    'צפון-מזרחית',
    'מזרחית',
    'דרום-מזרחית',
    'דרומית',
    'דרום-מערבית',
    'מערבית',
    'צפון-מערבית',
  ];
  const i = Math.round(((deg % 360) / 45)) % 8;
  return dirs[i];
}

function tempAdjective(temp: number | null): string {
  if (temp === null) return '';
  if (temp >= 30) return 'חם מאוד';
  if (temp >= 24) return 'חם';
  if (temp >= 17) return 'נוח';
  if (temp >= 10) return 'קריר';
  return 'קר';
}

/**
 * המשיכה בפועל. מחזיר null אם אין מספיק נתונים כדי להרכיב טקסט (עיר לא זוהתה,
 * תאריך לא תקין, או Open-Meteo החזיר ריק).
 */
export async function lookupWeather(input: {
  city: string;
  surveyDate: string;
  surveyTime?: string;
}): Promise<WeatherLookupResult | null> {
  const city = input.city.trim();
  if (!city) throw new WeatherLookupError('חסרה עיר — מלאו "עיר" בפרטי המזמין לפני השליפה.');
  const isoDate = parseDate(input.surveyDate);
  if (!isoDate) throw new WeatherLookupError('תאריך לא תקין — ודאו שהוא במבנה DD/MM/YYYY.');

  const geo = await geocodeCity(city);
  if (!geo) throw new WeatherLookupError(`לא נמצא מיקום בישראל בשם "${city}". בדקו איות.`);

  // Open-Meteo forecast מכסה 92 ימים אחורה + 16 קדימה. לכל השאר — archive-api.
  // ננסה את forecast קודם (עדכני יותר); על כישלון → archive.
  const hourly = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code';
  const commonQS =
    `latitude=${geo.lat}&longitude=${geo.lon}` +
    `&hourly=${encodeURIComponent(hourly)}&start_date=${isoDate}&end_date=${isoDate}` +
    `&timezone=${encodeURIComponent('Asia/Jerusalem')}&windspeed_unit=kmh`;

  type HourlyPayload = {
    hourly?: {
      time?: string[];
      temperature_2m?: Array<number | null>;
      relative_humidity_2m?: Array<number | null>;
      wind_speed_10m?: Array<number | null>;
      wind_direction_10m?: Array<number | null>;
      precipitation?: Array<number | null>;
      weather_code?: Array<number | null>;
    };
    error?: boolean;
    reason?: string;
  };

  const tryEndpoint = async (base: string): Promise<HourlyPayload | null> => {
    const res = await fetch(`${base}?${commonQS}`, { headers: { Accept: 'application/json' } }).catch(
      () => null,
    );
    if (!res) return null;
    const data = (await res.json().catch(() => null)) as HourlyPayload | null;
    if (!data) return null;
    if (data.error) return null;
    if (!res.ok) return null;
    return data;
  };

  const data =
    (await tryEndpoint('https://api.open-meteo.com/v1/forecast')) ??
    (await tryEndpoint('https://archive-api.open-meteo.com/v1/archive'));

  if (!data) {
    throw new WeatherLookupError('שליפת מזג האוויר נכשלה. נסו שוב בעוד רגע.');
  }
  const h = data.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length === 0) {
    throw new WeatherLookupError(
      'אין נתונים זמינים לתאריך זה. ייתכן שהוא עתידי מדי או קודם מאוד (ארכיון זמין מ-1940).',
    );
  }

  // חותכים לשעות הבדיקה אם ניתנו, אחרת ממוצע יומי מלא.
  const hourRange = input.surveyTime ? parseHourRange(input.surveyTime) : null;
  const indices: number[] = [];
  if (hourRange) {
    h.time.forEach((t, i) => {
      const hour = Number(t.slice(11, 13));
      if (hour >= hourRange[0] && hour <= hourRange[1]) indices.push(i);
    });
  }
  if (indices.length === 0) h.time.forEach((_, i) => indices.push(i));

  const picked = <T,>(arr: Array<T | null> | undefined, idxs: number[]): T[] =>
    (arr || []).map((v, i) => ({ v, i })).filter((x) => idxs.includes(x.i) && x.v !== null).map((x) => x.v as T);

  const avg = (nums: number[]): number | null =>
    nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  const minOf = (nums: number[]): number | null => (nums.length === 0 ? null : Math.min(...nums));
  const maxOf = (nums: number[]): number | null => (nums.length === 0 ? null : Math.max(...nums));
  const mode = (nums: number[]): number | null => {
    if (nums.length === 0) return null;
    const counts = new Map<number, number>();
    for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
    let best = nums[0];
    let bestCount = 0;
    for (const [n, c] of counts) if (c > bestCount) { best = n; bestCount = c; }
    return best;
  };

  const temps = picked<number>(h.temperature_2m, indices);
  const hums = picked<number>(h.relative_humidity_2m, indices);
  const winds = picked<number>(h.wind_speed_10m, indices);
  const windDirs = picked<number>(h.wind_direction_10m, indices);
  const precs = picked<number>(h.precipitation, indices);
  const codes = picked<number>(h.weather_code, indices);

  const tempAvg = avg(temps);
  const details = {
    temperatureAvg: tempAvg,
    temperatureMin: minOf(temps),
    temperatureMax: maxOf(temps),
    humidityAvg: avg(hums),
    windSpeedAvg: avg(winds),
    windDirectionAvg: avg(windDirs),
    precipitation: precs.reduce((a, b) => a + b, 0) || null,
    conditionCode: mode(codes),
  };

  const season = seasonHebrew(isoDate);
  const condition = describeCondition(details.conditionCode);
  const tempWord = tempAdjective(tempAvg);
  const parts: string[] = [];
  parts.push(`${season}, ${condition}${tempWord ? ` ו${tempWord}` : ''}`);
  if (tempAvg !== null) parts.push(`ממוצע ${tempAvg.toFixed(1)}°C`);
  if (details.humidityAvg !== null) parts.push(`לחות ${Math.round(details.humidityAvg)}%`);
  if (details.windSpeedAvg !== null && details.windSpeedAvg > 1) {
    const dir = describeWindDir(details.windDirectionAvg);
    parts.push(`רוח ${dir}${dir ? ' ' : ''}${Math.round(details.windSpeedAvg)} קמ"ש`);
  }
  return { text: parts.join(' · '), details };
}
