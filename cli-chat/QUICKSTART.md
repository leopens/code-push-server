# 快速開始指南

## 第一步：安裝依賴

```bash
cd code-push-server/cli-chat
npm install
```

## 第二步：配置環境變數

創建 `.env` 文件：

```bash
cp .env.example .env
```

編輯 `.env`，選擇你要使用的 LLM 服務：

### 選項 1: OpenAI（全球通用）
```env
LLM_API_KEY=your-openai-key
LLM_ENDPOINT=https://api.openai.com/v1
LLM_MODEL=gpt-3.5-turbo
```

### 選項 2: Pi AI（對話能力強）
```env
LLM_API_KEY=your-pi-api-key
LLM_ENDPOINT=https://api.pi.ai/v1
LLM_MODEL=pi-chat
```

### 選項 3: 阿里雲通義千問（中文優化）
```env
LLM_API_KEY=your-dashscope-key
LLM_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

### 選項 4: DeepSeek（性價比高）
```env
LLM_API_KEY=your-deepseek-key
LLM_ENDPOINT=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

## 第三步：啟動聊天

```bash
npm start
```

程序會自動：
1. 獲取 CLI 命令列表（執行 `code-push-standalone --help`）
2. 加載到 AI 上下文中
3. 啟動互動對話

> 💡 **智能學習**：助手會在啟動時自動學習所有 CLI 命令，無需手動維護命令列表。詳見 [CLI_LEARNING.md](./CLI_LEARNING.md)

## 使用示例

```
正在獲取 CLI 命令信息...
✓ CLI 命令信息已加載

╔════════════════════════════════════════════════════════════╗
║    CodePush Chat - 互動式 CLI 助手                        ║
╠════════════════════════════════════════════════════════════╣
║  用自然語言描述你要執行的操作                            ║
║  輸入 q 或 quit 退出                                      ║
║  自動累積對話上下文，支持連續操作                        ║
╚════════════════════════════════════════════════════════════╝

你> 幫我列出所有應用

思考中...

助手> 要列出所有應用，使用以下命令：
```shell
code-push-standalone app list
```

是否執行此命令? (y/N): y

執行: code-push-standalone app list

MyApp-iOS
MyApp-Android

✅ 執行成功

你> 查看第一個應用的詳情

思考中...

助手> 根據前面的結果，第一個應用是 MyApp-iOS：
```shell
code-push-standalone app info MyApp-iOS
```

是否執行此命令? (y/N): y
...

你> q
再見！👋
```

## 對話技巧

### ✅ 好的提問方式
- "列出所有應用"
- "查看 MyApp 的部署情況"
- "把版本推到生產環境"
- "我想發布一個新版本到 Android"

### ⚠️ 需要更具體的提問
- "幫我" → "列出應用"
- "看看" → "查看 MyApp 詳情"
- "發布" → "發布 MyApp Android 版本"

## 常見命令示例

| 自然語言 | 生成的命令 |
|---------|-----------|
| 列出所有應用 | `code-push-standalone app list` |
| 查看 MyApp 資訊 | `code-push-standalone app info MyApp` |
| 登錄帳號 | `code-push-standalone login` |
| 查看當前用戶 | `code-push-standalone whoami` |
| 發布到 Android | `code-push-standalone release MyApp ./build android` |

## 故障排除

### 問題：找不到 code-push-standalone
```bash
# 確保已安裝 CLI
cd ../cli
npm install
npm run build
```

### 問題：命令執行失敗，顯示 [Error]
**不用擔心！** 助手會自動分析錯誤並給出解決建議。

常見錯誤：
- **未登錄**：助手會建議你先執行 `code-push-standalone login`
- **資源不存在**：助手會提示檢查應用名稱或部署名稱
- **權限不足**：助手會說明需要的權限

> 💡 **智能診斷**：每次命令失敗時，助手都會自動分析錯誤信息並提供解決方案

### 問題：API Key 無效
檢查 `.env` 文件中的 `LLM_API_KEY` 是否正確，並確保：
- 使用的 endpoint 與 API Key 匹配
- API Key 有效且有足夠的配额

### 問題：無法提取命令
AI 可能沒理解你的意圖，嘗試：
1. 更具體地描述操作
2. 使用更標準的術語
3. 參考上方的命令示例

## 高級功能

### 連續對話
助手會記住之前的對話，你可以：
```
你> 列出所有應用
助手> [執行 app list]

你> 查看第二個的詳情
助手> [記住列表，查看第二個應用]
```

### 基於結果的操作
```
你> 查看 MyApp 的部署
助手> [顯示 Staging, Production]

你> 把 Staging 推到 Production
助手> [使用 promote 命令]
```
**了解學習機制**：閱讀 [CLI_LEARNING.md](./CLI_LEARNING.md) 了解助手如何自動學習命令
- **探索更多命令**：`code-push-standalone --help`
- **查看完整文檔**：[README.md](./README.md)
- **自定義 prompt**：編輯 [script/code-push-chat.js](script/code-push-chat.js) 中的 system prompt
- 探索更多命令：`code-push-standalone --help`
- 查看主文檔：[README.md](./README.md)
- 自定義 system prompt：編輯 `script/code-push-chat.js`
