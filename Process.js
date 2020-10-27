const EventEmitter = require("events");
const redis = require("async-redis");
const sleep = require("sleep-promise");
const _ = require("lodash");
const winston = require("winston");
const { Kafka } = require("kafkajs");

const WinstonTransportKafka = require("./lib/WinstonTransportKafka");

class Process extends EventEmitter {
  constructor({
    redisConfig = {},
    expTime = 5,
    keyPrefix = "rprocesses",
    logsTopic = "process-logs",
    kafka,
  } = {}) {
    super();
    this.redisConfig = redisConfig;
    this.expTime = expTime;
    this.keyPrefix = keyPrefix;

    this.redisClient = redis.createClient(redisConfig);
    this.redisControlSubscriber = redis.createClient(redisConfig);

    this.id = null;
    this.config = null;

    this.heartbeatInterval = null;

    this.status = "running";

    this.onBeforeStop = async () => {};

    this.kafka = kafka;
    this.logsTopic = logsTopic;
  }

  async takeConfig() {
    if (this.isNotUsable)
      throw new Error("Process instance is not usable anymore");
    if (this.id) {
      return this.config;
    }
    process.env.NODE_ENV == "debug" && console.debug("waiting for config");
    while (true) {
      let res = await this.redisClient.eval(
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
        JSON.stringify(this.status)
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
        await this.initControlSubscriber();
        this.startHeartbeat();
        return this.config;
      }
      await sleep(this.expTime);
    }
  }

  async initControlSubscriber() {
    await this.redisControlSubscriber.subscribe(
      `${this.keyPrefix}:${this.id}:control`
    );
    this.redisControlSubscriber.on("message", (channel, message) => {
      try {
        let data = JSON.parse(message);
        let { type } = data;
        if (type == "stop") this.stop();
      } catch (err) {
        console.warn(`Can't process control message!`, err);
      }
    });
  }

  async initProducer() {
    this.producer = kafka.producer();
    await this.producer.connect();
  }

  async heartbeat() {
    process.env.NODE_ENV == "debug" && console.debug("running setex...");
    await this.redisClient.setex(
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
    await this.redisClient.del(`${this.keyPrefix}:${this.id}:status`);
    await this.redisControlSubscriber.quit();
    await this.redisClient.quit();
    await this.producer.disconnect();
    this.id = null;
    this.config = null;
    this.isNotUsable = true;
  }

  async setStatus(newStatus) {
    this.status = newStatus;
    await this.heartbeat();
  }

  async init({ logger, releaseConfig }) {
    this.logger.info("test");
    this.logger.warn("test warning");
  }

  async run() {
    try {
      await this.takeConfig();
      this.logger = winston.createLogger({
        level: "info",
        format: winston.format.json(),
        defaultMeta: { processId: this.id },

        transports: [
          new winston.transports.Console({
            level: "info",
            format: winston.format.combine(
              winston.format.simple(),
              winston.format.colorize()
            ),
          }),
          new WinstonTransportKafka({
            topic: this.logsTopic,
            producer: this.producer,
          }),
        ],
      });
      await this.init(this);
    } catch (err) {
      logger.warn(`Can't initialize process!`, err);
      await this.releaseConfig();
    }
  }

  setOnBeforeStop(fn) {
    this.onBeforeStop = fn;
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    try {
      await this.onBeforeStop();
    } catch (err) {
      this.stopping = false;
      logger.warn(`Error when onBeforeStop`, err);
    }
    try {
      await this.releaseConfig();
    } catch (err) {
      console.warn(`Can't release config!`, err);
    }
  }
}

module.exports = Process;
