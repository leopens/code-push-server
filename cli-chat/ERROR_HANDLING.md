# 智能錯誤處理機制

## 概述

cli-chat 具有強大的錯誤診斷能力。當命令執行失敗時，它不僅會顯示錯誤信息，還會**自動調用 AI 分析錯誤**並提供解決方案。

## 為什麼需要智能錯誤處理？

### 傳統的錯誤處理
```
執行: code-push-standalone access-key list
[Error] You are not currently logged in...
⚠️  命令返回非零狀態碼: 1
```

用戶需要：
1. 閱讀錯誤信息
2. 理解錯誤原因
3. 查找解決方法
4. 重新輸入命令

### 智能錯誤處理
```
執行: code-push-standalone access-key list
[Error] You are not currently logged in...
⚠️  命令返回錯誤 (code: 1)

正在分析錯誤...

助手> 看起來你還沒有登錄。請先執行：
```shell
code-push-standalone login
```
```

AI 自動：
1. ✅ 識別錯誤類型（未登錄）
2. ✅ 給出解決方案（執行 login 命令）
3. ✅ 提供可執行的命令
4. ✅ 繼續對話，無需重新開始

## 工作原理

### 1. 捕獲完整錯誤信息

```javascript
function executeCommand(commandText) {
  // ...
  let stdout = '';
  let stderr = '';
  
  child.stdout.on('data', (data) => {
    process.stdout.write(data);
    stdout += data;  // 捕獲標準輸出
  });
  
  child.stderr.on('data', (data) => {
    process.stderr.write(data);
    stderr += data;  // 捕獲錯誤輸出
  });
  
  child.on('exit', (code) => {
    resolve({ code, stdout, stderr });  // 返回完整信息
  });
}
```

### 2. 構建詳細的上下文消息

```javascript
let resultMessage = `命令執行結果 (exit code: ${result.code}):\n\n`;

if (result.stdout) {
  resultMessage += `標準輸出:\n${result.stdout}\n\n`;
}

if (result.stderr) {
  resultMessage += `錯誤輸出:\n${result.stderr}\n`;
}

// 將完整信息加入對話上下文
conversationHistory.push({
  role: 'user',
  content: resultMessage
});
```

### 3. 自動觸發錯誤分析

```javascript
if (result.code !== 0) {
  console.log(`\n⚠️  命令返回錯誤 (code: ${result.code})\n`);
  
  // 自動請求 AI 分析
  console.log('正在分析錯誤...');
  const errorAnalysis = await callLLM(
    '請幫我分析上面的錯誤，並給出解決建議。',
    cliHelp
  );
  console.log(`\n助手> ${errorAnalysis}\n`);
}
```

### 4. AI 錯誤診斷能力

在 system prompt 中，AI 被訓練識別常見錯誤：

```javascript
## 常見錯誤處理

- **未登錄錯誤**：如果命令因為未認證而失敗，建議用戶先執行 `code-push-standalone login`
- **權限錯誤**：檢查用戶是否有相應的權限
- **參數錯誤**：根據錯誤信息修正參數格式或值
- **資源不存在**：確認應用名稱、部署名稱等是否正確
```

## 實際案例

### 案例 1: 未登錄錯誤

**場景**：用戶嘗試列出 access key，但還沒登錄

```
你> 查看所有 access key

助手> ```shell
code-push-standalone access-key list
```

是否執行? y

執行: code-push-standalone access-key list

命令執行結果 (exit code: 1):

錯誤輸出:
[Error] You are not currently logged in. Please login using 'code-push-standalone login'

⚠️  命令返回錯誤 (code: 1)

正在分析錯誤...

助手> 你還沒有登錄 CodePush 服務。需要先執行登錄命令：

```shell
code-push-standalone login
```

登錄後就可以查看 access key 了。
```

**結果**：用戶知道下一步該做什麼，無需自己查詢文檔。

### 案例 2: 應用不存在

**場景**：用戶輸錯應用名稱

```
你> 查看 MyAppp 的部署情況

助手> ```shell
code-push-standalone deployment list MyAppp
```

是否執行? y

執行: code-push-standalone deployment list MyAppp

命令執行結果 (exit code: 1):

錯誤輸出:
[Error] App 'MyAppp' does not exist.

⚠️  命令返回錯誤 (code: 1)

正在分析錯誤...

助手> 應用 'MyAppp' 不存在。可能是：
1. 應用名稱拼寫錯誤
2. 應用尚未創建

你可以：
- 執行 `code-push-standalone app list` 查看所有應用
- 檢查應用名稱是否正確（注意大小寫）

需要我幫你列出所有應用嗎？
```

**結果**：AI 不僅指出錯誤，還提供多個解決方案。

### 案例 3: 參數格式錯誤

**場景**：用戶提供了不正確的參數格式

```
你> 發布 MyApp，rollout 設為 30

助手> ```shell
code-push-standalone release MyApp ./dist 1.0.0 -r 30
```

是否執行? y

執行: code-push-standalone release MyApp ./dist 1.0.0 -r 30

命令執行結果 (exit code: 1):

錯誤輸出:
[Error] Invalid rollout value. Must be between 1-100 followed by '%' (e.g. '25%')

⚠️  命令返回錯誤 (code: 1)

正在分析錯誤...

助手> rollout 參數格式不正確。需要包含百分號，例如 '30%'。

正確的命令應該是：

```shell
code-push-standalone release MyApp ./dist 1.0.0 -r 30%
```

要執行修正後的命令嗎？
```

**結果**：AI 自動修正錯誤並提供正確的命令。

## 優勢

### ✅ 1. 即時反饋
- 錯誤發生後立即分析
- 無需離開對話界面
- 無需手動查閱文檔

### ✅ 2. 上下文感知
- AI 知道之前執行了什麼命令
- 可以基於歷史給出建議
- 提供連貫的解決流程

### ✅ 3. 學習能力
- AI 從每次錯誤中學習
- 相似錯誤會給出更好的建議
- 適應用戶的操作習慣

### ✅ 4. 減少挫折感
- 用戶不會因為錯誤而困惑
- 始終有明確的下一步指引
- 提升整體使用體驗

## 常見錯誤類型

### 認證錯誤
```
[Error] You are not currently logged in
[Error] Invalid access token
[Error] Authentication failed
```
**解決**：引導用戶執行 login 命令

### 資源不存在
```
[Error] App 'XXX' does not exist
[Error] Deployment 'YYY' does not exist
[Error] Release not found
```
**解決**：建議列出可用資源或檢查名稱

### 參數錯誤
```
[Error] Invalid parameter format
[Error] Missing required argument
[Error] Invalid version range
```
**解決**：修正參數格式並重新生成命令

### 權限錯誤
```
[Error] You do not have permission
[Error] Collaborator not found
```
**解決**：說明權限要求或建議聯繫管理員

## 自定義錯誤處理

你可以通過修改 system prompt 來增強錯誤處理能力：

```javascript
## 常見錯誤處理

- **自定義錯誤類型**：添加你的特定錯誤模式
- **特殊處理邏輯**：針對某些錯誤提供專門的解決方案
- **預防性檢查**：在執行前檢查常見問題
```

## 未來改進

### 可能的增強

1. **錯誤預測**
   - 在生成命令時預測可能的錯誤
   - 提前檢查前置條件
   
2. **自動重試**
   - 對於可修復的錯誤（如參數格式），自動生成修正後的命令
   - 詢問用戶是否直接執行修正版本

3. **錯誤統計**
   - 記錄常見錯誤類型
   - 提供個性化的預防建議

4. **知識庫集成**
   - 連接到 FAQ 或文檔
   - 提供更詳細的解決方案鏈接

## 總結

智能錯誤處理讓 cli-chat 不只是一個命令轉換器，而是一個真正的**智能助手**：

- 📊 **完整信息**：捕獲所有輸出和錯誤
- 🧠 **智能分析**：AI 理解錯誤並給出建議
- 🔄 **持續對話**：錯誤不會打斷工作流程
- 🎯 **精準解決**：基於上下文提供具體方案

這種設計讓用戶能夠**專注於目標而非細節**，真正實現了自然語言操作 CLI 的願景！
