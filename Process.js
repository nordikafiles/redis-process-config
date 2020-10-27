const EventEmitter = require("events");
const redis = require("async-redis");
const sleep = require("sleep-promise");
const _ = require("lodash");

class Process extends EventEmitter {
  constructor({
    redisConfig = {},
    expTime = 5,
    keyPrefix = "rprocesses",
    kafkaConfig = {},
  } = {}) {
    this.redisConfig = redisConfig;
    this.expTime = expTime;
    this.keyPrefix = keyPrefix;

    this.redisClient = redis.createClient(redisConfig);

    this.id = null;
    this.config = null;

    this.heartbeatInterval = null;

    this.status = "running";
  }

  async takeConfig() {
    if (this.id) {
      return this.config;
    }
    process.env.NODE_ENV == "debug" && console.debug("waiting for config");
    while (true) {
      let res = await this.client.eval(
        `
                local process_config_keys = redis.call('KEYS', KEYS[1] .. ':*:config')
                local process_status_keys = redis.call('KEYS', KEYS[1] .. ':*:status')
                for i, config_key in ipairs(process_config_keys) do 
                    local status_key_found = false
                    for j, status_key in ipairs(process_status_keys) do
                        if status_key:gsub(':status', '') == config_key:gsub(':config', '') then
                            status_key_found = true
                        end
                    end
                    if config_key ~= nil and not status_key_found then
                        local process_id = config_key:gsub(':config', ''):gsub(KEYS[1] .. ':', '')
                        local config = redis.call('GET', config_key)
                        redis.call('SETEX', KEYS[1] .. ':' .. process_id .. ':status', KEYS[2], KEYS[3])
                        return {process_id, config}
                    end
                end
                return nil
            `,
        3,
        this.keyPrefix,
        this.expTime,
        JSON.stringify(initialStatus)
      );
      if (res) {
        let [id, config] = res;
        this.id = id;
        try {
          this.config = JSON.parse(config);
        } catch (err) {
          this.config = config;
        }
        process.env.NODE_ENV == "debug" && console.debug("received config");
        this.startHeartbeat();
        return this.config;
      }
      await sleep(this.expTime);
    }
  }

  async heartbeat() {
    process.env.NODE_ENV == "debug" && console.debug("running setex...");
    await this.client.setex(
      `${this.keyPrefix}:${this.id}:status`,
      this.expTime,
      JSON.stringify(this.status)
    );
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {},
    Math.floor((this.expTime * 1000) / 2));
  }

  async releaseConfig() {
    process.env.NODE_ENV == "debug" &&
      console.debug("clearing heartbeat interval...");
    clearInterval(this.heartbeatInterval);
    process.env.NODE_ENV == "debug" && console.debug("deleting flag...");
    await this.client.del(`${this.keyPrefix}:${this.id}:status`);
    this.id = null;
    this.config = null;
  }

  async setStatus(newStatus) {
    this.status = newStatus;
    await this.heartbeat();
  }

  async init() {}

  async run() {
    try {
      await this.takeConfig();
      await this.init(this);
    } catch (err) {
      console.warn(`Can't initialize process!`, err);
      await this.releaseConfig();
    }
  }
}

module.exports = Process;
