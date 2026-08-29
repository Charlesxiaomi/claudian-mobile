import type { Strings } from "./types";

export const zhCn: Strings = {
  ribbon: {
    openChat: "打开 Claudian Mobile",
  },
  commands: {
    openChat: "打开对话",
  },
  chat: {
    placeholder: "向 Claudian 提问…",
    welcome: "有什么可以帮你？",
    newButtonAria: "开始一段新对话",
    sendButtonAria: "发送",
    stopButtonAria: "停止",
    modelMenuTitle: "模型",
    modelButtonAria: (model) => `模型：${model}`,
    modelUnset: "模型",
    effortMenuTitle: "思考强度",
    effortButtonAria: (effort) => `思考强度：${effort}`,
    effortNames: {
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "很高",
      max: "最高",
    },
    missingApiKey: "请先在 Claudian Mobile 设置中填写 API 密钥。",
    confirmNewTitle: "新对话",
    confirmNewMessage: "这会清空当前对话，且无法撤销。",
    confirmNewAction: "开始新对话",
  },
  modal: {
    cancel: "取消",
  },
  toolCall: {
    running: "执行中…",
    done: "完成",
    failed: "失败",
  },
  agent: {
    unknownApiError: "未知的 API 错误。",
    maxIterationsReached: (max) => `已达到 ${max} 轮工具调用上限，已停止。`,
  },
  api: {
    error: (status, type, detail) =>
      `API 请求出错 ${status}${type ? `（${type}）` : ""}${detail ? `：${detail}` : ""}`,
    noDetail: "接口未提供更多信息",
  },
  settings: {
    language: "界面语言",
    languageDesc: "Claudian Mobile 界面所使用的语言。侧边栏图标与命令面板中的名称会在插件重新加载后更新。",
    languageAuto: "跟随 Obsidian",
    apiKey: "API 密钥",
    apiKeyDesc:
      "以明文保存在本设备仓库配置文件夹下本插件的 data.json 里。" +
      "如果仓库会同步到其他设备，请不要使用你不愿意留在本设备上的密钥。",
    baseUrl: "接口地址",
    baseUrlDesc: (defaultUrl) =>
      "要调用的 Anthropic 兼容 Messages API 地址。可以指向任何实现了相同 /v1/messages 流式接口的" +
      "网关（例如 Anthropic 官方、DeepSeek、Kimi、GLM 或代理）。" +
      `默认值：${defaultUrl}`,
    model: "模型",
    modelDesc: "发送给上述接口的模型 ID。第三方接口通常使用自己的模型名称。",
    modelOptions: "模型列表",
    modelOptionsDesc: "每行一个模型 ID。输入框上方的模型按钮会列出这些选项，在那里选中的模型会写回上面的“模型”设置。",
    fetchModels: "获取模型列表",
    fetchModelsDesc:
      "向上方接口请求 /v1/models（接口路径下没有时自动改试域名根路径），并把返回的模型 ID 合并进「模型列表」。" +
      "只增不删——接口没列出的模型不代表不可用。",
    fetchModelsButton: "获取",
    fetchModelsFetching: "获取中…",
    fetchModelsResult: (added, total) => `接口返回 ${total} 个模型，新增 ${added} 个到模型列表。`,
    fetchModelsFailed: (detail) => `获取模型列表失败：${detail}`,
    testConnection: "测试连接",
    testConnectionDesc:
      "选择一个模型，向接口真实发送一条流式 \"hi\"（与聊天完全相同的代码路径）。" +
      "测试通过即代表该模型的流式对话可用；不代表其他模型也可用。",
    testConnectionButton: "测试",
    testModalTitle: "选择要测试的模型",
    testRunning: (model) => `正在测试 ${model}…`,
    testSuccess: (model) => `${model} 可用：接口已正常返回流式响应。`,
    testFailed: (model, detail) => `${model} 不可用：${detail}`,
    effort: "思考强度",
    effortDesc: "以 output_config.effort 发送，用于控制模型回答前思考的多少。",
    maxOutputTokens: "单轮最大输出 token 数",
    maxOutputTokensDesc: "模型每轮回复可生成的 token 数量上限。",
    maxIterations: "工具调用最大轮次",
    maxIterationsDesc: "单次回复最多可以进行多少轮工具调用的安全上限。",
    systemPrompt: "系统提示词",
    feishu: "飞书",
    feishuDescConnected: (name) => (name ? `已连接（${name}）。` : "已连接。") + "对话中可以搜索并阅读你的飞书云文档。",
    feishuDescDisconnected:
      "连接飞书账号后，对话中即可搜索并阅读你的飞书云文档。" +
      "首次连接会自动创建一个个人飞书应用，过程中需要在浏览器里确认两次。" +
      "应用凭证与令牌和上方 API 密钥一样，以明文保存在本插件的 data.json 里。",
    feishuConnectButton: "连接",
    feishuDisconnectButton: "断开",
    feishuStageRegistering: "已在浏览器中打开飞书创建应用页面，请确认后回到这里。",
    feishuStageAuthorizing: "已在浏览器中打开飞书授权页面，请同意授权后回到这里。",
    feishuConnected: (name) => (name ? `飞书已连接（${name}）。` : "飞书已连接。"),
    feishuConnectFailed: (detail) => `飞书连接失败：${detail}`,
    feishuDisconnected: "已断开飞书连接。",
    tikhubApiKey: "TikHub API 密钥",
    tikhubApiKeyDesc:
      "填写后对话中可以通过 TikHub（tikhub.io）获取抖音视频详情、搜索小红书笔记。" +
      "按请求计费，密钥在 user.tikhub.io 创建。和上面的 API 密钥一样，以明文存放在本插件的 data.json 中。",
  },
};
