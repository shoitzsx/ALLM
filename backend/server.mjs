import http from 'node:http'
import { createApp } from './app.mjs'

const { handle, env } = await createApp()

http.createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', env.corsOrigin); handle(req, res) }).listen(env.port, env.host, () => console.log(`ALM API em http://${env.host}:${env.port}/api/v1`))
