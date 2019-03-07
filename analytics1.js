/**
 * 数据埋点
 */
export default class eventTrack {
  constructor (option) {
    this.option = Object.assign({
      url: 'https://api.djigo.com/api/test',
      maxLogNum: 10,
      stayTime: 2000, // ms, 页面由隐藏变为可见，并且自上次用户交互之后足够久，可以视为新pv的时间间隔
      timeout: 2000   // 页面切换间隔，小于多少ms不算间隔
    }, option)
    this.hiddenTime = Date.now()
    this.url = this.option.url
    this.maxLogNum = this.option.maxLogNum
    this.logs = []

    // 拓展analytics，允许单个上报
    this.analytics['head'] = (action, params) => {
      return this.sendByHead(action, params)
    }
    this.analytics['post'] = (action, params) => {
      return this.sendByPost(action, params)
    }

    this.sendPV = this.delay((args) => {
      console.log(`hash间隔${this.option.timeout}发送pageview`)
      this.analytics({action: 'pageview', ...args})
    })

    window.addEventListener('hashchange', () => {
      console.log('hash变更为：', location.hash)
      this.sendPV()
    })
    this.sendPV()

    // 监听页面可见性
    document.addEventListener('visibilitychange', () => {
      console.log('页面可见状态为：', document.visibilityState)
      if (document.visibilityState === 'visible' && (Date.now() - this.hiddenTime > this.option.stayTime)) {
        this.analytics('re-open')
        console.log(`页面可见${this.option.stayTime}ms后发送pv成功`)
      } else if (document.visibilityState === 'hidden') {
        this.hiddenTime = Date.now()
      }
    })

    // 监听unload事件，
    window.addEventListener('beforeunload', this.unloadHandler.bind(this), false)
  }

  delay (func, time) {
    let t = 0
    let self = this
    return function (...args) {
      clearTimeout(t)
      t = setTimeout(func.bind(this, args), time || self.option.timeout)
    }
  }

  /**
   * 收集日志，等待集满 maxLogNum 数量后上传
   * @param  {string} 埋点行为
   * @param  {object} 埋点附带数据
   */
  analytics (action = 'pageview', params) {
    this.logs.push(JSON.stringify(Object.assign({
      action,
      timeStamp: Date.now()
    }, params)))
    if (this.logs.length >= this.maxLogNum) {
      this.sendInPack(this.logs)
      this.logs = []
    }
  }

  /**
   * 批量上报一个日志数组
   * @param  {array} logs 日志数组
   * @param  {boolean} sync 是否同步
   */
  sendInPack (logs, sync) {
    if (navigator.onLine) {
      console.log('触发上报，数据为：', logs)
      this.sendMultiData(logs, sync)
      this.sendStorageData()
    } else {
      console.log('当前无网络，数据已暂存，为：', logs)
      this.storageData(logs)
    }
  }
  sendMultiData (logs, sync) {
    let xhr = new XMLHttpRequest()
    let data = new FormData()
    for (var i = logs.length; i--;) {
      data.append('logs', logs[i])
    }
    xhr.open('POST', this.url, !sync)
    xhr.send(data)
  }
  storageData (logs) {
    let data = JSON.stringify(logs)
    let before = localStorage['analytics_logs']
    if (before) {
      data = before.replace(']', ',') + data.replace('[', '')
    }
    localStorage.setItem('analytics_logs', data)
  }
  sendStorageData () {
    let data = localStorage['analytics_logs']
    if (!data) return
    data = JSON.parse(data)
    this.sendMultiData(data)
    localStorage['analytics_logs'] = ''
    console.log('上报暂存数据，数据为：', data)
  }
  /**
   * POST上报单个日志
   * @param  {string} 埋点类型事件
   * @param  {object} 埋点附加参数
   */
  sendByPost (action, params) {
    let xhr = new XMLHttpRequest()
    let data = new FormData()
    data.append('action', action)
    for (let obj in params) {
      data.append(obj, params[obj])
    }
    xhr.open('POST', this.url)
    xhr.send(data)
    console.log('sendByPost success')
  }

  /**
   * Head上报单个日志
   * @param  {string} 埋点类型事件
   * @param  {object} 埋点附加参数
   */
  sendByHead (action, params) {
    let str = ''
    for (let key in params) {
      str += `&${key}=${params[key]}`
    }
    fetch(`https://www.baidu.com?action=${action}&timestamp=${Date.now()}${str}`, {method: 'head'})
    console.log('sendByHead success')
  }

  /**
   * unload事件触发时，执行的上报事件
   */
  unloadHandler () {
    if (navigator.sendBeacon) {
      let data = new FormData()
      for (var i = this.logs.length; i--;) {
        data.append('logs', this.logs[i])
      }
      navigator.sendBeacon(this.url, data)
    } else {
      this.sendInPack(this.logs, true)
    }
  }
}
