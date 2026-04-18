import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    secret: process.env.SESSION_SECRET || 'monika-auth0-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
    }
  }));

  // Auth0 Helper: getRedirectUri
  const getRedirectUri = () => {
    return `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`;
  };

  // Auth0: Get Auth URL
  app.get('/api/auth/url', (req, res) => {
    const domain = process.env.AUTH0_DOMAIN;
    const clientId = process.env.AUTH0_CLIENT_ID;

    // Support Mock Mode for immediate feedback
    if (req.query.mock === 'true' || !domain || !clientId) {
      console.warn('Auth0 credentials missing. Falling back to MOCK mode.');
      return res.json({ 
        url: getRedirectUri() + '?mock=true',
        isMock: true 
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getRedirectUri(),
      response_type: 'code',
      scope: 'openid profile email',
      audience: `https://${domain}/userinfo`,
    });

    res.json({ url: `https://${domain}/authorize?${params.toString()}`, isMock: false });
  });

  // Auth0: Callback Handler
  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code, mock } = req.query;
    const userName = mock === 'true' ? 'Guest Agent' : 'Verified User';
    
    // For this migration, we'll simulate a success message to the client
    res.send(`
      <html>
        <body style="background: #0a0a0c; color: #e0e0e6; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
          <div style="text-align: center; border: 1px solid #2a2a30; padding: 2rem; border-radius: 4px; background: #111114;">
            <h2 style="color: #ff7eb9; font-family: monospace;">AUTH0_SYNC_SUCCESS</h2>
            <p style="opacity: 0.6; font-size: 0.8rem;">Authenticating with MONIKA_OS as ${userName}...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user: { name: '${userName}' } }, '*');
                setTimeout(() => window.close(), 1000);
              } else {
                window.location.href = '/';
              }
            </script>
          </div>
        </body>
      </html>
    `);
  });

  // Simple status endpoint
  app.get('/api/status', (req, res) => {
    res.json({ ok: true, message: 'Just Monika Server is running' });
  });

  // ElevenLabs TTS Proxy
  app.post('/api/tts', async (req, res) => {
    const { text, apiKey, voiceId } = req.body;
    
    if (!text || !apiKey) {
      return res.status(400).json({ error: 'Text and API Key are required' });
    }

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId || '21m00Tcm4TlvDq8ikWAM'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail?.message || 'ElevenLabs API Error');
      }

      // Pipe the audio stream back to the client
      const arrayBuffer = await response.arrayBuffer();
      res.set('Content-Type', 'audio/mpeg');
      res.send(Buffer.from(arrayBuffer));
    } catch (error: any) {
      console.error('TTS Proxy Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Serve static files from marihacks if needed, 
  // but Vite will handle most things in dev.
  app.use('/marihacks', express.static(path.join(__dirname, 'marihacks')));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
