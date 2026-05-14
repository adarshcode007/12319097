import dotenv from 'dotenv';
dotenv.config();

const LOG_API = process.env.LOG_API || 'http://4.224.186.213/evaluation-service/logs';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

/**
 * Mandatory Logging Middleware
 * Sends logs to the centralized test server.
 * 
 * @param {string} stack - 'backend' | 'frontend'
 * @param {string} level - 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 * @param {string} pkg - The package/module name (e.g., 'controller', 'db', 'middleware')
 * @param {string} message - Descriptive log message
 */
export const Log = async (stack, level, pkg, message) => {
    // Requirements specify lowercase for these fields
    const payload = {
        stack: stack.toLowerCase(),
        level: level.toLowerCase(),
        package: pkg.toLowerCase(),
        message: message
    };

    try {
        const response = await fetch(LOG_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            // Fallback console log if the logging service is down/unauthorized
            console.error(`[Logger Error] Failed to send log: ${response.status} - ${errorText}`);
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`[Logger Exception] ${error.message}`);
        return null;
    }
};
