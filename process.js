const EventEmitter = require("events");
const redis = require("async-redis");
const sleep = require("sleep-promise");
const _ = require("lodash");
const winston = require("winston");

const getKafkaLogCreator = require("./lib/get_kafka_log_creator");

const WinstonTransportKafka = require("./lib/winston_transport_kafka");
const WinstonTransportEvents = require("./lib/winston_transport_events");

const CONFIG = require("./config");
const { Kafka } = require("kafkajs");

let defaultKafkaInstance = null;

const createRedisClient = (config) => {
  let redisClient = redis.createClient(config);
  if (config.password) redisClient.auth(config.password);
  return redisClient;
};

class Process extends EventEmitter {
  constructor({
    redisConfig,
    expTime = 10,
    keyPrefix,
    kafka,
    consumerTopics = [],
    consumerGroupId = keyPrefix,
    localId = 0,
    logsTopic = keyPrefix + "_logs",
  } = {}) {
    super();

    this.redisConfig = redisConfig || CONFIG.redis;
    if (!this.redisConfig) throw new Error("redisConfig required!");

    this.keyPrefix = keyPrefix;
    if (!this.keyPrefix) throw new Error("keyPrefix required!");

    if (!kafka && !defaultKafkaInstance) {
      defaultKafkaInstance = new Kafka({
        ...CONFIG.kafka,
        logCreator: getKafkaLogCreator((message) =>
          this.emit("logMessage", {
            ...message,
            processId: this.id,
            localId: this.localId,
          })
        ),
      });
    }
    this.kafka = kafka || defaultKafkaInstance;
    if (!this.kafka) throw new Error("kafka required!");

    this.redisClient = createRedisClient(this.redisConfig);
    if (this.redisConfig.password)
      this.redisClient.auth(this.redisConfig.password);

    this.silentLoggers = {};

    this.expTime = expTime;
    this.consumerTopics = consumerTopics;
    this.consumerGroupId = consumerGroupId;
    this.logsTopic = logsTopic;
    this.localId = localId;

    this.id = null;
    this.config = null;
    this.heartbeatInterval = null;
    this.onBeforeStop = async () => {};
    this.onConsumerMessage = async ({ topic, partition, message }) => {};

    this.status = "running";
  }

  async takeConfig() {
    if (this.id) {
      return this.config;
    }
    this.logger.info("waiting for config...");
    for (let i = 0; ; i++) {
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
        this.logger.info("received config");
        this.startHeartbeat();
        await this.initControlSubscriber();
        await this.initProducer();
        await this.initConsumer();
        return this.config;
      }
      await sleep(this.expTime * 500);
      if (i * this.expTime * 500 > this.expTime * 1000)
        this.emit("configurationTimeout");
    }
  }

  async initControlSubscriber() {
    this.redisControlSubscriber = createRedisClient(this.redisConfig);
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
        this.logger.warn(`Can't process control message!`, err);
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
      if (topic.fromBeginning === undefined) topic.fromBeginning = true;
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
      groupId: this.consumerGroupId + this.id,
    });
    await this.consumer.connect();

    for (let topic of consumerTopics) {
      this.consumer.subscribe(topic);
    }
  }

  async runConsumer() {
    if (!this.consumer) return;
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
        this.logger.warn("heartbeat error", err);
      }
    }, Math.floor((this.expTime * 1000) / 2));
  }

  async releaseConfig() {
    if (!this.config) return;
    this.logger.debug("clearing heartbeat interval...");
    clearInterval(this.heartbeatInterval);
    if (typeof this.config == "object" && this.config.__deleteAfterStop)
      await this.redisClient.del(`${this.keyPrefix}:${this.id}:config`);
    process.env.NODE_ENV == "debug" && this.logger.debug("deleting flag...");
    await this.redisClient.del(`${this.keyPrefix}:${this.id}:status`);
    await this.redisControlSubscriber.quit();
    this.redisControlSubscriber = null;
    if (this.logger) await this.logger.close();
    await sleep(1000);
    if (this.producer) await this.producer.disconnect();
    if (this.consumer) await this.consumer.disconnect();
    this.producer = null;
    this.consumer = null;
    await this.initLogger();
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

  async run(restartOnError = true) {
    try {
      await this.initLogger();
      await this.takeConfig();
      await this.initLogger();
      await this.init(this);
      await this.runConsumer();
      this.emit("initialized", this.id);
    } catch (err) {
      this.logger.warn(`Can't initialize process! Error: ${err.message}`);
      await this.releaseConfig();
      this.emit("initializationError", err);
      if (restartOnError) {
        this.logger.info("\n\nRestarting process in 5s...\n\n");
        await sleep(5000);
        this.logger.info("\n\nRestarting process...\n\n");
        await this.run();
      }
    }
  }

  async initLogger() {
    if (this.logger) {
      await this.logger.close();
      this.logger = null;
    }
    let transports = [
      new winston.transports.Console({
        name: "stdout-logger",
        level: "info",
        format: winston.format.combine(
          winston.format.errors({ stack: true }),
          winston.format.timestamp(),
          winston.format.colorize(),
          // winston.format.prettyPrint(),
          winston.format.simple()
        ),
        silent: this.silentLoggers["stdout-logger"],
      }),

      new WinstonTransportEvents({
        onLogMessage: (message) => this.emit("logMessage", message),
        format: winston.format.combine(
          winston.format.errors({ stack: true }),
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.prettyPrint(),
          winston.format.simple()
        ),
      }),
    ];

    if (this.producer) {
      transports.push(
        new WinstonTransportKafka({
          topic: this.logsTopic,
          producer: this.producer,
          format: winston.format.combine(
            winston.format.errors({ stack: true }),
            winston.format.timestamp()
          ),
        })
      );
    }

    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.json(),
      defaultMeta: {
        keyPrefix: this.keyPrefix,
        processId: this.id,
        localId: this.localId,
      },

      transports,
    });
  }

  setOnBeforeStop(fn) {
    this.onBeforeStop = fn;
  }

  setOnConsumerMessage(fn) {
    this.onConsumerMessage = fn;
  }

  setSilentLogger(name = "stdout-logger", silent = true) {
    this.silentLoggers[name] = silent;
    if (!this.logger) return;
    let transport = this.logger.transports.find((x) => x.name == name);
    transport.silent = silent;
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
      this.logger.warn(`Can't release config!`, err);
    }
    this.stopping = false;
    this.emit("stopped", {});
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

  static multipleFromFunction(fn, options = {}, concurrent = 1) {
    return _.range(0, concurrent).map((localId) =>
      Process.fromFunction(fn, { localId, ...options })
    );
  }
}

module.exports = Process;
