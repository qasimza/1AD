/**
 * Open-Meteo weather wrapper.
 *
 * No API key required. Forecasts for any lat/lon worldwide.
 * Docs: https://open-meteo.com/en/docs
 */

const BASE_URL = "https://api.open-meteo.com/v1/forecast";

export interface HourlyForecast {
  time: Date;
  temperatureC: number;
  precipitationMm: number;
  precipitationProbability: number; // 0-100
  windSpeedKmh: number;
  weatherCode: number; // WMO code; 0=clear, 61-65=rain, 71-75=snow, 95-99=thunderstorm
}

export interface WeatherForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: HourlyForecast[];
  fetchedAt: Date;
}

/**
 * Fetch hourly forecast for the next `hours` hours.
 * Returns precipitation probability among other fields — that's the field
 * the weather playbook keys on.
 */
export async function getForecast(
  lat: number,
  lon: number,
  hours: number = 48,
): Promise<WeatherForecast> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      "temperature_2m",
      "precipitation",
      "precipitation_probability",
      "wind_speed_10m",
      "weather_code",
    ].join(","),
    forecast_hours: hours.toString(),
    timezone: "auto",
  });

  const response = await fetch(`${BASE_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const h = data.hourly;

  const hourly: HourlyForecast[] = h.time.map((t: string, i: number) => ({
    time: new Date(t),
    temperatureC: h.temperature_2m[i],
    precipitationMm: h.precipitation[i],
    precipitationProbability: h.precipitation_probability[i] ?? 0,
    windSpeedKmh: h.wind_speed_10m[i],
    weatherCode: h.weather_code[i],
  }));

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
    hourly,
    fetchedAt: new Date(),
  };
}

/**
 * Risk-evaluator helper. Returns the maximum precipitation probability
 * across the given time window.
 */
export function maxPrecipitationProbability(
  forecast: WeatherForecast,
  windowStart: Date,
  windowEnd: Date,
): number {
  const inWindow = forecast.hourly.filter(
    (h) => h.time >= windowStart && h.time <= windowEnd,
  );
  if (inWindow.length === 0) return 0;
  return Math.max(...inWindow.map((h) => h.precipitationProbability));
}