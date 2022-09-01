import  { Server } from 'http'
import { WebSocketServer } from 'ws'
import * as map from 'lib0/map'
import fs from 'fs'
import { resolve } from 'path'
import express from 'express'
import { createServer } from 'vite'

const PORT = process.env.PORT || 4444
const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1
const wsReadyStateClosing = 2
const wsReadyStateClosed = 3 
const pingTimeout = 30000
const topics = new Map()

const wss = new WebSocketServer({ noServer: true })

const send = (conn, message) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    conn.close()
  }
  try {
    conn.send(JSON.stringify(message))
  } catch (e) {
    conn.close()
  }
}

const onConnection = conn => {
  /**
   * @type {Set<string>}
   */
  const subscribedTopics = new Set()
  let closed = false
  // Check if connection is still alive
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close()
      clearInterval(pingInterval)
    } else {
      pongReceived = false
      try {
        conn.ping()
      } catch (e) {
        conn.close()
      }
    }
  }, pingTimeout)
  conn.on('pong', () => {
    pongReceived = true
  })
  conn.on('close', () => {
    subscribedTopics.forEach(topicName => {
      const subs = topics.get(topicName) || new Set()
      subs.delete(conn)
      if (subs.size === 0) {
        topics.delete(topicName)
      }
    })
    subscribedTopics.clear()
    closed = true
  })
  conn.on('message', /** @param {object} message */ message => {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }
    if (message && message.type && !closed) {
      switch (message.type) {
        case 'subscribe':
          /** @type {Array<string>} */ (message.topics || []).forEach(topicName => {
          if (typeof topicName === 'string') {
            // add conn to topic
            const topic = map.setIfUndefined(topics, topicName, () => new Set())
            topic.add(conn)
            // add topic to conn
            subscribedTopics.add(topicName)
          }
        })
          break
        case 'unsubscribe':
          /** @type {Array<string>} */ (message.topics || []).forEach(topicName => {
          const subs = topics.get(topicName)
          if (subs) {
            subs.delete(conn)
          }
        })
          break
        case 'publish':
          if (message.topic) {
            const receivers = topics.get(message.topic)
            if (receivers) {
              receivers.forEach(receiver =>
                send(receiver, message)
              )
            }
          }
          break
        case 'ping':
          send(conn, { type: 'pong' })
      }
    }
  })
}

async function start(root = process.cwd()) {
  const app = express();
  const server = Server(app)

  wss.on('connection', onConnection)

  /**
   * @type {import('vite').ViteDevServer}
   */
  const vite = await createServer({
    root,
    logLevel: 'info',
    server: {
      middlewareMode: true,
      watch: {
        // During tests we edit the files too fast and sometimes chokidar
        // misses change events, so enforce polling for consistency
        usePolling: true,
        interval: 100,
      },
    },
  });

  // use vite's connect instance as middleware
  app.use(vite.middlewares);

  app.use('*', async (req, res) => {

    const template = fs.readFileSync(
      resolve('./index.html'),
      'utf-8'
    );

    res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
  });

  return { app, server, vite };
}

start().then(({ server }) => {
  server.on('upgrade', (request, socket, head) => {
    // You may check auth of request here..
    /**
     * @param {any} ws
     */
    const handleAuth = ws => {
      wss.emit('connection', ws, request)
    }
    wss.handleUpgrade(request, socket, head, handleAuth)
  })
  server.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
  })
});
