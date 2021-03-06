'use strict'
// 定义进程标题
process.title = 'ddvServerPorxy'
// jsnet模块-子线程模块
const worker = require('ddv-worker')
// http模块
const net = require('net')
const parseRequest = require('ddv-worker/parseRequest')
// domain模块
const domain = require('domain')

const fs = require('fs')
const resolve = require('path').resolve

const siteRootPath = resolve('.', './')
const siteConfigFile = resolve(siteRootPath, 'site.config.js')
const options = Object.create(null)
if (fs.existsSync(siteConfigFile)) {
  Object.assign(options, require(siteConfigFile))
}

worker.updateServerConf({
  defaultListen: Boolean(options.defaultListen),
  listen: Array.isArray(options.listen) ? options.listen : [],
  cpuLen: options.cpuLen || 1
}, e => {
  if (e) {
    console.log('The proxy listener configuration update was failed!')
  } else {
    console.log('The proxy listener configuration update was successful!')
  }
})

worker.DEBUG = options.debug = options.debug || process.env.NODE_ENV === 'development'

worker.on('socket::error', function (e) {
  console.error('Socket error started')
  console.error(e)
  console.error('Socket error end')
  console.error(Error().stack)
})
worker.on('server::error', function (e) {
  console.error('Server internal error started')
  console.error(e)
  console.error('Server internal error ended')
  console.error(Error().stack)
})

// 建立监听作用域
// 创建httpServer - 也就是创建http服务 传入回调
worker.server = domain.create()
worker.server.setTimeout = function () {

}
worker.server.on('connection', function (socket) {
  worker.server.run(() => {
    worker.server.newConnection.call(this, socket)
  })
})
worker.server.on('error', function onError (e) {
  worker.emit('error', e)
})
worker.server.newConnection = function newConnection (socket) {
  var porxyOptions = Object.assign({}, options.porxy)
  var dataBuf = new Buffer(0)
  var onData = function onData (buf) {
    if (buf && buf.length > 0) {
      dataBuf = Buffer.concat([dataBuf, buf])
    }
    buf = void 0
  }
  var newProxy = domain.create()
  newProxy.add(onData)
  newProxy.on('error', e => {
    socket.end('error')
  })
  newProxy.run(() => {
    socket.on('data', onData)
    socket.pause()
    process.nextTick(() => {
      if (!(porxyOptions.host && porxyOptions.port)) {
        let headers = parseRequest(dataBuf)
        /*
         从请求头部取得请求详细信息
         如果是 CONNECT 方法，那么会返回 { method,host,port,httpVersion}
         如果是 GET/POST 方法，那么返回 { metod,host,port,path,httpVersion}
        */
        porxyOptions.host = porxyOptions.host || headers.host || porxyOptions.host
        porxyOptions.port = porxyOptions.port || headers.port || porxyOptions.port || 80
        if (!(porxyOptions.host && porxyOptions.port)) {
          socket.end('not find host')
          return
        }
      }
      var serverProxy = net.connect(porxyOptions)
      serverProxy.on('connect', function connect () {
        serverProxy.on('error', function (e) {
          console.error('serverProxy内部错误', e)
        })
        socket.on('error', function (e) {
          console.error('socket内部错误', e)
        })
        socket.pipe(serverProxy).pipe(socket)
        serverProxy.resume()
        socket.emit('data', dataBuf)
        socket.removeListener('data', onData)
        dataBuf = void 0
        socket.resume()
        serverProxy = socket = void 0
      })
    })
  })
}
