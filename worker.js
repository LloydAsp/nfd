const TOKEN = ENV_BOT_TOKEN
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET
const ADMIN_UID = ENV_ADMIN_UID

const NOTIFY_INTERVAL = 3600 * 1000
const MAX_MSG_LEN = 4000
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db'
const notificationUrl = 'https://github.com/solaireh3/nfd/raw/refs/heads/main/data/notification.txt'
const startMsgUrl = 'https://github.com/solaireh3/nfd/raw/refs/heads/main/data/startMessage.md'

const enable_notification = true

// =================== 基础函数 ===================
function apiUrl(methodName, params = null) {
  let query = params ? '?' + new URLSearchParams(params).toString() : ''
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then(r => r.json())
}

function makeReqBody(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function sendMessage(msg = {}) { return requestTelegram('sendMessage', makeReqBody(msg)) }
function copyMessage(msg = {}) { return requestTelegram('copyMessage', makeReqBody(msg)) }
function forwardMessage(msg = {}) { return requestTelegram('forwardMessage', makeReqBody(msg)) }

// =================== Worker 监听 ===================
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) event.respondWith(handleWebhook(event))
  else if (url.pathname === '/registerWebhook') event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  else if (url.pathname === '/unRegisterWebhook') event.respondWith(unRegisterWebhook(event))
  else event.respondWith(new Response('No handler for this request'))
})

async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET)
    return new Response('Unauthorized', { status: 403 })
  const update = await event.request.json()
  event.waitUntil(onUpdate(update))
  return new Response('Ok')
}

async function onUpdate(update) {
  if ('message' in update) await onMessage(update.message)
}

// =================== 消息处理 ===================
async function onMessage(message) {
  if (message.text === '/start') {
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({ chat_id: message.chat.id, text: startMsg })
  }

  if (message.chat.id.toString() === ADMIN_UID) return handleAdminCommand(message)
  return handleGuestMessage(message)
}

// =================== 管理员命令 ===================
async function handleAdminCommand(message) {
  const replyId = message?.reply_to_message?.message_id
  let guestChatId = replyId ? await nfd.get('msg-map-' + replyId) : null

  if (!guestChatId && !/^\/list$|^\/contact|^\/history/.exec(message.text))
    return sendMessage({ chat_id: ADMIN_UID, text: '请回复转发消息输入 /block、/unblock、/checkblock、/info，或者使用 /list /history UID /contact UID' })

  if (/^\/block$/.exec(message.text)) return handleBlock(message)
  if (/^\/unblock$/.exec(message.text)) return handleUnBlock(message)
  if (/^\/checkblock$/.exec(message.text)) return checkBlock(message)
  if (/^\/info$/.exec(message.text)) return handleInfo(message, guestChatId)
  if (/^\/list$/.exec(message.text)) return handleList(message)
  if (/^\/history(\s+(\d+))?$/.exec(message.text)) return handleHistory(message, guestChatId)
  if (/^\/contact\s+(\d+)\s+(.+)$/.exec(message.text)) return handleContact(message)

  if (guestChatId) return copyMessage({ chat_id: guestChatId, from_chat_id: message.chat.id, message_id: message.message_id })
}


// =================== /info 命令 ===================
async function handleInfo(message, guestChatId) {
  if (!guestChatId) 
    return sendMessage({ chat_id: ADMIN_UID, text: '请回复转发消息输入 /info' })

  let username = await nfd.get('username-' + guestChatId)
  let usernameDisplay = username ? '@' + username : '（无用户名）'

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: ${guestChatId}\nUsername: ${usernameDisplay}\nLink: tg://user?id=${guestChatId}`
  })
}


// =================== /list 命令 ===================
async function handleList(message) {
  let keys = await nfd.list({ prefix: 'username-' })
  if (keys.keys.length === 0) return sendMessage({ chat_id: ADMIN_UID, text: '暂无用户记录' })

  let result = []
  for (let k of keys.keys) {
    let uid = k.name.replace('username-', '')
    let username = await nfd.get(k.name)
    let lastTime = await nfd.get('lastmsg-' + uid) || '未知'
    let lastTimeStr = lastTime !== '未知' ? new Date(parseInt(lastTime)).toLocaleString('zh-CN') : '未知'
    result.push(`UID: ${uid}\nUsername: @${username || '无'}\n最后消息时间: ${lastTimeStr}\n---`)
  }

  return sendMessage({ chat_id: ADMIN_UID, text: result.join('\n') })
}
// =================== /history ===================
async function handleHistory(message, guestChatIdFromReply) {
  let uid = guestChatIdFromReply
  const match = message.text.match(/^\/history\s+(\d+)$/)
  if (match) uid = match[1]

  if (!uid) return sendMessage({ chat_id: ADMIN_UID, text: '请回复转发消息或输入 /history UID' })

  let historyStr = await nfd.get('history-' + uid) || '[]'
  let arr
  try { arr = JSON.parse(historyStr) } catch(e) { arr = [] }

  if (arr.length === 0) return sendMessage({ chat_id: ADMIN_UID, text: '没有聊天记录' })

  let text = ''
  for (let v of arr) {
    let line = `${new Date(v.time).toLocaleString()}\n\`${(v.text || '[非文本消息]').replace(/`/g,'\\`')}\`\n\n`
    if ((text + line).length > MAX_MSG_LEN) {
      await sendMessage({ chat_id: ADMIN_UID, parse_mode: 'MarkdownV2', text })
      text = line
    } else {
      text += line
    }
  }
  if (text) await sendMessage({ chat_id: ADMIN_UID, parse_mode: 'MarkdownV2', text })
}

// =================== /contact ===================
async function handleContact(message) {
  let match = message.text.match(/^\/contact\s+(\d+)\s+(.+)$/)
  if (!match) return
  let uid = match[1]
  let text = match[2]
  return sendMessage({ chat_id: uid, text })
}

// =================== 访客消息处理 ===================
async function handleGuestMessage(message) {
  let chatId = message.chat.id
  let isblocked = await nfd.get('isblocked-' + chatId)
  if (isblocked === 'true') return sendMessage({ chat_id, text: 'You are blocked' })

  if (message.from?.username) await nfd.put('username-' + chatId, message.from.username)
  await nfd.put('lastmsg-' + chatId, Date.now().toString())
  await nfd.put('lastmsgText-' + chatId, message.text || '[非文本消息]')

  let historyKey = 'history-' + chatId
  let prev = await nfd.get(historyKey) || '[]'
  let arr
  try { arr = JSON.parse(prev) } catch(e) { arr = [] }
  arr.push({ text: message.text || '[非文本消息]', time: Date.now() })
  await nfd.put(historyKey, JSON.stringify(arr))

  let forwardReq = await forwardMessage({ chat_id: ADMIN_UID, from_chat_id: chatId, message_id: message.message_id })
  if (forwardReq.ok) await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)

  return handleNotify(message)
}

// =================== handleNotify ===================
async function handleNotify(message) {
  let chatId = message.chat.id
  if (await isFraud(chatId)) return sendMessage({ chat_id: ADMIN_UID, text: `检测到骗子，UID ${chatId}` })
  if (!enable_notification) return

  let lastMsgTime = await nfd.get('lastmsg-' + chatId)
  if (!lastMsgTime || Date.now() - parseInt(lastMsgTime) > NOTIFY_INTERVAL) {
    await nfd.put('lastmsg-' + chatId, Date.now().toString())
    return sendMessage({ chat_id: ADMIN_UID, text: await fetch(notificationUrl).then(r => r.text()) })
  }
}

// =================== block / unblock / check ===================
async function handleBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id)
  if (guestChatId === ADMIN_UID) return sendMessage({ chat_id: ADMIN_UID, text: '不能屏蔽自己' })
  await nfd.put('isblocked-' + guestChatId, 'true')
  return sendMessage({ chat_id: ADMIN_UID, text: `UID:${guestChatId} 屏蔽成功` })
}

async function handleUnBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id)
  await nfd.put('isblocked-' + guestChatId, 'false')
  return sendMessage({ chat_id: ADMIN_UID, text: `UID:${guestChatId} 解除屏蔽成功` })
}

async function checkBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id)
  let blocked = await nfd.get('isblocked-' + guestChatId)
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} ` + (blocked === 'true' ? '被屏蔽' : '没有被屏蔽')
  })
}

// =================== 防诈骗 ===================
async function isFraud(id) {
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  return arr.includes(id)
}

// =================== webhook 注册 ===================
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}
