const sleep = require("sleep-promise");
const { Process } = require(".");

const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "my-app",
  brokers: ["localhost:9092"],
});

let ps = Process.multipleFromFunction(
  async ({ logger, setOnBeforeStop, stop, publishMessage }) => {
    logger.info("alala");
    setOnBeforeStop(() => {
      logger.info("blabla");
    });
    await publishMessage("alalaher", { test: "message" });
    await sleep(5000);
    stop();
  },
  { kafka }
);

for (let p of ps) {
  p.run();
}
