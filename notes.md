```js
module.exports = async ({ logger, config, id, releaseConfig, kafkaPublisher, setOnBeforeStop }) => {
  logger.info('got config', config)
  wsConnection.on('message', (message) => {
    kafkaPublisher.send('newitems_go', message)
  })
  setOnBeforeStop(() => {
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
- fromFunction

**events**

- controlMessage `done`
