# CLI 命令學習機制詳解

## 概述

cli-chat 不需要手動維護 CLI 命令列表，而是通過**動態查詢**的方式自動學習 code-push-standalone 的所有命令和參數。

## 工作流程

### 1. 啟動時初始化

當你運行 `npm start` 時，程序會：

```javascript
// 執行命令
code-push-standalone --help

// 獲取輸出
Usage: code-push-standalone <command>

命令：
  cli.js app            View and manage your CodePush apps
  cli.js deployment     View and manage your app deployments
  cli.js release        Release an update to an app deployment
  ...
```

這個完整的命令列表會被加入到 AI 的 system prompt 中。

### 2. 智能上下文提供

AI 在第一次對話時就知道所有可用的命令分類：

```
你是 CodePush CLI 助手...

## 可用的 CLI 命令

Usage: code-push-standalone <command>

命令：
  cli.js access-key     View and manage the access keys...
  cli.js app            View and manage your CodePush apps
  ...
```

### 3. 按需查詢詳細信息

當用戶詢問某個復雜命令時，AI 可以使用特殊標記 `[HELP:command]` 來請求詳細幫助：

**對話示例**：

```
用戶> 我想發布一個新版本

思考中...
助手> [HELP:release]
正在獲取 release 的詳細信息...
```

系統自動執行：
```bash
code-push-standalone release --help
```

獲取輸出：
```
Usage: code-push-standalone release <appName> <updateContentsPath> <targetBinaryVersion> [options]

選項：
  -d, --deploymentName           Deployment to release the update to
      --description, --des       Description of the changes
  -m, --mandatory                Specifies whether this release should be mandatory
  ...

示例：
  release MyApp app.js "*"
  release MyApp ./platforms/ios/www 1.0.3 -d Production
```

然後 AI 基於這些詳細信息生成準確的命令。

## 優勢

### ✅ 自動同步
- CLI 更新命令後，cli-chat 無需修改即可支持
- 新增的命令會自動出現在幫助信息中

### ✅ 準確性高
- 直接從 CLI 獲取幫助信息，不會出錯
- 包含完整的參數說明和示例

### ✅ 智能查詢
- AI 可以按需獲取詳細信息
- 避免一次性加載所有命令的詳細信息（節省 token）

### ✅ 上下文感知
- 幫助信息包含示例用法
- AI 可以學習正確的命令格式

## 技術實現

### getCliHelp 函數

```javascript
async function getCliHelp(command = null) {
  return new Promise((resolve) => {
    const helpCmd = command 
      ? `code-push-standalone ${command} --help`
      : `code-push-standalone --help`;
    
    exec(helpCmd, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve(null);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
```

### initializeCliContext 函數

```javascript
async function initializeCliContext() {
  if (cliHelpInfo) return cliHelpInfo;
  
  console.log('正在獲取 CLI 命令信息...');
  const mainHelp = await getCliHelp();
  
  if (mainHelp) {
    cliHelpInfo = mainHelp;
    console.log('✓ CLI 命令信息已加載\n');
  } else {
    // 降級處理
    cliHelpInfo = '基礎命令：app, deployment, release...';
  }
  
  return cliHelpInfo;
}
```

### 按需查詢機制

```javascript
// 檢測 AI 的請求
const helpRequestMatch = llmResponse.match(/\[HELP:([\w\s-]+)\]/);
if (helpRequestMatch) {
  const commandForHelp = helpRequestMatch[1].trim();
  console.log(`正在獲取 ${commandForHelp} 的詳細信息...`);
  
  // 獲取詳細幫助
  const detailedHelp = await getCliHelp(commandForHelp);
  
  // 將詳細信息添加到對話歷史
  conversationHistory.push({
    role: 'user',
    content: `這是 ${commandForHelp} 命令的詳細幫助信息：\n\n${detailedHelp}`
  });
  
  // 讓 AI 基於詳細信息重新生成命令
  llmResponse = await callLLM('', cliHelp);
}
```

## 對話流程示例

### 簡單查詢（無需詳細幫助）

```
用戶> 列出所有應用

[系統已知 app list 命令]

助手> ```shell
code-push-standalone app list
```
```

### 複雜操作（需要詳細幫助）

```
用戶> 發布新版本到 MyApp，只讓 30% 的用戶收到更新

[AI 不確定 rollout 參數的具體用法]

助手> [HELP:release]

[系統自動獲取 release 的詳細幫助]
正在獲取 release 的詳細信息...

[AI 看到 -r, --rollout 參數的說明]

助手> 需要提供以下信息：
1. 更新內容路徑（如 ./build）
2. 目標版本號（如 1.0.0 或 *）

用戶> 路徑 ./dist，版本 1.0.0

助手> ```shell
code-push-standalone release MyApp ./dist 1.0.0 -r 30%
```
```

## 最佳實踐

### 1. 確保 CLI 可訪問

cli-chat 需要能夠執行 `code-push-standalone` 命令：

```bash
# 檢查 CLI 是否已構建
cd ../cli
npm run build

# 確認命令可用
./bin/script/cli.js --help
```

### 2. 處理錯誤情況

如果 CLI 不可用，系統會降級到基礎知識：

```javascript
if (!mainHelp) {
  console.log('⚠️  無法獲取 CLI 幫助信息，將使用基礎知識\n');
  cliHelpInfo = '基礎命令：app, deployment, release...';
}
```

### 3. 緩存幫助信息

主命令列表在啟動時獲取一次並緩存，避免重複調用：

```javascript
let cliHelpInfo = null;  // 緩存

async function initializeCliContext() {
  if (cliHelpInfo) return cliHelpInfo;  // 使用緩存
  // ...
}
```

## 未來改進

### 可能的增強方向

1. **預加載常用命令**
   - 啟動時預先獲取 app、deployment、release 的詳細幫助
   - 減少對話中的等待時間

2. **命令建議**
   - 基於用戶歷史操作推薦相關命令
   - 例如：執行 app list 後建議查看 deployment

3. **錯誤處理增強**
   - 當命令執行失敗時，自動分析錯誤並建議修正
   - 提取錯誤信息並詢問 AI 如何修復

4. **離線模式**
   - 將幫助信息持久化到本地文件
   - 支持在沒有 CLI 的情況下使用（僅模擬）

## 總結

cli-chat 的智能學習機制使其能夠：

- ✅ **自動適應** CLI 的更新和變化
- ✅ **準確理解** 所有可用命令和參數
- ✅ **按需查詢** 詳細信息，節省資源
- ✅ **持續進化** 隨著 CLI 的發展而無需維護

這種設計確保了 chat 助手始終與 CLI 保持同步，無需人工維護命令列表。
