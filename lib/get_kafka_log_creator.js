const { Kafka, logLevel } = require("kafkajs");

const toWinstonLogLevel = (level) => {
  switch (level) {
    case logLevel.ERROR:
    case logLevel.NOTHING:
      return "error";
    case logLevel.WARN:
      return "warn";
    case logLevel.INFO:
      return "info";
    case logLevel.DEBUG:
      return "debug";
  }
};

module.exports = (onLogMessage = () => {}) => {
  const LogCreator = (logLevel) => {
    return ({ namespace, level, label, log }) => {
      const { message, timestamp, broker, groupId } = log;
      onLogMessage({
        level: toWinstonLogLevel(level),
        message,
        timestamp,
        broker,
        groupId,
        namespace: `Kafka:${namespace}`,
        // extra,
      });
    };
  };
  return LogCreator;
};
