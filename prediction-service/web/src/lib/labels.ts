export const BUILDING_LABELS: Record<string, string> = {
  Residential: 'מגורים',
  Office: 'משרדים',
  Commercial: 'מסחר',
  Hospital: 'בית חולים',
  School: 'בית ספר',
  Kindergarten: 'גן ילדים',
  Industrial: 'תעשייה',
  Hotel: 'מלון',
  'Mixed use': 'שימוש מעורב',
  Other: 'אחר',
};

export const DOCUMENT_LABELS: Record<string, string> = {
  ARCHITECTURAL: 'אדריכלות',
  ELECTRICAL: 'חשמל',
  SINGLE_LINE: 'תוכנית חד-קווית',
  TRANSFORMER_ROOM: 'חדר שנאים',
  CABLE_LAYOUT: 'תוואי כבלים',
  SITE_PLAN: 'תוכנית אתר',
  OTHER: 'אחר',
};

export const SOURCE_LABELS: Record<string, string> = {
  TRANSFORMER: 'שנאי',
  LV_BOARD: 'לוח מתח נמוך',
  MAIN_DISTRIBUTION_BOARD: 'לוח ראשי',
  BUSBAR: 'Busbar',
  THREE_PHASE_CABLE: 'כבל תלת-פאזי',
  CABLE_BUNDLE: 'צרור כבלים',
  CABLE_TRAY: 'תעלת כבלים',
  RISER: 'Riser',
  ELECTRICAL_SHAFT: 'פיר חשמל',
  GENERATOR: 'גנרטור',
  UPS: 'UPS',
  INVERTER: 'ממיר',
  EV_CHARGING: 'תשתית טעינה',
  PV_INFRASTRUCTURE: 'תשתית PV',
};

export const LINE_TYPES = ['THREE_PHASE_CABLE', 'CABLE_BUNDLE', 'CABLE_TRAY', 'RISER', 'ELECTRICAL_SHAFT', 'BUSBAR'];
export const BOX_TYPES = [
  'TRANSFORMER',
  'MAIN_DISTRIBUTION_BOARD',
  'LV_BOARD',
  'GENERATOR',
  'UPS',
  'INVERTER',
  'EV_CHARGING',
  'PV_INFRASTRUCTURE',
];

export const OCCUPANCY_LABELS: Record<string, string> = {
  CONTINUOUS_OCCUPANCY: 'שהייה ממושכת',
  NON_CONTINUOUS_OCCUPANCY: 'שהייה לא ממושכת',
  UNKNOWN: 'לא ידוע',
};

export const ARRANGEMENT_LABELS: Record<string, string> = {
  FLAT_HORIZONTAL: 'שטוח, אופקי',
  FLAT_VERTICAL: 'שטוח, אנכי',
  TREFOIL: 'משולש (Trefoil)',
};

export const BASIS_LABELS: Record<string, string> = {
  RATED: 'Rated (נקוב)',
  DESIGN: 'Design (תכנון)',
  MEASURED: 'Measured (מדוד)',
  ESTIMATED: 'Estimated (הערכה)',
};

export const SCENARIO_LABELS: Record<string, string> = {
  NORMAL: 'עומס צפוי רגיל',
  MAX_DESIGN: 'עומס תכנון מרבי',
  WORST_CASE: 'מקרה גרוע',
  POST_MITIGATION: 'לאחר פתרון',
};

export const INSTRUMENT_LABELS: Record<string, string> = {
  LAW: 'חוק',
  REGULATION: 'תקנות',
  PROCEDURE: 'נוהל',
  PERMIT: 'היתר',
  RECOMMENDATION: 'המלצה',
  GUIDELINE: 'קו מנחה',
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'טיוטה',
  UNDER_REVIEW: 'בבדיקה',
  APPROVED: 'מאושר',
  ISSUED: 'הונפק',
};

export const STATUS_LABELS: Record<string, { text: string; tone: string }> = {
  PASS: { text: 'עומד בכלל', tone: 'ok' },
  FAIL: { text: 'חורג מהכלל', tone: 'bad' },
  REGULATION_REVIEW_REQUIRED: { text: 'REGULATION_REVIEW_REQUIRED', tone: 'warn' },
};

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}

export function mg(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toFixed(2);
}
