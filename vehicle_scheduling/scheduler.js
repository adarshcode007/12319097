import dotenv from "dotenv";
import { Log } from "../logger.js";

dotenv.config();

const DEPOT_API = process.env.DEPOT_API;
const VEHICLES_API = process.env.VEHICLES_API;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

async function fetchData(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    if (!response.ok) {
      await Log(
        "backend",
        "error",
        "service",
        `D-Fetch Fail: ${response.status}`,
      );
      return null;
    }

    return await response.json();
  } catch (error) {
    await Log(
      "backend",
      "error",
      "service",
      `D-Fetch Exc: ${error.message.substring(0, 20)}`,
    );
    return null;
  }
}

function solveKnapsack(vehicles, availableHours) {
  const n = vehicles.length;
  const dp = new Array(availableHours + 1).fill(0);
  const selectedIndices = new Array(availableHours + 1).fill().map(() => []);

  for (let i = 0; i < n; i++) {
    const { Duration, Impact } = vehicles[i];
    for (let j = availableHours; j >= Duration; j--) {
      if (dp[j - Duration] + Impact > dp[j]) {
        dp[j] = dp[j - Duration] + Impact;
        selectedIndices[j] = [...selectedIndices[j - Duration], i];
      }
    }
  }

  return {
    totalImpact: dp[availableHours],
    selectedVehicles: selectedIndices[availableHours].map(
      (index) => vehicles[index],
    ),
  };
}

async function runScheduler() {
  await Log("backend", "info", "service", "Scheduler started");

  const depotsData = await fetchData(DEPOT_API);
  const vehiclesData = await fetchData(VEHICLES_API);

  if (!depotsData || !vehiclesData) {
    await Log("backend", "fatal", "service", "API data missing");
    return;
  }

  const depots = depotsData.depots;
  const vehicles = vehiclesData.vehicles;

  await Log(
    "backend",
    "info",
    "service",
    `Data: ${depots.length}D, ${vehicles.length}V`,
  );

  for (const depot of depots) {
    const { ID, MechanicHours } = depot;
    await Log(
      "backend",
      "info",
      "service",
      `Proc Depot ${ID}: ${MechanicHours}h`,
    );

    const result = solveKnapsack(vehicles, MechanicHours);

    await Log(
      "backend",
      "info",
      "service",
      `D${ID} Res: Imp=${result.totalImpact}, V=${result.selectedVehicles.length}`,
    );
  }

  await Log("backend", "info", "service", "Scheduler finished");
}

runScheduler();
