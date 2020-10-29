const sleep = require("sleep-promise");
module.exports = async ({ logger, setOnBeforeStop, stop, publishMessage }) => {
  logger.info("starting");
  await sleep(1000);
  setOnBeforeStop(async () => {
    logger.info("stopping");
    await sleep(1000);
    logger.info("stopped");
  });
  logger.info("doing something");
  await publishMessage("alalaher", { test: "message" });
  await sleep(1000);
  logger.info("done");
  await sleep(1000);
  stop();
};
