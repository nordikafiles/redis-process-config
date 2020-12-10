const os = require("os");

module.exports = {
  kafka: {
    clientId:
      process.env.PROCESS_KAFKA_CLIENT_ID ||
      `redis-process-${os.hostname()}-${process.pid}`,
    brokers: (process.env.KAFKA_BROKERS || "localhost:9092")
      .split(",")
      .map((x) => x.trim()),
    // logLevel: "ERROR",
  },
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || "6379",
  },
  concurrent: process.env.NUMBER_OF_CONCURRENT_PROCESSES
    ? parseInt(process.env.NUMBER_OF_CONCURRENT_PROCESSES)
    : 2,
};
