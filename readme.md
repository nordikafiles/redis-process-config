# Usage

```js
module.exports = async ({ logger, config, id, releaseConfig, kafkaPublisher, setOnBeforeStop, kafka, producer }) => {
  logger.info('got config', config)
  wsConnection.on('message', (message) => {
    kafkaPublisher.send('newitems_go', message)
  })
  // await producer.send()
  const consumer = kafka.consumer()
  await consumer.connect()
  setOnBeforeStop(() => {
    await consumer.disconnect()
    await stopSomething()
  })
}

const myProcess = Process.fromFunction(require('./myFunc.js'), { redis, kafka, ... })

myProcess.run()
```

**todo**

- process control:
  - stop and remove config `done`
  - stop `done`
  - restart `done`
  - etc
- setOnBeforeStop `done`
- kafka logger `done`
- kafkaPublisher `done`
- fromFunction `done`

**events**

- controlMessage `done`
