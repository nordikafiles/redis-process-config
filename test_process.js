const RedisProcess = require(".");

let process = new RedisProcess()

async function contentFunc () {
    await process.takeConfig()
    console.log({
        id: process.id,
        config: process.config
    })
}
contentFunc()