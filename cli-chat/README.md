# CodePush Chat - 互動式 CLI 助手

通過自然語言與 CodePush CLI 交互的智能助手。

## 功能特性

- 🤖 **自然語言理解**：用日常語言描述操作，自動轉換為 CLI 命令
- 💬 **持續對話**：支持循環對話，保持上下文累積
- 🔄 **上下文記憶**：記住之前的對話和操作結果
- 📚 **動態學習 CLI**：啟動時自動獲取 CLI 命令列表和使用說明
- 🎯 **智能推斷**：基於歷史對話推斷參數
- 🔍 **按需查詢**：助手可主動查詢特定命令的詳細幫助
- 🛠️ **智能錯誤診斷**：命令失敗時自動分析錯誤並提供解決方案
- ⌨️ **簡單退出**：輸入 `q` 或 `quit` 即可退出
- ✅ **執行確認**：每次執行前都會詢問確認

## 安裝

```bash
cd code-push-server/cli-chat
npm install
```

## 配置

1. 複製環境變數範本：

```bash
cp .env.example .env
```

2. 編輯 `.env` 文件，填入你的 API Key：

```env
# 使用 Pi AI (推薦)
PI_API_KEY=your-pi-api-key-here
LLM_ENDPOINT=https://api.pi.ai/v1
LLM_MODEL=pi-chat
```

### 支持的 LLM 服務

所有 OpenAI 兼容的 API 都可以使用，只需設置相應的 endpoint 和 model：

#### OpenAI
```env
LLM_API_KEY=your-openai-key
LLM_ENDPOINT=https://api.openai.com/v1
LLM_MODEL=gpt-3.5-turbo
```

#### Pi AI
```env
LLM_API_KEY=your-pi-api-key
LLM_ENDPOINT=https://api.pi.ai/v1
LLM_MODEL=pi-chat
```

#### DashScope / Qwen
```env
LLM_API_KEY=your-dashscope-key
LLM_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

#### DeepSeek
```env
LLM_API_KEY=your-deepseek-key
LLM_ENDPOINT=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

## 使用方法

啟動互動式對話：

```bash
npm start
```

或直接運行：

```bash
node -r dotenv/config ./script/code-push-chat.js
```

### 使用範例

```
╔════════════════════════════════════════════════════════════╗
║    CodePush Chat - 互動式 CLI 助手                        ║
╠════════════════════════════════════════════════════════════╣
║  用自然語言描述你要執行的操作                            ║
║  輸入 q 或 quit 退出                                      ║
║  自動累積對話上下文，支持連續操作                        ║
╚════════════════════════════════════════════════════════════╝

你> 列出所有應用

思考中...

助手> 要列出所有應用，可以使用以下命令：

```shell
code-push-standalone app list
```

是否執行此命令? (y/N): y

執行: code-push-standalone app list

MyApp-iOS
MyApp-Android
TestApp

✅ 執行成功

你> 查看第一個應用的詳情

思考中...

助手> 根據之前的列表，第一個應用是 MyApp-iOS，查看詳情：

```shell
code-push-standalone app info MyApp-iOS
```

是否執行此命令? (y/N): y
...

你> q

再見！👋
```

### 智能錯誤處理

當命令執行失敗時，助手會自動分析錯誤並提供解決方案：

```
你> 查看 access key 列表

思考中...

助手> ```shell
code-push-standalone access-key list
```

是否執行此命令? (y/N): y

執行: code-push-standalone access-key list
（包含 stdout 和 stderr）
8. **錯誤診斷**：如果命令失敗，AI 自動分析錯誤信息並提供解決建議
9. **更新上下文**：將結果和診斷not currently logged in. Please login using 'code-push-standalone login'

⚠️  命令返回錯誤 (code: 1)

正在分析錯誤...

助手> 看起來你還沒有登錄 CodePush 服務。錯誤訊息提示需要先登錄。

請先執行登錄命令：

```shell
code-push-standalone login
```

登錄成功後，就可以查看 access key 列表了。需要我幫你執行登錄嗎？

你> 好的，幫我登錄

助手> ```shell
code-push-standalone login
```
...
```

### 對話示例

- **列出應用**：「列出所有應用」、「show me all apps」
- **查看詳情**：「查看 MyApp 的詳情」、「tell me about MyApp」
- **發布版本**：「發布新版本到 MyApp 的 Android」
- **查看部署**：「MyApp 有哪些部署？」
- **查詢帳號**：「我現在登錄的是誰？」

## 工作原理

1. **初始化**：啟動時自動執行 `code-push-standalone --help` 獲取完整命令列表
2. **接收輸入**：用戶用自然語言描述操作
3. **LLM 處理**：發送到 AI 模型，連同 CLI 幫助信息一起理解意圖
4. **按需查詢**：如果 AI 需要某個命令的詳細參數，會自動執行 `code-push-standalone <command> --help`
5. **生成命令**：AI 轉換為對應的 CLI 命令
6. **確認執行**：顯示命令並請求確認
7. **執行反饋**：運行命令並顯示結果
8. **更新上下文**：將結果加入對話歷史，供後續參考

## 支持的命令類別

- `app` - 應用管理
- `deployment` - 部署管理
- `release` - 發布更新
- `release-react` - React Native 專用發布
- `promote` - 推廣部署
- `rollback` - 回滾版本
- `login` / `logout` - 帳號登錄登出
- `whoami` - 查看當前用戶
- `register` - 註冊帳號
- `access-key` - 訪問密鑰管理

## 技術細節

- **Node.js**: 需要 Node.js 14+ (推薦 18+)
- **HTTP 客戶端**: 使用 axios 調用 OpenAI 兼容 API
- **上下文管理**: 對話歷史保存在內存中，程序結束後清空
- **動態學習**: 啟動時自動獲取 CLI 命令結構，確保與最新 CLI 版本兼容
- **智能查詢**: AI 可使用 `[HELP:command]` 標記請求詳細幫助信息
- **命令執行**: 使用 child_process.exec 執行 CLI 命令
- **AI 兼容性**: 支持任何 OpenAI 兼容的 API，包括 Pi AI、Qwen、ChatGPT 等

## 故障排除

### API Key 錯誤
```
❌ 錯誤: Missing LLM_API_KEY in environment variables
```
**解決方案**: 確認 `.env` 文件存在且包含正確的 `LLM_API_KEY`

### 無法提取命令
```
⚠️  無法從回應中提取命令，請重新描述
```
**解決方案**: 嘗試更具體地描述操作，或使用更標準的表達方式

### 命令執行失敗
```
❌ 執行失敗: Command failed
```
**解決方案**: 檢查是否已正確安裝和配置 code-push-standalone CLI

## 開發

### 調試模式

查看完整的請求和響應：

```bash
DEBUG=* npm start
```

### 修改 System Prompt

編輯 `script/code-push-chat.js` 中的 system prompt 部分來調整 AI 行為。

## 許可證

與 code-push-server 主項目相同的許可證。
