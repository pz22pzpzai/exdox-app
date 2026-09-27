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
  routes: MileageRouteOption[];
};

export async function calculateMileageRoute(startPostcode: string, endPostcode: string): Promise<MileageRouteResult> {
  const response = await fetch(`${getApiBaseUrl()}/mileage/route`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireSessionToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startPostcode, endPostcode, includeMap: true }),
  });
  const data = await response.json() as MileageRouteResult & { success?: boolean; message?: string };
  if (!response.ok || data.success !== true || !Array.isArray(data.routes) || !data.routes.length) {
    throw new Error(data.message || 'Could not calculate this route. Enter the miles manually or try again.');
  }
  return data;
}
