const sleep = require("sleep-promise");
module.exports = async ({ logger, setOnBeforeStop, stop, publishMessage }) => {
  logger.info("alala");
  setOnBeforeStop(() => {
    logger.info("blabla");
  });
  await publishMessage("alalaher", { test: "message" });
  await sleep(5000);
  stop();
};
