import EventTrack from './analytics1.js'
let d = new EventTrack()

window.onload = () => {
  // 基本请求
  document.getElementById('basic').onclick = () => {
    // head, post
    console.log('————————————基本请求————————————————')
    d.analytics.head('head req')
    d.analytics.post('post req')
  }

  // 批量上报
  document.getElementById('send33').onclick = () => {
    console.log('————————————批量上报————————————————')
    for (let i = 33; i--;) {
      d.analytics('pv' + i)
    }
  }
  // 发送10条数据
  document.getElementById('send10').onclick = () => {
    for (let i = 10; i--;) {
      d.analytics('pv' + i)
    }
  }
}
