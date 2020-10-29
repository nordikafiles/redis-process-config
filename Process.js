const EventEmitter = require("events");
const redis = require("async-redis");
const sleep = require("sleep-promise");
const _ = require("lodash");
const winston = require("winston");
const { Kafka } = require("kafkajs");

const CONFIG = require("./config");

const WinstonTransportKafka = require("./lib/WinstonTransportKafka");

class Process extends EventEmitter {
  constructor({
    redisConfig,
    expTime,
    keyPrefix,
    logsTopic,
    kafka,
    consumerTopics = [],
    consumerGroupId = ({ keyPrefix, id, config }) => `${keyPrefix}-${id}`,
    localId = 0,
  } = {}) {
    super();
    this.redisConfig = redisConfig || CONFIG.redis;
    this.expTime = expTime || CONFIG.process.expTime;
    this.keyPrefix = keyPrefix || CONFIG.process.keyPrefix;

    this.redisClient = redis.createClient(redisConfig);

    this.id = null;
    this.config = null;

    this.heartbeatInterval = null;

    this.status = "running";

    this.onBeforeStop = async () => {};
    this.onConsumerMessage = async ({ topic, partition, message }) => {};

    this.consumerTopics = consumerTopics;
    this.consumerGroupId = consumerGroupId;

    this.kafka = kafka || new Kafka(CONFIG.kafka);
    this.logsTopic = logsTopic || CONFIG.process.logsTopic;

    this.localId = localId;
  }

  async takeConfig() {
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
        this.startHeartbeat();
        await this.initControlSubscriber();
        await this.initProducer();
        await this.initConsumer();
        return this.config;
      }
      await sleep(this.expTime);
    }
  }

  async initControlSubscriber() {
    this.redisControlSubscriber = redis.createClient(this.redisConfig);
    await this.redisControlSubscriber.subscribe(
      `${this.keyPrefix}:${this.id}:control`
    );
    this.redisControlSubscriber.on("message", (channel, message) => {
      try {
        let data = JSON.parse(message);
        let { type } = data;
        this.emit("controlMessage", data);
        if (type == "stop") this.stop();
      } catch (err) {
        console.warn(`Can't process control message!`, err);
      }
    });
  }

  async initProducer() {
    this.producer = this.kafka.producer();
    await this.producer.connect();
  }

  async initConsumer() {
    if (this.consumerTopics.length == 0) return;
    const consumerTopics = this.consumerTopics.map((topic) => {
      if (typeof topic == "string") topic = { topic };
      return topic;
    });

    const admin = this.kafka.admin();
    await admin.connect();
    let createdTopics = await admin.listTopics();
    await admin.createTopics({
      topics: consumerTopics.filter(
        ({ topic }) => !createdTopics.includes(topic)
      ),
    });
    await admin.disconnect();

    this.consumer = this.kafka.consumer({
      groupId: this.consumerGroupId(this),
    });
    await this.consumer.connect();
    for (let topic of consumerTopics) {
      this.consumer.subscribe(topic);
    }
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        Object.defineProperty(message, "valueParsed", {
          get() {
            let res = this.value;
            try {
              res = JSON.parse(res);
            } catch (err) {}
            return res;
          },
        });
        await this.onConsumerMessage({
          topic,
          partition,
          message,
        });
      },
    });
  }

  async publishMessage(topic, messages = [], headers = {}) {
    if (!Array.isArray(messages)) messages = [messages];
    return this.producer.send({
      topic,
      messages: messages.map((x) => ({
        value: JSON.stringify(x),
        headers,
      })),
    });
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
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.heartbeat();
      } catch (err) {
        console.warn("heartbeat error", err);
      }
    }, Math.floor((this.expTime * 1000) / 2));
  }

  async releaseConfig() {
    process.env.NODE_ENV == "debug" &&
      console.debug("clearing heartbeat interval...");
    clearInterval(this.heartbeatInterval);
    process.env.NODE_ENV == "debug" && console.debug("deleting flag...");
    await this.redisClient.del(`${this.keyPrefix}:${this.id}:status`);
    await this.redisControlSubscriber.quit();
    this.redisControlSubscriber = null;
    if (this.producer) await this.producer.disconnect();
    if (this.consumer) await this.consumer.disconnect();
    this.producer = null;
    this.consumer = null;
    await this.logger.close();
    this.logger = null;
    this.id = null;
    this.config = null;
  }

  async setStatus(newStatus) {
    this.status = newStatus;
    await this.heartbeat();
  }

  async init(p) {
    this.logger.info("test");
    this.logger.warn("test warning");
  }

  async run() {
    try {
      await this.takeConfig();
      this.logger = winston.createLogger({
        level: "info",
        format: winston.format.json(),
        defaultMeta: {
          keyPrefix: this.keyPrefix,
          processId: this.id,
          localId: this.localId,
        },

        transports: [
          new winston.transports.Console({
            level: "info",
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.colorize(),
              // winston.format.prettyPrint(),
              winston.format.simple()
            ),
          }),
          new WinstonTransportKafka({
            topic: this.logsTopic,
            producer: this.producer,
            format: winston.format.combine(winston.format.timestamp()),
          }),
        ],
      });
      await this.init(this);
    } catch (err) {
      console.log(err);
      this.logger.warn(`Can't initialize process!`, err);
      await this.releaseConfig();
    }
  }

  setOnBeforeStop(fn) {
    this.onBeforeStop = fn;
  }

  setOnConsumerMessage(fn) {
    this.onConsumerMessage = fn;
  }

  async stop(restart = true) {
    if (this.stopping) return;
    this.stopping = true;
    try {
      await this.onBeforeStop();
    } catch (err) {
      this.stopping = false;
      this.logger.warn(`Error when onBeforeStop`, err);
    }
    try {
      await this.releaseConfig();
    } catch (err) {
      console.warn(`Can't release config!`, err);
    }
    this.stopping = false;
    if (restart) await this.run();
  }

  static fromFunction(fn, options = {}) {
    let fnOptions = fn.config || {};
    let p = new Process({ ...options, ...fnOptions });
    let methods = {};
    for (let methodName of Object.getOwnPropertyNames(Process.prototype)) {
      methods[methodName] = Process.prototype[methodName].bind(p);
    }

    p.init = () => fn({ ...methods, ...p });
    return p;
  }

  static multipleFromFunction(
    fn,
    options = {},
    concurrent = CONFIG.concurrent
  ) {
    return _.range(0, concurrent).map((localId) =>
      Process.fromFunction(fn, { localId, ...options })
    );
  }
}

module.exports = Process;
