const Transport = require("winston-transport");
const { MESSAGE } = require("triple-beam");
const _ = require("lodash");

module.exports = class Kafka extends Transport {
  constructor({ topic, producer, ...options }) {
    super(options);

    this.topic = topic;
    this.producer = producer;
  }

  async log(info, callback) {
    try {
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            value: JSON.stringify(info),
          },
        ],
      });
    } catch (err) {
      console.error("Failed to log to Kafka", err);
    }
    if (callback) callback();
  }
};
