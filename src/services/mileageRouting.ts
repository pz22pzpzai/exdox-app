import { getApiBaseUrl } from './auth';
import { requireSessionToken } from './session';

export type MileageRouteOption = {
  miles: number;
  durationMinutes: number;
  via: string[];
  mapImage?: string;
};

export type MileageRouteResult = {
  startPostcode: string;
  endPostcode: string;
  stops?: string[];
  routes: MileageRouteOption[];
};

export async function calculateMileageRoute(postcodes: string[]): Promise<MileageRouteResult> {
  const [startPostcode, ...rest] = postcodes;
  const endPostcode = rest[rest.length - 1];
  const stops = rest.slice(0, -1);
  const response = await fetch(`${getApiBaseUrl()}/mileage/route`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireSessionToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startPostcode, endPostcode, stops, includeMap: true }),
  });
  const data = await response.json() as MileageRouteResult & { success?: boolean; message?: string };
  if (!response.ok || data.success !== true || !Array.isArray(data.routes) || !data.routes.length) {
    throw new Error(data.message || 'Could not calculate this route. Enter the miles manually or try again.');
  }
  return data;
}
