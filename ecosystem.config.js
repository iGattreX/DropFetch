// pm2 config — run `pm2 start ecosystem.config.js` from the project root.
module.exports = {
  apps: [
    {
      name: 'dropfetch',
      script: 'dist/src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
