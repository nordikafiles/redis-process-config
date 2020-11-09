const Transport = require("winston-transport");
const { MESSAGE } = require("triple-beam");
const _ = require("lodash");

module.exports = class Events extends Transport {
  constructor({ onLogMessage = () => {}, ...options }) {
    super(options);

    this.onLogMessage = onLogMessage;
  }

  async log(info, callback) {
    try {
      await this.onLogMessage(info);
    } catch (err) {
      console.error("Failed to call onLogMessage", err);
    }
    if (callback) callback();
  }
};
