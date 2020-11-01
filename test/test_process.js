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
const consumerTopics = ["alala", "tset_process_logs"];

const { Process } = require("..");
const testFunction = require("./test_func.js");

const { Kafka } = require("kafkajs");

module.exports = ({ kafkaConfig, keyPrefix, redisConfig }) => {
  const kafka = new Kafka(kafkaConfig);
  let ps = Process.multipleFromFunction(
    testFunction,
    {
      kafka,
      keyPrefix,
      redisConfig,
      consumerTopics,
    },
    1
  );

  for (let p of ps) {
    p.run();
  }
};

module.exports({ kafkaConfig, keyPrefix, redisConfig });
