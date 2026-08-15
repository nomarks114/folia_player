// Build script that bypasses SSL certificate verification
// This is needed when behind corporate proxies with self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
process.env.ELECTRON_DEV = 'false';
process.env.ELECTRON = 'true';

// Dynamically import electron-builder
import('electron-builder').then(async ({ build }) => {
  try {
    const result = await build({
      publish: 'never',
      config: {
        win: {
          signExecutable: false,
        },
      },
    });
    console.log('Build result:', result);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}).catch(err => {
  console.error('Failed to import electron-builder:', err);
  process.exit(1);
});