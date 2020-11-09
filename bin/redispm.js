#!/usr/bin/env node
const path = require("path");
const { Observable } = require("rxjs");
const { Process } = require("../");
const Listr = require("listr");

const argv = require("yargs/yargs")(process.argv.slice(2)).command(
  "$0 <filename>",
  "run function",
  (yargs) => {
    return yargs
      .option("logs", {
        alias: "l",
        default: false,
        type: "boolean",
      })
      .option("number-of-concurrent", {
        alias: "n",
        default: 1,
        type: "number",
      });
  }
).argv;

const filename = path.resolve(argv.filename);
const func = require(filename);

if (typeof func != "function") throw new Error("File must export a function!");

let processes = Process.multipleFromFunction(
  func,
  undefined,
  argv.numberOfConcurrent
);

let allProcessesInitialized = false;
let logsBuffer = [];
const printLogs = () => {
  if (!allProcessesInitialized) return;
  for (let message of logsBuffer) {
    let level = message.level;
    delete message.level;
    let text = message.message;
    delete message.message;
    let timestamp = message.timestamp;
    delete message.timestamp;
    console.log(timestamp, level, text, JSON.stringify(message));
  }
  logsBuffer = [];
};

const tasks = new Listr(
  processes.map((p, ind) => ({
    title: `initializing process #${ind}...`,
    task: () => {
      try {
        p.setSilentLogger(undefined, true);
        p.run(false);
      } catch (err) {}
      return new Observable(async (subscriber) => {
        let initialized = false;
        const logMessageHandler = (logMessage) => {
          if (initialized) {
            logsBuffer.push(logMessage);
            printLogs();
            return;
          }
          subscriber.next(logMessage.message.toString());
        };
        const initializedHandler = () => {
          initialized = true;
          removeAllListeners();
          subscriber.complete();
        };
        const configurationTimeoutHandler = () => {
          removeAllListeners();
          subscriber.error(new Error("process will be initialized later"));
          // p.setSilentLogger(undefined, false);
        };
        const initializationErrorHandler = (err) => {
          initialized = true;
          removeAllListeners();
          subscriber.error(err);
          // p.setSilentLogger(undefined, false);
          p.run(true);
        };
        const removeAllListeners = () => {
          // p.off("logMessage", logMessageHandler);
          p.off("initialized", initializedHandler);
          p.off("initializationError", initializationErrorHandler);
          p.off("configurationTimeout", configurationTimeoutHandler);
        };

        p.on("logMessage", logMessageHandler);
        p.on("initialized", initializedHandler);
        p.on("initializationError", initializationErrorHandler);
        p.on("configurationTimeout", configurationTimeoutHandler);
      });
    },
  })),
  { concurrent: true, exitOnError: false }
);

const contentFunc = async () => {
  try {
    await tasks.run();
  } catch (err) {}
  allProcessesInitialized = true;
  printLogs();
};

contentFunc();

let numberOfSignals = 0;

process.on("SIGINT", async () => {
  if (numberOfSignals > 0) {
    console.log("Killing all processes...");
    return process.exit(1);
  }
  numberOfSignals++;
  allProcessesInitialized = false;
  console.log("\n\nReceived SIGINT. Safely stopping all processes...");
  let stopTasks = new Listr(
    processes.map((p) => ({
      title: `stopping ${p.id ? p.id : `#${p.localId}`}...`,
      task: () => {
        p.stop(false);
        return new Observable((subscriber) => {
          p.on("logMessage", (logMessage) => {
            subscriber.next(logMessage.message.toString());
          });
          p.on("stopped", () => subscriber.complete());
        });
      },
    })),
    { concurrent: true, exitOnError: false }
  );

  try {
    await stopTasks.run();
  } catch (err) {}
  process.exit(0);
});
