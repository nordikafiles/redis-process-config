const redisConfig = {
  host: "localhost",
  port: "6379",
  password:
    "w4n19JgMHsSyDVvxdPitMS60vXE1R6YaamQQh9VVazKLHCUS2dzDmu3sZlDbBvR9NEYIFiUF47bUOJBUZ5lU8LE4xX80yepWHizW",
};
const keyPrefix = "test_process";

const { ProcessManager } = require("..");
const sleep = require("sleep-promise");

module.exports = async ({ redisConfig, keyPrefix }) => {
  let manager = new ProcessManager({
    redisConfig,
    keyPrefix,
  });

  let configs = await manager.listConfigs();
  console.log({ configs });
  await manager.setConfig("alalaher", { blabla: "tralala" });
  configs = await manager.listConfigs();
  console.log({ configs });
  await sleep(3000);
  // try {
  //   await manager.removeConfig("alalaher");
  // } catch (err) {
  //   console.log(err.toString());
  //   await manager.removeConfig("alalaher", true);
  // }
  // configs = await manager.listConfigs();
  // console.log({ configs });
};

module.exports({ redisConfig, keyPrefix });
