import { NextResponse } from 'next/server';
import { ANTENNA_REPORT_RADIUS_M, findNearbyAntennas, geocodeAddress } from '@/lib/antennas';
import { wgs84ToITM } from '@/lib/itm';

/**
 * GET /api/antennas?address=...&city=...&radius=500
 * GET /api/antennas?lat=...&lon=...&radius=500
 * GET /api/antennas?x=...&y=...&radius=500
 *
 * Returns all cellular antenna sites (active + under construction) within
 * `radius` metres of the given point, grouped by physical location, with
 * distance and full operator details.
 *
 * Three ways to specify the point:
 *  1. `address` + `city` — geocoded via Nominatim then converted to ITM
 *  2. `lat` + `lon` — WGS84 degrees, converted to ITM
 *  3. `x` + `y` — ITM easting/northing directly
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const radius = Math.min(
    Math.max(Number(url.searchParams.get('radius')) || ANTENNA_REPORT_RADIUS_M, 100),
    5000,
  );

  let centerX: number;
  let centerY: number;

  const xParam = url.searchParams.get('x');
  const yParam = url.searchParams.get('y');
  const latParam = url.searchParams.get('lat');
  const lonParam = url.searchParams.get('lon');
  const addressParam = url.searchParams.get('address');
  const cityParam = url.searchParams.get('city');

  if (xParam && yParam) {
    // Direct ITM coordinates
    centerX = Number(xParam);
    centerY = Number(yParam);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      return NextResponse.json({ error: 'קואורדינטות ITM לא תקינות' }, { status: 400 });
    }
  } else if (latParam && lonParam) {
    // WGS84 → ITM
    const lat = Number(latParam);
    const lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 29 || lat > 34 || lon < 34 || lon > 36) {
      return NextResponse.json({ error: 'קואורדינטות WGS84 לא תקינות או מחוץ לישראל' }, { status: 400 });
    }
    const itm = wgs84ToITM(lat, lon);
    centerX = itm.x;
    centerY = itm.y;
  } else if (addressParam && cityParam) {
    // Geocode address
    const geo = await geocodeAddress(addressParam, cityParam);
    if (!geo) {
      return NextResponse.json({ error: 'הכתובת לא נמצאה' }, { status: 404 });
    }
    centerX = geo.x;
    centerY = geo.y;
  } else {
    return NextResponse.json(
      { error: 'נדרשים address+city, lat+lon, או x+y' },
      { status: 400 },
    );
  }

  try {
    const result = await findNearbyAntennas(centerX, centerY, radius);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    console.error('[antennas]', err);
    return NextResponse.json(
      { error: 'שגיאה בשליפת נתוני האנטנות', details: String(err) },
      { status: 500 },
    );
  }
}
