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

const myProcess = Process.from_function(require('./myFunc.js'), { redis, kafka, ... })

myProcess.run()
```

#todo

- process control: stop, restart, etc
- addSafeStopHook
- kafka logger
- kafkaPublisher
