#!/usr/bin/env node
const path = require("path");
const { Process } = require("../");

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
).map((p) => {
  p.run();
  return p;
});

let numberOfSignals = 0;

process.on("SIGINT", async () => {
  if (numberOfSignals > 0) {
    console.log("Killing all processes...");
    return process.exit(1);
  }
  numberOfSignals++;
  console.log("\n\nReceived SIGINT. Safely stopping all processes...");
  // processes = processes.filter((p) => !!p.id);
  for (let p of processes) {
    // p.spinner = ora(`safely stopping ${p.id}...`).start();
    // p.spinner.id = p.id;
  }
  await Promise.all(
    processes.map(async (p) => {
      try {
        await p.stop(false, true);
        // p.spinner.succeed(`stopped ${p.spinner.id}`);
      } catch (err) {
        // p.spinner.fail(`failed to safely stop ${p.spinner.id}`);
      }
    })
  );
  process.exit(0);
});
