#!/usr/bin/env node
const path = require("path");
const { Observable } = require("rxjs");
const { Process } = require("../");
const Listr = require("listr");
const chalk = require("chalk");

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
      })
      .option("pretty", {
        default: false,
        type: "boolean",
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
    let processId = message.processId;
    delete message.processId;
    let localId = message.localId;
    delete message.localId;
    console.log(
      chalk.gray(timestamp),
      chalk.inverse(
        (processId ? ` ${processId} ` : ` LID: ${localId} `).toString()
      ),
      level,
      text,
      chalk.grey(JSON.stringify(message))
    );
  }
  logsBuffer = [];
};

const listrArgs = processes.map((p, ind) => ({
  title: `initializing process #${ind}...`,
  task: () => {
    try {
      p.setSilentLogger(undefined, true);
      p.run(false);
    } catch (err) {}
    return new Observable(async (subscriber) => {
      let initialized = false;
      const logMessageHandler = (logMessage) => {
        logsBuffer.push(logMessage);
        if (initialized || !argv.pretty) {
          printLogs();
          return;
        }
        subscriber.next(
          ((logMessage.message && logMessage.message) || logMessage).toString()
        );
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
}));

const tasks = new Listr(listrArgs, { concurrent: true, exitOnError: false });

const contentFunc = async () => {
  if (argv.pretty) {
    try {
      await tasks.run();
    } catch (err) {}
    allProcessesInitialized = true;
  } else {
    allProcessesInitialized = true;
    listrArgs.map(async (x) => {
      try {
        await x.task().toPromise();
      } catch (err) {
        logsBuffer.push({
          level: "warn",
          localId: "redispm",
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        printLogs();
      }
    });
  }
  printLogs();
};

contentFunc();

let numberOfSignals = 0;

process.on("SIGINT", async () => {
  allProcessesInitialized = true;
  if (numberOfSignals > 2) {
    logsBuffer.push({
      level: "warn",
      localId: "redispm",
      message: "Killing all processes...",
      timestamp: new Date().toISOString(),
    });
    return process.exit(1);
  }
  numberOfSignals++;
  logsBuffer.push({
    level: "warn",
    localId: "redispm",
    message: "Received SIGINT. Safely stopping all processes...",
    timestamp: new Date().toISOString(),
  });
  printLogs();
  if (argv.pretty) {
    allProcessesInitialized = false;
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
  } else {
    await Promise.all(
      processes.map(
        (p) =>
          new Promise((resolve, reject) => {
            p.stop(false);
            p.on("stopped", resolve);
          })
      )
    );
    process.exit(0);
  }
});
