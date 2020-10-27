const RedisProcess = require(".");
const { RedisProcessManager } = require(".");
const sleep = require("sleep-promise");

const keyPrefix = "test_7vUUMQTrON";

let manager = new RedisProcessManager({}, { keyPrefix });

const assert = require("assert");

it("should work", async () => {
  let firstProcess = new RedisProcess({}, { keyPrefix, expTime: 2 });
  let secondProcess = new RedisProcess({}, { keyPrefix, expTime: 2 });

  await manager.setConfig("firstConfig", { foo: "bar" }, true);
  await firstProcess.takeConfig();
  assert.strictEqual(firstProcess.config.foo, "bar");

  await manager.setConfig("secondConfig", { foo: "bar" }, true);
  await secondProcess.takeConfig();
  assert.strictEqual(firstProcess.config.foo, "bar");

  assert.rejects(() => manager.setConfig("secondConfig", { foo: "bar" }));
  assert.rejects(() => manager.removeConfig("secondConfig"));

  await firstProcess.releaseConfig();
  await secondProcess.releaseConfig();

  await manager.removeConfig("firstConfig");
  await manager.removeConfig("secondConfig");

  let configs = await manager.listConfigs();
  assert.strictEqual(configs.length, 0);
});
