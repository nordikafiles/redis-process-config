const sleep = require("sleep-promise");
const { Process } = require("./v2");

const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "my-app",
  brokers: ["localhost:9092"],
});

let p = Process.fromFunction(
  async ({ logger, setOnBeforeStop, stop }) => {
    logger.info("alala");
    setOnBeforeStop(() => {
      logger.info("blabla");
    });
    await sleep(5000);
    stop();
  },
  { kafka }
);

p.run();
