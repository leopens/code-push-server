#!/usr/bin/env node

// CodePush LLM Agent - Interactive Chat Mode
// Supports continuous conversation with context accumulation
// Press 'q' to exit

const { exec } = require('child_process');
const readline = require('readline');
const axios = require('axios');

// Conversation context history
const conversationHistory = [];

// Cache for CLI help information
let cliHelpInfo = null;

/**
 * Get CLI help information by executing --help command
 */
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

/**
 * Initialize CLI context by fetching help information
 */
async function initializeCliContext() {
  if (cliHelpInfo) return cliHelpInfo;
  
  console.log('正在獲取 CLI 命令信息...');
  const mainHelp = await getCliHelp();
  
  if (mainHelp) {
    cliHelpInfo = mainHelp;
    console.log('✓ CLI 命令信息已加載\n');
  } else {
    console.log('⚠️  無法獲取 CLI 幫助信息，將使用基礎知識\n');
    cliHelpInfo = '基礎命令：app, deployment, release, release-react, promote, rollback, login, logout, whoami, register, access-key';
  }
  
  return cliHelpInfo;
}

function getConfig() {
  // Support any OpenAI-compatible endpoint
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  const endpoint = (process.env.LLM_ENDPOINT || 'https://api.openai.com/v1').trim();
  const model = (process.env.LLM_MODEL || 'gpt-3.5-turbo').trim();

  if (!apiKey) {
    throw new Error('Missing LLM_API_KEY in environment variables');
  }
  
  return { endpoint, apiKey, model };
}

async function promptUser(promptText) {
  const rl = readline.createInterface({ 
    input: process.stdin, 
    output: process.stdout 
  });
  return new Promise(resolve => {
    rl.question(promptText, ans => { 
      rl.close(); 
      resolve(ans.trim()); 
    });
  });
}

function extractCommand(text) {
  if (!text) return null;
  
  // Look for code blocks with shell/bash/sh
  const codeBlockMatch = text.match(/```(?:shell|bash|sh)?\s*\n(.*?)\n```/s);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }
  
  // Check if it's a full command
  const fullMatch = text.match(/code-push-standalone\s+(.*)/i);
  if (fullMatch && fullMatch[1].trim()) {
    return `code-push-standalone ${fullMatch[1].trim()}`;
  }
  
  // Check if it starts with a valid command category
  const validStart = /^(app|deployment|release|release-react|promote|rollback|login|logout|whoami|register|access-key)\b/i;
  if (validStart.test(text)) {
    return `code-push-standalone ${text}`;
  }
  
  return null;
}

async function callLLM(userMessage, cliHelp) {
  const { endpoint, apiKey, model } = getConfig();

  // Add system prompt on first message
  if (conversationHistory.length === 0) {
    const systemPrompt = `你是 CodePush CLI 助手。用戶會用自然語言描述需要執行的操作，你需要：

1. **理解用戶意圖**並生成對應的 code-push-standalone 命令
2. **輸出格式**：將命令包在代碼塊中，例如：
   \`\`\`shell
   code-push-standalone app list
   \`\`\`
3. **參數處理**：基於上下文推斷參數，不確定時詢問用戶
4. **使用完整命令**：確保命令格式正確且參數完整
5. **獲取詳細幫助**：如需查看某個命令的詳細參數，可輸出 [HELP:command] 來請求，例如 [HELP:release]
6. **錯誤診斷**：當命令執行失敗時，分析錯誤原因並提供解決方案
7. **幫助查詢識別**：當用戶問「有哪些參數」、「怎麼用」、「如何使用」、「支持什麼選項」等問題時，生成 --help 命令，例如：
   - 用戶問：「release 有哪些參數？」→ \`\`\`shell\ncode-push-standalone release --help\n\`\`\`
   - 用戶問：「app 命令怎麼用？」→ \`\`\`shell\ncode-push-standalone app --help\n\`\`\`
   - 用戶問：「有哪些命令可以用？」→ \`\`\`shell\ncode-push-standalone --help\n\`\`\`

## 可用的 CLI 命令

${cliHelp || '正在加載命令信息...'}

## 常見錯誤處理

- **無任何輸出 + 非零退出碼**：最常見原因是未登錄，建議執行 \`code-push-standalone login\`。也可能是 CLI 未正確安裝。
- **未登錄錯誤**：如果錯誤信息提到 "not logged in" 或 "authentication"，建議先執行 \`code-push-standalone login\`
- **權限錯誤**：檢查用戶是否有相應的權限
- **參數錯誤**：根據錯誤信息修正參數格式或值
- **資源不存在**：確認應用名稱、部署名稱等是否正確
- **CLI 不可用**：如果命令完全沒有輸出，可能是 code-push-standalone 未安裝或不在 PATH 中

## 輸出規範

- 必須將命令包在 \`\`\`shell 代碼塊中
- 命令必須以 code-push-standalone 開頭
- 如果用戶描述不清楚，先詢問缺失的參數，不要猜測
- 如果需要了解命令的詳細參數，可以先輸出 [HELP:command]

## 範例對話

**用戶**：列出所有應用
**助手**：\`\`\`shell
code-push-standalone app list
\`\`\`

**用戶**：release 命令有哪些參數？
**助手**：\`\`\`shell
code-push-standalone release --help
\`\`\`

**用戶**：app 怎麼用？
**助手**：\`\`\`shell
code-push-standalone app --help
\`\`\`

**用戶**：發布新版本到 MyApp 的 Staging
**助手**：[HELP:release]

（系統會自動獲取 release 命令的詳細幫助信息）

**助手**：需要提供以下信息：
1. 更新內容路徑（如 ./build）
2. 目標 binary 版本（如 1.0.0 或 *）

或者，你可以直接告訴我這些參數。

**用戶**：路徑是 ./dist，版本 1.2.0
**助手**：\`\`\`shell
code-push-standalone release MyApp ./dist 1.2.0 -d Staging
\`\`\`

**系統**：命令執行結果 (exit code: 1)

錯誤輸出:
[Error] You are not currently logged in. Please login using 'code-push-standalone login'

**用戶**：請幫我分析上面的錯誤
**助手**：錯誤原因是你還沒有登錄。你需要先執行登錄命令：

\`\`\`shell
code-push-standalone login
\`\`\`

登錄成功後，再重新執行剛才的 release 命令。`;

    conversationHistory.push({
      role: 'system',
      content: systemPrompt
    });
  }

  // Add user message to history (skip if empty - used for follow-up queries)
  if (userMessage) {
    conversationHistory.push({
      role: 'user',
      content: userMessage
    });
  }

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 800,
    messages: conversationHistory
  };

  try {
    const url = endpoint.endsWith('/') 
      ? `${endpoint}chat/completions` 
      : `${endpoint}/chat/completions`;

    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (res.data.choices && res.data.choices[0] && res.data.choices[0].message) {
      const assistantMessage = res.data.choices[0].message.content.trim();
      
      // Add assistant response to history
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });
      
      return assistantMessage;
    } else {
      throw new Error('LLM 返回結構不支持');
    }
  } catch (error) {
    if (error.response) {
      throw new Error(`LLM 返回錯誤 ${error.response.status}: ${error.response.data}`);
    }
    throw error;
  }
}

/**
 * Check if a command is read-only (doesn't need confirmation)
 */
function isReadOnlyCommand(commandText) {
  const readOnlyPatterns = [
    /--help\b/i,
    /-h\b/i,
    /\b(list|ls)\b/i,
    /\bshow\b/i,
    /\bget\b/i,
    /\bdisplay\b/i,
    /\bwhoami\b/i,
    /\bapp\s+list\b/i,
    /\baccess-key\s+ls\b/i,
    /\baccess-key\s+list\b/i,
    /\bdeployment\s+ls\b/i,
    /\bdeployment\s+list\b/i,
    /\bdeployment\s+history\b/i
  ];
  
  return readOnlyPatterns.some(pattern => pattern.test(commandText));
}

function executeCommand(commandText) {
  return new Promise((resolve, reject) => {
    console.log(`\n\x1b[93m⚡ 執行: ${commandText}\x1b[0m\n`);
    
    const child = exec(commandText, {
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
    
    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function chatLoop() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║    CodePush Chat - 互動式 CLI 助手                        ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  用自然語言描述你要執行的操作                            ║');
  console.log('║  輸入 q 或 quit 退出                                      ║');
  console.log('║  自動累積對話上下文，支持連續操作                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Initialize CLI context
  const cliHelp = await initializeCliContext();

  while (true) {
    try {
      const userInput = await promptUser('💬 你> ');
      
      // Check exit command
      if (!userInput || userInput.toLowerCase() === 'q' || userInput.toLowerCase() === 'quit') {
        console.log('\n再見！👋\n');
        process.exit(0);
      }

      // Call LLM with CLI help context
      console.log('\n思考中...');
      let llmResponse = await callLLM(userInput, cliHelp);
      
      // Check if LLM wants to see detailed help for a specific command
      const helpRequestMatch = llmResponse.match(/\[HELP:([\w\s-]+)\]/);
      if (helpRequestMatch) {
        const commandForHelp = helpRequestMatch[1].trim();
        console.log(`正在獲取 ${commandForHelp} 的詳細信息...`);
        
        const detailedHelp = await getCliHelp(commandForHelp);
        if (detailedHelp) {
          // Add detailed help to context and ask LLM again
          conversationHistory.push({
            role: 'assistant',
            content: llmResponse
          });
          conversationHistory.push({
            role: 'user',
            content: `這是 ${commandForHelp} 命令的詳細幫助信息：\n\n${detailedHelp}\n\n請基於這些信息生成命令。`
          });
          
          llmResponse = await callLLM('', cliHelp);
        }
      }
      
      // Display LLM response in dimmed color
      console.log(`\n\x1b[90m🤖 助手> ${llmResponse}\x1b[0m\n`);

      // Extract command
      const commandText = extractCommand(llmResponse);
      
      if (!commandText) {
        console.log('⚠️  無法從回應中提取命令，請重新描述\n');
        continue;
      }

      // Only confirm for write operations (create, delete, update, release, etc.)
      const needsConfirmation = !isReadOnlyCommand(commandText);
      
      if (needsConfirmation) {
        const confirm = await promptUser('是否執行此命令? (y/N): ');
        
        if (!/^y(es)?$/i.test(confirm)) {
          console.log('❌ 已取消\n');
          continue;
        }
      }

      // Execute command
      try {
        const result = await executeCommand(commandText);
        
        // Display command output
        if (result.stdout && result.stdout.trim()) {
          console.log(result.stdout.trim());
        }
        
        if (result.stderr && result.stderr.trim()) {
          console.log('\n❌ 錯誤信息:');
          console.log(result.stderr.trim());
        }
        
        if (!result.stdout && !result.stderr) {
          console.log('(命令無任何輸出)');
        }
        console.log(''); // Empty line for spacing
        
        // Prepare result message for AI context
        let resultMessage = `我執行了命令: ${commandText}\n\n`;
        resultMessage += `結果 (exit code: ${result.code}):\n\n`;
        
        if (result.stdout && result.stdout.trim()) {
          resultMessage += `標準輸出:\n${result.stdout.trim()}\n\n`;
        }
        
        if (result.stderr && result.stderr.trim()) {
          resultMessage += `錯誤輸出:\n${result.stderr.trim()}\n\n`;
        }
        
        if (!result.stdout && !result.stderr) {
          resultMessage += '命令沒有產生任何輸出（stdout 和 stderr 都為空）。\n';
          resultMessage += '這可能表示：\n';
          resultMessage += '- CLI 未正確安裝或不在 PATH 中\n';
          resultMessage += '- 需要先登錄（未認證）\n';
          resultMessage += '- 命令執行但被靜默處理\n';
        }
        
        // Add execution result to context
        conversationHistory.push({
          role: 'user',
          content: resultMessage
        });
        
        if (result.code === 0) {
          console.log('✅ 執行成功\n');
        } else {
          console.log(`⚠️  命令失敗 (exit code: ${result.code})\n`);
          
          // Ask AI to help diagnose the error
          console.log('🔍 正在分析錯誤原因...\n');
          const errorAnalysis = await callLLM('請分析上面的命令執行結果，診斷失敗原因，並給出具體的解決步驟。', cliHelp);
          console.log(`助手> ${errorAnalysis}\n`);
        }
      } catch (execError) {
        console.error(`\n❌ 執行失敗: ${execError.message}\n`);
        
        // Add error to context
        conversationHistory.push({
          role: 'user',
          content: `命令執行失敗: ${execError.message}`
        });
      }

    } catch (error) {
      console.error(`\n❌ 錯誤: ${error.message}\n`);
      
      // Don't exit on error, continue the loop
      const retry = await promptUser('是否繼續? (Y/n): ');
      if (retry.toLowerCase() === 'n' || retry.toLowerCase() === 'no') {
        console.log('\n再見！👋\n');
        process.exit(0);
      }
    }
  }
}

// Main entry point
(async function main() {
  try {
    // Check for help flag
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log('Usage: code-push-chat');
      console.log('');
      console.log('啟動互動式 CodePush CLI 助手');
      console.log('');
      console.log('環境變數:');
      console.log('  LLM_API_KEY     - API Key (必需)');
      console.log('  LLM_ENDPOINT    - API 端點 (預設: https://api.openai.com/v1)');
      console.log('  LLM_MODEL       - 模型名稱 (預設: gpt-3.5-turbo)');
      console.log('');
      process.exit(0);
    }

    // Start chat loop
    await chatLoop();
  } catch (err) {
    console.error(`\n❌ 錯誤: ${err.message}\n`);
    process.exit(1);
  }
})();