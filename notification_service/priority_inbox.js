import dotenv from "dotenv";
import { Log } from "../logger.js";

dotenv.config();

const NOTIFICATIONS_API = process.env.NOTIFICATIONS_API;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const PRIORITY_WEIGHTS = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

async function fetchNotifications() {
  try {
    const response = await fetch(NOTIFICATIONS_API, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    if (!response.ok) {
      await Log(
        "backend",
        "error",
        "service",
        `N-Fetch Fail: ${response.status}`,
      );
      return null;
    }

    return await response.json();
  } catch (error) {
    await Log(
      "backend",
      "error",
      "service",
      `N-Fetch Exc: ${error.message.substring(0, 20)}`,
    );
    return null;
  }
}

/**
 * @param {Array} notifications - List of notification objects.
 * @param {number} limit - Number of top notifications to return.
 */
function getPriorityInbox(notifications, limit = 10) {
  return notifications
    .sort((a, b) => {
      const weightA = PRIORITY_WEIGHTS[a.Type] || 0;
      const weightB = PRIORITY_WEIGHTS[b.Type] || 0;

      if (weightA !== weightB) {
        return weightB - weightA;
      }

      return new Date(b.Timestamp) - new Date(a.Timestamp);
    })
    .slice(0, limit);
}

async function runPriorityInbox() {
  await Log("backend", "info", "service", "Priority Inbox started");

  const data = await fetchNotifications();

  if (!data || !data.notifications) {
    await Log("backend", "fatal", "service", "Notification data missing");
    return;
  }

  const notifications = data.notifications;
  await Log(
    "backend",
    "info",
    "service",
    `Fetched ${notifications.length} notifications`,
  );

  const top10 = getPriorityInbox(notifications, 10);

  for (let i = 0; i < top10.length; i++) {
    const n = top10[i];
    await Log(
      "backend",
      "info",
      "service",
      `P${i + 1}: [${n.Type}] ${n.Timestamp}`,
    );
  }

  await Log("backend", "info", "service", "Priority Inbox completed");
}

runPriorityInbox();
