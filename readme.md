

设计和封装一个前端埋点上报脚本， 并逐步思考优化这个过程。<br>

主要内容：
* 请求的方式：简洁(fetch) | 高效(head) | 通用(post)
* 批量打包上报
* 无网络延时上报
* 更好的pv: visibilitychange
* 更好的pv: 单页应用hash监听

 作用:
- 统计平台服务端若只提供上报接口，对于前端如何封装数据上报可以借鉴
- 使用第三方分析平台的api的话，可以思考能否优化和封装
- 不是规范，侧重想法

final code：[analytics.js](https://github.com/kimyLee/analytics)
### 请求的方式：简洁|高效|通用
我们先用最直接的方式来实现这个埋点上报脚本。<br>
创建文件并命名为 analytics.js, 在脚本里面添加一个请求，稍微包一下：
``` javascript
export default function analytics (action = 'pageview') {
  var xhr = new XMLHttpRequest()
  let uploadUrl = `https://xxx/test_upload?action=${action}&timestamp=${Date.now()}`
  xhr.open('GET', uploadUrl, true)
  xhr.send()
}
```
这样子就能通过调用`analytics()`，往我们的统计服务端提交一条消息，并指明一个行为类型。<br>
如果我们需要上报的数据确实不多，如只需要‘行为/事件’，‘时间’，‘用户（id）’,‘平台环境’等，并且数据量在浏览器支持的url长度限制内，那我们可以用简化下这个请求：
``` javascript
// 简洁的方式
export default function analytics (action = 'pageview') {
  (new Image()).src = `https://xxx/test_upload?action=${action}&timestamp=${Date.now()}`
}
```

> 用img发送请求的方法英文术语叫：image beacon <br>
主要应用于只需要向服务器发送日志数据的场合，且无需服务器有消息体回应。比如收集访问者的统计信息。<br>
这样做和ajax请求的区别在于：<br>
1.只能是get请求，因此可发送的数据量有限。<br>
2.只关心数据是否发送到服务器，服务器不需要做出消息体响应。并且一般客户端也不需要做出响应。<br>
3.实现了跨域

或者我们直接用新标准`fetch`方式上传
``` javascript
// 简洁的方式
export default function analytics (action = 'pageview') {
  fetch(`https://www.baidu.com?action=${action}&timestamp=${Date.now()}`, {method: 'get'})
}
```
考虑到上报数据过程我们并不关心返回值，只需要知道上报成功与否，我们可以用[Head请求](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods/HEAD)来更高效地实现我们的上报过程：

``` javascript
// 高效的方式
export default function analytics (action = 'pageview') {
 fetch(`https://www.baidu.com?action=${action}&timestamp=${Date.now()}`, {method: 'head'})
}
```
`head`请求方式和参数传递方式与`get`请求一致，也会受限于浏览器，但因为其不需要返回响应实体，其效率要比get方式高得多。单上述示例的简单请求在chrome下表现大概就有20ms的优化。

如果要上传的数据确实比较多，拼接参数后的url长度超出了浏览器的限制，导致请求失败。则我们采取post的方式：
``` javascript
// 通用的方式 （可以采用fetch, 但fetch默认不带cookie, 可能有认证问题）
export default function analytics (action = 'pageview', params) {
  let xhr = new XMLHttpRequest()
  let data = new FormData()
  data.append('action', action)
  for (let obj in params) {
    data.append(obj, params[obj])
  }
  xhr.open('POST', 'https://xxx/test_upload')
  xhr.send(data)
}
```

### 批量打包上报
无论单个埋点的数据量多少，现在假设页面为了做用户行为分析，有多处埋点，频繁上报可能对用户正常功能的访问有一定影响。<br>
解决这个问题最直接思路就是减少上报的请求数。因此我们来实现一个批量上传的feature，一个简单的思路是每收集完10条数据就打包上报:

``` javascript
// 每10条数据数据进行打包
let logs = []
/**
 * @params {array} 日志数组
 */
function upload (logs) {
  console.log('send logs', logs)
  let xhr = new XMLHttpRequest()
  let data = new FormData()
  data.append('logs', logs)
  xhr.open('POST', this.url)
  xhr.send(data)
}

export default function analytics (action = 'pageview', params) {
  logs.push(Object.assign({
    action,
    timeStamp: Date.now()
  }, params))
  if (logs.length >= 10) {
    upload(logs)
    logs = []
  }
}
```
在埋点的位置，我们先执行个几十次看看
``` javascript
import analy from '@/vendor/analytics1.js'
for (let i = 33; i--;) {
    analy1('pv')
}
```
ok, 正常的话应该上报成功了，并且每条请求都包含了10个数据。<br>
但问题很快也暴露了，这种凑够N条数据再统一发送的行为会出现断层，如果在没有凑够N条数据的时候用户就关掉页面，或者是超过N倍数但凑不到N的那部分，如果不处理的话这部分数据就丢失了。<br>
一种直接的解决方案是监听页面`beforeunload`事件，在页面离开前把剩余不足N条的log全部上传。因此，我们添加一个beforeunload事件，顺便整理下代码，将其封装成一个类：
``` javascript
export default class eventTrack {
  constructor (option) {
    this.option = Object.assign({
      url: 'https://www.baidu.com',
      maxLogNum: 10
    }, option)
    this.url = this.option.url
    this.maxLogNum = this.option.maxLogNum
    this.logs = []
    // 监听unload事件，
    window.addEventListener('beforeunload', this.uploadLog.bind(this), false)
  }
  /**
   * 收集日志，集满 maxLogNum 后上传
   * @param  {string} 埋点行为
   * @param  {object} 埋点附带数据
   */
  analytics (action = 'pageview', params) {
    this.logs.push(Object.assign({
      action,
      timeStamp: Date.now()
    }, params))
    if (this.logs.length >= this.maxLogNum) {
      this.send(this.logs)
      this.logs = []
    }
  }
  // 上报一个日志数组
  send (logs, sync) {
    let xhr = new XMLHttpRequest()
    let data = new FormData()
    for (var i = logs.length; i--;) {
      data.append('logs', JSON.stringify(logs[i]))
    }
    xhr.open('POST', this.url, !sync)
    xhr.send(data)
  }
  // 使用同步的xhr请求
  uploadLog () {
    this.send(this.logs, true)
  }
}
```
目前为止我们初步实现了功能，在进一步新增feature前，先继续优化下当前代码，结合前面的过程，我们可以考虑优化这几点：
1. 上报请求方式应可选：调用形式如`analytics.head`(单条上报), `analytics.post`(默认)
2. 页面unload时候，采用更好的[sendBeacon](https://developer.mozilla.org/zh-CN/docs/Web/API/Navigator/sendBeacon)方式，并向下兼容

关于`sendBeacon`, 该方法可以将少量数据异步传输到Web服务器。在上述代码的`uploadLog`方法中，我们使用了同步的xhr请求，这样做是为了防止页面因关闭或者切换，脚本来不及执行导致最后的日志无法上报。<br>
beforeunload的场景下，同步`xhr`和`sendBeacon`的特点<br>
- 同步xhr: 离开页面时阻塞一会脚本，确保日志发出
- sendBeacon: 离开页面时发起异步请求，不阻塞并确保日志发出。有浏览器兼容问题

值得一提的是，单页应用中，路由的切换并不会对漏报造成太大影响，只要确保上报脚本是挂载到全局，并处理好页面关闭和跳转到其他域名的情况就好。<br>
总之，根据这两点优化，我们在增加新功能前再完善下代码：
``` javascript
export default class eventTrack {
  constructor (option) {
    this.option = Object.assign({
      url: 'https://www.baidu.com',
      maxLogNum: 10
    }, option)
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
    // 监听unload事件，
    window.addEventListener('beforeunload', this.unloadHandler.bind(this), false)
  }

  /**
   * 收集日志，集满 maxLogNum 后上传
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
    let xhr = new XMLHttpRequest()
    let data = new FormData()
    for (var i = logs.length; i--;) {
      data.append('logs', logs[i])
    }
    xhr.open('POST', this.url, !sync)
    xhr.send(data)
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
```
### 无网络延时上报
思考一个问题，假如我们的页面处于断网离线状态（比如就是信号不好），用户在这期间进行了操作，而我们又想收集这部分数据会怎样？
1. 假如断网非常短暂，脚本持续执行并且未触发打包上传。由于log仍保留在内存中，继续执行直到触发可上传数量后，网络已恢复，此时无影响。
2. 断网时间较长，中间触发几次上报，网络错误会导致上报失败。之后恢复网络，后续日志正常上报，此时丢失了断网期间数据。
3. 断网从某一刻开始持续到用户主动关闭页面，期间日志均无法上报。

我们可以尝试增加“失败重传”的功能，比起网络不稳定，更多的情况是某个问题导致的稳定错误，重传不能解决这类问题。设想我们在客户端进行数据收集，我们可以很方便地记录到log文件中，于是同样的考虑，我们也可以把数据暂存到localstorage上面，有网环境下再继续上报，因此解决这个问题的方案我们可以归纳为：
1. 上报数据，`navigator.onLine`判断网络状况
2. 有网正常发送
3. 无网络时记入`localstorage`, 延时上报

我们修改下`sendInPack`, 并增加对应方法
``` javascript
sendInPack (logs, sync) {
    if (navigator.onLine) {
      this.sendMultiData(logs, sync)
      this.sendStorageData()
    } else {
      this.storageData(logs)
    }
  }
  sendMultiData (logs, sync) {
    console.log('sendMultiData', logs)
    let xhr = new XMLHttpRequest()
    let data = new FormData()
    for (var i = logs.length; i--;) {
      data.append('logs', logs[i])
    }
    xhr.open('POST', this.url, !sync)
    xhr.send(data)
  }
  storageData (logs) {
    console.log('storageData', logs)
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
  }
```

> 注意`navigator.onLine `在不同浏览器开发环境下的问题，比如chrome下localhost访问时候，navigator.onLine值总为false， 改用127.0.0.1则正常返回值

### 更好的pv: visibilitychange
PV是日志上报中很重要的一环。<br>
目前为止我们基本实现完上报了，现在再回归到业务层面。pv的目的是什么，以及怎样更好得达到我们的目的？
推荐先阅读这篇关于pv的文章:<br>
[为什么说你的pv统计是错的](https://zhuanlan.zhihu.com/p/26341409)

在大多数情况下，我们的pv上报假设每次页面浏览（Page View）对应一次页面加载（Page Load），且每次页面加载完成后都会运行一些统计代码, 然而这情况对于尤其单页应用存在一些问题
1. 用户打开页面一次，而在接下来的几天之内使用数百次，但是并没有刷新页面，这种情况应该只算一个 Page View 么
2. 如果两个用户每天访问页面次数完全相同，但是其中一个每次刷新，而另一个保持页面在后台运行，这两种使用模式的 Page View 统计结果应该有很大的不同么
3. ···

为了遵循更好的PV，我们可以在脚本增加下列情况的处理：
1. 页面加载时，如果页面的 visibilityState 是可见的，发送 Page View 统计；
2. 页面加载时, 如果页面的 visibilityState 是隐藏的，就监听 visibilitychange 事件，并在 visibilityState 变为可见时发送 Page View 统计；
3. 如果 visibilityState 由隐藏变为可见，并且自上次用户交互之后已经过了“足够长”的时间，就发送新的 Page View 统计；
4. 如果 URL 发生变化（仅限于 pathname 或 search 部分发送变化, hash 部分则应该忽略，因为它是用来标记页面内跳转的) 发送新的 Page View 统计；
在我们的构造函数中增加以下片段：
``` javascript
this.option = Object.assign({
  url: 'https://baidu.com/api/test',
  maxLogNum: 10,
  stayTime: 2000, // ms, 页面由隐藏变为可见，并且自上次用户交互之后足够久，可以视为新pv的时间间隔
  timeout: 6000   // 页面切换间隔，小于多少ms不算间隔
}, option)
this.hiddenTime = Date.now()
···
 // 监听页面可见性
document.addEventListener('visibilitychange', () => {
  console.log(document.visibilityState, Date.now(), this.hiddenTime)
  if (document.visibilityState === 'visible' && (Date.now() - this.hiddenTime > this.option.stayTime)) {
    this.analytics('re-open')
    console.log('send pv visible')
  } else if (document.visibilityState === 'hidden') {
    this.hiddenTime = Date.now()
  }
})
···
```

### 更好的pv: hash跳转
考虑我们是一个hash模式的单页应用，即路由跳转以 ‘#’加路由结尾标识。
如果我们想对每个路由切换进行追踪，一种做法是在每个路由组件的进行监听，也可以在上报文件中直接统一处理：
```
window.addEventListener('hashchange', () => {
  this.analytics()
})
```
但这样子有个问题，如何判别当前hash跳转是个有效跳转。比如页面存在重定向逻辑，用户从A页面进入（弃用页面），我们代码把它跳转到B页面，这样pv发出去了两次，而实际有效的浏览只是B页面一次。又或者用户只是匆匆看了A页面一眼，又跳转到B页面，A页面要不要作为一次有效PV?<br>
一种更好的方式是设置有效间隔，比如小于5s的浏览不作为一个有效pv，那由此而生的逻辑，我们需要调整我们的 `analytics` 方法：
``` javascript
// 封装一个sendPV 专门用来发送pv
constructor (option) {
  ···
  this.sendPV = this.delay((args) => {
    this.analytics({action: 'pageview', ...args})
  })
    
  window.addEventListener('hashchange', () => {
    this.sendPV()
  })
  this.sendPV()
···
}

delay (func, time) {
    let t = 0
    let self = this
    return function (...args) {
      clearTimeout(t)
      t = setTimeout(func.bind(this, args), time || self.option.timeout)
    }
}
```

ok, 到这里就差不多了，完整示意在这里 [analytics.js](https://github.com/kimyLee/analytics)，加了点调用测试<br> 考虑到不同业务场景，我们还有有更多空间可以填补，数据闭环其实也是为了更好的业务分析服务，虽然是一个传统功能，但值得细细考究的点还是挺多的吧








