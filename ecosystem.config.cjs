module.exports = {
  apps: [
    {
      name: "wabflow",
      script: "./src/server.js",
      cwd: "/var/www/wabflow",

      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production"
      },

      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "500M",

      time: true,

      error_file: "/var/www/wabflow/logs/pm2-error.log",
      out_file: "/var/www/wabflow/logs/pm2-out.log",
      log_file: "/var/www/wabflow/logs/pm2-combined.log"
    }
  ]
};