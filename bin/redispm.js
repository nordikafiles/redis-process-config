#!/usr/bin/env node
const path = require("path");
const { Process } = require("../");

const filename = path.resolve(process.argv[2]);
const func = require(filename);

if (typeof func != "function") throw new Error("File must export a function!");

Process.multipleFromFunction(func).map((p) => p.run());
