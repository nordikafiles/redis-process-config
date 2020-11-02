const runProcess = require("./test_process");
const runManager = require("./test_manager");

const kafkaConfig = {
  clientId: "test_process",
  brokers: ["localhost:9092"],
};

const redisConfig = {
  host: "localhost",
  port: "6379",
  password:
    "w4n19JgMHsSyDVvxdPitMS60vXE1R6YaamQQh9VVazKLHCUS2dzDmu3sZlDbBvR9NEYIFiUF47bUOJBUZ5lU8LE4xX80yepWHizW",
};

const keyPrefix = "test_process";

runProcess({ kafkaConfig, keyPrefix });
runManager({ keyPrefix });
