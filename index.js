const redis = require('async-redis')
const sleep = require('sleep-promise')
const _ = require('lodash')

class RedisProcess {
    constructor (redisConfig = {}, { expTime = 5, keyPrefix = 'rprocesses' } = {}) {
        this.expTime = expTime
        this.keyPrefix = keyPrefix

        this.client = redis.createClient(redisConfig)

        this.id = null
        this.config = null

        this.heartbeatInterval = null
    }
    
    async takeConfig(initialStatus = {}) {
        if (this.id) {
            return this.config
        }
        this.status = initialStatus
        // take config
        while (true) {
            let res = await this.client.eval(`
                local process_config_keys = redis.call('KEYS', KEYS[1] .. ':*:config')
                local process_status_keys = redis.call('KEYS', KEYS[1] .. ':*:status')
                for i, config_key in ipairs(process_config_keys) do 
                    local status_key_found = false
                    for j, status_key in ipairs(process_status_keys) do
                        if status_key:gsub(':status', '') == config_key:gsub(':config', '') then
                            status_key_found = true
                        end
                    end
                    if config_key ~= nil and not status_key_found then
                        local process_id = config_key:gsub(':config', ''):gsub(KEYS[1] .. ':', '')
                        local config = redis.call('GET', config_key)
                        redis.call('SETEX', KEYS[1] .. ':' .. process_id .. ':status', KEYS[2], KEYS[3])
                        return {process_id, config}
                    end
                end
                return nil
            `, 3, this.keyPrefix, this.expTime, JSON.stringify(initialStatus))
            if (res) {
                let [id, config] = res
                this.id = id
                try {
                    this.config = JSON.parse(config)
                } catch (err) {
                    this.config = config
                }
                return this.startHeartbeat()
            }
            await sleep(this.expTime)
        }
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            await this.client.setex(`${this.keyPrefix}:${this.id}:status`, this.expTime, JSON.stringify(this.status))
        }, Math.floor(this.expTime * 1000 / 2))
    }

    async releaseConfig() {
        clearInterval(this.heartbeatInterval)
        await this.client.del(`${this.keyPrefix}:${this.id}:status`)
        this.id = null
        this.config = null
    }

    
}

class RedisProcessManager {
    constructor (redisConfig = {}, { keyPrefix = 'rprocesses' } = {}) {
        this.client = redis.createClient(redisConfig)
        this.keyPrefix = keyPrefix
    }

    async setConfig(id, value = {}) {
        let res = await this.client.eval(`
            local status = redis.call('EXISTS', KEYS[1] .. ':' .. KEYS[2] .. ':status')
            if status > 0 then
                return nil
            end
            redis.call('SET', KEYS[1] .. ':' .. KEYS[2] .. ':config', KEYS[3])
            return 1
        `, 3, this.keyPrefix, id, JSON.stringify(value))
        if (!res)
            throw new Error(`Can't change config because some process is using it`)
    }

    async removeConfig(id) {
        let res = await this.client.eval(`
            local status = redis.call('EXISTS', KEYS[1] .. ':' .. KEYS[2] .. ':status')
            if status == 0 then
                return redis.call('DEL', KEYS[1] .. ':' .. KEYS[2] .. ':config')
            end
            return nil
        `, 2, this.keyPrefix, id)
        if (!res)
            throw new Error(`Can't remove config because some process is using it`)
    }

    async listConfigs() {
        // return redis
        let res = await this.client.eval(`
            local config_keys = redis.call('KEYS', KEYS[1] .. ':*:config')
            if table.getn(config_keys) > 0 then 
                return {config_keys, redis.call('MGET', unpack(config_keys))}
            end
            return {{}, {}}
        `, 1, this.keyPrefix)
        res[0] = res[0].map(x => x.split(':')[1])
        res[1] = res[1].map(JSON.parse)
        return _.zipObject(res[0], res[1])
    }
}

module.exports = RedisProcess
module.exports.RedisProcessManager = RedisProcessManager