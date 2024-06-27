const TOKEN = ENV_BOT_TOKEN; // 从环境变量获取Token
const WEBHOOK = '/endpoint'; // 定义Webhook路径
const SECRET = ENV_BOT_SECRET; // 从环境变量获取Secret
const ADMIN_UID = ENV_ADMIN_UID; // 从环境变量获取Admin UID

const NOTIFY_INTERVAL = 3600 * 1000; // 通知间隔时间（毫秒）
const FRAUD_DB_URL = ENV_FRAUD_DB_URL; // 欺诈数据库URL
const NOTIFICATION_URL = ENV_NOTIFICATION_URL; // 通知消息URL
const START_MSG_URL = ENV_START_MSG_URL; // 启动消息URL

const ENABLE_NOTIFICATION = false; // 启用通知

const BAD_WORDS_URL = ENV_BAD_WORDS_URL; // 脏话关键词URL
const AD_WORDS_URL = ENV_AD_WORDS_URL; // 广告关键词URL
const GITHUB_API_URL = ENV_GITHUB_API_URL; // GitHub API URL
const GITHUB_TOKEN = ENV_GITHUB_TOKEN; // GitHub Token

let BAD_WORDS = []; // 脏话关键词列表
let AD_WORDS = []; // 广告关键词列表

/**
 * 初始化加载脏话和广告关键词
 */
async function loadKeywords() {
  try {
    const badWordsResponse = await fetch(BAD_WORDS_URL);
    const adWordsResponse = await fetch(AD_WORDS_URL);

    if (!badWordsResponse.ok || !adWordsResponse.ok) {
      throw new Error(`获取关键词失败: ${badWordsResponse.statusText} / ${adWordsResponse.statusText}`);
    }

    const badWordsData = await badWordsResponse.json();
    const adWordsData = await adWordsResponse.json();

    BAD_WORDS = {
      plain: badWordsData.plain || [],
      regex: (badWordsData.regex || []).map(pattern => new RegExp(pattern, 'i'))
    };

    AD_WORDS = {
      plain: adWordsData.plain || [],
      regex: (adWordsData.regex || []).map(pattern => new RegExp(pattern, 'i'))
    };

    console.log('关键词加载成功');
  } catch (error) {
    console.error('加载关键词时出错:', error);
  }
}

/**
 * 检查消息是否包含脏话或广告
 */
function containsBadWordsOrAds(text) {
  if (!BAD_WORDS.plain || !BAD_WORDS.regex || !AD_WORDS.plain || !AD_WORDS.regex) {
    console.error('关键词尚未加载');
    return null;
  }

  // 检查普通字符串
  for (const word of BAD_WORDS.plain) {
    if (text.includes(word)) {
      return 'badWord';
    }
  }
  for (const word of AD_WORDS.plain) {
    if (text.includes(word)) {
      return 'adWord';
    }
  }

  // 检查正则表达式
  for (const regex of BAD_WORDS.regex) {
    if (regex.test(text)) {
      return 'badWord';
    }
  }
  for (const regex of AD_WORDS.regex) {
    if (regex.test(text)) {
      return 'adWord';
    }
  }

  return null;
}

/**
 * 返回Telegram API的URL，可以选择添加参数
 */
function apiUrl(methodName, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

/**
 * 请求Telegram API
 */
async function requestTelegram(methodName, body, params = null) {
  try {
    const response = await fetch(apiUrl(methodName, params), body);
    const result = await response.json();
    if (!response.ok) {
      console.error(`Telegram API请求失败: ${response.statusText}`, result);
    }
    return result;
  } catch (error) {
    console.error('请求Telegram API时出错:', error);
    return null;
  }
}

/**
 * 构造请求体
 */
function makeReqBody(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

/**
 * 发送消息
 */
function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg));
}

/**
 * 复制消息
 */
function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg));
}

/**
 * 转发消息
 */
function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg));
}

/**
 * 监听worker的请求
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event));
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

/**
 * 处理Webhook
 */
async function handleWebhook(event) {
  // 检查Secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    console.error('Unauthorized request');
    return new Response('Unauthorized', { status: 403 });
  }

  try {
    // 同步读取请求体
    const update = await event.request.json();
    // 异步处理响应
    event.waitUntil(onUpdate(update));
    return new Response('Ok');
  } catch (error) {
    console.error('处理Webhook时出错:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * 处理收到的更新
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate(update) {
  // 如果关键词尚未加载，加载关键词
  if (BAD_WORDS.length === 0 || AD_WORDS.length === 0) {
    await loadKeywords();
  }

  if ('message' in update) {
    await onMessage(update.message);
  }
}

/**
 * 将长消息拆分为多个小段
 */
function splitMessage(text, maxLength = 4096) {
  const segments = [];
  while (text.length > 0) {
    let segment = text.slice(0, maxLength);
    const lastNewLine = segment.lastIndexOf('\n');
    if (lastNewLine > -1) {
      segment = segment.slice(0, lastNewLine + 1);
    }
    segments.push(segment.trim());
    text = text.slice(segment.length);
  }
  return segments;
}

/**
 * 处理收到的消息
 * https://core.telegram.org/bots/api#message
 */
async function onMessage(message) {
  if (message.text === '/start') {
    try {
      const startMsg = await fetch(START_MSG_URL);
      if (!startMsg.ok) {
        throw new Error(`获取startMessage.md失败: ${startMsg.status}`);
      }
      const startMsgText = await startMsg.text();
      const segments = splitMessage(startMsgText);

      for (const segment of segments) {
        const response = await sendMessage({
          chat_id: message.chat.id,
          text: segment,
        });

        if (!response || !response.ok) {
          throw new Error(`发送start消息失败: ${response ? response.description : '未知错误'}`);
        }
      }
    } catch (error) {
      console.error('处理/start命令时出错:', error);
      await sendMessage({
        chat_id: message.chat.id,
        text: '获取启动消息时出错，请稍后再试。',
      });
    }
    return;
  }

  const checkResult = containsBadWordsOrAds(message.text);
  if (checkResult === 'badWord') {
    await sendMessage({
      chat_id: message.chat.id,
      text: '消息包含不允许的脏话，请注意言辞。',
    });
    return;
  } else if (checkResult === 'adWord') {
    await sendMessage({
      chat_id: message.chat.id,
      text: '消息包含不允许的广告内容，请勿发送广告。',
    });
    return;
  }

  // 处理添加脏话和广告关键词
  if (message.chat.id.toString() === ADMIN_UID) {
    if (/^\/addbadword\s+(.+)$/.exec(message.text)) {
      const keyword = message.text.match(/^\/addbadword\s+(.+)$/)[1];
      return await addBadWord(keyword, message.chat.id);
    }
    if (/^\/addadword\s+(.+)$/.exec(message.text)) {
      const keyword = message.text.match(/^\/addadword\s+(.+)$/)[1];
      return await addAdWord(keyword, message.chat.id);
    }

    if (!message?.reply_to_message?.chat) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令'
      });
    }

    if (/^\/block$/.exec(message.text)) {
      return handleBlock(message);
    }
    if (/^\/unblock$/.exec(message.text)) {
      return handleUnBlock(message);
    }
    if (/^\/checkblock$/.exec(message.text)) {
      return checkBlock(message);
    }

    const guestChatId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" });
    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '未找到关联的用户消息ID'
      });
    }

    return copyMessage({
      chat_id: guestChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
  }

  if (await nfd.get('isblocked-' + message.chat.id, { type: "json" })) {
    return sendPlainText(message.chat.id, '您的消息已被屏蔽');
  }

  const forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  });

  if (!forwardReq || !forwardReq.ok) {
    console.error('转发消息时出错:', forwardReq);
    return sendMessage({
      chat_id: message.chat.id,
      text: '消息转发失败，请稍后再试。'
    });
  }

  await nfd.put('msg-map-' + forwardReq.message_id, message.chat.id);

  if (await isFraud(message.chat.id)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `检测到骗子，UID${message.chat.id}`
    });
  }

  if (ENABLE_NOTIFICATION) {
    const lastMsgTime = await nfd.get('lastmsg-' + message.chat.id, { type: "json" });

    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put('lastmsg-' + message.chat.id, Date.now());
      const notificationText = await fetch(NOTIFICATION_URL).then(r => r.text());
      return sendMessage({
        chat_id: ADMIN_UID,
        text: notificationText
      });
    }
  }
}

/**
 * 处理屏蔽用户
 */
async function handleBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });

  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未找到关联的用户消息ID'
    });
  }

  if (guestChatId === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    });
  }

  await nfd.put('isblocked-' + guestChatId, true);

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId}屏蔽成功`,
  });
}

/**
 * 处理解除屏蔽用户
 */
async function handleUnBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });

  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未找到关联的用户消息ID'
    });
  }

  await nfd.put('isblocked-' + guestChatId, false);

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId}解除屏蔽成功`,
  });
}

/**
 * 检查用户是否被屏蔽
 */
async function checkBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });

  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未找到关联的用户消息ID'
    });
  }

  const blocked = await nfd.get('isblocked-' + guestChatId, { type: "json" });

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId}` + (blocked ? '被屏蔽' : '没有被屏蔽')
  });
}

/**
 * 发送纯文本消息
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText(chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  });
}

/**
 * 注册Webhook到此worker的URL
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const response = await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }));
  const result = await response.json();

  return new Response('Webhook registered: ' + JSON.stringify(result));
}

/**
 * 注销Webhook
 * https://core.telegram.org/bots/api#deletewebhook
 */
async function unRegisterWebhook(event) {
  const response = await fetch(apiUrl('deleteWebhook'));
  const result = await response.json();

  return new Response('Webhook unregistered: ' + JSON.stringify(result));
}

/**
 * 检查用户是否为欺诈者
 */
async function isFraud(uid) {
  try {
    const response = await fetch(FRAUD_DB_URL);
    if (!response.ok) {
      throw new Error(`获取欺诈数据库失败: ${response.statusText}`);
    }

    let fraudDb;
    try {
      fraudDb = await response.json();
    } catch (e) {
      throw new Error(`解析欺诈数据库JSON时出错: ${e.message}`);
    }

    return fraudDb.includes(uid);
  } catch (error) {
    console.error('检查用户是否为欺诈者时出错:', error);
    return false;
  }
}

/**
 * 添加脏话关键词
 */
async function addBadWord(keyword, chatId) {
  try {
    BAD_WORDS.plain.push(keyword);
    await updateGitHubKeywords();
    return sendMessage({
      chat_id: chatId,
      text: `成功添加脏话关键词: ${keyword}`,
    });
  } catch (error) {
    console.error('添加脏话关键词时出错:', error);
    return sendMessage({
      chat_id: chatId,
      text: `添加脏话关键词时出错: ${error.message}`,
    });
  }
}

/**
 * 添加广告关键词
 */
async function addAdWord(keyword, chatId) {
  try {
    AD_WORDS.plain.push(keyword);
    await updateGitHubKeywords();
    return sendMessage({
      chat_id: chatId,
      text: `成功添加广告关键词: ${keyword}`,
    });
  } catch (error) {
    console.error('添加广告关键词时出错:', error);
    return sendMessage({
      chat_id: chatId,
      text: `添加广告关键词时出错: ${error.message}`,
    });
  }
}

/**
 * 更新GitHub上的关键词数据库
 */
async function updateGitHubKeywords() {
  const updatedKeywords = {
    badWords: {
      plain: BAD_WORDS.plain,
      regex: BAD_WORDS.regex.map(regex => regex.source),
    },
    adWords: {
      plain: AD_WORDS.plain,
      regex: AD_WORDS.regex.map(regex => regex.source),
    }
  };

  const response = await fetch(GITHUB_API_URL, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatedKeywords)
  });

  if (!response.ok) {
    throw new Error(`更新GitHub关键词数据库失败: ${response.statusText}`);
  }

  console.log('GitHub关键词数据库更新成功');
}
