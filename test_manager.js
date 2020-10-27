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
    let configs = await manager.listConfigs()
    console.log({ configs })
    await manager.setConfig('alalaher', { blabla: 'tralala' })
    configs = await manager.listConfigs()
    console.log({ configs })
    await sleep(3000)
    try {

        await manager.removeConfig('alalaher')
    } catch (err) {
        console.log(err.toString())
        await manager.removeConfig('alalaher', true)
    }
    configs = await manager.listConfigs()
    console.log({ configs })
}
contentFunc()