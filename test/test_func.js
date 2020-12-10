const sleep = require("sleep-promise");

module.exports = async ({
  logger,
  setOnBeforeStop,
  setOnConsumerMessage,
  stop,
  config,
  publishMessage,
}) => {
  logger.info("starting");
  await sleep(1000);
  let i = 0;
  let timer;
  setOnBeforeStop(async () => {
    logger.info("stopping");
    clearInterval(timer);
    await sleep(2000);
    logger.info("stopped");
  });
  setOnConsumerMessage(({ topic, message }) => {
    console.log(topic.valueParsed, message.valueParsed);
  });
  logger.info("doing something");
  await publishMessage("alalaher", { test: "message" });
  await sleep(1000);
  logger.info("done");
  await sleep(1000);

  timer = setInterval(() => {
    logger.info(i++);
  }, 1000);

  // stop();
};

module.exports.config = {
  keyPrefix: "test_processes",
};
