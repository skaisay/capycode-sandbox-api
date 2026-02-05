/**
 * E2B Sandbox API Server
 * 
 * Отдельный сервер для работы с E2B sandbox.
 * Деплоится на Railway/Render - там нет ограничения 10 секунд как на Vercel Hobby.
 * 
 * Endpoints:
 * POST /sandbox/create - создать sandbox
 * POST /sandbox/upload - загрузить файлы
 * POST /sandbox/exec - выполнить команду
 * POST /sandbox/expo-start - запустить Expo
 * POST /sandbox/expo-status - получить статус Expo
 * POST /sandbox/expo-stop - остановить Expo
 * DELETE /sandbox/:id - удалить sandbox
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Sandbox } = require('e2b');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Allow all origins for CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));

const E2B_API_KEY = process.env.E2B_API_KEY;

console.log('[E2B] API Key configured:', !!E2B_API_KEY);

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'CapyCode Sandbox API',
    e2bConfigured: !!E2B_API_KEY,
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', e2bConfigured: !!E2B_API_KEY });
});

// Create sandbox
app.post('/sandbox/create', async (req, res) => {
  if (!E2B_API_KEY) {
    return res.status(503).json({ error: 'E2B не настроен' });
  }

  try {
    const { projectId } = req.body;
    console.log('[E2B] Creating sandbox for project:', projectId);

    const sandbox = await Sandbox.create('base', {
      apiKey: E2B_API_KEY,
      timeoutMs: 60 * 60 * 1000, // 1 hour
    });

    const sandboxId = sandbox.sandboxId;
    console.log('[E2B] Sandbox created:', sandboxId);

    // Install Node.js via nvm
    console.log('[E2B] Installing Node.js...');
    await sandbox.commands.run(
      'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash && ' +
      'export NVM_DIR="$HOME/.nvm" && ' +
      '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && ' +
      'nvm install 18 && nvm use 18',
      { timeoutMs: 180000 }
    );

    // Create .bashrc
    await sandbox.files.write('/home/user/.bashrc', `
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
`);

    // Create project directory
    await sandbox.commands.run('mkdir -p /home/user/project');

    console.log('[E2B] Sandbox ready:', sandboxId);

    res.json({
      id: sandboxId,
      sandboxId: sandboxId,
      status: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
  } catch (error) {
    console.error('[E2B] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reconnect helper
async function reconnectSandbox(sandboxId) {
  console.log('[E2B] Reconnecting to:', sandboxId);
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: E2B_API_KEY,
  });
  console.log('[E2B] Connected:', sandbox.sandboxId);
  return sandbox;
}

// Upload files
app.post('/sandbox/upload', async (req, res) => {
  try {
    const { sandboxId, files } = req.body;
    if (!sandboxId) {
      return res.status(400).json({ error: 'sandboxId required' });
    }

    const sandbox = await reconnectSandbox(sandboxId);
    const projectDir = '/home/user/project';

    console.log(`[E2B] Uploading ${files.length} files...`);

    await sandbox.commands.run(`mkdir -p ${projectDir}`);

    for (const file of files) {
      const filePath = `${projectDir}/${file.path}`;
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (dir) {
        await sandbox.commands.run(`mkdir -p "${dir}"`);
      }
      await sandbox.files.write(filePath, file.content);
    }

    // Verify
    const verifyResult = await sandbox.commands.run(`ls -la ${projectDir}/`, { timeoutMs: 5000 });
    console.log('[E2B] Files uploaded:', verifyResult.stdout);

    res.json({ success: true, filesUploaded: files.length });
  } catch (error) {
    console.error('[E2B] Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute command
app.post('/sandbox/exec', async (req, res) => {
  try {
    const { sandboxId, command } = req.body;
    if (!sandboxId) {
      return res.status(400).json({ error: 'sandboxId required' });
    }

    const sandbox = await reconnectSandbox(sandboxId);
    const nvmPrefix = 'source $HOME/.nvm/nvm.sh 2>/dev/null; ';

    console.log('[E2B] Executing:', command);

    const result = await sandbox.commands.run(nvmPrefix + command, { timeoutMs: 120000 });

    res.json({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.stdout + (result.stderr ? '\n' + result.stderr : ''),
    });
  } catch (error) {
    console.error('[E2B] Exec error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start Expo
app.post('/sandbox/expo-start', async (req, res) => {
  try {
    const { sandboxId } = req.body;
    if (!sandboxId) {
      return res.status(400).json({ error: 'sandboxId required' });
    }

    console.log('[E2B] Starting Expo for:', sandboxId);

    let sandbox;
    try {
      sandbox = await reconnectSandbox(sandboxId);
    } catch (error) {
      console.error('[E2B] Reconnect failed:', error);
      return res.status(410).json({ 
        error: 'Sandbox expired', 
        message: 'Пожалуйста, создайте новую сессию' 
      });
    }

    const projectDir = '/home/user/project';

    // Check package.json
    const checkResult = await sandbox.commands.run(
      `test -f ${projectDir}/package.json && echo "exists"`,
      { timeoutMs: 5000 }
    );

    if (checkResult.exitCode !== 0) {
      return res.status(400).json({
        error: 'Project not found',
        message: 'Сначала загрузите файлы проекта',
      });
    }

    // Create startup script - use /home/user for write permissions
    const startupScript = `#!/bin/bash
# Don't use set -e to continue on errors
cd ${projectDir}
source $HOME/.nvm/nvm.sh 2>/dev/null || true

echo "=== Starting at $(date) ===" > /home/user/expo-status.log
echo "Working directory: $(pwd)" >> /home/user/expo-status.log
echo "Node version: $(node -v)" >> /home/user/expo-status.log
echo "NPM version: $(npm -v)" >> /home/user/expo-status.log

echo "Starting npm install..." >> /home/user/expo-status.log
npm install >> /home/user/expo-install.log 2>&1 || echo "npm install had errors" >> /home/user/expo-status.log
echo "npm install complete" >> /home/user/expo-status.log

echo "Installing expo-cli..." >> /home/user/expo-status.log
npm install -g expo-cli @expo/ngrok >> /home/user/expo-install.log 2>&1 || true
echo "expo-cli installed" >> /home/user/expo-status.log

echo "Starting Expo..." >> /home/user/expo-status.log
# Run expo with tunnel mode
npx expo start --tunnel --non-interactive >> /home/user/expo.log 2>&1 &
EXPO_PID=$!
echo "Expo started with PID: $EXPO_PID" >> /home/user/expo-status.log
echo "Expo started" >> /home/user/expo-status.log

# Keep script alive to monitor
sleep 300
`;

    await sandbox.files.write('/home/user/start-expo.sh', startupScript);
    
    // Use chmod separately, then start script in background without waiting
    await sandbox.commands.run('chmod +x /home/user/start-expo.sh', { timeoutMs: 5000 });
    
    // Start the script in background - don't await, just fire and forget
    sandbox.commands.run(
      'bash /home/user/start-expo.sh',
      { timeoutMs: 0, background: true }
    ).catch(err => {
      // Ignore - this runs in background
      console.log('[E2B] Background script started (or timeout ignored)');
    });

    console.log('[E2B] Expo starting in background');

    res.json({
      status: 'starting',
      message: 'Установка зависимостей и запуск Expo...',
      sandboxId,
      success: true,
    });
  } catch (error) {
    console.error('[E2B] Expo start error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Expo status
app.post('/sandbox/expo-status', async (req, res) => {
  try {
    const { sandboxId } = req.body;
    if (!sandboxId) {
      return res.status(400).json({ error: 'sandboxId required' });
    }

    const sandbox = await reconnectSandbox(sandboxId);

    const statusResult = await sandbox.commands.run(
      'cat /home/user/expo-status.log 2>/dev/null || echo "not started"',
      { timeoutMs: 5000 }
    );

    const expoLogResult = await sandbox.commands.run(
      'cat /home/user/expo.log 2>/dev/null | tail -100',
      { timeoutMs: 5000 }
    );

    const statusLog = statusResult.stdout || '';
    const expoLog = expoLogResult.stdout || '';
    
    // Log status for debugging
    console.log('[E2B] Status log:', statusLog.slice(0, 200));
    if (expoLog) console.log('[E2B] Expo log:', expoLog.slice(0, 200));

    let status = 'starting';
    let message = 'Запуск...';

    if (statusLog.includes('Starting npm install')) {
      status = 'installing';
      message = 'Установка зависимостей...';
    }
    if (statusLog.includes('npm install complete')) {
      status = 'installing-expo';
      message = 'Установка expo-cli...';
    }
    if (statusLog.includes('expo-cli installed')) {
      status = 'starting-expo';
      message = 'Запуск Expo сервера...';
    }
    if (statusLog.includes('Expo started')) {
      status = 'running';
      message = 'Expo работает';
    }

    // Find Expo URL - look for tunnel URL
    let expoUrl = '';
    const tunnelMatch = expoLog.match(/Tunnel ready at (exp:\/\/[^\s]+)/);
    const expMatch = expoLog.match(/exp:\/\/[^\s\]"]+/);
    const expHostMatch = expoLog.match(/https:\/\/exp\.host\/[^\s"]+/);
    
    if (tunnelMatch) {
      expoUrl = tunnelMatch[1];
    } else if (expMatch) {
      expoUrl = expMatch[0].replace(/[\]\)"]+$/, '');
    } else if (expHostMatch) {
      expoUrl = expHostMatch[0];
    }
    
    if (expoUrl) {
      console.log('[E2B] Found Expo URL:', expoUrl);
      status = 'ready';
      message = 'Expo готов!';
    }

    const qrCodeUrl = expoUrl 
      ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(expoUrl)}`
      : '';

    res.json({
      status,
      message,
      url: expoUrl,
      qrCode: qrCodeUrl,
      log: expoLog.slice(-1000),
    });
  } catch (error) {
    console.error('[E2B] Status error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Stop Expo
app.post('/sandbox/expo-stop', async (req, res) => {
  try {
    const { sandboxId } = req.body;
    if (sandboxId) {
      const sandbox = await reconnectSandbox(sandboxId);
      await sandbox.commands.run('pkill -f expo || true');
    }
    res.json({ success: true });
  } catch (error) {
    res.json({ success: true }); // Ignore errors
  }
});

// Delete sandbox
app.delete('/sandbox/:id', async (req, res) => {
  try {
    const sandbox = await reconnectSandbox(req.params.id);
    await sandbox.kill();
    res.json({ success: true });
  } catch (error) {
    res.json({ success: true }); // Ignore errors
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Sandbox API running on port ${PORT}`);
  console.log(`📦 E2B configured: ${!!E2B_API_KEY}`);
});
