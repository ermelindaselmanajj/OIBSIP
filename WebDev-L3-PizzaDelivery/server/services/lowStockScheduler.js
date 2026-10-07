const cron = require("node-cron");
const { createLowStockChecker } = require("./lowStockAlerts");

function createLowStockScheduler({ scheduler = cron, check = createLowStockChecker(), logger = console } = {}) {
  let task;
  return {
    start(env = process.env) {
      if (task || env.LOW_STOCK_ALERTS_ENABLED === "false") return task;
      const expression = env.LOW_STOCK_CRON || "*/15 * * * *";
      if (!scheduler.validate(expression)) throw new Error("LOW_STOCK_CRON must be a valid cron expression");
      task = scheduler.schedule(expression, async () => {
        try { await check(); }
        catch { logger.error("Low-stock inventory check failed; it will retry on the next scheduled run."); }
      }, { name: "low-stock-alerts", timezone: "UTC", noOverlap: true });
      return task;
    },
    stop() {
      if (task) task.destroy();
      task = undefined;
    },
  };
}

module.exports = { createLowStockScheduler, lowStockScheduler: createLowStockScheduler() };
