const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/notification.txt'
const startMsgUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/startMessage.md';
const badWordsUrl = ENV_BAD_WORDS_URL || 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/badwords.json';
const adWordsUrl = ENV_AD_WORDS_URL || 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/adwords.json';
const githubApiUrl = ENV_GITHUB_API_URL
const githubToken = ENV_GITHUB_TOKEN

const enable_notification = true
/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl (methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook (event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate (update) {
  if (!badWords || !adWords) {
    await loadKeywords()
  }

  if ('message' in update) {
    await onMessage(update.message)
  }
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {
  if(message.text === '/start'){
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id:message.chat.id,
      text:startMsg,
    })
  }

  const checkResult = containsBadWordsOrAds(message.text)
  if (checkResult === 'badWord') {
    await sendMessage({
      chat_id: message.chat.id,
      text: '消息包含不允许的脏话，请注意言辞。'
    })
    return
  } else if (checkResult === 'adWord') {
    await sendMessage({
      chat_id: message.chat.id,
      text: '消息包含不允许的广告内容，请勿发送广告。'
    })
    return
  }

  if(message.chat.id.toString() === ADMIN_UID){
    if(/^\/addbadword\s+(.+)$/.exec(message.text)){
      const keyword = message.text.match(/^\/addbadword\s+(.+)$/)[1]
      return await addBadWord(keyword, message.chat.id)
    }
    if(/^\/addadword\s+(.+)$/.exec(message.text)){
      const keyword = message.text.match(/^\/addadword\s+(.+)$/)[1]
      return await addAdWord(keyword, message.chat.id)
    }
    if(!message?.reply_to_message?.chat){
      return sendMessage({
        chat_id:ADMIN_UID,
        text:'使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令'
      })
    }
    if(/^\/block$/.exec(message.text)){
      return handleBlock(message)
    }
    if(/^\/unblock$/.exec(message.text)){
      return handleUnBlock(message)
    }
    if(/^\/checkblock$/.exec(message.text)){
      return checkBlock(message)
    }
    let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id,
                                      { type: "json" })
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id:message.chat.id,
      message_id:message.message_id,
    })
  }
  return handleGuestMessage(message)
}

async function handleGuestMessage(message){
  let chatId = message.chat.id;
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  
  if(isblocked){
    return sendMessage({
      chat_id: chatId,
      text:'Your are blocked'
    })
  }

  let forwardReq = await forwardMessage({
    chat_id:ADMIN_UID,
    from_chat_id:message.chat.id,
    message_id:message.message_id
  })
  console.log(JSON.stringify(forwardReq))
  if(forwardReq.ok){
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return handleNotify(message)
}

async function handleNotify(message){
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if(await isFraud(chatId)){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`检测到骗子，UID${chatId}`
    })
  }
  if(enable_notification){
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" })
    if(!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL){
      await nfd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text:await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
                                      { type: "json" })
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  await nfd.put('isblocked-' + guestChantId, true)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}屏蔽成功`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await nfd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId}解除屏蔽成功`,
  })
}

async function checkBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })
  let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" })

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}` + (blocked ? '被屏蔽' : '没有被屏蔽')
  })
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}

let badWords = null
let adWords = null

/**
 * Load bad words and ad words from the data files
 */
async function loadKeywords () {
  try {
    const [badRes, adRes] = await Promise.all([fetch(badWordsUrl), fetch(adWordsUrl)])
    if (!badRes.ok || !adRes.ok) {
      throw new Error(`fetch keywords failed: ${badRes.statusText} / ${adRes.statusText}`)
    }
    const badData = await badRes.json()
    const adData = await adRes.json()

    badWords = {
      plain: badData.plain || [],
      regex: (badData.regex || []).map(pattern => new RegExp(pattern, 'i'))
    }
    adWords = {
      plain: adData.plain || [],
      regex: (adData.regex || []).map(pattern => new RegExp(pattern, 'i'))
    }

    console.log('keywords loaded')
  } catch (error) {
    console.error('failed to load keywords:', error)
  }
}

/**
 * Check whether text contains bad words or ads
 * returns 'badWord' | 'adWord' | null
 */
function containsBadWordsOrAds (text) {
  if (!text) {
    return null
  }
  if (!badWords || !adWords) {
    console.error('keywords not loaded')
    return null
  }
  for (const word of badWords.plain) {
    if (text.includes(word)) {
      return 'badWord'
    }
  }
  for (const word of adWords.plain) {
    if (text.includes(word)) {
      return 'adWord'
    }
  }
  for (const regex of badWords.regex) {
    if (regex.test(text)) {
      return 'badWord'
    }
  }
  for (const regex of adWords.regex) {
    if (regex.test(text)) {
      return 'adWord'
    }
  }
  return null
}

/**
 * Add a bad word and sync keywords to GitHub
 */
async function addBadWord (keyword, chatId) {
  try {
    if (!badWords || !adWords) {
      throw new Error('关键词列表尚未加载，请稍后重试')
    }
    badWords.plain.push(keyword)
    await updateGitHubKeywords()
    return sendMessage({
      chat_id: chatId,
      text: `成功添加脏话关键词: ${keyword}`
    })
  } catch (error) {
    console.error('failed to add bad word:', error)
    return sendMessage({
      chat_id: chatId,
      text: `添加脏话关键词时出错: ${error.message}`
    })
  }
}

/**
 * Add an ad word and sync keywords to GitHub
 */
async function addAdWord (keyword, chatId) {
  try {
    if (!badWords || !adWords) {
      throw new Error('关键词列表尚未加载，请稍后重试')
    }
    adWords.plain.push(keyword)
    await updateGitHubKeywords()
    return sendMessage({
      chat_id: chatId,
      text: `成功添加广告关键词: ${keyword}`
    })
  } catch (error) {
    console.error('failed to add ad word:', error)
    return sendMessage({
      chat_id: chatId,
      text: `添加广告关键词时出错: ${error.message}`
    })
  }
}

/**
 * Sync keywords to GitHub via the contents API
 * requires ENV_GITHUB_API_URL and ENV_GITHUB_TOKEN
 */
async function updateGitHubKeywords () {
  if (!githubApiUrl || !githubToken) {
    throw new Error('未配置 ENV_GITHUB_API_URL / ENV_GITHUB_TOKEN，关键词仅保存在当前实例')
  }
  const updatedKeywords = {
    badWords: {
      plain: badWords.plain,
      regex: badWords.regex.map(regex => regex.source)
    },
    adWords: {
      plain: adWords.plain,
      regex: adWords.regex.map(regex => regex.source)
    }
  }

  const response = await fetch(githubApiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatedKeywords)
  })

  if (!response.ok) {
    throw new Error(`更新GitHub关键词数据库失败: ${response.statusText}`)
  }
  console.log('GitHub关键词数据库更新成功')
}
