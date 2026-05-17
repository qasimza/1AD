import { getForecast, maxPrecipitationProbability } from "./open-meteo";

async function test() {
  // Stinson Beach, our seeded outdoor location
  const forecast = await getForecast(37.9011, -122.6409, 24);

  console.log(`Forecast for ${forecast.latitude}, ${forecast.longitude}`);
  console.log(`Timezone: ${forecast.timezone}`);
  console.log(`Hours returned: ${forecast.hourly.length}`);
  console.log();

  console.log("First 6 hours:");
  forecast.hourly.slice(0, 6).forEach((h) => {
    console.log(
      `  ${h.time.toISOString().slice(0, 16).replace("T", " ")}  ` +
        `${h.temperatureC.toFixed(1)}°C  ` +
        `precip ${h.precipitationMm}mm  ` +
        `prob ${h.precipitationProbability}%  ` +
        `wind ${h.windSpeedKmh.toFixed(0)} km/h`,
    );
  });

  // Check tomorrow morning's rain probability (the Story 1 trigger)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(6, 0, 0, 0);
  const noon = new Date(tomorrow);
  noon.setHours(12);

  const maxProb = maxPrecipitationProbability(forecast, tomorrow, noon);
  console.log();
  console.log(`Max precip probability tomorrow 6am–12pm: ${maxProb}%`);
  if (maxProb >= 50) {
    console.log("→ Would trigger weatherCoverSet playbook");
  } else {
    console.log("→ Below threshold, no risk detected");
  }
}

test().catch((e) => {
  console.error("✗ Test failed:", e);
  process.exit(1);
});