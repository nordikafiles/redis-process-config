const sleep = require("sleep-promise");
const { Process } = require(".");

const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "my-app",
  brokers: ["localhost:9092"],
});

let ps = Process.multipleFromFunction(require("./test_func.js"), { kafka });

for (let p of ps) {
  p.run();
}
