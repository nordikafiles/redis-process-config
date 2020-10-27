const EventEmitter = require("events");
const redis = require("async-redis");
const sleep = require("sleep-promise");
const _ = require("lodash");

class ProcessManager {
  constructor(redisConfig = {}, { keyPrefix = "rprocesses" } = {}) {
    this.client = redis.createClient(redisConfig);
    this.keyPrefix = keyPrefix;
  }

  async setConfig(id, value = {}, force = false) {
    if (force)
      return this.client.set(
        `${this.keyPrefix}:${id}:config`,
        JSON.stringify(value)
      );
    let res = await this.client.eval(
      `
            local status = redis.call('EXISTS', KEYS[1] .. ':' .. KEYS[2] .. ':status')
            if status > 0 then
                return nil
            end
            redis.call('SET', KEYS[1] .. ':' .. KEYS[2] .. ':config', KEYS[3])
            return 1
        `,
      3,
      this.keyPrefix,
      id,
      JSON.stringify(value)
    );
    if (!res)
      throw new Error(`Can't change config because some process is using it`);
  }

  async removeConfig(id, force = false) {
    if (force) return this.client.del(`${this.keyPrefix}:${id}:config`);
    let res = await this.client.eval(
      `
            local status = redis.call('EXISTS', KEYS[1] .. ':' .. KEYS[2] .. ':status')
            if status == 0 then
                return redis.call('DEL', KEYS[1] .. ':' .. KEYS[2] .. ':config')
            end
            return nil
        `,
      2,
      this.keyPrefix,
      id
    );
    if (!res)
      throw new Error(`Can't remove config because some process is using it`);
  }

  async listConfigs() {
    let res = await this.client.eval(
      `
            local config_keys = redis.call('KEYS', KEYS[1] .. ':*:config')
            local status_keys = {}
            for i, conf_key in ipairs(config_keys) do
                status_keys[i] = conf_key:gsub(':config', '') .. ':status'
            end
            if table.getn(config_keys) > 0 then 
                return {config_keys, redis.call('MGET', unpack(config_keys)), redis.call('MGET', unpack(status_keys))}
            end
            return {{}, {}, {}}
        `,
      1,
      this.keyPrefix
    );
    res[0] = res[0].map((x) => x.split(":")[1]);
    res[1] = res[1].map(JSON.parse);
    res[2] = res[2].map((x) => {
      try {
        return JSON.parse(x);
      } catch (err) {
        return null;
      }
    });
    return _.zip(...res).map(([id, config, status]) => ({
      id,
      config,
      status,
    }));
  }
}

module.exports = ProcessManager;
