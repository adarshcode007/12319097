import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_API =
  process.env.LOG_API || "http://4.224.186.213/evaluation-service/logs";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const LOG_FILE = path.join(__dirname, "app.log");

export const Log = async (stack, level, pkg, message) => {
  const payload = {
    stack: stack.toLowerCase(),
    level: level.toLowerCase(),
    package: pkg.toLowerCase(),
    message: message,
  };

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${stack.toUpperCase()}] [${level.toUpperCase()}] [${pkg.toUpperCase()}] ${message}\n`;

  try {
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (err) {}

  try {
    const response = await fetch(LOG_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { error: true, status: response.status };
    }

    return await response.json();
  } catch (error) {
    return { error: true, message: error.message };
  }
};
