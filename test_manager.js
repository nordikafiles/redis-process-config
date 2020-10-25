const RedisProcess = require(".");
const { RedisProcessManager } = require(".");
const sleep = require('sleep-promise')

let manager = new RedisProcessManager()

async function contentFunc () {
    // await process.takeConfig()
    // console.log({
    //     id: process.id,
    //     config: process.config
    // })
    await manager.setConfig('alalaher', { blabla: 'tralala' })
    let configs = await manager.listConfigs()
    console.log({ configs })
    await sleep(3000)
    await manager.removeConfig('alalaher')
    configs = await manager.listConfigs()
    console.log({ configs })
}
contentFunc()